/** Real Chromium input checks for the authoring UI. Uses isolated project data. */
import { app, BrowserWindow, ipcMain } from 'electron';
import { DocumentEngine, createBlankProject, makeNode } from '../app/core/document.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { clipboardMarkerMock } from './clipboard-marker-mock.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=path.join(root,'.local','advanced-ui-regression');
mkdirSync(runtime,{recursive:true});app.setPath('userData',path.join(runtime,'profile'));app.setPath('sessionData',path.join(runtime,'browser'));app.setPath('logs',path.join(runtime,'logs'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
void run().catch(async error=>{await writeFile(path.join(runtime,'result.json'),JSON.stringify({ok:false,fatal:error.stack},null,2));console.error(error.stack);app.exit(1);});
async function run(){
  const project=createBlankProject('高级编辑操作回归');project.id='advanced-ui';project.pages[0].id='page-main';project.pages[0].width=1000;project.pages[0].height=700;
  project.pages[0].nodes=[makeNode('text',{id:'title',name:'标题',x:40,y:60,width:260,height:60,text:'可重复使用的标题'}),makeNode('rectangle',{id:'card',name:'卡片',x:40,y:180,width:260,height:130})];
  const engine=new DocumentEngine(project);let win,selection={pageId:'page-main',nodeIds:[]};
  const state=()=>({project:engine.getSnapshot(),revision:engine.revision,canUndo:engine.canUndo,canRedo:engine.canRedo,dirty:engine.revision>0,filePath:null,selection,agent:{enabled:false},appVersion:'test'});
  const emit=()=>{const next=state();win.webContents.send('yuanda:state',next);return next;};
  const api={...clipboardMarkerMock(state),getState:state,setSelection:value=>{selection=value;},command:body=>{engine.apply(body.commands,{expectedRevision:body.expectedRevision,label:body.label});return emit();},undo:()=>{engine.undo();return emit();},redo:()=>{engine.redo();return emit();}};
  for(const[name,fn]of Object.entries(api))ipcMain.handle(`yuanda:${name}`,async(_event,...args)=>{try{return{ok:true,value:await fn(...args)};}catch(error){return{ok:false,error:{message:error.message,code:error.code}};}});
  await app.whenReady();win=new BrowserWindow({width:1540,height:1040,show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(root,'app','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  const js=code=>win.webContents.executeJavaScript(code),checks=[],errors=[];
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
  const wait=async(fn,label)=>{const end=Date.now()+3500;while(Date.now()<end){if(await fn())return;await sleep(30);}throw new Error(`等待超时：${label}`);};
  await win.loadFile(path.join(root,'app','renderer','index.html'));win.webContents.focus();
  await wait(()=>js('!!window.YuandaAdvanced && !!window.YuandaEditor.getState()'),'载入');await sleep(200);
  await js("window.__uiErrors=[];window.__trace=[];for(const type of ['pointerdown','pointerup','click','change','focusin'])document.addEventListener(type,event=>window.__trace.push({type,target:event.target.id||event.target.dataset.nodeId||event.target.className,selection:window.YuandaEditor.getSelection(),revision:window.YuandaEditor.getState()?.revision}),true);addEventListener('error',event=>window.__uiErrors.push(event.message));window.YuandaDock.reset()");
  const point=async(selector,match=null)=>js(`(()=>{const all=[...document.querySelectorAll(${JSON.stringify(selector)})];const element=all.find(item=>${match===null?'true':`item.textContent.trim()===${JSON.stringify(match)}`}&&item.getBoundingClientRect().width&&item.getBoundingClientRect().height);if(!element)throw new Error('找不到可见控件 '+${JSON.stringify(match||selector)});element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);if(!element.contains(document.elementFromPoint(x,y)))throw new Error('控件被遮挡 '+${JSON.stringify(match||selector)});return{x,y};})()`);
  const click=async(selector,match=null,count=1)=>{const p=await point(selector,match);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,x:p.x,y:p.y,button:'left',clickCount:count});await sleep(100);};
  const button=async(text,scope='')=>click(`${scope} button`,text);
  // Count actual case cards; other sections (for example event settings) are not cases.
  const caseScope=index=>`#interactions-panel-content > .interaction-case:nth-child(${index+1} of .interaction-case)`;
  const key=async(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(80);};
  const fill=async(selector,text)=>{await click(selector);await key('A',['control']);await win.webContents.insertText(text);await key('Tab');await sleep(120);};
  const check=async(name,fn)=>{try{await fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.stack});await writeFile(path.join(runtime,`${name}.png`),(await win.webContents.capturePage()).toPNG());await js("for(const d of document.querySelectorAll('dialog[open]'))d.close();window.YuandaDock.reset()");await sleep(100);}await writeFile(path.join(runtime,`${name}.trace.json`),JSON.stringify(await js('({events:window.__trace.splice(0),selection:window.YuandaEditor.getSelection(),revision:window.YuandaEditor.getState()?.revision})'),null,2));};
  const page=()=>engine.getSnapshot().pages[0];
  await check('page-note-persists-through-command-engine',async()=>{
    await fill('#notes-panel-content textarea','页面注释由真实键盘输入');await wait(()=>page().annotation==='页面注释由真实键盘输入','页面注释保存');
  });
  await check('shared-style-create-apply-update',async()=>{
    await click('.design-node[data-node-id="title"]');await wait(()=>js("window.YuandaEditor.getSelection().nodeIds.includes('title')"),'画布选择标题');await button('新建','#shared-styles');await fill('#workspace-dialog input','标题共享样式');await button('确定','#workspace-dialog');
    await wait(()=>engine.getSnapshot().styles.length===1,'共享样式创建');const styleId=engine.getSnapshot().styles[0].id;assert.equal(page().nodes.find(node=>node.id==='title').styleId,styleId);
    await button('管理','#shared-styles');await button('编辑样式…','#style-manager');await fill('#style-editor-dialog [data-style-field=color]','#555555');await button('保存共享样式','#style-editor-dialog');await wait(()=>page().nodes.find(node=>node.id==='title').style.color==='#555555','共享样式同步');
  });
  await check('component-create-insert-edit-synchronizes',async()=>{
    await click('.design-node[data-node-id="title"]');await js("window.YuandaDock.show('components')");await sleep(100);await button('从所选元件创建母版','#components-panel-content');await fill('#workspace-dialog input','标题母版');await button('确定','#workspace-dialog');
    await wait(()=>engine.getSnapshot().components.length===1,'母版创建');await button('插入','#components-panel-content');await wait(()=>page().groups.some(group=>group.componentId),'插入实例');
    await button('编辑','#components-panel-content');await fill('#master-editor textarea','所有实例同步的文字');await wait(()=>page().nodes.filter(node=>node.text==='所有实例同步的文字').length===1,'实例同步');await button('关闭','#workspace-dialog');
  });
  await check('component-canvas-edit-insert-move-and-return',async()=>{
    const definition=engine.getSnapshot().components[0],sourceId=definition.nodes[0].id;
    await button('在画布编辑','#components-panel-content');
    await wait(()=>js("window.YuandaEditor.getEditingTarget().kind==='component'"),'进入母版画布');
    await click(`.design-node[data-node-id="${sourceId}"]`);await click(`.design-node[data-node-id="${sourceId}"]`,null,2);
    await wait(()=>js("document.activeElement?.classList.contains('inline-editor')"),'母版画布双击');
    await key('A',['control']);await win.webContents.insertText('在母版画布直接修改');await key('Enter',['control']);
    await wait(()=>engine.getSnapshot().components[0].nodes[0].text==='在母版画布直接修改','母版画布文字保存');
    assert(page().nodes.some(node=>node.text==='在母版画布直接修改'),'页面实例同步');
    await click('[data-insert="rectangle"]');await wait(()=>engine.getSnapshot().components[0].nodes.length===2,'母版内插入元件');
    const added=engine.getSnapshot().components[0].nodes.find(node=>node.id!==sourceId),beforeX=added.x;
    await click(`.design-node[data-node-id="${added.id}"]`);await key('Right',['shift']);
    await wait(()=>engine.getSnapshot().components[0].nodes.find(node=>node.id===added.id).x===beforeX+10,'母版方向键微调');
    await key('Z',['control']);await key('Z',['control']);
    await wait(()=>engine.getSnapshot().components[0].nodes.length===1,'撤销母版插入');
    await click('#page-list [data-page-id="page-main"]');await wait(()=>js("window.YuandaEditor.getEditingTarget().kind==='page'"),'返回页面');
  });
  await check('component-instance-text-override-and-reset',async()=>{
    const instance=page().groups.find(group=>group.componentId),id=instance.nodeIds[0];
    await js("window.YuandaDock.show('overview');window.YuandaDock.show('styles')");await sleep(100);await click(`.layer-row[data-node-id="${id}"]`);
    await fill('[data-field="instanceText"]','只修改这个实例');await wait(()=>page().nodes.find(node=>node.id===id).text==='只修改这个实例','实例覆盖');
    assert.equal(engine.getSnapshot().components[0].nodes[0].text,'在母版画布直接修改','主定义保持内容');
    await button('恢复母版内容','#inspector');await wait(()=>page().nodes.find(node=>node.id===id).text==='在母版画布直接修改','恢复跟随母版');
  });
  await check('dynamic-panel-create-and-state-edit',async()=>{
    await click('.design-node[data-node-id="card"]');await js("window.YuandaDock.show('styles')");await sleep(100);await button('转为动态面板','#advanced-properties');await wait(()=>page().nodes.some(node=>node.type==='dynamicPanel'),'面板创建');const panel=page().nodes.find(node=>node.type==='dynamicPanel');
    await js("window.YuandaDock.show('overview')");await sleep(100);await click(`.layer-row[data-node-id="${panel.id}"]`);await button('添加状态','#advanced-properties');await wait(()=>page().nodes.find(node=>node.id===panel.id).panel.states.length===2,'第二状态创建');
  });
  await check('repeater-data-editor-adds-row',async()=>{
    await js("window.YuandaDock.show('library')");await sleep(100);await button('数据列表','.advanced-library');await wait(()=>page().nodes.some(node=>node.type==='repeater'),'中继器创建');const repeater=page().nodes.find(node=>node.type==='repeater');
    await js("window.YuandaDock.show('overview')");await sleep(100);await click(`.layer-row[data-node-id="${repeater.id}"]`);const rows=repeater.repeater.rows.length;await button(`编辑数据（${rows} 行）`,'#advanced-properties');await button('添加行','#workspace-dialog');await button('保存数据','#workspace-dialog');await wait(()=>page().nodes.find(node=>node.id===repeater.id).repeater.rows.length===rows+1,'数据保存');
  });
  await check('variables-and-responsive-views-editable',async()=>{
    await button('项目变量…','#advanced-properties');await button('添加变量','#workspace-dialog');await wait(()=>engine.getSnapshot().variables.length===1,'变量添加');await button('关闭','#workspace-dialog');
    await click('#manage-views');await button('添加视图','#view-manager');await wait(()=>page().views.length===1,'视图添加');await button('完成','#view-manager');
  });
  await check('event-case-action-dialog-saves',async()=>{
    await js("window.YuandaDock.show('overview')");await sleep(100);await click('.layer-row[data-node-id="title"]');await js("window.YuandaDock.show('interactions')");await sleep(100);
    await button('添加条件分支','#interactions-panel-content');await wait(()=>page().nodes.find(node=>node.id==='title').interactions.length===1,'交互分支创建');await button('添加动作','#interactions-panel-content');await button('保存动作','#workspace-dialog');await wait(()=>page().nodes.find(node=>node.id==='title').interactions[0].actions.length===1,'动作保存');
  });
  await check('case-and-action-copy-reorder',async()=>{
    await button('复制分支','#interactions-panel-content');await wait(()=>page().nodes.find(node=>node.id==='title').interactions.length===2,'复制分支');
    const before=page().nodes.find(node=>node.id==='title').interactions.map(item=>item.name);await click(`${caseScope(1)} button`,'上移分支');
    await wait(()=>page().nodes.find(node=>node.id==='title').interactions[0].name===before[1],'分支重排');
    await button('复制',`${caseScope(0)} .advanced-action-row`);await wait(()=>page().nodes.find(node=>node.id==='title').interactions[0].actions.length===2,'动作复制');
    await key('Z',['control']);await key('Z',['control']);await key('Z',['control']);
    assert.equal(page().nodes.find(node=>node.id==='title').interactions.length,1);
  });
  await check('stale-action-dialog-does-not-overwrite-agent',async()=>{
    await button('添加动作','#interactions-panel-content');const before=page().nodes.find(node=>node.id==='title').interactions[0].actions.length;
    // Simulate a concurrent authenticated agent transaction through the same production engine.
    engine.apply([{type:'updateNode',pageId:'page-main',nodeId:'title',patch:{text:'Agent 在弹窗期间更新了标题'}}]);emit();await sleep(100);
    await button('保存动作','#workspace-dialog');assert.equal(page().nodes.find(node=>node.id==='title').interactions[0].actions.length,before);assert.equal(await js("document.querySelector('#workspace-dialog').open"),true);
    assert(await js("document.querySelector('#toast-stack').textContent.includes('项目已被其他操作修改')"));await button('取消','#workspace-dialog');
  });
  await check('clipboard-snapshot-survives-source-delete',async()=>{
    await click('[data-insert="button"]');const added=page().nodes.find(node=>node.type==='button');assert(added);
    await click(`.design-node[data-node-id="${added.id}"]`);await key('C',['control']);await key('Delete');await wait(()=>!page().nodes.some(node=>node.id===added.id),'删除复制来源');
    await key('V',['control']);await wait(()=>page().nodes.some(node=>node.type==='button'&&node.id!==added.id),'从快照粘贴');
    const pasted=page().nodes.find(node=>node.type==='button');assert.equal(pasted.text,added.text);assert.equal(pasted.x,added.x+24);
  });
  await check('duplicate-repeater-preserves-local-template',async()=>{
    const original=page().nodes.find(node=>node.type==='repeater');await js("window.YuandaDock.show('overview')");await sleep(100);await click(`.layer-row[data-node-id="${original.id}"]`);
    await key('D',['control']);await wait(()=>page().nodes.filter(node=>node.type==='repeater').length===2,'复制完整数据列表');
    const duplicate=page().nodes.find(node=>node.type==='repeater'&&node.id!==original.id);assert.equal(duplicate.repeater.templateIds.length,original.repeater.templateIds.length);assert(duplicate.repeater.templateIds.every(id=>!original.repeater.templateIds.includes(id)&&page().nodes.some(node=>node.id===id)));
    await key('Z',['control']);await wait(()=>page().nodes.filter(node=>node.type==='repeater').length===1,'整体撤销复杂复制');
  });
  // The serialized result must be accepted by a new engine, not merely present in the DOM.
  const reopened=new DocumentEngine(JSON.parse(JSON.stringify(engine.getSnapshot())));assert.deepEqual(reopened.getSnapshot(),engine.getSnapshot());
  errors.push(...await js('window.__uiErrors'));const result={ok:checks.every(item=>item.ok)&&errors.length===0,checks,errors,coverage:'真实 Chromium 鼠标和键盘；仅面板导航调用布局公开 API。项目修改全部通过用户可见控件和生产指令引擎。保存 JSON 往返重新校验。'};
  await writeFile(path.join(runtime,'result.json'),JSON.stringify(result,null,2));await writeFile(path.join(runtime,'project.yuanda'),JSON.stringify(engine.getSnapshot(),null,2));await writeFile(path.join(runtime,'workspace.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(result,null,2));app.exit(result.ok?0:1);
}
