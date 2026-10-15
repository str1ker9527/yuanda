import { electronExecutable, releaseLayout } from './platform-runtime.mjs';
/** Isolated production-renderer docking acceptance with native Chromium input.
 * Dock/drop intermediate screenshots, immutable source-copy, no user profile/files.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,mkdtemp,writeFile,readFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {clipboardMarkerMock} from './clipboard-marker-mock.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'.local','docking-ui');await mkdir(out,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
if(!process.versions.electron){
  const {spawn}=await import('node:child_process'),directory=await mkdtemp(path.join(out,'run-')),info=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const sourceRoot=process.argv.includes('--dist')?releaseLayout(path.join(root,'dist','原搭-'+info.version)).app:root;
  await cp(path.join(sourceRoot,'app'),path.join(directory,'app'),{recursive:true});await cp(path.join(sourceRoot,'package.json'),path.join(directory,'package.json'));
  assert.match(await readFile(path.join(directory,'app/renderer/index.html'),'utf8'),/docking-enhancements\.css/,'Production HTML must include docking stylesheet.');
  const audited=['app/renderer/docking.js','app/renderer/docking-enhancements.css'],hashes=Object.fromEntries(await Promise.all(audited.map(async name=>[name,sha(await readFile(path.join(sourceRoot,name)))])));
  for(const name of audited)assert.equal(sha(await readFile(path.join(directory,name))),hashes[name]);
  await writeFile(path.join(directory,'provenance.json'),JSON.stringify({sourceRoot,testedVersion:info.version,hashes,kind:process.argv.includes('--dist')?'portable-resource-copy':'source-copy'},null,2));
  const code=await new Promise(resolve=>{const child=spawn(electronExecutable(root),[fileURLToPath(import.meta.url),'--output',directory],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,TEMP:directory,TMP: directory, TMPDIR: directory}});const timer=setTimeout(()=>child.kill(),110000);child.once('error',error=>{clearTimeout(timer);console.error(error);resolve(1)});child.once('exit',code=>{clearTimeout(timer);resolve(code??1)});});
  let result;try{result=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8'));}catch(error){result={ok:false,fatal:error.message};}
  result.sourceUnchanged=(await Promise.all(audited.map(async name=>sha(await readFile(path.join(sourceRoot,name)))===hashes[name]))).every(Boolean);
  result.copyUnchanged=(await Promise.all(audited.map(async name=>sha(await readFile(path.join(directory,name)))===hashes[name]))).every(Boolean);
  result.ok=result.ok===true&&code===0&&result.sourceUnchanged&&result.copyUnchanged;result.directory=directory;
  await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}else{
  void (async()=>{
    const directory=process.argv[process.argv.indexOf('--output')+1];assert(path.resolve(directory).startsWith(out+path.sep));
    const application=path.join(directory,'app'),{app,BrowserWindow,ipcMain}=await import('electron');
    const {DocumentEngine,createBlankProject,makeNode}=await import(pathToFileURL(path.join(application,'core/document.mjs')).href),{schema}=await import(pathToFileURL(path.join(application,'agent-schema.mjs')).href);
    app.setPath('userData',path.join(directory,'profile'));app.setPath('sessionData',path.join(directory,'browser'));app.setPath('logs',path.join(directory,'logs'));app.on('window-all-closed',()=>{});
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],errors=[];let win,engine,selection,current;
    const js=code=>win.webContents.executeJavaScript(code),state=()=>({project:engine.getSnapshot(),revision:engine.revision,selection,canUndo:engine.canUndo,canRedo:engine.canRedo,dirty:false,agent:{enabled:false},appVersion:'docking-test'}),emit=()=>{const value=state();win.webContents.send('yuanda:state',value);return value};
    for(const [name,fn]of Object.entries({...clipboardMarkerMock(state),getState:state,getSchema:()=>schema,getAgentInfo:()=>state().agent,setSelection:value=>{selection=value},command:body=>{engine.apply(body.commands,{expectedRevision:body.expectedRevision});return emit()},undo:()=>{engine.undo();return emit()},redo:()=>{engine.redo();return emit()}}))ipcMain.handle('yuanda:'+name,async(_,...args)=>{try{return{ok:true,value:await fn(...args)}}catch(error){return{ok:false,error:{message:error.message,code:error.code}}}});
    async function wait(fn,label){for(let i=0;i<150;i++){if(await fn())return;await sleep(20);}throw new Error('timeout '+label)}
    const layout=()=>js('YuandaDock.getLayout()');
    async function point(selector,fx=.5,fy=.5,hit=true){
      const p=await js('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');if(!el)throw new Error("missing target");const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width*'+fx+'),y:Math.round(r.y+r.height*'+fy+'),width:r.width,height:r.height,visible:!el.hidden&&r.width>0&&r.height>0}})()');
      assert(p.visible,'visible '+selector);if(hit)assert(await js('document.querySelector('+JSON.stringify(selector)+').contains(document.elementFromPoint('+p.x+','+p.y+'))'),'hit '+selector);return p;
    }
    function input(type,p){win.webContents.sendInputEvent({type,x:Math.round(p.x),y:Math.round(p.y),button:'left',clickCount:1})}
    async function click(selector){const p=await point(selector);input('mouseMove',p);input('mouseDown',p);input('mouseUp',p);await sleep(170)}
    async function key(keyCode,modifiers=[]){win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(['Enter','Return'].includes(keyCode)&&!modifiers.length)win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(60)}
    async function begin(selector,fx=.5,fy=.5){const p=await point(selector,fx,fy);input('mouseMove',p);input('mouseDown',p);await sleep(20);input('mouseMove',{x:p.x+8,y:p.y+8});await sleep(35);return p}
    async function move(p){input('mouseMove',p);await sleep(65)}
    async function drop(p){input('mouseUp',p);await sleep(180)}
    async function drag(selector,p){await begin(selector);await move(p);await drop(p)}
    async function capture(label){const file=path.join(directory,current.name+'-'+label+'.png');await writeFile(file,(await win.webContents.capturePage()).toPNG());(current.screenshots||=[]).push(file)}
    async function dragFloat(id,x=600,y=330){await drag('[data-panel-id="'+id+'"] .panel-header h2',{x,y});assert.equal((await layout()).panels[id].mode,'float')}
    async function reveal(selector){
      for(let i=0;i<8;i++){if(await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()'))return;
        const p=await point('#styles-panel-content');win.webContents.sendInputEvent({type:'mouseWheel',x:p.x,y:p.y,deltaX:0,deltaY:-400});await sleep(90);
      }throw new Error('cannot reveal '+selector);
    }
    const installTrace=()=>js('window.__dockTrace=[];for(const type of ["pointerdown","pointerup","keydown","input"])document.addEventListener(type,e=>__dockTrace.push({type,trusted:e.isTrusted,key:e.key||""}),true)');
    async function reload(){current.savedTrace=(current.savedTrace||[]).concat(await js('window.__dockTrace||[]'));await win.webContents.reload();await wait(()=>js('!!window.YuandaDock&&!!window.YuandaEditor.getState()'),'reload');await installTrace()}
    async function floatPair(){
      await dragFloat('library',630,400);
      const p=await point('.dock-floating-group',.5,.35);await begin('[data-panel-tab="components"]');await move(p);assert.equal(await js('document.querySelector("#dock-drop-marker").dataset.dropKind'),'float-merge');await capture('merge-preview');await drop(p);
      const value=await layout();assert.equal(value.panels.library.floatGroup,value.panels.components.floatGroup);return value.panels.library.floatGroup;
    }
    async function check(name,task){
      current={name,ok:false};checks.push(current);const project=createBlankProject('Docking UI');project.pages[0].id='home';project.pages[0].nodes=[makeNode('text',{id:'label',x:80,y:80,width:210,height:60,text:'Selection stays'})];engine=new DocumentEngine(project);selection={pageId:'home',nodeIds:[]};
      win=new BrowserWindow({width:1480,height:980,show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(application,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true,partition:'dock-'+Date.now()+'-'+checks.length}});
      win.webContents.on('console-message',(event,...args)=>{const level=event.level??args[0];if(level==='error'||level===3)errors.push({name,message:event.message??args[1]})});
      try{await win.loadFile(path.join(application,'renderer/index.html'));win.webContents.focus();await wait(()=>js('!!window.YuandaDock&&!!window.YuandaEditor.getState()&&!!document.querySelector(".library-widget")'),'renderer');await sleep(160);
        await installTrace();
        await task();current.ok=true;
      }catch(error){current.error=error.stack}finally{await capture('final');const trace=(current.savedTrace||[]).concat(await js('window.__dockTrace||[]').catch(()=>[]));delete current.savedTrace;current.trustedInput=trace.length>0&&trace.every(item=>item.trusted);current.inputCount=trace.length;win.destroy();win=null;}
    }
    await app.whenReady();
    await check('tab-reorder-preview-and-activation',async()=>{
      await click('[data-panel-tab="overview"]');assert.equal(await js('document.querySelector("[data-panel-id=overview]").hidden'),false);
      const before=await layout(),p=await point('[data-panel-tab="pages"]',.1,.5);await begin('[data-panel-tab="overview"]');await move(p);
      assert.equal(await js('document.querySelector(".dock-tab-insertion").hidden'),false);assert.deepEqual(await layout(),before);await capture('insertion-preview');await drop(p);
      assert.deepEqual(await js('Array.from(document.querySelectorAll("#dock-left-top>.dock-tabs>[data-panel-tab]"),x=>x.dataset.panelTab)'),['overview','pages']);
      await click('[data-panel-tab="pages"]');assert.equal((await layout()).active['left-top'],'pages');
    });
    await check('cross-rail-hot-zone-preview-does-not-mutate-until-drop',async()=>{
      const before=await layout(),p=await point('#dock-right-bottom');await begin('[data-panel-id="library"] .panel-header h2');await move(p);
      assert.deepEqual(await layout(),before);assert.equal(await js('document.querySelector("#dock-drop-marker").hidden'),false);assert.equal(await js('document.querySelectorAll(".dock-target").length'),12);await capture('hot-zone-preview');await drop(p);
      assert.equal((await layout()).panels.library.zone,'right-bottom');assert.equal((await layout()).panels.library.mode,'dock');assert.equal(await js('document.querySelector("[data-panel-id=library]").hidden'),false);
    });
    await check('top-and-bottom-split-are-explicit-and-preserve-other-tabs',async()=>{
      await begin('[data-panel-tab="overview"]');const p=await point('[data-dock-target="right-top:top"]',.5,.5,false);await move(p);assert.equal(await js('document.querySelector("#dock-drop-marker").textContent'),'上方独立停靠');await capture('split-preview');await drop(p);
      let value=await layout();assert.equal(value.panels.overview.zone,'right-top');assert.equal(value.panels.styles.zone,'right-bottom');assert.equal(value.panels.interactions.zone,'right-bottom');assert.equal(value.ratios.right,.5);
      await begin('[data-panel-tab="components"]');const q=await point('[data-dock-target="right-top:bottom"]',.5,.5,false);await move(q);await drop(q);value=await layout();assert.equal(value.panels.components.zone,'right-bottom');assert.equal(value.panels.overview.zone,'right-top');assert.equal(value.panels.notes.zone,'right-top');
    });
    await check('float-grab-offset-and-resize-match-the-preview',async()=>{
      const original=await js('(()=>{const r=document.querySelector("#dock-right-bottom").getBoundingClientRect();return{x:r.x,y:r.y}})()'),from=await begin('[data-panel-id="notes"] .panel-header',.25,.5),target={x:690,y:420};await move(target);
      const preview=await js('(()=>{const r=document.querySelector(".dock-drag-preview").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()');
      assert(Math.abs(preview.x-(target.x-(from.x-original.x)))<=2);assert(Math.abs(preview.y-(target.y-(from.y-original.y)))<=2);await capture('floating-preview');await drop(target);
      assert.equal((await layout()).panels.notes.mode,'float');const actual=await js('(()=>{const r=document.querySelector(".dock-floating-group").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()');assert.deepEqual(actual,preview);
      const size=(await layout()).panels.notes,p=await point('[data-panel-id=notes] .panel-resize-handle');await drag('[data-panel-id=notes] .panel-resize-handle',{x:p.x+40,y:p.y+35});assert((await layout()).panels.notes.width>size.width+30);
    });
    await check('floating-group-merge-and-whole-group-redock',async()=>{
      await floatPair();assert.equal(await js('document.querySelectorAll(".dock-floating-group>.dock-tabs>[data-panel-tab]").length'),2);
      const p=await point('#dock-right-bottom');await begin('[data-panel-id=components] .panel-header h2');await move(p);await capture('group-redock-preview');await drop(p);const value=await layout();for(const id of ['library','components']){assert.equal(value.panels[id].mode,'dock');assert.equal(value.panels[id].zone,'right-bottom');}
      assert.equal(await js('document.querySelectorAll(".dock-floating-group").length'),0);
    });
    await check('floating-tabs-reorder-and-detach-independently',async()=>{
      const group=await floatPair(),p=await point('[data-panel-tab=library]',.1,.5);await drag('[data-panel-tab=components]',p);
      assert.deepEqual(await js('Array.from(document.querySelectorAll(".dock-floating-group>.dock-tabs>[data-panel-tab]"),x=>x.dataset.panelTab)'),['components','library']);
      await drag('[data-panel-tab=library]',{x:960,y:630});const value=await layout();assert.equal(value.panels.components.floatGroup,group);assert.notEqual(value.panels.library.floatGroup,group);assert.equal(await js('document.querySelectorAll(".dock-floating-group").length'),2);
    });
    await check('floating-group-hide-reopen-and-reload-preserve-members',async()=>{
      const group=await floatPair();await click('[data-panel-id=components] [data-panel-hide]');assert.equal((await layout()).panels.components.hidden,true);assert.equal(await js('document.querySelector("[data-panel-id=library]").hidden'),false);
      await click('#panels-toggle');await click('[data-panel-menu=components]');assert.equal((await layout()).panels.components.hidden,false);assert.equal((await layout()).panels.components.floatGroup,group);assert.equal(await js('document.querySelector("[data-panel-id=components]").hidden'),false);
      const saved=await layout();await sleep(100);await reload();assert.deepEqual(await layout(),saved);assert.equal(await js('document.querySelectorAll(".dock-floating-group").length'),1);assert.equal(await js('document.querySelectorAll("[data-panel-id]").length'),7);
      await click('#panels-toggle');await key('Up');await key('Return');assert(Object.values((await layout()).panels).every(p=>p.mode==='dock'));assert.equal(await js('document.querySelectorAll(".dock-floating-group").length'),0);
    });
    await check('escape-cancels-drag-and-committed-drag-keeps-draft-focus-selection',async()=>{
      await click('#nodes [data-node-id=label]');await reveal('#inspector textarea');await click('#inspector textarea');await key('A',['control']);await win.webContents.insertText('尚未失焦的文字草稿');await key('Left',['shift']);await key('Left',['shift']);
      const focused=()=>js('({value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd,tag:document.activeElement.tagName})'),focus=await focused(),before=await layout(),revision=engine.revision,selected=structuredClone(selection);
      await begin('[data-panel-id=styles] .panel-header',.1,.5);const p={x:740,y:420};await move(p);await capture('cancel-preview');await key('Escape');await drop(p);
      assert.deepEqual(await layout(),before);assert.deepEqual(await focused(),focus);assert.equal(engine.revision,revision);assert.deepEqual(selection,selected);
      await begin('[data-panel-id=styles] .panel-header',.1,.5);await move(p);await drop(p);assert.equal((await layout()).panels.styles.mode,'float');assert.deepEqual(await focused(),focus);assert.equal(engine.revision,revision);assert.deepEqual(selection,selected);
    });
    await check('rail-split-float-size-persist-and-reset',async()=>{
      await dragFloat('notes',720,410);let p=await point('[data-panel-id=notes] .panel-resize-handle');await drag('[data-panel-id=notes] .panel-resize-handle',{x:p.x+25,y:p.y+20});
      p=await point('[data-rail-resizer=left]');await drag('[data-rail-resizer=left]',{x:p.x+35,y:p.y});p=await point('[data-splitter=left]');await drag('[data-splitter=left]',{x:p.x,y:p.y+50});
      const saved=await layout();assert(saved.widths.left>250);assert(saved.ratios.left>.50);await sleep(120);await reload();assert.deepEqual(await layout(),saved);
      await click('#panels-toggle');await click('#reset-workspace');const reset=await layout();assert.equal(reset.widths.left,228);assert.equal(reset.widths.right,280);assert.equal(reset.ratios.left,.48);assert(Object.values(reset.panels).every(p=>p.mode==='dock'&&!p.hidden));
    });
    await check('escape-resize-restores-layout-and-persisted-size',async()=>{
      const before=await layout(),p=await begin('[data-rail-resizer=left]');await move({x:p.x+70,y:p.y});assert.notEqual((await layout()).widths.left,before.widths.left);await key('Escape');await drop({x:p.x+70,y:p.y});assert.deepEqual(await layout(),before);
      await sleep(100);await reload();assert.deepEqual(await layout(),before);
    });
    const result={ok:checks.every(check=>check.ok&&check.trustedInput)&&!errors.length,checks,errors,boundary:'Production source-copy renderer, real native Chromium input in hidden Electron windows. Floating panes are groups inside the main window, not independent OS windows. Left/right each support two vertical regions. No live user document or user profile is used.'};await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));app.exit(result.ok?0:1);
  })().catch(async error=>{const {app}=await import('electron'),directory=process.argv[process.argv.indexOf('--output')+1];await writeFile(path.join(directory,'result.json'),JSON.stringify({ok:false,fatal:error.stack},null,2));app.exit(1)});
}
