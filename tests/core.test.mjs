import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createBlankProject, createDemoProject, makeNode, validateProject, normalizeProject, DocumentEngine } from '../app/core/document.mjs';
import { exportHtml } from '../app/core/html-export.mjs';

const fixedProject = () => {
  const project = createBlankProject('测试项目');
  project.id = 'test-project'; project.pages[0].id = 'page-one';
  project.pages[0].nodes = [makeNode('button', { id: 'button-one', text: '开始' }), makeNode('text', { id: 'label-one', text: '初始' })];
  return project;
};
const patchText = text => ({ type: 'updateNode', pageId: 'page-one', nodeId: 'label-one', patch: { text } });

test('默认文档和可试玩示例通过严格验证与 JSON 往返', () => {
  for (const project of [createBlankProject(), createDemoProject()]) {
    assert.equal(validateProject(project), true);
    const restored = JSON.parse(JSON.stringify(project));
    assert.deepEqual(restored, project);
    assert.deepEqual(new DocumentEngine(restored).getSnapshot(), project);
  }
  const demo = createDemoProject();
  assert.deepEqual(demo.pages.slice(0,2).map(page=>page.id), ['page-home','page-dashboard']);
  assert.ok(demo.pages[0].nodes.find(node => node.id === 'modal-card').visible === false);
  assert.ok(demo.pages[0].nodes.find(node => node.id === 'modal-submit').interactions[0].actions.some(action => action.type === 'wait'));
});

test('批次后半段失败时前面的改动、版本和撤销历史都不会泄漏', () => {
  const engine = new DocumentEngine(fixedProject()); const before = engine.getSnapshot();
  assert.throws(() => engine.apply([patchText('不应保留'), patchText('x'.repeat(50001))]), { code: 'VALIDATION_ERROR' });
  assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, 0); assert.equal(engine.canUndo, false);
  assert.throws(() => engine.apply([patchText('不应保留'), { type: 'removeNodes', pageId: 'page-one', nodeIds: ['missing'] }]), { code: 'COMMAND_ERROR' });
  assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, 0);
});

test('并发 Agent 的过期版本写入被拒绝，空变更不增加版本', () => {
  const engine = new DocumentEngine(fixedProject());
  engine.apply([patchText('第一位作者')], { expectedRevision: 0 });
  assert.equal(engine.revision, 1);
  assert.throws(() => engine.apply([patchText('过期作者覆盖')], { expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  assert.equal(engine.getSnapshot().pages[0].nodes[1].text, '第一位作者');
  engine.apply([patchText('第一位作者')], { expectedRevision: 1 }); engine.apply([]);
  assert.equal(engine.revision, 1);
});

test('整批命令作为一次撤销，重做正确；新编辑截断重做分支', () => {
  const engine = new DocumentEngine(fixedProject());
  engine.apply([patchText('批次结果'), { type: 'renameProject', name: '改名' }]);
  assert.equal(engine.revision, 1); assert.equal(engine.canUndo, true);
  engine.undo(); assert.equal(engine.revision, 2); assert.equal(engine.getSnapshot().name, '测试项目'); assert.equal(engine.getSnapshot().pages[0].nodes[1].text, '初始');
  assert.equal(engine.canRedo, true); engine.redo(); assert.equal(engine.getSnapshot().name, '改名'); assert.equal(engine.revision, 3);
  engine.undo(); engine.apply([patchText('分支')]); assert.equal(engine.canRedo, false);
  const revision = engine.revision; engine.redo(); assert.equal(engine.revision, revision);
});

test('构造、快照、命令输入不与引擎持有的对象共享引用', () => {
  const source = fixedProject(); const engine = new DocumentEngine(source); source.pages[0].nodes[0].text = '外部修改';
  const snapshot = engine.getSnapshot(); snapshot.pages[0].nodes[0].style.fill = '#000000';
  const command = patchText('命令文字'); engine.apply([command]); command.patch.text = '篡改命令';
  assert.equal(engine.getSnapshot().pages[0].nodes[0].text, '开始');
  assert.notEqual(engine.getSnapshot().pages[0].nodes[0].style.fill, '#000000');
  assert.equal(engine.getSnapshot().pages[0].nodes[1].text, '命令文字');
});

test('样式局部合并、简洁创建命令与图层重排保留模型完整性', () => {
  const engine = new DocumentEngine(fixedProject()); const beforeStyle = engine.getSnapshot().pages[0].nodes[1].style;
  engine.apply([{ type: 'updateNode', pageId: 'page-one', nodeId: 'label-one', patch: { style: { fill: '#ABCDEF' } } }, { type: 'addNode', pageId: 'page-one', node: { id: 'added', type: 'input' } }, { type: 'addPage', page: { id: 'page-two', name: '第二页' } }]);
  const project = engine.getSnapshot();
  assert.deepEqual(project.pages[0].nodes[1].style, { ...beforeStyle, fill: '#ABCDEF' });
  assert.equal(project.pages[0].nodes[2].type, 'input'); assert.equal(project.pages[1].width, 1200);
  engine.apply([{ type: 'reorderNode', pageId: 'page-one', nodeId: 'added', index: 0 }]);
  assert.equal(engine.getSnapshot().pages[0].nodes[0].id, 'added');
});

test('删除元件与页面清理失效动作，撤销可以完整恢复引用', () => {
  const project = fixedProject();
  project.pages.push({ id: 'page-two', name: '第二页', width: 1200, height: 800, background: '#FFFFFF', nodes: [] });
  project.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'setText', targetId: 'label-one', value: '新文字' }, { type: 'wait', ms: 1 }, { type: 'navigate', pageId: 'page-two' }] }];
  const engine = new DocumentEngine(project);
  engine.apply([{ type: 'removeNodes', pageId: 'page-one', nodeIds: ['label-one'] }, { type: 'removePage', pageId: 'page-two' }]);
  assert.deepEqual(engine.getSnapshot().pages[0].nodes[0].interactions[0].actions, [{ type: 'wait', ms: 1 }]);
  engine.undo(); assert.deepEqual(engine.getSnapshot(), normalizeProject(project));
  engine.apply([{ type: 'removePage', pageId: 'page-two' }]);
  assert.throws(() => engine.apply([{ type: 'removePage', pageId: 'page-one' }]), { code: 'COMMAND_ERROR' });
});

