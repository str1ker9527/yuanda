/** 原创设计模型扩展。所有操作只修改事务草稿，不直接操作 UI 或文件。 */
import { normalizeInteractionProject, getNodeDescendants, getNodeInternalIds, remapNodeReferences, cleanInteractionReferences } from './interaction-model.mjs';
import { normalizeVectorProject, remapVectorReferences } from './vector-model.mjs';
import { applyHierarchyCommand, validateGroupHierarchy, groupsForNode, groupAncestors, isHierarchyLocked, isGroupAncestorLocked, pruneGroups, groupScope, hierarchyIndex, boundaryNodeIds, ownerNodeId } from './hierarchy-model.mjs';
import { applyComponentViewCommand, validateComponentViews, resolveComponentCanvas, componentViewPath, validateComponentViewPatch } from './component-view-model.mjs';
import { resolveCanvasView, getCanvasViews } from './view-model.mjs';
import { normalizeImageProject, imageDataBytes, resetImageSource, prepareImageNodePatch } from './image-model.mjs';
import { normalizeStyleProject, styleValueEqual, STYLE_KEYS, STYLE_STATES, resolveNodeBaseStyle, resolveNodeStateStyles, validateStyleInheritance, applyStyleInheritanceCommand } from './style-model.mjs';
import { PAGE_TREE_PROJECT_KEYS, normalizePageTreeProject, validatePageTree, syncLegacyPageOrder } from './page-tree-model.mjs';
import { validateGuides } from './guide-model.mjs';
export const DESIGN_NODE_KEYS = ['annotation', 'styleId', 'styleOverrideKeys', 'defaultStyleSetId', 'checked', 'options', 'value', 'radioGroup', 'rows', 'inputType', 'readOnly', 'maxLength'];
export const INPUT_TYPES = ['text', 'password', 'number', 'email', 'date', 'tel', 'url', 'search'];
export const DESIGN_PAGE_KEYS = ['parentId', 'guides', 'groups'];
export const DESIGN_PROJECT_KEYS = ['styles', 'components', 'globalGuides', 'styleInheritanceVersion', 'defaultStyleSets', 'defaultStyleSetId', ...PAGE_TREE_PROJECT_KEYS];
export const DESIGN_TYPES = ['ellipse', 'line', 'textarea', 'checkbox', 'radio', 'select', 'table'];
export const GROUP_KEYS = ['id', 'name', 'nodeIds', 'locked', 'parentGroupId', 'componentId', 'x', 'y', 'sourceIds', 'internalIds', 'overrides', 'viewMode', 'viewId', 'placed', 'viewOverrides'];
export const COMPONENT_KEYS = ['id', 'name', 'width', 'height', 'nodes', 'background', 'annotation', 'guides', 'groups', 'views', 'viewOverrides'];
const copy = value => structuredClone(value);
const own = (object, key) => Object.hasOwn(object, key);
const put = (object, key, value) => { Object.defineProperty(object, key, { value, writable: true, configurable: true, enumerable: true }); return value; };
const entry = (object, key) => own(object, key) ? object[key] : put(object, key, {});
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function defaults(object, values) { if (plain(object)) for (const [key, value] of Object.entries(values)) if (!own(object, key)) object[key] = copy(value); return object; }
const componentDefaults = () => ({ background: '#FFFFFF', annotation: '', guides: { horizontal: [], vertical: [] }, groups: [], views: [], viewOverrides: {} });
const groupDefaults = () => ({ internalIds: {}, overrides: {}, parentGroupId: null, viewMode: 'fixed', viewId: null, placed: true, viewOverrides: {} });

export function nodeDesignDefaults(type) {
  return { annotation: '', styleId: null, checked: false, options: type === 'select' ? ['选项一', '选项二'] : [], value: '', radioGroup: '', rows: type === 'table' ? [['姓名', '状态'], ['示例', '进行中']] : [], inputType: 'text', readOnly: false, maxLength: null };
}
/** v1 旧文件的无损迁移：只补原先缺少的字段，显式无效值不会被悄悄修正。 */
export function normalizeDesignProject(input) {
  const project = normalizePageTreeProject(copy(input));
  defaults(project, { styles: [], components: [], globalGuides: { horizontal: [], vertical: [] } });
  if (Array.isArray(project?.pages)) for (const page of project.pages) {
    defaults(page, { parentId: null, guides: { horizontal: [], vertical: [] }, groups: [] });
    if (Array.isArray(page?.groups)) for (const group of page.groups) defaults(group, groupDefaults());
    if (Array.isArray(page?.nodes)) for (const node of page.nodes) defaults(node, nodeDesignDefaults(node?.type));
  }
  if (Array.isArray(project?.components)) for (const component of project.components) {
    defaults(component, componentDefaults());
    if (Array.isArray(component?.groups)) for (const group of component.groups) defaults(group, groupDefaults());
    if (Array.isArray(component?.nodes)) for (const node of component.nodes) defaults(node, nodeDesignDefaults(node?.type));
  }
  return normalizeStyleProject(normalizeImageProject(normalizeVectorProject(normalizeInteractionProject(project))));
}

