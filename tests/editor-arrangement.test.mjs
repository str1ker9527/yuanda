import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentEngine,createBlankProject,makeNode} from '../app/core/document.mjs';
import {arrangementUnits,alignCommands,distributionCommands,layerCommands} from '../app/core/editor-arrangement.mjs';
import {buildOutlineTree,findOutlineEntry} from '../app/core/hierarchy-model.mjs';
import {getNodeBounds} from '../app/core/widget-geometry.mjs';

const page=engine=>engine.getSnapshot().pages[0],node=(engine,id)=>page(engine).nodes.find(value=>value.id===id);
const n=id=>({kind:'node',id}),g=id=>({kind:'group',id});
function fixture(){const project=createBlankProject('排列');project.pages[0].id='p';project.pages[0].width=1000;project.pages[0].height=800;project.pages[0].nodes=[
  makeNode('rectangle',{id:'a',x:60,y:80,width:100,height:40}),makeNode('text',{id:'b',x:200,y:130,width:80,height:30}),
  makeNode('button',{id:'c',x:420,y:260,width:120,height:50}),makeNode('rectangle',{id:'d',x:780,y:510,width:60,height:70})
];return new DocumentEngine(project);}
const close=(a,b)=>assert(Math.abs(a-b)<.000002,`${a} != ${b}`);

