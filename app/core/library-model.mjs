/** Original .yuandalib format. Data only; no paths, scripts or executable thumbnails. */
import {normalizeDesignProject} from './design-model.mjs';
import {groupsForNode,structuralNodeIds,pruneGroups} from './hierarchy-model.mjs';
import {getNodeInternalIds,remapNodeReferences,cleanInteractionReferences,getNodeDescendants} from './interaction-model.mjs';
import {remapVectorReferences} from './vector-model.mjs';

export const LIBRARY_LIMITS=Object.freeze({bytes:32*1024*1024,items:100,folders:200,itemNodes:5000,totalNodes:10000});
const copy=value=>structuredClone(value),own=(value,key)=>Object.hasOwn(value,key);
function fail(message,code='LIBRARY_ERROR'){throw Object.assign(new Error(message),{code});}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('库数据必须是普通对象');}
function keys(value,allowed,required=allowed){object(value);for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!allowed.includes(key))fail(`不支持的库字段：${String(key)}`);for(const key of required)if(!own(value,key))fail(`缺少库字段：${key}`);}
function text(value,name,max=200,min=0){if(typeof value!=='string'||value.length<min||value.length>max)fail(`${name}须为 ${min}–${max} 个字符`);}
function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))fail('库 ID 只能使用字母、数字、短横线及下划线');}
function list(value,max){if(!Array.isArray(value)||value.length>max)fail(`库列表最多 ${max} 项`);}
function sized(value){const active=new Set();let count=0;function visit(item,depth){if(depth>100||++count>750000)fail('库数据结构过于复杂');if(!item||typeof item!=='object')return;if(active.has(item))fail('库数据不能包含循环引用');active.add(item);if(!Array.isArray(item))object(item);for(const entry of Object.values(item))visit(entry,depth+1);active.delete(item);}visit(value,0);let json;try{json=JSON.stringify(value);}catch{fail('库数据不能转换为 JSON');}if(new TextEncoder().encode(json).byteLength>LIBRARY_LIMITS.bytes)fail('元件库不得超过 32 MiB');}
const countNodes=project=>[...project.pages,...project.components].reduce((sum,page)=>sum+page.nodes.length,0);
const visit=(value,fn)=>{if(!value||typeof value!=='object')return;fn(value);for(const child of Object.values(value))visit(child,fn);};
function uniqueName(value,used,max=200){let name=value,index=2;while(used.has(name)){const suffix=` (${index++})`;name=value.slice(0,max-suffix.length)+suffix;}used.add(name);return name;}

/** Keep source inheritance below named/local layers; never freeze defaults as local overrides. */
function captureStyleDependencies(source,project){
  const nodes=[...project.pages,...project.components].flatMap(canvas=>canvas.nodes),named=new Map(source.styles.map(style=>[style.id,style])),usedStyles=new Set();
  for(const node of nodes){let id=node.styleId;while(id!=null&&!usedStyles.has(id)){const style=named.get(id);if(!style)fail('选区依赖的命名样式不存在');usedStyles.add(id);id=style.parentId??null;}}
  project.styles=copy(source.styles.filter(style=>usedStyles.has(style.id)));
  if(source.styleInheritanceVersion===1){
    const usedSets=new Set();
    for(const node of nodes){node.defaultStyleSetId=node.defaultStyleSetId??source.defaultStyleSetId;if(node.defaultStyleSetId!==null)usedSets.add(node.defaultStyleSetId);}
    project.styleInheritanceVersion=1;
    project.defaultStyleSets=copy(source.defaultStyleSets.filter(set=>usedSets.has(set.id)));
    // Every used set is explicit on its nodes. Remaining nulls mean builtin defaults.
    project.defaultStyleSetId=null;
  }
}

