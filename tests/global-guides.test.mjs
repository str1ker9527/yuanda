import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createBlankProject, makeNode, DocumentEngine, normalizeProject, validateProject, COMPONENT_EDIT_COMMANDS } from '../app/core/document.mjs';
import { canvasGuideSets } from '../app/core/guide-model.mjs';
import { VIEW_EDIT_COMMANDS } from '../app/core/view-commands.mjs';
import { resolveContainerView } from '../app/core/view-model.mjs';
import { exportHtml } from '../app/core/html-export.mjs';
import { exportRp, getRpExportStatus } from '../app/core/rp-export.mjs';
import { schema } from '../app/agent-schema.mjs';

const empty = () => ({ horizontal: [], vertical: [] });
const projectGuides = guides => ({ type: 'setProjectGuides', guides });
const pageGuides = (guides, pageId = 'home') => ({ type: 'setPageGuides', pageId, guides });
const guidesOf = (engine, pageId = 'home') => engine.getSnapshot().pages.find(page => page.id === pageId).guides;
const smallView = { id: 'small', name: '窄屏', minWidth: 0, width: 390, height: 844 };

function projectFixture() {
  const project = createBlankProject('全局参考线测试');
  project.id = 'guides-project'; project.pages[0].id = 'home';
  project.pages[0].nodes = [makeNode('rectangle', { id: 'box', text: '正文元件', x: 40, y: 60 })];
  return project;
}

function extendedFixture() {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([
    { type: 'addPage', page: { id: 'other', name: '另一页', nodes: [makeNode('text', { id: 'other-label', text: '第二页正文' })] } },
    { type: 'addComponent', component: { id: 'master', name: '独立母版', nodes: [makeNode('text', { id: 'master-label', text: '母版正文' })] } },
    { type: 'addAdaptiveView', pageId: 'home', view: smallView }
  ]);
  return engine;
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function assertRejectedWithoutChange(engine, commands, code = 'VALIDATION_ERROR', options = {}) {
  const before = engine.getSnapshot(), revision = engine.revision, canUndo = engine.canUndo, canRedo = engine.canRedo;
  assert.throws(() => engine.apply(commands, options), { code });
  assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, revision);
  assert.equal(engine.canUndo, canUndo); assert.equal(engine.canRedo, canRedo);
}

// The old page-guide contract and the project-guide contract must reject the
// same malformed values through both document loading and ordinary commands.
function rejectsInBothScopes(value, label) {
  for (const scope of ['project', 'page']) {
    const project = projectFixture();
    if (scope === 'project') project.globalGuides = structuredClone(value);
    else project.pages[0].guides = structuredClone(value);
    const original = structuredClone(project);
    assert.throws(() => validateProject(project), { code: 'VALIDATION_ERROR' }, `${label}: ${scope} validation`);
    assert.throws(() => new DocumentEngine(project), { code: 'VALIDATION_ERROR' }, `${label}: ${scope} loading`);
    assert.deepEqual(project, original, `${label}: validation cannot repair the input`);
    const engine = new DocumentEngine(projectFixture());
    assertRejectedWithoutChange(engine, [scope === 'project' ? projectGuides(value) : pageGuides(value)]);
  }
}

test('旧文档缺省为空全局线，规范化、校验和打开均不修改输入或与页面默认值共享数组', () => {
  const legacy = projectFixture(); delete legacy.globalGuides; delete legacy.pages[0].guides;
  const before = structuredClone(legacy); freeze(legacy);
  assert.equal(validateProject(legacy), true);
  const normalized = normalizeProject(legacy), engine = new DocumentEngine(legacy), snapshot = engine.getSnapshot();
  assert.deepEqual(legacy, before); assert.equal(Object.hasOwn(legacy, 'globalGuides'), false);
  assert.deepEqual(normalized.globalGuides, empty()); assert.deepEqual(snapshot.globalGuides, empty());
  assert.deepEqual(snapshot.pages[0].guides, empty()); assert.deepEqual(snapshot, normalized);
  assert.notStrictEqual(normalized.globalGuides, normalized.pages[0].guides);
  assert.notStrictEqual(normalized.globalGuides.horizontal, normalized.pages[0].guides.horizontal);
  normalized.globalGuides.horizontal.push(1); assert.deepEqual(normalized.pages[0].guides, empty());
  assert.deepEqual(engine.getSnapshot().globalGuides, empty());
});

