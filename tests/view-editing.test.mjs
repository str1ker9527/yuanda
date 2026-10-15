import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankProject, DocumentEngine, makeNode } from '../app/core/document.mjs';
import { resolveContainerView } from '../app/core/view-model.mjs';

function fixture() {
  const p=createBlankProject('视图编辑');p.id='view-project';p.pages[0].id='home';
  p.pages[0].nodes=[makeNode('text',{id:'title',text:'共享标题',x:30,y:40}),makeNode('rectangle',{id:'box',x:80,y:100})];
  p.viewSets=[{id:'sizes',name:'网页尺寸',views:[
    {id:'tablet',name:'平板',parentId:null,minWidth:600,width:768,height:900},
    {id:'phone',name:'手机',parentId:'tablet',minWidth:0,width:390,height:844},
    {id:'wide',name:'桌面',parentId:null,minWidth:1000,width:1200,height:900}
  ]}];
  p.pages[0].viewSetId='sizes';p.pages[0].viewOverrides={tablet:{title:{x:100,style:{fill:'#FFFFFF',color:'#333333'}}},phone:{title:{x:20,style:{color:'#111111'}}}};
  return new DocumentEngine(p);
}
const scoped=(commands,viewId='phone',scope='current',pageId='home')=>({type:'viewCommands',pageId,viewId,scope,commands});
const update=patch=>({type:'updateNode',pageId:'home',nodeId:'title',patch});
const read=(engine,viewId=null,pageId='home')=>resolveContainerView(engine.getSnapshot(),pageId,viewId);
const title=(engine,viewId=null)=>read(engine,viewId).nodes.find(n=>n.id==='title');

test('当前视图普通属性编辑继承到后代，基础与兄弟不被写回，撤销恢复整笔',()=>{
  const e=fixture(),before=e.getSnapshot();
  e.apply([scoped([update({y:160,style:{fill:'#EEEEEE'}})],'tablet')]);
  assert.equal(title(e).y,40);assert.equal(title(e,'wide').y,40);assert.equal(title(e,'tablet').y,160);assert.equal(title(e,'phone').y,160);
  assert.equal(title(e,'phone').style.fill,'#EEEEEE');assert.equal(title(e,'phone').style.color,'#111111');
  const after=e.getSnapshot();e.undo();assert.deepEqual(e.getSnapshot(),before);e.redo();assert.deepEqual(e.getSnapshot(),after);
});
test('全部视图设样式只移除对应叶覆盖，不覆盖不相关色彩和尺寸',()=>{
  const e=fixture();e.apply([scoped([update({style:{fill:'#FAFAFA'}})],'phone','all')]);
  for(const id of [null,'tablet','phone','wide'])assert.equal(title(e,id).style.fill,'#FAFAFA');
  assert.equal(title(e,'phone').style.color,'#111111');assert.equal(title(e,'tablet').x,100);
});
test('全部视图平移保持各布局差异，继承位置不重复加位移',()=>{
  const e=fixture();e.apply([scoped([{type:'moveNodes',pageId:'home',nodeIds:['title'],dx:7,dy:9}],'phone','all')]);
  assert.deepEqual([null,'tablet','phone','wide'].map(id=>title(e,id).x),[37,107,27,37]);
  assert.deepEqual([null,'tablet','phone','wide'].map(id=>title(e,id).y),[49,49,49,49]);
});
test('当前视图平移从已解析的位置起算，连续排队相对移动正确',()=>{
  const e=fixture(),move={type:'moveNodes',pageId:'home',nodeIds:['title'],dx:4,dy:2};
  e.apply([scoped([move,move])]);assert.equal(title(e,'phone').x,28);assert.equal(title(e).x,30);assert.equal(title(e,'tablet').x,100);
});
test('子视图新建与删除使用置入状态，保留节点及交互引用',()=>{
  const e=fixture();e.apply([scoped([{type:'addNode',pageId:'home',node:{type:'button',id:'new',text:'仅平板树'}}],'tablet')]);
  const n=id=>read(e,id).nodes.find(n=>n.id==='new');
  assert.equal(n(null).placed,false);assert.equal(n('wide').placed,false);assert.equal(n('tablet').placed,true);assert.equal(n('phone').placed,true);
  e.apply([scoped([{type:'removeNodes',pageId:'home',nodeIds:['new']}],'phone')]);
  assert.equal(n('phone').placed,false);assert.equal(n('tablet').placed,true);assert.ok(e.getSnapshot().pages[0].nodes.some(n=>n.id==='new'));
  e.apply([scoped([{type:'setNodesPlaced',pageId:'home',nodeIds:['new'],placed:true}])]);assert.equal(n('phone').placed,true);
  e.apply([scoped([{type:'removeNodes',pageId:'home',nodeIds:['new']}],null)]);assert.ok(!e.getSnapshot().pages[0].nodes.some(n=>n.id==='new'));
});
test('旧文字覆盖读回保持，只有显式编辑对应文字才清理它的旧覆盖',()=>{
  const p=createBlankProject();p.pages[0].id='home';p.pages[0].nodes=[makeNode('text',{id:'title',text:'Base'})];
  p.pages[0].views=[{id:'old',name:'旧窄屏',minWidth:0,width:400,height:800,overrides:{title:{text:'旧覆盖',x:55}}}];
  const e=new DocumentEngine(p);assert.equal(title(e,'old').text,'旧覆盖');
  e.apply([scoped([update({y:80})],'old')]);assert.equal(title(e,'old').text,'旧覆盖');
  e.apply([scoped([update({text:'共享新文字'})],'old')]);assert.equal(title(e).text,'共享新文字');assert.equal(title(e,'old').text,'共享新文字');assert.equal(title(e,'old').x,55);
});
test('实例在当前视图平移后保留稳定映射和基础位置，置入可按视图改变',()=>{
  const e=fixture();e.apply([{type:'addComponent',component:{id:'card',name:'卡片',nodes:[makeNode('text',{id:'source',x:5,y:5})]}},{type:'insertComponent',pageId:'home',componentId:'card',instanceId:'instance',x:200,y:100}]);
  const id=e.getSnapshot().pages[0].groups.find(g=>g.id==='instance').nodeIds[0];
  e.apply([scoped([{type:'moveNodes',pageId:'home',nodeIds:[id],dx:20,dy:30}])]);
  assert.equal(read(e).nodes.find(n=>n.id===id).x,205);assert.equal(read(e,'phone').nodes.find(n=>n.id===id).x,225);
  assert.equal(e.getSnapshot().pages[0].groups.find(g=>g.id==='instance').x,200);
  e.apply([scoped([{type:'setNodesPlaced',pageId:'home',nodeIds:[id],placed:false}],null,'all')]);
  for(const view of [null,'phone'])assert.equal(read(e,view).nodes.find(n=>n.id===id).placed,false);
  e.apply([scoped([{type:'setNodesPlaced',pageId:'home',nodeIds:[id],placed:true}])]);assert.equal(read(e,'phone').nodes.find(n=>n.id===id).placed,true);
});
test('锁定、跨画布与非法值整批回滚，不能用视图包装绕过限制',()=>{
  const e=fixture();e.apply([{type:'updateNode',pageId:'home',nodeId:'box',patch:{locked:true}}]);const before=e.getSnapshot();
  assert.throws(()=>e.apply([scoped([update({x:900}),{type:'updateNode',pageId:'home',nodeId:'box',patch:{x:80}}])]),{code:'LOCKED'});
  assert.deepEqual(e.getSnapshot(),before);
  assert.throws(()=>e.apply([scoped([{type:'updateNode',pageId:'elsewhere',nodeId:'title',patch:{x:1}}])]),/其他画布/);
  assert.throws(()=>e.apply([scoped([update({width:-1})])]),/尺寸|宽度/);assert.deepEqual(e.getSnapshot(),before);
});
test('保存重开保留视图编辑；派生有效置入字段从不写入文件',()=>{
  const e=fixture();e.apply([scoped([update({x:77,text:'保存后的标题'})])]);const saved=JSON.stringify(e.getSnapshot());
  assert.ok(!saved.includes('effectivePlaced'));assert.deepEqual(new DocumentEngine(JSON.parse(saved)).getSnapshot(),e.getSnapshot());
});
test('嵌套批次实际叶操作超过1000拒绝，禁止视图包再次嵌套',()=>{
  const e=fixture();assert.throws(()=>e.apply([scoped([scoped([update({x:1})])])]),/局部编辑/);
  assert.throws(()=>e.apply([scoped(Array.from({length:600},()=>update({x:1}))),scoped(Array.from({length:600},()=>update({x:2})))]),/1000/);
});

