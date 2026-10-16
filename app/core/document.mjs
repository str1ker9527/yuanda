/** 原搭文档模型与事务引擎。独立编写，不依赖任何第三方原型运行器。 */
import { DESIGN_NODE_KEYS, DESIGN_PAGE_KEYS, DESIGN_PROJECT_KEYS, DESIGN_TYPES, nodeDesignDefaults, normalizeDesignProject, validateDesignProject, applyDesignCommand, reconcileDesignProject, assertNodeEditable, prepareNodeRemoval, translateNodes } from './design-model.mjs';
import { captureOwnership, guardOwnershipChanges } from './hierarchy-model.mjs';
import { applyLibraryCommand } from './library-model.mjs';
import { applyViewCommands, sharedTextCleanup } from './view-commands.mjs';
import { INTERACTION_NODE_KEYS, INTERACTION_PAGE_KEYS, INTERACTION_PROJECT_KEYS, INTERACTION_TYPES, INTERACTION_KEYS, interactionNodeDefaults, normalizeInteractions, validateInteractionProject, applyInteractionCommand, cleanInteractionReferences, getNodeDescendants, getNodeInternalIds } from './interaction-model.mjs';
import { VECTOR_TYPES, VECTOR_NODE_KEYS, nodeVectorDefaults, validateVectorProject, reconcileVectorProject, expandVectorRemoval } from './vector-model.mjs';
import { IMAGE_NODE_KEYS, IMAGE_COMMANDS, nodeImageDefaults, validateImageOptions, imageDataBytes, prepareImageNodePatch, applyImageCommand } from './image-model.mjs';
import { STYLE_KEYS, newStyleDefaults, getBuiltinStyle, validateStyleInheritance, validateStyle as validateWidgetStyle, collectStyleImageSources } from './style-model.mjs';
import { applyPageTreeCommand, appendPageTreeEntry, removePageTreeEntries } from './page-tree-model.mjs';
export { normalizeDesignProject as normalizeProject } from './design-model.mjs';
const TYPES = new Set(['rectangle', 'text', 'button', 'input', 'image', ...DESIGN_TYPES, ...INTERACTION_TYPES, ...VECTOR_TYPES]);
const PROJECT_KEYS = ['format', 'version', 'id', 'name', 'pages', ...DESIGN_PROJECT_KEYS, ...INTERACTION_PROJECT_KEYS];
const PAGE_KEYS = ['id', 'name', 'width', 'height', 'background', 'nodes', ...DESIGN_PAGE_KEYS, ...INTERACTION_PAGE_KEYS];
const NODE_KEYS = ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'locked', 'text', 'src', 'style', 'interactions', ...DESIGN_NODE_KEYS, ...INTERACTION_NODE_KEYS, ...VECTOR_NODE_KEYS, ...IMAGE_NODE_KEYS];
const clone = value => structuredClone(value);
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function fail(message, code = 'VALIDATION_ERROR') { const error = new Error(message); error.code = code; throw error; }
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${path} 必须是普通对象`);
}
function keys(value, allowed, path, required = true) {
  object(value, path);
  for (const key of Reflect.ownKeys(value)) if (typeof key !== 'string' || !allowed.includes(key)) fail(`${path} 含不支持的字段 ${String(key)}`);
  if (required) for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`${path} 缺少 ${key}`);
}
function string(value, path, max = 200, min = 0) { if (typeof value !== 'string' || value.length < min || value.length > max) fail(`${path} 必须是 ${min}–${max} 个字符的文字`); }
function number(value, path, min, max) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${path} 必须是 ${min}–${max} 的有限数值`); }
function bool(value, path) { if (typeof value !== 'boolean') fail(`${path} 必须是 true 或 false`); }
function id(value, path) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(`${path} 只能使用英文字母、数字、下划线和短横线`); }
function color(value, path) {
  if (typeof value !== 'string' || !/^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|white|black)$/i.test(value)) fail(`${path} 请使用十六进制颜色，例如 #6366F1`);
}
function array(value, path, max) { if (!Array.isArray(value) || value.length > max) fail(`${path} 必须是最多 ${max} 项的列表`); }
function validateStyle(style) { validateWidgetStyle(style, { keys, string, number, bool, array, fail, color, imageDataBytes }); }