export function validateDesignProject(project, h) {
  const { keys, string, number, bool, array, id, unique, fail, validateStyle, color } = h;
  validateGuides(project.globalGuides, '项目参考线', h);
  array(project.styles, '复用样式', 1000); array(project.components, '组件主定义', 500);
  validateStyleInheritance(project,h);
  for(const set of project.defaultStyleSets)unique(set.id,'默认样式集 ID');
  const styles = new Map();
  for (const style of project.styles) {
    keys(style, ['id', 'name', 'style', 'parentId', 'overrideKeys', 'stateStyles'], '复用样式'); unique(style.id, '样式 ID'); string(style.name, '样式名称', 200, 1); validateStyle(style.style); styles.set(style.id, style);
  }
  const components = new Map();
  for (const component of project.components) {
    keys(component, COMPONENT_KEYS, '组件主定义'); unique(component.id, '组件 ID'); string(component.name, '组件名称', 200, 1);
    number(component.width, '组件宽度', 1, 100000); number(component.height, '组件高度', 1, 100000); array(component.nodes, '组件元件', 5000);
    color(component.background, '组件背景'); string(component.annotation, '组件注释', 50000);
    if (!component.nodes.length) fail('组件至少包含一个元件'); components.set(component.id, component);
    validateComponentViews(component, h);
  }
  validatePageTree(project, h);
  componentOrder(project, h);
  for (const page of [...project.pages, ...project.components]) {
    validateGuides(page.guides, '页面参考线', h);
    array(page.groups, '元件组', 2500); const nodes = new Map(page.nodes.map(node => [node?.id, node]));
    for (const group of page.groups) {
      keys(group, GROUP_KEYS, '元件组'); unique(group.id, '元件组 ID'); string(group.name, '元件组名称', 200, 1); bool(group.locked, '元件组锁定');
      bool(group.placed, '元件组放置状态');
      if (!['fixed', 'auto'].includes(group.viewMode)) fail('组件视图模式须为 fixed 或 auto');
      if (group.viewId !== null) id(group.viewId, '实例视图 ID');
      if (group.viewMode === 'auto' && group.viewId !== null) fail('自动匹配组件视图时 viewId 须为 null');
      keys(group.viewOverrides, getCanvasViews(project, page).map(view => view.id), '实例视图原点', false);
      for (const position of Object.values(group.viewOverrides)) { keys(position, ['x', 'y', 'placed'], '实例视图坐标与放置', false); for (const axis of ['x', 'y']) if (own(position, axis)) number(position[axis], '实例视图坐标', -100000, 100000); if (own(position, 'placed')) bool(position.placed, '实例视图放置'); }
      number(group.x, '组件偏移 X', -100000, 100000); number(group.y, '组件偏移 Y', -100000, 100000);
      array(group.nodeIds, '组内元件', 5000); array(group.sourceIds, '组件源元件', 5000);
      if (!plain(group.internalIds)) fail('组件内部 ID 映射必须为对象'); for (const [source, target] of Object.entries(group.internalIds)) { id(source, '组件内部源 ID'); id(target, '组件内部实例 ID'); }
      keys(group.overrides, group.sourceIds, '组件实例覆盖', false);
      if (group.nodeIds.length < (group.componentId === null ? 2 : 1)) fail('普通组至少两个元件，组件实例至少一个元件');
      for (const nodeId of group.nodeIds) { id(nodeId, '组内元件 ID'); if (!nodes.has(nodeId)) fail(`组内元件不存在：${nodeId}`); }
      if (group.componentId === null) { if (group.sourceIds.length || Object.keys(group.internalIds).length || Object.keys(group.overrides).length || group.viewMode !== 'fixed' || group.viewId !== null || Object.keys(group.viewOverrides).length) fail('普通组不能包含组件源映射、视图或覆盖'); }
      else {
        id(group.componentId, '实例组件 ID'); const component = components.get(group.componentId); if (!component) fail(`组件主定义不存在：${group.componentId}`);
        if (group.viewId !== null && !component.views.some(view => view.id === group.viewId)) fail('实例选择的组件视图不存在');
        if (group.sourceIds.length !== group.nodeIds.length || group.sourceIds.length !== component.nodes.length) fail('组件实例的元件映射不完整');
        const distinct = new Set(group.sourceIds);
        if (distinct.size !== group.sourceIds.length || component.nodes.some(node => !distinct.has(node.id))) fail('组件实例的源元件映射无效');
        const internal = getNodeInternalIds(component.nodes);
        if (Object.keys(group.internalIds).length !== internal.length || internal.some(id => !Object.hasOwn(group.internalIds, id))) fail('组件内部状态或数据行 ID 映射不完整');
        for (const source of component.nodes) {
          const instance = nodes.get(group.nodeIds[group.sourceIds.indexOf(source.id)]), sourceInternal = getNodeInternalIds([source]), instanceInternal = getNodeInternalIds([instance]);
          if (sourceInternal.length !== instanceInternal.length || sourceInternal.some((id, index) => group.internalIds[id] !== instanceInternal[index])) fail('组件内部状态或数据行 ID 映射不匹配');
        }
        for (const [sourceId, patch] of Object.entries(group.overrides)) validateComponentOverride(component.nodes.find(node => node.id === sourceId), patch, h);
      }
    }
    validateGroupHierarchy(page, fail);
  }
  for (const container of [...project.pages, ...project.components]) for (const node of container.nodes) {
    if (!plain(node)) fail('元件必须是普通对象');
    string(node.annotation, '元件注释', 50000); bool(node.checked, '选中状态'); string(node.value, '元件值', 50000); string(node.radioGroup, '单选组名称', 200);
    if (!INPUT_TYPES.includes(node.inputType)) fail('输入类型只支持 text、password、number、email、date、tel、url、search');
    bool(node.readOnly, '只读状态');
    if (node.type !== 'input' && node.inputType !== 'text') fail('只有单行输入框可以设置输入类型');
    if (!['input', 'textarea'].includes(node.type) && (node.readOnly || node.maxLength !== null)) fail('只有单行和多行输入框可以设置只读或最大长度');
    if (node.maxLength !== null) {
      number(node.maxLength, '最大输入长度', 0, 50000); if (!Number.isInteger(node.maxLength)) fail('最大输入长度必须是整数或 null');
      if (node.type === 'input' && ['number', 'date'].includes(node.inputType)) fail('数字和日期输入不使用字符长度限制，请将 maxLength 设为 null');
    }
    array(node.options, '下拉选项', 1000); for (const option of node.options) string(option, '选项文字', 2000);
    array(node.rows, '表格行', 200); let cellCount = 0;
    for (const row of node.rows) { array(row, '表格单行', 100); cellCount += row.length; if (cellCount > 10000) fail('表格最多 10000 个单元格'); for (const value of row) string(value, '单元格文字', 10000); }
    if (node.styleId !== null) { id(node.styleId, '引用样式 ID'); if (!styles.has(node.styleId)) fail(`复用样式不存在：${node.styleId}`); }
  }
}

function commandKeys(command, required, optional, h) {
  h.keys(command, ['type', ...required, ...optional], '设计命令', false);
  for (const name of required) if (!own(command, name)) h.fail(`设计命令缺少 ${name}`, 'COMMAND_ERROR');
}
function definition(project, componentId, h) { const item = project.components.find(value => value.id === componentId); if (!item) h.fail(`找不到组件：${componentId}`, 'COMMAND_ERROR'); return item; }
function styleFor(project, styleId, h) { const item = project.styles.find(value => value.id === styleId); if (!item) h.fail(`找不到样式：${styleId}`, 'COMMAND_ERROR'); return item; }
export function groupForNode(page, nodeId) { const groups=groupsForNode(page,nodeId);return groups.find(group=>group.componentId)||groups[0]; }
function groupFor(page, groupId, h) { const group = page.groups.find(value => value.id === groupId); if (!group) h.fail(`找不到元件组：${groupId}`, 'COMMAND_ERROR'); return group; }
function validateComponentOverride(source, patch, h) {
  if (!source) h.fail('覆盖的主定义元件不存在', 'COMMAND_ERROR');
  h.keys(patch, ['text', 'src'], '组件内容覆盖', false);
  if (!Object.keys(patch).length) h.fail('组件内容覆盖不能为空');
  if (own(patch, 'text')) h.string(patch.text, '覆盖文字', 50000);
  if (own(patch, 'src')) {
    if (source.type !== 'image') h.fail('图片覆盖只能用于图片元件');
    h.string(patch.src, '覆盖图片', 6 * 1024 * 1024);
    if (patch.src) imageDataBytes(patch.src);
  }
}
/** 先检查依赖图再同步。依赖先于使用它的母版；任何环或过深结构都不能进入递归展开。 */
function componentOrder(project, h) {
  const components = new Map(project.components.map(item => [item.id, item])), active = new Set(), depths = new Map(), ordered = [];
  function visit(component) {
    if (active.has(component.id)) h.fail('组件嵌套不能形成循环');
    if (depths.has(component.id)) return depths.get(component.id);
    active.add(component.id); h.array(component.groups, '组件元件组', 2500); let depth = 1;
    for (const group of component.groups) if (group?.componentId !== null) {
      const child = components.get(group?.componentId); if (!child) h.fail(`嵌套组件不存在：${String(group?.componentId)}`);
      depth = Math.max(depth, 1 + visit(child)); if (depth > 16) h.fail('组件嵌套最多 16 层');
    }
    active.delete(component.id); depths.set(component.id, depth); ordered.push(component); return depth;
  }
  for (const component of project.components) visit(component);
  return ordered;
}