test('全局线和页面线同样拒绝错误形状、缺轴、额外字段和非数组轴，不悄悄补正显式值', () => {
  const invalid = [undefined, null, false, 1, 'bad', [], {}, { horizontal: [] }, { vertical: [] },
    { horizontal: [], vertical: [], diagonal: [] }, { horizontal: null, vertical: [] },
    { horizontal: {}, vertical: [] }, { horizontal: [], vertical: '1,2' },
    { horizontal: new Uint16Array([1, 2]), vertical: [] }];
  invalid.forEach((value, index) => rejectsInBothScopes(value, `shape ${index}`));
});

test('两种作用域都拒绝 NaN、正负 Infinity、字符串、空值、布尔、嵌套对象及稀疏坐标', () => {
  for (const value of [NaN, Infinity, -Infinity, '12', null, false, {}, []]) {
    for (const axis of ['horizontal', 'vertical']) rejectsInBothScopes({ ...empty(), [axis]: [value] }, `${axis}: ${String(value)}`);
  }
  rejectsInBothScopes({ horizontal: new Array(2), vertical: [] }, 'sparse axis');
});

test('两种作用域都拒绝越界、同轴重复、正负零重复和任一轴 501 条，失败不新增历史', () => {
  for (const axis of ['horizontal', 'vertical']) {
    for (const values of [[-100000.001], [100000.001], [12, 12], [0, -0], Array.from({ length: 501 }, (_, index) => index)]) {
      rejectsInBothScopes({ ...empty(), [axis]: values }, `${axis}: range, duplicate or limit`);
    }
  }
});

test('每个轴接受恰好 500 个独立有限坐标，含边界、负数和小数；跨轴相同坐标合法', () => {
  const axis = [-100000, 100000, -0.125, 0, ...Array.from({ length: 496 }, (_, index) => index + 0.5)];
  assert.equal(axis.length, 500);
  const guides = { horizontal: [...axis], vertical: [...axis] }, engine = new DocumentEngine(projectFixture());
  engine.apply([projectGuides(guides), pageGuides(guides)], { expectedRevision: 0 });
  const snapshot = engine.getSnapshot(); assert.equal(validateProject(snapshot), true);
  assert.deepEqual(snapshot.globalGuides, guides); assert.deepEqual(snapshot.pages[0].guides, guides);
  assert.equal(engine.revision, 1);
});

test('setProjectGuides 全量替换双轴且防止输入和返回快照引用泄漏，命令不接受 pageId 或 patch', () => {
  const engine = new DocumentEngine(projectFixture()), first = { horizontal: [10, 20], vertical: [30, 40] };
  engine.apply([projectGuides(first)]); first.horizontal.push(999);
  assert.deepEqual(engine.getSnapshot().globalGuides, { horizontal: [10, 20], vertical: [30, 40] });
  const replacement = { horizontal: [7.5], vertical: [] }, result = engine.apply([projectGuides(replacement)]);
  assert.deepEqual(result.globalGuides, replacement); assert.deepEqual(guidesOf(engine), empty());
  result.globalGuides.vertical.push(123); replacement.horizontal.push(456);
  assert.deepEqual(engine.getSnapshot().globalGuides, { horizontal: [7.5], vertical: [] });
  assertRejectedWithoutChange(engine, [{ type: 'setProjectGuides' }], 'COMMAND_ERROR');
  for (const command of [{ ...projectGuides(empty()), pageId: 'home' }, { type: 'setProjectGuides', patch: empty() }]) {
    assertRejectedWithoutChange(engine, [command]);
  }
});