/** 完整验证文档；成功返回 true，失败抛带 code 的 Error，不修改输入。 */
export function validateProject(project) {
  project = normalizeDesignProject(project);
  keys(project, PROJECT_KEYS, '项目');
  if (project.format !== 'yuanda' || project.version !== 1) fail('不是受支持的原搭 1 版项目');
  id(project.id, '项目 ID'); string(project.name, '项目名称', 200, 1);
  array(project.pages, '页面', 100);
  if (!project.pages.length) fail('项目至少需要一个页面');
  const ids = new Set([project.id]);
  const pageIds = new Set();
  let nodeCount = 0, totalImageBytes = 0;
  function unique(value, path) { id(value, path); if (ids.has(value)) fail(`${path} 重复：${value}`); ids.add(value); }
  for (const page of project.pages) {
    keys(page, PAGE_KEYS, '页面'); unique(page.id, '页面 ID'); pageIds.add(page.id);
    string(page.name, '页面名称', 200, 1); number(page.width, '页面宽度', 100, 20000); number(page.height, '页面高度', 100, 20000); color(page.background, '页面背景');
    array(page.nodes, '元件', 5000);
  }
  validateDesignProject(project, { keys, string, number, bool, array, id, unique, fail, validateStyle, color });
  for (const page of [...project.pages, ...project.components]) {
    nodeCount += page.nodes.length;
    if (nodeCount > 10000) fail('项目最多支持 10000 个元件');
    for (const node of page.nodes) {
      keys(node, NODE_KEYS, '元件'); unique(node.id, '元件 ID');
      if (!TYPES.has(node.type)) fail(`不支持的元件类型：${node.type}`);
      string(node.name, '元件名称', 200, 1); string(node.text, '元件文字', 50000); string(node.src, '图片数据', 6 * 1024 * 1024);
      if (node.src) {
        if (node.type !== 'image') fail('只有图片元件可以有图片数据');
        totalImageBytes += imageDataBytes(node.src);
      }
      validateImageOptions(node, { keys, number, bool, array, fail });
      if (node.image?.optimization) totalImageBytes += imageDataBytes(node.image.optimization.src);
      if (totalImageBytes > 24 * 1024 * 1024) fail('项目内嵌图片总量不得超过 24 MiB（含切片、实例和优化副本）');
      number(node.x, '横坐标', -100000, 100000); number(node.y, '纵坐标', -100000, 100000);
      number(node.width, '元件宽度', 1, 100000); number(node.height, '元件高度', 1, 100000); number(node.rotation, '旋转角度', -36000, 36000);
      bool(node.visible, '可见状态'); bool(node.locked, '锁定状态');
      validateStyle(node.style);
      array(node.interactions, '交互', 200);
      for (const interaction of node.interactions) {
        keys(interaction, INTERACTION_KEYS, '交互');
        array(interaction.actions, '动作', 100);
      }
    }
  }
  validateInteractionProject(project, { object, keys, string, number, bool, array, id, unique, fail, validateStyle, STYLE_KEYS });
  validateVectorProject(project);
  for (const src of collectStyleImageSources(project)) {
    totalImageBytes += imageDataBytes(src);
    if (totalImageBytes > 24 * 1024 * 1024) fail('项目内嵌图片总量不得超过 24 MiB（含切片、实例、优化副本和样式填充）');
  }
  return true;
}

export function makeNode(type = 'rectangle', overrides = {}) {
  if (!TYPES.has(type)) fail(`不支持的元件类型：${type}`);
  keys(overrides, NODE_KEYS, '元件设置', false);
  if (Object.hasOwn(overrides, 'style')) keys(overrides.style, STYLE_KEYS, '元件样式设置', false);
  const names = { rectangle: '矩形', text: '文字', button: '按钮', input: '输入框', image: '图片', ellipse: '椭圆', line: '线条', textarea: '多行输入', checkbox: '复选框', radio: '单选框', select: '下拉列表', table: '表格', dynamicPanel: '动态面板', repeater: '中继器', path: '路径', connector: '连接线' };
  const base = {
    id: uuid(), type, name: names[type], x: 80, y: 80,
    width: type === 'text' ? 280 : type === 'input' ? 260 : type === 'image' ? 280 : 160,
    height: type === 'text' ? 44 : type === 'image' ? 180 : type === 'rectangle' ? 100 : 44,
    rotation: 0, visible: true, locked: false,
    text: type === 'text' ? '双击修改文字' : type === 'button' ? '按钮' : type === 'input' ? '请输入内容' : '', src: '',
    style: { ...newStyleDefaults(), fill: type === 'text' ? 'transparent' : type === 'button' ? '#191919' : '#FFFFFF', stroke: type === 'text' ? 'transparent' : '#D1D5DB', strokeWidth: type === 'text' ? 0 : 1, radius: type === 'text' ? 0 : 4, color: type === 'button' ? '#FFFFFF' : '#191919', fontSize: type === 'text' ? 16 : 14, fontWeight: type === 'button' ? 500 : 400, align: type === 'text' || type === 'input' ? 'left' : 'center', opacity: 1 },
    interactions: [], ...nodeDesignDefaults(type), ...interactionNodeDefaults(type), ...nodeVectorDefaults(type), ...nodeImageDefaults(type)
  };
  if (type === 'ellipse') { base.height = 100; base.style.radius = 50000; }
  if (type === 'line') { base.height = 2; base.style.fill = 'transparent'; base.style.stroke = '#273047'; base.style.strokeWidth = 2; base.style.radius = 0; }
  if (type === 'textarea') { base.width = 280; base.height = 120; base.text = '请输入多行内容'; base.style.align = 'left'; base.style.stroke = '#D7DCE7'; base.style.strokeWidth = 1; }
  if (type === 'checkbox' || type === 'radio') { base.text = type === 'checkbox' ? '复选选项' : '单选选项'; base.style.fill = 'transparent'; base.style.align = 'left'; base.style.radius = 0; }
  if (type === 'select') { base.width = 260; base.style.align = 'left'; base.style.stroke = '#D7DCE7'; base.style.strokeWidth = 1; }
  if (type === 'table') { base.width = 360; base.height = 160; base.style.stroke = '#D7DCE7'; base.style.strokeWidth = 1; base.style.radius = 0; }
  if (type === 'dynamicPanel' || type === 'repeater') { base.width = 360; base.height = 240; base.style.fill = 'transparent'; }
  if (type === 'path' || type === 'connector') { base.style.fill = 'transparent'; base.style.stroke = '#191919'; base.style.strokeWidth = 2; base.style.radius = 0; }
  base.style=getBuiltinStyle(type);
  return { ...base, styleOverrideKeys: Object.keys(overrides.style??{}), defaultStyleSetId:null, ...clone(overrides), style: { ...base.style, ...clone(overrides.style ?? {}) }, interactions: normalizeInteractions(overrides.interactions ?? base.interactions) };
}

