/** View-scoped edits share the document transaction and never persist a rendered snapshot. */
import { getCanvasViews, getCanvasViewOverrides, resolveContainerView, resolveViewChain } from './view-model.mjs';
import { getNodeDescendants } from './interaction-model.mjs';
import { isHierarchyLocked } from './hierarchy-model.mjs';
import { resolveInstancePosition } from './component-view-model.mjs';
import { STYLE_KEYS, resolveNodeBaseStyle } from './style-model.mjs';
import { IMAGE_COMMANDS } from './image-model.mjs';

const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (value, key) => Object.hasOwn(value, key);
const put = (object, key, value) => Object.defineProperty(object, key, {value,writable:true,enumerable:true,configurable:true});
const visualKeys = new Set(['x', 'y', 'width', 'height', 'rotation', 'style', 'placed']);
const layoutCommands = new Set(['updateNode', 'moveNodes', 'moveGroup', 'moveContainer', 'resizeGroup', 'applyStyle','applyStyleSnapshot','replaceImage','fitImage']);
export const VIEW_EDIT_COMMANDS = Object.freeze([
  ...IMAGE_COMMANDS,'clearStyleOverrides','applyStyleSnapshot','updateStyleFromNode','setNodeDefaultStyleSet',
  'addNode','updateNode','moveNodes','removeNodes','reorderNode','duplicateNodes','pasteFragment','updatePage','setPageGuides','applyStyle',
  'groupNodes','groupItems','ungroup','moveGroup','resizeGroup','lockGroup','reparentItems',
  'insertComponent','detachComponent','setComponentOverride','clearComponentOverride','setComponentInstanceView','insertLibraryItem',
  'createDynamicPanel','createRepeater','addPanelState','updatePanelState','assignPanelNodes','removePanelState','setInitialPanelState',
  'moveContainer','duplicatePanelState','reorderPanelState','setPanelOptions','setRepeaterData','addRepeaterRows','updateRepeaterRow',
  'removeRepeaterRows','setRepeaterTemplate','setRepeaterFilter','setRepeaterSort','setRepeaterPagination','setRepeaterMarks',
  'importRepeaterData','setNodesPlaced'
]);

function patchMap(project, canvas, viewId) {
  if (!viewId) throw new Error('基础视图不保存覆盖');
  const legacy = !canvas.viewSetId && canvas.views?.find(view => view.id === viewId && own(view, 'overrides'));
  if (legacy) return legacy.overrides;
  canvas.viewOverrides ||= {};
  if (!own(canvas.viewOverrides, viewId)) put(canvas.viewOverrides, viewId, {});
  return canvas.viewOverrides[viewId];
}
function putPatch(project, canvas, viewId, nodeId, patch) {
  const map = patchMap(project, canvas, viewId), previous = own(map,nodeId) ? map[nodeId] : {};
  put(map, nodeId, { ...previous, ...copy(patch), ...(patch.style ? { style: { ...previous.style, ...copy(patch.style) } } : {}) });
}
function putInstancePatch(group, viewId, patch) {
  group.viewOverrides ||= {};
  put(group.viewOverrides, viewId, { ...(own(group.viewOverrides, viewId) ? group.viewOverrides[viewId] : {}), ...copy(patch) });
}
function visitPatches(project, canvas, nodeId, callback) {
  for (const view of getCanvasViews(project, canvas)) {
    const map = getCanvasViewOverrides(project, canvas, view.id), patch = map && own(map,nodeId) ? map[nodeId] : null;
    if (!patch) continue;
    callback(patch);
    if (patch.style && !Object.keys(patch.style).length) delete patch.style;
    if (!Object.keys(patch).length) delete map[nodeId];
  }
}
function clearPaths(project, canvas, nodeId, patch) {
  visitPatches(project, canvas, nodeId, stored => {
    for (const key of Object.keys(patch)) {
      if (key === 'style') { for (const leaf of Object.keys(patch.style)) if (stored.style) delete stored.style[leaf]; }
      else delete stored[key];
    }
  });
}
export function sharedTextCleanup(project, canvas, command) {
  if (command.type === 'updateNode' && (own(command.patch, 'text') || own(command.patch, 'richText'))) {
    visitPatches(project, canvas, command.nodeId, patch => { delete patch.text; });
  }
  if (command.type === 'setComponentOverride' && own(command.patch || {}, 'text')) {
    const group = canvas.groups.find(group => group.id === command.instanceId);
    const nodeId = group?.nodeIds[group.sourceIds.indexOf(command.sourceId)];
    if (nodeId) visitPatches(project, canvas, nodeId, patch => { delete patch.text; });
  }
}