test('首选顺序独立于页面图层顺序，六方向以首选绘制边界为基准',()=>{
  for(const kind of ['left','center','right','top','middle','bottom']){const e=fixture(),before=node(e,'c'),reference=getNodeBounds(before);const commands=alignCommands(page(e),['c','a','b'],kind);assert(commands.every(command=>command.type==='moveNodes'));assert(commands.every(command=>!command.nodeIds.includes('c')));e.apply(commands);assert.deepEqual(node(e,'c'),before);
    const actual=getNodeBounds(node(e,'a')),metric=box=>kind==='center'?(box.left+box.right)/2:kind==='middle'?(box.top+box.bottom)/2:box[kind];close(metric(actual),metric(reference));}
});
test('完整普通组作为一个对象对齐，内部相对坐标不压扁且一次撤销恢复',()=>{
  const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'pair'}]);const before=e.getSnapshot(),revision=e.revision,units=arrangementUnits(page(e),['c','b','a']);assert.deepEqual(units.map(unit=>[unit.kind,unit.id]),[['node','c'],['group','pair']]);const commands=alignCommands(page(e),['c','b','a'],'left');assert.equal(commands.length,1);assert.deepEqual(new Set(commands[0].nodeIds),new Set(['a','b']));e.apply(commands);assert.equal(node(e,'b').x-node(e,'a').x,140);assert.equal(node(e,'b').y-node(e,'a').y,50);assert.equal(node(e,'a').x,420);assert.equal(e.revision,revision+1);e.undo();assert.deepEqual(e.getSnapshot(),before);
});
test('母版选中一个子元件也整体移动，实例原点和所有内部相对位置保持正确',()=>{
  const e=fixture();e.apply([{type:'createComponent',pageId:'p',componentId:'master',name:'卡片',nodeIds:['a','b']},{type:'insertComponent',pageId:'p',componentId:'master',instanceId:'instance',x:100,y:180}]);const before=e.getSnapshot(),group=page(e).groups.find(value=>value.id==='instance'),old=group.nodeIds.map(id=>node(e,id));const units=arrangementUnits(page(e),['c',group.nodeIds[1]]);assert.equal(units[1].kind,'component');const commands=alignCommands(page(e),['c',group.nodeIds[1]],'top');e.apply(commands);const current=page(e).groups.find(value=>value.id==='instance');close(current.y-group.y,commands[0].dy);for(const [at,id]of group.nodeIds.entries()){close(node(e,id).x,old[at].x);close(node(e,id).y,old[at].y+commands[0].dy);}e.undo();assert.deepEqual(e.getSnapshot(),before);
});
test('嵌套普通组和容器子节点合并为不重叠移动单元，子节点只移动一次',()=>{
  const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'inner'},{type:'groupItems',pageId:'p',items:[g('inner'),n('c')],groupId:'outer'}]);assert.deepEqual(arrangementUnits(page(e),['b','d','a','c']).map(unit=>unit.id),['outer','d']);const before=node(e,'b');e.apply(alignCommands(page(e),['d','a','b','c'],'left'));assert.equal(node(e,'b').x-before.x,720);
  const c=fixture();c.apply([{type:'createDynamicPanel',pageId:'p',panelId:'panel'}]);const state=node(c,'panel').panel.states[0].id;c.apply([{type:'reparentItems',pageId:'p',items:[n('a'),n('b')],parent:{kind:'panelState',panelId:'panel',stateId:state}},{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'inside'}]);const prior=page(c);assert.equal(arrangementUnits(prior,['d','panel','a','b']).length,2);const commands=alignCommands(prior,['d','panel','a','b'],'top');assert.equal(commands.length,1);c.apply(commands);for(const id of ['panel','a','b'])close(node(c,id).y-prior.nodes.find(value=>value.id===id).y,commands[0].dy);
});
test('分布以三个对象而非组内成员计数，绘制边缘等距并固定空间两端',()=>{
  const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'pair'}]);const before=e.getSnapshot(),first=node(e,'a'),last=node(e,'d'),commands=distributionCommands(page(e),['c','d','b','a'],'x');assert.equal(commands.length,1);assert.deepEqual(commands[0].nodeIds,['c']);e.apply(commands);assert.deepEqual(node(e,'a'),first);assert.deepEqual(node(e,'d'),last);close(node(e,'c').x-280,node(e,'d').x-(node(e,'c').x+120));e.undo();assert.deepEqual(e.getSnapshot(),before);assert.throws(()=>distributionCommands(page(e),['a','b','c'],'x'),{code:'ARRANGEMENT_COUNT'});
});
test('作为中间对象的普通组在水平及垂直分布中整体移动，内部差值不变',()=>{
  for(const axis of ['x','y']){const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'pair'},{type:'updateNode',pageId:'p',nodeId:'c',patch:{x:0,y:0}}]);const before=e.getSnapshot(),a=node(e,'a'),b=node(e,'b'),c=node(e,'c'),d=node(e,'d'),commands=distributionCommands(page(e),['b','c','d','a'],axis);assert.equal(commands.length,1);assert.deepEqual(new Set(commands[0].nodeIds),new Set(['a','b']));e.apply(commands);assert.deepEqual(node(e,'c'),c);assert.deepEqual(node(e,'d'),d);assert.equal(node(e,'b').x-node(e,'a').x,b.x-a.x);assert.equal(node(e,'b').y-node(e,'a').y,b.y-a.y);const units=arrangementUnits(page(e),['c','a','b','d']),edge=axis==='x'?['left','right']:['top','bottom'];close(units[1].bounds[edge[0]]-units[0].bounds[edge[1]],units[2].bounds[edge[0]]-units[1].bounds[edge[1]]);e.undo();assert.deepEqual(e.getSnapshot(),before);}
});
test('旋转与当前视图外观用于绘制边界，原始文档不被规划器修改',()=>{
  const e=fixture(),raw=page(e),view=structuredClone(raw);Object.assign(view.nodes[0],{x:100,y:70,width:60,height:180,rotation:37});Object.assign(view.nodes[2],{x:600,y:400,width:120,height:40,rotation:90});const saved=structuredClone(raw),commands=alignCommands(raw,['c','a'],'right',{geometryPage:view});assert.deepEqual(raw,saved);const source=getNodeBounds(view.nodes[0]),anchor=getNodeBounds(view.nodes[2]);close(source.right+commands[0].dx,anchor.right);assert.equal(commands[0].dy,0);
});
test('单个组合以整体绘制范围对齐画布，组内坐标差不变',()=>{const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'pair'}]);e.apply(alignCommands(page(e),['b','a'],'center'));close((node(e,'a').x+node(e,'b').x+node(e,'b').width)/2,500);assert.equal(node(e,'b').x-node(e,'a').x,140);});
test('锁定元件、组、容器祖先或隐含子节点都原子拒绝，规划及引擎无写入',()=>{
  for(const mode of ['node','group','descendant','ancestor']){const e=fixture();if(mode==='group')e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'pair'},{type:'lockGroup',pageId:'p',groupId:'pair',locked:true}]);else if(mode==='node')e.apply([{type:'updateNode',pageId:'p',nodeId:'b',patch:{locked:true}}]);else{e.apply([{type:'createDynamicPanel',pageId:'p',panelId:'panel'}]);e.apply([{type:'reparentItems',pageId:'p',items:[n('b')],parent:{kind:'panelState',panelId:'panel',stateId:node(e,'panel').panel.states[0].id}},{type:'updateNode',pageId:'p',nodeId:mode==='ancestor'?'panel':'b',patch:{locked:true}}]);}
    const ids=mode==='ancestor'?['b']:mode==='descendant'?['a','panel']:['a','b','c'],saved=e.getSnapshot(),revision=e.revision;assert.throws(()=>e.apply(alignCommands(page(e),ids,'left')),{code:'LOCKED'});assert.deepEqual(e.getSnapshot(),saved);assert.equal(e.revision,revision);
  }
});
test('跨容器或状态选区拒绝，既有跨状态组合也拒绝',()=>{const e=fixture();e.apply([{type:'createDynamicPanel',pageId:'p',panelId:'panel'}]);e.apply([{type:'reparentItems',pageId:'p',items:[n('b')],parent:{kind:'panelState',panelId:'panel',stateId:node(e,'panel').panel.states[0].id}}]);const before=e.getSnapshot(),revision=e.revision;assert.throws(()=>alignCommands(page(e),['a','b'],'left'),{code:'ARRANGEMENT_SCOPE'});assert.deepEqual(e.getSnapshot(),before);assert.equal(e.revision,revision);e.apply([{type:'groupNodes',pageId:'p',groupId:'legacy',nodeIds:['a','b']}]);assert.throws(()=>arrangementUnits(page(e),['a','b']),{code:'ARRANGEMENT_SCOPE'});});
test('空选区、重复选择与已消失对象明确处理；隐藏对象不充当参照',()=>{const e=fixture();assert.deepEqual(alignCommands(page(e),[],'left'),[]);assert.equal(arrangementUnits(page(e),['c','a','c']).length,2);assert.throws(()=>arrangementUnits(page(e),['missing']),/不存在/);const geometry=page(e);geometry.nodes.find(value=>value.id==='a').effectivePlaced=false;assert.throws(()=>alignCommands(page(e),['a','b'],'left',{geometryPage:geometry}),{code:'ARRANGEMENT_HIDDEN'});});