export function createBlankProject(name = '未命名项目') {
  return normalizeDesignProject({ format: 'yuanda', version: 1, id: uuid(), name, pages: [{ id: uuid(), name: '页面 1', width: 1200, height: 800, background: '#FFFFFF', nodes: [] }] });
}

/** 原创三页体验：预约流程、静态工作台和可操作的交互实验室。 */
export function createDemoProject() {
  const color = { paper: '#FFFFFF', ink: '#191919', muted: '#666666', subtle: '#767676', line: '#E8E8E8', lineStrong: '#D0D0D0', wash: '#F8F8F8', selected: '#EFEFEF', bar: '#D6D6D6', shade: '#19191966' };
  const doc = createBlankProject('原搭 · 交互体验'); doc.id = 'yuanda-demo';
  const page = { id: 'page-home', name: '产品预约', width: 1200, height: 820, background: color.paper, nodes: [] };
  const dashboard = { id: 'page-dashboard', name: '体验工作台', width: 1200, height: 820, background: color.paper, nodes: [] };
  const lab = { id: 'page-lab', name: '交互实验室', width: 1200, height: 1050, background: color.paper, nodes: [] };
  const add = (p, type, props) => {
    const node = makeNode(type, props);
    node.style = { ...node.style, stroke: type === 'text' ? 'transparent' : color.lineStrong, color: type === 'button' ? color.paper : color.ink, radius: type === 'text' ? 0 : 4, ...props.style };
    node.styleOverrideKeys=[...new Set([...node.styleOverrideKeys,'stroke','color','radius'])];
    p.nodes.push(node); return node;
  };
  const box = (p, id, x, y, width, height, fill = color.paper, radius = 6, border = true) => add(p, 'rectangle', { id, name: id, x, y, width, height, style: { fill, radius, stroke: color.line, strokeWidth: border ? 1 : 0 } });
  const text = (p, id, value, x, y, width, height = 32, fontSize = 16, foreground = color.ink, fontWeight = 400) => add(p, 'text', { id, name: value.slice(0, 30) || id, text: value, x, y, width, height, style: { fontSize, color: foreground, fontWeight } });
  const event = (actions, extra = {}) => ({ event: 'click', actions, ...extra });
  const action = (type, targetId, value) => ({ type, targetId, value });
  const expr = (op, ...args) => ({ op, args });
  const variable = name => ({ op: 'var', name });
  const valueOf = (nodeId, property = 'value') => ({ op: 'node', nodeId, property });
  const item = column => ({ op: 'item', column });
  const button = (p, id, label, x, y, width, actions, secondary = false) => add(p, 'button', { id, name: label, text: label, x, y, width, height: 40,
    style: { fill: secondary ? color.paper : color.ink, color: secondary ? color.ink : color.paper, stroke: secondary ? color.lineStrong : color.ink, strokeWidth: 1, radius: 4, fontWeight: 500 },
    stateStyles: { hover: { fill: secondary ? color.wash : '#333333' }, focus: { stroke: color.ink, strokeWidth: 2 } }, interactions: [event(actions)] });

  box(page, 'home-header', 0, 0, 1200, 82, color.paper, 0);
  text(page, 'home-logo', '原搭', 48, 24, 220, 36, 25, color.ink, 600);
  text(page, 'home-nav', '一个可以编辑、保存和带走的交互示例', 710, 27, 440, 30, 15, color.muted);
  text(page, 'home-kicker', '原型体验 / 01', 64, 141, 640, 30, 14, color.subtle, 500);
  text(page, 'home-title', '把一个页面，\n变成可以操作的体验。', 60, 191, 660, 154, 42, color.ink, 600);
  text(page, 'home-desc', '点击“预约体验”，试一遍弹窗、输入与完成反馈。\n你也可以打开工作台，继续体验状态切换和数据列表。', 64, 368, 630, 72, 17, color.muted);
  const open = button(page, 'home-open', '预约体验', 64, 470, 180, []); open.height = 48;
  const toDashboard = button(page, 'home-dashboard', '查看工作台', 264, 470, 172, [{ type: 'navigate', pageId: dashboard.id }], true); toDashboard.height = 48;
  box(page, 'preview-card', 724, 150, 388, 388);
  text(page, 'preview-label', '示例图表 / 本周完成项', 756, 180, 320, 30, 16, color.muted, 500);
  text(page, 'preview-value', '24', 756, 224, 280, 66, 48, color.ink, 600);
  text(page, 'preview-sub', '演示数据，供你尝试调整外观', 756, 300, 324, 30, 14, color.subtle);
  box(page, 'preview-shadow', 756, 345, 324, 1, color.line, 0, false);
  [88, 134, 108, 152, 174, 146, 194].forEach((height, index) => box(page, `preview-bar-${index}`, 758 + index * 44, 508 - height * .65, 26, height * .65, index === 6 ? color.ink : color.bar, 4, false));
  const features = [['01', '修改内容', '在编辑器里双击文字，输入你的内容'], ['02', '预览行为', '预览后点按钮，检查页面跳转与反馈'], ['03', '保存与导出', '保存项目，再导出可离线打开的 HTML']];
  features.forEach(([number, title, description], index) => {
    const x = 64 + index * 365;
    box(page, `feature-card-${index}`, x, 610, 342, 146);
    text(page, `feature-no-${index}`, number, x + 22, 628, 58, 28, 14, color.subtle, 500);
    text(page, `feature-title-${index}`, title, x + 22, 667, 290, 30, 20, color.ink, 500);
    text(page, `feature-desc-${index}`, description, x + 22, 709, 300, 25, 13, color.muted);
  });
  const modal = [];
  modal.push(box(page, 'modal-shade', 0, 0, 1200, 820, color.shade, 0, false));
  modal.push(box(page, 'modal-card', 370, 208, 460, 382));
  modal.push(text(page, 'modal-title', '预约一次产品体验', 406, 242, 382, 42, 26, color.ink, 500));
  modal.push(text(page, 'modal-hint', '输入称呼，点击确认，观察等待与完成提示。', 406, 300, 382, 34, 15, color.muted));
  modal.push(add(page, 'input', { id: 'modal-input', name: '称呼输入框', text: '怎么称呼你？', x: 406, y: 355, width: 388, height: 48 }));
  modal.push(text(page, 'modal-status', '这是本地演示，不会提交个人信息。', 406, 421, 388, 42, 14, color.subtle));
  const submit = button(page, 'modal-submit', '确认预约', 406, 493, 246, []); submit.height = 48; modal.push(submit);
  const close = button(page, 'modal-close', '关闭', 670, 493, 124, [], true); close.height = 48; modal.push(close);
  modal.forEach(node => { node.visible = false; });
  open.interactions = [event([action('setText', 'modal-status', '这是本地演示，不会提交个人信息。'), ...modal.map(node => action('setVisible', node.id, true))])];
  close.interactions = [event(modal.map(node => action('setVisible', node.id, false)))];
  submit.interactions = [event([action('setText', 'modal-status', '正在确认，请稍候…'), { type: 'wait', ms: 900 }, action('setText', 'modal-status', '预约成功。现在可以关闭弹窗，继续体验。')])];

  box(dashboard, 'dash-side', 0, 0, 228, 820, color.wash, 0);
  text(dashboard, 'dash-logo', '原搭', 32, 28, 170, 42, 25, color.ink, 600);
  box(dashboard, 'dash-selected', 20, 123, 188, 48, color.selected, 4, false);
  text(dashboard, 'dash-menu', '体验工作台', 38, 133, 156, 30, 16, color.ink, 500);
  text(dashboard, 'dash-menu2', '从页面开始\n\n查看可操作的例子\n\n再回到编辑器修改', 38, 198, 162, 140, 14, color.muted);
  text(dashboard, 'dash-title', '从这里继续试玩', 272, 45, 520, 54, 32, color.ink, 600);
  text(dashboard, 'dash-sub', '这些内容都是示例。打开交互实验室，亲手修改输入、状态与列表。', 272, 107, 850, 34, 16, color.muted);
  [['示例页面', '03', '预约、工作台与交互实验室'], ['操作方式', '直接点击', '输入、切换、计数、筛选和排序'], ['文件在本地', '可保存', '项目可继续编辑，HTML 可直接打开']].forEach(([label, value, hint], index) => {
    const x = 272 + index * 294;
    box(dashboard, `dash-card-${index}`, x, 181, 270, 160);
    text(dashboard, `dash-label-${index}`, label, x + 24, 201, 230, 28, 15, color.subtle);
    text(dashboard, `dash-value-${index}`, value, x + 24, 241, 230, 54, index ? 30 : 38, color.ink, 600);
    text(dashboard, `dash-hint-${index}`, hint, x + 24, 303, 238, 24, 12, color.muted);
  });
  box(dashboard, 'dash-chart', 272, 369, 858, 326);
  text(dashboard, 'dash-chart-title', '每周完成项 / 演示数据', 302, 393, 500, 34, 20, color.ink, 500);
  [64, 96, 84, 135, 118, 157, 180].forEach((height, index) => {
    box(dashboard, `dash-bar-${index}`, 326 + index * 110, 639 - height, 56, height, index === 6 ? color.ink : color.bar, 4, false);
    text(dashboard, `dash-day-${index}`, `周${['一', '二', '三', '四', '五', '六', '日'][index]}`, 326 + index * 110, 651, 56, 25, 13, color.subtle);
  });
  button(dashboard, 'dash-back', '返回产品页', 272, 730, 190, [{ type: 'navigate', pageId: page.id }], true);
  button(dashboard, 'dash-lab', '打开交互实验室', 486, 730, 220, [{ type: 'navigate', pageId: lab.id }]);

  doc.variables = [{ name: 'demoCount', type: 'number', value: 0 }, { name: 'demoName', type: 'string', value: '' }, { name: 'demoPurpose', type: 'string', value: '产品设计' }];
  text(lab, 'lab-kicker', '原型体验 / 03', 40, 28, 340, 26, 13, color.subtle, 500);
  text(lab, 'lab-title', '交互实验室', 40, 66, 700, 48, 32, color.ink, 600);
  text(lab, 'lab-subtitle', '这里的按钮和输入都能操作。体验结果仅留在当前预览，点击顶部“重新体验”即可重置。', 40, 120, 1110, 28, 15, color.muted);
  box(lab, 'lab-panel-card', 40, 168, 540, 280);
  text(lab, 'lab-panel-title', '01  切换同一个区域的内容', 64, 186, 490, 32, 19, color.ink, 500);
  button(lab, 'lab-state-overview', '显示概览', 64, 232, 150, [{ type: 'setPanelState', panelId: 'lab-panel', stateId: 'lab-state-a' }], true);
  button(lab, 'lab-state-detail', '显示详情', 226, 232, 150, [{ type: 'setPanelState', panelId: 'lab-panel', stateId: 'lab-state-b' }], true);
  add(lab, 'dynamicPanel', { id: 'lab-panel', name: '状态演示区域', x: 64, y: 288, width: 492, height: 132, style: { fill: color.wash, stroke: color.line, strokeWidth: 1, radius: 4 }, panel: { states: [{ id: 'lab-state-a', name: '概览', nodeIds: ['lab-panel-a-title', 'lab-panel-a-description'] }, { id: 'lab-state-b', name: '详情', nodeIds: ['lab-panel-b-title', 'lab-panel-b-description'] }], initialStateId: 'lab-state-a', clip: true } });
  text(lab, 'lab-panel-a-title', '当前是概览', 82, 302, 446, 32, 20, color.ink, 500);
  text(lab, 'lab-panel-a-description', '点击“显示详情”，这块区域会换成另一组内容。', 82, 346, 446, 48, 15, color.muted);
  text(lab, 'lab-panel-b-title', '已经切换到详情', 82, 302, 446, 32, 20, color.ink, 500);
  text(lab, 'lab-panel-b-description', '页面没有跳走。这个区域使用同一位置展示两个状态。', 82, 346, 446, 48, 15, color.muted);

  box(lab, 'lab-form-card', 620, 168, 540, 280);
  text(lab, 'lab-form-title', '02  填表后给出确认反馈', 644, 186, 490, 32, 19, color.ink, 500);
  text(lab, 'lab-name-label', '你的称呼', 644, 230, 230, 24, 13, color.subtle);
  text(lab, 'lab-purpose-label', '使用场景', 900, 230, 236, 24, 13, color.subtle);
  add(lab, 'input', { id: 'lab-name', name: '实验室称呼输入', text: '例如：小原', x: 644, y: 260, width: 240, height: 38, bindings: { value: variable('demoName') }, interactions: [{ event: 'input', actions: [{ type: 'setVariable', name: 'demoName', value: { op: 'event', name: 'value' } }] }] });
  add(lab, 'select', { id: 'lab-purpose', name: '使用场景选择', x: 900, y: 260, width: 236, height: 38, value: '产品设计', options: ['产品设计', '需求评审', '交互测试'], interactions: [{ event: 'change', actions: [{ type: 'setVariable', name: 'demoPurpose', value: { op: 'event', name: 'value' } }] }] });
  add(lab, 'checkbox', { id: 'lab-consent', name: '确认本地演示', text: '仅在这个本地示例中显示我的输入', x: 644, y: 310, width: 490, height: 30, style: { strokeWidth: 0 } });
  const formSubmit = button(lab, 'lab-form-submit', '确认填写', 644, 350, 140, []);
  formSubmit.interactions = [event([action('setText', 'lab-form-result', expr('concat', '已记录：', variable('demoName'), ' / ', variable('demoPurpose')))], { condition: expr('and', expr('gt', expr('length', variable('demoName')), 0), valueOf('lab-consent', 'checked')) }), event([action('setText', 'lab-form-result', '请填写称呼，并勾选上面的确认选项。')], { caseMode: 'else' })];
  text(lab, 'lab-form-result', '填写、勾选后点击确认，不会向外发送数据。', 644, 399, 492, 30, 14, color.muted);

  box(lab, 'lab-counter-card', 40, 476, 420, 510);
  text(lab, 'lab-counter-title', '03  计数与条件判断', 64, 496, 360, 32, 19, color.ink, 500);
  text(lab, 'lab-counter-help', '每次点击增加 1。达到 3 次后，\n检查按钮会给出不同的结果。', 64, 542, 360, 56, 15, color.muted);
  const count = text(lab, 'lab-count', '0', 64, 610, 300, 74, 56, color.ink, 600); count.bindings = { text: variable('demoCount') };
  button(lab, 'lab-add-count', '增加 1 次', 64, 704, 150, [{ type: 'setVariable', name: 'demoCount', value: expr('add', variable('demoCount'), 1) }]);
  button(lab, 'lab-reset-count', '归零', 226, 704, 150, [{ type: 'setVariable', name: 'demoCount', value: 0 }, action('setText', 'lab-counter-result', '已归零。再点击增加按钮试试。')], true);
  const condition = button(lab, 'lab-check-count', '检查是否达到 3 次', 64, 764, 312, [], true);
  condition.interactions = [event([action('setText', 'lab-counter-result', '已经达到 3 次，可以继续。')], { condition: expr('gte', variable('demoCount'), 3) }), event([action('setText', 'lab-counter-result', expr('concat', '还差 ', expr('sub', 3, variable('demoCount')), ' 次，请继续点击。'))], { caseMode: 'else' })];
  text(lab, 'lab-counter-result', '先点击增加按钮，再检查结果。', 64, 826, 360, 68, 16, color.muted);
  text(lab, 'lab-counter-note', '这个数字由一个变量保存，\n按钮按当前数值决定显示哪句话。', 64, 920, 360, 44, 13, color.subtle);

  box(lab, 'lab-data-card', 500, 476, 660, 510);
  text(lab, 'lab-data-title', '04  排序、筛选与新增列表项', 524, 496, 600, 32, 19, color.ink, 500);
  button(lab, 'lab-data-sort', '按优先级排序', 524, 542, 146, [{ type: 'sortRows', repeaterId: 'lab-list', column: 'priority', descending: false }, action('setText', 'lab-data-status', '已按优先级从小到大排序。')], true);
  button(lab, 'lab-data-filter', '只看优先级 2 以上', 682, 542, 174, [{ type: 'filterRows', repeaterId: 'lab-list', where: expr('gte', item('priority'), 2) }, action('setText', 'lab-data-status', '正在显示优先级大于或等于 2 的项目。')], true);
  button(lab, 'lab-data-reset', '显示全部', 868, 542, 126, [{ type: 'filterRows', repeaterId: 'lab-list', where: null }, action('setText', 'lab-data-status', '已显示全部项目。')], true);
  add(lab, 'input', { id: 'lab-new-item', name: '新增列表项输入', text: '输入一件你要完成的事', x: 524, y: 598, width: 348, height: 38 });
  const addItem = button(lab, 'lab-data-add', '加入列表', 884, 598, 150, []); addItem.height = 38;
  addItem.interactions = [event([{ type: 'addRows', repeaterId: 'lab-list', rows: [{ values: { title: valueOf('lab-new-item'), priority: 4 } }] }, action('setValue', 'lab-new-item', ''), action('setText', 'lab-data-status', '已加入列表，新项目的优先级为 4。')], { condition: expr('gt', expr('length', valueOf('lab-new-item')), 0) }), event([action('setText', 'lab-data-status', '请先输入一件要完成的事。')], { caseMode: 'else' })];
  add(lab, 'repeater', { id: 'lab-list', name: '可操作的任务列表', x: 524, y: 654, width: 612, height: 256, style: { strokeWidth: 0 }, repeater: { columns: [{ key: 'title', label: '任务', type: 'string' }, { key: 'priority', label: '优先级', type: 'number' }], rows: [{ id: 'lab-row-structure', values: { title: '整理页面层级', priority: 3 } }, { id: 'lab-row-notes', values: { title: '填写元件注释', priority: 1 } }, { id: 'lab-row-actions', values: { title: '连接页面交互', priority: 2 } }], templateIds: ['lab-row-card', 'lab-row-title', 'lab-row-priority'], itemWidth: 612, itemHeight: 54, layout: 'vertical', gap: 10, columnsCount: 1, filter: null, sort: null } });
  box(lab, 'lab-row-card', 524, 654, 612, 54, color.wash, 4);
  const rowTitle = text(lab, 'lab-row-title', '', 540, 665, 430, 32, 15); rowTitle.bindings = { text: item('title') };
  const rowPriority = text(lab, 'lab-row-priority', '', 990, 665, 128, 32, 13, color.subtle); rowPriority.bindings = { text: expr('concat', '优先级 ', item('priority')) };
  text(lab, 'lab-data-status', '默认有 3 项。新增、筛选、排序都会真正改变这个列表。', 524, 928, 606, 40, 14, color.muted);
  button(lab, 'lab-back', '返回工作台', 40, 1002, 160, [{ type: 'navigate', pageId: dashboard.id }], true);
  text(lab, 'lab-footer', '这些行为也会随 HTML 一起导出。回到编辑器可修改元件、数据和交互。', 226, 1007, 900, 30, 13, color.subtle);
  doc.pages = [page, dashboard, lab]; const normalized = normalizeDesignProject(doc); validateProject(normalized); return normalized;
}

