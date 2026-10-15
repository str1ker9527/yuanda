/** Original, editable panel walkthrough. Existing generated files are backed up before changes. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createBlankProject,makeNode,DocumentEngine} from '../app/core/document.mjs';
import {exportHtml} from '../app/core/html-export.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),project=createBlankProject('原搭 · 面板交互体验'),page=project.pages[0];
project.id='panel-experience';Object.assign(page,{id:'panel-experience-page',name:'面板交互体验',width:1120,height:1200});project.variables=[{name:'buttonCount',type:'number',value:0}];
const add=(type,id,x,y,width,height,extra={})=>{const node=makeNode(type,{id,name:id,x,y,width,height,...extra});page.nodes.push(node);return node;};
const text=(id,value,x,y,width,height=32,size=14,color='#666666')=>add('text',id,x,y,width,height,{name:value,text:value,style:{fontSize:size,color}});
const button=(id,value,x,y,width,actions)=>add('button',id,x,y,width,36,{name:value,text:value,style:{fill:'#FFFFFF',color:'#191919',stroke:'#D4D4D4',radius:4},interactions:[{event:'click',actions}]});
const panel=(id,name,x,y,width,height,settings={})=>{const n=add('dynamicPanel',id,x,y,width,height,{name,style:{fill:'transparent',strokeWidth:0}});Object.assign(n.panel,settings);return n;};
const op=(op,...args)=>({op,args}),setState=(id,stateId)=>({type:'setPanelState',panelId:id,stateId});
text('brand','原搭 / 动态面板',64,28,600,36,14,'#191919');text('title','把静态布局变成可操作的界面',64,82,980,54,30,'#191919');
text('intro','在这份原型中试试拖动、滚动、切换大小和固定提示。回到编辑器，还可以复制、重排每个状态。',64,144,980,44);
text('drag-heading','01 / 在边界内拖动',64,208,450,36,19,'#191919');
const zone=panel('drag-zone','拖动范围',64,260,460,260);zone.style={...zone.style,fill:'#F6F6F6',stroke:'#DEDEDE',strokeWidth:1,radius:8};zone.panel.states=[{id:'zone-state',name:'拖动范围',nodeIds:['drag-card']}];zone.panel.initialStateId='zone-state';
const card=panel('drag-card','可以拖动的卡片',80,276,320,208,{drag:{enabled:true,axis:'both',bounds:'parent'}});card.style={...card.style,fill:'#FFFFFF',stroke:'#CCCCCC',strokeWidth:1,radius:7};card.panel.states=[{id:'card-state',name:'卡片内容',nodeIds:['card-title','card-hint','card-input','card-button']}];card.panel.initialStateId='card-state';
card.interactions=[{event:'dragStart',actions:[{type:'setText',targetId:'drag-status',value:'开始拖动'}]},{event:'drag',actions:[{type:'setText',targetId:'drag-status',value:op('concat','本次位移：', {op:'event',name:'deltaX'},' / ',{op:'event',name:'deltaY'})}]},{event:'dragEnd',actions:[{type:'setText',targetId:'drag-status',value:'拖动结束 · 卡片仍在范围内'}]}];
text('card-title','按住标题或空白处拖动',100,290,275,34,17,'#191919');text('card-hint','下面的输入框和按钮各自正常工作。',100,330,275,32,12);add('input','card-input',100,375,275,36,{name:'卡片中的输入框',text:'在这里写一句话…',value:'',style:{stroke:'#D4D4D4'}});button('card-button','点击计数',100,428,126,[{type:'setVariable',name:'buttonCount',value:op('add',{op:'var',name:'buttonCount'},1)}]);
text('drag-status','拖动卡片不会改变设计文件。',64,534,460,32,13);add('text','click-status',246,428,130,36,{name:'子按钮点击数',bindings:{text:op('concat','已点击 ',{op:'var',name:'buttonCount'},' 次')},style:{fontSize:13,color:'#666666'}});card.panel.states[0].nodeIds.push('click-status');

text('fit-heading','02 / 内容决定面板大小',592,208,464,36,19,'#191919');button('fit-compact','显示摘要',592,260,136,[setState('fit-panel','compact')]);button('fit-detailed','显示详情',744,260,136,[setState('fit-panel','detailed')]);
const fit=panel('fit-panel','随内容调整大小',592,318,464,130,{sizeMode:'content'});fit.panel.states=[{id:'compact',name:'摘要',nodeIds:['compact-bg','compact-title','compact-copy']},{id:'detailed',name:'详情',nodeIds:['detail-bg','detail-title','detail-copy','detail-note']}];fit.panel.initialStateId='compact';
add('rectangle','compact-bg',592,318,464,132,{name:'摘要底板',style:{fill:'#FAFAFA',stroke:'#DFDFDF',radius:7}});text('compact-title','一眼看懂当前进度',616,336,410,36,19,'#191919');text('compact-copy','这是一个较短的状态，面板会收缩到内容边界。',616,386,410,38,14);
add('rectangle','detail-bg',592,318,464,266,{name:'详情底板',style:{fill:'#FAFAFA',stroke:'#DFDFDF',radius:7}});text('detail-title','展开之后，容器跟着内容长大',616,336,410,36,19,'#191919');text('detail-copy','状态里可以放任意已支持的元件。\n\n当前状态改变时，运行器重新计算可见内容的尺寸。\n\n你也可以在编辑器中改回固定尺寸，启用滚动或裁切。',616,386,410,150,14);text('detail-note','状态重排不会悄悄改变“预览初始状态”。',616,548,410,24,12);

text('scroll-heading','03 / 超出时按需滚动',64,612,460,36,19,'#191919');text('scroll-help','把鼠标移到下方列表内滚动；横向也有更多内容。',64,650,460,32,13);
const scroll=panel('scroll-panel','横纵按需滚动的内容',64,700,460,260,{scroll:{x:'auto',y:'auto'}});scroll.style={...scroll.style,fill:'#FFFFFF',stroke:'#DADADA',strokeWidth:1,radius:5};scroll.panel.states=[{id:'scroll-state',name:'长内容',nodeIds:[]}];scroll.panel.initialStateId='scroll-state';
for(let i=0;i<6;i++){const y=712+i*90,id='scroll-row-'+i;add('rectangle',id,76,y,600,78,{name:`内容行 ${i+1}`,style:{fill:i%2?'#FFFFFF':'#F6F6F6',stroke:'#E6E6E6',radius:3}});text(id+'-title',`步骤 ${i+1} / 这部分内容保留在面板内部`,92,y+10,540,30,15,'#191919');text(id+'-copy','滚动位置按状态保存，切换状态不等于重置输入。',92,y+42,540,24,12);scroll.panel.states[0].nodeIds.push(id,id+'-title',id+'-copy');}
text('scroll-status','当前滚动位置：0 / 0',64,978,460,32,13);scroll.interactions=[{event:'scroll',actions:[{type:'setText',targetId:'scroll-status',value:op('concat','当前滚动位置：',{op:'event',name:'scrollX'},' / ',{op:'event',name:'scrollY'})}]}];

text('pin-heading','04 / 固定在浏览器右下角',592,650,464,36,19,'#191919');text('pin-copy','向下滚动整张网页，右下角的提示仍留在窗口边上。\n\n它也能关闭和重新显示；窗口变大、变小时会重新对齐。',592,704,464,130,14);button('pin-show','重新显示固定提示',592,862,220,[{type:'setVisible',targetId:'fixed-tip',value:true}]);
const tip=panel('fixed-tip','固定在右下角的提示',720,1020,310,120,{pin:{horizontal:'right',vertical:'bottom',offsetX:24,offsetY:24}});tip.style={...tip.style,fill:'#FFFFFF',stroke:'#BEBEBE',strokeWidth:1,radius:7};tip.panel.states=[{id:'tip-state',name:'提示',nodeIds:['tip-title','tip-copy','tip-close']}];tip.panel.initialStateId='tip-state';text('tip-title','固定提示',738,1030,215,30,17,'#191919');text('tip-copy','我跟着窗口，不跟着网页滚动。',738,1064,272,42,13);button('tip-close','×',982,1030,30,[{type:'setVisible',targetId:'fixed-tip',value:false}]);
text('footer','回到编辑器：选中动态面板 → 样式 → 尺寸、滚动、固定与拖动。交互面板可设置拖动开始 / 中 / 结束与滚动事件。',64,1090,992,64,14);
const snapshot=new DocumentEngine(project).getSnapshot();assert.deepEqual(new DocumentEngine(snapshot).getSnapshot(),snapshot);
const files=[['samples/yuanda/面板交互体验.yuanda',JSON.stringify(snapshot,null,2)+'\n'],['exports/面板交互体验.html',exportHtml(snapshot)]];
for(const [relative,content]of files){const file=path.join(root,relative);let old;try{old=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(old===content)continue;if(old!==undefined){const backup=path.join(root,'.local/panel-demo/previous',Date.now().toString());await mkdir(backup,{recursive:true});await writeFile(path.join(backup,path.basename(file)),old,{flag:'wx'});}await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content);}
console.log(JSON.stringify({ok:true,files:files.map(([file])=>file),nodes:snapshot.pages[0].nodes.length}));
