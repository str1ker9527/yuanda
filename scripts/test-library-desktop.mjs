import { electronExecutable } from './platform-runtime.mjs';
/** Real production IPC and file transactions in an isolated app copy; dialogs return test paths. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'.local/library-desktop');
await mkdir(output,{recursive:true});
if(!process.versions.electron){
  const {spawn}=await import('node:child_process'),directory=await mkdtemp(path.join(output,'run-'));
  await cp(path.join(root,'app'),path.join(directory,'app'),{recursive:true});const main=path.join(directory,'app/main.mjs'),original=await readFile(main,'utf8');assert(original.includes('new BrowserWindow('));await writeFile(main,original.replaceAll('new BrowserWindow(','new globalThis.__LibraryWindow('));
  const temporary=path.join(root,'.local/tmp');await mkdir(temporary,{recursive:true});
  const code=await new Promise(resolve=>{const child=spawn(electronExecutable(root),[fileURLToPath(import.meta.url),'--test-root',directory],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,TEMP:temporary,TMP: temporary, TMPDIR: temporary}});const timer=setTimeout(()=>child.kill(),60000);child.once('error',error=>{clearTimeout(timer);console.error(error);resolve(1);});child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  const result=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8').catch(()=>'{"ok":false}'));await writeFile(path.join(output,'result.json'),JSON.stringify({...result,directory},null,2));console.log(JSON.stringify({ok:result.ok,checks:result.checks,error:result.error,evidence:path.join(output,'result.json')},null,2));process.exitCode=code===0&&result.ok?0:1;
}else{
  const directory=process.argv[process.argv.indexOf('--test-root')+1];assert(path.resolve(directory).startsWith(output+path.sep));
  const {app,BrowserWindow,dialog}=createRequire(import.meta.url)('electron');let window,openResult={canceled:true,filePaths:[]},saveResult={canceled:true},resolveOpen,holdOpen=false,messageCount=0;
  const checks=[],errors=[],delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await delay(25);}throw new Error('等待桌面操作超时');};
  globalThis.__LibraryWindow=class extends BrowserWindow{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true,backgroundThrottling:false}});window=this;this.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});}};
  dialog.showOpenDialog=async()=>holdOpen?new Promise(resolve=>resolveOpen=resolve):openResult;
  dialog.showSaveDialog=async()=>saveResult;dialog.showMessageBox=async()=>{messageCount++;return {response:2};};
  const js=code=>window.webContents.executeJavaScript(code),call=(name,body)=>js(`window.yuanda.${name}(${body===undefined?'':JSON.stringify(body)})`),state=()=>call('getState');
  const failure=async(name,body)=>{try{await call(name,body);}catch(error){return error.message;}throw new Error(`应拒绝 ${name}`);};
  async function check(name,fn){await fn();checks.push({name,ok:true});}
  async function run(){await import(pathToFileURL(path.join(directory,'app/main.mjs')).href);await wait(()=>window&&!window.webContents.isLoading()&&js('!!window.YuandaEditor?.getState()'));const start=await state();let record,loaded;const exported=path.join(directory,'exported.yuandalib');
    await check('create-capture-revision-and-document-isolation',async()=>{
      record=await call('libraryCreate',{name:'桌面库',description:'真实IPC'});const node=start.project.pages[0].nodes.find(node=>node.type==='text');
      assert.match(await failure('librarySaveSelection',{id:record.id,expectedRevision:record.revision,expectedProjectRevision:start.revision+1,pageId:start.project.pages[0].id,nodeIds:[node.id],name:'标题',description:''}),/项目已变化/);
      record=await call('librarySaveSelection',{id:record.id,expectedRevision:record.revision,expectedProjectRevision:start.revision,pageId:start.project.pages[0].id,nodeIds:[node.id],name:'标题',description:''});assert.equal(record.library.items.length,1);assert.deepEqual((await state()).project,start.project);assert.equal((await state()).revision,start.revision);
    });
    await check('cancel-open-and-export-no-side-effects',async()=>{assert.equal(await call('libraryLoad'),null);assert.equal(await call('libraryExport',{id:record.id}),null);assert.equal((await call('libraryList')).libraries.length,1);assert.equal((await state()).revision,start.revision);});
    await check('file-window-blocks-project-and-library-writes-and-close',async()=>{
      holdOpen=true;const pending=call('libraryLoad');await wait(()=>!!resolveOpen);
      assert.match(await failure('command',{expectedRevision:start.revision,commands:[{type:'renameProject',name:'不得写入'}]}),/文件窗口/);
      assert.match(await failure('libraryCreate',{name:'不得新建'}),/当前文件窗口/);window.close();await delay(80);assert.equal(window.isDestroyed(),false);assert.equal(messageCount,0);
      resolveOpen({canceled:true,filePaths:[]});assert.equal(await pending,null);holdOpen=false;assert.equal((await state()).revision,start.revision);
    });
    await check('export-load-edit-and-remove-preserve-source',async()=>{
      saveResult={canceled:false,filePath:exported};assert.equal((await call('libraryExport',{id:record.id})).path,exported);const bytes=await readFile(exported,'utf8');openResult={canceled:false,filePaths:[exported]};loaded=await call('libraryLoad');assert.notEqual(loaded.id,record.id);
      loaded=await call('libraryEdit',{id:loaded.id,expectedRevision:loaded.revision,op:{type:'updateLibrary',patch:{name:'托管副本'}}});assert.equal(await readFile(exported,'utf8'),bytes);
      await call('libraryRemove',{id:loaded.id,expectedRevision:loaded.revision});assert.equal(await readFile(exported,'utf8'),bytes);assert.equal((await call('libraryList')).libraries.length,1);
    });
    await check('insert-library-through-live-agent-and-undo',async()=>{
      const connection=JSON.parse(await readFile(start.agent.connectionFile,'utf8')),headers={Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'};
      const list=await (await fetch(connection.url+'/v1/libraries',{headers})).json();assert.equal(list.libraries[0].items.length,1);const full=await (await fetch(connection.url+`/v1/libraries/${record.id}`,{headers})).json();assert.equal(full.library.items[0].name,'标题');
      const response=await fetch(connection.url+'/v1/commands',{method:'POST',headers,body:JSON.stringify({expectedRevision:start.revision,commands:[{type:'insertLibraryItem',pageId:start.project.pages[0].id,item:full.library.items[0],conflictPolicy:'copy'}]})});assert.equal(response.status,200);assert.equal((await state()).project.pages[0].nodes.length,start.project.pages[0].nodes.length+1);await call('undo');assert.deepEqual((await state()).project,start.project);
    });
    await check('library-dialog-visible-and-invalid-file-isolated',async()=>{
      const invalid=path.join(directory,'invalid.yuandalib');await writeFile(invalid,'not-json');openResult={canceled:false,filePaths:[invalid]};await failure('libraryLoad');assert.equal((await call('libraryList')).libraries.length,1);
      await js('window.YuandaLibrary.open()');assert.equal(await js('document.querySelector("#library-manager").open'),true);await writeFile(path.join(directory,'library-manager.png'),(await window.webContents.capturePage()).toPNG());
    });
  }
  void run().then(()=>finish(!errors.length)).catch(error=>finish(false,error));
  async function finish(ok,error){if(!ok&&window)await writeFile(path.join(directory,'failure.png'),(await window.webContents.capturePage()).toPNG()).catch(()=>{});await writeFile(path.join(directory,'result.json'),JSON.stringify({ok,checks,errors,error:error?.stack,coverage:'生产应用副本只替换隐藏窗口构造；真实IPC、AgentHTTP、库磁盘、撤销、关闭阻挡。文件对话框返回预设路径/取消结果，不代表手工操作原生文件对话框。'},null,2));app.exit(ok?0:1);}
}
