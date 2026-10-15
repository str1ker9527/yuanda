/** Original editor arrangement planner. It only returns transaction commands;
 * grouping, instance linkage, history and final lock checks stay in the engine. */
import {hierarchyIndex,ownerKey,rootOwner,boundaryNodeIds,structuralNodeIds,groupAncestors,groupScope,isHierarchyLocked,buildOutlineTree} from './hierarchy-model.mjs';
import {getNodeBounds} from './widget-geometry.mjs';

const fail=(message,code='ARRANGEMENT_ERROR')=>{throw Object.assign(new Error(message),{code});};
const round=value=>Math.round(value*1e6)/1e6;
function movementClosure(page,ids){
  const selected=new Set(ids);let changed=true;
  while(changed){const count=selected.size;for(const id of structuralNodeIds(page,[...selected]))selected.add(id);for(const group of page.groups||[])if(group.componentId&&group.nodeIds.some(id=>selected.has(id)))group.nodeIds.forEach(id=>selected.add(id));changed=selected.size!==count;}
  return [...selected];
}
function unionBounds(nodes){
  const boxes=nodes.map(getNodeBounds),left=Math.min(...boxes.map(box=>box.left)),top=Math.min(...boxes.map(box=>box.top)),right=Math.max(...boxes.map(box=>box.right)),bottom=Math.max(...boxes.map(box=>box.bottom));
  if(![left,top,right,bottom].every(Number.isFinite))fail('排列对象的绘制尺寸无效');
  return {left,top,right,bottom,width:right-left,height:bottom-top};
}

/** Raw page determines ownership and locks; a resolved view may supply geometry.
 * Selection order is preserved even when node IDs collapse into a whole group.
 * A partial ordinary-group selection can arrange its selected children. A master
 * always expands as one instance, exactly as the engine's moveNodes command does. */
export function arrangementUnits(page,nodeIds,{geometryPage=page}={}){
  if(!page||!Array.isArray(page.nodes)||!Array.isArray(nodeIds))fail('排列需要画布和选中元件 ID');
  if(!geometryPage||geometryPage.id!==page.id||!Array.isArray(geometryPage.nodes))fail('排列外观与当前画布不一致');
  const ids=[...new Set(nodeIds)],index=hierarchyIndex(page),geometry=new Map(geometryPage.nodes.map(node=>[node.id,node]));
  for(const id of ids)if(typeof id!=='string'||!index.nodes.has(id))fail('选中的元件已不存在，请重新选择');
  if(!ids.length)return [];
  const closure=new Set(movementClosure(page,ids));
  const complete=(page.groups||[]).filter(group=>group.nodeIds.length&&group.nodeIds.every(id=>closure.has(id))),completeIds=new Set(complete.map(group=>group.id));
  const candidates=[];
  for(const group of complete){
    if(groupAncestors(page,group.id).some(parent=>completeIds.has(parent.id)))continue;
    const owner=groupScope(page,group);if(!owner)fail('跨容器或跨状态的组合不能排列，请先整理层级','ARRANGEMENT_SCOPE');
    candidates.push({kind:group.componentId?'component':'group',id:group.id,requestedIds:[...group.nodeIds],owner});
  }
  const grouped=new Set(candidates.flatMap(unit=>unit.requestedIds));
  for(const id of boundaryNodeIds(page,[...closure]))if(!grouped.has(id))candidates.push({kind:'node',id,requestedIds:[id],owner:index.owners.get(id)||rootOwner()});
  for(const unit of candidates){unit.nodeIds=movementClosure(page,unit.requestedIds);unit.coverage=new Set(unit.nodeIds);unit.order=Math.min(...ids.map((id,position)=>unit.coverage.has(id)?position:Infinity));}
  // Selecting both a container and one of its descendants must never move that
  // descendant twice, including a complete group nested inside that container.
  const units=candidates.filter((unit,at)=>!candidates.some((other,index)=>other!==unit&&unit.nodeIds.every(id=>other.coverage.has(id))&&(other.nodeIds.length>unit.nodeIds.length||index<at))).sort((a,b)=>a.order-b.order);
  const handled=new Set();let scope;
  for(const unit of units){
    if(unit.nodeIds.some(id=>handled.has(id)))fail('排列对象的容器范围重叠，请重新选择','ARRANGEMENT_SCOPE');
    unit.nodeIds.forEach(id=>handled.add(id));
    const key=ownerKey(unit.owner);if(scope!==undefined&&key!==scope)fail('排列对象必须属于同一个容器或状态','ARRANGEMENT_SCOPE');scope=key;
    for(const id of unit.nodeIds)if(isHierarchyLocked(page,id))fail('选区包含锁定元件、组或祖先容器，请先解锁','LOCKED');
    const roots=boundaryNodeIds(page,unit.requestedIds),visible=[];
    for(const id of roots){const node=geometry.get(id);if(!node)fail('排列对象的当前视图已变化，请重新选择');if(node.visible!==false&&node.effectivePlaced!==false)visible.push(node);}
    if(!visible.length)fail('隐藏或未放置的对象不能作为排列对象','ARRANGEMENT_HIDDEN');
    unit.bounds=unionBounds(visible);delete unit.coverage;delete unit.requestedIds;
  }
  return units;
}

