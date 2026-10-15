/** Original, read-only view resolution shared by the editor and offline player. */
import { resolveComponentCanvas } from './component-view-model.mjs';

export function resolveViewChain(views, viewId) {
  if (viewId == null) return [];
  const byId = new Map(views.map(view => [view.id, view])), seen = new Set(), chain = [];
  for (let id = viewId; id != null;) {
    if (seen.has(id) || chain.length >= 50) throw Object.assign(new Error('视图继承存在循环或超过 50 层'), { code: 'VIEW_ERROR' });
    const view = byId.get(id);
    if (!view) throw Object.assign(new Error('视图或父视图不存在：' + id), { code: 'VIEW_ERROR' });
    seen.add(id); chain.unshift(view); id = view.parentId ?? null;
  }
  return chain;
}

export function getCanvasViews(project, canvas) {
  if (canvas.viewSetId != null) {
    const set = (project.viewSets || []).find(item => item.id === canvas.viewSetId);
    if (!set) throw Object.assign(new Error('页面引用的视图集不存在'), { code: 'VIEW_ERROR' });
    return set.views;
  }
  return canvas.views || [];
}

/** Returns the actual draft map, or undefined; never creates or changes it. */
export function getCanvasViewOverrides(project, canvas, viewId) {
  if (viewId == null) return undefined;
  const component = (project.components || []).some(item => item.id === canvas.id);
  return component || canvas.viewSetId != null ? Object.hasOwn(canvas.viewOverrides || {},viewId) ? canvas.viewOverrides[viewId] : undefined : canvas.views?.find(view => view.id === viewId)?.overrides;
}

export function selectAdaptiveView(project, page, viewportWidth, requestedView) {
  const views = getCanvasViews(project, page);
  if (requestedView === null) return null;
  if (requestedView !== undefined) return views.some(view => view.id === requestedView) ? requestedView : null;
  return [...views].filter(view => view.minWidth <= viewportWidth).sort((a, b) => b.minWidth - a.minWidth)[0]?.id ?? (page.viewSetId != null ? [...views].sort((a,b)=>a.minWidth-b.minWidth)[0]?.id ?? null : null);
}

export function resolveCanvasView(project, canvas, viewId = null) {
  const views = getCanvasViews(project, canvas), chain = resolveViewChain(views, viewId), component = (project.components || []).some(item => item.id === canvas.id);
  const result = resolveComponentCanvas(project, canvas, { viewId, path: chain.map(view => view.name) });
  // Capture source/group gates before page overrides. A legacy page override
  // is not a source gate, so a child view can still override that page value.
  const projectedNodes = new Map(result.nodes.map(node => [node.id, node])), placementBlocks = new Set();
  for (const group of result.groups || []) for (const id of group.nodeIds) {
    if (group.componentId ? projectedNodes.get(id)?.placed === false : group.placed === false) placementBlocks.add(id);
  }
  if (!component) for (const view of chain) {
    const overrides = getCanvasViewOverrides(project, canvas, view.id) || {};
    result.width = view.width; result.height = view.height;
    result.nodes = result.nodes.map(node => {
      const patch = Object.hasOwn(overrides,node.id) ? overrides[node.id] : undefined;
      if (!patch) return node;
      const next = { ...node, ...structuredClone(patch), style: { ...node.style, ...(patch.style || {}) } };
      if (Object.hasOwn(patch, 'text')) next.richText = null;
      return next;
    });
  }
  for (const node of result.nodes) if (placementBlocks.has(node.id)) node.placed = false;
  // Placement is inherited through logical containers, including panels whose
  // DOM may be portalled outside the parent. Visibility remains a separate flag.
  const nodes = new Map(result.nodes.map(node => [node.id, node])), parents = new Map(), done = new Map();
  for (const node of result.nodes) for (const id of node.panel?.states.flatMap(state => state.nodeIds) || node.repeater?.templateIds || []) parents.set(id, node.id);
  function placed(id, seen = new Set()) {
    if (done.has(id)) return done.get(id);
    if (seen.has(id)) throw Object.assign(new Error('元件容器存在循环'), { code: 'VIEW_ERROR' });
    seen.add(id); const node = nodes.get(id), parent = parents.get(id);
    const value = node?.placed !== false && (!parent || placed(parent, seen)); done.set(id, value); return value;
  }
  for (const node of result.nodes) { node.placed ??= true; node.effectivePlaced = placed(node.id); }
  return result;
}

export function resolveContainerView(project, targetId, viewId = null) {
  const canvas = [...project.pages, ...(project.components || [])].find(item => item.id === targetId);
  if (!canvas) throw Object.assign(new Error('页面或组件不存在：' + targetId), { code: 'VIEW_ERROR' });
  return resolveCanvasView(project, canvas, viewId);
}

/** Old callers can still resolve an independent page without a project. */
export function resolveAdaptivePage(page, viewportWidth, requestedView, project = { pages: [page], components: [], viewSets: [] }) {
  return resolveCanvasView(project, page, selectAdaptiveView(project, page, viewportWidth, requestedView));
}
