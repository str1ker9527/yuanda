import { electronExecutable } from './platform-runtime.mjs';
/** Production workspace controls and trusted pointer/keyboard input in isolated Electron. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir,mkdtemp,readFile,writeFile } from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'.local/grid-guides-ui');await mkdir(output,{recursive:true});
if(!process.versions.electron){
  const {spawn}=await import('node:child_process'),directory=await mkdtemp(path.join(output,'run-')),env={...process.env,TEMP:directory,TMP: directory, TMPDIR: directory};delete env.ELECTRON_RUN_AS_NODE;
  const code=await new Promise(resolve=>{const child=spawn(electronExecutable(root),[fileURLToPath(import.meta.url),'--output',directory],{cwd:root,windowsHide:true,stdio:'inherit',env}),timer=setTimeout(()=>child.kill(),90000);child.once('error',()=>{clearTimeout(timer);resolve(1);});child.once('exit',code=>{clearTimeout(timer);resolve(code??1);});});
  let result;try{result=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8'));}catch(error){result={ok:false,error:error.message};}Object.assign(result,{directory,exitCode:code});result.ok&&=code===0;await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}else void(async()=>{
  const {app,BrowserWindow,ipcMain}=createRequire(import.meta.url)('electron'),directory=process.argv[process.argv.indexOf('--output')+1];
  app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',path.join(directory,'profile'));app.setPath('sessionData',path.join(directory,'session'));app.setPath('logs',path.join(directory,'logs'));
  let win;const checks=[],errors=[],screenshots=[];
  try{
    const {DocumentEngine,createBlankProject,makeNode}=await import('../app/core/document.mjs');
    const project=createBlankProject('网格与参考线验收');project.pages[0].id='guide-page';project.pages[0].width=900;project.pages[0].height=650;project.pages[0].nodes=[makeNode('rectangle',{id:'guide-card',x:80,y:80,width:160,height:100,text:'吸附测试'}),makeNode('rectangle',{id:'guide-target',x:350,y:200,width:180,height:120,text:'对齐目标'})];
    const engine=new DocumentEngine(project);engine.apply([{type:'addPage',page:{id:'guide-other',name:'另一页'}}]);
    let selection={pageId:'guide-page',nodeIds:[]};const getState=()=>({project:engine.getSnapshot(),revision:engine.revision,canUndo:engine.canUndo,canRedo:engine.canRedo,dirty:true,selection,agent:{enabled:false,requests:0},appVersion:'workspace-test'});
    const emit=()=>{const value=getState();win.webContents.send('yuanda:state',value);return value;};
    const api={getState,getSchema:()=>({commands:[]}),getAgentInfo:()=>({enabled:false}),setSelection:value=>{selection=value;},command:body=>{engine.apply(body.commands,{expectedRevision:body.expectedRevision});return emit();},undo:()=>{engine.undo();return emit();},redo:()=>{engine.redo();return emit();},libraryList:()=>({libraries:[],errors:[]})};
    for(const[name,fn]of Object.entries(api))ipcMain.handle('yuanda:'+name,async(_event,...args)=>{try{return {ok:true,value:await fn(...args)};}catch(error){return{ok:false,error:{message:error.message,code:error.code}};}});
    await app.whenReady();win=new BrowserWindow({width:1480,height:960,show:false,webPreferences:{preload:path.join(root,'app/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
    win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});await win.loadFile(path.join(root,'app/renderer/index.html'));win.webContents.focus();
    const js=script=>win.webContents.executeJavaScript(script),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const wait=async(fn,label)=>{for(let i=0;i<120;i++){if(await fn())return;await delay(25);}throw new Error('Timed out: '+label);};
    const check=async(name,fn)=>{await fn();checks.push(name);};
    const center=async selector=>js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('Missing '+${JSON.stringify(selector)});const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    const clickAt=async(point,count=1)=>{for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button:'left',clickCount:count});await delay(55);};
    const click=async(selector,count=1)=>clickAt(await center(selector),count);
    const drag=async(from,to)=>{win.webContents.sendInputEvent({type:'mouseMove',...from});win.webContents.sendInputEvent({type:'mouseDown',...from,button:'left',clickCount:1});for(let step=1;step<=8;step++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x+(to.x-from.x)*step/8),y:Math.round(from.y+(to.y-from.y)*step/8),button:'left'});await delay(12);}win.webContents.sendInputEvent({type:'mouseUp',...to,button:'left',clickCount:1});await delay(100);};
    const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(50);};
    const boardPoint=async(x,y)=>js(`(()=>{const r=document.querySelector('#board').getBoundingClientRect(),z=YuandaEditor.getZoom();return{x:Math.round(r.left+${x}*z),y:Math.round(r.top+${y}*z)}})()`);
    const page=()=>engine.getSnapshot().pages[0];
    await wait(()=>js('Boolean(window.YuandaWorkspace&&window.YuandaEditor.getState())'),'workspace ready');
    await js("YuandaWorkspace.setPreferences({grid:false,guides:true,lockGuides:false,gridSize:10,snapGrid:true,snapGuides:true,snapWidgets:true,snapping:true,rulers:true});YuandaEditor.setZoom(.75);window.__guideTrusted=[];for(const type of ['pointerdown','pointerup','keydown'])document.addEventListener(type,event=>__guideTrusted.push(event.isTrusted),true);void 0");await delay(100);
    await check('grid-controls-display-color-style-and-independent-snapping',async()=>{
      await js("YuandaWorkspace.dialog('grid');void 0");
      await click('#workspace-dialog [data-workspace-preference="grid"]');assert.equal(await js('YuandaWorkspace.preferences().grid'),true);
      await click('#workspace-dialog [data-workspace-preference="snapGrid"]');assert.equal(await js('YuandaWorkspace.preferences().snapGrid'),false);
      await click('#workspace-dialog [data-workspace-preference="gridSize"]');await key('A',['control']);await win.webContents.insertText('20');await key('Tab');
      assert.equal(await js('YuandaWorkspace.preferences().gridSize'),20);
      await js("YuandaWorkspace.setPreferences({gridStyle:'lines',gridColor:'#123456'});document.querySelector('#workspace-dialog').close();void 0");await delay(60);
      assert.match(await js("getComputedStyle(document.querySelector('#board')).backgroundImage"),/linear-gradient/);
      assert.equal(await js("document.querySelector('#board').style.getPropertyValue('--grid-color')"),'#123456');
      await js("YuandaWorkspace.setPreferences({gridStyle:'dots'});void 0");assert.match(await js("getComputedStyle(document.querySelector('#board')).backgroundImage"),/radial-gradient/);
    });
    await check('ruler-drags-create-precise-page-guides-at-scaled-coordinates',async()=>{
      await drag(await center('#ruler-x'),await boardPoint(500,112));await wait(()=>page().guides.horizontal.length===1,'horizontal guide');assert.ok(Math.abs(page().guides.horizontal[0]-112)<2);
      await drag(await center('#ruler-y'),await boardPoint(240,360));await wait(()=>page().guides.vertical.length===1,'vertical guide');assert.ok(Math.abs(page().guides.vertical[0]-240)<2);
    });
    await check('guide-double-click-edits-and-delete-is-undoable',async()=>{
      const pos=page().guides.horizontal[0],selector=`.canvas-guide.horizontal[data-position="${pos}"]`;await click(selector,1);await click(selector,2);
      await wait(()=>js("Boolean(document.querySelector('#workspace-dialog input[type=number]'))"),'guide position dialog');
      await click('#workspace-dialog input[type=number]');await key('A',['control']);await win.webContents.insertText('137.5');await key('Tab');
      await click('#workspace-dialog .workspace-dialog-body>button');await wait(()=>page().guides.horizontal.includes(137.5),'precise guide position');
      await click('.canvas-guide.horizontal[data-position="137.5"]');await key('Delete');await wait(()=>page().guides.horizontal.length===0,'delete selected guide');
      api.undo();await wait(()=>page().guides.horizontal.includes(137.5),'undo guide deletion');
    });
    await check('guide-lock-blocks-drag-delete-and-clear',async()=>{
      await js('YuandaWorkspace.setPreferences({lockGuides:true});void 0');const before=structuredClone(page().guides);
      await drag(await center('.canvas-guide.horizontal'),await boardPoint(400,230));await click('.canvas-guide.horizontal');await key('Delete');assert.deepEqual(page().guides,before);
      assert.equal(await js('YuandaWorkspace.clearGuides()'),false);assert.deepEqual(page().guides,before);await js('YuandaWorkspace.setPreferences({lockGuides:false});void 0');
    });
    await check('drag-back-to-ruler-deletes-but-outside-drop-cancels',async()=>{
      const before=structuredClone(page().guides);await drag(await center('.canvas-guide.horizontal'),{x:10,y:10});assert.deepEqual(page().guides,before);
      await drag(await center('.canvas-guide.horizontal'),await center('#ruler-x'));await wait(()=>page().guides.horizontal.length===0,'drag back deletion');api.undo();await delay(80);
    });
    await check('guides-follow-zoom-scroll-and-cancel-on-page-change',async()=>{
      await js("YuandaEditor.setZoom(1.4);document.querySelector('#canvas-viewport').scrollTo(170,70);void 0");await delay(100);
      await drag(await center('.canvas-guide.vertical'),await boardPoint(290,300));assert.ok(Math.abs(page().guides.vertical[0]-290)<1.5);
      assert.ok(Math.abs(await js("document.querySelector('.canvas-guide.vertical').getBoundingClientRect().width")-7)<.1);
      const before=structuredClone(page().guides),from=await center('.canvas-guide.vertical');win.webContents.sendInputEvent({type:'mouseDown',...from,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:from.x+40,y:from.y,button:'left'});
      await js("YuandaEditor.openPage('guide-other');void 0");win.webContents.sendInputEvent({type:'mouseUp',x:from.x+40,y:from.y,button:'left',clickCount:1});await delay(80);
      assert.deepEqual(page().guides,before);assert.deepEqual(engine.getSnapshot().pages[1].guides,{horizontal:[],vertical:[]});await js("YuandaEditor.openPage('guide-page');YuandaEditor.setZoom(.75);void 0");
    });
    await check('snapping-toggles-and-screen-threshold-math-have-boundary-coverage',async()=>{
      const result=await js(`(()=>{const W=YuandaWorkspace,n=YuandaEditor.getPage().nodes.find(n=>n.id==='guide-card');W.setPreferences({snapping:true,snapGrid:false,snapGuides:false,snapWidgets:false});const free=W.snapMove([n],13.17,17.29,1);W.setPreferences({grid:false,snapGrid:true,gridSize:20});const grid=W.snapMove([n],13,17,1);const a=W.math.nearestSnap([10],0,[13],2),b=W.math.nearestSnap([10],0,[13.01],2),c=W.math.nearestSnap([10],0,[22],.5),box=W.math.paintedBounds({...n,rotation:90});W.setPreferences({snapping:false});return{free,grid,a,b,c,box,off:W.snapMove([n],13.17,17.29,1),negative:W.snapValue(-13.33)}})()`);
      assert.deepEqual(result.free,{dx:13.17,dy:17.29});assert.deepEqual(result.grid,{dx:20,dy:20});assert.equal(result.a.correction,3);assert.equal(result.b,null);assert.equal(result.c.correction,12);assert.ok(Math.abs(result.box.x-110)<.001);assert.ok(Math.abs(result.box.y-50)<.001);assert.deepEqual(result.off,result.free);assert.equal(result.negative,-13.33);
    });
    await check('guide-snapping-is-independent-from-guide-visibility-and-resize-keeps-fixed-edge',async()=>{
      api.command({expectedRevision:engine.revision,commands:[{type:'setPageGuides',pageId:'guide-page',guides:{horizontal:[],vertical:[275]}}]});await delay(80);
      const result=await js(`(()=>{const W=YuandaWorkspace,n=YuandaEditor.getPage().nodes.find(n=>n.id==='guide-card');W.setPreferences({snapping:true,snapGrid:false,snapWidgets:false,snapGuides:true,guides:false});return{move:W.snapMove([n],34,0,1),resize:W.snapResize(n,{...n,width:193},'e',1),aspect:W.snapResize(n,{...n,width:193},'e',1,{preserveAspect:true}),guides:document.querySelectorAll('.canvas-guide:not(.preview)').length}})()`);
      assert.equal(result.move.dx,35);assert.equal(result.resize.x,80);assert.equal(result.resize.width,195);assert.equal(result.aspect.width,193);assert.equal(result.guides,0);
    });
    await check('inactive-panel-state-widgets-do-not-attract-snapping',async()=>{
      api.command({expectedRevision:engine.revision,commands:[{type:'createDynamicPanel',pageId:'guide-page',panelId:'snap-panel'},{type:'updateNode',pageId:'guide-page',nodeId:'snap-panel',patch:{x:700,y:500,width:100,height:100}},{type:'updateNode',pageId:'guide-page',nodeId:'guide-target',patch:{x:275}},{type:'addPanelState',pageId:'guide-page',panelId:'snap-panel',state:{id:'hidden-snap-state',name:'隐藏状态',nodeIds:['guide-target']}}]});await delay(80);
      const result=await js(`(()=>{const W=YuandaWorkspace,n=YuandaEditor.getPage().nodes.find(n=>n.id==='guide-card');W.setPreferences({snapping:true,snapGrid:false,snapGuides:false,snapWidgets:true});return{hidden:document.querySelector('.design-node[data-node-id="guide-target"]').hidden,move:W.snapMove([n],34,0,1)}})()`);assert.equal(result.hidden,true);assert.equal(result.move.dx,34);api.undo();await delay(80);
    });
    await check('preferences-persist-and-guide-clear-is-an-engine-command',async()=>{
      await js('YuandaWorkspace.setPreferences({guides:true,grid:true,gridStyle:"dots"});YuandaWorkspace.dialog("guides");void 0');const before=structuredClone(page().guides);assert.equal(await js('document.querySelectorAll(".guide-list>.workspace-row").length'),1);await click('#workspace-dialog button[title="清除本页参考线"]');await wait(()=>page().guides.vertical.length===0,'clear guide list');assert.deepEqual(page().guides,{horizontal:[],vertical:[]});assert.equal(await js('document.querySelectorAll(".guide-list>.workspace-row").length'),0);await js('document.querySelector("#workspace-dialog").close();void 0');api.undo();assert.deepEqual(page().guides,before);
      const stored=await js('JSON.parse(localStorage.getItem("yuanda.view"))');assert.equal(stored.grid,true);assert.equal(stored.gridStyle,'dots');assert.equal(stored.gridColor,'#123456');assert.equal(stored.gridSize,20);
      assert.equal(await js('__guideTrusted.length>0&&__guideTrusted.every(Boolean)'),true);assert.deepEqual(errors,[]);
    });
    const screenshot=path.join(directory,'grid-guides.png');await writeFile(screenshot,(await win.webContents.capturePage()).toPNG());screenshots.push(screenshot);
    await writeFile(path.join(directory,'result.json'),JSON.stringify({ok:true,checks,errors,screenshots,coverage:'Production renderer/workspace, trusted pointer and keyboard for ruler drag/edit/delete/lock; focused geometry assertions cover zoom thresholds and independent snapping. No Axure binary or full parity claim.'},null,2));win.destroy();app.exit(0);
  }catch(error){await writeFile(path.join(directory,'result.json'),JSON.stringify({ok:false,checks,errors,screenshots,error:error.stack},null,2));win?.destroy();app.exit(1);}
})().catch(error=>{console.error(error);createRequire(import.meta.url)('electron').app.exit(1);});