function move(page,unit,dx,dy){
  dx=round(dx);dy=round(dy);if(!dx&&!dy)return null;
  if(Math.abs(dx)>100000||Math.abs(dy)>100000)fail('排列位移超出支持范围');
  return {type:'moveNodes',pageId:page.id,nodeIds:[...unit.nodeIds],dx,dy};
}

/** Multiple objects align to the first selected unit. One unit aligns to the
 * current drawing canvas, retaining the editor's single-selection behavior. */
export function alignCommands(page,nodeIds,kind,options={}){
  if(!['left','center','right','top','middle','bottom'].includes(kind))fail('不支持的对齐方向');
  const units=arrangementUnits(page,nodeIds,options);if(!units.length)return [];
  const drawing=options.geometryPage||page,reference=units.length>1?units[0].bounds:{left:0,top:0,right:drawing.width,bottom:drawing.height};
  if(!Object.values(reference).every(Number.isFinite))fail('画布尺寸无效');
  const moved=units.length>1?units.slice(1):units;
  return moved.map(unit=>{const bounds=unit.bounds;let dx=0,dy=0;
    if(kind==='left')dx=reference.left-bounds.left;if(kind==='center')dx=(reference.left+reference.right-bounds.left-bounds.right)/2;if(kind==='right')dx=reference.right-bounds.right;
    if(kind==='top')dy=reference.top-bounds.top;if(kind==='middle')dy=(reference.top+reference.bottom-bounds.top-bounds.bottom)/2;if(kind==='bottom')dy=reference.bottom-bounds.bottom;
    return move(page,unit,dx,dy);
  }).filter(Boolean);
}

/** Equal visible-edge gaps in spatial order. The two end objects remain fixed;
 * selection order breaks ties only and does not change the outer endpoints. */
export function distributionCommands(page,nodeIds,axis,options={}){
  if(!['x','y'].includes(axis))fail('不支持的等距方向');
  const units=arrangementUnits(page,nodeIds,options);if(units.length<3)fail('等距分布至少需要三个独立对象；组合和母版各算一个','ARRANGEMENT_COUNT');
  const start=axis==='x'?'left':'top',end=axis==='x'?'right':'bottom',size=axis==='x'?'width':'height';
  const ordered=[...units].sort((a,b)=>a.bounds[start]-b.bounds[start]||a.order-b.order),first=ordered[0],last=ordered.at(-1);
  const gap=(last.bounds[end]-first.bounds[start]-ordered.reduce((sum,unit)=>sum+unit.bounds[size],0))/(ordered.length-1);
  let cursor=first.bounds[end]+gap;const commands=[];
  for(const unit of ordered.slice(1,-1)){const delta=cursor-unit.bounds[start],command=move(page,unit,axis==='x'?delta:0,axis==='y'?delta:0);if(command)commands.push(command);cursor+=unit.bounds[size]+gap;}
  return commands;
}

