import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DocumentEngine,createBlankProject,makeNode} from '../app/core/document.mjs';
import {isHierarchyLocked,isGroupAncestorLocked,structuralNodeIds,groupAncestors} from '../app/core/hierarchy-model.mjs';

// Evaluate the production planner without creating the renderer's DOM. Every
// generated transaction is then checked by the real document engine.
const source=await readFile(new URL('../app/renderer/editor-shell.js',import.meta.url),'utf8');
const plannerSource=source.slice(source.indexOf('function lockSelectionPlan('),source.indexOf('function setLocked('));
assert.ok(plannerSource.startsWith('function lockSelectionPlan('));
const plan=new Function('isHierarchyLocked','isGroupAncestorLocked','structuralNodeIds','groupAncestors',plannerSource+';return lockSelectionPlan;')(isHierarchyLocked,isGroupAncestorLocked,structuralNodeIds,groupAncestors);
const page=e=>e.getSnapshot().pages[0];
function fixture(){const project=createBlankProject();project.pages[0].id='p';project.pages[0].nodes=['a','b','c'].map((id,i)=>makeNode('rectangle',{id,x:80+i*200}));return new DocumentEngine(project);}
const command=(type,rest={})=>({type,pageId:'p',...rest});
function apply(e,ids,items,locked){const result=plan(page(e),ids,items,locked);assert.equal(result.message,null);e.apply(result.commands);return result.commands;}

test('menu locks a normal group as a group and undo restores it without individual locks',()=>{
  const e=fixture();e.apply([command('groupNodes',{nodeIds:['a','b'],groupId:'group'})]);
  const commands=apply(e,['a','b'],[{kind:'group',id:'group'}],true);
  assert.deepEqual(commands,[command('lockGroup',{groupId:'group',locked:true})]);
  assert.equal(page(e).groups[0].locked,true);assert.ok(page(e).nodes.every(n=>!n.locked));
  assert.equal(isHierarchyLocked(page(e),'a'),true);e.undo();assert.equal(page(e).groups[0].locked,false);
});

test('whole master instances lock and unlock without mutating linked member nodes',()=>{
  const e=fixture();e.apply([command('createComponent',{componentId:'master',nodeIds:['a','b'],name:'Master'}),command('insertComponent',{componentId:'master',instanceId:'instance',x:400,y:300})]);
  const ids=page(e).groups.find(g=>g.id==='instance').nodeIds,items=[{kind:'group',id:'instance'}];
  apply(e,ids,items,true);assert.equal(page(e).groups.find(g=>g.id==='instance').locked,true);
  apply(e,ids,items,false);assert.equal(page(e).groups.find(g=>g.id==='instance').locked,false);
  assert.ok(page(e).nodes.filter(n=>ids.includes(n.id)).every(n=>!n.locked));
});

test('nested group unlock runs outer before inner even when the storage order is reversed',()=>{
  const e=fixture();e.apply([command('groupNodes',{nodeIds:['a','b'],groupId:'inner'}),command('groupItems',{items:[{kind:'group',id:'inner'},{kind:'node',id:'c'}],groupId:'outer'}),command('lockGroup',{groupId:'inner',locked:true}),command('lockGroup',{groupId:'outer',locked:true})]);
  const commands=apply(e,['a','b','c'],[{kind:'group',id:'outer'}],false);
  assert.deepEqual(commands.map(c=>c.groupId),['outer','inner']);assert.ok(page(e).groups.every(g=>!g.locked));
});

test('unlocking a child cannot silently unlock an unselected container or its other children',()=>{
  const e=fixture();e.apply([command('createDynamicPanel',{panelId:'panel',nodeIds:['a','b']}),command('updateNode',{nodeId:'panel',patch:{locked:true}})]);
  const before=e.getSnapshot(),result=plan(page(e),['a'],[{kind:'node',id:'a'}],false);
  assert.match(result.message,/外层组或容器/);assert.deepEqual(result.commands,[]);assert.deepEqual(e.getSnapshot(),before);
  assert.equal(isHierarchyLocked(page(e),'a'),true);
});

test('selected container unlock precedes an enclosed group and its individually locked node',()=>{
  const e=fixture();e.apply([command('createDynamicPanel',{panelId:'panel',nodeIds:['a','b']}),command('groupNodes',{groupId:'inside',nodeIds:['a','b']}),command('updateNode',{nodeId:'a',patch:{locked:true}}),command('lockGroup',{groupId:'inside',locked:true}),command('updateNode',{nodeId:'panel',patch:{locked:true}})]);
  const commands=apply(e,['panel','a','b'],[{kind:'node',id:'panel'}],false);
  assert.deepEqual(commands.map(c=>c.groupId||c.nodeId),['panel','inside','a']);assert.equal(isHierarchyLocked(page(e),'a'),false);
});

test('a partially selected locked group or master gives a useful refusal without commands',()=>{
  const e=fixture();e.apply([command('groupNodes',{groupId:'group',nodeIds:['a','b']}),command('lockGroup',{groupId:'group',locked:true})]);
  const result=plan(page(e),['a'],[{kind:'node',id:'a'}],false);assert.match(result.message,/外层组或容器/);assert.deepEqual(result.commands,[]);
  const master=fixture();master.apply([command('createComponent',{componentId:'master',nodeIds:['a','b'],name:'Master'}),command('insertComponent',{componentId:'master',instanceId:'instance',x:400,y:300})]);
  const id=page(master).groups.find(g=>g.id==='instance').nodeIds[0],partial=plan(page(master),[id],[{kind:'node',id}],true);assert.match(partial.message,/完整母版实例/);assert.deepEqual(partial.commands,[]);
});

test('production right-click handler selects the same whole group as canvas clicks, with Alt override',()=>{
  const handlerSource=source.slice(source.indexOf('function contextMenu('),source.indexOf("document.addEventListener('contextmenu',contextMenu)"));
  let ids=[],selectionCalls=0;const E={getState:()=>({}),getSelection:()=>({nodeIds:ids}),select:value=>{ids=value;selectionCalls++;},point:()=>({x:20,y:30})};
  const window={YuandaWorkspace:{guideAtElement:()=>null},YuandaOutline:{groupForCanvasNode:()=>({nodeIds:['a','b']})}},node={dataset:{nodeId:'a'}},canvas={};
  const target={closest:selector=>selector==='.design-node[data-node-id]'?node:selector==='#canvas-viewport'?canvas:null};
  const handler=new Function('E','window','$','item','sep','clipboardItems','arrangement','editable','visibilityEditable','selected','closeMenus','signature','renderMenu','let opener,stamp,menuContext;'+handlerSource+';return contextMenu;')(E,window,()=>({}),()=>({}),()=>({}),()=>[],()=>[],()=>true,()=>false,()=>ids.map(id=>({id,type:'rectangle'})),()=>{},()=>'',()=>{});
  handler({target,clientX:20,clientY:30,preventDefault(){},altKey:false});assert.deepEqual(ids,['a','b']);
  ids=['a','c'];selectionCalls=0;handler({target,clientX:20,clientY:30,preventDefault(){},altKey:false});assert.deepEqual(ids,['a','c']);assert.equal(selectionCalls,0);
  ids=[];handler({target,clientX:20,clientY:30,preventDefault(){},altKey:true});assert.deepEqual(ids,['a']);
});