/** 锁定由真实引擎执行，Agent 与鼠标都不能绕过。 */
export function assertNodeEditable(page, node, patch, h) {
  const group = groupForNode(page, node.id);
  if (isHierarchyLocked(page,node.id)&&!(node.locked&&patch&&Object.keys(patch).length===1&&patch.locked===false&&!isHierarchyLocked(page,node.id,true))) h.fail('元件、组或祖先容器已锁定，请先解锁','LOCKED');
  if (node.locked && !(patch && Object.keys(patch).length === 1 && patch.locked === false)) h.fail('元件已锁定，请先解锁', 'LOCKED');
  if (group?.componentId) h.fail('这是组件实例，请修改主定义或先解除关联', 'COMPONENT_LINKED');
}

/** 移动显式选择集合及其容器后代，关联组件按整个实例平移，避免重复位移。 */
export function translateNodes(page, requestedIds, dx, dy, h) {
  const selected = new Set(requestedIds); let changed = true;
  while (changed) { const before = selected.size; for (const id of [...selected]) for (const child of getNodeDescendants(page.nodes, id)) selected.add(child); for (const group of page.groups) if (group.componentId && group.nodeIds.some(id => selected.has(id))) for (const id of group.nodeIds) selected.add(id); changed = before !== selected.size; }
  for (const id of selected) { if (isHierarchyLocked(page,id)) h.fail('请先解锁元件及其所属组和祖先容器', 'LOCKED'); }
  for (const group of page.groups) if (group.componentId && group.nodeIds.some(id => selected.has(id))) { group.x += dx; group.y += dy; }
  for (const id of selected) { const node = h.nodeFor(page, id); node.x += dx; node.y += dy; }
}

/** 同步命名样式和组件实例。旧实例 ID 保持稳定，新增/删除主元件更新映射。 */
export function reconcileDesignProject(project, h) {
  for (const container of [...project.pages, ...project.components]) for (const node of container.nodes) {
    node.style = resolveNodeBaseStyle(project,node);
  }
  const removed = new Set();
  for (const page of [...componentOrder(project, h), ...project.pages]) for (const group of page.groups) {
    if (group.componentId === null) continue;
    const component = definition(project, group.componentId, h);
    const prior = new Map(group.sourceIds.map((source, index) => [source, group.nodeIds[index]]));
    const mapping = new Map(component.nodes.map(node => [node.id, prior.get(node.id) || h.uuid()]));
    const internal = getNodeInternalIds(component.nodes), nextInternal = {};
    for (const id of internal) { nextInternal[id] = group.internalIds?.[id] || h.uuid(); mapping.set(id, nextInternal[id]); }
    const previousIds = new Set(group.nodeIds);
    const externalOwner=group.nodeIds.length?groupScope(page,group):null;
    const externalNode=externalOwner&&ownerNodeId(externalOwner)?page.nodes.find(node=>node.id===ownerNodeId(externalOwner)):null;
    const externalList=externalOwner?.kind==='panelState'?externalNode?.panel?.states.find(state=>state.id===externalOwner.stateId)?.nodeIds:externalOwner?.kind==='repeater'?externalNode?.repeater?.templateIds:null;
    const externalPosition=externalList?.findIndex(id=>previousIds.has(id))??-1;
    const activeIds = new Set(mapping.values()); for (const id of Object.values(group.internalIds || {})) if (!activeIds.has(id)) removed.add(id);
    for (const nodeId of previousIds) if (!activeIds.has(nodeId)) removed.add(nodeId);
    const index = page.nodes.findIndex(node => previousIds.has(node.id));
    const sourceIds = new Set(component.nodes.map(node => node.id));
    group.overrides = Object.fromEntries(Object.entries(group.overrides || {}).filter(([sourceId]) => sourceIds.has(sourceId)));
    const instanceNodes = component.nodes.map(source => {
      const node = remapVectorReferences(remapNodeReferences(source, mapping), mapping); node.id = mapping.get(source.id); node.x = source.x + group.x; node.y = source.y + group.y;
      const override = group.overrides[source.id];
      if (own(group.overrides, source.id)) {
        validateComponentOverride(source, override, h); Object.assign(node, copy(override)); if (own(override, 'text')) node.richText = null;
        if (own(override, 'src')) node.image = override.src ? {...node.image,naturalWidth:null,naturalHeight:null,optimization:null} : resetImageSource(node.image);
      }
      return node;
    });
    page.nodes = page.nodes.filter(node => !previousIds.has(node.id));
    page.nodes.splice(index < 0 ? page.nodes.length : index, 0, ...instanceNodes);
    if (page.nodes.length > 5000 || [...project.pages, ...project.components].reduce((count, container) => count + container.nodes.length, 0) > 10000) h.fail('组件展开后超过项目或画布元件数量限制');
    group.nodeIds = instanceNodes.map(node => node.id); group.sourceIds = component.nodes.map(node => node.id); group.internalIds = nextInternal;
    for(const parent of groupAncestors(page,group.id))parent.nodeIds=[...new Set([...parent.nodeIds.filter(id=>!previousIds.has(id)),...group.nodeIds])];
    if(externalList){const next=externalList.filter(id=>!previousIds.has(id)),roots=boundaryNodeIds(page,group.nodeIds);next.splice(externalPosition<0?next.length:Math.min(externalPosition,next.length),0,...roots);if(externalOwner.kind==='panelState')externalNode.panel.states.find(state=>state.id===externalOwner.stateId).nodeIds=next;else externalNode.repeater.templateIds=next;}
  }
  for(const page of [...project.pages,...project.components])pruneGroups(page);
  if (removed.size) h.cleanReferences(project, removed);
}

export function prepareNodeRemoval(page, requestedIds, h) {
  const removed = new Set(requestedIds);
  for (const nodeId of requestedIds) {
    const node = h.nodeFor(page, nodeId), group = groupForNode(page, nodeId);
    if (isHierarchyLocked(page,nodeId)) h.fail('锁定的元件、元件组或祖先容器不能删除', 'LOCKED');
    if (group?.componentId) for (const memberId of group.nodeIds) { if (h.nodeFor(page, memberId).locked) h.fail('组件内含锁定元件，请先修改主定义', 'LOCKED'); removed.add(memberId); }
  }
  const previousGroups=[...page.groups];page.groups = page.groups.filter(group => {
    group.nodeIds = group.nodeIds.filter(nodeId => !removed.has(nodeId));
    return group.nodeIds.length >= (group.componentId === null ? 2 : 1);
  });
  for(const group of page.groups){const visited=new Set();while(group.parentGroupId&&!page.groups.some(item=>item.id===group.parentGroupId)&&!visited.has(group.parentGroupId)){visited.add(group.parentGroupId);group.parentGroupId=previousGroups.find(item=>item.id===group.parentGroupId)?.parentGroupId||null;}}
  return removed;
}