test('项目线和元件、页面线可组成一个撤销批次，undo/redo 递增 revision 且旧 expectedRevision 被拒绝', () => {
  const engine = new DocumentEngine(projectFixture()), before = engine.getSnapshot();
  engine.apply([
    projectGuides({ horizontal: [50], vertical: [60] }), pageGuides({ horizontal: [70], vertical: [] }),
    { type: 'updateNode', pageId: 'home', nodeId: 'box', patch: { text: '同批修改' } }
  ], { expectedRevision: 0 });
  const changed = engine.getSnapshot(); assert.equal(engine.revision, 1);
  assertRejectedWithoutChange(engine, [projectGuides(empty())], 'REVISION_CONFLICT', { expectedRevision: 0 });
  assert.deepEqual(engine.undo(), before); assert.equal(engine.revision, 2); assert.equal(engine.canUndo, false); assert.equal(engine.canRedo, true);
  assertRejectedWithoutChange(engine, [projectGuides(empty())], 'REVISION_CONFLICT', { expectedRevision: 1 });
  assert.deepEqual(engine.redo(), changed); assert.equal(engine.revision, 3); assert.equal(engine.canRedo, false);
  engine.apply([projectGuides(empty())], { expectedRevision: 3 }); assert.equal(engine.revision, 4);
});

test('批次前后任一无效操作都整批回滚，保留已有撤销重做栈与元件内容', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([projectGuides({ horizontal: [9], vertical: [] })]); engine.undo();
  const valid = projectGuides({ horizontal: [100], vertical: [200] });
  const invalid = projectGuides({ horizontal: [1, 1], vertical: [] });
  const rename = { type: 'renameProject', name: '不应保存' };
  assertRejectedWithoutChange(engine, [rename, invalid]);
  assertRejectedWithoutChange(engine, [invalid, rename]);
  assertRejectedWithoutChange(engine, [valid, { type: 'updateNode', pageId: 'home', nodeId: 'box', patch: { width: -5 } }]);
  assertRejectedWithoutChange(engine, [valid, { type: 'updateNode', pageId: 'home', nodeId: 'missing', patch: { text: '错误目标' } }], 'COMMAND_ERROR');
  assert.deepEqual(engine.redo().globalGuides, { horizontal: [9], vertical: [] });
});

test('重复提交相同全局线不创建历史，清空可撤销，新提交会使旧 redo 失效', () => {
  const engine = new DocumentEngine(projectFixture()), guides = { horizontal: [10], vertical: [20] };
  engine.apply([projectGuides(empty())], { expectedRevision: 0 }); assert.equal(engine.revision, 0); assert.equal(engine.canUndo, false);
  engine.apply([projectGuides(guides)]); engine.apply([projectGuides(structuredClone(guides))]); assert.equal(engine.revision, 1);
  engine.apply([projectGuides(empty())]); assert.deepEqual(engine.getSnapshot().globalGuides, empty());
  engine.undo(); assert.deepEqual(engine.getSnapshot().globalGuides, guides); assert.equal(engine.canRedo, true);
  engine.apply([projectGuides({ horizontal: [-10], vertical: [] })]); assert.equal(engine.canRedo, false);
});

test('页面线与全局线同坐标仍彼此独立，改动或清空一个作用域不改变另一个页面或母版', () => {
  const engine = extendedFixture(), same = { horizontal: [100], vertical: [200] };
  engine.apply([projectGuides(same), pageGuides(same), pageGuides(same, 'other'),
    { type: 'componentCommands', componentId: 'master', commands: [pageGuides(same, 'master')] }]);
  engine.apply([pageGuides({ horizontal: [101], vertical: [] })]);
  assert.deepEqual(engine.getSnapshot().globalGuides, same); assert.deepEqual(guidesOf(engine, 'other'), same);
  engine.apply([projectGuides(empty())]); assert.deepEqual(guidesOf(engine), { horizontal: [101], vertical: [] });
  assert.deepEqual(guidesOf(engine, 'other'), same); assert.deepEqual(engine.getSnapshot().components[0].guides, same);
  engine.apply([projectGuides(same), pageGuides(empty(), 'other')]);
  assert.deepEqual(engine.getSnapshot().globalGuides, same); assert.deepEqual(guidesOf(engine, 'other'), empty());
});

