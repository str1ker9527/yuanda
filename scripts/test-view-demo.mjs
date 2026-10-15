import { electronExecutable } from './platform-runtime.mjs';
/** Verify the delivered HTML with real mouse/keyboard input and window resizing. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.join(root,'.local/view-demo-ui');
await mkdir(base,{recursive:true});
if(!process.versions.electron){
  const {spawn}=await import('node:child_process'),temp=path.join(root,'.local/tmp');await mkdir(temp,{recursive:true});
  const child=spawn(electronExecutable(root),[fileURLToPath(import.meta.url)],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,TEMP:temp,TMP: temp, TMPDIR: temp}});
  const timer=setTimeout(()=>child.kill(),60000);child.on('error',error=>{clearTimeout(timer);console.error(error);process.exitCode=1;});child.on('exit',async code=>{clearTimeout(timer);try{console.log(await readFile(path.join(base,'result.json'),'utf8'));}catch{}process.exitCode=code??1;});
}else{
  const {app,BrowserWindow}=await import('electron'),directory=await mkdtemp(path.join(base,'run-'));app.setPath('userData',path.join(directory,'profile'));app.setPath('sessionData',path.join(directory,'browser'));app.setPath('logs',path.join(directory,'logs'));
  const checks=[],errors=[];let win;
  const finish=async fatal=>{const result={ok:!fatal&&errors.length===0,checks,errors,directory,source:'exports/自适应与母版体验.html',...(fatal?{fatal:fatal.stack}:{})};await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(path.join(base,'result.json'),JSON.stringify(result,null,2));win?.destroy();app.exit(result.ok?0:1);};
  void run().then(()=>finish()).catch(finish);
  async function run(){
    await app.whenReady();win=new BrowserWindow({width:1340,height:1000,show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
    const js=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(r=>setTimeout(r,ms)),selector=id=>`[data-node-id="${id}"]`;
    const click=async sel=>{const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);assert(await js(`document.querySelector(${JSON.stringify(sel)}).contains(document.elementFromPoint(${p.x},${p.y}))`),'点击目标被遮挡');for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,button:'left',clickCount:1});await delay(120);};
    const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(40);};
    const width=id=>js(`document.querySelector(${JSON.stringify(selector(id))}).getBoundingClientRect().width`),value=()=>js(`document.querySelector('[data-node-id="instance-card-input"] > .yuanda-native-control').value`),count=()=>js(`document.querySelector('[data-node-id="instance-card-count"]').textContent`);
    const screenshot=async name=>writeFile(path.join(directory,name),(await win.webContents.capturePage()).toPNG());
    const check=async(name,fn)=>{try{await fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.stack});throw error;}};
    await win.loadFile(path.join(root,'exports/自适应与母版体验.html'));win.webContents.focus();await delay(120);
    await check('desktop-input-and-component-action',async()=>{assert.equal(await width('instance-card-background'),1104);await click(selector('instance-card-input'));await win.webContents.insertText('切换布局后，这句话还在');await click(selector('instance-card-action'));await click(selector('instance-card-action'));assert.equal(await count(),'已点击 2 次');await screenshot('01-desktop.png');});
    await check('manual-view-action-retains-content-and-unplaces-extra-note',async()=>{await click(selector('show-phone'));assert.equal(await width('instance-card-background'),350);assert.equal(await value(),'切换布局后，这句话还在');assert.equal(await count(),'已点击 2 次');assert.equal(await js(`document.querySelector('[data-node-id="wide-note"]').hidden`),true);assert.match(await js(`document.querySelector('[data-node-id="view-change-log"]').textContent`),/手机布局/);await screenshot('02-phone.png');await click(selector('show-tablet'));assert.equal(await width('instance-card-background'),704);assert.equal(await js(`document.querySelector('[data-node-id="wide-note"]').hidden`),false);});
    await check('real-selector-auto-resize-and-return',async()=>{await click('#views');await key('Home');await key('Enter');assert.equal(await js(`document.querySelector('#views').value`),'auto');win.setSize(470,1000);await delay(200);assert.equal(await width('instance-card-background'),350);assert.equal(await value(),'切换布局后，这句话还在');assert.equal(await count(),'已点击 2 次');await screenshot('03-small-window.png');win.setSize(1340,1000);await delay(200);assert.equal(await width('instance-card-background'),1104);assert.equal(await value(),'切换布局后，这句话还在');});
  }
}
