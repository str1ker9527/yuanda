/** Own-data RP + editable project demo. Never launches Axure or overwrites files. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankProject, makeNode, normalizeProject } from '../app/core/document.mjs';
import { exportRp } from '../app/core/rp-export.mjs';
import { auditGeneratedProject } from './inspect-generated-rp.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const out=resolve(process.argv[2]||join(root,'samples','rp-agent-demo-20261015'));
if(!out.startsWith(root+sep))throw new Error('Demo must stay inside this project');
const png=await readFile(join(root,'samples','rp-batch-20261015','四色测试图.png'));
const project=createBlankProject('原搭 · 图片与跳转演示');project.id='yuanda-rp-agent-demo';
const first=project.pages[0];first.id='demo-home';first.name='01 演示首页';first.width=1200;first.height=800;first.background='#f7f8fa';
const second=structuredClone(first);second.id='demo-details';second.name='02 跳转结果';project.pages.push(second);
const label=(id,text,x,y,width=1000,size=20)=>makeNode('text',{id,name:id,text,x,y,width,height:64,style:{fontSize:size,color:'#172033'}});
first.nodes.push(label('demo-title','原搭：可以编辑，也可以直接交给 Agent',64,44,1000,32),label('demo-note','图片和页面跳转均由原搭独立生成。右下卡片保留旋转角度。',64,120),
  makeNode('image',{id:'demo-image',name:'自有四色图片',x:64,y:240,width:360,height:240,src:`data:image/png;base64,${png.toString('base64')}`,image:{naturalWidth:240,naturalHeight:160,autoFit:false,fit:'stretch',crop:null,flipX:false,flipY:false,filters:{enabled:false,hue:0,saturation:1,brightness:1,contrast:1},corners:null,cuts:[],text:{enabled:false,verticalAlign:'middle',padding:8},optimization:null},style:{strokeWidth:0,radius:0}}),
  makeNode('button',{id:'demo-go',name:'打开详情按钮',text:'点击整张按钮，进入第二页',x:520,y:260,width:510,height:72,style:{fill:'#2563eb',stroke:'#2563eb',radius:12,fontSize:22},interactions:[{event:'click',actions:[{type:'navigate',pageId:second.id}]}]}),
  makeNode('rectangle',{id:'demo-rotation',name:'旋转卡片',text:'旋转 12°',x:580,y:430,width:280,height:120,rotation:12,style:{fill:'#ffedd5',stroke:'#ea580c',radius:12,fontSize:24}}),
  label('demo-footer','在原搭打开 .yuanda 可继续编辑；导出的 .rp 用于 Axure 兼容交付。',64,670,1080,18));
second.nodes.push(label('detail-title','跳转成功',64,60,1000,36),label('detail-note','这是一张真正独立的页面。下面的按钮返回首页。',64,150),
  makeNode('button',{id:'demo-back',name:'返回首页按钮',text:'返回首页',x:64,y:280,width:280,height:64,style:{fill:'#2563eb',stroke:'#2563eb',radius:12,fontSize:22},interactions:[{event:'click',actions:[{type:'navigate',pageId:first.id}]}]}));
const normalized=normalizeProject(project),result=exportRp(normalized),audit=auditGeneratedProject(result.data,normalized);
await mkdir(out,{recursive:false});
for(const [name,value]of [['原搭-图片与跳转演示.yuanda',JSON.stringify(normalized,null,2)],['原搭-图片与跳转演示.rp',result.data],['independent-audit.json',JSON.stringify({...audit,exportStatus:result.status},null,2)]])await writeFile(join(out,name),value,{flag:'wx'});
console.log(JSON.stringify({out,...audit},null,2));
