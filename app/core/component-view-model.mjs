/** Original component view definitions and projection. Stored instance IDs never change on view selection. */
import { resolveNodeBaseAppearance } from './style-model.mjs';
import { isHierarchyLocked, isGroupAncestorLocked } from './hierarchy-model.mjs';

export const COMPONENT_VIEW_PATCH_KEYS = ['x', 'y', 'width', 'height', 'rotation', 'style', 'placed'];
const copy = value => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);
const put = (object, key, value) => { Object.defineProperty(object, key, { value, writable: true, configurable: true, enumerable: true }); return value; };
function mergePatch(parent, child) {
  const result = { ...copy(parent || {}), ...copy(child || {}) };
  if (parent?.style || child?.style) result.style = { ...parent?.style, ...child?.style };
  return result;
}
export function componentViewPath(component, viewId, maxDepth = 16) {
  const result = [], seen = new Set(); let current = viewId;
  while (current !== null && current !== undefined) {
    if (seen.has(current) || seen.size >= maxDepth) throw new Error(`组件视图继承不能循环或超过 ${maxDepth} 层`);
    seen.add(current); const view = component.views.find(item => item.id === current);
    if (!view) throw new Error('组件视图不存在'); result.unshift(view); current = view.parentId;
  }
  return result;
}
/** Absolute instance origins inherit through the host canvas view chain. */
export function resolveInstancePosition(project, canvas, group, viewId = null) {
  const views = canvas.viewSetId != null ? project.viewSets.find(set => set.id === canvas.viewSetId)?.views || [] : canvas.views || [];
  const chain = [], seen = new Set(); let id = viewId;
  while (id != null) {
    if (seen.has(id) || seen.size >= 50) throw new Error('实例宿主视图继承无效');
    seen.add(id); const view = views.find(item => item.id === id); if (!view) throw new Error('实例宿主视图不存在'); chain.unshift(view); id = view.parentId;
  }
  let position = { x: group.x, y: group.y, placed: group.placed !== false };
  for (const view of chain) if (Object.hasOwn(group.viewOverrides || {}, view.id)) position = { ...position, ...group.viewOverrides[view.id] };
  return position;
}
export function validateComponentViewPatch(node, patch, h) {
  h.keys(patch, COMPONENT_VIEW_PATCH_KEYS, '组件视图属性覆盖', false);
  for (const key of ['x', 'y']) if (own(patch, key)) h.number(patch[key], '组件视图坐标', -100000, 100000);
  for (const key of ['width', 'height']) if (own(patch, key)) h.number(patch[key], '组件视图尺寸', 1, 100000);
  if (own(patch, 'rotation')) h.number(patch.rotation, '组件视图旋转', -36000, 36000);
  if (own(patch, 'placed')) h.bool(patch.placed, '组件视图放置状态');
  if (own(patch, 'style')) {
    h.keys(patch.style, h.STYLE_KEYS || Object.keys(node.style), '组件视图样式', false);
    if (h.validateStyle) h.validateStyle({ ...node.style, ...patch.style });
  }
}
export function validateComponentViews(component, h) {
  h.array(component.views, '组件视图', 50); const ids = new Set(), names = new Set();
  for (const view of component.views) {
    h.keys(view, ['id', 'name', 'parentId'], '组件视图'); h.unique(view.id, '组件视图 ID'); h.string(view.name, '组件视图名称', 200, 1);
    if (view.parentId !== null) h.id(view.parentId, '父组件视图 ID');
    const name = JSON.stringify([view.parentId, view.name]); if (names.has(name)) h.fail('同一父视图下的组件视图名称不能重复');
    names.add(name); ids.add(view.id);
  }
  for (const view of component.views) {
    if (view.parentId !== null && !ids.has(view.parentId)) h.fail('父组件视图不存在');
    try { componentViewPath(component, view.id); } catch (error) { h.fail(error.message); }
  }
  h.keys(component.viewOverrides, [...ids], '组件视图覆盖', false);
  const nodes = new Map(component.nodes.map(node => [node.id, node]));
  for (const overrides of Object.values(component.viewOverrides)) {
    h.keys(overrides, [...nodes.keys()], '组件视图元件覆盖', false);
    for (const [nodeId, patch] of Object.entries(overrides)) validateComponentViewPatch(nodes.get(nodeId), patch, h);
  }
}

/** Pure visual projection, never an edit or runtime reset. Standalone players
 * serialize this together with its style-model dependency functions; exportHtml
 * owns that bundle so the editor and player use the same inheritance rules. */
