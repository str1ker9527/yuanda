import { electronExecutable } from './platform-runtime.mjs';
/** Own hidden Electron windows: production editor controls, local Agent and exported native inputs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), output=path.join(root,'.local','form-ui'), report=path.join(output,'result.json');
await mkdir(output,{recursive:true});
if(!process.versions.electron){
  const {spawn}=await import('node:child_process');await mkdir(path.join(root,'.local','tmp'),{recursive:true});
  const child=spawn(electronExecutable(root),[fileURLToPath(import.meta.url)],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,TEMP:path.join(root,'.local','tmp'),TMP: path.join(root,'.local','tmp'), TMPDIR: path.join(root,'.local','tmp')}});
  const timer=setTimeout(()=>{child.kill();console.error('表单验证超过80秒');},80000);
  child.on('error',error=>{clearTimeout(timer);console.error(error);process.exitCode=1;});
  child.on('exit',async code=>{clearTimeout(timer);try{console.log(await readFile(report,'utf8'));}catch{}process.exitCode=typeof code==='number'?code:1;});
}else{
  const {app,BrowserWindow,ipcMain}=await import('electron');
  app.setPath('userData',path.join(output,'profile'));app.setPath('sessionData',path.join(output,'browser'));app.setPath('logs',path.join(output,'logs'));
  const checks=[],errors=[];let server;
  void run().catch(async error=>{await server?.close();await writeFile(report,JSON.stringify({ok:false,checks,errors,fatal:error.stack},null,2));app.exit(1);});
  async function run(){
    const {createBlankProject,makeNode,DocumentEngine}=await import('../app/core/document.mjs');
    const {exportHtml}=await import('../app/core/html-export.mjs'),{startAgentServer}=await import('../app/agent-server.mjs'),{schema}=await import('../app/agent-schema.mjs');
    const project=createBlankProject('表单设置验收'),page=project.pages[0];page.id='form-page';page.width=950;page.height=950;
    const add=(type,id,x,y,extra={})=>page.nodes.push(makeNode(type,{id,name:id,x,y,width:260,height:38,...extra}));
    add('input','editor-input',40,40,{text:'在编辑器配置此控件'});
    add('input','limited',40,100,{text:'最多5个字符',maxLength:5});
    add('textarea','multi',40,160,{text:'最多8个字符',maxLength:8,height:80});
    add('input','readonly',40,270,{value:'可选中复制',readOnly:true});
    add('input','disabled',40,330,{value:'禁用内容',disabled:true});
    add('input','zero',40,390,{text:'不允许输入',maxLength:0});
    ['text','password','number','email','date','tel','url','search'].forEach((inputType,index)=>add('input','type-'+inputType,380,40+index*65,{inputType,text:inputType,value:inputType==='date'?'2026-10-15':''}));
    add('button','set-readonly',40,450,{text:'交互给只读框设值',interactions:[{event:'click',actions:[{type:'setValue',targetId:'readonly',value:'交互可以设值'}]}]});
    const engine=new DocumentEngine(project);let selection={pageId:page.id,nodeIds:[]},editor;
    const state=()=>({project:engine.getSnapshot(),revision:engine.revision,canUndo:engine.canUndo,canRedo:engine.canRedo,dirty:false,selection,agent:{enabled:true,port:0,connectionFile:''},appVersion:'form-test'});
    const emit=()=>{const value=state();editor?.webContents.send('yuanda:state',value);return value;};
    const apply=body=>{engine.apply(body.commands,{expectedRevision:body.expectedRevision,label:body.label});return emit();};
    const handlers={getState:state,getSchema:()=>schema,getAgentInfo:()=>state().agent,setSelection:value=>{selection=value;},command:apply,undo:()=>{engine.undo();return emit();},redo:()=>{engine.redo();return emit();}};
    for(const[name,fn]of Object.entries(handlers))ipcMain.handle('yuanda:'+name,async(_event,...args)=>{try{return{ok:true,value:await fn(...args)}}catch(error){return{ok:false,error:{message:error.message,code:error.code}}}});
    await app.whenReady();
    const prefs={sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,offscreen:true};
    editor=new BrowserWindow({width:1480,height:1040,show:false,autoHideMenuBar:true,webPreferences:{...prefs,preload:path.join(root,'app/preload.cjs')}});
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async(fn,label)=>{for(let n=0;n<100;n++){if(await fn())return;await delay(25);}throw new Error('等待超时：'+label);};
    const js=(win,code)=>win.webContents.executeJavaScript(code);
    const observe=win=>win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});observe(editor);
    const click=async(win,selector)=>{const point=await js(win,`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('目标不存在');n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);assert(await js(win,`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`),'目标被遮挡 '+selector);win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await delay(80);};
    const key=async(win,keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(50);};
    const type=async(win,selector,value)=>{await click(win,selector);await key(win,'A',['control']);await win.webContents.insertText(value);await delay(70);};
    const check=async(name,fn)=>{try{await fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.stack});}};
    const node=id=>engine.getSnapshot().pages[0].nodes.find(item=>item.id===id),sel=id=>`[data-node-id="${id}"]${id === "set-readonly" ? "" : " >.yuanda-native-control"}`;
    await editor.loadFile(path.join(root,'app/renderer/index.html'));editor.webContents.focus();await wait(()=>js(editor,'!!window.YuandaTools && !!window.YuandaEditor?.getState()'),'编辑器载入');await delay(200);
    await js(editor,"window.YuandaDock.show('styles')");
    await check('editor-configures-type-length-readonly-and-undo',async()=>{
      await click(editor,'#nodes .design-node[data-node-id="editor-input"]');await wait(()=>js(editor,"!!document.querySelector('[data-form-field=inputType]')"),'表单属性');
      await click(editor,'[data-form-field=inputType]');await key(editor,'Home');await key(editor,'Down');await key(editor,'Return');await wait(()=>node('editor-input').inputType==='password','密码类型');
      await type(editor,'[data-form-field=maxLength]','7');await key(editor,'Tab');await wait(()=>node('editor-input').maxLength===7,'长度设置');
      await click(editor,'[data-form-field=readOnly]');await wait(()=>node('editor-input').readOnly,'只读设置');await click(editor,'#undo');await wait(()=>!node('editor-input').readOnly,'只读撤销');await click(editor,'#redo');await wait(()=>node('editor-input').readOnly,'只读重做');
    });
    const connectionFile=path.join(output,'connection.json');server=await startAgentServer({connectionFile,getState:state,command:apply,undo:handlers.undo,redo:handlers.redo});
    const connection=JSON.parse(await readFile(connectionFile,'utf8')),headers={Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'};
    await check('agent-updates-editor-and-file-roundtrip',async()=>{
      const response=await fetch(connection.url+'/v1/commands',{method:'POST',headers,body:JSON.stringify({expectedRevision:engine.revision,commands:[{type:'updateNode',pageId:page.id,nodeId:'editor-input',patch:{readOnly:false,maxLength:6}}]})});assert.equal(response.status,200);await wait(()=>js(editor,"document.querySelector('[data-form-field=maxLength]')?.value==='6'"),'Agent字段同步界面');
      const saved=path.join(output,'forms.yuanda'),snapshot=engine.getSnapshot();await writeFile(saved,JSON.stringify(snapshot,null,2));const reopened=new DocumentEngine(JSON.parse(await readFile(saved,'utf8')));assert.deepEqual(reopened.getSnapshot(),snapshot);
    });
    await writeFile(path.join(output,'editor.png'),(await editor.webContents.capturePage()).toPNG());
    const file=path.join(output,'forms.html');await writeFile(file,exportHtml(engine.getSnapshot()));const preview=new BrowserWindow({width:1200,height:1100,show:false,webPreferences:prefs});observe(preview);await preview.loadFile(file);preview.webContents.focus();await delay(150);
    const value=id=>js(preview,`document.querySelector('${sel(id)}').value`);
    await check('native-input-and-textarea-length-limits',async()=>{await type(preview,sel('limited'),'123456789');assert.equal(await value('limited'),'12345');await type(preview,sel('multi'),'ab\n123456789');assert.equal(await value('multi'),'ab\n12345');await click(preview,sel('zero'));await preview.webContents.insertText('不能输入');assert.equal(await value('zero'),'');await type(preview,sel('editor-input'),'abcdefghijk');assert.equal(await value('editor-input'),'abcdef');assert.equal(await js(preview,`document.querySelector('${sel('editor-input')}').type`),'password');});
    await check('readonly-focus-copy-versus-disabled-and-programmatic-value',async()=>{await click(preview,sel('readonly'));await key(preview,'A',['control']);assert.equal(await js(preview,`document.activeElement===document.querySelector('${sel('readonly')}')`),true);assert.equal(await js(preview,`document.activeElement.selectionEnd-document.activeElement.selectionStart`),'可选中复制'.length);await preview.webContents.insertText('不应出现');assert.equal(await value('readonly'),'可选中复制');await click(preview,sel('disabled'));assert.equal(await js(preview,`document.activeElement===document.querySelector('${sel('disabled')}')`),false);await preview.webContents.insertText('不应出现');assert.equal(await value('disabled'),'禁用内容');await click(preview,sel('set-readonly'));await wait(async()=>await value('readonly')==='交互可以设值','交互设置只读值');});
    await check('native-types-number-email-date-and-password',async()=>{
      for(const inputType of ['text','password','number','email','date','tel','url','search'])assert.equal(await js(preview,`document.querySelector('${sel('type-'+inputType)}').type`),inputType);
      await click(preview,sel('type-number'));await preview.webContents.insertText('abc');assert.equal(await value('type-number'),'');await preview.webContents.insertText('12.5');assert.equal(await value('type-number'),'12.5');
      await type(preview,sel('type-email'),'not-an-email');assert.equal(await js(preview,`document.querySelector('${sel('type-email')}').validity.typeMismatch`),true);await type(preview,sel('type-email'),'test@example.com');assert.equal(await js(preview,`document.querySelector('${sel('type-email')}').validity.typeMismatch`),false);assert.equal(await value('type-date'),'2026-10-15');
    });
    await writeFile(path.join(output,'preview.png'),(await preview.webContents.capturePage()).toPNG());
    const result={ok:checks.every(item=>item.ok)&&!errors.length,checks,errors,coverage:'隐藏真实Electron窗口；编辑器控件/浏览器输入为真实鼠标键盘，面板导航用布局API；本机Agent真实HTTP；文件由共享引擎快照写入并重新载入，不宣称点击原生保存对话框。'};
    await writeFile(report,JSON.stringify(result,null,2));await server.close();server=null;preview.destroy();editor.destroy();app.exit(result.ok?0:1);
  }
}