test('canvasGuideSets 为每个真实页提供局部和全局两组，母版只取本地，目录和未知 ID 不变画布', () => {
  const engine = extendedFixture(), global = { horizontal: [90], vertical: [120] }, local = { horizontal: [40], vertical: [] };
  engine.apply([projectGuides(global), pageGuides(local), { type: 'addPageFolder', folder: { id: 'folder', name: '仅组织' } }]);
  const project = engine.getSnapshot(), before = structuredClone(project);
  assert.deepEqual(canvasGuideSets(project, 'home'), [{ scope: 'page', guides: local }, { scope: 'project', guides: global }]);
  assert.deepEqual(canvasGuideSets(project, 'other'), [{ scope: 'page', guides: empty() }, { scope: 'project', guides: global }]);
  assert.deepEqual(canvasGuideSets(project, 'master'), [{ scope: 'page', guides: empty() }]);
  assert.deepEqual(canvasGuideSets(project, 'folder'), []); assert.deepEqual(canvasGuideSets(project, 'missing'), []);
  assert.deepEqual(project, before);
  engine.apply([{ type: 'addPage', page: { id: 'later', name: '后建页面' } }]);
  assert.deepEqual(canvasGuideSets(engine.getSnapshot(), 'later'), [{ scope: 'page', guides: empty() }, { scope: 'project', guides: global }]);
});

test('自适应视图共用页面及项目参考线，不生成子视图全局副本，母版视图也不继承项目线', () => {
  const engine = extendedFixture(), global = { horizontal: [80], vertical: [160] }, local = { horizontal: [25], vertical: [] };
  engine.apply([projectGuides(global), pageGuides(local), { type: 'addComponentView', componentId: 'master', view: { id: 'master-small', name: '小母版', parentId: null } }]);
  const project = engine.getSnapshot();
  for (const viewId of [null, 'small']) {
    const resolved = resolveContainerView(project, 'home', viewId);
    assert.deepEqual(resolved.guides, local); assert.equal(Object.hasOwn(resolved, 'globalGuides'), false);
    assert.deepEqual(canvasGuideSets(project, resolved.id), [{ scope: 'page', guides: local }, { scope: 'project', guides: global }]);
  }
  const resolvedMaster = resolveContainerView(project, 'master', 'master-small');
  assert.deepEqual(canvasGuideSets(project, resolvedMaster.id), [{ scope: 'page', guides: empty() }]);
  assert.equal(Object.hasOwn(project.pages[0].views[0], 'globalGuides'), false);
});

test('componentCommands 和所有 viewCommands 范围都禁止塞入项目线命令，嵌套批次也不能越权', () => {
  const engine = extendedFixture(), guides = { horizontal: [12], vertical: [] };
  assert.equal(COMPONENT_EDIT_COMMANDS.includes('setProjectGuides'), false);
  assert.equal(VIEW_EDIT_COMMANDS.includes('setProjectGuides'), false);
  const commands = [
    { type: 'componentCommands', componentId: 'master', commands: [projectGuides(guides)] },
    { type: 'componentCommands', componentId: 'master', commands: [{ ...projectGuides(guides), pageId: 'master' }] },
    ...[null, 'small'].flatMap(viewId => ['current', 'all'].map(scope => ({ type: 'viewCommands', pageId: 'home', viewId, scope, commands: [{ ...projectGuides(guides), pageId: 'home' }] }))),
    { type: 'componentCommands', componentId: 'master', commands: [{ type: 'viewCommands', pageId: 'master', viewId: null, scope: 'all', commands: [{ ...projectGuides(guides), pageId: 'master' }] }] }
  ];
  for (const command of commands) assertRejectedWithoutChange(engine, [{ type: 'renameProject', name: '不应泄漏' }, command], 'COMMAND_ERROR');
  assertRejectedWithoutChange(engine, [{ type: 'updatePage', pageId: 'home', patch: { globalGuides: guides } }]);
});