export function resolveComponentCanvas(project, canvas, viewContext = {}) {
  const clone = value => structuredClone(value);
  const visualKeys = ['x', 'y', 'width', 'height', 'rotation', 'placed'];
  const components = new Map((project.components || []).map(component => [component.id, component]));
  const pathFor = (component, viewId) => {
    const chain = [], seen = new Set(); let current = viewId;
    while (current !== null && current !== undefined) {
      if (seen.has(current) || seen.size >= 16) throw new Error('组件视图继承无效');
      seen.add(current); const view = (component.views || []).find(item => item.id === current);
      if (!view) throw new Error('组件视图不存在'); chain.unshift(view); current = view.parentId;
    }
    return chain;
  };
  const select = (component, group, path) => {
    if (group.viewMode !== 'auto') return group.viewId ?? null;
    const expected = JSON.stringify(path || []);
    return (component.views || []).find(view => JSON.stringify(pathFor(component, view.id).map(item => item.name)) === expected)?.id ?? null;
  };
  const memo = new Map(), active = new Set();
  function resolve(source, selectedId, hostPath, isComponent) {
    const key = JSON.stringify([source.id, selectedId, hostPath]); if (memo.has(key)) return clone(memo.get(key));
    if (active.has(source.id) || active.size >= 17) throw new Error('组件嵌套不能循环或超过 16 层');
    active.add(source.id);
    const result = clone(source);
    if(Array.isArray(project.styles))for(const node of result.nodes)Object.assign(node,resolveNodeBaseAppearance(project,node));
    const chain = isComponent ? pathFor(source, selectedId) : [];
    const hostViews = isComponent ? source.views || [] : source.viewSetId != null ? project.viewSets.find(set => set.id === source.viewSetId)?.views || [] : source.views || [];
    const hostChain = []; let hostId = selectedId; const hostSeen = new Set();
    while (hostId != null) { if (hostSeen.has(hostId) || hostSeen.size >= 50) throw new Error('实例宿主视图继承无效'); hostSeen.add(hostId); const view = hostViews.find(item => item.id === hostId); if (!view) throw new Error('实例宿主视图不存在'); hostChain.unshift(view); hostId = view.parentId; }
    const path = isComponent ? chain.map(view => view.name) : hostPath;
    const byId = new Map(result.nodes.map(node => [node.id, node])), groupPlacements = new Map(), sourceUnplaced = new Set();
    for (const group of source.groups || []) {
      if (!group.componentId) continue;
      const component = components.get(group.componentId); if (!component) throw new Error('组件主定义不存在');
      const projected = resolve(component, select(component, group, path), path, true);
      let position = { x: group.x, y: group.y, placed: group.placed !== false };
      for (const view of hostChain) if (Object.hasOwn(group.viewOverrides || {}, view.id)) position = { ...position, ...group.viewOverrides[view.id] };
      groupPlacements.set(group.id, position.placed);
      const originals = new Map(projected.nodes.map(node => [node.id, node]));
      for (let index = 0; index < group.sourceIds.length; index++) {
        const node = byId.get(group.nodeIds[index]), original = originals.get(group.sourceIds[index]);
        if (!node || !original) throw new Error('组件实例映射不完整');
        for (const key of visualKeys) if (Object.hasOwn(original, key)) node[key] = clone(original[key]);
        node.x = original.x + position.x; node.y = original.y + position.y; node.style = clone(original.style); node.stateStyles = clone(original.stateStyles);
        if (original.placed === false) sourceUnplaced.add(node.id);
      }
    }
    for (const view of chain) for (const [nodeId, patch] of Object.entries(source.viewOverrides?.[view.id] || {})) {
      const node = byId.get(nodeId); if (!node) continue;
      for (const key of visualKeys) if (Object.hasOwn(patch, key)) node[key] = clone(patch[key]);
      if (patch.style) node.style = { ...node.style, ...clone(patch.style) };
    }
    // A host view may hide an instance member, but cannot place a member that
    // its selected source view or containing group has excluded.
    for (const group of source.groups || []) if ((groupPlacements.has(group.id) ? groupPlacements.get(group.id) : group.placed) === false) for (const nodeId of group.nodeIds) sourceUnplaced.add(nodeId);
    for (const nodeId of sourceUnplaced) { const node = byId.get(nodeId); if (node) node.placed = false; }
    active.delete(source.id); memo.set(key, result); return clone(result);
  }
  return resolve(canvas, viewContext.viewId ?? null, viewContext.path || [], components.has(canvas.id));
}

