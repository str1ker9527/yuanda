import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentEngine,createBlankProject,makeNode,validateProject} from '../app/core/document.mjs';
import {STYLE_KEYS,resolveNodeStateStyles} from '../app/core/style-model.mjs';
import {resolveContainerView} from '../app/core/view-model.mjs';

function fixture(){const p=createBlankProject('样式边界独立验收');p.id='inheritance-boundary';p.pages[0].id='p';return new DocumentEngine(p);}
const snapshot=e=>e.getSnapshot();
const at=(e,id,view=null)=>resolveContainerView(snapshot(e),'p',view).nodes.find(n=>n.id===id);
const update=(id,style)=>({type:'updateNode',pageId:'p',nodeId:id,patch:{style}});
function rejectWithoutChange(e,commands){const before=snapshot(e),revision=e.revision,undo=e.canUndo,redo=e.canRedo;assert.throws(()=>e.apply(commands));assert.deepEqual(snapshot(e),before);assert.equal(e.revision,revision);assert.equal(e.canUndo,undo);assert.equal(e.canRedo,redo);}
function setup(e){e.apply([
  {type:'addDefaultStyleSet',defaultStyleSet:{id:'defaults',name:'默认',byType:{button:{style:{fontSize:18},stateStyles:{hover:{opacity:.5,fill:'#AAAAAA'}}}}}},
  {type:'setProjectDefaultStyleSet',defaultStyleSetId:'defaults'},
  {type:'addStyle',style:{id:'parent',name:'父',style:{fill:'#111111',fontSize:20},stateStyles:{hover:{fill:'#BBBBBB'}}}},
  {type:'addStyle',style:{id:'child',name:'子',parentId:'parent',style:{color:'#FFFFFF'},stateStyles:{hover:{stroke:'#CCCCCC'}}}},
  {type:'addNode',pageId:'p',node:{id:'a',type:'button',styleId:'child'}},
  {type:'addNode',pageId:'p',node:{id:'b',type:'button',styleId:'child'}}
]);}

test('真实旧版来源元数据缺失时保留独立、相等关联与差异关联三个外观及稀疏状态',()=>{
  const old=createBlankProject('旧文件');old.id='old-project';old.pages[0].id='p';
  const named=makeNode('button').style;
  old.styles=[{id:'old-style',name:'旧共享',style:structuredClone(named)}];
  old.pages[0].nodes=[makeNode('button',{id:'same',styleId:'old-style'}),makeNode('button',{id:'different',styleId:'old-style',style:{fontSize:27,fill:'#123456'},stateStyles:{hover:{fill:'#ABCDEF'}}}),makeNode('text',{id:'standalone',style:{fontSize:31}})];
  old.viewSets=[{id:'legacy-views',name:'旧尺寸',views:[{id:'narrow',name:'小屏',parentId:null,minWidth:0,width:400,height:800}]}];old.pages[0].viewSetId='legacy-views';old.pages[0].viewOverrides={narrow:{different:{style:{padding:{top:1,right:2,bottom:3,left:4},color:'#222222'}}}};
  for(const key of ['styleInheritanceVersion','defaultStyleSets','defaultStyleSetId'])delete old[key];
  for(const node of old.pages[0].nodes){delete node.styleOverrideKeys;delete node.defaultStyleSetId;}
  const before=structuredClone(old),e=new DocumentEngine(old),after=snapshot(e);
  assert.deepEqual(old,before);assert.equal(after.styleInheritanceVersion,1);
  assert.deepEqual(after.defaultStyleSets,[]);assert.equal(after.defaultStyleSetId,null);
  for(const node of before.pages[0].nodes){assert.deepEqual(at(e,node.id).style,node.style);assert.deepEqual(after.pages[0].nodes.find(n=>n.id===node.id).stateStyles,node.stateStyles);}
  assert.deepEqual(new Set(at(e,'different').styleOverrideKeys),new Set(['fontSize','fill']));assert.deepEqual(at(e,'same').styleOverrideKeys,[]);assert.deepEqual(new Set(at(e,'standalone').styleOverrideKeys),new Set(STYLE_KEYS));
  assert.deepEqual(at(e,'different','narrow').style,{...before.pages[0].nodes[1].style,...before.pages[0].viewOverrides.narrow.different.style});
  e.apply([{type:'updateStyle',styleId:'old-style',patch:{style:{fontSize:40,color:'#333333'}}}]);
  assert.equal(at(e,'same').style.fontSize,40);assert.equal(at(e,'different').style.fontSize,27);assert.equal(at(e,'different').style.color,'#333333');assert.equal(at(e,'different','narrow').style.color,'#222222');
});