function canvasViewState(project, canvas) {
  if (canvas.viewState) return canvas.viewState;
  const component = project.components.some(item => item === canvas || item.id === canvas.id);
  if (component) return { kind: 'component', definitions: canvas.views || [], overrides: canvas.viewOverrides || {}, activeViewId: null };
  if (canvas.viewSetId !== null && canvas.viewSetId !== undefined) return { kind: 'adaptive', definitions: project.viewSets.find(set => set.id === canvas.viewSetId)?.views || [], overrides: canvas.viewOverrides || {}, activeViewId: null };
  return null;
}
function materializeInstanceViews(project, canvas, groups) {
  const ids = new Set(groups.flatMap(group => group.nodeIds)), definitions = getCanvasViews(project, canvas);
  const projections = new Map([null, ...definitions.map(view => view.id)].map(viewId => [viewId, new Map(resolveCanvasView(project, canvas, viewId).nodes.map(node => [node.id, node]))]));
  const visual = ['x', 'y', 'width', 'height', 'rotation', 'placed'];
  for (const id of ids) {
    const node = canvas.nodes.find(node => node.id === id), projected = projections.get(null).get(id); if (!node || !projected) continue;
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'placed']) if (own(projected, key)) node[key] = projected[key];
    node.style = copy(projected.style); node.stateStyles = copy(projected.stateStyles); node.styleId = null; node.styleOverrideKeys = [...STYLE_KEYS];
  }
  const component = project.components.includes(canvas);
  for (const view of definitions) {
    const overrides = component || canvas.viewSetId != null ? entry(canvas.viewOverrides, view.id) : view.overrides;
    const parent = projections.get(view.parentId ?? null), current = projections.get(view.id);
    for (const id of ids) {
      const baseline = parent.get(id), projected = current.get(id); if (!baseline || !projected) continue;
      const patch = copy(own(overrides, id) ? overrides[id] : {}); for (const key of [...visual, 'style']) delete patch[key];
      for (const key of visual) if (projected[key] !== baseline[key]) patch[key] = projected[key];
      const style = Object.fromEntries(Object.entries(projected.style).filter(([key, value]) => !styleValueEqual(value,baseline.style[key]))); if (Object.keys(style).length) patch.style = style;
      if (Object.keys(patch).length) put(overrides, id, patch); else delete overrides[id];
    }
  }
}
function validateFragmentViewState(state, source, h) {
  h.keys(state, ['kind', 'definitions', 'overrides', 'activeViewId'], '剪贴板视图状态');
  if (!['component', 'adaptive'].includes(state.kind)) h.fail('剪贴板视图种类无效');
  h.array(state.definitions, '剪贴板视图定义', 50); const ids = new Set(), names = new Set();
  for (const view of state.definitions) {
    h.keys(view, ['id', 'name', 'parentId', 'minWidth', 'width', 'height'], '剪贴板视图定义', false);
    for (const key of ['id', 'name', 'parentId']) if (!own(view, key)) h.fail(`剪贴板视图缺少 ${key}`);
    h.id(view.id, '剪贴板视图 ID'); h.string(view.name, '剪贴板视图名称', 200, 1); if (view.parentId !== null) h.id(view.parentId, '剪贴板父视图 ID');
    const name = JSON.stringify([view.parentId, view.name]); if (ids.has(view.id) || names.has(name)) h.fail('剪贴板视图 ID 或同父名称重复'); ids.add(view.id); names.add(name);
    for (const key of ['minWidth', 'width', 'height']) if (own(view, key)) h.number(view[key], '剪贴板视图尺寸或断点', key === 'minWidth' ? 0 : 100, 20000);
  }
  for (const view of state.definitions) componentViewPath({ views: state.definitions }, view.id, state.kind === 'component' ? 16 : 50);
  if (state.activeViewId !== null && !ids.has(state.activeViewId)) h.fail('剪贴板当前视图不存在');
  h.keys(state.overrides, [...ids], '剪贴板视图覆盖', false);
  for (const overrides of Object.values(state.overrides)) {
    h.keys(overrides, source.nodes.map(node => node.id), '剪贴板视图元件覆盖', false);
    for (const [nodeId, patch] of Object.entries(overrides)) {
      const node = source.nodes.find(node => node.id === nodeId);
      if (state.kind === 'component') validateComponentViewPatch(node, patch, h);
      else {
        h.keys(patch, ['x', 'y', 'width', 'height', 'rotation', 'style', 'placed', 'visible', 'disabled', 'text', 'value'], '剪贴板自适应覆盖', false);
        validateComponentViewPatch(node, Object.fromEntries(Object.entries(patch).filter(([key]) => !['visible', 'disabled', 'text', 'value'].includes(key))), h);
        for (const key of ['visible', 'disabled']) if (own(patch, key)) h.bool(patch[key], '剪贴板自适应状态');
        for (const key of ['text', 'value']) if (own(patch, key)) h.string(patch[key], '剪贴板自适应文字', 50000);
      }
    }
  }
}
function validateFragmentAppearance(appearance, source, h) {
  h.keys(appearance, ['base', 'views', 'stateStyles'], '剪贴板外观快照', false);
  for (const key of ['base', 'views']) if (!own(appearance, key)) h.fail(`剪贴板外观快照 缺少 ${key}`);
  const viewIds = (source.viewState?.definitions || source.views || []).map(view => view.id);
  h.keys(appearance.views, viewIds, '剪贴板外观视图', false);
  for (const patches of [appearance.base, ...Object.values(appearance.views)]) {
    h.keys(patches, source.nodes.map(node => node.id), '剪贴板外观元件', false);
    for (const [id, patch] of Object.entries(patches)) validateComponentViewPatch(source.nodes.find(node => node.id === id), patch, h);
  }
  // New renderer snapshots include resolved state styles; older snapshots have
  // only base/views. Validate the added typed data without weakening either form.
  if (own(appearance, 'stateStyles')) {
    h.keys(appearance.stateStyles, source.nodes.map(node => node.id), '剪贴板外观状态元件', false);
    for (const [id, states] of Object.entries(appearance.stateStyles)) {
      h.keys(states, STYLE_STATES, '剪贴板外观状态', false);
      const node = source.nodes.find(node => node.id === id);
      for (const patch of Object.values(states)) {
        h.keys(patch, STYLE_KEYS, '剪贴板外观状态样式', false);
        h.validateStyle({ ...node.style, ...patch });
      }
    }
  }
}
function restoreFragmentAppearance(source, appearance, detachedIds) {
  for (const node of source.nodes) if (detachedIds.has(node.id) && own(appearance.base, node.id)) {
    const patch = appearance.base[node.id]; Object.assign(node, copy(patch), { style: { ...node.style, ...patch.style } });
  }
  for (const [viewId, patches] of Object.entries(appearance.views)) {
    const overrides = source.viewState ? entry(source.viewState.overrides, viewId) : source.views.find(view => view.id === viewId)?.overrides;
    if (!overrides) continue;
    for (const [nodeId, patch] of Object.entries(patches)) if (detachedIds.has(nodeId)) put(overrides, nodeId, { ...(own(overrides, nodeId) ? overrides[nodeId] : {}), ...copy(patch) });
  }
}
function copyCanvasViewPatches(project, source, destination, selected, mapping, dropped, dx, dy, h) {
  const state = canvasViewState(project, source); if (!state) return false;
  const component = project.components.some(item => item === destination), targetState = canvasViewState(project, destination);
  const definitions = targetState?.definitions || destination.views || [];
  const path = (views, viewId) => JSON.stringify(componentViewPath({ views }, viewId, 50).map(view => view.name));
  const targets = new Map(definitions.map(view => [path(definitions, view.id), view]));
  function targetFor(viewId) {
    const chain = componentViewPath({ views: state.definitions }, viewId, 50); let parentId = null;
    for (const view of chain) {
      const key = path(state.definitions, view.id); let target = targets.get(key);
      if (!target) {
        if (!component) h.fail('目标页面没有同名且同继承结构的视图；请先配置匹配视图，再粘贴此选区', 'VIEW_MAPPING_REQUIRED');
        target = { id: h.uuid(), name: view.name, parentId }; definitions.push(target); targets.set(key, target);
      }
      parentId = target.id;
    }
    return definitions.find(view => view.id === parentId);
  }
  for (const view of state.definitions) {
    const entries = Object.entries(state.overrides[view.id] || {}).filter(([id]) => selected.has(id) && !dropped.has(mapping.get(id)));
    if (!entries.length) continue;
    const target = targetFor(view.id), overrides = component || destination.viewSetId != null ? entry(destination.viewOverrides, target.id) : target.overrides;
    for (const [id, original] of entries) {
      if (component && ['visible', 'disabled', 'text', 'value'].some(key => own(original, key))) h.fail('来源自适应视图含组件不能分视图覆盖的文字或交互状态；请在基础视图复制普通元件', 'VIEW_MAPPING_REQUIRED');
      const patch = copy(original); if (own(patch, 'x')) patch.x += dx; if (own(patch, 'y')) patch.y += dy; put(overrides, mapping.get(id), patch);
    }
  }
  for (const sourceGroup of source.groups.filter(group => group.componentId && group.nodeIds.every(id => selected.has(id)))) {
    const targetGroup = destination.groups.find(group => group.id === mapping.get(sourceGroup.id)); if (!targetGroup) continue;
    targetGroup.viewOverrides = {};
    for (const [viewId, position] of Object.entries(sourceGroup.viewOverrides || {})) {
      const target = targetFor(viewId), patch = copy(position); if (own(patch, 'x')) patch.x += dx; if (own(patch, 'y')) patch.y += dy; put(targetGroup.viewOverrides, target.id, patch);
    }
  }
  return true;
}

