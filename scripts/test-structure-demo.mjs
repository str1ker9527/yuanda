import { electronExecutable } from './platform-runtime.mjs';
/** User walkthrough HTML, using only real Electron mouse/keyboard input for actions. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.local','structure-demo-ui'),report=path.join(output,'result.json');
await mkdir(output,{recursive:true});
if(!process.versions.electron){
  const {spawn}=await import('node:child_process');
  const temporary=path.join(root,'.local','tmp');await mkdir(temporary,{recursive:true});
  const child=spawn(electronExecutable(root),[fileURLToPath(import.meta.url)],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,TEMP:temporary,TMP: temporary, TMPDIR: temporary}});
  const timer=setTimeout(()=>{child.kill();console.error('试玩样本验证超过60秒');},60000);
  child.on('error',error=>{clearTimeout(timer);console.error(error);process.exitCode=1;});
  child.on('exit',async code=>{clearTimeout(timer);try{console.log(await readFile(report,'utf8'));}catch{}process.exitCode=typeof code==='number'?code:1;});
}else{
  const {app,BrowserWindow}=await import('electron');
  app.setPath('userData',path.join(output,'profile'));app.setPath('sessionData',path.join(output,'browser'));app.setPath('logs',path.join(output,'logs'));
  const checks=[],errors=[];let win;
  void run().catch(async error=>{await writeFile(report,JSON.stringify({ok:false,checks,errors,fatal:error.stack},null,2));win?.destroy();app.exit(1);});
  async function run(){
    await app.whenReady();
    win=new BrowserWindow({width:1180,height:1100,show:false,autoHideMenuBar:true,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
    win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),js=code=>win.webContents.executeJavaScript(code);
    const node=id=>`[data-node-id="${id}"]`,visible=node('task-list')+' > .repeater-content > .repeater-item:not([hidden])';
    const local=id=>visible+' '+node(id),text=selector=>js(`document.querySelector(${JSON.stringify(selector)}).textContent`);
    const click=async selector=>{const point=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('目标不存在');n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);assert(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`),'点击目标被遮挡 '+selector);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});await delay(80);};
    const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(30);};
    const type=async(selector,value)=>{await click(selector);await key('A',['control']);await win.webContents.insertText(value);await delay(60);};
    const count=()=>js(`document.querySelectorAll(${JSON.stringify(visible)}).length`);
    const stats=()=>text(node('page-stats'));
    const screenshot=async name=>{await writeFile(path.join(output,name),(await win.webContents.capturePage()).toPNG());};
    const check=async(name,work)=>{try{await work();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.stack});throw error;}};
    await win.loadFile(path.join(root,'exports','层级与分页体验.html'));win.webContents.focus();await delay(120);
    await check('walkthrough-input-mark-and-page-return',async()=>{
      assert.equal(await count(),3);assert.equal(await stats(),'第 1 / 3 页   ·   8 条   ·   已标记 0 条');
      await type(local('task-note'),'首行备注：翻页后保留');await click(local('task-mark')+' input');
      await click(node('page-next'));assert.equal(await text(local('task-title')),'整理组件');
      assert.equal(await js(`document.querySelector(${JSON.stringify(local('task-note')+' > .yuanda-native-control')}).value`),'');
      await type(local('task-note'),'第二页的独立备注');await click(node('page-prev'));
      assert.equal(await text(local('task-title')),'整理需求');assert.equal(await js(`document.querySelector(${JSON.stringify(local('task-note')+' > .yuanda-native-control')}).value`),'首行备注：翻页后保留');
      assert.equal(await js(`document.querySelector(${JSON.stringify(local('task-mark')+' input')}).checked`),true);
      assert.equal(await stats(),'第 1 / 3 页   ·   8 条   ·   已标记 1 条');await screenshot('01-page-return.png');
    });
    await check('walkthrough-filter-clamps-and-retains-row-state',async()=>{
      await click(node('page-next'));await click(node('page-next'));assert.equal(await stats(),'第 3 / 3 页   ·   8 条   ·   已标记 1 条');
      await click(node('filter-priority'));assert.equal(await stats(),'第 1 / 1 页   ·   3 条   ·   已标记 1 条');
      assert.deepEqual(await js(`[...document.querySelectorAll(${JSON.stringify(local('task-title'))})].map(n=>n.textContent)`),['整理需求','加入交互','导入数据']);
      assert.equal(await js(`document.querySelector(${JSON.stringify(local('task-note')+' > .yuanda-native-control')}).value`),'首行备注：翻页后保留');await screenshot('02-filtered.png');
      await click(node('filter-clear'));assert.equal(await stats(),'第 1 / 3 页   ·   8 条   ·   已标记 1 条');
    });
    await check('walkthrough-deletes-hidden-mark-by-stable-row-id',async()=>{
      await click(node('page-next'));await click(node('delete-marked'));assert.equal(await stats(),'第 2 / 3 页   ·   7 条   ·   已标记 0 条');
      await click(node('page-prev'));assert.equal(await text(local('task-title')),'画出页面');
      assert.equal(await js(`document.querySelectorAll(${JSON.stringify(local('task-mark')+' input:checked')}).length`),0);await screenshot('03-deleted-mark.png');
    });
    await check('walkthrough-empty-list-and-page-boundaries',async()=>{
      for(let batch=0;batch<3;batch++){
        const rows=await count();assert(rows>0);
        for(let i=0;i<rows;i++)await click(`${visible}:nth-child(${i+1}) ${node('task-mark')} input`);
        await click(node('delete-marked'));
      }
      assert.equal(await count(),0);assert.equal(await stats(),'第 1 / 1 页   ·   0 条   ·   已标记 0 条');
      await click(node('page-next'));await click(node('page-prev'));await click(node('filter-priority'));await click(node('filter-clear'));
      assert.equal(await stats(),'第 1 / 1 页   ·   0 条   ·   已标记 0 条');await screenshot('04-empty.png');
    });
    const result={ok:checks.every(check=>check.ok)&&errors.length===0,checks,errors,source:'exports/层级与分页体验.html',coverage:'实际用户试玩导出文件；隐藏Electron鼠标键盘输入；只读取DOM作断言，未调用页面处理函数或修改数据。截图供人工目视核查。'};
    await writeFile(report,JSON.stringify(result,null,2));win.destroy();app.exit(result.ok?0:1);
  }
}
