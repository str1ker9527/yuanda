/** Real Chromium mouse gestures against the production renderer, isolated engine
 * and project-owned library fixture. No operating-system UI or user documents. */
import {app,BrowserWindow,ipcMain} from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {DocumentEngine,createBlankProject,makeNode,validateProject} from '../app/core/document.mjs';
import {captureLibraryItem} from '../app/core/library-model.mjs';
import {getNodeBounds} from '../app/core/widget-geometry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'.local','drag-preview-ui');mkdirSync(runtime,{recursive:true});
const runDirectory=mkdtempSync(path.join(runtime,'run-'));
for(const [name,folder] of [['userData','profile'],['sessionData','browser'],['logs','logs']])app.setPath(name,path.join(runDirectory,folder));
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
  const offsetNodes=[makeNode('rectangle',{id:'offset-rotated',x:30,y:40,width:120,height:60,rotation:90}),makeNode('button',{id:'offset-button',x:150,y:140,width:100,height:40}),makeNode('rectangle',{id:'offset-hidden',x:-200,y:-100,width:120,height:60,visible:false})];
  const offsetSource=new DocumentEngine(base);offsetSource.apply(offsetNodes.map(node=>({type:'addNode',pageId:'home',node})));
  const {item:offsetItem}=captureLibraryItem(offsetSource.getSnapshot(),{pageId:'home',nodeIds:offsetNodes.map(node=>node.id),name:'旋转与隐藏边界',description:'隐藏节点只影响插入原点，不参与可见吸附'}, {uuid:randomUUID,createBlankProject,validateProject});
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
  const capture=async name=>{await delay(80);const file=path.join(runDirectory,`${name}.png`);await writeFile(file,(await win.webContents.capturePage()).toPNG());evidence.push(file);};
  const checks=[],traces={};
  const reset=async()=>{await js(`window.YuandaDragPreview.cancel();document.querySelectorAll('dialog[open]').forEach(d=>{d.close();d.remove();});window.YuandaEditor.openPage('home');window.YuandaDock.reset();window.YuandaDock.show('library');window.YuandaDock.activate('library');window.YuandaWorkspace.setPreferences({snapping:false,snapGrid:true,snapGuides:true,snapWidgets:true,gridSize:10,guides:true});`);engine.replace(base);selection={pageId:'home',nodeIds:[]};emit();await waitFor(()=>js(`window.YuandaEditor.getState().revision===${engine.revision}`),'重置状态');await js('window.YuandaEditor.setZoom(1);document.querySelector("#canvas-viewport").scrollTo(0,0)');await delay(100);};
  const check=async(name,task)=>{await reset();const start=Date.now();try{await task();assert.equal(await js('document.querySelector("#smart-snap-layer")?.childElementCount||0'),0,'结束后无残留吸附线');checks.push({name,ok:true,durationMs:Date.now()-start});}catch(error){checks.push({name,ok:false,error:error.stack});await capture(`${name}-failure`);}traces[name]=await js('window.__dragTrace.splice(0)');};
  const fixture=async commands=>{engine.apply(commands);emit();await waitFor(()=>js(`window.YuandaEditor.getState().revision===${engine.revision}`),'夹具状态已同步');};
  const snapping=async patch=>js(`window.YuandaWorkspace.setPreferences(${JSON.stringify({snapping:true,snapGrid:false,snapGuides:false,snapWidgets:false,...patch})})`);
  const canvasPoint=(x,y)=>js(`(()=>{const r=document.querySelector('#board').getBoundingClientRect(),z=window.YuandaEditor.getZoom();return {x:Math.round(r.left+${x}*z),y:Math.round(r.top+${y}*z)};})()`);
  const snapLines=()=>js(`[...document.querySelectorAll('#smart-snap-layer .smart-snap-line')].map(n=>({axis:n.classList.contains('x')?'x':'y',value:parseFloat(n.style.left||n.style.top)}))`);
  const placeAndUndo=async(point,before,revision,middle)=>{
    const commandsBefore=commandLog.length;await mouse('mouseUp',point);await waitFor(()=>engine.revision===revision+1,'吸附落地一笔修改');await waitFor(()=>js(`window.YuandaEditor.getState().revision===${engine.revision}`),'落地模型已渲染');
    assert.equal(commandLog.length,commandsBefore+1);assert.equal(commandLog.at(-1).commands.length,1);assert.equal(commandLog.at(-1).expectedRevision,revision);
    const beforeIds=new Set(before.pages[0].nodes.map(node=>node.id)),added=engine.getSnapshot().pages[0].nodes.filter(node=>!beforeIds.has(node.id));assert(added.length);
    const visible=added.filter(node=>node.visible&&node.placed!==false),bounds=visible.map(getNodeBounds),left=Math.min(...bounds.map(b=>b.left)),top=Math.min(...bounds.map(b=>b.top)),right=Math.max(...bounds.map(b=>b.right)),bottom=Math.max(...bounds.map(b=>b.bottom));
    const board=await js(`(()=>{const r=document.querySelector('#board').getBoundingClientRect();return {x:r.left,y:r.top,zoom:window.YuandaEditor.getZoom()};})()`);
    for(const [actual,expected,label]of [[middle.bounds.x,board.x+left*board.zoom,'left'],[middle.bounds.y,board.y+top*board.zoom,'top'],[middle.bounds.width,(right-left)*board.zoom,'width'],[middle.bounds.height,(bottom-top)*board.zoom,'height']])assert(Math.abs(actual-expected)<.04,`${label}: preview ${actual}, placed ${expected}`);
    assert.equal(await js('window.YuandaDragPreview.getState()'),null);assert.deepEqual(await snapLines(),[]);
    await key('Z',['control']);await waitFor(()=>engine.revision===revision+2,'吸附放置可一次撤销');assert.deepEqual(engine.getSnapshot(),before);return added;
  };

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
  await check('grid-snap-basic-preview-and-drop-one-undo',async()=>{
    await snapping({snapGrid:true});const before=engine.getSnapshot(),revision=engine.revision,point=await begin('.library-widget[data-library-type="button"]',await canvasPoint(133,157)),middle=await snapshot();
    assert.deepEqual(middle.state.point,{x:130,y:160});const added=await placeAndUndo(point,before,revision,middle);assert.equal(added[0].x,130);assert.equal(added[0].y,160);
  });
  await check('hidden-page-and-global-guides-snap-two-axes',async()=>{
    await fixture([{type:'setPageGuides',pageId:'home',guides:{vertical:[240],horizontal:[]}},{type:'setProjectGuides',guides:{vertical:[],horizontal:[210]}}]);await snapping({snapGuides:true,guides:false});
    const before=engine.getSnapshot(),revision=engine.revision,point=await begin('.library-widget[data-library-type="button"]',await canvasPoint(237,207)),middle=await snapshot();assert.deepEqual(middle.state.point,{x:240,y:210});assert.deepEqual(await snapLines(),[{axis:'x',value:240},{axis:'y',value:210}]);await capture('page-global-guides-snapped');await placeAndUndo(point,before,revision,middle);
  });
  await check('existing-widget-edge-and-midpoint-snap',async()=>{
    await fixture([{type:'addNode',pageId:'home',node:makeNode('rectangle',{id:'alignment-target',x:440,y:300,width:80,height:100})}]);await snapping({snapWidgets:true});
    const before=engine.getSnapshot(),revision=engine.revision,point=await begin('.library-widget[data-library-type="button"]',await canvasPoint(281,329)),middle=await snapshot();assert.deepEqual(middle.state.point,{x:280,y:328});assert.deepEqual(await snapLines(),[{axis:'x',value:440},{axis:'y',value:350}]);await placeAndUndo(point,before,revision,middle);
  });
  await check('component-visible-rotated-offset-bounds-ignore-hidden-content',async()=>{
    await fixture([{type:'addComponent',component:{id:'offset-component',name:'旋转偏移母版',nodes:offsetNodes}},{type:'setPageGuides',pageId:'home',guides:{vertical:[240],horizontal:[210]}}]);await snapping({snapGuides:true});
    await js("window.YuandaDock.show('components');window.YuandaDock.activate('components')");const before=engine.getSnapshot(),revision=engine.revision,point=await begin('.component-item:last-child .component-name',await canvasPoint(177,197)),middle=await snapshot();
    assert.equal(middle.nodes.length,2);assert.deepEqual(middle.state.point,{x:180,y:200});assert.equal(Math.round(middle.bounds.width),190);assert.equal(Math.round(middle.bounds.height),170);await placeAndUndo(point,before,revision,middle);
  });
  await check('library-visible-bounds-ignore-hidden-normalization-origin',async()=>{
    catalog[0].library.items=[offsetItem];try{
      await fixture([{type:'setPageGuides',pageId:'home',guides:{vertical:[340],horizontal:[310]}}]);await snapping({snapGuides:true});await js('window.YuandaLibrary.open()');await waitFor(()=>js('!!document.querySelector(".local-library-thumbnail")'),'偏移库条目');
      const before=engine.getSnapshot(),revision=engine.revision,point=await begin('.local-library-thumbnail',await canvasPoint(77,197)),middle=await snapshot();assert.equal(middle.nodes.length,2);assert.deepEqual(middle.state.point,{x:80,y:200});await placeAndUndo(point,before,revision,middle);
    }finally{catalog[0].library.items=[item];}
  });
  await check('snap-tolerance-scales-and-scroll-refreshes-exact-preview',async()=>{
    await fixture([{type:'setProjectGuides',guides:{vertical:[400],horizontal:[300]}}]);await snapping({snapGuides:true});await js('window.YuandaEditor.setZoom(.5)');
    let point=await begin('.library-widget[data-library-type="button"]',await canvasPoint(390,290));assert.deepEqual((await snapshot()).state.point,{x:400,y:300});
    await js('window.YuandaEditor.setZoom(1.5)');point=await canvasPoint(394,294);await mouse('mouseMove',point);assert.deepEqual((await snapshot()).state.point,{x:394,y:294},'超过六个屏幕像素不吸附');assert.deepEqual(await snapLines(),[]);
    await js("document.querySelector('#canvas-viewport').scrollLeft=120;document.querySelector('#canvas-viewport').scrollTop=60");point=await canvasPoint(397,297);await mouse('mouseMove',point);let middle=await snapshot();assert.deepEqual(middle.state.point,{x:400,y:300});
    // Keep the pointer still while the viewport scrolls: the raw point leaves
    // the attraction radius, so both the hint and preview must refresh.
    await js("document.querySelector('#canvas-viewport').scrollLeft+=30");await waitFor(async()=>!(await snapLines()).some(line=>line.axis==='x'),'滚动后移出吸附范围');middle=await snapshot();assert(middle.state.point.x>410);assert.equal(middle.state.point.y,300);
    point=await canvasPoint(397,297);await mouse('mouseMove',point);middle=await snapshot();assert.deepEqual(middle.state.point,{x:400,y:300});await placeAndUndo(point,engine.getSnapshot(),engine.revision,middle);
  });
  await check('master-canvas-uses-local-guides-without-project-guides',async()=>{
    await fixture([{type:'setProjectGuides',guides:{vertical:[240],horizontal:[210]}},{type:'updateComponent',componentId:'drag-card',patch:{guides:{vertical:[200],horizontal:[180]}}}]);await snapping({snapGuides:true});await js("window.YuandaEditor.openComponent('drag-card');window.YuandaEditor.setZoom(1)");
    let point=await begin('.library-widget[data-library-type="button"]',await canvasPoint(237,207));assert.deepEqual((await snapshot()).state.point,{x:237,y:207});assert.deepEqual(await snapLines(),[]);
    point=await canvasPoint(197,177);await mouse('mouseMove',point);assert.deepEqual((await snapshot()).state.point,{x:200,y:180});await key('Escape');await mouse('mouseUp',point);
  });
  await check('active-snap-disabled-and-enabled-without-extra-pointer-motion',async()=>{
    await fixture([{type:'setProjectGuides',guides:{vertical:[240],horizontal:[210]}}]);await snapping({snapGuides:true});const revision=engine.revision,point=await begin('.library-widget[data-library-type="button"]',await canvasPoint(237,207));assert.deepEqual((await snapshot()).state.point,{x:240,y:210});
    await js('window.YuandaWorkspace.setPreferences({snapping:false})');assert.deepEqual((await snapshot()).state.point,{x:237,y:207});assert.deepEqual(await snapLines(),[]);
    await js('window.YuandaWorkspace.setPreferences({snapping:true})');assert.deepEqual((await snapshot()).state.point,{x:240,y:210});await key('Escape');await mouse('mouseUp',point);assert.equal(engine.revision,revision);
  });
  for(const mode of ['outside','escape','revision','context'])await check(`active-snap-${mode}-cancels-without-hints-or-insert`,async()=>{
    await fixture([{type:'setProjectGuides',guides:{vertical:[240],horizontal:[210]}}]);await snapping({snapGuides:true});let point=await begin('.library-widget[data-library-type="button"]',await canvasPoint(237,207));assert.equal((await snapLines()).length,2);
    if(mode==='outside'){point={x:1450,y:100};await mouse('mouseMove',point);assert.equal((await snapshot()).state.valid,false);assert.deepEqual(await snapLines(),[]);}
    else if(mode==='escape')await key('Escape');
    else if(mode==='revision'){engine.apply([{type:'renameProject',name:'吸附途中外部更新'}]);emit();await waitFor(()=>js('window.YuandaDragPreview.getState()===null'),'版本更新取消吸附');}
    else{await js("window.YuandaEditor.openComponent('drag-card')");await waitFor(()=>js('window.YuandaDragPreview.getState()===null'),'画布切换取消吸附');}
    const revision=engine.revision;await mouse('mouseUp',point);assert.equal(engine.revision,revision);assert.deepEqual(await snapLines(),[]);assert.equal(engine.getSnapshot().pages[0].nodes.length,0);
  });
  await check('all-gestures-used-trusted-browser-input',async()=>{for(const [name,events]of Object.entries(traces)){assert(events.some(event=>event.type==='pointerdown'&&event.trusted),name);assert(events.filter(event=>['pointerdown','pointermove','pointerup'].includes(event.type)).every(event=>event.trusted),name);}assert.deepEqual(await js('window.__dragErrors'),[]);});
  const result={ok:checks.every(check=>check.ok)&&errors.length===0,checks,errors,evidence,traces,commandLog,runDirectory,scope:'Real Chromium input and middle-drag DOM/pixel evidence in isolated Electron. No user documents or Axure run.'};
  await writeFile(path.join(runDirectory,'result.json'),JSON.stringify(result,null,2));await writeFile(path.join(runtime,output),JSON.stringify(result,null,2));win.destroy();app.exit(result.ok?0:1);
}