export function createLibrary({name='我的元件库',description=''}={},h){text(name,'库名称',200,1);text(description,'库说明',5000);return {format:'yuanda-library',version:1,id:h.uuid(),name,description,folders:[],items:[]};}
export function validateLibraryItem(item,h){
  sized(item);keys(item,['id','folderId','name','description','warnings','project']);id(item.id);if(item.folderId!==null)id(item.folderId);text(item.name,'条目名称',200,1);text(item.description,'条目说明',5000);list(item.warnings,100);item.warnings.forEach(value=>text(value,'条目提示',1000));
  h.validateProject(item.project);const normalized=normalizeDesignProject(item.project);if(normalized.pages.length!==1)fail('库条目只允许一个设计画布');if(!normalized.pages[0].nodes.length)fail('库条目不能是空选区');if(countNodes(normalized)>LIBRARY_LIMITS.itemNodes)fail('单个库条目连同母版依赖最多 5000 个元件');
  if(normalized.pageFolders.length||normalized.pages[0].parentId!==null)fail('库条目不能包含页面文件夹或页面目录层级');
  if(normalized.viewSets.length||normalized.pages[0].views.length||normalized.pages[0].viewSetId!==null||Object.keys(normalized.pages[0].viewOverrides).length||normalized.pages[0].interactions.length)fail('库条目仅保存基础视图与元件交互，不包含页面事件或页面自适应视图');
  visit(normalized,value=>{if(value.type==='navigate')fail('库条目不能包含页面跳转；请先在来源项目重新保存选区，插入后再设置目标页面');if(value.type==='setAdaptiveView')fail('库条目不能包含切换页面自适应视图的动作；插入后请在目标页面重新设置');});return true;
}
export function validateLibrary(library,h){
  sized(library);keys(library,['format','version','id','name','description','folders','items']);if(library.format!=='yuanda-library'||library.version!==1)fail('仅支持原搭 .yuandalib 元件库，不支持 Axure .rplib');id(library.id);text(library.name,'库名称',200,1);text(library.description,'库说明',5000);list(library.folders,LIBRARY_LIMITS.folders);list(library.items,LIBRARY_LIMITS.items);
  const ids=new Set([library.id]),folders=new Map();for(const folder of library.folders){keys(folder,['id','parentId','name','description']);id(folder.id);if(ids.has(folder.id))fail('库内 ID 重复');ids.add(folder.id);if(folder.parentId!==null)id(folder.parentId);text(folder.name,'文件夹名称',200,1);text(folder.description,'文件夹说明',5000);folders.set(folder.id,folder);}
  for(const folder of library.folders){const seen=new Set([folder.id]);let parent=folder.parentId;while(parent!==null){if(seen.has(parent))fail('库文件夹不能循环嵌套');seen.add(parent);if(seen.size>16)fail('库文件夹最多嵌套 16 层');if(!folders.has(parent))fail('库文件夹父级不存在');parent=folders.get(parent).parentId;}}
  let total=0;for(const item of library.items){validateLibraryItem(item,h);if(ids.has(item.id))fail('库内 ID 重复');ids.add(item.id);if(item.folderId!==null&&!folders.has(item.folderId))fail('条目所在文件夹不存在');total+=countNodes(normalizeDesignProject(item.project));}if(total>LIBRARY_LIMITS.totalNodes)fail('元件库全部条目及依赖最多 10000 个元件');return true;
}
export function editLibrary(input,op,h){
  validateLibrary(input,h);const library=copy(input);object(op);
  const patch=(target,value,allowed)=>{keys(value,allowed,[]);Object.assign(target,copy(value));};
  const folder=()=>{const value=library.folders.find(item=>item.id===op.folderId);if(!value)fail('库文件夹不存在');return value;};
  const item=()=>{const value=library.items.find(item=>item.id===op.itemId);if(!value)fail('库条目不存在');return value;};
  switch(op.type){
    case 'updateLibrary':keys(op,['type','patch']);patch(library,op.patch,['name','description']);break;
    case 'addFolder':keys(op,['type','folder']);keys(op.folder,['id','parentId','name','description'],['parentId','name','description']);library.folders.push({id:h.uuid(),...copy(op.folder)});break;
    case 'updateFolder':keys(op,['type','folderId','patch']);patch(folder(),op.patch,['name','description','parentId']);break;
    case 'removeFolder':{keys(op,['type','folderId']);const removed=folder();for(const child of library.folders)if(child.parentId===removed.id)child.parentId=removed.parentId;for(const entry of library.items)if(entry.folderId===removed.id)entry.folderId=removed.parentId;library.folders=library.folders.filter(value=>value.id!==removed.id);break;}
    case 'addItem':keys(op,['type','item']);library.items.push(copy(op.item));break;
    case 'updateItem':keys(op,['type','itemId','patch']);patch(item(),op.patch,['name','description','folderId']);break;
    case 'removeItem':keys(op,['type','itemId']);item();library.items=library.items.filter(value=>value.id!==op.itemId);break;
    default:fail('不支持的元件库操作');
  }
  validateLibrary(library,h);return library;
}