function projectPageFor(project, pageId) { const page = project.pages.find(item => item.id === pageId); if (!page) fail(`找不到页面：${pageId}`, 'COMMAND_ERROR'); return page; }
function nodeFor(page, nodeId) { const node = page.nodes.find(item => item.id === nodeId); if (!node) fail(`找不到元件：${nodeId}`, 'COMMAND_ERROR'); return node; }
function cleanReferences(project, removedNodes = new Set(), removedPages = new Set()) {
  for (const page of [...project.pages, ...project.components]) for (const node of page.nodes) for (const interaction of node.interactions) {
    interaction.actions = interaction.actions.filter(action => !removedNodes.has(action.targetId) && !removedPages.has(action.pageId));
  }
  cleanInteractionReferences(project, { nodeIds: removedNodes, pageIds: removedPages, stateIds: removedNodes });
}
/** 母版画布仅开放局部编辑命令；不能嵌套命令包、修改全局设置或把目标改成其他画布。 */
export const COMPONENT_EDIT_COMMANDS = Object.freeze([
  ...IMAGE_COMMANDS,
  'clearStyleOverrides','applyStyleSnapshot','updateStyleFromNode','setNodeDefaultStyleSet',
  'viewCommands','moveNodes','setNodesPlaced','setComponentInstanceView','setViewOverride','clearViewOverride','clearInstanceViewOverride',
  'duplicatePanelState','reorderPanelState','setPanelOptions','insertLibraryItem',
  'reparentItems','groupItems','resizeGroup','setRepeaterPagination','setRepeaterMarks','importRepeaterData',
  'addNode', 'updateNode', 'removeNodes', 'reorderNode', 'duplicateNodes', 'pasteFragment', 'updatePage', 'setPageGuides', 'applyStyle',
  'groupNodes', 'ungroup', 'moveGroup', 'lockGroup', 'insertComponent', 'detachComponent', 'setComponentOverride', 'clearComponentOverride',
  'createDynamicPanel', 'createRepeater', 'addPanelState', 'updatePanelState', 'assignPanelNodes', 'removePanelState', 'setInitialPanelState', 'moveContainer',
  'setRepeaterData', 'addRepeaterRows', 'updateRepeaterRow', 'removeRepeaterRows', 'setRepeaterTemplate', 'setRepeaterFilter', 'setRepeaterSort'
]);
function applyCommand(project,command,componentId=null){const before=command?.type==='componentCommands'?null:captureOwnership(project);const result=applyCommandUnchecked(project,command,componentId);if(before)guardOwnershipChanges(before,project,fail);return result;}
function applyCommandUnchecked(project, command, componentId = null) {
  object(command, '命令');
  if (command.type === 'componentCommands') {
    if (componentId !== null) fail('母版命令不能递归嵌套', 'COMMAND_ERROR');
    keys(command, ['type', 'componentId', 'commands'], '母版画布命令'); id(command.componentId, '母版 ID'); array(command.commands, '母版编辑批次', 1000);
    if (!project.components.some(component => component.id === command.componentId)) fail('母版不存在', 'COMMAND_ERROR');
    for (const child of command.commands) {
      object(child, '母版子命令');
      if (!COMPONENT_EDIT_COMMANDS.includes(child.type)) fail(`母版画布不支持命令：${String(child.type)}`, 'COMMAND_ERROR');
      for (const field of ['pageId', 'targetPageId']) if (Object.hasOwn(child, field) && child[field] !== command.componentId) fail('母版命令不能操作其他画布', 'COMMAND_ERROR');
      applyCommand(project, { ...clone(child), pageId: command.componentId }, command.componentId);
    }
    return;
  }
  const pageFor = componentId === null ? projectPageFor : (current, requested) => {
    if (requested !== componentId) fail('母版命令不能操作其他画布', 'COMMAND_ERROR');
    const component = current.components.find(item => item.id === componentId); if (!component) fail('母版不存在', 'COMMAND_ERROR'); return component;
  };
  const designHelpers = { fail, object, keys, string, number, bool, array, id, uuid, validateStyle, STYLE_KEYS, NODE_KEYS, makeNode, pageFor, nodeFor, cleanReferences, getNodeInternalIds };
  designHelpers.assertEditable = (page, node, patch) => assertNodeEditable(page, node, patch, designHelpers);
  designHelpers.translateNodes = (page, ids, dx, dy) => translateNodes(page, ids, dx, dy, designHelpers);
  if (applyViewCommands(project, command, {
    ...designHelpers,
    apply: (draft, child) => applyCommand(draft, child, componentId),
    settle: draft => { const normalized = normalizeDesignProject(draft); validateStyleInheritance(normalized,{keys,string,number,bool,array,id,fail,validateStyle}); reconcileDesignProject(normalized, { uuid, cleanReferences, fail, array, keys, string }); reconcileVectorProject(normalized); Object.assign(draft, normalized); }
  })) return;
  if (applyLibraryCommand(project, command, { uuid, createBlankProject, validateProject })) return;
  if (applyImageCommand(project, command, designHelpers)) return;
  if (applyPageTreeCommand(project, command, designHelpers)) return;
  if (applyInteractionCommand(project, command, designHelpers)) return;
  if (applyDesignCommand(project, command, designHelpers)) return;
  switch (command.type) {
    case 'moveNodes': {
      keys(command, ['type','pageId','nodeIds','dx','dy'], '平移元件命令'); array(command.nodeIds, '移动元件', 5000);
      number(command.dx, '移动 X', -100000, 100000); number(command.dy, '移动 Y', -100000, 100000);
      const page = pageFor(project, command.pageId); for (const id of command.nodeIds) nodeFor(page, id);
      translateNodes(page, command.nodeIds, command.dx, command.dy, designHelpers); break;
    }
    case 'addNode': keys(command, ['type', 'pageId', 'node'], '添加元件命令'); object(command.node, '元件'); pageFor(project, command.pageId).nodes.push(makeNode(command.node.type, command.node)); break;
    case 'updateNode': {
      keys(command, ['type', 'pageId', 'nodeId', 'patch'], '修改元件命令'); keys(command.patch, NODE_KEYS.filter(key => key !== 'id'), '元件修改', false);
      const page = pageFor(project, command.pageId), node = nodeFor(page, command.nodeId);
      assertNodeEditable(page, node, command.patch, designHelpers);
      const patch = clone(command.patch);
      prepareImageNodePatch(node,patch);
      if (node.panel && (Object.hasOwn(patch, 'width') || Object.hasOwn(patch, 'height'))) patch.panel = { ...node.panel, ...patch.panel, sizeMode: 'fixed' };
      if (Object.hasOwn(patch, 'text') && !Object.hasOwn(patch, 'richText')) patch.richText = null;
      if (Object.hasOwn(patch, 'style')) { keys(patch.style, STYLE_KEYS, '样式修改', false); patch.style = { ...node.style, ...patch.style }; patch.styleOverrideKeys = [...new Set([...node.styleOverrideKeys,...Object.keys(command.patch.style)])]; }
      page.nodes[page.nodes.indexOf(node)] = { ...node, ...patch }; sharedTextCleanup(project, page, command); break;
    }
    case 'removeNodes': {
      keys(command, ['type', 'pageId', 'nodeIds'], '删除元件命令'); array(command.nodeIds, '元件 ID', 5000);
      const page = pageFor(project, command.pageId); for (const nodeId of command.nodeIds) nodeFor(page, nodeId);
      let expanded = new Set(command.nodeIds), changed = true;
      while (changed) {
        const before = expanded.size; for (const nodeId of [...expanded]) for (const child of getNodeDescendants(page.nodes, nodeId)) expanded.add(child);
        for (const group of page.groups) if (group.componentId && group.nodeIds.some(id => expanded.has(id))) for (const id of group.nodeIds) expanded.add(id);
        expanded = new Set(expandVectorRemoval(page.nodes, expanded)); changed = before !== expanded.size;
      }
      const removed = prepareNodeRemoval(page, [...expanded], designHelpers); for (const id of getNodeInternalIds(page.nodes.filter(node => removed.has(node.id)))) removed.add(id);
      page.nodes = page.nodes.filter(node => !removed.has(node.id)); cleanReferences(project, removed); break;
    }
    case 'addPage': {
      keys(command, ['type', 'page'], '添加页面命令'); keys(command.page, PAGE_KEYS, '页面设置', false);
      const page = { id: uuid(), name: `页面 ${project.pages.length + 1}`, width: 1200, height: 800, background: '#FFFFFF', nodes: [], parentId: null, guides: { horizontal: [], vertical: [] }, groups: [], annotation: '', views: [], interactions: [], ...clone(command.page) };
      if (Array.isArray(page.nodes)) page.nodes = page.nodes.map(node => makeNode(node.type, node));
      project.pages.push(page); appendPageTreeEntry(project, page.id); break;
    }
    case 'updatePage': {
      if (componentId !== null) {
        keys(command, ['type', 'pageId', 'patch'], '修改母版画布命令'); keys(command.patch, ['name', 'width', 'height', 'background', 'annotation', 'guides'], '母版画布修改', false);
        Object.assign(pageFor(project, command.pageId), clone(command.patch)); break;
      }
      keys(command, ['type', 'pageId', 'patch'], '修改页面命令'); keys(command.patch, PAGE_KEYS.filter(key => key !== 'id'), '页面修改', false);
      const page = pageFor(project, command.pageId);
      if (Object.hasOwn(command.patch, 'groups')) fail('请使用分组或组件命令修改元件组', 'COMMAND_ERROR');
      if (Object.hasOwn(command.patch, 'nodes')) {
        array(command.patch.nodes, '元件', 5000);
        for (const node of page.nodes) {
          const next = command.patch.nodes.find(item => item.id === node.id);
          if (JSON.stringify(node) !== JSON.stringify(next)) assertNodeEditable(page, node, next, designHelpers);
        }
      }
      project.pages[project.pages.indexOf(page)] = { ...page, ...clone(command.patch) }; break;
    }
    case 'removePage': {
      keys(command, ['type', 'pageId'], '删除页面命令'); const removedPage = pageFor(project, command.pageId);
      if (project.pages.length === 1) fail('不能删除最后一个页面', 'COMMAND_ERROR');
      for (const item of [...project.pages, ...project.pageFolders]) if (item.parentId === command.pageId) item.parentId = removedPage.parentId;
      project.pages = project.pages.filter(page => page.id !== command.pageId); removePageTreeEntries(project, new Set([command.pageId]));
      cleanReferences(project, new Set([...removedPage.nodes.map(node => node.id), ...getNodeInternalIds(removedPage.nodes)]), new Set([command.pageId])); break;
    }
    case 'reorderNode': {
      keys(command, ['type', 'pageId', 'nodeId', 'index'], '调整图层命令'); const page = pageFor(project, command.pageId), node = nodeFor(page, command.nodeId);
      assertNodeEditable(page, node, null, designHelpers);
      if (!Number.isInteger(command.index) || command.index < 0 || command.index >= page.nodes.length) fail('图层位置超出范围', 'COMMAND_ERROR');
      page.nodes.splice(page.nodes.indexOf(node), 1); page.nodes.splice(command.index, 0, node); break;
    }
    case 'renameProject': keys(command, ['type', 'name'], '重命名命令'); project.name = command.name; break;
    default: fail(`不支持的命令：${String(command.type)}`, 'COMMAND_ERROR');
  }
}

