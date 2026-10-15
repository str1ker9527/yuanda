import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,readdir,access,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {LibraryStore} from '../app/library-store.mjs';
import {createBlankProject,makeNode,DocumentEngine} from '../app/core/document.mjs';
import {startAgentServer} from '../app/agent-server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','.local/library-store-tests');
async function fixture(){await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'run-'));return {dir,store:new LibraryStore(path.join(dir,'libraries'))};}
const options={name:'我的库',description:'本地文件测试'};

test('库创建与版本检查跨重启持久化，并发旧版本仅一个能写入',async()=>{
  const {store}=await fixture(),record=await store.create(options);assert.match(record.revision,/^[a-f0-9]{64}$/);
  const writes=await Promise.allSettled(['一','二'].map(name=>store.edit({id:record.id,expectedRevision:record.revision,op:{type:'updateLibrary',patch:{name}}})));
  assert.equal(writes.filter(value=>value.status==='fulfilled').length,1);assert.equal(writes.find(value=>value.status==='rejected').reason.code,'LIBRARY_REVISION_CONFLICT');
  const reopened=await new LibraryStore(store.directory).read(record.id);assert.equal(reopened.library.name,'一');assert.notEqual(reopened.revision,record.revision);await access(`${record.path}.bak`);
});
test('导入生成托管副本，同ID重复导入不覆盖，导出可交换且移除不删源文件',async()=>{
  const {dir,store}=await fixture(),record=await store.create(options),source=path.join(dir,'shared.yuandalib');await store.export({id:record.id,target:source});const original=await readFile(source,'utf8');
  const loaded=await store.install(source);assert.notEqual(loaded.id,record.id);assert.equal(loaded.sourcePath,source);const edited=await store.edit({id:loaded.id,expectedRevision:loaded.revision,op:{type:'updateLibrary',patch:{description:'只修改副本'}}});
  assert.equal(await readFile(source,'utf8'),original);await store.remove({id:loaded.id,expectedRevision:edited.revision});assert.equal((await store.list()).libraries.length,1);assert.equal((await readdir(path.join(store.directory,'.archive'))).length,1);assert.equal(await readFile(source,'utf8'),original);
});
test('磁盘库内容变化使旧版本写入失败，非法文件隔离而好库可用',async()=>{
  const {store}=await fixture(),record=await store.create(options),envelope=JSON.parse(await readFile(record.path,'utf8'));envelope.library.name='外部更新';await writeFile(record.path,JSON.stringify(envelope));
  await assert.rejects(store.edit({id:record.id,expectedRevision:record.revision,op:{type:'updateLibrary',patch:{name:'旧覆盖'}}}),{code:'LIBRARY_REVISION_CONFLICT'});
  await writeFile(path.join(store.directory,'broken.json'),'{');const list=await store.list();assert.equal(list.libraries.length,1);assert.equal(list.libraries[0].library.name,'外部更新');assert.equal(list.errors.length,1);
  await assert.rejects(store.read('../outside'));await assert.rejects(store.remove({id:'../outside',expectedRevision:record.revision}));
});
test('保存选区、导出重载、库插入走一笔可撤销事务，失败捕获不改库',async()=>{
  const {dir,store}=await fixture(),record=await store.create(options),project=createBlankProject('来源'),page=project.pages[0];page.nodes.push(makeNode('button',{id:'reusable',text:'已复用'}));const before=structuredClone(project);
  const saved=await store.saveSelection({id:record.id,expectedRevision:record.revision,project,pageId:page.id,nodeIds:['reusable'],name:'按钮',description:''});assert.deepEqual(project,before);assert.equal(saved.library.items.length,1);
  const file=path.join(dir,'roundtrip.yuandalib');await store.export({id:saved.id,target:file});const loaded=await store.install(file);assert.deepEqual(loaded.library.items,saved.library.items);
  const target=new DocumentEngine(createBlankProject()),initial=target.getSnapshot();target.apply([{type:'insertLibraryItem',pageId:initial.pages[0].id,item:loaded.library.items[0],conflictPolicy:'copy'}]);assert.equal(target.getSnapshot().pages[0].nodes[0].text,'已复用');target.undo();assert.deepEqual(target.getSnapshot(),initial);
  await assert.rejects(store.saveSelection({id:saved.id,expectedRevision:saved.revision,project,pageId:page.id,nodeIds:['missing'],name:'坏',description:''}));assert.equal((await store.read(saved.id)).revision,saved.revision);
});
test('一个损坏的大文件不会隐藏随后正常的库',async()=>{
  const {store}=await fixture(),record=await store.create(options),bad=await open(path.join(store.directory,'000-oversized.json'),'w');try{await bad.truncate(129*1024*1024);}finally{await bad.close();}
  const list=await store.list();assert.equal(list.errors.length,1);assert.deepEqual(list.libraries.map(value=>value.id),[record.id]);
});
test('写临时文件期间磁盘库更新，提交前复核阻止旧快照覆盖',async()=>{
  const {store}=await fixture(),record=await store.create(options),originalCheck=store.checkCapacity.bind(store);
  store.checkCapacity=async(...args)=>{await originalCheck(...args);const envelope=JSON.parse(await readFile(record.path,'utf8'));envelope.library.name='写入期间的外部更新';await writeFile(record.path,JSON.stringify(envelope));};
  await assert.rejects(store.edit({id:record.id,expectedRevision:record.revision,op:{type:'updateLibrary',patch:{name:'过时界面'}}}),{code:'LIBRARY_REVISION_CONFLICT'});
  assert.equal((await store.read(record.id)).library.name,'写入期间的外部更新');assert.equal((await readdir(store.directory)).some(name=>name.endsWith('.tmp')),false);
});
test('托管数量有界，无效导入和导出托管文件拒绝且原库不改',async()=>{
  const {dir,store}=await fixture(),record=await store.create(options);for(let i=1;i<20;i++)await store.create({name:`库${i}`});await assert.rejects(store.create({name:'超过数量'}));assert.equal((await store.list()).libraries.length,20);
  const invalid=path.join(dir,'bad.yuandalib');await writeFile(invalid,JSON.stringify({format:'rplib'}));await assert.rejects(store.install(invalid));await assert.rejects(store.export({id:record.id,target:record.path}));assert.equal((await store.read(record.id)).revision,record.revision);
});
test('Agent可认证读取登记库并插入，网页与任意路径无法经库接口读取',async t=>{
  const {dir,store}=await fixture(),record=await store.create(options),project=createBlankProject();project.pages[0].nodes.push(makeNode('button',{id:'button'}));await store.saveSelection({id:record.id,expectedRevision:record.revision,project,pageId:project.pages[0].id,nodeIds:['button'],name:'按钮',description:''});
  const engine=new DocumentEngine(createBlankProject()),getState=()=>({project:engine.getSnapshot(),revision:engine.revision});
  const connectionFile=path.join(dir,'connection.json'),server=await startAgentServer({connectionFile,getState,command:body=>{engine.apply(body.commands,{expectedRevision:body.expectedRevision});return getState();},undo:()=>{},redo:()=>{},libraryList:()=>store.summaries(),libraryRead:async id=>{const {library,revision}=await store.read(id);return {library,revision};}});t.after(()=>server.close());
  const connection=JSON.parse(await readFile(connectionFile,'utf8'));
  async function request(route,{headers={},auth=true,body}={}){return new Promise((resolve,reject)=>{const req=http.request(connection.url+route,{method:body?'POST':'GET',headers:{...(auth?{Authorization:`Bearer ${connection.token}`}:{ }),'Content-Type':'application/json',...headers}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
  const list=await request('/v1/libraries');assert.equal(list.status,200);assert.equal(list.data.libraries[0].items[0].name,'按钮');assert.equal('path' in list.data.libraries[0],false);assert.equal('project' in list.data.libraries[0].items[0],false);
  const full=await request(`/v1/libraries/${record.id}`);assert.equal(full.status,200);assert.equal((await request('/v1/libraries',{auth:false})).status,401);assert.equal((await request('/v1/libraries',{headers:{Origin:'null'}})).status,403);
  const cli=fileURLToPath(new URL('../scripts/yuanda-agent.mjs',import.meta.url));
  const cliList=JSON.parse((await promisify(execFile)(process.execPath,[cli,'libraries','--connection',connectionFile],{windowsHide:true})).stdout);assert.equal(cliList.libraries[0].id,record.id);
  const cliRead=JSON.parse((await promisify(execFile)(process.execPath,[cli,'library',record.id,'--connection',connectionFile],{windowsHide:true})).stdout);assert.equal(cliRead.library.items.length,1);
  for(const route of ['/v1/libraries/..%2Foutside','/v1/libraries/foo?path=outside'])assert.equal((await request(route)).status,404);
  const result=await request('/v1/commands',{body:{expectedRevision:0,commands:[{type:'insertLibraryItem',pageId:engine.getSnapshot().pages[0].id,item:full.data.library.items[0],conflictPolicy:'copy'}]}});assert.equal(result.status,200);assert.equal(engine.getSnapshot().pages[0].nodes.length,1);
});