test('JSON 保存重开完整保留全局、页面、母版及视图数据，打开后可继续事务编辑且原保存对象不变', () => {
  const engine = extendedFixture(), global = { horizontal: [-100000, -2.5, 100000], vertical: [0, 12.25] };
  engine.apply([projectGuides(global), pageGuides({ horizontal: [12], vertical: [33] }),
    { type: 'componentCommands', componentId: 'master', commands: [pageGuides({ horizontal: [], vertical: [44] }, 'master')] }]);
  const saved = engine.getSnapshot(), json = JSON.stringify(saved), parsed = JSON.parse(json), reopened = new DocumentEngine(parsed);
  assert.deepEqual(reopened.getSnapshot(), saved); assert.equal(validateProject(parsed), true); assert.equal(reopened.revision, 0);
  reopened.apply([projectGuides(empty())], { expectedRevision: 0 });
  assert.deepEqual(reopened.getSnapshot().globalGuides, empty()); assert.equal(JSON.stringify(parsed), json);
  reopened.undo(); assert.deepEqual(reopened.getSnapshot(), saved);
});

test('RP 对任一方向的非空全局线都明确拒绝，清空后基础项目可导出而页面线的旧限制不退化', () => {
  const engine = new DocumentEngine(projectFixture());
  assert.equal(getRpExportStatus(engine.getSnapshot()).canExport, true);
  for (const guides of [{ horizontal: [20], vertical: [] }, { horizontal: [], vertical: [-20] }]) {
    engine.apply([projectGuides(guides)]); const project = engine.getSnapshot(), status = getRpExportStatus(project);
    assert.equal(status.canExport, false); assert.ok(status.unsupported.some(reason => reason.includes('全局参考线')));
    assert.throws(() => exportRp(project), /全局参考线/); assert.deepEqual(engine.getSnapshot(), project);
    engine.apply([projectGuides(empty())]); assert.equal(getRpExportStatus(engine.getSnapshot()).canExport, true);
    assert.ok(exportRp(engine.getSnapshot()).data.byteLength > 0);
  }
  engine.apply([pageGuides({ horizontal: [1], vertical: [] })]);
  assert.equal(getRpExportStatus(engine.getSnapshot()).canExport, false); assert.throws(() => exportRp(engine.getSnapshot()), /参考线/);
  engine.apply([pageGuides(empty())]); assert.ok(exportRp(engine.getSnapshot()).data.byteLength > 0);
});