export class DocumentEngine {
  #project; #undo = []; #redo = []; #revision = 0;
  constructor(project = createBlankProject()) { const normalized = normalizeDesignProject(project); validateProject(normalized); reconcileDesignProject(normalized,{uuid,cleanReferences,fail,array,keys,string}); validateProject(normalized); this.#project = normalized; }
  get revision() { return this.#revision; }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  getSnapshot() { return clone(this.#project); }
  apply(commands, options = {}) {
    object(options, '命令选项');
    if (options.expectedRevision !== undefined && options.expectedRevision !== this.#revision) fail(`项目已变化：期待版本 ${options.expectedRevision}，当前版本 ${this.#revision}。请重新读取项目后再修改。`, 'REVISION_CONFLICT');
    array(commands, '命令批次', 1000);
    if (!commands.length) return this.getSnapshot();
    let operationCount = 0;
    const countOperations = (batch, depth = 0) => {
      if (depth > 2) fail('编辑命令包嵌套过深', 'COMMAND_ERROR');
      for (const command of batch) {
        if (command?.type === 'componentCommands' || command?.type === 'viewCommands') { array(command.commands, '编辑批次', 1000); countOperations(command.commands, depth + 1); }
        else operationCount++;
        if (operationCount > 1000) fail('一次事务最多 1000 项实际编辑操作', 'COMMAND_ERROR');
      }
    };
    countOperations(commands);
    let draft = clone(this.#project);
    for (const command of commands) { applyCommand(draft, command); draft = normalizeDesignProject(draft); validateStyleInheritance(draft,{keys,string,number,bool,array,id,fail,validateStyle}); reconcileDesignProject(draft, { uuid, cleanReferences, fail, array, keys, string }); reconcileVectorProject(draft); }
    const normalized = normalizeDesignProject(draft);
    validateProject(normalized);
    if (JSON.stringify(normalized) === JSON.stringify(this.#project)) return this.getSnapshot();
    this.#undo.push(this.#project); if (this.#undo.length > 80) this.#undo.shift();
    this.#project = normalized; this.#redo = []; this.#revision++; return this.getSnapshot();
  }
  undo() { if (!this.canUndo) return this.getSnapshot(); this.#redo.push(this.#project); this.#project = this.#undo.pop(); this.#revision++; return this.getSnapshot(); }
  redo() { if (!this.canRedo) return this.getSnapshot(); this.#undo.push(this.#project); this.#project = this.#redo.pop(); this.#revision++; return this.getSnapshot(); }
  replace(project) { const normalized = normalizeDesignProject(project); validateProject(normalized); reconcileDesignProject(normalized,{uuid,cleanReferences,fail,array,keys,string}); validateProject(normalized); this.#project = normalized; this.#undo = []; this.#redo = []; this.#revision++; return this.getSnapshot(); }
}