/** Capture a self-contained dependency graph; never store the original project or paths. */
export function captureLibraryItem(input,options,h){
  keys(options,['pageId','nodeIds','name','description','folderId'],['pageId','nodeIds','name','description']);h.validateProject(input);const source=normalizeDesignProject(input),canvas=[...source.pages,...source.components].find(page=>page.id===options.pageId);if(!canvas)fail('所选设计画布不存在');list(options.nodeIds,5000);if(!options.nodeIds.length)fail('请先选择需要保存的元件');const selected=new Set(options.nodeIds);for(const value of selected)if(!canvas.nodes.some(node=>node.id===value))fail('所选元件不存在');
  let changed=true;while(changed){const before=selected.size;for(const member of structuralNodeIds(canvas,[...selected]))selected.add(member);for(const member of [...selected]){const memberships=groupsForNode(canvas,member),group=memberships.find(value=>value.componentId)||memberships[0];if(group)group.nodeIds.forEach(value=>selected.add(value));}changed=before!==selected.size;}
  const project=h.createBlankProject(options.name),page=project.pages[0],warnings=[];
  page.nodes=copy(canvas.nodes.filter(node=>selected.has(node.id)));page.groups=copy(canvas.groups.filter(group=>group.nodeIds.every(value=>selected.has(value))));page.views=[];page.interactions=[];page.name=options.name;page.width=Math.min(20000,Math.max(100,canvas.width));page.height=Math.min(20000,Math.max(100,canvas.height));
  for(const group of page.groups){if(!page.groups.some(parent=>parent.id===group.parentGroupId))group.parentGroupId=null;group.viewOverrides={};}
  const deps=new Set(page.groups.filter(group=>group.componentId).map(group=>group.componentId));let pending=[...deps];while(pending.length){const componentId=pending.pop(),component=source.components.find(value=>value.id===componentId);if(!component)fail('选区依赖的母版不存在');for(const group of component.groups)if(group.componentId&&!deps.has(group.componentId)){deps.add(group.componentId);pending.push(group.componentId);}}
  project.components=copy(source.components.filter(component=>deps.has(component.id)));
  const kept=new Set([...page.nodes,...project.components.flatMap(component=>component.nodes)].map(node=>node.id)),removed=new Set([...source.pages,...source.components].flatMap(page=>page.nodes).filter(node=>!kept.has(node.id)).map(node=>node.id));
  const dangling=page.nodes.filter(node=>node.connector&&(!kept.has(node.connector.from.nodeId)||!kept.has(node.connector.to.nodeId)));dangling.forEach(node=>removed.add(node.id));page.nodes=page.nodes.filter(node=>!removed.has(node.id));for(const group of page.groups)group.nodeIds=group.nodeIds.filter(value=>!removed.has(value));pruneGroups(page);
  let external=false,adaptiveActions=false;visit([...page.nodes,...project.components],value=>{if(value.type==='navigate'||['targetId','nodeId','panelId','repeaterId'].some(key=>removed.has(value[key])))external=true;if(Array.isArray(value.actions)){adaptiveActions||=value.actions.some(action=>action.type==='setAdaptiveView');value.actions=value.actions.filter(action=>action.type!=='setAdaptiveView');}});cleanInteractionReferences(project,{nodeIds:removed,pageIds:new Set(source.pages.map(page=>page.id))});
  if(external||dangling.length)warnings.push('指向选区外元件的动作、页面跳转和悬空连线未收入条目。');
  const rows=new Set(page.nodes.filter(node=>node.repeater).flatMap(node=>getNodeDescendants(page.nodes,node.id))),needsRow=value=>value&&typeof value==='object'&&(value.op==='item'||value.op==='row'||value.args?.some(needsRow));let removedRows=false;
  for(const node of page.nodes)if(!rows.has(node.id)){for(const key of Object.keys(node.bindings))if(needsRow(node.bindings[key])){delete node.bindings[key];removedRows=true;}for(const interaction of node.interactions){if(needsRow(interaction.condition)){interaction.condition=false;removedRows=true;}interaction.actions=interaction.actions.filter(action=>{const bad=['value','x','y','width','height','marked'].some(key=>needsRow(action[key]))||action.type==='addRows'&&action.rows.some(row=>Object.values(row.values).some(needsRow));removedRows||=bad;return !bad;});}}
  if(removedRows)warnings.push('单独保存行内元件时，依赖当前数据行的绑定或动作已移除；保存整个列表可保留这些能力。');if(canvas.views?.length||canvas.viewSetId!=null)warnings.push('选区按基础结构保存；页面自适应视图不随条目插入，关联母版的完整视图定义保留。');if(adaptiveActions)warnings.push('切换页面自适应视图的动作未收入条目；插入后请按目标页面重新设置。');if(canvas.interactions?.length)warnings.push('页面事件不属于所选元件，未收入条目。');
  captureStyleDependencies(source,project);const variables=new Set();visit([...page.nodes,...project.components],value=>{if(value.op==='var'||value.type==='setVariable')variables.add(value.name);});project.variables=copy(source.variables.filter(variable=>variables.has(variable.name)));
  const item={id:h.uuid(),folderId:options.folderId??null,name:options.name,description:options.description,warnings,project};validateLibraryItem(item,h);return {item,warnings:[...warnings]};
}

