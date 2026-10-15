import { styleValueEqual } from './style-model.mjs';
/** 可序列化的交互、容器、数据与自适应模型；表达式从不使用 eval 或 Function。 */
import { prepareRepeaterImport } from './repeater-import.mjs';
import { remapVectorReferences } from './vector-model.mjs';
import { isHierarchyLocked } from './hierarchy-model.mjs';
import { resolveInstancePosition } from './component-view-model.mjs';
import { resolveViewChain, getCanvasViews, getCanvasViewOverrides, resolveCanvasView } from './view-model.mjs';
export { resolveAdaptivePage } from './view-model.mjs';
export const INTERACTION_EVENTS = ['click', 'dblclick', 'contextmenu', 'mousemove', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup', 'change', 'input', 'focus', 'blur', 'keydown', 'keyup', 'load', 'stateChange', 'dragStart', 'drag', 'dragEnd', 'scroll', 'adaptiveViewChange', 'windowResize', 'windowScroll', 'variableChange'];
export const INTERACTION_NODE_KEYS = ['disabled', 'selected', 'error', 'stateStyles', 'bindings', 'panel', 'repeater', 'placed', 'eventSettings'];
export const INTERACTION_PAGE_KEYS = ['annotation', 'views', 'interactions', 'viewSetId', 'viewOverrides', 'eventSettings'];
export const INTERACTION_PROJECT_KEYS = ['variables', 'viewSets'];
export const INTERACTION_TYPES = ['dynamicPanel', 'repeater'];
export const INTERACTION_KEYS = ['event', 'actions', 'name', 'condition', 'caseMode', 'enabled'];
export const INTERACTION_EVENT_PROPERTIES = ['value', 'checked', 'key', 'x', 'y', 'rowId', 'deltaX', 'deltaY', 'scrollX', 'scrollY', 'cancelled', 'viewId', 'previousViewId', 'reason', 'windowWidth', 'windowHeight', 'scrollDeltaX', 'scrollDeltaY', 'variableName', 'previousValue', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey'];
const clone = value => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);
const put = (value,key,item) => {Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});return item;};
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const defaults = (value, fields) => { if (plain(value)) for (const [key, initial] of Object.entries(fields)) if (!own(value, key)) value[key] = clone(initial); return value; };
const allContainers = project => [...project.pages, ...project.components];
const allNodes = project => allContainers(project).flatMap(container => container.nodes);
const newId = () => globalThis.crypto?.randomUUID?.() ?? `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const panelOptions = () => ({sizeMode:'fixed',scroll:{x:'none',y:'none'},pin:null,drag:{enabled:false,axis:'both',bounds:'none'}});

/** Shared authoring capabilities. Legacy inert events remain readable, but are not offered for new interactions. */
export function getInteractionEvents(target) {
  const page = target === 'page' || (!!target && !target.type && Array.isArray(target.nodes));
  const common = ['click', 'dblclick', 'contextmenu', 'mousemove', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup', 'keydown', 'keyup', 'load'];
  if (page) return [...common, 'adaptiveViewChange', 'windowResize', 'windowScroll', 'variableChange'];
  const result = [...common, 'focus', 'blur'];
  if (['input', 'textarea', 'select', 'checkbox', 'radio'].includes(target?.type)) result.push('change', 'input');
  if (target?.type === 'dynamicPanel') result.push('stateChange', 'dragStart', 'drag', 'dragEnd', 'scroll');
  return result;
}

export function getEventSettings(target, event) {
  const settings = target?.eventSettings && Object.hasOwn(target.eventSettings, event) ? target.eventSettings[event] : null;
  return { enabled: settings?.enabled !== false, executionMode: settings?.executionMode === 'menu' ? 'menu' : 'automatic' };
}

function normalizeEventSettings(target) {
  defaults(target, { eventSettings: {} });
  if (plain(target?.eventSettings)) for (const setting of Object.values(target.eventSettings)) defaults(setting, { enabled: true, executionMode: 'automatic' });
}

export function interactionNodeDefaults(type) {
  const stateId = type === 'dynamicPanel' ? newId() : null;
  return { disabled: false, selected: false, error: false, placed: true, stateStyles: {}, bindings: {}, eventSettings: {}, panel: type === 'dynamicPanel' ? { states: [{ id: stateId, name: '状态 1', nodeIds: [] }], initialStateId: stateId, clip: true, ...panelOptions() } : null,
    repeater: type === 'repeater' ? { columns: [{ key: 'title', label: '标题', type: 'string' }], rows: [{ id: newId(), values: { title: '第一条数据' } }, { id: newId(), values: { title: '第二条数据' } }], templateIds: [], itemWidth: 280, itemHeight: 80, layout: 'vertical', gap: 12, columnsCount: 2, filter: null, sort: null, pagination: { pageSize: null, initialPage: 1 }, markedRowIds: [] } : null };
}
export function normalizeInteractions(interactions) {
  if (!Array.isArray(interactions)) return interactions;
  return interactions.map(item => defaults(clone(item), { name: '', condition: null, caseMode: 'if', enabled: true }));
}
export function normalizeInteractionProject(input) {
  const project = clone(input); defaults(project, { variables: [], viewSets: [] });
  if (Array.isArray(project.viewSets)) for (const set of project.viewSets) if (Array.isArray(set?.views)) for (const view of set.views) defaults(view, {parentId:null});
  if (Array.isArray(project?.pages)) for (const page of project.pages) { defaults(page, { annotation: '', views: [], interactions: [], viewSetId: null, viewOverrides: {} }); if (plain(page)) { page.interactions = normalizeInteractions(page.interactions); normalizeEventSettings(page); } }
  for (const container of [...(Array.isArray(project?.pages) ? project.pages : []), ...(Array.isArray(project?.components) ? project.components : [])]) {
    if (Array.isArray(container?.nodes)) for (const node of container.nodes) {
      defaults(node, interactionNodeDefaults(node?.type));
      normalizeEventSettings(node);
      if (plain(node?.panel)) defaults(node.panel, panelOptions());
      if (plain(node?.repeater)) defaults(node.repeater, { pagination: { pageSize: null, initialPage: 1 }, markedRowIds: [] });
      if (plain(node) && own(node, 'interactions')) node.interactions = normalizeInteractions(node.interactions);
    }
  }
  return project;
}

/** 纯表达式求值。缺失引用返回 null；无穷数字/除零返回 0。 */
export function evaluateExpression(expression, context = {}) {
  const finite = value => { const number = Number(value); return Number.isFinite(number) ? number : 0; };
  function evaluate(value, depth) {
    if (depth > 32) throw new Error('表达式嵌套过深');
    if (value === null || typeof value !== 'object') return value;
    if (value.op === 'var') return Object.hasOwn(context.variables || {}, value.name) ? context.variables[value.name] : null;
    if (value.op === 'item') return Object.hasOwn(context.item || {}, value.column) ? context.item[value.column] : null;
    if (value.op === 'row') return Object.hasOwn(context.row || {}, value.property) ? context.row[value.property] : null;
    if (value.op === 'repeater') { const stats = context.getRepeater?.(value.repeaterId) ?? context.repeaters?.[value.repeaterId]; return stats && Object.hasOwn(stats, value.property) ? stats[value.property] : null; }
    if (value.op === 'event') return Object.hasOwn(context.event || {}, value.name) ? context.event[value.name] : null;
    if (value.op === 'node') {
      const node = context.nodes instanceof Map ? context.nodes.get(value.nodeId) : context.nodes?.[value.nodeId];
      return node && Object.hasOwn(node, value.property) ? node[value.property] : null;
    }
    const args = (value.args || []).map(argument => evaluate(argument, depth + 1));
    switch (value.op) {
      case 'eq': return args[0] === args[1]; case 'neq': return args[0] !== args[1];
      case 'gt': return args[0] > args[1]; case 'gte': return args[0] >= args[1]; case 'lt': return args[0] < args[1]; case 'lte': return args[0] <= args[1];
      case 'and': return args.every(Boolean); case 'or': return args.some(Boolean); case 'not': return !args[0];
      case 'add': return finite(finite(args[0]) + finite(args[1])); case 'sub': return finite(finite(args[0]) - finite(args[1]));
      case 'mul': return finite(finite(args[0]) * finite(args[1])); case 'div': return finite(args[1]) === 0 ? 0 : finite(finite(args[0]) / finite(args[1]));
      case 'concat': return args.map(item => item == null ? '' : String(item)).join('');
      case 'contains': return String(args[0] ?? '').includes(String(args[1] ?? ''));
      case 'length': return Array.isArray(args[0]) || typeof args[0] === 'string' ? args[0].length : 0;
      default: throw new Error(`不支持的表达式：${String(value.op)}`);
    }
  }
  return evaluate(expression, 0);
}

/** 同一 event 的 if 开新分组；每组只选首个成立分支。独立 if 可以都执行。 */
export function chooseInteractionCases(interactions, event, context = {}, settings = {}) {
  if (settings.enabled === false) return [];
  const selected = []; let matched = false;
  for (const item of interactions.filter(item => item.event === event)) {
    const mode = item.caseMode ?? 'if'; if (mode === 'if') matched = false;
    if (item.enabled === false || (mode !== 'if' && matched)) continue;
    if (mode === 'else' || item.condition == null || Boolean(evaluateExpression(item.condition, context))) { selected.push(item); matched = true; }
  }
  return selected;
}
export function selectRepeaterRows(repeater, context = {}) {
  const marked = new Set(repeater.markedRowIds || []);
  let rows = repeater.rows.filter(row => repeater.filter == null || Boolean(evaluateExpression(repeater.filter, { ...context, item: row.values, row: { id: row.id, marked: marked.has(row.id) } })));
  if (repeater.sort) {
    const { column, descending } = repeater.sort;
    rows = [...rows].sort((a, b) => { const first = a.values[column], second = b.values[column]; const result = first === second ? 0 : first < second ? -1 : 1; return descending ? -result : result; });
  }
  return rows;
}
export function selectRepeaterPage(repeater, context = {}, requestedPage = repeater.pagination?.initialPage ?? 1, pageSize = repeater.pagination?.pageSize ?? null) {
  const filtered = selectRepeaterRows(repeater, context), pageCount = pageSize === null ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.max(1, Math.min(pageCount, Math.trunc(Number(requestedPage)) || 1));
  return { rows: pageSize === null ? filtered : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), currentPage, pageCount, pageSize, totalCount: repeater.rows.length, filteredCount: filtered.length, markedCount: (repeater.markedRowIds || []).length };
}
export function getNodeDescendants(nodes, nodeId) {
  const map = new Map(nodes.map(node => [node.id, node])); const found = new Set();
  function visit(id) { const node = map.get(id); if (!node) return; const children = node.panel ? node.panel.states.flatMap(state => state.nodeIds) : node.repeater ? node.repeater.templateIds : []; for (const child of children) if (!found.has(child)) { found.add(child); visit(child); } }
  visit(nodeId); found.delete(nodeId); return [...found];
}
export function getNodeInternalIds(nodes) { return nodes.flatMap(node => [...(node.panel?.states.map(state => state.id) || []), ...(node.repeater?.rows.map(row => row.id) || [])]); }

export function remapNodeReferences(input, mapping) {
  const node = clone(input);
  const remap = id => mapping.get(id) || id;
  function expression(value) {
    if (!plain(value)) return value;
    if (value.op === 'node') return { ...value, nodeId: remap(value.nodeId) };
    if (value.op === 'repeater') return { ...value, repeaterId: remap(value.repeaterId) };
    if (Array.isArray(value.args)) return { ...value, args: value.args.map(expression) };
    return value;
  }
  node.interactions = node.interactions.map(item => ({ ...item, condition: expression(item.condition), actions: item.actions.map(action => {
    const changed = clone(action); for (const key of ['targetId', 'panelId', 'repeaterId', 'stateId']) if (own(changed, key)) changed[key] = remap(changed[key]);
    for (const key of ['value', 'x', 'y', 'width', 'height', 'where', 'marked']) if (own(changed, key)) changed[key] = expression(changed[key]);
    if (changed.type === 'updateRows') changed.values = Object.fromEntries(Object.entries(changed.values).map(([key, value]) => [key, expression(value)]));
    if (changed.type === 'addRows') changed.rows = changed.rows.map(row => ({ ...row, values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => [key, expression(value)])) }));
    return changed;
  }) }));
  node.bindings = Object.fromEntries(Object.entries(node.bindings || {}).map(([key, value]) => [key, expression(value)]));
  if (node.panel) { node.panel.states = node.panel.states.map(state => ({ ...state, id: remap(state.id), nodeIds: state.nodeIds.map(remap) })); node.panel.initialStateId = remap(node.panel.initialStateId); }
  if (node.repeater) { node.repeater.templateIds = node.repeater.templateIds.map(remap); node.repeater.rows = node.repeater.rows.map(row => ({ ...row, id: remap(row.id) })); node.repeater.markedRowIds = (node.repeater.markedRowIds || []).map(remap); node.repeater.filter = expression(node.repeater.filter); }
  return node;
}

function validateExpression(value, context, h, depth = 0, budget = { count: 0 }) {
  if (depth > 32 || ++budget.count > 1000) h.fail('表达式过于复杂');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { h.string(value, '表达式文字', 50000); return; }
  if (typeof value === 'number') { h.number(value, '表达式数字', -Number.MAX_VALUE, Number.MAX_VALUE); return; }
  h.object(value, '表达式');
  if (value.op === 'var') { h.keys(value, ['op', 'name'], '变量表达式'); if (!context.variables.has(value.name)) h.fail(`变量不存在：${value.name}`); return; }
  if (value.op === 'node') { h.keys(value, ['op', 'nodeId', 'property'], '元件表达式'); if (!context.nodes.has(value.nodeId)) h.fail(`表达式元件不存在：${value.nodeId}`); if (!['text', 'value', 'checked', 'visible', 'disabled', 'selected', 'error', 'x', 'y', 'width', 'height'].includes(value.property)) h.fail('不支持的元件表达式属性'); return; }
  if (value.op === 'event') { h.keys(value, ['op', 'name'], '事件表达式'); if (!INTERACTION_EVENT_PROPERTIES.includes(value.name)) h.fail('不支持的事件表达式属性'); return; }
  if (value.op === 'row') { h.keys(value, ['op', 'property'], '行信息表达式'); if (!['id', 'marked'].includes(value.property) || !context.columns) h.fail('行信息只能用于数据行模板或行条件'); return; }
  if (value.op === 'repeater') { h.keys(value, ['op', 'repeaterId', 'property'], '列表统计表达式'); if (context.filtering) h.fail('筛选条件不能读取列表统计'); if (!context.nodes.get(value.repeaterId)?.repeater) h.fail('统计目标不是数据列表'); if (!['currentPage', 'pageCount', 'pageSize', 'totalCount', 'filteredCount', 'markedCount'].includes(value.property)) h.fail('不支持的列表统计属性'); return; }
  if (value.op === 'item') { h.keys(value, ['op', 'column'], '数据行表达式'); h.string(value.column, '数据列键', 100, 1); if (context.columns && !context.columns.has(value.column)) h.fail(`数据列不存在：${value.column}`); return; }
  h.keys(value, ['op', 'args'], '运算表达式'); h.array(value.args, '运算参数', 100);
  const unary = ['not', 'length'], binary = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'add', 'sub', 'mul', 'div', 'contains'], multiple = ['and', 'or', 'concat'];
  if (unary.includes(value.op) ? value.args.length !== 1 : binary.includes(value.op) ? value.args.length !== 2 : multiple.includes(value.op) ? value.args.length < 1 : true) h.fail('表达式操作或参数数量无效');
  for (const argument of value.args) validateExpression(argument, context, h, depth + 1, budget);
}
function validateColumns(columns, h) {
  h.array(columns, '数据列', 100); if (!columns.length) h.fail('中继器至少需要一列'); const found = new Set();
  for (const column of columns) { h.keys(column, ['key', 'label', 'type'], '数据列'); h.id(column.key, '数据列键'); h.string(column.label, '列显示名称', 200, 1); if (!['string', 'number', 'boolean'].includes(column.type)) h.fail('数据列类型无效'); if (found.has(column.key)) h.fail('数据列键不能重复'); found.add(column.key); }
}
function typedValue(value, type, h) { if (type === 'string') h.string(value, '数据文字', 50000); else if (type === 'number') h.number(value, '数据数字', -Number.MAX_VALUE, Number.MAX_VALUE); else h.bool(value, '数据布尔值'); }
function validateRowValues(values, columns, h, partial = false, expressionContext = null) {
  h.keys(values, columns.map(column => column.key), '数据行内容', !partial);
  for (const [key, value] of Object.entries(values)) {
    if (expressionContext) validateExpression(value, expressionContext, h);
    if (!expressionContext || !plain(value)) typedValue(value, columns.find(column => column.key === key).type, h);
  }
}
function validateSort(sort, columns, h) { if (sort === null) return; h.keys(sort, ['column', 'descending'], '排序规则'); if (!columns.some(column => column.key === sort.column)) h.fail('排序列不存在'); h.bool(sort.descending, '降序'); }
export const VIEW_OVERRIDE_KEYS = ['x', 'y', 'width', 'height', 'rotation', 'style', 'placed'];
const adaptiveKeys = [...VIEW_OVERRIDE_KEYS, 'visible', 'disabled', 'text', 'value'];
export function validateViewOverrideMap(overrides, nodes, h, {legacy=false} = {}) {
  h.object(overrides, '视图覆盖'); const nodeMap = new Map(nodes.map(node => [node.id,node]));
  for (const [nodeId, patch] of Object.entries(overrides)) {
    if (!nodeMap.has(nodeId)) h.fail('视图覆盖目标不存在'); h.keys(patch, legacy ? adaptiveKeys : VIEW_OVERRIDE_KEYS, '视图属性覆盖', false); const base=nodeMap.get(nodeId);
    if (own(patch,'style')) {h.keys(patch.style,h.STYLE_KEYS,'视图样式',false);h.validateStyle({...base.style,...patch.style});}
    for(const key of ['x','y'])if(own(patch,key))h.number(patch[key],'视图坐标',-100000,100000);
    for(const key of ['width','height'])if(own(patch,key))h.number(patch[key],'视图尺寸',1,100000);
    if(own(patch,'rotation'))h.number(patch.rotation,'视图旋转',-36000,36000);
    for(const key of ['placed','visible','disabled'])if(own(patch,key))h.bool(patch[key],'视图状态');
    for(const key of ['text','value'])if(own(patch,key))h.string(patch[key],'视图文字',50000);
  }
}

export function validateInteractionProject(project, h) {
  h.array(project.viewSets,'项目视图集',100);
  for(const set of project.viewSets){h.keys(set,['id','name','views'],'视图集');h.unique(set.id,'视图集 ID');h.string(set.name,'视图集名称',200,1);h.array(set.views,'视图集定义',50);const widths=new Set(),names=new Set();
    for(const view of set.views){h.keys(view,['id','name','parentId','minWidth','width','height'],'共享视图');h.unique(view.id,'共享视图 ID');h.string(view.name,'视图名称',200,1);if(view.parentId!==null)h.id(view.parentId,'父视图 ID');h.number(view.minWidth,'视图断点',0,20000);h.number(view.width,'视图宽度',100,20000);h.number(view.height,'视图高度',100,20000);if(widths.has(view.minWidth))h.fail('同一视图集的断点不能重复');widths.add(view.minWidth);const nameKey=JSON.stringify([view.parentId,view.name]);if(names.has(nameKey))h.fail('同级视图名称不能重复');names.add(nameKey);}
    for(const view of set.views)try{resolveViewChain(set.views,view.id);}catch(error){h.fail(error.message);}
  }
  h.array(project.variables, '全局变量', 1000); const variables = new Set();
  for (const variable of project.variables) { h.keys(variable, ['name', 'type', 'value'], '变量'); h.string(variable.name, '变量名称', 100, 1); if (['__proto__', 'prototype', 'constructor'].includes(variable.name)) h.fail('变量名称为保留名称'); if (variables.has(variable.name)) h.fail('变量名称不能重复'); variables.add(variable.name); if (!['string', 'number', 'boolean'].includes(variable.type)) h.fail('变量类型无效'); typedValue(variable.value, variable.type, h); }
  const pageIds = new Set(project.pages.map(page => page.id));
  for (const page of project.pages) {
    if(page.viewSetId!==null){h.id(page.viewSetId,'视图集引用');if(!project.viewSets.some(set=>set.id===page.viewSetId))h.fail('引用的视图集不存在');if(page.views.length)h.fail('共享视图集与页面独立视图不能同时使用');}
    h.object(page.viewOverrides,'页面视图覆盖');const viewIds=new Set(getCanvasViews(project,page).map(view=>view.id));
    for(const [viewId,overrides]of Object.entries(page.viewOverrides)){if(page.viewSetId===null||!viewIds.has(viewId))h.fail('页面视图覆盖引用无效');validateViewOverrideMap(overrides,page.nodes,h,{legacy:true});}
    h.string(page.annotation, '页面注释', 50000); h.array(page.views, '自适应视图', 50); const breakpoints = new Set(); const nodeMap = new Map(page.nodes.map(node => [node.id, node]));
    for (const view of page.views) {
      h.keys(view, ['id', 'name', 'minWidth', 'width', 'height', 'overrides'], '自适应视图'); h.unique(view.id, '视图 ID'); h.string(view.name, '视图名称', 200, 1);
      h.number(view.minWidth, '视图断点', 0, 20000); h.number(view.width, '视图宽度', 100, 20000); h.number(view.height, '视图高度', 100, 20000);
      if (breakpoints.has(view.minWidth)) h.fail('同页自适应视图的断点不能重复'); breakpoints.add(view.minWidth); h.object(view.overrides, '自适应覆盖');
      validateViewOverrideMap(view.overrides,page.nodes,h,{legacy:true});
    }
  }
  for (const container of allContainers(project)) {
    const nodes = new Map(container.nodes.map(node => [node.id, node])); const owners = new Map(); const contexts = new Map();
    for (const node of container.nodes) {
      validateEventSettings(node, h);
      h.bool(node.placed,'放置状态');h.bool(node.disabled, '禁用状态'); h.bool(node.selected, '选中状态'); h.bool(node.error, '错误状态'); h.keys(node.bindings, ['text', 'value', 'checked', 'visible'], '数据绑定', false);
      h.keys(node.stateStyles, ['hover', 'pressed', 'selected', 'disabled', 'error', 'focus', 'hint'], '交互状态样式', false);
      for (const style of Object.values(node.stateStyles)) { h.keys(style, h.STYLE_KEYS, '状态样式', false); h.validateStyle({ ...node.style, ...style }); }
      if (node.type !== 'dynamicPanel' && node.panel !== null) h.fail('只有动态面板可拥有面板状态');
      if (node.type !== 'repeater' && node.repeater !== null) h.fail('只有中继器可拥有数据模板');
      const ownChild = child => { if (!nodes.has(child)) h.fail(`容器子元件不存在：${child}`); if (owners.has(child)) h.fail('元件不能同时属于多个容器或状态'); owners.set(child, node.id); };
      if (node.type === 'dynamicPanel') {
        h.keys(node.panel, ['states', 'initialStateId', 'clip','sizeMode','scroll','pin','drag'], '动态面板'); h.bool(node.panel.clip, '面板裁剪'); h.array(node.panel.states, '面板状态', 100); if (!node.panel.states.length) h.fail('动态面板至少一个状态');
        const panel=node.panel;
        if(!['fixed','content'].includes(panel.sizeMode))h.fail('面板尺寸模式无效');
        h.keys(panel.scroll,['x','y'],'面板滚动');for(const axis of ['x','y'])if(!['none','auto','always'].includes(panel.scroll[axis]))h.fail('面板滚动模式无效');
        if(panel.pin!==null){h.keys(panel.pin,['horizontal','vertical','offsetX','offsetY'],'窗口固定');if(!['left','center','right'].includes(panel.pin.horizontal)||!['top','center','bottom'].includes(panel.pin.vertical))h.fail('窗口固定对齐无效');for(const axis of ['offsetX','offsetY'])h.number(panel.pin[axis],'固定偏移',-100000,100000);}
        h.keys(panel.drag,['enabled','axis','bounds'],'面板拖动');h.bool(panel.drag.enabled,'允许拖动');if(!['both','x','y'].includes(panel.drag.axis)||!['none','parent','viewport'].includes(panel.drag.bounds))h.fail('面板拖动设置无效');
        for (const state of node.panel.states) { h.keys(state, ['id', 'name', 'nodeIds'], '面板状态'); h.unique(state.id, '面板状态 ID'); h.string(state.name, '状态名称', 200, 1); h.array(state.nodeIds, '状态元件', 5000); for (const child of state.nodeIds) ownChild(child); }
        if (!node.panel.states.some(state => state.id === node.panel.initialStateId)) h.fail('面板初始状态不存在');
      }
      if (node.type === 'repeater') {
        const repeater = node.repeater;
        h.keys(repeater, ['columns', 'rows', 'templateIds', 'itemWidth', 'itemHeight', 'layout', 'gap', 'columnsCount', 'filter', 'sort', 'pagination', 'markedRowIds'], '中继器'); validateColumns(repeater.columns, h);
        h.array(repeater.rows, '中继器数据行', 10000); for (const row of repeater.rows) { h.keys(row, ['id', 'values'], '中继器数据行'); h.unique(row.id, '数据行 ID'); validateRowValues(row.values, repeater.columns, h); }
        h.keys(repeater.pagination, ['pageSize', 'initialPage'], '分页设置');
        for (const key of ['pageSize', 'initialPage']) if (key !== 'pageSize' || repeater.pagination[key] !== null) { h.number(repeater.pagination[key], '分页数量', 1, 10000); if (!Number.isInteger(repeater.pagination[key])) h.fail('分页数量必须是整数'); }
        h.array(repeater.markedRowIds, '标记行 ID', 10000); const marked = new Set();
        for (const id of repeater.markedRowIds) { if (marked.has(id) || !repeater.rows.some(row => row.id === id)) h.fail('标记行必须唯一且存在于当前数据列表'); marked.add(id); }
        h.array(repeater.templateIds, '中继器模板元件', 5000); for (const child of repeater.templateIds) ownChild(child);
        h.number(repeater.itemWidth, '项目宽度', 1, 20000); h.number(repeater.itemHeight, '项目高度', 1, 20000); h.number(repeater.gap, '项目间距', 0, 1000); h.number(repeater.columnsCount, '网格列数', 1, 100);
        if (!Number.isInteger(repeater.columnsCount) || !['vertical', 'horizontal', 'grid'].includes(repeater.layout)) h.fail('中继器布局无效');
        const context = { nodes, variables, columns: new Set(repeater.columns.map(column => column.key)) };
        validateExpression(repeater.filter, { ...context, filtering: true }, h); validateSort(repeater.sort, repeater.columns, h);
        for (const child of repeater.templateIds) contexts.set(child, context.columns);
      }
    }
    for (const node of container.nodes) {
      const visited = new Set([node.id]); let parent = owners.get(node.id);
      while (parent) { if (visited.has(parent)) h.fail('容器归属不能形成循环'); visited.add(parent); parent = owners.get(parent); }
      let ancestor = node.id, columns;
      while (ancestor) { if (contexts.has(ancestor)) { columns = contexts.get(ancestor); break; } ancestor = owners.get(ancestor); }
      const context = { nodes, variables, columns, panel:!!node.panel, adaptiveViews:project.pages.includes(container)?new Set(getCanvasViews(project,container).map(view=>view.id)):null }; for (const value of Object.values(node.bindings)) validateExpression(value, context, h);
      validateInteractionList(node.interactions, context, pageIds, h);
    }
    if (project.pages.includes(container)) { validateEventSettings(container, h); validateInteractionList(container.interactions, { nodes, variables, page:true, adaptiveViews:new Set(getCanvasViews(project,container).map(view=>view.id)) }, pageIds, h); }
  }
}

function validateEventSettings(target, h) {
  // An absent map is also accepted by direct exporters of older in-memory documents.
  if (!own(target, 'eventSettings')) return;
  h.keys(target.eventSettings, getInteractionEvents(target), '事件设置', false);
  for (const settings of Object.values(target.eventSettings)) {
    h.keys(settings, ['enabled', 'executionMode'], '事件设置内容');
    h.bool(settings.enabled, '事件启用');
    if (!['automatic', 'menu'].includes(settings.executionMode)) h.fail('事件执行方式应为 automatic 或 menu');
  }
}

function validateInteractionList(interactions, context, pageIds, h) {
  h.array(interactions, '交互分支', 200); const previousModes = new Map();
  for (const item of interactions) {
    h.keys(item, INTERACTION_KEYS, '交互分支'); if (!INTERACTION_EVENTS.includes(item.event)) h.fail(`不支持的事件：${item.event}`); h.string(item.name, '交互名称', 200); h.bool(item.enabled, '交互启用');
    if(['dragStart','drag','dragEnd','scroll'].includes(item.event)&&!context.panel)h.fail('拖动与滚动事件只能用于动态面板');
    if(item.event==='adaptiveViewChange'&&!context.page)h.fail('自适应视图改变事件只能用于页面');
    if(['windowResize','windowScroll','variableChange'].includes(item.event)&&!context.page)h.fail('窗口与全局变量事件只能用于页面');
    if (!['if', 'elseIf', 'else'].includes(item.caseMode)) h.fail('交互分支模式无效');
    if (item.caseMode !== 'if' && (!previousModes.has(item.event) || previousModes.get(item.event) === 'else')) h.fail('elseIf/else 必须跟在同事件的 if 分组后');
    previousModes.set(item.event, item.caseMode); validateExpression(item.condition, context, h); if (item.caseMode === 'else' && item.condition !== null) h.fail('else 分支不应有条件');
    h.array(item.actions, '交互动作', 100); for (const action of item.actions) validateAction(action, context, pageIds, h);
  }
}

function validateAction(action, context, pageIds, h) {
  h.object(action, '动作'); const expr = value => validateExpression(value, context, h);
  if (own(action, 'enabled')) { h.bool(action.enabled, '动作启用'); action = { ...action }; delete action.enabled; }
  const target = key => { const node = context.nodes.get(action[key]); if (!node) h.fail(`动作元件不存在：${action[key]}`); return node; };
  switch (action.type) {
    case 'focus': h.keys(action, ['type', 'targetId'], '聚焦动作'); if (!['input', 'textarea', 'select', 'button', 'checkbox', 'radio'].includes(target('targetId').type)) h.fail('聚焦动作需要输入或按钮控件'); break;
    case 'triggerEvent': h.keys(action, ['type', 'targetId', 'event'], '触发事件动作'); if (!getInteractionEvents(target('targetId')).includes(action.event)) h.fail('目标元件不支持此触发事件'); break;
    case 'setAdaptiveView': h.keys(action,['type','mode','viewId'],'切换自适应视图',false);if(!context.adaptiveViews)h.fail('切换页面自适应视图仅能用于页面及页面元件');if(!['auto','base','view'].includes(action.mode))h.fail('自适应视图选择模式无效');if(action.mode==='view'){if(!context.adaptiveViews.has(action.viewId))h.fail('切换目标视图不存在');}else if(own(action,'viewId'))h.fail('自动或基础模式不应指定视图 ID');break;
    case 'setText': case 'setVisible': case 'setValue': case 'setChecked': case 'setDisabled': case 'setSelected': case 'setError': h.keys(action, ['type', 'targetId', 'value'], '属性动作'); target('targetId'); expr(action.value); if (['setVisible', 'setChecked', 'setDisabled', 'setSelected', 'setError'].includes(action.type) && (action.value === null || typeof action.value !== 'object')) h.bool(action.value, '动作布尔值'); break;
    case 'toggleVisible': h.keys(action, ['type', 'targetId'], '切换显示动作'); target('targetId'); break;
    case 'navigate': h.keys(action, ['type', 'pageId'], '跳页动作'); if (!pageIds.has(action.pageId)) h.fail(`跳页目标不存在：${action.pageId}`); break;
    case 'wait': h.keys(action, ['type', 'ms'], '等待动作'); h.number(action.ms, '等待时长', 0, 60000); break;
    case 'setVariable': h.keys(action, ['type', 'name', 'value'], '变量动作'); if (!context.variables.has(action.name)) h.fail(`变量不存在：${action.name}`); expr(action.value); break;
    case 'move': h.keys(action, ['type', 'targetId', 'x', 'y', 'relative'], '移动动作'); target('targetId'); expr(action.x); expr(action.y); h.bool(action.relative, '相对移动'); break;
    case 'resize': h.keys(action, ['type', 'targetId', 'width', 'height'], '缩放动作'); target('targetId'); expr(action.width); expr(action.height); break;
    case 'setStyle': h.keys(action, ['type', 'targetId', 'style'], '样式动作'); h.keys(action.style, h.STYLE_KEYS, '动作样式', false); h.validateStyle({ ...target('targetId').style, ...action.style }); break;
    case 'setPanelState': { h.keys(action, ['type', 'panelId', 'stateId'], '面板状态动作'); const panel = target('panelId').panel; if (!panel?.states.some(state => state.id === action.stateId)) h.fail('目标面板状态不存在'); break; }
    case 'nextPanelState': case 'previousPanelState': h.keys(action, ['type', 'panelId', 'wrap'], '切换面板动作'); if (!target('panelId').panel) h.fail('目标不是动态面板'); h.bool(action.wrap, '循环切换'); break;
    case 'addRows': { h.keys(action, ['type', 'repeaterId', 'rows'], '增加数据行动作'); const repeater = target('repeaterId').repeater; if (!repeater) h.fail('目标不是中继器'); h.array(action.rows, '新增行', 1000); for (const row of action.rows) { h.keys(row, ['values'], '新增行'); validateRowValues(row.values, repeater.columns, h, false, context); } break; }
    case 'deleteRows': case 'filterRows': { h.keys(action, ['type', 'repeaterId', 'where'], '数据条件动作'); const repeater = target('repeaterId').repeater; if (!repeater) h.fail('目标不是中继器'); validateExpression(action.where, { ...context, columns: new Set(repeater.columns.map(column => column.key)), filtering: action.type === 'filterRows' }, h); break; }
    case 'setRepeaterPage': case 'setRepeaterPageSize': { h.keys(action, ['type', 'repeaterId', 'value'], '分页动作'); if (!target('repeaterId').repeater) h.fail('目标不是中继器'); expr(action.value); if (!plain(action.value) && !(action.type === 'setRepeaterPageSize' && action.value === null) && (!Number.isInteger(action.value) || action.value < 1 || action.value > 10000)) h.fail('分页动作需要 1–10000 的整数，或每页数量 null'); break; }
    case 'markRows': { h.keys(action, ['type', 'repeaterId', 'where', 'marked'], '标记行动作'); const repeater = target('repeaterId').repeater; if (!repeater) h.fail('目标不是中继器'); const rowContext = { ...context, columns: new Set(repeater.columns.map(column => column.key)) }; validateExpression(action.where, rowContext, h); validateExpression(action.marked, rowContext, h); if (!plain(action.marked)) h.bool(action.marked, '行标记'); break; }
    case 'updateRows': { h.keys(action, ['type', 'repeaterId', 'where', 'values'], '修改行动作'); const repeater = target('repeaterId').repeater; if (!repeater) h.fail('目标不是中继器'); const rowContext = { ...context, columns: new Set(repeater.columns.map(column => column.key)) }; validateExpression(action.where, rowContext, h); validateRowValues(action.values, repeater.columns, h, true, rowContext); break; }
    case 'sortRows': { h.keys(action, ['type', 'repeaterId', 'column', 'descending'], '数据排序动作'); const repeater = target('repeaterId').repeater; if (!repeater) h.fail('目标不是中继器'); validateSort({ column: action.column, descending: action.descending }, repeater.columns, h); break; }
    default: h.fail(`不支持的动作：${String(action.type)}`);
  }
}

function walkExpressions(project, visit) {
  const walk = value => { if (!plain(value)) return value; if (Array.isArray(value.args)) value.args = value.args.map(walk); return visit(value); };
  for (const node of [...allNodes(project), ...project.pages]) {
    for (const item of node.interactions) {
      item.condition = walk(item.condition);
      for (const action of item.actions) { for (const key of ['value', 'x', 'y', 'width', 'height', 'where', 'marked']) if (own(action, key)) action[key] = walk(action[key]); if (action.type === 'updateRows') for (const key of Object.keys(action.values)) action.values[key] = walk(action.values[key]); if (action.type === 'addRows') for (const row of action.rows) for (const key of Object.keys(row.values)) row.values[key] = walk(row.values[key]); }
    }
    for (const key of Object.keys(node.bindings || {})) node.bindings[key] = walk(node.bindings[key]); if (node.repeater) node.repeater.filter = walk(node.repeater.filter);
  }
}
export function cleanInteractionReferences(project, { nodeIds = new Set(), pageIds = new Set(), stateIds = new Set(), variableNames = new Set() } = {}) {
  const invalidExpression = value => plain(value) && ((value.op === 'node' && nodeIds.has(value.nodeId)) || (value.op === 'repeater' && nodeIds.has(value.repeaterId)) || (value.op === 'var' && variableNames.has(value.name)) || value.args?.some(invalidExpression));
  for (const node of [...allNodes(project), ...project.pages]) {
    const brokenBranches = new Map();
    node.interactions = node.interactions.flatMap(item => {
      if (item.caseMode === 'if') brokenBranches.set(item.event, false);
      if (invalidExpression(item.condition)) { brokenBranches.set(item.event, true); return []; }
      const cleaned = { ...item, actions: item.actions.filter(action => {
      if (['targetId', 'panelId', 'repeaterId'].some(key => nodeIds.has(action[key])) || pageIds.has(action.pageId) || stateIds.has(action.stateId) || (action.type === 'setVariable' && variableNames.has(action.name))) return false;
      if (['value', 'x', 'y', 'width', 'height', 'where', 'marked'].some(key => invalidExpression(action[key]))) return false;
      if (action.type === 'updateRows' && Object.values(action.values).some(invalidExpression)) return false;
      return action.type !== 'addRows' || !action.rows.some(row => Object.values(row.values).some(invalidExpression));
    }) };
      // 缺失条件后的整条分支链都禁止触发，直到同一事件出现下一个独立 if。
      if (brokenBranches.get(item.event)) { cleaned.caseMode = 'if'; cleaned.condition = false; }
      return [cleaned];
    });
    for (const key of Object.keys(node.bindings || {})) if (invalidExpression(node.bindings[key])) delete node.bindings[key];
    if (node.panel) for (const state of node.panel.states) state.nodeIds = state.nodeIds.filter(id => !nodeIds.has(id));
    if (node.repeater) { node.repeater.templateIds = node.repeater.templateIds.filter(id => !nodeIds.has(id)); if (invalidExpression(node.repeater.filter)) node.repeater.filter = false; }
  }
  for (const canvas of allContainers(project)) {for (const view of canvas.views || []) for (const nodeId of nodeIds) if(view.overrides)delete view.overrides[nodeId];for(const overrides of Object.values(canvas.viewOverrides||{}))for(const nodeId of nodeIds)delete overrides[nodeId];}
}

export function applyInteractionCommand(project, command, h) {
  const ck = (required, optional = []) => { h.keys(command, ['type', ...required, ...optional], '交互模型命令', false); for (const key of required) if (!own(command, key)) h.fail(`命令缺少 ${key}`, 'COMMAND_ERROR'); };
  const targetNode = () => { const page = h.pageFor(project, command.pageId), node = h.nodeFor(page, command.nodeId || command.panelId); h.assertEditable(page, node); return { page, node }; };
  const panelTarget = () => { const result = targetNode(); if (!result.node.panel) h.fail('目标不是动态面板', 'COMMAND_ERROR'); return { ...result, panel: result.node.panel }; };
  const repeaterTarget = () => { const result = targetNode(); if (!result.node.repeater) h.fail('目标不是中继器', 'COMMAND_ERROR'); return { ...result, repeater: result.node.repeater }; };
  const removeOwnership = (page, ids) => { for (const node of page.nodes) { if (node.panel) for (const state of node.panel.states) state.nodeIds = state.nodeIds.filter(id => !ids.includes(id)); if (node.repeater) node.repeater.templateIds = node.repeater.templateIds.filter(id => !ids.includes(id)); } };
  const stateFor = (panel, stateId) => { const state = panel.states.find(state => state.id === stateId); if (!state) h.fail('面板状态不存在', 'COMMAND_ERROR'); return state; };
  const viewFor = (page, viewId) => { const view = page.views.find(view => view.id === viewId); if (!view) h.fail('自适应视图不存在', 'COMMAND_ERROR'); return view; };
  const setFor = id => {const set=project.viewSets.find(set=>set.id===id);if(!set)h.fail('视图集不存在','COMMAND_ERROR');return set;};
  const sharedView = set => {const view=set.views.find(view=>view.id===command.viewId);if(!view)h.fail('共享视图不存在','COMMAND_ERROR');return view;};
  const mapViewActions = (page,mapping,removed=new Set()) => {for(const item of [page,...page.nodes])for(const branch of item.interactions||[])branch.actions=branch.actions.filter(action=>!(action.type==='setAdaptiveView'&&action.mode==='view'&&removed.has(action.viewId))).map(action=>action.type==='setAdaptiveView'&&mapping.has(action.viewId)?{...action,viewId:mapping.get(action.viewId)}:action);};
  const flattenedOverrides = page => {
    const views=getCanvasViews(project,page),paths=new Map(),base=new Map(resolveCanvasView(project,page,null).nodes.map(node=>[node.id,node])),models=new Map(views.map(view=>[view.id,new Map(resolveCanvasView(project,page,view.id).nodes.map(node=>[node.id,node]))]));
    const add=(id,key)=>{const keys=paths.get(id)||new Set();keys.add(key);paths.set(id,keys);};
    for(const view of views){for(const[id,patch]of Object.entries(getCanvasViewOverrides(project,page,view.id)||{}))for(const key of Object.keys(patch))if(key==='style')for(const property of Object.keys(patch.style))add(id,'style.'+property);else add(id,key);
      for(const[id,node]of models.get(view.id)){const initial=base.get(id);for(const key of VIEW_OVERRIDE_KEYS)if(key==='style'){for(const[property,value]of Object.entries(node.style))if(!styleValueEqual(value,initial.style[property]))add(id,'style.'+property);}else if(node[key]!==initial[key])add(id,key);}}
    // A new name/ancestry can select a different auto component view even when
    // the old page had no explicit overrides. Preserve those projected fields.
    for(const group of page.groups||[])if(group.componentId)for(const id of group.nodeIds){const node=base.get(id);for(const key of VIEW_OVERRIDE_KEYS)if(key==='style')for(const property of Object.keys(node.style))add(id,'style.'+property);else add(id,key);}
    return new Map(views.map(view=>{const nodes=models.get(view.id),overrides={};for(const[id,keys]of paths){const node=nodes.get(id);if(!node)continue;const patch={};for(const key of keys)if(key.startsWith('style.')){patch.style||={};patch.style[key.slice(6)]=clone(node.style[key.slice(6)]);}else patch[key]=clone(node[key]);put(overrides,id,patch);}return[view.id,overrides];}));
  };
  const flattenedGroupViews = page => new Map((page.groups||[]).filter(group=>group.componentId).map(group=>[group.id,new Map(getCanvasViews(project,page).map(view=>[view.id,resolveInstancePosition(project,page,group,view.id)]))]));
  const remapGroupViews = (page,positions,mapping) => {for(const group of page.groups||[])if(group.componentId)group.viewOverrides=Object.fromEntries([...mapping].map(([from,to])=>[to,clone(positions.get(group.id).get(from))]));};
  switch (command.type) {
    case 'addViewSet': {ck(['viewSet']);h.keys(command.viewSet,['id','name','views'],'新视图集',false);const set={id:h.uuid(),name:'新视图集',views:[],...clone(command.viewSet)};h.array(set.views,'新视图集定义',50);set.views=set.views.map(view=>({id:h.uuid(),parentId:null,...view}));project.viewSets.push(set);return true;}
    case 'updateViewSet': {ck(['viewSetId','patch']);h.keys(command.patch,['name'],'视图集修改',false);Object.assign(setFor(command.viewSetId),clone(command.patch));return true;}
    case 'removeViewSet': {ck(['viewSetId']);setFor(command.viewSetId);if(project.pages.some(page=>page.viewSetId===command.viewSetId))h.fail('此视图集仍被页面使用，请先解除共享','COMMAND_ERROR');project.viewSets=project.viewSets.filter(set=>set.id!==command.viewSetId);return true;}
    case 'addViewSetView': {ck(['viewSetId','view']);h.keys(command.view,['id','name','parentId','minWidth','width','height'],'新共享视图',false);setFor(command.viewSetId).views.push({id:h.uuid(),name:'新视图',parentId:null,minWidth:0,width:390,height:844,...clone(command.view)});return true;}
    case 'updateViewSetView': {ck(['viewSetId','viewId','patch']);h.keys(command.patch,['name','parentId','minWidth','width','height'],'共享视图修改',false);Object.assign(sharedView(setFor(command.viewSetId)),clone(command.patch));return true;}
    case 'removeViewSetView': {ck(['viewSetId','viewId']);const set=setFor(command.viewSetId);sharedView(set);if(set.views.some(view=>view.parentId===command.viewId))h.fail('请先修改子视图的继承关系再删除父视图','COMMAND_ERROR');set.views=set.views.filter(view=>view.id!==command.viewId);for(const page of project.pages)if(page.viewSetId===set.id){delete page.viewOverrides[command.viewId];for(const group of page.groups||[])delete group.viewOverrides?.[command.viewId];mapViewActions(page,new Map(),new Set([command.viewId]));}return true;}
    case 'setPageViewSet': {ck(['pageId','viewSetId'],['viewMap']);const page=h.pageFor(project,command.pageId);if(!project.pages.includes(page))h.fail('组件不能引用页面视图集','COMMAND_ERROR');if(command.viewSetId===page.viewSetId)return true;
      if(own(command,'viewMap'))h.object(command.viewMap,'视图映射');const target=command.viewSetId===null?null:setFor(command.viewSetId),old=getCanvasViews(project,page),mapping=new Map(Object.entries(command.viewMap||{}));if(old.length){h.object(command.viewMap,'视图映射');const targets=new Set(target?.views.map(view=>view.id)||[]);if(mapping.size!==old.length||old.some(view=>!mapping.has(view.id))||new Set(mapping.values()).size!==mapping.size||[...mapping.values()].some(id=>!targets.has(id)))h.fail('切换视图集需要完整且不重复的旧视图到新视图映射','COMMAND_ERROR');}else if(mapping.size)h.fail('无旧视图时不应提供视图映射','COMMAND_ERROR');
      const flattened=flattenedOverrides(page),positions=flattenedGroupViews(page);page.views=[];page.viewSetId=target?.id??null;page.viewOverrides=Object.fromEntries([...mapping].map(([from,to])=>[to,flattened.get(from)]));remapGroupViews(page,positions,mapping);mapViewActions(page,mapping);return true;}
    case 'detachPageViewSet': {ck(['pageId']);const page=h.pageFor(project,command.pageId);if(!project.pages.includes(page)||page.viewSetId===null)h.fail('此页面没有共享视图集','COMMAND_ERROR');const views=getCanvasViews(project,page),flattened=flattenedOverrides(page),positions=flattenedGroupViews(page),mapping=new Map(views.map(view=>[view.id,h.uuid()]));page.views=views.map(view=>({id:mapping.get(view.id),name:view.name,minWidth:view.minWidth,width:view.width,height:view.height,overrides:flattened.get(view.id)}));page.viewSetId=null;page.viewOverrides={};remapGroupViews(page,positions,mapping);mapViewActions(page,mapping);return true;}
    case 'setViewOverride': case 'clearViewOverride': {ck(['pageId','viewId','nodeId',command.type==='setViewOverride'?'patch':'paths']);const page=h.pageFor(project,command.pageId);if(!getCanvasViews(project,page).some(view=>view.id===command.viewId))h.fail('视图不存在','COMMAND_ERROR');const node=h.nodeFor(page,command.nodeId);if(command.type==='clearViewOverride'||command.type==='setViewOverride'&&command.patch===null){if(isHierarchyLocked(page,node.id))h.fail('请先解锁元件及所属组、容器','LOCKED');}else h.assertEditable(page,node);
      const legacy=project.pages.includes(page)&&page.viewSetId===null;let map=getCanvasViewOverrides(project,page,command.viewId);if(!map){page.viewOverrides||={};map=put(page.viewOverrides,command.viewId,{});}
      if(command.type==='setViewOverride'){if(command.patch===null)delete map[node.id];else{h.keys(command.patch,VIEW_OVERRIDE_KEYS,'视图覆盖',false);const previous=own(map,node.id)?map[node.id]:{};put(map,node.id,{...previous,...clone(command.patch),...(command.patch.style?{style:{...previous.style,...clone(command.patch.style)}}:{})});}}
      else{h.array(command.paths,'恢复继承的属性',100);for(const property of command.paths){if(typeof property!=='string'||!(adaptiveKeys.includes(property)||property.startsWith('style.')&&h.STYLE_KEYS.includes(property.slice(6))))h.fail('恢复继承的属性无效','COMMAND_ERROR');const patch=own(map,node.id)?map[node.id]:undefined;if(!patch)continue;if(property.startsWith('style.')){if(patch.style){delete patch.style[property.slice(6)];if(!Object.keys(patch.style).length)delete patch.style;}}else delete patch[property];if(!Object.keys(patch).length)delete map[node.id];}}
      if(!legacy&&!Object.keys(map).length)delete page.viewOverrides[command.viewId];return true;}
    case 'addVariable': ck(['variable']); project.variables.push(clone(command.variable)); return true;
    case 'updateVariable': {
      ck(['name', 'patch']); h.keys(command.patch, ['name', 'type', 'value'], '变量修改', false); const variable = project.variables.find(variable => variable.name === command.name); if (!variable) h.fail('变量不存在', 'COMMAND_ERROR');
      Object.assign(variable, clone(command.patch));
      if (own(command.patch, 'name')) { walkExpressions(project, value => value.op === 'var' && value.name === command.name ? { ...value, name: command.patch.name } : value); for (const node of [...allNodes(project), ...project.pages]) for (const item of node.interactions) for (const action of item.actions) if (action.type === 'setVariable' && action.name === command.name) action.name = command.patch.name; }
      return true;
    }
    case 'removeVariable': ck(['name']); if (!project.variables.some(variable => variable.name === command.name)) h.fail('变量不存在', 'COMMAND_ERROR'); project.variables = project.variables.filter(variable => variable.name !== command.name); cleanInteractionReferences(project, { variableNames: new Set([command.name]) }); return true;
    case 'createDynamicPanel': case 'createRepeater': {
      ck(['pageId'], ['nodeIds', 'panelId', 'nodeId', 'name']); const page = h.pageFor(project, command.pageId), selectedIds = command.nodeIds || []; h.array(selectedIds, '容器元件', 5000); const selected = selectedIds.map(id => h.nodeFor(page, id));
      for (const node of selected) h.assertEditable(page, node); const x = selected.length ? Math.min(...selected.map(node => node.x)) : 80, y = selected.length ? Math.min(...selected.map(node => node.y)) : 80;
      const node = h.makeNode(command.type === 'createDynamicPanel' ? 'dynamicPanel' : 'repeater', { id: command.panelId || command.nodeId || h.uuid(), name: command.name || (command.type === 'createDynamicPanel' ? '动态面板' : '中继器'), x, y, width: selected.length ? Math.max(...selected.map(node => node.x + node.width)) - x : 360, height: selected.length ? Math.max(...selected.map(node => node.y + node.height)) - y : 240 });
      removeOwnership(page, selectedIds); if (node.panel) node.panel.states[0].nodeIds = [...selectedIds]; else { node.repeater.templateIds = [...selectedIds]; node.repeater.itemWidth = node.width; node.repeater.itemHeight = node.height; }
      const index = selected.length ? Math.min(...selected.map(node => page.nodes.indexOf(node))) : page.nodes.length; page.nodes.splice(index, 0, node); return true;
    }
    case 'addPanelState': { ck(['pageId', 'panelId', 'state']); const { panel } = panelTarget(); h.keys(command.state, ['id', 'name', 'nodeIds'], '面板状态设置', false); panel.states.push({ id: h.uuid(), name: `状态 ${panel.states.length + 1}`, nodeIds: [], ...clone(command.state) }); return true; }
    case 'setPanelOptions': {ck(['pageId','panelId','patch']);const {panel}=panelTarget();h.keys(command.patch,['clip','sizeMode','scroll','pin','drag'],'面板设置',false);Object.assign(panel,clone(command.patch));return true;}
    case 'reorderPanelState': {ck(['pageId','panelId','stateId','index']);const {panel}=panelTarget(),state=stateFor(panel,command.stateId);if(!Number.isInteger(command.index)||command.index<0||command.index>=panel.states.length)h.fail('面板状态顺序超出范围','COMMAND_ERROR');panel.states.splice(panel.states.indexOf(state),1);panel.states.splice(command.index,0,state);return true;}
    case 'duplicatePanelState': {
      ck(['pageId','panelId','stateId'],['newStateId','name']);const {page,node,panel}=panelTarget(),source=stateFor(panel,command.stateId),stateId=command.newStateId||h.uuid();h.id(stateId,'新状态 ID');
      const selected=new Set(source.nodeIds.flatMap(id=>[id,...getNodeDescendants(page.nodes,id)])),originals=page.nodes.filter(item=>selected.has(item.id));
      for(const group of page.groups)if(group.componentId&&group.nodeIds.some(id=>selected.has(id))&&!group.nodeIds.every(id=>selected.has(id)))h.fail('复制状态不能拆开关联母版','COMPONENT_LINKED');
      const groups=page.groups.filter(group=>group.nodeIds.length&&group.nodeIds.every(id=>selected.has(id)));
      const mapping=new Map([...selected,...getNodeInternalIds(originals),...groups.map(group=>group.id)].map(id=>[id,h.uuid()]));mapping.set(source.id,stateId);
      const copies=originals.map(item=>{const copy=remapVectorReferences(remapNodeReferences(item,mapping),mapping);copy.id=mapping.get(item.id);return copy;});page.nodes.push(...copies);
      for(const original of groups){const group=clone(original);group.id=mapping.get(group.id);group.nodeIds=group.nodeIds.map(id=>mapping.get(id));group.parentGroupId=mapping.get(group.parentGroupId)||null;if(group.componentId)group.internalIds=Object.fromEntries(Object.entries(group.internalIds).map(([key,id])=>[key,mapping.get(id)||id]));page.groups.push(group);}
      for(const overrides of [...(page.views||[]).map(view=>view.overrides).filter(Boolean),...Object.values(page.viewOverrides||{})])for(const [id,patch]of Object.entries(overrides))if(selected.has(id))overrides[mapping.get(id)]=clone(patch);
      panel.states.splice(panel.states.indexOf(source)+1,0,{id:stateId,name:command.name??`${source.name} 副本`,nodeIds:source.nodeIds.map(id=>mapping.get(id))});
      return true;
    }
    case 'updatePanelState': { ck(['pageId', 'panelId', 'stateId', 'patch']); const { panel } = panelTarget(); h.keys(command.patch, ['name', 'nodeIds'], '状态修改', false); Object.assign(stateFor(panel, command.stateId), clone(command.patch)); return true; }
    case 'assignPanelNodes': { ck(['pageId', 'panelId', 'stateId', 'nodeIds']); const { page, panel } = panelTarget(); const state = stateFor(panel, command.stateId); h.array(command.nodeIds, '状态元件', 5000); for (const id of command.nodeIds) h.nodeFor(page, id); removeOwnership(page, command.nodeIds); state.nodeIds = [...command.nodeIds]; return true; }
    case 'removePanelState': {
      ck(['pageId', 'panelId', 'stateId']); const { panel } = panelTarget(); stateFor(panel, command.stateId); if (panel.states.length === 1) h.fail('不能删除最后一个面板状态', 'COMMAND_ERROR');
      panel.states = panel.states.filter(state => state.id !== command.stateId); if (panel.initialStateId === command.stateId) panel.initialStateId = panel.states[0].id; cleanInteractionReferences(project, { stateIds: new Set([command.stateId]) }); return true;
    }
    case 'setInitialPanelState': { ck(['pageId', 'panelId', 'stateId']); const { panel } = panelTarget(); stateFor(panel, command.stateId); panel.initialStateId = command.stateId; return true; }
    case 'moveContainer': { ck(['pageId', 'nodeId', 'dx', 'dy']); const { page, node } = targetNode(); if (!node.panel && !node.repeater) h.fail('目标不是容器元件', 'COMMAND_ERROR'); h.number(command.dx, '移动 X', -100000, 100000); h.number(command.dy, '移动 Y', -100000, 100000); h.translateNodes(page, [node.id], command.dx, command.dy); return true; }
    case 'setRepeaterData': { ck(['pageId', 'nodeId', 'columns', 'rows']); const { repeater } = repeaterTarget(); h.array(command.rows, '数据行', 10000); repeater.columns = clone(command.columns); repeater.rows = command.rows.map(row => ({ id: h.uuid(), ...clone(row) })); repeater.markedRowIds = (repeater.markedRowIds || []).filter(id => repeater.rows.some(row => row.id === id)); return true; }
    case 'setRepeaterPagination': { ck(['pageId', 'nodeId', 'pagination']); repeaterTarget().repeater.pagination = clone(command.pagination); return true; }
    case 'setRepeaterMarks': { ck(['pageId', 'nodeId', 'rowIds']); repeaterTarget().repeater.markedRowIds = clone(command.rowIds); return true; }
    case 'importRepeaterData': {
      ck(['pageId', 'nodeId', 'text', 'delimiter', 'hasHeader', 'columnMap', 'mode']); const { repeater } = repeaterTarget();
      if (!['append', 'replace'].includes(command.mode)) h.fail('导入方式只支持 append 或 replace');
      const parsed = prepareRepeaterImport(command, repeater.columns), rows = parsed.rows.map(row => ({ id: h.uuid(), values: row.values }));
      if (rows.length + (command.mode === 'append' ? repeater.rows.length : 0) > 10000) h.fail('数据列表最多 10000 行');
      if (command.mode === 'replace') { repeater.rows = rows; repeater.markedRowIds = []; repeater.pagination.initialPage = 1; } else repeater.rows.push(...rows);
      return true;
    }
    case 'addRepeaterRows': { ck(['pageId', 'nodeId', 'rows']); const { repeater } = repeaterTarget(); h.array(command.rows, '数据行', 10000); repeater.rows.push(...command.rows.map(row => ({ id: h.uuid(), ...clone(row) }))); return true; }
    case 'updateRepeaterRow': { ck(['pageId', 'nodeId', 'rowId', 'values']); const { repeater } = repeaterTarget(); const row = repeater.rows.find(row => row.id === command.rowId); if (!row) h.fail('数据行不存在', 'COMMAND_ERROR'); h.object(command.values, '数据行修改'); row.values = { ...row.values, ...clone(command.values) }; return true; }
    case 'removeRepeaterRows': { ck(['pageId', 'nodeId', 'rowIds']); const { repeater } = repeaterTarget(); h.array(command.rowIds, '数据行 ID', 10000); for (const id of command.rowIds) if (!repeater.rows.some(row => row.id === id)) h.fail('待删除的数据行不存在', 'COMMAND_ERROR'); repeater.rows = repeater.rows.filter(row => !command.rowIds.includes(row.id)); repeater.markedRowIds = (repeater.markedRowIds || []).filter(id => !command.rowIds.includes(id)); return true; }
    case 'setRepeaterTemplate': { ck(['pageId', 'nodeId', 'nodeIds']); const { page, repeater } = repeaterTarget(); h.array(command.nodeIds, '模板元件', 5000); for (const id of command.nodeIds) h.nodeFor(page, id); removeOwnership(page, command.nodeIds); repeater.templateIds = [...command.nodeIds]; return true; }
    case 'setRepeaterFilter': { ck(['pageId', 'nodeId', 'filter']); repeaterTarget().repeater.filter = clone(command.filter); return true; }
    case 'setRepeaterSort': { ck(['pageId', 'nodeId', 'sort']); repeaterTarget().repeater.sort = clone(command.sort); return true; }
    case 'addAdaptiveView': { ck(['pageId', 'view']); const page = h.pageFor(project, command.pageId); h.keys(command.view, ['id', 'name', 'minWidth', 'width', 'height', 'overrides'], '视图设置', false); page.views.push({ id: h.uuid(), name: '新视图', minWidth: 0, width: page.width, height: page.height, overrides: {}, ...clone(command.view) }); return true; }
    case 'updateAdaptiveView': { ck(['pageId', 'viewId', 'patch']); const page = h.pageFor(project, command.pageId); h.keys(command.patch, ['name', 'minWidth', 'width', 'height', 'overrides'], '视图修改', false); Object.assign(viewFor(page, command.viewId), clone(command.patch)); return true; }
    case 'removeAdaptiveView': { ck(['pageId', 'viewId']); const page = h.pageFor(project, command.pageId); viewFor(page, command.viewId); page.views = page.views.filter(view => view.id !== command.viewId);for(const group of page.groups||[])delete group.viewOverrides?.[command.viewId];mapViewActions(page,new Map(),new Set([command.viewId]));return true; }
    case 'setAdaptiveOverride': { ck(['pageId', 'viewId', 'nodeId', 'patch']); const page = h.pageFor(project, command.pageId), view = viewFor(page, command.viewId); h.nodeFor(page, command.nodeId); if (command.patch === null) delete view.overrides[command.nodeId]; else { h.keys(command.patch, adaptiveKeys, '自适应覆盖', false); const previous = view.overrides[command.nodeId] || {}; view.overrides[command.nodeId] = { ...previous, ...clone(command.patch), ...(command.patch.style ? { style: { ...previous.style, ...clone(command.patch.style) } } : {}) }; } return true; }
    default: return false;
  }
}
