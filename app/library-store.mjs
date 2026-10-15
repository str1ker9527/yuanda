/** Managed local library snapshots. Source files are never changed by installation or editing. */
import {mkdir,open,readdir,lstat,rename,unlink,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createBlankProject,validateProject} from './core/document.mjs';
import {createLibrary,validateLibrary,editLibrary,captureLibraryItem,LIBRARY_LIMITS} from './core/library-model.mjs';

const h={uuid:randomUUID,createBlankProject,validateProject};
const MAX_INSTALLED=20,MAX_TOTAL=128*1024*1024,MAX_ENVELOPE=LIBRARY_LIMITS.bytes+32768;
const revision=library=>createHash('sha256').update(JSON.stringify(library)).digest('hex');
const fail=(message,code='LIBRARY_ERROR')=>{throw Object.assign(new Error(message),{code});};
const checkId=id=>{if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))fail('元件库编号无效');return id;};

export async function readLibraryFile(file) {
  const value=JSON.parse(await readBounded(file,LIBRARY_LIMITS.bytes));validateLibrary(value,h);return value;
}
async function readBounded(file,max) {
  const handle=await open(file,'r');
  try {
    if(!(await handle.stat()).isFile()||(await handle.stat()).size>max)fail('元件库文件过大或不是普通文件');
    const chunks=[];let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false})) {bytes+=chunk.length;if(bytes>max)fail('元件库文件超过大小限制');chunks.push(chunk);}
    return Buffer.concat(chunks).toString('utf8');
  } finally {await handle.close();}
}
async function atomicWrite(file,content,backup=false,beforeCommit=async()=>{}) {
  const temporary=`${file}.${randomUUID()}.tmp`;let handle;
  try {handle=await open(temporary,'wx');await handle.writeFile(content,'utf8');await handle.sync();await handle.close();handle=null;await beforeCommit();
    if(backup)await copyFile(file,`${file}.bak`).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await rename(temporary,file);
  } finally {await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export class LibraryStore {
  constructor(directory){this.directory=path.resolve(directory);this.queue=Promise.resolve();}
  async ready(){await mkdir(this.directory,{recursive:true});if((await lstat(this.directory)).isSymbolicLink())fail('元件库目录不能是符号链接');}
  file(id){return path.join(this.directory,`${checkId(id)}.json`);}
  async read(id){
    await this.ready();const file=this.file(id),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())fail('托管元件库必须是普通文件');
    const envelope=JSON.parse(await readBounded(file,MAX_ENVELOPE));
    if(envelope.format!=='yuanda-library-install'||envelope.version!==1||envelope.library?.id!==id||!(envelope.sourcePath===null||typeof envelope.sourcePath==='string'&&path.isAbsolute(envelope.sourcePath)&&envelope.sourcePath.length<=32768))fail('托管元件库登记无效');
    validateLibrary(envelope.library,h);
    return {id,path:file,sourcePath:envelope.sourcePath,library:envelope.library,revision:revision(envelope.library)};
  }
  async list(){
    await this.ready();const libraries=[],errors=[];let bytes=0;
    const files=(await readdir(this.directory)).filter(name=>name.endsWith('.json')).sort();
    for(const name of files){
      try {const file=path.join(this.directory,name),info=await lstat(file),record=await this.read(name.slice(0,-5));
        if(libraries.length>=MAX_INSTALLED||bytes+info.size>MAX_TOTAL)fail('已安装库超过 20 个或 128 MiB，请先移除多余库');
        bytes+=info.size;libraries.push(record);
      } catch(error){errors.push({file:name,message:error.message});}
    }
    return {libraries,errors};
  }
  async summaries(){const {libraries,errors}=await this.list();return {libraries:libraries.map(({id,revision,library})=>({id,revision,name:library.name,description:library.description,folders:library.folders,items:library.items.map(({id,folderId,name,description,warnings})=>({id,folderId,name,description,warnings}))})),errors:errors.map(({message})=>({message}))};}
  exclusive(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
  async checkCapacity(content,replaceId=null){
    const files=(await readdir(this.directory)).filter(name=>name.endsWith('.json'));let bytes=Buffer.byteLength(content),count=1;
    for(const name of files)if(name!==`${replaceId}.json`){const info=await lstat(path.join(this.directory,name));bytes+=info.size;count++;}
    if(count>MAX_INSTALLED||bytes>MAX_TOTAL)fail('最多安装 20 个元件库，总大小不超过 128 MiB');
  }
  async write(library,sourcePath,replaceId=null,expectedRevision=null){
    validateLibrary(library,h);const content=JSON.stringify({format:'yuanda-library-install',version:1,sourcePath,library});
    if(Buffer.byteLength(content)>MAX_ENVELOPE)fail('托管库超过大小限制');await this.checkCapacity(content,replaceId);
    await atomicWrite(this.file(library.id),content,!!replaceId,async()=>{
      if(replaceId)this.checkRevision(await this.read(replaceId),expectedRevision);
      else {try{await lstat(this.file(library.id));}catch(error){if(error.code==='ENOENT')return;throw error;}fail('元件库编号已被占用，请重新加载','LIBRARY_REVISION_CONFLICT');}
    });return this.read(library.id);
  }
  create(options){return this.exclusive(async()=>{await this.ready();return this.write(createLibrary(options,h),null);});}
  install(sourcePath){return this.exclusive(async()=>{
    await this.ready();const library=await readLibraryFile(sourcePath);let nextId=library.id;
    for(;;){try{await lstat(this.file(nextId));nextId=randomUUID();}catch(error){if(error.code==='ENOENT')break;throw error;}}
    library.id=nextId;return this.write(library,path.resolve(sourcePath));
  });}
  checkRevision(record,expected){if(typeof expected!=='string'||expected!==record.revision)fail('元件库已变化，请刷新列表后重试','LIBRARY_REVISION_CONFLICT');}
  edit({id,expectedRevision,op}){return this.exclusive(async()=>{const record=await this.read(id);this.checkRevision(record,expectedRevision);const library=editLibrary(record.library,op,h);return this.write(library,record.sourcePath,id,expectedRevision);});}
  saveSelection({id,expectedRevision,project,...options}){return this.exclusive(async()=>{const record=await this.read(id);this.checkRevision(record,expectedRevision);const {item,warnings}=captureLibraryItem(project,options,h);const library=editLibrary(record.library,{type:'addItem',item},h);return {...await this.write(library,record.sourcePath,id,expectedRevision),warnings,itemId:item.id};});}
  remove({id,expectedRevision}){return this.exclusive(async()=>{const record=await this.read(id);this.checkRevision(record,expectedRevision);const archive=path.join(this.directory,'.archive');await mkdir(archive,{recursive:true});if((await lstat(archive)).isSymbolicLink())fail('库归档目录不能是符号链接');this.checkRevision(await this.read(id),expectedRevision);await rename(record.path,path.join(archive,`${id}-${randomUUID()}.json`));return {ok:true,id};});}
  async export({id,target}){const record=await this.read(id);const relative=path.relative(this.directory,path.resolve(target));if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))fail('请选择元件库托管目录之外的位置导出');await mkdir(path.dirname(target),{recursive:true});await atomicWrite(target,JSON.stringify(record.library),true);return {ok:true,path:target};}
}