/** Tree children run from back to front (the outline UI reverses them). Reorder
 * sibling objects, never flattened member nodes, and preserve selection z-order.
 * Hidden nodes can be reordered; geometry is irrelevant to stacking. */
export function layerCommands(page,nodeIds,kind){
  if(!['front','back','forward','backward'].includes(kind))fail('不支持的层级方向');
  if(!page||!Array.isArray(page.nodes)||!Array.isArray(nodeIds))fail('层级排列需要画布和选中元件 ID');
  const ids=[...new Set(nodeIds)],index=hierarchyIndex(page);for(const id of ids)if(typeof id!=='string'||!index.nodes.has(id))fail('选中的元件已不存在，请重新选择');if(!ids.length)return [];
  const selected=new Set(movementClosure(page,ids)),tree=buildOutlineTree(page),units=[];
  if(tree.legacy.some(entry=>entry.nodeIds.every(id=>selected.has(id))))fail('跨容器组合不能调整层级，请先整理层级','ARRANGEMENT_SCOPE');
  function collect(entry,parent){
    if((entry.kind==='group'&&entry.nodeIds.every(id=>selected.has(id)))||(entry.kind==='node'&&selected.has(entry.id))){units.push({entry,parent});return;}
    for(const child of entry.children||[])collect(child,entry);
  }
  tree.children.forEach(entry=>collect(entry,tree));if(!units.length)return [];
  const parentEntry=units[0].parent;if(units.some(unit=>unit.parent.key!==parentEntry.key))fail('调整层级的对象必须属于同一个父组、容器或状态','ARRANGEMENT_SCOPE');
  const parent=parentEntry.kind==='root'?rootOwner():parentEntry.kind==='group'?{kind:'group',groupId:parentEntry.id}:parentEntry.kind==='state'?{kind:'panelState',panelId:parentEntry.panelId,stateId:parentEntry.id}:parentEntry.kind==='template'?{kind:'repeater',nodeId:parentEntry.id}:null;
  if(!parent||parentEntry.readonly)fail('不能在母版实例内部调整层级，请编辑母版定义','COMPONENT_LINKED');
  for(const {entry}of units)for(const id of movementClosure(page,entry.nodeIds))if(isHierarchyLocked(page,id))fail('选区包含锁定元件、组或祖先容器，请先解锁','LOCKED');
  const siblings=[...parentEntry.children],keys=new Set(units.map(unit=>unit.entry.key)),ordered=siblings.filter(entry=>keys.has(entry.key)),remaining=siblings.filter(entry=>!keys.has(entry.key));
  const item=entry=>({kind:entry.kind==='group'?'group':'node',id:entry.id});
  const command=(entries,position)=>({type:'reparentItems',pageId:page.id,items:entries.map(item),parent:{...parent},index:position});
  if(kind==='front'||kind==='back'){
    const desired=kind==='front'?[...remaining,...ordered]:[...ordered,...remaining];if(desired.every((entry,at)=>entry.key===siblings[at].key))return [];
    return [command(ordered,kind==='front'?remaining.length:0)];
  }
  const working=[...siblings],commands=[],direction=kind==='forward'?1:-1,visit=direction===1?[...ordered].reverse():ordered;
  for(const entry of visit){const at=working.findIndex(value=>value.key===entry.key),next=at+direction;if(next<0||next>=working.length||keys.has(working[next].key))continue;commands.push(command([entry],next));working.splice(at,1);working.splice(next,0,entry);}
  return commands;
}