// This deliberately small DOM executes the shipped HTML runner and records its
// actual element tree. It checks element creation, not real-browser layout.
function runExport(project) {
  const html = exportHtml(project), scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 2);
  let document; const errors = [];
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.value = ''; this.attributes = {}; this.ownText = ''; this.className = ''; this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); } }; }
    get ownerDocument() { return document; }
    get textContent() { return this.ownText + this.children.map(child => child.textContent || '').join(''); }
    set textContent(value) { this.replaceChildren(); this.ownText = String(value ?? ''); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    remove() { if (this.parentElement) { const parent = this.parentElement; parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null; } }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    prepend(...children) { for (const child of [...children].reverse()) { child.remove(); child.parentElement = this; this.children.unshift(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.ownText = ''; this.append(...children); }
    contains(target) { return this === target || this.children.some(child => child.contains?.(target)); }
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  const ids = ['yuanda-model', 'stage', 'pages', 'views', 'current-page', 'restart', 'runtime-status'];
  const elements = new Map(ids.map(id => [id, new Element('div')])); elements.get('yuanda-model').textContent = scripts[0];
  document = { body: new Element('body'), addEventListener() {}, getElementById: id => elements.get(id), createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), title: '' };
  const window = { innerWidth: 1440, innerHeight: 900, addEventListener() {} };
  runInNewContext(scripts[1], { document, window, structuredClone, console: { error: error => errors.push(String(error)) }, setTimeout, clearTimeout, Map, Promise });
  const tree = element => ({ tag: element.tagName, className: element.className, text: element.ownText, style: { ...element.style }, dataset: { ...element.dataset }, attributes: { ...element.attributes }, hidden: element.hidden, children: element.children.map(tree) });
  return { elements, errors, data: JSON.parse(scripts[0]), rendered: () => ({ stage: tree(elements.get('stage')), body: tree(document.body) }) };
}

test('HTML 可以携带参考线数据，但运行器在初始、切页和切视图时都不创建辅助线 DOM', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([{ type: 'addPage', page: { id: 'other', name: '第二页', nodes: [makeNode('text', { id: 'other-label', text: '可见正文' })] } },
    { type: 'addAdaptiveView', pageId: 'home', view: smallView },
    projectGuides({ horizontal: [81.25, 281], vertical: [92, 392] }), pageGuides({ horizontal: [83], vertical: [94] }), pageGuides({ horizontal: [85], vertical: [96] }, 'other')]);
  const project = engine.getSnapshot(), before = structuredClone(project), stripped = structuredClone(project);
  stripped.globalGuides = empty(); stripped.pages.forEach(page => { page.guides = empty(); });
  const withGuides = runExport(project), withoutGuides = runExport(stripped);
  assert.deepEqual(withGuides.data.globalGuides, project.globalGuides);
  assert.deepEqual(withGuides.data.pages.map(page => page.guides), project.pages.map(page => page.guides));
  const compare = () => {
    assert.deepEqual(withGuides.errors, []); assert.deepEqual(withoutGuides.errors, []);
    assert.deepEqual(withGuides.rendered(), withoutGuides.rendered());
    const stage = withGuides.rendered().stage;
    assert.equal(stage.children.length, 1); assert.ok(stage.children[0].dataset.nodeId);
    assert.doesNotMatch(JSON.stringify(stage), /guide-line|global-guide|data-guide/);
  };
  compare();
  for (const view of ['base', 'small', 'auto']) {
    for (const runner of [withGuides, withoutGuides]) { const picker = runner.elements.get('views'); picker.value = view; picker.listeners.change(); }
    compare();
  }
  for (const pageId of ['other', 'home']) {
    for (const runner of [withGuides, withoutGuides]) { const picker = runner.elements.get('pages'); picker.value = pageId; picker.listeners.change(); }
    compare();
  }
  assert.deepEqual(project, before);
});

test('Agent schema 暴露项目字段与完整命令并说明作用域、限额、冲突、撤销、HTML 和 RP 边界', () => {
  assert.equal(schema.projectFields.filter(field => field === 'globalGuides').length, 1);
  assert.equal(schema.pageFields.includes('globalGuides'), false);
  assert.ok(schema.commands.includes('setProjectGuides {guides:{horizontal:number[],vertical:number[]}}'));
  assert.ok(schema.commands.some(command => command.startsWith('setPageGuides ')));
  assert.match(schema.guides.project, /every real page/); assert.match(schema.guides.project, /adaptive views/);
  assert.match(schema.guides.project, /never.*master/); assert.match(schema.guides.project, /not rendered in HTML/);
  assert.match(schema.guides.local, /independent/);
  for (const description of [/500/, /finite/, /unique/, /-100000/, /100000/, /replaces/, /expectedRevision/, /undo/]) assert.match(schema.guides.limits, description);
  assert.match(schema.guides.rp, /Nonempty.*rejects RP/);
});