function duplicateDesignNodes(project, source, destination, command, h, snapshot = false) {
  const { nodeFor, fail, uuid } = h;
  h.array(command.nodeIds, '复制元件', 5000); for (const id of command.nodeIds) nodeFor(source, id);
  const dx = command.dx ?? 24, dy = command.dy ?? 24; h.number(dx, '复制偏移 X', -100000, 100000); h.number(dy, '复制偏移 Y', -100000, 100000);
  const selected = new Set(command.nodeIds); let changed = true;
  // A nested group's selected members expand their innermost group only. Walking
  // every intersecting ancestor would silently include unselected siblings.
  while (changed) { const before = selected.size; for (const id of [...selected]) for (const child of getNodeDescendants(source.nodes, id)) selected.add(child); for (const id of [...selected]) { const memberships=groupsForNode(source,id),group=memberships.find(item=>item.componentId)||memberships[0]; if(group)for(const member of group.nodeIds)selected.add(member); } changed = before !== selected.size; }
  const originals = source.nodes.filter(node => selected.has(node.id)), groups = source.groups.filter(group => group.nodeIds.every(id => selected.has(id)));
  const ownedIds = [...selected, ...getNodeInternalIds(originals), ...groups.map(group => group.id)]; const requested = command.idMap || {};
  const permittedIds = snapshot ? [...source.nodes.map(node => node.id), ...getNodeInternalIds(source.nodes), ...source.groups.map(group => group.id)] : ownedIds;
  h.keys(requested, permittedIds, '复制 ID 映射', false); for (const value of Object.values(requested)) h.id(value, '复制后的 ID');
  const mapping = new Map(ownedIds.map(id => [id, own(requested, id) ? requested[id] : uuid()])); for (const value of mapping.values()) h.id(value, '复制后的 ID');
  let copies = originals.map(original => { const node = remapVectorReferences(remapNodeReferences(original, mapping), mapping); node.id = mapping.get(original.id); node.x += dx; node.y += dy; return node; });
  const reachable = new Set([...destination.nodes.map(node => node.id), ...copies.map(node => node.id)]);
  const inaccessible = new Set(source.nodes.filter(node => !mapping.has(node.id) && !reachable.has(node.id)).map(node => node.id));
  const droppedConnectors = new Set(copies.filter(node => node.connector && (!reachable.has(node.connector.from.nodeId) || !reachable.has(node.connector.to.nodeId))).map(node => node.id));
  copies = copies.filter(node => !droppedConnectors.has(node.id));
  const copiedPage = { ...destination, nodes: copies, views: [], interactions: [] };
  cleanInteractionReferences({ pages: [copiedPage], components: [] }, { nodeIds: new Set([...inaccessible, ...droppedConnectors]) });
  if (snapshot) {
    const pageIds = new Set(project.pages.map(page => page.id)), variableNames = new Set(project.variables.map(variable => variable.name));
    const removedPages = new Set(), removedVariables = new Set();
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (value.op === 'var' && !variableNames.has(value.name)) removedVariables.add(value.name);
      if (value.type === 'setVariable' && !variableNames.has(value.name)) removedVariables.add(value.name);
      if (value.type === 'navigate' && !pageIds.has(value.pageId)) removedPages.add(value.pageId);
      for (const nested of Object.values(value)) visit(nested);
    };
    for (const node of copies) visit(node);
    cleanInteractionReferences({ pages: [copiedPage], components: [] }, { pageIds: removedPages, variableNames: removedVariables });
    for (const node of copies) node.locked = false;
  }
  copies = copiedPage.nodes;
  // A snapshot is a different object from its live canvas. Restore only the
  // captured ownership whose canvas, source node, owner and state still exist.
  // Never read the live node's content back into the captured copy.
  const sameCanvas = source === destination || snapshot && source.id === destination.id;
  if (sameCanvas) for (const capturedOwner of source.nodes.filter(node => !selected.has(node.id))) {
    const owner = destination.nodes.find(node => node.id === capturedOwner.id);
    if (!owner) continue;
    const copiedMembers = ids => ids.filter(id => selected.has(id) && destination.nodes.some(node => node.id === id))
      .map(id => mapping.get(id)).filter(id => !droppedConnectors.has(id));
    if (capturedOwner.panel && owner.panel) for (const capturedState of capturedOwner.panel.states) {
      const state = owner.panel.states.find(state => state.id === capturedState.id);
      if (state) state.nodeIds.push(...copiedMembers(capturedState.nodeIds));
    }
    if (capturedOwner.repeater && owner.repeater) owner.repeater.templateIds.push(...copiedMembers(capturedOwner.repeater.templateIds));
  }
  const combinedNodes = [...destination.nodes, ...copies];
  const templateIds = new Set(combinedNodes.filter(node => node.repeater).flatMap(node => getNodeDescendants(combinedNodes, node.id)));
  const hasItem = value => plain(value) && (value.op === 'item' || value.op === 'row' || value.args?.some(hasItem));
  if (snapshot || source !== destination) for (const node of copies) {
    if (!templateIds.has(node.id)) {
      for (const key of Object.keys(node.bindings)) if (hasItem(node.bindings[key])) delete node.bindings[key];
      for (const item of node.interactions) {
        if (hasItem(item.condition)) item.condition = false;
        item.actions = item.actions.filter(action => !['value', 'x', 'y', 'width', 'height'].some(key => hasItem(action[key])) && !(action.type === 'addRows' && action.rows.some(row => Object.values(row.values).some(hasItem))));
      }
    }
  }
  destination.nodes.push(...copies);
  for (const original of groups) {
    const group = copy(original); group.id = mapping.get(original.id); group.nodeIds = group.nodeIds.map(id => mapping.get(id)).filter(id => !droppedConnectors.has(id));
    group.parentGroupId=mapping.get(original.parentGroupId)||null;
    if (snapshot) group.locked = false;
    if (group.componentId !== null) { group.x += dx; group.y += dy; group.internalIds = Object.fromEntries(Object.entries(group.internalIds).map(([key, value]) => [key, mapping.get(value) || value])); }
    destination.groups.push(group);
  }
  // A dangling connector may have been omitted; prune its now-small parent only
  // after all copied groups exist so surviving children are lifted correctly.
  pruneGroups(destination);
  if (copyCanvasViewPatches(project, source, destination, selected, mapping, droppedConnectors, dx, dy, h)) return;
  const legacyViewMap = new Map();
  for (const sourceView of source.views || []) {
    if (!sourceView.overrides || project.components.some(item => item === destination) || !Array.isArray(destination.views)) continue;
    const entries = Object.entries(sourceView.overrides).filter(([id]) => selected.has(id) && !droppedConnectors.has(mapping.get(id))); if (!entries.length && !groups.some(group => own(group.viewOverrides || {}, sourceView.id))) continue;
    let targetView = source === destination ? sourceView : destination.views.find(view => view.minWidth === sourceView.minWidth);
    if (!targetView) { targetView = { ...copy(sourceView), id: uuid(), overrides: {} }; destination.views.push(targetView); }
    legacyViewMap.set(sourceView.id, targetView.id);
    for (const [id, originalPatch] of entries) { const patch = copy(originalPatch); if (own(patch, 'x')) patch.x += dx; if (own(patch, 'y')) patch.y += dy; targetView.overrides[mapping.get(id)] = patch; }
  }
  for (const original of groups.filter(group => group.componentId)) {
    const group = destination.groups.find(group => group.id === mapping.get(original.id)); if (!group) continue;
    group.viewOverrides = Object.fromEntries(Object.entries(original.viewOverrides || {}).filter(([id]) => legacyViewMap.has(id)).map(([id, value]) => [legacyViewMap.get(id), { ...copy(value), ...(own(value, 'x') ? { x: value.x + dx } : {}), ...(own(value, 'y') ? { y: value.y + dy } : {}) }]));
  }
}