test('完整文档验证拒绝重复 ID、跨页面引用、非法数字及危险字段', () => {
  const cases = [
    p => { p.pages[0].nodes[0].id = p.id; },
    p => { p.pages[0].nodes[0].width = Infinity; },
    p => { p.pages[0].nodes[0].style.fill = 'red; background:url(https://invalid.example)'; },
    p => { p.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'javascript', value: 'alert(1)' }] }]; },
    p => { p.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'setText', targetId: 'not-here', value: 'hi' }] }]; },
    p => { p.pages[0].nodes[0].style.onclick = 'evil()'; },
    p => { p.pages[0].nodes[0].src = 'https://remote.example/a.png'; },
    p => { p.pages[0].nodes[0].type = 'html'; },
    p => { p.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'wait', ms: 60001 }] }]; }
  ];
  for (const damage of cases) { const project = fixedProject(); damage(project); assert.throws(() => validateProject(project), { code: 'VALIDATION_ERROR' }); }
});

test('replace 先验证再替换，成功后清空历史并推进版本', () => {
  const engine = new DocumentEngine(fixedProject()); engine.apply([patchText('保留')]); const before = engine.getSnapshot();
  assert.throws(() => engine.replace({}), { code: 'VALIDATION_ERROR' }); assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, 1);
  engine.replace(createBlankProject('新文档')); assert.equal(engine.revision, 2); assert.equal(engine.canUndo, false); assert.equal(engine.canRedo, false);
});

test('导出防止文字闭合 script、HTML 标签注入及远程资源', () => {
  const project = fixedProject(); const malicious = '</script><script>globalThis.hacked=true</script><img src=x onerror=alert(1)>\u2028\u2029';
  project.name = malicious; project.pages[0].nodes[1].text = malicious;
  const html = exportHtml(project);
  assert.ok(!html.includes(malicious)); assert.ok(html.includes('\\u003c/script\\u003e'));
  assert.equal((html.match(/<script(?:\s|>)/g) || []).length, 2);
  const json = html.match(/<script id="yuanda-model" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(json), project);
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!/src="https?:/i.test(html));
});