test('未参与继承的坏缓存仍拒绝，默认与命名状态错误不能被更高层掩盖',()=>{
  const e=fixture();setup(e);const original=snapshot(e);
  const mutate=[
    p=>{p.pages[0].nodes[0].style.opacity=7;},
    p=>{p.styles.find(s=>s.id==='child').style.fillPaint={type:'unknown'};},
    p=>{p.styles.find(s=>s.id==='parent').stateStyles.hover.opacity=-1;},
    p=>{p.defaultStyleSets[0].byType.button.stateStyles.hover.fill='url(https://example.com)';},
    p=>{p.pages[0].nodes[0].styleOverrideKeys=['fill','fill'];},
    p=>{p.pages[0].nodes[0].styleOverrideKeys=['__proto__'];},
    p=>{p.pages[0].nodes[0].defaultStyleSetId='missing';},
    p=>{p.defaultStyleSets[0].id='parent';p.defaultStyleSetId='parent';},
    p=>{p.styles.find(s=>s.id==='parent').parentId='child';}
  ];
  for(const change of mutate){const bad=structuredClone(original);change(bad);const before=structuredClone(bad);assert.throws(()=>new DocumentEngine(bad));assert.throws(()=>validateProject(bad));assert.deepEqual(bad,before);}
  assert.deepEqual(snapshot(e),original);
});

test('显式同值保持覆盖意图，null和删除是不同操作，状态只清所选层字段',()=>{
  const e=fixture();setup(e);e.apply([update('a',{fontSize:20,padding:null}),{type:'updateNode',pageId:'p',nodeId:'a',patch:{stateStyles:{hover:{fill:'#BBBBBB'}}}}]);
  e.apply([{type:'updateStyle',styleId:'parent',patch:{style:{fontSize:29,padding:{top:7,right:8,bottom:9,left:10}},stateStyles:{hover:{fill:'#DDDDDD'}}}}]);
  assert.equal(at(e,'a').style.fontSize,20);assert.equal(at(e,'a').style.padding,null);assert.equal(at(e,'b').style.fontSize,29);
  const raw=snapshot(e).pages[0].nodes.find(n=>n.id==='a'),states=resolveNodeStateStyles(snapshot(e),raw);
  assert.deepEqual(states.hover,{opacity:.5,fill:'#BBBBBB',stroke:'#CCCCCC'});
  e.apply([{type:'clearStyleOverrides',pageId:'p',nodeIds:['a'],keys:['fontSize','padding']},{type:'clearStyleOverrides',pageId:'p',nodeIds:['a'],state:'hover',keys:['fill']}]);
  assert.equal(at(e,'a').style.fontSize,29);assert.deepEqual(at(e,'a').style.padding,{top:7,right:8,bottom:9,left:10});
  const after=snapshot(e),state=resolveNodeStateStyles(after,after.pages[0].nodes.find(n=>n.id==='a'));
  assert.deepEqual(state.hover,{opacity:.5,fill:'#DDDDDD',stroke:'#CCCCCC'});assert.equal(after.pages[0].nodes.find(n=>n.id==='a').stateStyles.hover?.fill,undefined);
});

test('父链循环、过深、未使用字段错误和使用中默认集删除均原子回滚',()=>{
  const e=fixture();setup(e);
  for(const command of [
    {type:'setStyleParent',styleId:'parent',parentId:'child'},
    {type:'removeDefaultStyleSet',defaultStyleSetId:'defaults'},
    {type:'updateDefaultStyleSet',defaultStyleSetId:'defaults',patch:{byType:{button:{style:{fontSize:0},stateStyles:{}}}}},
    {type:'applyStyleSnapshot',pageId:'p',nodeIds:['a','b'],snapshot:{style:{shadows:[{inset:false,x:0,y:0,blur:-1,spread:0,color:'#000000',opacity:1}]}}}
  ])rejectWithoutChange(e,[{type:'renameProject',name:'不能泄漏'},command]);
  const commands=[];for(let i=0;i<33;i++)commands.push({type:'addStyle',style:{id:'depth-'+i,name:'深度'+i,parentId:i?'depth-'+(i-1):null,style:{}}});rejectWithoutChange(e,commands);
});

