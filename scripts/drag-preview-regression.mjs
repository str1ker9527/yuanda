/** Real Chromium mouse gestures against the production renderer, isolated engine
 * and project-owned library fixture. No operating-system UI or user documents. */
import {app,BrowserWindow,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {DocumentEngine,createBlankProject,makeNode,validateProject} from '../app/core/document.mjs';
import {captureLibraryItem} from '../app/core/library-model.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'.local','drag-preview-ui');mkdirSync(runtime,{recursive:true});
for(const [name,folder] of [['userData','profile'],['sessionData','browser'],['logs','logs']])app.setPath(name,path.join(runtime,folder));
const output=process.argv.find(value=>value.startsWith('--output='))?.slice(9)||'result.json';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGPgEpH7D8IACDMCd0kivAIAAAAASUVORK5CYII=';
void run().catch(async error=>{await writeFile(path.join(runtime,output),JSON.stringify({ok:false,fatal:error.stack},null,2));console.error(error.stack);app.exit(1);});

async function run(){
  const initial=createBlankProject('拖动中真实外观回归');initial.id='drag-project';initial.pages[0].id='home';initial.pages[0].width=1000;initial.pages[0].height=700;
  const build=new DocumentEngine(initial);
  build.apply([{type:'addComponent',component:{id:'drag-card',name:'图片按钮卡片',nodes:[
    makeNode('rectangle',{id:'card-bg',x:0,y:0,width:260,height:156,style:{fill:'#e4f5ed',stroke:'#299d6b',radius:14}}),
    makeNode('image',{id:'card-image',x:14,y:14,width:80,height:44,src:png}),
    makeNode('button',{id:'card-button',x:14,y:76,width:230,height:52,text:'带图片的原始按钮',style:{fill:'#156b52',color:'#ffffff'}})
  ]}}]);
  const base=build.getSnapshot();const source=new DocumentEngine(base);
  source.apply([{type:'insertComponent',pageId:'home',componentId:'drag-card',instanceId:'source-instance',x:90,y:80}]);
  const sourcePage=source.getSnapshot().pages[0];
  const {item}=captureLibraryItem(source.getSnapshot(),{pageId:'home',nodeIds:sourcePage.nodes.map(node=>node.id),name:'带图片和母版的自有库',description:'测试原创按钮与内嵌 PNG'}, {uuid:randomUUID,createBlankProject,validateProject});
  const catalog=[{id:'test-local-library',revision:1,library:{name:'拖动测试库',description:'项目内独立测试夹具',folders:[],items:[item]}}];
  const engine=new DocumentEngine(base);let selection={pageId:'home',nodeIds:[]},win;
  const agent={enabled:false,port:0,requests:0,connectionFile:'',cliPath:''};
  const getState=()=>({project:engine.getSnapshot(),revision:engine.revision,canUndo:engine.canUndo,canRedo:engine.canRedo,dirty:engine.revision>0,filePath:null,selection,agent,appVersion:'test'});
  const emit=()=>{const state=getState();win.webContents.send('yuanda:state',state);return state;};
  const commandLog=[];
  const api={getState,getAgentInfo:()=>agent,setSelection:value=>{selection=value;},libraryList:()=>({libraries:catalog,errors:[]}),
    command:body=>{commandLog.push(structuredClone(body));engine.apply(body.commands,{expectedRevision:body.expectedRevision,label:body.label});return emit();},
    undo:()=>{engine.undo();return emit();},redo:()=>{engine.redo();return emit();}};
  for(const [name,fn]of Object.entries(api))ipcMain.handle(`yuanda:${name}`,async(_event,...args)=>{try{return {ok:true,value:await fn(...args)};}catch(error){return {ok:false,error:{message:error.message,code:error.code}};}});
  await app.whenReady();win=new BrowserWindow({width:1480,height:960,show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(root,'app/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code),waitFor=async(predicate,label,max=3000)=>{const deadline=Date.now()+max;while(Date.now()<deadline){if(await predicate())return;await delay(25);}throw new Error(`等待超时：${label}`);};
  await win.loadFile(path.join(root,'app/renderer/index.html'));win.webContents.focus();
  await waitFor(()=>js('!!window.YuandaDragPreview&&!!window.YuandaEditor?.getState()'),'拖动模块');
  await js(`window.__dragTrace=[];for(const type of ['pointerdown','pointermove','pointerup','gotpointercapture','lostpointercapture','keydown'])document.addEventListener(type,event=>window.__dragTrace.push({type,trusted:event.isTrusted,target:event.target.id||event.target.className,key:event.key}),true);window.__dragErrors=[];window.addEventListener('error',event=>window.__dragErrors.push(event.message));`);
  const mouse=async(type,point)=>{win.webContents.sendInputEvent({type,x:Math.round(point.x),y:Math.round(point.y),...(type==='mouseMove'?{button:'left'}:{button:'left',clickCount:1})});await delay(35);};
  const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(60);};
  const center=async selector=>{const result=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('缺少目标 '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return {x,y,hit:e.contains(document.elementFromPoint(x,y))};})()`);assert(result.hit,`目标被遮挡 ${selector}`);return result;};
  const target=()=>js(`(()=>{const r=document.querySelector('#canvas-viewport').getBoundingClientRect();return {x:Math.round(r.left+r.width*.42),y:Math.round(r.top+r.height*.42)};})()`);
  const begin=async(selector,to=undefined)=>{const from=await center(selector);await mouse('mouseMove',from);await mouse('mouseDown',from);const point=to||await target();for(let step=1;step<=6;step++)await mouse('mouseMove',{x:from.x+(point.x-from.x)*step/6,y:from.y+(point.y-from.y)*step/6});await waitFor(()=>js('!!window.YuandaDragPreview.getState()?.active'),'随动预览');return point;};
  const snapshot=()=>js(`(()=>{const root=document.querySelector('#yuanda-drag-preview'),bounds=root?.querySelector('.yuanda-drag-bounds')?.getBoundingClientRect(),nodes=[...(root?.querySelectorAll('[data-preview-node-id]')||[])];return {state:window.YuandaDragPreview.getState(),bounds:bounds?{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}:null,nodes:nodes.map(n=>({text:n.textContent,fills:[...n.querySelectorAll('.yuanda-style-decoration path[fill]')].map(p=>p.getAttribute('fill')),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,images:[...n.querySelectorAll('img')].map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth}))})),dimensions:root?.querySelector('.yuanda-drag-dimensions')?.textContent,selection:window.YuandaEditor.getSelection()};})()`);
  const evidence=[];
  const capture=async name=>{await delay(80);const file=path.join(runtime,`${name}.png`);await writeFile(file,(await win.webContents.capturePage()).toPNG());evidence.push(file);};
  const checks=[],traces={};
  const reset=async()=>{await js(`window.YuandaDragPreview.cancel();document.querySelectorAll('dialog[open]').forEach(d=>{d.close();d.remove();});window.YuandaEditor.openPage('home');window.YuandaDock.reset();window.YuandaDock.show('library');window.YuandaDock.activate('library');`);engine.replace(base);selection={pageId:'home',nodeIds:[]};emit();await waitFor(()=>js(`window.YuandaEditor.getState().revision===${engine.revision}`),'重置状态');await js('window.YuandaEditor.setZoom(1)');await delay(100);};
  const check=async(name,task)=>{await reset();const start=Date.now();try{await task();checks.push({name,ok:true,durationMs:Date.now()-start});}catch(error){checks.push({name,ok:false,error:error.stack});await capture(`${name}-failure`);}traces[name]=await js('window.__dragTrace.splice(0)');};

  await check('button-real-appearance-follows-pointer-drop-one-undo',async()=>{
    const before=engine.getSnapshot(),revision=engine.revision;let point=await begin('.library-widget[data-library-type="button"]');const first=await snapshot();
    assert(first.state.valid);assert.equal(first.nodes.length,1);assert.equal(first.nodes[0].text,'开始体验');assert.equal(first.nodes[0].width,160);assert.equal(first.nodes[0].height,44);assert(first.nodes[0].fills.includes(makeNode('button').style.fill));assert.match(first.dimensions,/X .*Y .*160 × 44/);assert.equal(engine.revision,revision);assert.deepEqual(engine.getSnapshot(),before);
    await capture('button-mid-drag-100pct');point={x:point.x+71,y:point.y+37};await mouse('mouseMove',point);const second=await snapshot();assert.equal(Math.round(second.bounds.x-first.bounds.x),71);assert.equal(Math.round(second.bounds.y-first.bounds.y),37);assert.equal(engine.revision,revision);
    await mouse('mouseUp',point);await waitFor(()=>engine.revision===revision+1,'松开才写入');const node=engine.getSnapshot().pages[0].nodes[0];assert.equal(node.x,second.state.point.x);assert.equal(node.y,second.state.point.y);assert.equal(await js('window.YuandaDragPreview.getState()'),null);await key('Z',['control']);await waitFor(()=>engine.revision===revision+2,'一笔撤销');assert.deepEqual(engine.getSnapshot(),before);
  });
  await check('half-zoom-preserves-size-and-logical-drop-coordinate',async()=>{
    await js('window.YuandaEditor.setZoom(.5)');const revision=engine.revision;const point=await begin('.library-widget[data-library-type="rectangle"]'),middle=await snapshot();assert.equal(middle.nodes[0].width,100);assert.equal(middle.nodes[0].height,70);assert.equal(engine.revision,revision);await capture('rectangle-mid-drag-50pct');await mouse('mouseUp',point);await waitFor(()=>engine.revision===revision+1,'半倍率落地');const node=engine.getSnapshot().pages[0].nodes[0];assert.equal(node.x,middle.state.point.x);assert.equal(node.y,middle.state.point.y);assert.equal(node.width,200);assert.equal(node.height,140);
  });
  await check('active-zoom-and-scroll-refresh-preview-position',async()=>{
    const revision=engine.revision,point=await begin('.library-widget[data-library-type="button"]');await js('window.YuandaEditor.setZoom(1.5)');await mouse('mouseMove',point);let middle=await snapshot();assert.equal(middle.nodes[0].width,240);assert.equal(middle.nodes[0].height,66);const firstX=middle.state.point.x;
    await js("document.querySelector('#canvas-viewport').scrollLeft+=120");await delay(80);middle=await snapshot();assert(middle.state.point.x>firstX);assert(Math.abs(middle.bounds.x-point.x)<1);assert(Math.abs(middle.bounds.y-point.y)<1);await capture('button-mid-drag-150pct-scrolled');await mouse('mouseUp',point);await waitFor(()=>engine.revision===revision+1,'拖动途中缩放滚动后落地');assert.equal(engine.getSnapshot().pages[0].nodes[0].x,middle.state.point.x);
  });
  await check('component-multiple-nodes-png-visible-before-drop',async()=>{
    await js("window.YuandaDock.show('components');window.YuandaDock.activate('components')");const before=engine.getSnapshot(),revision=engine.revision,point=await begin('.component-name');await delay(100);const middle=await snapshot();assert.equal(middle.state.kind,'component');assert.equal(middle.nodes.length,3);assert(middle.nodes.some(node=>node.text==='带图片的原始按钮'));assert(middle.nodes.some(node=>node.images.some(image=>image.complete&&image.width===2)));assert.equal(engine.revision,revision);await capture('component-png-mid-drag');await mouse('mouseUp',point);await waitFor(()=>engine.revision===revision+1,'母版落地');const page=engine.getSnapshot().pages[0];assert.equal(page.nodes.length,3);assert.equal(page.groups.length,1);assert.equal(page.groups[0].componentId,'drag-card');assert.equal(page.nodes.find(node=>node.type==='image').src,png);await key('Z',['control']);await waitFor(()=>engine.revision===revision+2,'母版一笔撤销');assert.deepEqual(engine.getSnapshot(),before);
  });
  await check('library-modal-closes-with-pointer-capture-real-png-master-preview',async()=>{
    const before=engine.getSnapshot(),revision=engine.revision;await js('window.YuandaLibrary.open()');await waitFor(()=>js('!!document.querySelector(".local-library-thumbnail")'),'自有库缩略图');const point=await begin('.local-library-thumbnail');await delay(120);const middle=await snapshot();assert.equal(middle.state.kind,'library');assert.equal(await js('!!document.querySelector("#library-manager")'),false);assert.equal(middle.nodes.length,3);assert(middle.nodes.some(node=>node.images.some(image=>image.complete&&image.width===2)));assert.equal(engine.revision,revision);assert(middle.state.valid);await capture('own-library-png-master-mid-drag');await mouse('mouseUp',point);await waitFor(()=>engine.revision===revision+1,'自有库落地');const after=engine.getSnapshot(),page=after.pages[0];assert.equal(page.nodes.length,3);assert.equal(page.groups.length,1);assert.notEqual(page.groups[0].componentId,'drag-card');assert.equal(after.components.length,2);assert.equal(Math.min(...page.nodes.map(node=>node.x)),middle.state.point.x);assert.equal(Math.min(...page.nodes.map(node=>node.y)),middle.state.point.y);assert.equal(page.nodes.find(node=>node.type==='image').src,png);await key('Z',['control']);await waitFor(()=>engine.revision===revision+2,'自有库一笔撤销');assert.deepEqual(engine.getSnapshot(),before);
  });
  await check('escape-cancels-active-preview-without-writing',async()=>{const revision=engine.revision,point=await begin('.library-widget[data-library-type="button"]');await key('Escape');assert.equal(await js('window.YuandaDragPreview.getState()'),null);await mouse('mouseUp',point);assert.equal(engine.revision,revision);assert.equal(engine.canUndo,false);});
  await check('outside-canvas-release-cancels-without-writing',async()=>{const revision=engine.revision;await begin('.library-widget[data-library-type="button"]');const outside={x:1450,y:100};await mouse('mouseMove',outside);const middle=await snapshot();assert.equal(middle.state.valid,false);await capture('outside-canvas-cancel');await mouse('mouseUp',outside);assert.equal(await js('window.YuandaDragPreview.getState()'),null);assert.equal(engine.revision,revision);});
  await check('external-revision-cancels-stale-drag',async()=>{const point=await begin('.library-widget[data-library-type="button"]');engine.apply([{type:'renameProject',name:'拖动时外部更新'}]);emit();const revision=engine.revision;await waitFor(()=>js('window.YuandaDragPreview.getState()===null'),'版本变化立即取消');await mouse('mouseUp',point);assert.equal(engine.revision,revision);assert.equal(engine.getSnapshot().pages[0].nodes.length,0);});
  await check('context-switch-cancels-stale-drag',async()=>{const revision=engine.revision,point=await begin('.library-widget[data-library-type="button"]');await js("window.YuandaEditor.openComponent('drag-card')");await waitFor(()=>js('window.YuandaDragPreview.getState()===null'),'画布切换取消');await mouse('mouseUp',point);assert.equal(engine.revision,revision);});
  await check('component-self-reference-rejected-atomically',async()=>{await js("window.YuandaEditor.openComponent('drag-card');window.YuandaDock.show('components');window.YuandaDock.activate('components')");const before=engine.getSnapshot(),revision=engine.revision,point=await begin('.component-name');await mouse('mouseUp',point);await delay(180);assert.equal(await js('window.YuandaDragPreview.getState()'),null);assert.equal(engine.revision,revision);assert.deepEqual(engine.getSnapshot(),before);assert.match(await js('document.querySelector("#toast-stack").textContent'),/循环/);});
  await check('all-eleven-basic-widget-previews-render-before-cancel',async()=>{
    const revision=engine.revision,types=await js('[...document.querySelectorAll(".library-widget[data-library-type]")].map(n=>n.dataset.libraryType)');assert.equal(types.length,11);
    for(const type of types){const point=await begin(`.library-widget[data-library-type="${type}"]`);const middle=await snapshot();assert.equal(middle.nodes.length,1,type);assert(middle.bounds.width>0&&middle.bounds.height>0,type);if(type==='line')assert.equal(await js('!!document.querySelector("#yuanda-drag-preview svg path[d]")'),true);if(['input','textarea','select','checkbox','radio'].includes(type))assert.equal(await js('!!document.querySelector("#yuanda-drag-preview input,#yuanda-drag-preview textarea,#yuanda-drag-preview select")'),true);if(type==='table')assert.equal(await js('document.querySelectorAll("#yuanda-drag-preview td").length'),9);await key('Escape');await mouse('mouseUp',point);assert.equal(engine.revision,revision,type);assert.equal(await js('window.YuandaDragPreview.getState()'),null,type);}
  });
  await check('all-gestures-used-trusted-browser-input',async()=>{for(const [name,events]of Object.entries(traces)){assert(events.some(event=>event.type==='pointerdown'&&event.trusted),name);assert(events.filter(event=>['pointerdown','pointermove','pointerup'].includes(event.type)).every(event=>event.trusted),name);}assert.deepEqual(await js('window.__dragErrors'),[]);});
  const result={ok:checks.every(check=>check.ok)&&errors.length===0,checks,errors,evidence,traces,commandLog,scope:'Real Chromium input and middle-drag DOM/pixel evidence in isolated Electron. No user documents or Axure run.'};
  await writeFile(path.join(runtime,output),JSON.stringify(result,null,2));win.destroy();app.exit(result.ok?0:1);
}
