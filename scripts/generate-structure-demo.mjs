/** Original, editable walkthrough of nested groups, paging, row marks and import. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createBlankProject,makeNode,DocumentEngine} from '../app/core/document.mjs';
import {exportHtml} from '../app/core/html-export.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=createBlankProject('原搭 · 层级与分页');project.id='structure-demo';
const page=project.pages[0];Object.assign(page,{id:'structure-page',name:'层级与分页',width:1040,height:920});
const add=(type,id,name,x,y,width,height,extra={})=>{const node=makeNode(type,{id,name,x,y,width,height,...extra});page.nodes.push(node);return node;};
const text=(id,value,x,y,width,size=14,color='#666666')=>add('text',id,value,x,y,width,36,{text:value,style:{fontSize:size,color}});
const op=(op,...args)=>({op,args}),metric=property=>({op:'repeater',repeaterId:'task-list',property});
const button=(id,value,x,y,width,actions,primary=false)=>add('button',id,value,x,y,width,38,{text:value,style:{fill:primary?'#191919':'#FFFFFF',color:primary?'#FFFFFF':'#191919',stroke:'#D4D4D4'},interactions:[{event:'click',actions}]});

text('brand','原搭 / 交互工作台',64,28,450,14,'#191919');
text('title','让设计跟着数据动起来',64,88,800,30,'#191919');
text('intro','在卡片里写备注、勾选标记，再翻一页。回来时，每一行都记得自己的状态。',64,138,920);
text('section','任务清单',64,208,300,18,'#191919');
button('filter-priority','只看优先项',544,208,128,[{type:'filterRows',repeaterId:'task-list',where:op('gte',{op:'item',column:'priority'},3)}]);
button('filter-clear','显示全部',684,208,112,[{type:'filterRows',repeaterId:'task-list',where:null}]);
button('delete-marked','删除标记行',808,208,168,[{type:'deleteRows',repeaterId:'task-list',where:{op:'row',property:'marked'}}]);

const list=add('repeater','task-list','任务列表 · 每页 3 条',64,270,912,378,{style:{stroke:'transparent',strokeWidth:0}});
const tasks=[['整理需求','先明确要解决的问题',3],['画出页面','把内容放到合适的位置',2],['加入交互','让按钮带来真实反馈',3],['整理组件','把重复内容做成母版',2],['导入数据','先检查列，再一次写入',3],['检查导出','用浏览器亲手走一遍',1],['交给 Agent','通过指令批量编辑',2],['保存项目','保留可继续修改的设计',1]];
Object.assign(list.repeater,{columns:[{key:'title',label:'标题',type:'string'},{key:'detail',label:'说明',type:'string'},{key:'priority',label:'优先级',type:'number'}],rows:tasks.map(([title,detail,priority],index)=>({id:`task-row-${index+1}`,values:{title,detail,priority}})),pagination:{pageSize:3,initialPage:1},itemWidth:912,itemHeight:116,gap:12,templateIds:['card-bg','task-title','task-detail','task-note','task-mark']});
add('rectangle','card-bg','行卡片底板',64,270,912,116,{style:{fill:'#FAFAFA',stroke:'#E6E6E6',radius:8}});
add('text','task-title','绑定标题',86,282,390,36,{bindings:{text:{op:'item',column:'title'}},style:{fontSize:17,fontWeight:500}});
add('text','task-detail','绑定说明',86,320,390,36,{bindings:{text:{op:'item',column:'detail'}},style:{fontSize:13,color:'#666666'}});
add('input','task-note','每行自己的备注',504,304,286,38,{text:'在这一行写点备注…',value:'',style:{stroke:'#D4D4D4'}});
add('checkbox','task-mark','标记当前行',824,306,126,34,{text:'标记此行',bindings:{checked:{op:'row',property:'marked'}},interactions:[{event:'change',actions:[{type:'markRows',repeaterId:'task-list',where:op('eq',{op:'row',property:'id'},{op:'event',name:'rowId'}),marked:{op:'event',name:'checked'}}]}]});

add('text','page-stats','页码与标记数量',64,680,570,38,{style:{fontSize:14,color:'#666666'},bindings:{text:op('concat','第 ',metric('currentPage'),' / ',metric('pageCount'),' 页   ·   ',metric('filteredCount'),' 条   ·   已标记 ',metric('markedCount'),' 条')}});
button('page-prev','上一页',716,680,124,[{type:'setRepeaterPage',repeaterId:'task-list',value:op('sub',metric('currentPage'),1)}]);
button('page-next','下一页',852,680,124,[{type:'setRepeaterPage',repeaterId:'task-list',value:op('add',metric('currentPage'),1)}],true);
text('tip-heading','也可以亲手修改这份设计',64,766,700,17,'#191919');
text('tip-outline','主窗口的「概览」里可以展开嵌套组、拖动层级、选中组后整体缩放。',64,806,912,13);
text('tip-import','选中任务列表 → 样式 → 导入 CSV / Tab：先预览列映射，再追加或替换。',64,842,912,13);

const engine=new DocumentEngine(project),group=(groupId,name,items)=>engine.apply([{type:'groupItems',pageId:page.id,groupId,name,items:items.map(id=>({kind:id.startsWith('group-')?'group':'node',id}))}]);
group('group-title','标题与说明',['title','intro']);
group('group-header','页面抬头（含嵌套组）',['brand','group-title']);
group('group-row-copy','每行文字',['task-title','task-detail']);
group('group-filter','筛选工具',['filter-priority','filter-clear','delete-marked']);
group('group-paging','分页工具',['page-stats','page-prev','page-next']);
group('group-help','使用提示',['tip-heading','tip-outline','tip-import']);
const snapshot=engine.getSnapshot();assert.deepEqual(new DocumentEngine(snapshot).getSnapshot(),snapshot);
const generated=[['samples/yuanda/层级与分页体验.yuanda',JSON.stringify(snapshot,null,2)+'\n'],['exports/层级与分页体验.html',exportHtml(snapshot)],['samples/yuanda/任务导入示例.csv','标题,说明,优先级\n新增需求,这是从 CSV 加入的一行,3\n检查文案,你可以替换这些演示数据,2\n']];
for(const[relative,content]of generated){const target=path.join(root,relative);let old;try{old=await readFile(target,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(old===content)continue;if(old!==undefined){const backup=path.join(root,'.local/structure-demo/previous',Date.now().toString());await mkdir(backup,{recursive:true});await writeFile(path.join(backup,path.basename(target)),old,{flag:'wx'});}await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);}
console.log(JSON.stringify({ok:true,files:generated.map(([file])=>file),nodes:snapshot.pages[0].nodes.length,groups:snapshot.pages[0].groups.length}));