function placementIds(canvas, requested, h) {
  h.array(requested, '置入元件', 5000);
  if (!requested.length) h.fail('请选择需要置入或取消放置的元件', 'COMMAND_ERROR');
  const ids = new Set(requested); let changed = true;
  while (changed) {
    const count = ids.size;
    for (const id of [...ids]) { h.nodeFor(canvas, id); for (const child of getNodeDescendants(canvas.nodes, id)) ids.add(child); }
    for (const group of canvas.groups) if (group.componentId && group.nodeIds.some(id => ids.has(id))) for (const id of group.nodeIds) ids.add(id);
    changed = count !== ids.size;
  }
  for (const id of ids) if (isHierarchyLocked(canvas, id)) h.fail('请先解锁元件及其所属容器或组', 'LOCKED');
  return [...ids];
}
function setPlacement(project, canvas, ids, placed, viewId, scope, h) {
  h.bool(placed, '置入状态');
  const expanded = placementIds(canvas, ids, h);
  const linked = new Set();
  for (const group of canvas.groups) if (group.componentId && group.nodeIds.some(id => expanded.includes(id))) {
    if (scope === 'current' && viewId) putInstancePatch(group, viewId, { placed });
    else {
      group.placed = placed;
      if (scope === 'all') for (const [id, patch] of Object.entries(group.viewOverrides || {})) { delete patch.placed; if (!Object.keys(patch).length) delete group.viewOverrides[id]; }
    }
    for (const id of group.nodeIds) linked.add(id);
  }
  for (const id of expanded) {
    if (!linked.has(id)) {
      if (scope === 'current' && viewId) putPatch(project, canvas, viewId, id, { placed });
      else h.nodeFor(canvas, id).placed = placed;
    } else if (viewId && scope === 'current') {
      const map = getCanvasViewOverrides(project, canvas, viewId);
      if (map && own(map,id)) { delete map[id].placed; if (!Object.keys(map[id]).length) delete map[id]; }
      // Older and detached view sets may carry placement on individual members.
      // Override an inherited host patch without changing the component source.
      const inherited = resolveViewChain(getCanvasViews(project,canvas),viewId).slice(0,-1).some(view => {
        const patches = getCanvasViewOverrides(project,canvas,view.id);
        return patches && own(patches,id) && own(patches[id],'placed');
      });
      if (inherited) putPatch(project,canvas,viewId,id,{placed});
    }
    if (scope === 'all') clearPaths(project, canvas, id, { placed });
  }
}

// A temporary resolved canvas is used only to compute the requested delta. No
// unchanged resolved property, component expansion or interaction enters storage.
function simulate(project, canvas, viewId, command, h) {
  const draft = copy(project), target = h.pageFor(draft, canvas.id), resolved = resolveContainerView(project, canvas.id, viewId);
  target.nodes = resolved.nodes.map(node => { const clean = copy(node); delete clean.effectivePlaced; clean.stateStyles=copy(canvas.nodes.find(item=>item.id===node.id).stateStyles); return clean; });
  target.width = resolved.width; target.height = resolved.height;
  const before = copy(target);
  h.apply(draft, command);
  return { before, after: h.pageFor(draft, canvas.id) };
}
function changedPatch(before, after) {
  const patch = {};
  for (const key of Object.keys(after)) if (!['id','effectivePlaced','styleOverrideKeys','defaultStyleSetId'].includes(key) && !same(before[key], after[key])) {
    if (key === 'style') patch.style = Object.fromEntries(Object.entries(after.style).filter(([leaf, value]) => !same(before.style[leaf], value)));
    else patch[key] = copy(after[key]);
  }
  return patch;
}

