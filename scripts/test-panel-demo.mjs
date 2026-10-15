import { electronExecutable } from './platform-runtime.mjs';
/** Panel walkthrough HTML, using only real Electron mouse/keyboard input for actions. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.local','panel-demo-ui'),report=path.join(output,'result.json');
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
    const node=id=>`[data-node-id="${id}"]`,visible=node('scroll-panel');
    const local=id=>visible+' '+node(id),text=selector=>js(`document.querySelector(${JSON.stringify(selector)}).textContent`);
    const click=async selector=>{const point=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('目标不存在');n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);assert(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`),'点击目标被遮挡 '+selector);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});await delay(80);};
    const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(30);};
    const type=async(selector,value)=>{await click(selector);await key('A',['control']);await win.webContents.insertText(value);await delay(60);};
    const count=()=>js(`document.querySelectorAll(${JSON.stringify(visible)}).length`);
    const stats=()=>text(node('page-stats'));
    const screenshot=async name=>{await writeFile(path.join(output,name),(await win.webContents.capturePage()).toPNG());};
    const check=async(name,work)=>{try{await work();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.stack});throw error;}};
    await win.loadFile(path.join(root,'exports','面板交互体验.html'));win.webContents.focus();await delay(120);
    const bounds=id=>js(`(()=>{const r=document.querySelector(${JSON.stringify(node(id))}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const move=async(selector,dx,dy)=>{const p=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});for(let i=1;i<=5;i++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(p.x+dx*i/5),y:Math.round(p.y+dy*i/5),button:'left'});await delay(25);}win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(p.x+dx),y:Math.round(p.y+dy),button:'left',clickCount:1});await delay(150);};
    await check('demo-drag-with-input-and-button-priority',async()=>{
      const before=await bounds('drag-card');await type(node('card-input'),'这句话保留在卡片里');await click(node('card-button'));assert.equal(await text(node('click-status')),'已点击 1 次');await move(node('card-title'),75,20);const after=await bounds('drag-card');assert(Math.abs(after.x-before.x-75)<2);assert(Math.abs(after.y-before.y-20)<2);assert.equal(await js('document.querySelector("[data-node-id=card-input] > .yuanda-native-control").value'),'这句话保留在卡片里');assert.match(await text(node('drag-status')),/拖动结束/);await screenshot('01-drag-card.png');
    });
    await check('demo-content-fit-switches-and-fixed-tip-dismisses',async()=>{
      const small=await bounds('fit-panel');await click(node('fit-detailed'));assert((await bounds('fit-panel')).height>small.height+100);await click(node('fit-compact'));assert.equal((await bounds('fit-panel')).height,small.height);await click(node('tip-close'));assert.equal(await js('document.querySelector("[data-node-id=fixed-tip]").hidden'),true);await click(node('pin-show'));assert.equal(await js('document.querySelector("[data-node-id=fixed-tip]").hidden'),false);await screenshot('02-content-and-pin.png');
    });
    await check('demo-native-scroll-events-and-browser-pin',async()=>{
      await js('document.querySelector("[data-node-id=scroll-panel]").scrollIntoView({block:"center"})');const rect=await bounds('scroll-panel'),p={x:Math.round(rect.x+160),y:Math.round(rect.y+120)};win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseWheel',...p,deltaY:-180,deltaX:-60,canScroll:true});await delay(250);assert.match(await text(node('scroll-status')),/当前滚动位置：/);assert(await js('document.querySelector("[data-state-id=scroll-state]").scrollTop')>0);const pin=await bounds('fixed-tip');win.webContents.sendInputEvent({type:'mouseMove',x:1120,y:300});win.webContents.sendInputEvent({type:'mouseWheel',x:1120,y:300,deltaY:-160,deltaX:0,canScroll:true});await delay(200);assert.deepEqual(await bounds('fixed-tip'),pin);assert(await js('window.scrollY')>0);await screenshot('03-scrolled.png');
    });
    const result={ok:checks.every(check=>check.ok)&&errors.length===0,checks,errors,source:'exports/面板交互体验.html',coverage:'实际用户试玩导出文件；隐藏Electron鼠标键盘输入；只读取DOM作断言，未调用页面处理函数或修改数据。截图供人工目视核查。'};
    await writeFile(report,JSON.stringify(result,null,2));win.destroy();app.exit(result.ok?0:1);
  }
}
