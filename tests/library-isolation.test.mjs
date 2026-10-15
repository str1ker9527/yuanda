import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DocumentEngine,createBlankProject,makeNode,validateProject} from '../app/core/document.mjs';
import {captureLibraryItem} from '../app/core/library-model.mjs';
const h={uuid:randomUUID,validateProject,createBlankProject};
const command=(type,fields={})=>({type,...(type==='addStyle'?{}:{pageId:'page'}),...fields});
const page=e=>e.getSnapshot().pages[0];
function sourceItem(){
  const p=createBlankProject('Source');p.pages[0].id='page';p.pages[0].nodes=[makeNode('button',{id:'button',name:'source trigger'})];const e=new DocumentEngine(p),panel=makeNode('dynamicPanel',{id:'master-panel'});panel.panel.states[0].id='master-state';panel.panel.initialStateId='master-state';panel.panel.states[0].nodeIds=['master-node'];
  e.apply([{type:'addVariable',variable:{name:'count',type:'number',value:12}},command('addStyle',{style:{id:'shared-style',name:'Shared style',style:{fill:'#FF0000'}}}),{type:'addComponent',component:{id:'shared-master',name:'Reusable',nodes:[panel,makeNode('text',{id:'master-node',name:'source leaf',text:'leaf',styleId:'shared-style',bindings:{text:{op:'var',name:'count'}}})]}},{type:'addComponent',component:{id:'composite',name:'Composite',nodes:[makeNode('text',{id:'outer-label',text:'outer'})]}},{type:'componentCommands',componentId:'composite',commands:[{type:'insertComponent',componentId:'shared-master',instanceId:'nested-instance',x:0,y:60}]},command('insertComponent',{componentId:'composite',instanceId:'page-instance',x:200,y:100})]);
  const leaf=page(e).nodes.find(n=>n.name==='source leaf');
  e.apply([command('updateNode',{nodeId:'button',patch:{interactions:[{event:'click',condition:{op:'gt',args:[{op:'var',name:'count'},0]},actions:[{type:'setVariable',name:'count',value:{op:'add',args:[{op:'var',name:'count'},1]}},{type:'setText',targetId:leaf.id,value:{op:'var',name:'count'}}]}]}})]);
  const selected=['button',...page(e).groups.find(g=>g.id==='page-instance').nodeIds];
  return captureLibraryItem(e.getSnapshot(),{pageId:'page',nodeIds:selected,name:'Combined',description:''},h).item;
}
function host(){const p=createBlankProject('Host');p.pages[0].id='page';p.pages[0].nodes=[makeNode('button',{id:'button',name:'host trigger',text:'HOST'})];const e=new DocumentEngine(p);e.apply([{type:'addVariable',variable:{name:'count',type:'string',value:'HOST'}},command('addStyle',{style:{id:'shared-style',name:'Shared style',style:{fill:'#0000FF'}}}),{type:'addComponent',component:{id:'shared-master',name:'Reusable',nodes:[makeNode('text',{id:'master-node',text:'HOST MASTER'})]}},{type:'addComponent',component:{id:'composite',name:'Composite',nodes:[makeNode('text',{id:'outer-label',text:'HOST COMPOSITE'})]}}]);return e;}
const insert=item=>command('insertLibraryItem',{item,x:500,y:300,conflictPolicy:'copy'});
function visit(value,callback){if(!value||typeof value!=='object')return;callback(value);for(const child of Object.values(value))visit(child,callback);}

test('same IDs with different host definitions remain unchanged; new style/master/variable references stay independent',()=>{
  const item=sourceItem(),recorded=structuredClone(item),e=host(),before=e.getSnapshot();e.apply([insert(item)]);const after=e.getSnapshot(),addedNodes=after.pages[0].nodes.filter(n=>!before.pages[0].nodes.some(old=>old.id===n.id)),newVariable=after.variables.find(v=>v.name!=='count');
  assert.deepEqual(after.styles.find(s=>s.id==='shared-style'),before.styles[0]);assert.deepEqual(after.variables.find(v=>v.name==='count'),before.variables[0]);assert.deepEqual(after.pages[0].nodes.find(n=>n.id==='button'),before.pages[0].nodes[0]);
  for(const component of before.components)assert.deepEqual(after.components.find(c=>c.id===component.id),component);
  assert.equal(newVariable.type,'number');assert.equal(newVariable.value,12);
  const newStyle=after.styles.find(s=>s.id!=='shared-style'),newLeaf=after.components.find(c=>!before.components.some(old=>old.id===c.id)&&c.nodes.some(n=>n.name==='source leaf'));
  assert.equal(newStyle.style.fill,'#FF0000');assert.equal(newLeaf.nodes.find(n=>n.name==='source leaf').styleId,newStyle.id);
  const imported={nodes:addedNodes,components:after.components.filter(c=>!before.components.some(old=>old.id===c.id))};visit(imported,v=>{if(v.op==='var'||v.type==='setVariable')assert.equal(v.name,newVariable.name);});
  const trigger=addedNodes.find(n=>n.name==='source trigger');assert.ok(addedNodes.some(n=>n.id===trigger.interactions[0].actions[1].targetId));assert.deepEqual(item,recorded);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(),after);e.undo();assert.deepEqual(e.getSnapshot(),before);e.redo();assert.deepEqual(e.getSnapshot(),after);
});

test('imported nested master definitions keep source keys and instance values mapped for later edits',()=>{
  const e=host(),item=sourceItem();e.apply([insert(item)]);const after=e.getSnapshot(),leaf=after.components.find(c=>c.id!=='shared-master'&&c.id!=='composite'&&c.nodes.some(n=>n.id!== 'master-node'&&n.name==='source leaf')),leafNode=leaf.nodes.find(n=>n.name==='source leaf');
  e.apply([{type:'componentCommands',componentId:leaf.id,commands:[{type:'updateNode',nodeId:leafNode.id,patch:{annotation:'edited imported leaf'}}]}]);
  const updated=e.getSnapshot();assert.ok(updated.pages[0].nodes.some(n=>n.annotation==='edited imported leaf'));assert.equal(updated.components.find(c=>c.id==='shared-master').nodes[0].text,'HOST MASTER');assert.deepEqual(new DocumentEngine(updated).getSnapshot(),updated);
});

test('late validation failure rolls back every imported dependency, project rename and history revision',()=>{
  const e=host(),before=e.getSnapshot(),revision=e.revision,item=sourceItem();
  assert.throws(()=>e.apply([{type:'renameProject',name:'uncommitted'},insert(item),command('updateNode',{nodeId:'button',patch:{width:0}})]));
  assert.deepEqual(e.getSnapshot(),before);assert.equal(e.revision,revision);
});

test('insertion violating the target node budget rolls back generated resources before commit',()=>{
  const e=host(),p=e.getSnapshot();p.pages[0].nodes.push(...Array.from({length:4998},(_,i)=>makeNode('rectangle',{id:`host-${i}`})));e.replace(p);const before=e.getSnapshot(),revision=e.revision;
  assert.throws(()=>e.apply([insert(sourceItem())]));assert.deepEqual(e.getSnapshot(),before);assert.equal(e.revision,revision);assert.equal(e.canUndo,false);
});