export function applyComponentViewCommand(project, command, h) {
  const known = ['addComponentView', 'updateComponentView', 'removeComponentView', 'setComponentViewOverride', 'clearComponentViewOverride', 'setComponentInstanceView'];
  if (!known.includes(command.type)) return false;
  const check = (required, optional = []) => {
    h.keys(command, ['type', ...required, ...optional], '组件视图命令', false);
    for (const key of required) if (!own(command, key)) h.fail(`组件视图命令缺少 ${key}`, 'COMMAND_ERROR');
  };
  if (command.type === 'setComponentInstanceView') {
    check(['pageId', 'instanceId', 'viewMode', 'viewId']); const page = h.pageFor(project, command.pageId), group = page.groups.find(item => item.id === command.instanceId);
    if (!group?.componentId) h.fail('所选对象不是组件实例', 'COMMAND_ERROR');
    if (group.locked || isGroupAncestorLocked(page, group) || group.nodeIds.some(id => isHierarchyLocked(page, id))) h.fail('请先解锁组件实例及祖先', 'LOCKED');
    const component = project.components.find(item => item.id === group.componentId);
    if (!['fixed', 'auto'].includes(command.viewMode) || command.viewMode === 'auto' && command.viewId !== null || command.viewId !== null && !component.views.some(view => view.id === command.viewId)) h.fail('组件实例视图选择无效', 'COMMAND_ERROR');
    group.viewMode = command.viewMode; group.viewId = command.viewId; return true;
  }
  const component = project.components.find(item => item.id === command.componentId);
  if (!component) h.fail('组件主定义不存在', 'COMMAND_ERROR');
  const find = () => { const view = component.views.find(item => item.id === command.viewId); if (!view) h.fail('组件视图不存在', 'COMMAND_ERROR'); return view; };
  if (command.type === 'addComponentView') {
    check(['componentId', 'view']); h.keys(command.view, ['id', 'name', 'parentId'], '新组件视图', false);
    for (const key of ['name', 'parentId']) if (!own(command.view, key)) h.fail(`新组件视图缺少 ${key}`, 'COMMAND_ERROR');
    component.views.push({ id: h.uuid(), ...copy(command.view) });
  } else if (command.type === 'updateComponentView') {
    check(['componentId', 'viewId', 'patch']); h.keys(command.patch, ['name', 'parentId'], '组件视图修改', false); Object.assign(find(), copy(command.patch));
  } else if (command.type === 'removeComponentView') {
    check(['componentId', 'viewId']); const removed = find(), inherited = component.viewOverrides[removed.id] || {};
    for (const child of component.views.filter(view => view.parentId === removed.id)) {
      const ownPatches = component.viewOverrides[child.id] || {}, combined = {};
      for (const nodeId of new Set([...Object.keys(inherited), ...Object.keys(ownPatches)])) put(combined, nodeId, mergePatch(own(inherited, nodeId) ? inherited[nodeId] : {}, own(ownPatches, nodeId) ? ownPatches[nodeId] : {}));
      put(component.viewOverrides, child.id, combined); child.parentId = removed.parentId;
      for (const group of component.groups) if (own(group.viewOverrides || {}, removed.id)) put(group.viewOverrides, child.id, { ...group.viewOverrides[removed.id], ...(own(group.viewOverrides, child.id) ? group.viewOverrides[child.id] : {}) });
    }
    component.views = component.views.filter(view => view.id !== removed.id); delete component.viewOverrides[removed.id];
    for (const group of component.groups) delete group.viewOverrides[removed.id];
    for (const canvas of [...project.pages, ...project.components]) for (const group of canvas.groups) if (group.componentId === component.id && group.viewId === removed.id) group.viewId = removed.parentId;
  } else {
    check(['componentId', 'viewId', 'nodeId'], command.type === 'setComponentViewOverride' ? ['patch'] : ['fields']); find();
    const node = h.nodeFor(component, command.nodeId); if (isHierarchyLocked(component, node.id)) h.fail('请先解锁元件及祖先', 'LOCKED');
    if (command.type === 'setComponentViewOverride') {
      if (!own(command, 'patch')) h.fail('组件视图命令缺少 patch', 'COMMAND_ERROR'); validateComponentViewPatch(node, command.patch, h);
      const overrides = own(component.viewOverrides, command.viewId) ? component.viewOverrides[command.viewId] : put(component.viewOverrides, command.viewId, {});
      put(overrides, node.id, mergePatch(own(overrides, node.id) ? overrides[node.id] : {}, command.patch));
    } else {
      const overrides = own(component.viewOverrides, command.viewId) ? component.viewOverrides[command.viewId] : undefined, patch = overrides && own(overrides, node.id) ? overrides[node.id] : undefined;
      if (!own(command, 'fields')) { if (overrides) delete overrides[node.id]; }
      else {
        h.array(command.fields, '清除组件视图覆盖字段', 30);
        const permitted = [...COMPONENT_VIEW_PATCH_KEYS, ...Object.keys(node.style).map(key => `style.${key}`)];
        if (command.fields.some(key => !permitted.includes(key))) h.fail('组件视图覆盖字段无效');
        for (const field of command.fields) { if (!patch) continue; if (field.startsWith('style.')) { if (patch.style) delete patch.style[field.slice(6)]; } else delete patch[field]; }
        if (patch?.style && !Object.keys(patch.style).length) delete patch.style;
        if (patch && !Object.keys(patch).length) delete overrides[node.id];
      }
      if (overrides && !Object.keys(overrides).length) delete component.viewOverrides[command.viewId];
    }
  }
  return true;
}