/** One command imports independent resources and all references into the transaction draft. */
export function applyLibraryCommand(project,command,h){
  if(command.type!=='insertLibraryItem')return false;keys(command,['type','pageId','item','x','y','conflictPolicy'],['type','pageId','item','conflictPolicy']);if(command.conflictPolicy!=='copy')fail('元件库仅支持 copy 冲突策略：新建资源，保留已有内容');validateLibraryItem(command.item,h);
  const destination=[...project.pages,...project.components].find(page=>page.id===command.pageId);if(!destination)fail('插入画布不存在');const x=command.x??80,y=command.y??80;for(const value of [x,y])if(!Number.isFinite(value)||Math.abs(value)>100000)fail('插入位置超出范围');
  const source=normalizeDesignProject(command.item.project),page=source.pages[0],mapping=new Map(),all=[...page.nodes,...source.components.flatMap(component=>component.nodes)],groups=[...page.groups,...source.components.flatMap(component=>component.groups)];
  // Freeze a builtin-only source at the default layer, even if the host later changes its active set.
  if(source.styleInheritanceVersion===1&&source.defaultStyleSetId===null&&all.some(node=>node.defaultStyleSetId===null)){
    const builtin={id:h.uuid(),name:uniqueName('来源内置默认',new Set(source.defaultStyleSets.map(set=>set.name))),byType:{}};
    source.defaultStyleSets.push(builtin);source.defaultStyleSetId=builtin.id;
  }
  const ids=[...all.map(node=>node.id),...getNodeInternalIds(all),...groups.map(group=>group.id),...source.components.map(component=>component.id),...source.components.flatMap(component=>component.views.map(view=>view.id)),...source.styles.map(style=>style.id),...(source.defaultStyleSets||[]).map(set=>set.id)];for(const value of ids)mapping.set(value,h.uuid());const remap=value=>mapping.get(value)||value;
  const existingStyles=new Set(project.styles.map(style=>style.name)),existingComponents=new Set(project.components.map(component=>component.name)),existingVariables=new Set(project.variables.map(variable=>variable.name)),variables=new Map(source.variables.map(variable=>[variable.name,uniqueName(variable.name,existingVariables,100)]));
  const remapVariables=value=>visit(value,item=>{if(item.op==='var'||item.type==='setVariable')item.name=variables.get(item.name)||item.name;});
  function remapNode(original,dx=0,dy=0){const node=remapVectorReferences(remapNodeReferences(original,mapping),mapping);node.id=remap(original.id);node.styleId=original.styleId===null?null:remap(original.styleId);if(source.styleInheritanceVersion===1)node.defaultStyleSetId=remap(original.defaultStyleSetId??source.defaultStyleSetId);node.x+=dx;node.y+=dy;remapVariables(node);return node;}
  function remapGroup(original,dx=0,dy=0){const group=copy(original);group.id=remap(group.id);group.nodeIds=group.nodeIds.map(remap);group.parentGroupId=group.parentGroupId===null?null:remap(group.parentGroupId);group.componentId=group.componentId===null?null:remap(group.componentId);group.viewId=group.viewId===null?null:remap(group.viewId);group.viewOverrides=Object.fromEntries(Object.entries(group.viewOverrides).map(([viewId,patch])=>[remap(viewId),{...copy(patch),...(own(patch,'x')?{x:patch.x+dx}:{}),...(own(patch,'y')?{y:patch.y+dy}:{})}]));group.sourceIds=group.sourceIds.map(remap);group.internalIds=Object.fromEntries(Object.entries(group.internalIds).map(([key,value])=>[remap(key),remap(value)]));group.overrides=Object.fromEntries(Object.entries(group.overrides).map(([key,value])=>[remap(key),value]));if(group.componentId){group.x+=dx;group.y+=dy;}return group;}
  if(source.styleInheritanceVersion===1){const names=new Set(project.defaultStyleSets.map(set=>set.name));project.defaultStyleSets.push(...source.defaultStyleSets.map(set=>({...copy(set),id:remap(set.id),name:uniqueName(set.name,names)})));}
  project.styles.push(...source.styles.map(style=>({...copy(style),id:remap(style.id),name:uniqueName(style.name,existingStyles),...(own(style,'parentId')?{parentId:style.parentId===null?null:remap(style.parentId)}:{})})));
  project.variables.push(...source.variables.map(variable=>({...copy(variable),name:variables.get(variable.name)})));
  project.components.push(...source.components.map(component=>({...copy(component),id:remap(component.id),name:uniqueName(component.name,existingComponents),nodes:component.nodes.map(node=>remapNode(node)),groups:component.groups.map(group=>remapGroup(group)),views:component.views.map(view=>({...copy(view),id:remap(view.id),parentId:view.parentId===null?null:remap(view.parentId)})),viewOverrides:Object.fromEntries(Object.entries(component.viewOverrides).map(([viewId,overrides])=>[remap(viewId),Object.fromEntries(Object.entries(overrides).map(([nodeId,patch])=>[remap(nodeId),copy(patch)]))]))})));
  const dx=x-Math.min(...page.nodes.map(node=>node.x)),dy=y-Math.min(...page.nodes.map(node=>node.y));destination.nodes.push(...page.nodes.map(node=>remapNode(node,dx,dy)));destination.groups.push(...page.groups.map(group=>remapGroup(group,dx,dy)));return true;
}