export function applyDesignCommand(project, command, h) {
  if(applyStyleInheritanceCommand(project,command,h))return true;
  if(applyComponentViewCommand(project,command,h))return true;
  if(applyHierarchyCommand(project,command,h))return true;
  const { pageFor, nodeFor, fail, keys, makeNode, uuid } = h;
  const ck = (required, optional = []) => commandKeys(command, required, optional, h);
  const editableNodes = (page, nodeIds) => { h.array(nodeIds, '元件 ID', 5000); return nodeIds.map(id => { const node = nodeFor(page, id); assertNodeEditable(page, node, null, h); return node; }); };
  switch (command.type) {
    case 'reorderPage': {
      ck(['pageId', 'index']); const page = pageFor(project, command.pageId);
      if (!Number.isInteger(command.index) || command.index < 0 || command.index >= project.pages.length) fail('页面排序位置超出范围', 'COMMAND_ERROR');
      project.pages.splice(project.pages.indexOf(page), 1); project.pages.splice(command.index, 0, page); syncLegacyPageOrder(project); return true;
    }
    case 'reparentPage': ck(['pageId', 'parentId']); pageFor(project, command.pageId).parentId = command.parentId; return true;
    case 'setPageGuides': ck(['pageId', 'guides']); pageFor(project, command.pageId).guides = copy(command.guides); return true;
    case 'setProjectGuides': ck(['guides']); project.globalGuides = copy(command.guides); return true;
    case 'groupNodes': {
      ck(['pageId', 'nodeIds'], ['groupId', 'name']); const page = pageFor(project, command.pageId); const selected = editableNodes(page, command.nodeIds);
      if (selected.length < 2 || new Set(command.nodeIds).size !== selected.length) fail('请选择至少两个不同的元件', 'COMMAND_ERROR');
      if (selected.some(node => groupForNode(page, node.id))) fail('请先取消原有分组，再重新组合', 'COMMAND_ERROR');
      page.groups.push({ id: command.groupId || uuid(), name: command.name || '元件组', nodeIds: [...command.nodeIds], locked: false, componentId: null, x: 0, y: 0, sourceIds: [], internalIds: {}, overrides: {} }); return true;
    }
    case 'ungroup': {
      ck(['pageId', 'groupId']); const page = pageFor(project, command.pageId), group = groupFor(page, command.groupId, h);
      if (group.locked) fail('请先解锁元件组', 'LOCKED'); if (group.componentId !== null) fail('组件实例请先解除关联', 'COMPONENT_LINKED');
      if(isGroupAncestorLocked(page,group))fail('祖先组或容器已锁定','LOCKED');for(const child of page.groups)if(child.parentGroupId===group.id)child.parentGroupId=group.parentGroupId;
      page.groups = page.groups.filter(item => item !== group); return true;
    }
    case 'moveGroup': {
      ck(['pageId', 'groupId', 'dx', 'dy']); const page = pageFor(project, command.pageId), group = groupFor(page, command.groupId, h);
      h.number(command.dx, '移动 X', -100000, 100000); h.number(command.dy, '移动 Y', -100000, 100000);
      if (group.locked || group.nodeIds.some(id => nodeFor(page, id).locked)) fail('请先解锁元件组及组内元件', 'LOCKED');
      translateNodes(page, group.nodeIds, command.dx, command.dy, h);
      return true;
    }
    case 'lockGroup': {ck(['pageId', 'groupId', 'locked']);const page=pageFor(project,command.pageId),group=groupFor(page,command.groupId,h);if(isGroupAncestorLocked(page,group))fail('祖先组或容器已锁定','LOCKED');group.locked=command.locked;return true;}
    case 'duplicateNodes': {
      ck(['pageId', 'nodeIds'], ['targetPageId', 'dx', 'dy', 'idMap']); const source = pageFor(project, command.pageId), destination = pageFor(project, command.targetPageId || command.pageId);
      duplicateDesignNodes(project, source, destination, command, h); return true;
    }
    case 'pasteFragment': {
      ck(['pageId', 'fragment'], ['dx', 'dy', 'idMap']);
      const fragment = command.fragment; keys(fragment, ['projectId', 'sourceId', 'nodes', 'groups', 'views', 'nodeIds', 'viewState', 'appearance'], '剪贴板快照', false);
      for (const field of ['projectId', 'sourceId', 'nodes', 'groups', 'views', 'nodeIds']) if (!own(fragment, field)) fail(`剪贴板快照缺少 ${field}`);
      const active = new Set(); let fields = 0;
      const boundedTree = (value, depth = 0) => {
        if (depth > 64 || ++fields > 1000000) fail('剪贴板快照过大或嵌套过深');
        if (!value || typeof value !== 'object') return;
        if (active.has(value)) fail('剪贴板快照不能含循环引用');
        active.add(value); for (const nested of Object.values(value)) boundedTree(nested, depth + 1); active.delete(value);
      };
      boundedTree(fragment);
      if (fragment.projectId !== project.id) fail('剪贴板来自另一个项目，请重新复制', 'COMMAND_ERROR');
      h.id(fragment.sourceId, '复制来源画布'); h.array(fragment.nodes, '剪贴板元件', 5000); h.array(fragment.groups, '剪贴板分组', 2500); h.array(fragment.views, '剪贴板视图', 50);
      const source = { id: fragment.sourceId, nodes: fragment.nodes.map(node => { if (!plain(node)) fail('剪贴板元件必须为对象'); return makeNode(node.type, node); }), groups: copy(fragment.groups), views: copy(fragment.views) };
      if (own(fragment, 'viewState')) { validateFragmentViewState(fragment.viewState, source, h); source.viewState = copy(fragment.viewState); }
      if (own(fragment, 'appearance')) validateFragmentAppearance(fragment.appearance, source, h);
      const ids = new Set(); const register = id => { h.id(id, '剪贴板对象 ID'); if (ids.has(id)) fail('剪贴板对象 ID 重复'); ids.add(id); };
      for (const node of source.nodes) register(node.id); for (const id of getNodeInternalIds(source.nodes)) register(id);
      const detachedIds = new Set();
      for (const group of source.groups) {
        defaults(group, groupDefaults()); keys(group, GROUP_KEYS, '剪贴板元件组'); register(group.id); h.array(group.nodeIds, '剪贴板组元件', 5000);
        h.array(group.sourceIds, '剪贴板组件映射', 5000); h.object(group.internalIds, '剪贴板内部映射'); h.object(group.overrides, '剪贴板组件覆盖');
        keys(group.viewOverrides, (source.viewState?.definitions || source.views).map(view => view.id), '剪贴板实例视图覆盖', false);
        for (const patch of Object.values(group.viewOverrides)) { keys(patch, ['x', 'y', 'placed'], '剪贴板实例视图属性', false); for (const axis of ['x', 'y']) if (own(patch, axis)) h.number(patch[axis], '剪贴板实例坐标', -100000, 100000); if (own(patch, 'placed')) h.bool(patch.placed, '剪贴板实例放置'); }
        for (const id of group.nodeIds) if (!source.nodes.some(node => node.id === id)) fail('剪贴板组包含不存在的元件');
        const definition = project.components.find(component => component.id === group.componentId);
        if (group.componentId !== null && (!definition || group.viewMode === 'fixed' && group.viewId !== null && !definition.views.some(view => view.id === group.viewId))) {
          group.nodeIds.forEach(id => detachedIds.add(id));
          group.componentId = null; group.sourceIds = []; group.internalIds = {}; group.overrides = {}; group.x = 0; group.y = 0; group.viewMode = 'fixed'; group.viewId = null; group.viewOverrides = {};
          if (own(fragment, 'appearance')) group.placed = true;
        }
      }
      if (detachedIds.size && own(fragment, 'appearance')) restoreFragmentAppearance(source, fragment.appearance, detachedIds);
      for (const view of source.views) {
        if (source.viewState?.kind === 'component' && !own(view, 'overrides')) keys(view, ['id', 'name', 'parentId'], '剪贴板组件视图');
        else { keys(view, ['id', 'name', 'minWidth', 'width', 'height', 'overrides'], '剪贴板视图'); h.object(view.overrides, '剪贴板视图覆盖'); }
      }
      let frozenDefaultsId = null;
      const linkedIds = new Set(source.groups.filter(group => group.componentId !== null).flatMap(group => group.nodeIds));
      for (const node of source.nodes) {
        // Live instances still follow their definition. Detached/plain snapshots
        // keep the captured states when their style sources change after copying.
        const capturedStates = !linkedIds.has(node.id) && own(fragment.appearance?.stateStyles || {}, node.id) ? fragment.appearance.stateStyles[node.id] : null;
        let current=null,currentStates=null;try{current=resolveNodeBaseStyle(project,node);currentStates=resolveNodeStateStyles(project,node);}catch{}
        if (!current || !styleValueEqual(current,node.style) || capturedStates && !styleValueEqual(currentStates,capturedStates)) {
          node.styleId=null; node.defaultStyleSetId=null; node.styleOverrideKeys=[...STYLE_KEYS];
          if (capturedStates) {
            node.stateStyles=copy(capturedStates);
            // null follows the project's current defaults. An empty set prevents
            // those defaults from injecting newly changed states into a snapshot;
            // keep sparse states so pressed does not accidentally erase hover.
            if (project.defaultStyleSetId !== null) node.defaultStyleSetId = frozenDefaultsId ??= uuid();
          }
        }
      }
      const destination = pageFor(project, command.pageId);
      duplicateDesignNodes(project, source, destination, { ...command, nodeIds: fragment.nodeIds }, h, true);
      if (frozenDefaultsId && destination.nodes.some(node => node.defaultStyleSetId === frozenDefaultsId)) project.defaultStyleSets.push({id:frozenDefaultsId,name:'粘贴时外观',byType:{}});
      return true;
    }
    case 'createComponent': {
      ck(['pageId', 'nodeIds', 'name'], ['componentId']); const page = pageFor(project, command.pageId); h.array(command.nodeIds, '元件 ID', 5000);
      const selectedIds = new Set(command.nodeIds); for (const id of command.nodeIds) for (const child of getNodeDescendants(page.nodes, id)) selectedIds.add(child); const selected = page.nodes.filter(node => selectedIds.has(node.id));
      if (!selected.length || selected.length !== selectedIds.size) fail('请选择存在的元件来创建组件', 'COMMAND_ERROR');
      const minX = Math.min(...selected.map(node => node.x)), minY = Math.min(...selected.map(node => node.y));
      const selectedGroups = page.groups.filter(group => group.nodeIds.every(id => selectedIds.has(id)));
      const mapping = new Map([...selected.map(node => node.id), ...getNodeInternalIds(selected), ...selectedGroups.map(group => group.id)].map(id => [id, uuid()]));
      const nodes = selected.map(original => {
        for (const interaction of original.interactions) for (const action of interaction.actions) {
          if (!own(action, 'targetId')) continue;
          if (!mapping.has(action.targetId)) fail('组件中的交互须只引用选中元件；请一并选中目标元件', 'COMMAND_ERROR');
        }
        const node = remapVectorReferences(remapNodeReferences(original, mapping), mapping); node.id = mapping.get(original.id); node.x -= minX; node.y -= minY; return node;
      });
      const groups = selectedGroups.map(original => {
        const group = copy(original); group.id = mapping.get(original.id); group.nodeIds = group.nodeIds.map(id => mapping.get(id));
        group.parentGroupId=mapping.get(original.parentGroupId)||null;
        if (group.componentId !== null) { group.x -= minX; group.y -= minY; group.internalIds = Object.fromEntries(Object.entries(group.internalIds).map(([key, value]) => [key, mapping.get(value)])); }
        return group;
      });
      const created = { ...componentDefaults(), id: command.componentId || uuid(), name: command.name, width: Math.max(...nodes.map(node => node.x + node.width)), height: Math.max(...nodes.map(node => node.y + node.height)), nodes, groups };
      project.components.push(created);
      const viewSource = canvasViewState(project, page) ? page : { ...page, viewState: { kind: 'adaptive', definitions: (page.views || []).map(({ id, name, minWidth, width, height }) => ({ id, name, parentId: null, minWidth, width, height })), overrides: Object.fromEntries((page.views || []).map(view => [view.id, view.overrides])), activeViewId: null } };
      copyCanvasViewPatches(project, viewSource, created, selectedIds, mapping, new Set(), -minX, -minY, h); return true;
    }
    case 'addComponent': {
      ck(['component']); keys(command.component, COMPONENT_KEYS, '组件设置', false);
      const item = { ...componentDefaults(), id: uuid(), name: '新组件', width: 320, height: 200, nodes: [], ...copy(command.component) };
      h.array(item.nodes, '组件元件', 5000); item.nodes = item.nodes.map(node => { if (!plain(node)) fail('组件元件必须是普通对象'); return makeNode(node.type, node); }); project.components.push(item); return true;
    }
    case 'insertComponent': {
      ck(['pageId', 'componentId', 'x', 'y'], ['instanceId']); const page = pageFor(project, command.pageId), component = definition(project, command.componentId, h);
      page.groups.push({ id: command.instanceId || uuid(), name: component.name, nodeIds: [], locked: false, componentId: component.id, x: command.x, y: command.y, sourceIds: [], internalIds: {}, overrides: {} }); return true;
    }
    case 'updateComponent': {
      ck(['componentId', 'patch']); keys(command.patch, COMPONENT_KEYS.filter(key => key !== 'id' && key !== 'groups'), '组件修改', false); const component = definition(project, command.componentId, h);
      const patch = copy(command.patch);
      if (own(patch, 'nodes')) {
        h.array(patch.nodes, '组件元件', 5000); patch.nodes = patch.nodes.map(node => { if (!plain(node)) fail('组件元件必须是普通对象'); return makeNode(node.type, node); });
        for (const node of component.nodes) { const next = patch.nodes.find(item => item.id === node.id); if (JSON.stringify(node) !== JSON.stringify(next)) assertNodeEditable(component, node, next, h); }
      }
      Object.assign(component, patch); return true;
    }
    case 'updateComponentNode': {
      ck(['componentId', 'nodeId', 'patch']); keys(command.patch, h.NODE_KEYS.filter(key => key !== 'id'), '组件元件修改', false);
      const component = definition(project, command.componentId, h), node = nodeFor(component, command.nodeId), patch = copy(command.patch);
      assertNodeEditable(component, node, patch, h);
      prepareImageNodePatch(node,patch);
      if (own(patch, 'text') && !own(patch, 'richText')) patch.richText = null;
      if (own(patch, 'style')) { keys(patch.style, h.STYLE_KEYS, '样式修改', false); patch.style = { ...node.style, ...patch.style }; patch.styleOverrideKeys = [...new Set([...node.styleOverrideKeys,...Object.keys(command.patch.style)])]; }
      component.nodes[component.nodes.indexOf(node)] = { ...node, ...patch }; return true;
    }
    case 'detachComponent': {
      ck(['pageId', 'instanceId']); const page = pageFor(project, command.pageId), group = groupFor(page, command.instanceId, h);
      if (group.locked||isGroupAncestorLocked(page,group)) fail('请先解锁组件实例及祖先', 'LOCKED'); if (group.componentId === null) fail('该元件组不是组件实例', 'COMMAND_ERROR');
      materializeInstanceViews(project, page, [group]);
      group.componentId = null; group.sourceIds = []; group.internalIds = {}; group.overrides = {}; group.x = 0; group.y = 0; group.viewMode = 'fixed'; group.viewId = null; group.placed = true; group.viewOverrides = {};
      if (group.nodeIds.length < 2) page.groups = page.groups.filter(item => item !== group); return true;
    }
    case 'removeComponent': {
      ck(['componentId']); definition(project, command.componentId, h);
      for (const page of [...project.pages, ...project.components]) {
        const affected = page.groups.filter(group => group.componentId === command.componentId); if (affected.length) materializeInstanceViews(project, page, affected);
        for (const group of affected) { group.componentId = null; group.sourceIds = []; group.internalIds = {}; group.overrides = {}; group.x = 0; group.y = 0; group.viewMode = 'fixed'; group.viewId = null; group.placed = true; group.viewOverrides = {}; }
        page.groups = page.groups.filter(group => group.componentId !== null || group.nodeIds.length >= 2);
      }
      project.components = project.components.filter(component => component.id !== command.componentId); return true;
    }
    case 'setComponentOverride': case 'clearComponentOverride': {
      ck(['pageId', 'instanceId', 'sourceId'], command.type === 'setComponentOverride' ? ['patch'] : ['fields']);
      const page = pageFor(project, command.pageId), group = groupFor(page, command.instanceId, h);
      if (group.componentId === null) fail('该元件组不是组件实例', 'COMMAND_ERROR');
      if (group.locked||isGroupAncestorLocked(page,group)) fail('请先解锁组件实例及祖先', 'LOCKED');
      const component = definition(project, group.componentId, h), source = nodeFor(component, command.sourceId), instance = page.nodes.find(node => node.id === group.nodeIds[group.sourceIds.indexOf(source.id)]);
      if (source.locked || instance?.locked) fail('请先解锁主定义元件', 'LOCKED');
      if (command.type === 'setComponentOverride') {
        validateComponentOverride(source, command.patch, h);
        group.overrides = { ...group.overrides, [source.id]: { ...(own(group.overrides, source.id) ? group.overrides[source.id] : {}), ...copy(command.patch) } };
      } else {
        const fields = command.fields ?? ['text', 'src']; h.array(fields, '清除覆盖字段', 2);
        if (!fields.length || new Set(fields).size !== fields.length || fields.some(field => !['text', 'src'].includes(field))) fail('只能清除 text 或 src 覆盖');
        if (own(group.overrides, source.id)) { for (const field of fields) delete group.overrides[source.id][field]; if (!Object.keys(group.overrides[source.id]).length) delete group.overrides[source.id]; }
      }
      return true;
    }
    default: return false;
  }
}
