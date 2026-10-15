/** Reproducible original responsive/component-view demo; previous outputs are retained. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createBlankProject,makeNode,DocumentEngine} from '../app/core/document.mjs';
import {exportHtml} from '../app/core/html-export.mjs';
import {resolveContainerView} from '../app/core/view-model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const p=createBlankProject('同一份设计，适合不同屏幕');p.id='view-demo-project';const page=p.pages[0];page.id='view-demo-home';page.name='响应式体验';page.width=1200;page.height=850;
const node=(type,id,text,x,y,width,height,extra={})=>makeNode(type,{id,name:text||id,text,x,y,width,height,...extra});
const label=(id,text,x,y,width,height,size=16)=>node('text',id,text,x,y,width,height,{style:{fontSize:size,color:'#191919',fontWeight:size>24?600:400}});
page.nodes=[label('demo-heading','一份内容，三种布局。',48,40,1104,52,34),label('demo-intro','先在卡片里输入一句话、点几次按钮，再切换尺寸。内容和计数会留下，排版会变化。',48,108,1104,56,16),label('view-change-log','选择上方尺寸，或拖动浏览器窗口。',48,232,1104,36,14),label('wide-note','宽屏补充说明：在手机视图中，这段内容被取消放置；其他内容依然可以操作。',48,640,1104,70,15)];
for(const [id,text,x,viewId]of [['show-wide','桌面',48,'page-wide'],['show-tablet','平板',188,'page-tablet'],['show-phone','手机',328,'page-phone']])page.nodes.push(node('button',id,text,x,180,120,38,{interactions:[{event:'click',actions:[{type:'setAdaptiveView',mode:'view',viewId}]}]}));
page.interactions=[['page-phone','手机'],['page-tablet','平板'],['page-wide','桌面']].map(([id,label])=>({event:'adaptiveViewChange',condition:{op:'eq',args:[{op:'event',name:'viewId'},id]},actions:[{type:'setText',targetId:'view-change-log',value:`已切换到${label}布局 · 输入和计数保留`}]}));
p.variables=[{name:'demoCount',type:'number',value:0}];
p.viewSets=[{id:'demo-sizes',name:'桌面 / 平板 / 手机',views:[{id:'page-wide',name:'桌面',parentId:null,minWidth:1000,width:1200,height:850},{id:'page-tablet',name:'平板',parentId:null,minWidth:600,width:768,height:850},{id:'page-phone',name:'手机',parentId:'page-tablet',minWidth:0,width:390,height:920}]}];
page.viewSetId='demo-sizes';page.viewOverrides={
  'page-tablet':{'demo-heading':{x:32,width:704},'demo-intro':{x:32,width:704},'view-change-log':{x:32,width:704},'wide-note':{x:32,width:704}},
  'page-phone':{'demo-heading':{x:20,width:350,height:44,style:{fontSize:26}},'demo-intro':{x:20,y:104,width:350,height:72},'show-wide':{x:20,width:104},'show-tablet':{x:134,width:104},'show-phone':{x:248,width:122},'view-change-log':{x:20,width:350,height:56},'wide-note':{placed:false}}
};
const cardNodes=[node('rectangle','card-background','',0,0,1104,292,{style:{fill:'#FAFAFA',stroke:'#DEDEDE',radius:8}}),label('card-title','你可以编辑，也可以直接操作。',24,24,1000,36,23),node('input','card-input','在这里写一句话',24,86,660,44,{style:{fill:'#FFFFFF',stroke:'#CCCCCC'}}),node('button','card-action','点击 +1',24,158,160,42,{interactions:[{event:'click',actions:[{type:'setVariable',name:'demoCount',value:{op:'add',args:[{op:'var',name:'demoCount'},1]}}]}]}),node('text','card-count','',208,162,450,36,{bindings:{text:{op:'concat',args:['已点击 ',{op:'var',name:'demoCount'},' 次']}},style:{fontSize:16,color:'#555555'}}),label('card-note','卡片来自母版，三个尺寸共享同一段文字和交互。',24,224,1000,42,14)];
p.components=[{id:'demo-card',name:'响应式交互卡片',width:1104,height:292,nodes:cardNodes,views:[{id:'card-wide',name:'桌面',parentId:null},{id:'card-tablet',name:'平板',parentId:null},{id:'card-phone',name:'手机',parentId:'card-tablet'}],viewOverrides:{'card-tablet':{'card-background':{width:704},'card-title':{width:656},'card-input':{width:656},'card-count':{width:420},'card-note':{width:656}},'card-phone':{'card-background':{width:350,height:330},'card-title':{width:302,height:62,style:{fontSize:20}},'card-input':{y:104,width:302},'card-action':{y:172,width:134},'card-count':{x:176,y:176,width:152},'card-note':{y:246,width:302,height:60}}}}];
// Supply a complete deterministic instance mapping before construction.
const mapping=new Map(cardNodes.map(n=>[n.id,'instance-'+n.id]));
page.nodes.push(...cardNodes.map(n=>({...structuredClone(n),id:mapping.get(n.id),x:n.x+48,y:n.y+300})));
page.groups=[{id:'demo-instance',name:'响应式交互卡片',nodeIds:cardNodes.map(n=>mapping.get(n.id)),locked:false,parentGroupId:null,componentId:'demo-card',x:48,y:300,sourceIds:cardNodes.map(n=>n.id),internalIds:{},overrides:{},viewMode:'auto',viewId:null,placed:true}];
for(const n of cardNodes){page.viewOverrides['page-tablet'][mapping.get(n.id)]={x:n.x+32};page.viewOverrides['page-phone'][mapping.get(n.id)]={x:(p.components[0].viewOverrides['card-phone'][n.id]?.x??n.x)+20};}
const snapshot=new DocumentEngine(p).getSnapshot();assert.deepEqual(new DocumentEngine(snapshot).getSnapshot(),snapshot);
assert.equal(resolveContainerView(snapshot,page.id,'page-phone').nodes.find(n=>n.id==='instance-card-background').width,350);
const files=[['samples/yuanda/自适应与母版体验.yuanda',JSON.stringify(snapshot,null,2)+'\n'],['exports/自适应与母版体验.html',exportHtml(snapshot)]];
for(const[relative,content]of files){const file=path.join(root,relative);let old;try{old=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(old===content)continue;if(old!==undefined){const dir=path.join(root,'.local/view-demo/previous',String(Date.now()));await mkdir(dir,{recursive:true});await writeFile(path.join(dir,path.basename(file)),old,{flag:'wx'});}await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);}
console.log(JSON.stringify({ok:true,files:files.map(([file])=>file),nodes:snapshot.pages[0].nodes.length}));