export function applyViewCommands(project, command, h) {
  if (command.type === 'clearInstanceViewOverride') {
    h.keys(command, ['type','pageId','instanceId','viewId','fields'], '恢复实例视图继承', false);
    for (const key of ['pageId','instanceId','viewId']) if (!own(command,key)) h.fail(`恢复实例视图继承缺少 ${key}`,'COMMAND_ERROR');
    const canvas = h.pageFor(project,command.pageId), group = canvas.groups.find(group => group.id === command.instanceId);
    if (!group?.componentId) h.fail('母版实例不存在','COMMAND_ERROR');
    if (!getCanvasViews(project,canvas).some(view => view.id === command.viewId)) h.fail('视图不存在','COMMAND_ERROR');
    if (group.nodeIds.some(id => isHierarchyLocked(canvas,id))) h.fail('请先解锁实例与祖先','LOCKED');
    const fields = command.fields ?? ['x','y','placed']; h.array(fields,'实例视图属性',3);
    if (fields.some(field=>!['x','y','placed'].includes(field))) h.fail('实例视图属性无效','COMMAND_ERROR');
    const patch = own(group.viewOverrides || {}, command.viewId) ? group.viewOverrides[command.viewId] : null;
    if (patch) { for(const field of fields) delete patch[field]; if (!Object.keys(patch).length) delete group.viewOverrides[command.viewId]; }
    return true;
  }
  if (command.type === 'setNodesPlaced') {
    h.keys(command, ['type','pageId','nodeIds','placed'], '置入命令');
    setPlacement(project, h.pageFor(project, command.pageId), command.nodeIds, command.placed, null, 'current', h); return true;
  }
  if (command.type !== 'viewCommands') return false;
  h.keys(command, ['type','pageId','viewId','scope','commands'], '视图编辑批次');
  const canvas = h.pageFor(project, command.pageId);
  if (!['current','all'].includes(command.scope)) h.fail('视图编辑范围必须为 current 或 all', 'COMMAND_ERROR');
  if (command.viewId !== null && !getCanvasViews(project, canvas).some(view => view.id === command.viewId)) h.fail('编辑视图不存在，请重新选择', 'COMMAND_ERROR');
  h.array(command.commands, '视图子命令', 1000);
  const { viewId, scope } = command;
  for (const child of command.commands) {
    h.object(child, '视图子命令');
    if (!VIEW_EDIT_COMMANDS.includes(child.type)) h.fail(`此命令不属于视图局部编辑：${String(child.type)}`, 'COMMAND_ERROR');
    if (child.pageId !== canvas.id || (own(child, 'targetPageId') && child.targetPageId !== canvas.id)) h.fail('视图编辑批次不能操作其他画布', 'COMMAND_ERROR');
    const current = h.pageFor(project, canvas.id);
    if(viewId && child.type==='updateStyleFromNode')h.fail('回写命名样式仅允许在基础视图进行','COMMAND_ERROR');
    if(scope==='current' && viewId && child.type==='setNodeDefaultStyleSet')h.fail('默认样式集属于共享结构，请在基础视图修改','COMMAND_ERROR');
    if(scope==='current' && viewId && child.type==='applyStyleSnapshot' && own(child.snapshot||{},'stateStyles'))h.fail('状态格式刷是跨视图共享操作，请在基础视图使用','COMMAND_ERROR');
    if(child.type==='clearStyleOverrides'){
      h.keys(child,['type','pageId','nodeIds','keys','state'],'恢复样式继承',false);
      h.array(child.nodeIds,'元件 ID',5000);
      if(scope==='current' && viewId){
        if(own(child,'state'))h.fail('状态样式是跨视图共享属性，请在基础视图恢复继承','COMMAND_ERROR');
        const fields=child.keys??STYLE_KEYS;h.array(fields,'样式字段',STYLE_KEYS.length);
        if(new Set(fields).size!==fields.length||fields.some(key=>!STYLE_KEYS.includes(key)))h.fail('样式字段无效');
        for(const id of child.nodeIds){const node=h.nodeFor(current,id);h.assertEditable(current,node,null);const map=getCanvasViewOverrides(project,current,viewId),patch=map&&own(map,id)?map[id]:null;if(patch?.style){for(const key of fields)delete patch.style[key];if(!Object.keys(patch.style).length)delete patch.style;if(!Object.keys(patch).length)delete map[id];}}
      }else{
        h.apply(project,child);h.settle(project);
        if(scope==='all'&&!own(child,'state'))for(const id of child.nodeIds)clearPaths(project,h.pageFor(project,canvas.id),id,{style:Object.fromEntries((child.keys??STYLE_KEYS).map(key=>[key,null]))});
      }
      continue;
    }

    if (child.type === 'setNodesPlaced') {
      h.keys(child, ['type','pageId','nodeIds','placed'], '置入命令');
      setPlacement(project, current, child.nodeIds, child.placed, viewId, scope, h); continue;
    }
    if (scope === 'current' && viewId && child.type === 'removeNodes') {
      const { before, after } = simulate(project, current, viewId, child, h);
      const survivors = new Set(after.nodes.map(node => node.id));
      setPlacement(project, current, before.nodes.filter(node => !survivors.has(node.id)).map(node => node.id), false, viewId, scope, h); continue;
    }
    if (scope === 'current' && viewId && layoutCommands.has(child.type)) {
      const { before, after } = simulate(project, current, viewId, child, h);
      const old = new Map(before.nodes.map(node => [node.id, node]));
      const movedMembers = new Set();
      for (const group of after.groups) if (group.componentId) {
        const prior = before.groups.find(item => item.id === group.id), real = current.groups.find(item => item.id === group.id);
        if (!prior || !real || group.x === prior.x && group.y === prior.y) continue;
        const origin = resolveInstancePosition(project, current, real, viewId), patch = {};
        if (group.x !== prior.x) patch.x = origin.x + group.x - prior.x;
        if (group.y !== prior.y) patch.y = origin.y + group.y - prior.y;
        putInstancePatch(real,viewId,patch); for (const id of group.nodeIds) movedMembers.add(id);
      }
      const movedProjection = movedMembers.size ? new Map(resolveContainerView(project,current.id,viewId).nodes.map(node=>[node.id,node])) : null;
      for (const node of after.nodes) {
        const patch = changedPatch(old.get(node.id), node), adaptive = {}, shared = {};
        if (child.type === 'updateNode' && child.nodeId === node.id) Object.assign(patch, copy(child.patch));
        if (child.type === 'applyStyle' && child.styleId && child.nodeIds.includes(node.id)) patch.style = resolveNodeBaseStyle(project,node);
        if(child.type==='applyStyleSnapshot' && child.nodeIds.includes(node.id))patch.style=copy(child.snapshot.style);
        for (const [key, value] of Object.entries(patch)) (visualKeys.has(key) ? adaptive : shared)[key] = value;
        if (movedMembers.has(node.id)) for (const key of ['x','y']) if (own(adaptive,key) && same(adaptive[key],movedProjection.get(node.id)[key])) delete adaptive[key];
        // A visual style choice in a child view does not unlink the Base style.
        if (own(adaptive, 'style') && !own(child.patch || {}, 'styleId')) delete shared.styleId;
        if (Object.keys(shared).length) h.apply(project, {type:'updateNode',pageId:current.id,nodeId:node.id,patch:shared});
        if (Object.keys(adaptive).length) putPatch(project, current, viewId, node.id, adaptive);
      }
      sharedTextCleanup(project, current, child); continue;
    }
    if (scope === 'current' && viewId && child.type === 'updatePage' && project.pages.some(page => page.id === current.id) && ['width','height'].some(key => own(child.patch, key))) {
      h.fail('请在视图管理中修改当前子视图的尺寸；共享视图集会影响引用它的页面', 'COMMAND_ERROR');
    }
    const before = copy(current), oldIds = new Set(current.nodes.map(node => node.id));
    h.apply(project, child);
    h.settle(project);
    const updated = h.pageFor(project, canvas.id);
    if (scope === 'current' && viewId && child.type !== 'sliceImage') {
      const allCreated = updated.nodes.filter(node => !oldIds.has(node.id));
      const wrappers = allCreated.filter(node => getNodeDescendants(updated.nodes,node.id).some(id => oldIds.has(id)));
      // Wrapping existing content changes shared structure, so the new parent
      // must preserve that content in every view instead of hiding it in Base.
      for (const wrapper of wrappers) for (const view of getCanvasViews(project,updated)) {
        const resolved = resolveContainerView(project,updated.id,view.id);
        const ids = new Set(getNodeDescendants(updated.nodes,wrapper.id));
        const members = resolved.nodes.filter(node=>ids.has(node.id));
        const x=Math.min(...members.map(node=>node.x)),y=Math.min(...members.map(node=>node.y));
        putPatch(project,updated,view.id,wrapper.id,{x,y,width:Math.max(...members.map(node=>node.x+node.width))-x,height:Math.max(...members.map(node=>node.y+node.height))-y});
      }
      const sharedIds = new Set(wrappers.flatMap(node=>[node.id,...getNodeDescendants(updated.nodes,node.id)]));
      const created = allCreated.filter(node=>!sharedIds.has(node.id));
      if (created.length) {
        // New content exists once; placement expresses which views own it.
        setPlacement(project, updated, created.map(node => node.id), false, null, 'all', h);
        setPlacement(project, updated, created.map(node => node.id), true, viewId, 'current', h);
      }
    }
    if (scope === 'all' && layoutCommands.has(child.type)) {
      if (['moveNodes','moveGroup','moveContainer'].includes(child.type)) for (const group of updated.groups) if (group.componentId) {
        const prior = before.groups.find(item=>item.id===group.id); if(!prior)continue;
        for (const patch of Object.values(group.viewOverrides || {})) { if (own(patch,'x')) patch.x += group.x-prior.x; if (own(patch,'y')) patch.y += group.y-prior.y; }
      }
      const old = new Map(before.nodes.map(node => [node.id, node]));
      for (const node of updated.nodes) {
        if (!old.has(node.id)) continue;
        if (child.type === 'updateNode' && child.nodeId !== node.id) continue;
        if (['applyStyle','applyStyleSnapshot'].includes(child.type) && !child.nodeIds.includes(node.id)) continue;
        const patch = changedPatch(old.get(node.id), node);
        if (['moveNodes','moveGroup','moveContainer'].includes(child.type)) {
          const dx = node.x - old.get(node.id).x, dy = node.y - old.get(node.id).y;
          visitPatches(project, updated, node.id, stored => { if (own(stored,'x')) stored.x += dx; if (own(stored,'y')) stored.y += dy; });
        } else {
          const requested = child.type === 'updateNode' ? child.patch : child.type === 'applyStyle' && child.styleId ? {style:resolveNodeBaseStyle(project,node)} : child.type==='applyStyleSnapshot'?{style:child.snapshot.style}:patch;
          clearPaths(project, updated, node.id, Object.fromEntries(Object.entries(requested).filter(([key]) => visualKeys.has(key))));
        }
      }
    }
    sharedTextCleanup(project, updated, child);
  }
  return true;
}
