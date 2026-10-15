/** Independent regression of the document's view-scoped transaction boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlankProject,makeNode,DocumentEngine} from '../app/core/document.mjs';
import {resolveContainerView} from '../app/core/view-model.mjs';
function fixture(){const project=createBlankProject(),page=project.pages[0];page.id='p';page.nodes=[makeNode('text',{id:'a',x:10,y:20,text:'A'}),makeNode('text',{id:'b',x:50,y:60,text:'B'})];project.viewSets=[{id:'set',name:'Views',views:[{id:'parent',name:'Parent',parentId:null,minWidth:0,width:500,height:800},{id:'child',name:'Child',parentId:'parent',minWidth:600,width:800,height:900}]}];page.viewSetId='set';return new DocumentEngine(project);}
const edit=(commands,viewId='child',scope='current')=>({type:'viewCommands',pageId:'p',viewId,scope,commands}),update=(nodeId,patch)=>({type:'updateNode',pageId:'p',nodeId,patch}),node=(e,id,view='child')=>resolveContainerView(e.getSnapshot(),'p',view).nodes.find(n=>n.id===id);

test('子视图将已有元件组合为面板后仍可看到其内容，不把旧子元件留在永久取消放置状态',()=>{
 const e=fixture();e.apply([edit([{type:'createDynamicPanel',pageId:'p',panelId:'panel',nodeIds:['a','b']}])]);assert.equal(node(e,'a').effectivePlaced,true);assert.equal(node(e,'b').effectivePlaced,true);assert.equal(node(e,'panel').effectivePlaced,true);
});
test('子视图将已有元件组合为数据列表后当前模板仍可放置',()=>{
 const e=fixture();e.apply([edit([{type:'createRepeater',pageId:'p',nodeId:'list',nodeIds:['a','b']}])]);assert.equal(node(e,'a').effectivePlaced,true);assert.equal(node(e,'b').effectivePlaced,true);
});
test('混合新建和移动之后的失败不泄漏新增元件、覆盖、revision或历史',()=>{
 const e=fixture(),before=e.getSnapshot(),revision=e.revision;assert.throws(()=>e.apply([edit([{type:'addNode',pageId:'p',node:{type:'text',id:'new'}},{type:'moveNodes',pageId:'p',nodeIds:['new','a'],dx:20,dy:10},update('b',{width:-1})]) ]));assert.deepEqual(e.getSnapshot(),before);assert.equal(e.revision,revision);assert.equal(e.canUndo,false);
});
test('全部视图改一个叶属性不清同节点其他覆盖或其他节点同属性',()=>{
 const e=fixture();e.apply([{type:'setViewOverride',pageId:'p',viewId:'parent',nodeId:'a',patch:{x:40,style:{fill:'#111111',color:'#222222'}}},{type:'setViewOverride',pageId:'p',viewId:'child',nodeId:'b',patch:{style:{fill:'#333333'}}},edit([update('a',{style:{fill:'#AAAAAA'}})],'child','all')]);assert.equal(node(e,'a').style.fill,'#AAAAAA');assert.equal(node(e,'a').style.color,'#222222');assert.equal(node(e,'a').x,40);assert.equal(node(e,'b').style.fill,'#333333');
});
test('锁定祖先中的当前视图移动和取消放置失败，前一个子命令也回滚',()=>{
 const e=fixture();e.apply([{type:'createDynamicPanel',pageId:'p',panelId:'panel',nodeIds:['b']},update('panel',{locked:true})]);const before=e.getSnapshot();for(const command of [{type:'moveNodes',pageId:'p',nodeIds:['b'],dx:1,dy:1},{type:'setNodesPlaced',pageId:'p',nodeIds:['b'],placed:false}]){assert.throws(()=>e.apply([edit([update('a',{x:999}),command])]),{code:'LOCKED'});assert.deepEqual(e.getSnapshot(),before);}
});
test('新建后同批移动与隐藏的渲染结果保存重开一致，不复制派生字段',()=>{
 const e=fixture();e.apply([edit([{type:'addNode',pageId:'p',node:{type:'text',id:'new',x:10,y:20}},{type:'moveNodes',pageId:'p',nodeIds:['new'],dx:17,dy:9},update('new',{visible:false})])]);assert.equal(node(e,'new').x,27);assert.equal(node(e,'new').placed,true);assert.equal(node(e,'new').visible,false);assert.equal(node(e,'new',null).placed,false);const json=JSON.stringify(e.getSnapshot());assert(!json.includes('effectivePlaced'));const reopened=new DocumentEngine(JSON.parse(json));assert.deepEqual(node(reopened,'new'),node(e,'new'));
});
test('当前视图插入与平移实例后主定义新增节点跟随原点和放置，Base仍未放置',()=>{
 const e=fixture();e.apply([{type:'addComponent',component:{id:'component',name:'C',nodes:[makeNode('text',{id:'source',x:5,y:10})]}},edit([{type:'insertComponent',pageId:'p',componentId:'component',instanceId:'instance',x:200,y:300}])]);let group=e.getSnapshot().pages[0].groups.find(g=>g.id==='instance');e.apply([edit([{type:'moveNodes',pageId:'p',nodeIds:[group.nodeIds[0]],dx:30,dy:40}]),{type:'componentCommands',componentId:'component',commands:[{type:'addNode',pageId:'component',node:{type:'text',id:'source-new',x:25,y:20}}]}]);group=e.getSnapshot().pages[0].groups.find(g=>g.id==='instance');const original=group.nodeIds[group.sourceIds.indexOf('source')],added=group.nodeIds[group.sourceIds.indexOf('source-new')];assert.equal(node(e,original).x,235);assert.equal(node(e,added).x,255);assert.equal(node(e,added).y,360);assert.equal(node(e,added).effectivePlaced,true);assert.equal(node(e,added,null).effectivePlaced,false);
});
test('全部视图平移实例保留各视图原点差异且不重复叠加，恢复继承只移除所选原点轴',()=>{
 const e=fixture();e.apply([{type:'addComponent',component:{id:'component',name:'C',nodes:[makeNode('text',{id:'source',x:5,y:10})]}},{type:'insertComponent',pageId:'p',componentId:'component',instanceId:'instance',x:200,y:300}]);const id=e.getSnapshot().pages[0].groups.find(g=>g.id==='instance').nodeIds[0];e.apply([edit([{type:'moveNodes',pageId:'p',nodeIds:[id],dx:30,dy:40}]),edit([{type:'moveNodes',pageId:'p',nodeIds:[id],dx:10,dy:20}],'child','all')]);assert.equal(node(e,id).x,245);assert.equal(node(e,id,null).x,215);assert.equal(node(e,id).y,370);e.apply([{type:'clearInstanceViewOverride',pageId:'p',instanceId:'instance',viewId:'child',fields:['x']}]);assert.equal(node(e,id).x,215);assert.equal(node(e,id).y,370);
});

test('旧实例成员坐标覆盖与整组平移共存，恢复全部继承可同时清成员与组且锁定仍原子拒绝',()=>{
 const e=fixture();e.apply([{type:'addComponent',component:{id:'component',name:'C',nodes:[makeNode('text',{id:'source',x:5,y:10})]}},{type:'insertComponent',pageId:'p',componentId:'component',instanceId:'instance',x:200,y:300}]);let p=e.getSnapshot();const id=p.pages[0].groups.find(g=>g.id==='instance').nodeIds[0];p.pages[0].viewOverrides={parent:{[id]:{x:250}},child:{[id]:{x:270,style:{fill:'#123456'}}}};e.replace(p);
 e.apply([edit([{type:'moveNodes',pageId:'p',nodeIds:[id],dx:10,dy:20}]),{type:'componentCommands',componentId:'component',commands:[{type:'addNode',pageId:'component',node:{type:'text',id:'new-source',x:25,y:20}}]}]);p=e.getSnapshot();const group=p.pages[0].groups.find(g=>g.id==='instance'),added=group.nodeIds[group.sourceIds.indexOf('new-source')];assert.equal(node(e,id).x,280);assert.equal(node(e,added).x,235);
 const clear=[{type:'setViewOverride',pageId:'p',viewId:'child',nodeId:id,patch:null},{type:'clearInstanceViewOverride',pageId:'p',viewId:'child',instanceId:'instance'}];e.apply(clear);assert.equal(node(e,id).x,250);assert.equal(node(e,added).x,225);assert.equal(node(e,id).style.fill,node(e,id,null).style.fill);
 e.apply([{type:'lockGroup',pageId:'p',groupId:'instance',locked:true}]);const before=e.getSnapshot();assert.throws(()=>e.apply([edit([update('a',{x:999})]),...clear]),{code:'LOCKED'});assert.deepEqual(e.getSnapshot(),before);
});

test('迁移遗留的父视图成员取消放置不阻止子视图重新置入实例，组件源自身取消放置仍保留',()=>{
 const e=fixture();e.apply([{type:'addComponent',component:{id:'component',name:'C',nodes:[makeNode('text',{id:'source',x:5,y:10}),makeNode('text',{id:'source-hidden',x:25,y:20,placed:false})]}},{type:'insertComponent',pageId:'p',componentId:'component',instanceId:'instance',x:200,y:300}]);const p=e.getSnapshot(),group=p.pages[0].groups.find(g=>g.id==='instance'),id=group.nodeIds[group.sourceIds.indexOf('source')],hidden=group.nodeIds[group.sourceIds.indexOf('source-hidden')];p.pages[0].viewOverrides={parent:{[id]:{placed:false}},child:{[id]:{placed:false}}};e.replace(p);
 e.apply([edit([{type:'setNodesPlaced',pageId:'p',nodeIds:[id],placed:true}])]);assert.equal(node(e,id).effectivePlaced,true);assert.equal(node(e,id,'parent').effectivePlaced,false);assert.equal(node(e,hidden).effectivePlaced,false);
 e.apply([{type:'componentCommands',componentId:'component',commands:[{type:'addNode',pageId:'component',node:{type:'text',id:'new-source',x:45,y:30}}]}]);const after=e.getSnapshot().pages[0].groups.find(g=>g.id==='instance'),added=after.nodeIds[after.sourceIds.indexOf('new-source')];assert.equal(node(e,added).effectivePlaced,true);
});