/** 小型 DOM 仿真仅用于验证独立运行器动作语义，不声称验证真实浏览器排版。 */
function runExport(project) {
  const html = exportHtml(project); const scripts = [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  let document;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.classList = { add: () => {} }; this.value = ''; this.attributes = {}; this.ownText = ''; }
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
    addEventListener(name, fn) { this.listeners[name] = fn; }
    click() { this.listeners.click?.({}); }
  }
  const map = new Map(['yuanda-model', 'stage', 'pages', 'views', 'current-page', 'restart', 'runtime-status'].map(name => [name, new Element('div')]));
  map.get('yuanda-model').textContent = scripts[0];
  document = { body: new Element('body'), addEventListener() {}, getElementById: id => map.get(id), createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), title: '' };
  const window = { innerWidth: 1440, innerHeight: 900, addEventListener() {} };
  vm.runInNewContext(scripts[1], { document, window, structuredClone, console, setTimeout, clearTimeout, Map, Promise });
  return { map, node: id => map.get('stage').children.find(node => node.dataset.nodeId === id) };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('HTML 运行器依次改文字、等待、显隐切换，输入框改实际值', async () => {
  const project = fixedProject();
  project.pages[0].nodes.push(makeNode('input', { id: 'input-one' }));
  project.pages[0].nodes[0].interactions = [{ event: 'click', actions: [
    { type: 'setText', targetId: 'label-one', value: '等待中' }, { type: 'setVisible', targetId: 'label-one', value: false },
    { type: 'wait', ms: 25 }, { type: 'toggleVisible', targetId: 'label-one' }, { type: 'setText', targetId: 'label-one', value: '完成' }, { type: 'setText', targetId: 'input-one', value: '已填写' }
  ] }];
  const runner = runExport(project); runner.node('button-one').click(); await pause(3);
  assert.equal(runner.node('label-one').textContent, '等待中'); assert.equal(runner.node('label-one').hidden, true);
  await pause(50); assert.equal(runner.node('label-one').textContent, '完成'); assert.equal(runner.node('label-one').hidden, false); assert.equal(runner.node('input-one').children.find(child => child.tagName === 'INPUT').value, '已填写');
});

test('HTML 切页后取消旧等待和旧点击队列，重开页面恢复初始状态', async () => {
  const project = fixedProject();
  project.pages.push({ id: 'page-two', name: '第二页', width: 1200, height: 800, background: '#FFFFFF', nodes: [] });
  project.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'wait', ms: 40 }, { type: 'setText', targetId: 'label-one', value: '旧操作不应出现' }] }];
  const runner = runExport(project); runner.node('button-one').click(); runner.node('button-one').click(); await pause(3);
  const picker = runner.map.get('pages'); picker.value = 'page-two'; picker.listeners.change();
  picker.value = 'page-one'; picker.listeners.change(); await pause(70);
  assert.equal(runner.node('label-one').textContent, '初始');
});

test('navigate 动作立即切页并终止原动作链', async () => {
  const project = fixedProject();
  project.pages.push({ id: 'page-two', name: '第二页', width: 1200, height: 800, background: '#FFFFFF', nodes: [makeNode('text', { id: 'second-label', text: '第二页内容' })] });
  project.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'navigate', pageId: 'page-two' }, { type: 'setText', targetId: 'label-one', value: '不应执行' }] }];
  const runner = runExport(project); runner.node('button-one').click(); await pause(1);
  assert.equal(runner.map.get('pages').value, 'page-two'); assert.equal(runner.node('second-label').textContent, '第二页内容'); assert.equal(runner.node('label-one'), undefined);
});

test('另一按钮的导航不被等待动作阻塞，并取消旧页动作', async () => {
  const project = fixedProject();
  project.pages.push({ id: 'page-two', name: '第二页', width: 1200, height: 800, background: '#FFFFFF', nodes: [] });
  project.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'wait', ms: 40 }, { type: 'setText', targetId: 'label-one', value: '已过期' }] }];
  project.pages[0].nodes.push(makeNode('button', { id: 'nav-button', interactions: [{ event: 'click', actions: [{ type: 'navigate', pageId: 'page-two' }] }] }));
  const runner = runExport(project); runner.node('button-one').click(); await pause(1); runner.node('nav-button').click(); await pause(1);
  assert.equal(runner.map.get('pages').value, 'page-two');
  const picker = runner.map.get('pages'); picker.value = 'page-one'; picker.listeners.change(); await pause(60);
  assert.equal(runner.node('label-one').textContent, '初始');
});
