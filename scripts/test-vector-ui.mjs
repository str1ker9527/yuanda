/** Isolated hidden Electron check for the original vector UI. No user documents. */
import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createBlankProject, DocumentEngine, makeNode } from '../app/core/document.mjs';
import {makeRichText} from '../app/core/vector-model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=path.join(root,'.local','vector-ui');
mkdirSync(runtime,{recursive:true});for(const [name,folder]of [['userData','profile'],['sessionData','browser'],['logs','logs']])app.setPath(name,path.join(runtime,folder));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[],errors=[],inputs=[];let win;
async function run(){
  const project=createBlankProject('矢量界面验收');project.pages[0].id='vector-page';project.pages[0].width=900;project.pages[0].height=650;
  project.pages[0].nodes=[makeNode('rectangle',{id:'from',x:60,y:60,width:140,height:70,text:'起点'}),makeNode('rectangle',{id:'to',x:440,y:60,width:140,height:70,text:'终点'})];
  const engine=new DocumentEngine(project);let selection={pageId:'vector-page',nodeIds:[]};
  const state=()=>({project:engine.getSnapshot(),revision:engine.revision,canUndo:engine.canUndo,canRedo:engine.canRedo,dirty:true,filePath:null,selection,agent:{enabled:false},appVersion:'test'});
  const emit=()=>{const result=state();win?.webContents.send('yuanda:state',result);return result;};
  const api={getState:state,getAgentInfo:()=>({enabled:false}),setSelection:value=>{selection=value;},command:body=>{engine.apply(body.commands,{expectedRevision:body.expectedRevision,label:body.label});return emit();},undo:()=>{engine.undo();return emit();},redo:()=>{engine.redo();return emit();}};
  for(const [name,fn]of Object.entries(api))ipcMain.handle(`yuanda:${name}`,async(_,...args)=>{try{return{ok:true,value:await fn(...args)}}catch(error){return{ok:false,error:{message:error.message,code:error.code}}}});
  await app.whenReady();win=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{preload:path.join(root,'app/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const send=win.webContents.sendInputEvent.bind(win.webContents);win.webContents.sendInputEvent=event=>{inputs.push({...event,at:Date.now()});send(event);};
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,label)=>{for(let i=0;i<120;i++){if(await fn())return;await delay(25);}throw new Error(`超时 ${label}`)};
  const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter'&&!modifiers.includes('control'))win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(50)};
  const clickAt=async(x,y,modifiers=[])=>{win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y)});win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1,modifiers});win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1,modifiers});await delay(70)};
  const selectorPoint=async selector=>js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('missing element');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const click=async(selector,modifiers=[])=>{const p=await selectorPoint(selector);await clickAt(p.x,p.y,modifiers)};
  const button=async(label,scope='#workspace-dialog')=>{await js(`(()=>{document.querySelectorAll('#vector-test-action').forEach(n=>n.removeAttribute('id'));const b=[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(n=>n.textContent===${JSON.stringify(label)});if(!b)throw new Error('missing '+${JSON.stringify(label)});b.id='vector-test-action'})()`);await click('#vector-test-action');};
  const openRich=async()=>{await click('.design-node[data-node-id="from"]');await wait(()=>js(`!![...document.querySelectorAll('#vector-properties button')].find(n=>n.textContent==='编辑富文本…')`),'rich button');await button('编辑富文本…','#vector-properties');await wait(()=>js(`!!document.querySelector('.vector-rich-editor')`),'rich editor');};
  const setFrom=patch=>{engine.apply([{type:'updateNode',pageId:'vector-page',nodeId:'from',patch}]);emit();};
  const boardPoint=async(x,y)=>js(`(()=>{const r=document.querySelector('#board').getBoundingClientRect(),z=YuandaEditor.getZoom();return{x:r.left+${x}*z,y:r.top+${y}*z}})()`);
  const check=async(name,fn)=>{try{await fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,error:error.stack,diagnostic:await js(`({selection:YuandaEditor.getSelection(),properties:document.querySelector('#vector-properties')?.textContent,inspector:document.querySelector('#inspector')?.textContent,mode:YuandaVector.mode()})`)})}};
  await win.loadFile(path.join(root,'app/renderer/index.html'));win.webContents.focus();
  await wait(()=>js('!!window.YuandaVector && !!window.YuandaEditor.getPage()'),'vector module');await delay(180);
  await check('pen-real-input-creates-editable-path',async()=>{
    await click('#canvas-viewport');await key('P');
    for(const [x,y]of [[100,250],[260,220],[340,340]]){const p=await boardPoint(x,y);await clickAt(p.x,p.y)}await key('Enter');
    await wait(()=>engine.getSnapshot().pages[0].nodes.some(n=>n.type==='path'),'pen path');
    const n=engine.getSnapshot().pages[0].nodes.find(n=>n.type==='path');assert.equal(n.path.points.length,3);
    assert.equal(await js(`!!document.querySelector('[data-node-id="${n.id}"] svg path')`),true);
  });
  await check('point-editor-drag-is-one-undoable-command',async()=>{
    await wait(()=>js(`!![...document.querySelectorAll('#vector-properties button')].find(n=>n.textContent==='编辑点')`),'point properties');
    await js(`(()=>{const n=[...document.querySelectorAll('#vector-properties button')].find(n=>n.textContent==='编辑点');n.id='test-edit-points'})()`);await click('#test-edit-points');
    const p=await selectorPoint('#vector-overlay rect.vector-control-point'),before=engine.revision;
    win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(p.x),y:Math.round(p.y),button:'left',clickCount:1});
    for(let i=1;i<=5;i++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(p.x+20*i/5),y:Math.round(p.y+15*i/5),button:'left'});await delay(20)}
    win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(p.x+20),y:Math.round(p.y+15),button:'left'});await wait(()=>engine.revision>before,'point edit');assert.equal(engine.revision,before+1);await key('Escape');
  });
  await check('connect-two-and-move-target-keeps-anchor',async()=>{
    await click('.design-node[data-node-id="from"]');await click('.design-node[data-node-id="to"]',['shift']);
    await js(`(()=>{const b=[...document.querySelectorAll('#vector-library-tools button')].find(n=>n.textContent==='连接两元件');b.id='test-connect'})()`);await click('#test-connect');
    await wait(()=>engine.getSnapshot().pages[0].nodes.some(n=>n.type==='connector'),'connection');
    const old=engine.getSnapshot().pages[0].nodes.find(n=>n.type==='connector');
    engine.apply([{type:'updateNode',pageId:'vector-page',nodeId:'to',patch:{x:650}}]);emit();await delay(80);
    const next=engine.getSnapshot().pages[0].nodes.find(n=>n.id===old.id);assert.ok(next.width>old.width);assert.equal(next.connector.to.nodeId,'to');
  });
  await check('rich-text-visual-editor-saves-plain-text-and-format',async()=>{
    await click('.design-node[data-node-id="from"]');await wait(()=>js(`!![...document.querySelectorAll('#vector-properties button')].find(n=>n.textContent==='编辑富文本…')`),'rich properties');await js(`(()=>{const b=[...document.querySelectorAll('#vector-properties button')].find(n=>n.textContent==='编辑富文本…');b.id='test-rich'})()`);await click('#test-rich');
    await click('.vector-rich-editor');await key('A',['control']);await win.webContents.insertText('富文本测试');
    await key('A',['control']);await js(`(()=>{const b=[...document.querySelectorAll('.vector-rich-toolbar button')].find(n=>n.textContent==='粗体');b.id='test-bold'})()`);await click('#test-bold');
    await js(`(()=>{const b=[...document.querySelectorAll('#workspace-dialog button')].find(n=>n.textContent==='保存文字');b.id='test-rich-save'})()`);await click('#test-rich-save');
    await wait(()=>engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from').richText!==null,'rich content');
    const n=engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from');assert.equal(n.text,'富文本测试');assert.ok(n.richText.paragraphs.some(p=>p.runs.some(r=>r.bold)));
    assert.equal(await js(`document.querySelector('.design-node[data-node-id="from"]').textContent`),'富文本测试');
  });
  await check('rich-partial-strike-super-and-clear-preserve-neighbours',async()=>{
    setFrom({text:'ABCD',richText:makeRichText('ABCD')});await delay(100);await openRich();await click('.vector-rich-editor');await key('Home',['control']);await key('Right',['shift']);await key('Right',['shift']);
    assert.equal(await js('getSelection().toString()'),'AB');await button('删除线','.vector-rich-toolbar');await button('上标','.vector-rich-toolbar');await button('保存文字');
    let runs=engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from').richText.paragraphs[0].runs;
    assert.equal(runs.map(r=>r.text).join(''),'ABCD');assert.equal(runs[0].text,'AB');assert.equal(runs[0].strike,true);assert.equal(runs[0].baseline,'super');assert.equal(runs.at(-1).strike,false);assert.equal(runs.at(-1).baseline,'normal');
    await openRich();await click('.vector-rich-editor');await key('Home',['control']);await key('Right',['shift']);await key('Right',['shift']);await button('清除格式','.vector-rich-toolbar');await button('保存文字');
    runs=engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from').richText.paragraphs[0].runs;assert.ok(runs.every(r=>!r.strike&&!r.bold&&!r.italic&&!r.underline&&r.baseline==='normal'));assert.equal(runs.map(r=>r.text).join(''),'ABCD');
  });
  await check('rich-alpha-and-leading-soft-break-survive-save',async()=>{
    const rich=makeRichText('A');rich.paragraphs[0].runs[0].color='#ff000040';setFrom({text:'A',richText:rich});await delay(100);await openRich();await click('.vector-rich-editor');await key('Home',['control']);await key('Enter',['shift']);inputs.push({diagnostic:'soft-break-dom',html:await js(`document.querySelector('.vector-rich-editor').innerHTML`)});await button('保存文字');
    const node=engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from');assert.equal(node.text,'\nA');assert.equal(node.richText.paragraphs[0].runs.find(r=>r.text.includes('A')).color,'#ff000040');
    await openRich();await button('保存文字');assert.equal(engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from').text,'\nA');
  });
  await check('rich-conflict-keeps-draft-unrelated-update-allows-save',async()=>{
    setFrom({text:'原文字',richText:null});await delay(100);await openRich();await click('.vector-rich-editor');await key('A',['control']);await win.webContents.insertText('保留的草稿');
    setFrom({text:'另一处的新文字'});await delay(100);await button('保存文字');assert.equal(await js(`document.querySelector('#workspace-dialog')?.open`),true);assert.equal(await js(`document.querySelector('.vector-rich-editor').textContent`),'保留的草稿');assert.equal(engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from').text,'另一处的新文字');
    await button('取消');await openRich();await click('.vector-rich-editor');await key('A',['control']);await win.webContents.insertText('可保存的草稿');
    setFrom({x:70});await delay(100);await button('保存文字');assert.equal(engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from').text,'可保存的草稿');assert.equal(engine.getSnapshot().pages[0].nodes.find(n=>n.id==='from').x,70);
  });
  await check('noncentral-rotation-point-drag-and-agent-conflict',async()=>{
    const path={closed:false,points:[{x:.2,y:.2,inX:null,inY:null,outX:null,outY:null},{x:.8,y:.8,inX:null,inY:null,outX:null,outY:null}]};
    engine.apply([{type:'addNode',pageId:'vector-page',node:makeNode('path',{id:'origin-path',x:400,y:300,width:100,height:100,rotation:90,path,style:{transformOrigin:{x:0,y:0},strokeWidth:3}})}]);emit();await delay(100);
    const p=await boardPoint(350,350);inputs.push({diagnostic:'rotated-path-hit',point:p,hit:await js(`(()=>{const n=document.elementFromPoint(${p.x},${p.y});return{tag:n?.tagName,id:n?.closest('[data-node-id]')?.dataset.nodeId,rect:document.querySelector('[data-node-id=\"origin-path\"]').getBoundingClientRect().toJSON()}})()`)});await clickAt(p.x,p.y);await wait(()=>js(`!![...document.querySelectorAll('#vector-properties button')].find(b=>b.textContent==='编辑点')`),'origin point tools');await button('编辑点','#vector-properties');let at=await selectorPoint('#vector-overlay rect.vector-control-point'),before=engine.revision,z=await js('YuandaEditor.getZoom()');
    win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(at.x),y:Math.round(at.y),button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(at.x-10*z),y:Math.round(at.y+20*z),button:'left'});await delay(30);win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(at.x-10*z),y:Math.round(at.y+20*z),button:'left'});
    await wait(()=>engine.revision>before,'origin point edit');let node=engine.getSnapshot().pages[0].nodes.find(n=>n.id==='origin-path');assert.ok(Math.abs(node.path.points[0].x-.4)<.025&&Math.abs(node.path.points[0].y-.3)<.025);
    at=await selectorPoint('#vector-overlay rect.vector-control-point');win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(at.x),y:Math.round(at.y),button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(at.x-5),y:Math.round(at.y+10),button:'left'});await delay(20);
    engine.apply([{type:'updateNode',pageId:'vector-page',nodeId:'origin-path',patch:{x:420}}]);emit();before=engine.revision;await delay(50);win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(at.x-5),y:Math.round(at.y+10),button:'left'});await delay(150);assert.equal(engine.revision,before);assert.deepEqual(engine.getSnapshot().pages[0].nodes.find(n=>n.id==='origin-path').path,node.path);await key('Escape');
  });
  await check('line-and-gallery-use-common-style-paint',async()=>{
    engine.apply([{type:'addNode',pageId:'vector-page',node:makeNode('line',{id:'styled-line',x:100,y:500,width:160,height:10,style:{strokeWidth:6,strokeStyle:'dashed',strokePaint:{type:'linear',angle:90,stops:[{offset:0,color:'#ff0000',opacity:1},{offset:1,color:'#0000ff',opacity:1}]}}})}]);emit();await delay(100);
    assert.equal(await js(`document.querySelector('.design-node[data-node-id="styled-line"] svg path[stroke-dasharray]')?.getAttribute('stroke-width')`),'6');await click('#open-gallery');await wait(()=>js(`!!document.querySelector('.gallery-item [data-preview-node-id="styled-line"] svg path[stroke-dasharray]')`),'styled gallery line');
    const preview=await js(`(()=>{const n=document.querySelector('.gallery-item [data-preview-node-id="origin-path"]');return{origin:n.style.transformOrigin,transform:n.style.transform}})()`);assert.equal(preview.origin,'0% 0%');assert.equal(preview.transform,'rotate(90deg)');await key('Escape');
  });
  await writeFile(path.join(runtime,'result.json'),JSON.stringify({ok:checks.every(c=>c.ok)&&errors.length===0,checkedAt:new Date().toISOString(),checks,errors,inputs,project:engine.getSnapshot()},null,2));
  console.log(JSON.stringify({checks,errors}));app.exit(checks.every(c=>c.ok)&&errors.length===0?0:1);
}
run().catch(async error=>{await writeFile(path.join(runtime,'result.json'),JSON.stringify({ok:false,fatal:error.stack,checks,errors},null,2));console.error(error);app.exit(1)});