const rootOrder=e=>buildOutlineTree(page(e)).children.map(entry=>entry.id);
test('四种层级方向按背到前顺序规划，乱序多选仍保持相对层序',()=>{
  for(const [kind,expected]of [['front',['b','d','a','c']],['back',['a','c','b','d']],['forward',['b','a','d','c']],['backward',['a','c','b','d']]]){const e=fixture(),before=e.getSnapshot(),commands=layerCommands(page(e),['c','a'],kind);assert(commands.every(value=>value.type==='reparentItems'));e.apply(commands);assert.deepEqual(rootOrder(e),expected,kind);e.undo();assert.deepEqual(e.getSnapshot(),before);}
});
test('普通组置顶保持内部实际层序，即使成员列表与绘制顺序相反',()=>{
  const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('b'),n('a')],groupId:'pair'}]);const before=e.getSnapshot(),group=page(e).groups.find(value=>value.id==='pair');assert.deepEqual(group.nodeIds,['b','a']);e.apply(layerCommands(page(e),['a','b'],'front'));assert.deepEqual(rootOrder(e),['c','d','pair']);assert.deepEqual(page(e).nodes.map(value=>value.id),['c','d','a','b']);assert.deepEqual(page(e).groups.find(value=>value.id==='pair'),group);e.undo();assert.deepEqual(e.getSnapshot(),before);
});
test('完整母版与局部命中均整体调整层级，实例关系和元件数据保持不变',()=>{
  for(const partial of [false,true]){const e=fixture();e.apply([{type:'createComponent',pageId:'p',componentId:'master',name:'卡片',nodeIds:['a','b']},{type:'insertComponent',pageId:'p',componentId:'master',instanceId:'instance',x:100,y:180}]);const before=e.getSnapshot(),group=page(e).groups.find(value=>value.id==='instance'),saved=group.nodeIds.map(id=>node(e,id)),commands=layerCommands(page(e),partial?group.nodeIds.slice(0,1):group.nodeIds,'back');assert.deepEqual(commands[0].items,[g('instance')]);e.apply(commands);assert.equal(rootOrder(e)[0],'instance');assert.deepEqual(page(e).groups.find(value=>value.id==='instance'),group);assert.deepEqual(group.nodeIds.map(id=>node(e,id)),saved);e.undo();assert.deepEqual(e.getSnapshot(),before);}
});
test('普通组内置顶不越过外部对象，组的成员关系完全保留',()=>{
  const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'pair'}]);const group=structuredClone(page(e).groups[0]);const commands=layerCommands(page(e),['a'],'front');assert.deepEqual(commands[0].parent,{kind:'group',groupId:'pair'});e.apply(commands);assert.deepEqual(page(e).nodes.map(value=>value.id),['b','a','c','d']);assert.deepEqual(page(e).groups[0],group);assert.deepEqual(rootOrder(e),['pair','c','d']);assert.deepEqual(findOutlineEntry(buildOutlineTree(page(e)),'group:pair').children.map(entry=>entry.id),['b','a']);assert.deepEqual(layerCommands(page(e),['a'],'forward'),[]);
});
test('嵌套组内部层级操作保留祖先边界与未选中子组',()=>{
  const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'inner'},{type:'groupItems',pageId:'p',items:[g('inner'),n('c')],groupId:'outer'}]);const before=page(e),commands=layerCommands(before,['a','b'],'front');assert.deepEqual(commands[0].parent,{kind:'group',groupId:'outer'});e.apply(commands);assert.deepEqual(page(e).nodes.map(value=>value.id),['c','a','b','d']);assert.deepEqual(page(e).groups,before.groups);assert.deepEqual(rootOrder(e),['outer','d']);
});
test('面板状态和中继器模板同级层序只改变各自列表，不跳出父容器',()=>{
  for(const type of ['panel','repeater']){const e=fixture();e.apply([type==='panel'?{type:'createDynamicPanel',pageId:'p',panelId:'owner'}:{type:'createRepeater',pageId:'p',nodeId:'owner'}]);const parent=type==='panel'?{kind:'panelState',panelId:'owner',stateId:node(e,'owner').panel.states[0].id}:{kind:'repeater',nodeId:'owner'};e.apply([{type:'reparentItems',pageId:'p',items:[n('a'),n('b'),n('c')],parent}]);const before=rootOrder(e),commands=layerCommands(page(e),['a'],'front');assert.deepEqual(commands[0].parent,parent);e.apply(commands);assert.deepEqual(type==='panel'?node(e,'owner').panel.states[0].nodeIds:node(e,'owner').repeater.templateIds,['b','c','a']);assert.deepEqual(rootOrder(e),before);}
});
test('层级混合父组与锁定对象原子拒绝，最前最末及全部选中为空操作',()=>{
  const e=fixture();e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('b')],groupId:'pair'}]);let before=e.getSnapshot(),revision=e.revision;assert.throws(()=>layerCommands(page(e),['a','c'],'front'),{code:'ARRANGEMENT_SCOPE'});assert.deepEqual(e.getSnapshot(),before);assert.equal(e.revision,revision);assert.deepEqual(layerCommands(page(e),['d'],'forward'),[]);assert.deepEqual(layerCommands(page(e),['a','b'],'backward'),[]);assert.deepEqual(layerCommands(page(e),['d','c','b','a'],'front'),[]);
  e.apply([{type:'lockGroup',pageId:'p',groupId:'pair',locked:true}]);before=e.getSnapshot();revision=e.revision;assert.throws(()=>e.apply(layerCommands(page(e),['b','a'],'front')),{code:'LOCKED'});assert.deepEqual(e.getSnapshot(),before);assert.equal(e.revision,revision);
});
test('层级操作允许隐藏元件，保持视图数据和坐标',()=>{const e=fixture();e.apply([{type:'updateNode',pageId:'p',nodeId:'a',patch:{visible:false}}]);const before=node(e,'a');e.apply(layerCommands(page(e),['a'],'front'));assert.deepEqual(node(e,'a'),before);assert.equal(rootOrder(e).at(-1),'a');});
test('非连续组内四种排列只交换组成员槽位，夹在其中的外部对象与父层级不变',()=>{
  for(const scope of ['root','panel','repeater'])for(const [kind,id]of [['back','c'],['backward','c'],['front','a'],['forward','a']]){
    const e=fixture();let treeKey='root',owner;
    if(scope!=='root'){
      e.apply([scope==='panel'?{type:'createDynamicPanel',pageId:'p',panelId:'owner'}:{type:'createRepeater',pageId:'p',nodeId:'owner'}]);
      owner=scope==='panel'?{kind:'panelState',panelId:'owner',stateId:node(e,'owner').panel.states[0].id}:{kind:'repeater',nodeId:'owner'};
      treeKey=scope==='panel'?`state:owner:${owner.stateId}`:'template:owner';
      e.apply([{type:'reparentItems',pageId:'p',items:['a','b','c','d'].map(n),parent:owner}]);
    }
    e.apply([{type:'groupItems',pageId:'p',items:[n('a'),n('c')],groupId:'pair'}]);
    const before=e.getSnapshot(),revision=e.revision,scopeTree=()=>{const tree=buildOutlineTree(page(e));return treeKey==='root'?tree:findOutlineEntry(tree,treeKey);},outerBefore=scopeTree().children.map(entry=>entry.id);
    assert.deepEqual(outerBefore,['b','pair','d']);e.apply(layerCommands(page(e),[id],kind));
    assert.deepEqual(page(e).nodes.filter(value=>['a','b','c','d'].includes(value.id)).map(value=>value.id),['c','b','a','d'],`${scope} ${kind}`);
    assert.deepEqual(scopeTree().children.map(entry=>entry.id),outerBefore);assert.deepEqual(page(e).groups,before.pages[0].groups);assert.equal(e.revision,revision+1);
    if(scope==='panel')assert.deepEqual(node(e,'owner').panel.states[0].nodeIds,['c','b','a','d']);
    if(scope==='repeater')assert.deepEqual(node(e,'owner').repeater.templateIds,['c','b','a','d']);
    for(const outside of ['b','d'])assert.deepEqual(node(e,outside),before.pages[0].nodes.find(value=>value.id===outside));
    e.undo();assert.deepEqual(e.getSnapshot(),before);
  }
});
test('带面板或中继器后代的母版四方向排列保持完整目标层序与内部归属',()=>{
  for(const type of ['panel','repeater']){
    const e=fixture();e.apply([type==='panel'?{type:'createDynamicPanel',pageId:'p',panelId:'holder',nodeIds:['a']}:{type:'createRepeater',pageId:'p',nodeId:'holder',nodeIds:['a']}]);e.apply([{type:'createComponent',pageId:'p',componentId:'master',name:'容器母版',nodeIds:['holder']},{type:'insertComponent',pageId:'p',componentId:'master',instanceId:'instance',x:90,y:70}]);
    const baseline=e.getSnapshot(),group=page(e).groups.find(value=>value.id==='instance'),originalNodes=group.nodeIds.map(id=>node(e,id)),others=rootOrder(e).filter(id=>id!=='instance');
    assert.equal(group.nodeIds.length,2);
    for(const [kind,position]of [['back',0],['front',others.length],['backward',others.length-1],['forward',others.length]]){
      const expected=[...others];expected.splice(position,0,'instance');e.apply(layerCommands(page(e),group.nodeIds,kind));assert.deepEqual(rootOrder(e),expected,`${type} ${kind}`);assert.deepEqual(page(e).groups.find(value=>value.id==='instance'),group);assert.deepEqual(group.nodeIds.map(id=>node(e,id)),originalNodes);
    }
    e.undo();e.undo();e.undo();e.undo();assert.deepEqual(e.getSnapshot(),baseline);
  }
});
test('非连续普通组内移动容器母版时，外部同级对象与祖先组层级保持不变',()=>{
  const e=fixture();e.apply([{type:'createDynamicPanel',pageId:'p',panelId:'holder',nodeIds:['a']},{type:'createComponent',pageId:'p',componentId:'master',name:'容器母版',nodeIds:['holder']},{type:'insertComponent',pageId:'p',componentId:'master',instanceId:'instance',x:20,y:30}]);const group=page(e).groups.find(value=>value.id==='instance');e.apply([{type:'groupItems',pageId:'p',items:[n('b'),g('instance')],groupId:'outer'}]);const before=e.getSnapshot(),outer=rootOrder(e),unselected=node(e,'c');e.apply(layerCommands(page(e),group.nodeIds,'back'));assert.deepEqual(rootOrder(e),outer);assert.deepEqual(node(e,'c'),unselected);assert.deepEqual(findOutlineEntry(buildOutlineTree(page(e)),'group:outer').children.map(entry=>entry.id),['instance','b']);e.apply(layerCommands(page(e),group.nodeIds,'front'));assert.deepEqual(rootOrder(e),outer);assert.deepEqual(findOutlineEntry(buildOutlineTree(page(e)),'group:outer').children.map(entry=>entry.id),['b','instance']);e.undo();e.undo();assert.deepEqual(e.getSnapshot(),before);
});
test('移动普通对象或混合选择时，所有受影响容器母版按目标层序保持完整成员块',()=>{
  const expectations={
    ordinary:{back:['b','c','second','first','holder','d'],front:['second','first','holder','d','b','c'],forward:['second','first','holder','d','b','c'],backward:['second','first','b','c','holder','d']},
    mixed:{back:['first','c','second','holder','b','d'],front:['second','holder','b','d','first','c'],forward:['second','holder','first','b','d','c'],backward:['first','second','holder','c','b','d']}
  };
  for(const type of ['panel','repeater'])for(const selection of ['ordinary','mixed'])for(const kind of ['back','front','forward','backward']){
    const e=fixture();e.apply([type==='panel'?{type:'createDynamicPanel',pageId:'p',panelId:'holder',nodeIds:['a']}:{type:'createRepeater',pageId:'p',nodeId:'holder',nodeIds:['a']}]);e.apply([{type:'createComponent',pageId:'p',componentId:'master',name:'容器母版',nodeIds:['holder']},{type:'insertComponent',pageId:'p',componentId:'master',instanceId:'first',x:30,y:40},{type:'insertComponent',pageId:'p',componentId:'master',instanceId:'second',x:400,y:300}]);
    const first=page(e).groups.find(value=>value.id==='first'),second=page(e).groups.find(value=>value.id==='second');
    e.apply(layerCommands(page(e),first.nodeIds,'back'));e.apply(layerCommands(page(e),second.nodeIds,'back'));assert.deepEqual(rootOrder(e),['second','first','holder','b','c','d']);
    const before=e.getSnapshot(),revision=e.revision,ids=selection==='ordinary'?['c','b']:['c',...first.nodeIds];e.apply(layerCommands(page(e),ids,kind));assert.deepEqual(rootOrder(e),expectations[selection][kind],`${type} ${selection} ${kind}`);
    assert.deepEqual(page(e).groups,before.pages[0].groups);for(const prior of before.pages[0].nodes)assert.deepEqual(node(e,prior.id),prior);assert.equal(e.revision,revision+1);e.undo();assert.deepEqual(e.getSnapshot(),before);
  }
});
