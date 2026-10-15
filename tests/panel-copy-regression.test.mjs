import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentEngine,createBlankProject,makeNode} from '../app/core/document.mjs';

function fixture(){const project=createBlankProject();project.pages[0].id='page';project.pages[0].nodes=['a','b','other'].map(id=>makeNode('text',{id,text:id}));return new DocumentEngine(project);}
const cmd=(type,fields={})=>({type,pageId:'page',...fields});
const page=e=>e.getSnapshot().pages[0],node=(e,id)=>page(e).nodes.find(n=>n.id===id);
function assertUndo(e,before){const after=e.getSnapshot();assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(),after);e.undo();assert.deepEqual(e.getSnapshot(),before);e.redo();assert.deepEqual(e.getSnapshot(),after);}

test('状态复制不扩展旧跨状态平组，不把副本追加回原状态',()=>{
  const e=fixture();e.apply([cmd('groupNodes',{groupId:'legacy',nodeIds:['a','other']}),cmd('createDynamicPanel',{panelId:'panel',nodeIds:['a','b']}),cmd('addPanelState',{panelId:'panel',state:{id:'state-other',name:'另一个',nodeIds:['other']}})]);
  const original=node(e,'panel').panel.states[0],before=e.getSnapshot();
  e.apply([cmd('duplicatePanelState',{panelId:'panel',stateId:original.id,newStateId:'state-copy'})]);
  const panel=node(e,'panel').panel,newState=panel.states.find(s=>s.id==='state-copy');
  assert.deepEqual(panel.states.find(s=>s.id===original.id),original);
  assert.deepEqual(panel.states.find(s=>s.id==='state-other').nodeIds,['other']);
  assert.deepEqual(newState.nodeIds.map(id=>node(e,id).text),['a','b']);
  assert.equal(page(e).groups.length,1);assert.equal(page(e).nodes.length,before.pages[0].nodes.length+2);assertUndo(e,before);
});

test('状态内嵌套面板和内部动作重映射，父面板自状态引用映射到新状态',()=>{
  const e=fixture();e.apply([cmd('createDynamicPanel',{panelId:'inner',nodeIds:['a','b']}),cmd('createDynamicPanel',{panelId:'outer',nodeIds:['inner']})]);
  const oldOuter=node(e,'outer').panel.states[0],oldInner=node(e,'inner').panel.states[0];
  e.apply([cmd('updateNode',{nodeId:'a',patch:{interactions:[{event:'click',actions:[{type:'setText',targetId:'b',value:'changed'},{type:'setPanelState',panelId:'inner',stateId:oldInner.id},{type:'setPanelState',panelId:'outer',stateId:oldOuter.id}]}]}})]);
  const before=e.getSnapshot();e.apply([cmd('duplicatePanelState',{panelId:'outer',stateId:oldOuter.id,newStateId:'copy-state'})]);
  const rootId=node(e,'outer').panel.states.find(s=>s.id==='copy-state').nodeIds[0],copyInner=node(e,rootId),[copyA,copyB]=copyInner.panel.states[0].nodeIds.map(id=>node(e,id));
  assert.notEqual(rootId,'inner');assert.notEqual(copyInner.panel.states[0].id,oldInner.id);
  assert.deepEqual(copyA.interactions[0].actions,[{type:'setText',targetId:copyB.id,value:'changed'},{type:'setPanelState',panelId:rootId,stateId:copyInner.panel.states[0].id},{type:'setPanelState',panelId:'outer',stateId:'copy-state'}]);
  assertUndo(e,before);
});

test('状态复制保留中继器行绑定与母版实例，原实例映射不变',()=>{
  const e=fixture();e.apply([cmd('createDynamicPanel',{panelId:'panel',nodeIds:['a']}),cmd('createRepeater',{nodeId:'list',nodeIds:['panel']}),cmd('updateNode',{nodeId:'a',patch:{bindings:{text:{op:'item',column:'title'}}}}),{type:'addComponent',component:{id:'master',name:'条目',nodes:[makeNode('text',{id:'source',text:'linked'})]}},cmd('insertComponent',{componentId:'master',instanceId:'instance',x:0,y:0})]);
  const sourceState=node(e,'panel').panel.states[0].id;e.apply([cmd('reparentItems',{items:[{kind:'group',id:'instance'}],parent:{kind:'panelState',panelId:'panel',stateId:sourceState}})]);
  const before=e.getSnapshot(),instance=page(e).groups.find(g=>g.id==='instance');e.apply([cmd('duplicatePanelState',{panelId:'panel',stateId:sourceState,newStateId:'copied'})]);
  const copies=node(e,'panel').panel.states.find(s=>s.id==='copied').nodeIds.map(id=>node(e,id));assert.deepEqual(copies.find(n=>n.text==='a').bindings,{text:{op:'item',column:'title'}});
  assert.deepEqual(page(e).groups.find(g=>g.id==='instance'),instance);const copiedInstance=page(e).groups.find(g=>g.id!=='instance');assert.equal(copiedInstance.componentId,'master');assert.notDeepEqual(copiedInstance.nodeIds,instance.nodeIds);assertUndo(e,before);
});

test('状态复制ID冲突与非法设置必须全批次原子回滚',()=>{
  const e=fixture();e.apply([cmd('createDynamicPanel',{panelId:'panel',nodeIds:['a','b']})]);const before=e.getSnapshot(),revision=e.revision,stateId=node(e,'panel').panel.states[0].id;
  for(const bad of [cmd('duplicatePanelState',{panelId:'panel',stateId,newStateId:'other'}),cmd('setPanelOptions',{panelId:'panel',patch:{drag:{enabled:true,axis:'bad',bounds:'none'}}})]){assert.throws(()=>e.apply([{type:'renameProject',name:'SHOULD-NOT-COMMIT'},bad]));assert.deepEqual(e.getSnapshot(),before);assert.equal(e.revision,revision);}
});