test('当前视图只复制普通外观，不泄漏Base来源/状态；状态格式刷明确拒绝',()=>{
  const e=fixture();setup(e);e.apply([{type:'addViewSet',viewSet:{id:'sizes',name:'尺寸',views:[{id:'small',name:'小',parentId:null,minWidth:0,width:400,height:800}]}},{type:'setPageViewSet',pageId:'p',viewSetId:'sizes'}]);
  const before=snapshot(e),wrap=commands=>({type:'viewCommands',pageId:'p',viewId:'small',scope:'current',commands});
  e.apply([wrap([{type:'applyStyleSnapshot',pageId:'p',nodeIds:['a'],snapshot:{style:{fontSize:36,fill:'#EFEFEF'}}}])]);
  assert.deepEqual(snapshot(e).pages[0].nodes,before.pages[0].nodes);assert.equal(at(e,'a').style.fontSize,20);assert.equal(at(e,'a','small').style.fontSize,36);
  rejectWithoutChange(e,[wrap([{type:'applyStyleSnapshot',pageId:'p',nodeIds:['a'],snapshot:{style:{opacity:.5},stateStyles:{hover:{fill:'#000000'}}}}])]);
  rejectWithoutChange(e,[wrap([{type:'updateStyleFromNode',pageId:'p',nodeId:'a',styleId:'child',keys:['fontSize']}])]);
});

test('多目标格式刷不改内容/结构或共享引用，锁定一项整笔失败，源删除不改变快照',()=>{
  const e=fixture();setup(e);e.apply([update('a',{fontSize:33,letterSpacing:2}),{type:'updateNode',pageId:'p',nodeId:'b',patch:{text:'保留目标',locked:true}}]);
  const captured={style:{fontSize:at(e,'a').style.fontSize,letterSpacing:at(e,'a').style.letterSpacing}};
  rejectWithoutChange(e,[{type:'applyStyleSnapshot',pageId:'p',nodeIds:['a','b'],snapshot:captured}]);
  e.apply([{type:'removeNodes',pageId:'p',nodeIds:['a']},{type:'updateNode',pageId:'p',nodeId:'b',patch:{locked:false}},{type:'applyStyleSnapshot',pageId:'p',nodeIds:['b'],snapshot:captured}]);
  captured.style.fontSize=99;assert.equal(at(e,'b').style.fontSize,33);assert.equal(at(e,'b').text,'保留目标');assert.equal(at(e,'b').styleId,'child');
  const after=snapshot(e);assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(),after);e.undo();assert.equal(at(e,'b').locked,true);assert(at(e,'a'));e.redo();assert.deepEqual(snapshot(e),after);
});

test('删除中间样式只接续被删层，仍继续跟随祖父未覆盖的普通与状态属性',()=>{
  const e=fixture();e.apply([
    {type:'addStyle',style:{id:'grand',name:'祖父',style:{fontSize:20,letterSpacing:1},stateStyles:{hover:{stroke:'#111111'}}}},
    {type:'addStyle',style:{id:'middle',name:'中间',parentId:'grand',style:{fill:'#AAAAAA'},stateStyles:{hover:{opacity:.4}}}},
    {type:'addStyle',style:{id:'leaf',name:'末级',parentId:'middle',style:{color:'#EEEEEE'},stateStyles:{hover:{fill:'#BBBBBB'}}}},
    {type:'addNode',pageId:'p',node:{id:'a',type:'button',styleId:'leaf'}}
  ]);
  const oldVisual=at(e,'a');e.apply([{type:'removeStyle',styleId:'middle'}]);assert.deepEqual(at(e,'a').style,oldVisual.style);assert.deepEqual(at(e,'a').stateStyles,oldVisual.stateStyles);
  assert.equal(snapshot(e).styles.find(s=>s.id==='leaf').parentId,'grand');
  e.apply([{type:'updateStyle',styleId:'grand',patch:{style:{fontSize:31,letterSpacing:3},stateStyles:{hover:{stroke:'#333333'}}}}]);
  const visual=at(e,'a');assert.equal(visual.style.fontSize,31);assert.equal(visual.style.letterSpacing,3);assert.equal(visual.style.fill,'#AAAAAA');assert.equal(visual.style.color,'#EEEEEE');assert.deepEqual(visual.stateStyles.hover,{stroke:'#333333',opacity:.4,fill:'#BBBBBB'});
});
