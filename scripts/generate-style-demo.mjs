/** Reproducible original style tutorial. Every picture is drawn locally. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createBlankProject,makeNode,DocumentEngine} from '../app/core/document.mjs';
import {exportHtml} from '../app/core/html-export.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const crc=buffer=>{let crc=0xffffffff;for(const value of buffer){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
function png(width,height,pixel){const chunk=(name,data)=>{const type=Buffer.from(name),body=Buffer.concat([type,data]),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(body));return Buffer.concat([length,body,sum]);},header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const data=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)Buffer.from(pixel(x,y)).copy(data,y*(width*4+1)+1+x*4);return'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
const texture=png(240,160,(x,y)=>{const v=(x-176)**2+(y-46)**2<27**2?222:y>95+(Math.sin(x/28)*13)?160:y>65+(Math.sin(x/39)*18)?197:245;return[v,v,v,255];});
const project=createBlankProject('样式与排版体验'),page=project.pages[0];project.id='style-demo-project';page.id='style-demo-page';page.name='样式与排版体验';page.width=1200;page.height=1320;page.background='#FFFFFF';
const add=(type,id,text,x,y,width,height,style={},extra={})=>{const n=makeNode(type,{id,name:text||id,text,x,y,width,height,style:{fill:'transparent',strokeWidth:0,radius:0,color:'#191919',fontSize:16,...style},...extra});page.nodes.push(n);return n;};
const text=(id,value,x,y,width,height,size=16,color='#666666')=>add('text',id,value,x,y,width,height,{fontSize:size,color,lineHeight:size*1.5});
const gradient=(a,b,angle=90)=>({type:'linear',angle,stops:[{offset:0,color:a,opacity:1},{offset:1,color:b,opacity:1}]});
const button=(id,label,x,y,width,actions)=>add('button',id,label,x,y,width,42,{fill:'#FFFFFF',stroke:'#D5D5D5',strokeWidth:1,radius:5,color:'#191919',fontSize:14},{interactions:[{event:'click',actions}]});
text('heading','让界面有清楚的层次。',48,30,1104,64,36,'#191919');text('intro','字体、渐变、四边边框与阴影使用同一套显示规则，编辑器和导出网页一起变化。',48,106,1104,40,17);text('instructions','把鼠标移到第一张卡片上，点击状态按钮，再试着在输入框里打字。',48,154,1104,32,15);
for(const [id,label,x]of [['a-title','01  颜色可以柔和过渡',48],['b-title','02  边框也有自己的样式',432],['c-title','03  层次来自光影',816]])text(id,label,x,222,336,32,19,'#191919');
add('rectangle','hover-card','移入鼠标',48,272,336,180,{fill:'#EEEEEE',fillPaint:gradient('#F8F8F8','#D6D6D6',120),stroke:'#DDDDDD',strokeWidth:1,radius:16,align:'center',fontSize:22,transition:{duration:350,delay:0,easing:'ease'}},{stateStyles:{hover:{fillPaint:gradient('#CFCFCF','#FAFAFA',120),color:'#000000',shadows:[{inset:false,x:0,y:7,blur:18,spread:0,color:'#000000',opacity:.14}]}}});
add('rectangle','border-card','四个角，四条边',432,272,336,180,{fill:'#FAFAFA',strokePaint:gradient('#333333','#BBBBBB',40),borderSides:{top:2,right:10,bottom:5,left:2},radiusCorners:{topLeft:32,topRight:4,bottomRight:32,bottomLeft:4},align:'center',fontSize:21});
add('rectangle','shadow-card','向内 / 向外',816,272,336,180,{fill:'#F4F4F4',radius:16,align:'center',fontSize:21,shadows:[{inset:true,x:0,y:3,blur:8,spread:0,color:'#000000',opacity:.12},{inset:false,x:0,y:10,blur:22,spread:-4,color:'#000000',opacity:.16}]});
text('a-note','移动鼠标后，渐变色和阴影慢慢改变。',48,476,336,45,14);text('b-note','圆角渐变边框保留各边不同的宽度。',432,476,336,45,14);text('c-note','阴影独立于填充，也不会挡住文字。',816,476,336,45,14);
for(const [id,label,x]of [['d-title','04  文字留出呼吸空间',48],['e-title','05  输入仍是原生控件',432],['f-title','06  图片可以用来填充',816]])text(id,label,x,568,336,32,19,'#191919');
add('rectangle','typeset-card','清楚表达\n恰当留白',48,618,336,180,{fill:'#FAFAFA',stroke:'#E0E0E0',strokeWidth:1,radius:10,fontFamily:'Microsoft YaHei',fontSize:25,lineHeight:46,letterSpacing:4,verticalAlign:'bottom',padding:{top:18,right:22,bottom:22,left:28}});
add('input','demo-input','请在这里输入',432,632,336,54,{fill:'#FFFFFF',stroke:'#BDBDBD',strokeWidth:1,radius:10,fontSize:17,padding:{top:7,right:14,bottom:7,left:14}},{stateStyles:{focus:{stroke:'#191919',strokeWidth:2,shadows:[{inset:false,x:0,y:0,blur:0,spread:4,color:'#000000',opacity:.07}]}},interactions:[{event:'input',actions:[{type:'setText',targetId:'input-echo',value:{op:'concat',args:['你刚刚输入：',{op:'event',name:'value'}]}}]}]});
text('input-echo','你刚刚输入：',432,706,336,70,15);
add('rectangle','picture-fill','远山 / 近景',816,618,336,180,{fillPaint:{type:'image',src:texture,fit:'cover',positionX:.5,positionY:.5},radius:12,color:'#191919',fontSize:19,verticalAlign:'bottom',padding:{top:12,right:18,bottom:18,left:18}});
text('d-note','行高、字距、对齐和内距可以分别调整。',48,824,336,45,14);text('e-note','聚焦时改变外框，文字与选择位置保留。',432,824,336,45,14);text('f-note','本页山形图片在本项目内绘制，无外链。',816,824,336,45,14);
text('state-title','07  同一张卡片，也能切换状态',48,918,1104,36,22,'#191919');
add('rectangle','state-card','等待选择',48,980,336,100,{fill:'#FFFFFF',stroke:'#BBBBBB',strokeWidth:1,radius:10,align:'center',fontSize:20},{stateStyles:{selected:{fill:'#333333',color:'#FFFFFF',strokePaint:gradient('#000000','#888888')},error:{stroke:'#191919',strokePaint:null,strokeWidth:3,strokeStyle:'dashed'}}});
button('select-state','切换选中',432,980,158,[{type:'setSelected',targetId:'state-card',value:{op:'not',args:[{op:'node',nodeId:'state-card',property:'selected'}]}}]);
button('error-state','显示错误状态',610,980,158,[{type:'setError',targetId:'state-card',value:true}]);
button('reset-state','恢复初始',432,1038,336,[{type:'setSelected',targetId:'state-card',value:false},{type:'setError',targetId:'state-card',value:false}]);
text('state-note','按钮只改变网页运行时的状态。\n回到编辑器，原始设计仍然完整保留。',816,980,336,90,15);
text('footer','在原搭主窗口打开本文件 → 选中卡片 → 右侧「样式」 → 调整后点击「预览」。\n想回退一步按 Ctrl + Z。保存副本后，你可以继续做自己的设计。',48,1160,1104,88,16);text('footnote','此样本为原创演示；并不代表已完成全部 Axure 能力。',48,1270,1104,28,13,'#777777');
const snapshot=new DocumentEngine(project).getSnapshot(),destinations=[[path.join(root,'samples/yuanda/样式与排版体验.yuanda'),JSON.stringify(snapshot,null,2)+'\n'],[path.join(root,'exports/样式与排版体验.html'),exportHtml(snapshot)]];
const stamp=new Date().toISOString().replace(/[:.]/g,'-');for(const[file,content]of destinations){await mkdir(path.dirname(file),{recursive:true});let old;try{old=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(old===content)continue;if(old!==undefined){const backup=path.join(root,'.local','style-demo-backups',stamp,path.basename(file));await mkdir(path.dirname(backup),{recursive:true});await copyFile(file,backup);}await writeFile(file,content);}
console.log(JSON.stringify({project:destinations[0][0],html:destinations[1][0],nodes:snapshot.pages[0].nodes.length,assets:'1 original grayscale PNG, generated locally, no network dependency'}));