test('子视图实例原点与整实例置入随母版新增和调整内容保持有效',()=>{
  const e=fixture();e.apply([{type:'addComponent',component:{id:'growing-card',name:'可扩展卡片',nodes:[makeNode('text',{id:'first-source',x:5,y:10})]}}]);
  e.apply([scoped([{type:'insertComponent',pageId:'home',componentId:'growing-card',instanceId:'growing-instance',x:200,y:300}])]);
  let group=e.getSnapshot().pages[0].groups.find(g=>g.id==='growing-instance');
  e.apply([scoped([{type:'moveNodes',pageId:'home',nodeIds:group.nodeIds,dx:20,dy:40}])]);
  e.apply([{type:'componentCommands',componentId:'growing-card',commands:[{type:'addNode',node:{type:'text',id:'second-source',x:17,y:60}},{type:'updateNode',nodeId:'first-source',patch:{x:15}}]}]);
  group=e.getSnapshot().pages[0].groups.find(g=>g.id==='growing-instance');
  const first=group.nodeIds[group.sourceIds.indexOf('first-source')],second=group.nodeIds[group.sourceIds.indexOf('second-source')];
  assert.equal(read(e,'phone').nodes.find(n=>n.id===first).x,235);assert.equal(read(e,'phone').nodes.find(n=>n.id===second).x,237);
  assert.equal(read(e,'phone').nodes.find(n=>n.id===second).effectivePlaced,true);assert.equal(read(e,null).nodes.find(n=>n.id===second).effectivePlaced,false);
  e.apply([scoped([{type:'moveNodes',pageId:'home',nodeIds:group.nodeIds,dx:5,dy:0}],'phone','all')]);
  assert.equal(read(e,'phone').nodes.find(n=>n.id===first).x,240);
  e.apply([{type:'clearInstanceViewOverride',pageId:'home',instanceId:group.id,viewId:'phone',fields:['x']}]);
  assert.equal(read(e,'phone').nodes.find(n=>n.id===first).x,220);assert.equal(read(e,'phone').nodes.find(n=>n.id===second).effectivePlaced,true);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(e.getSnapshot()))).getSnapshot(),e.getSnapshot());
});
