import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankProject, makeNode, DocumentEngine, validateProject, normalizeProject } from '../app/core/document.mjs';
import { evaluateExpression, chooseInteractionCases, selectRepeaterRows, resolveAdaptivePage, getNodeDescendants } from '../app/core/interaction-model.mjs';
import { makeRichText } from '../app/core/vector-model.mjs';

function fixture() {
  const project = createBlankProject('高级模型'); project.id = 'advanced-project'; project.pages[0].id = 'home';
  project.pages[0].nodes = [makeNode('button', { id: 'button', x: 100, y: 100 }), makeNode('text', { id: 'label', x: 300, y: 100, text: '初始文字' }), makeNode('input', { id: 'input', x: 100, y: 180 })];
  return new DocumentEngine(project);
}
const page = engine => engine.getSnapshot().pages.find(page => page.id === 'home');
const node = (engine, id) => page(engine).nodes.find(node => node.id === id);
const exprVar = name => ({ op: 'var', name });
const exprNode = (nodeId, property) => ({ op: 'node', nodeId, property });
const exprItem = column => ({ op: 'item', column });
const op = (op, ...args) => ({ op, args });
const update = (nodeId, patch) => ({ type: 'updateNode', pageId: 'home', nodeId, patch });
const interaction = (actions, options = {}) => ({ event: 'click', actions, name: '', condition: null, caseMode: 'if', enabled: true, ...options });

test('安全表达式支持变量/元件/事件/数据行及组合运算，不执行字符串代码', () => {
  const context = { variables: { count: 3, title: '原搭' }, nodes: new Map([['input', { value: 'abc', checked: true }]]), event: { key: 'Enter' }, item: { score: 5 } };
  assert.equal(evaluateExpression(op('add', exprVar('count'), exprItem('score')), context), 8);
  assert.equal(evaluateExpression(op('and', op('eq', { op: 'event', name: 'key' }, 'Enter'), exprNode('input', 'checked')), context), true);
  assert.equal(evaluateExpression(op('concat', exprVar('title'), ': ', exprNode('input', 'value')), context), '原搭: abc');
  assert.equal(evaluateExpression(op('length', exprNode('input', 'value')), context), 3);
  assert.equal(evaluateExpression(op('div', 10, 0), context), 0);
  assert.equal(evaluateExpression('globalThis.pwned = true', context), 'globalThis.pwned = true'); assert.equal(globalThis.pwned, undefined);
});

test('事件分支 if/elseIf/else 按组首个命中，独立 if 仍可执行', () => {
  const cases = [interaction([], { name: 'false', condition: false }), interaction([], { name: 'elseif', caseMode: 'elseIf', condition: op('gt', exprVar('count'), 2) }), interaction([], { name: 'else', caseMode: 'else' }), interaction([], { name: 'independent', condition: true }), interaction([], { name: 'wrong-event', event: 'change' })];
  assert.deepEqual(chooseInteractionCases(cases, 'click', { variables: { count: 4 } }).map(item => item.name), ['elseif', 'independent']);
  assert.deepEqual(chooseInteractionCases(cases, 'click', { variables: { count: 0 } }).map(item => item.name), ['else', 'independent']);
});

test('页面事件、注释和变量表达式可保存，变量重命名同步所有引用', () => {
  const engine = fixture();
  engine.apply([{ type: 'addVariable', variable: { name: 'count', type: 'number', value: 0 } }, { type: 'updatePage', pageId: 'home', patch: { annotation: '登录后的首页', interactions: [{ event: 'load', actions: [{ type: 'setVariable', name: 'count', value: 1 }] }] } }, update('button', { interactions: [interaction([{ type: 'setText', targetId: 'label', value: op('concat', '计数 ', exprVar('count')) }], { condition: op('gte', exprVar('count'), 0) })] }), update('label', { bindings: { text: exprVar('count') } })]);
  engine.apply([{ type: 'updateVariable', name: 'count', patch: { name: 'total', value: 7 } }]);
  const snapshot = engine.getSnapshot(); assert.equal(snapshot.pages[0].annotation, '登录后的首页'); assert.equal(snapshot.pages[0].interactions[0].actions[0].name, 'total');
  assert.equal(node(engine, 'button').interactions[0].condition.args[0].name, 'total'); assert.equal(node(engine, 'label').bindings.text.name, 'total');
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(snapshot))).getSnapshot(), snapshot);
});

test('删除变量清理条件分支、页面动作和绑定，不留下悬空引用', () => {
  const engine = fixture(); engine.apply([{ type: 'addVariable', variable: { name: 'enabled', type: 'boolean', value: false } }, update('button', { interactions: [interaction([], { condition: exprVar('enabled') }), interaction([{ type: 'setText', targetId: 'label', value: 'else' }], { caseMode: 'else' })] }), update('label', { bindings: { visible: exprVar('enabled') } }), { type: 'updatePage', pageId: 'home', patch: { interactions: [{ event: 'load', actions: [{ type: 'setVariable', name: 'enabled', value: true }] }] } }]);
  engine.apply([{ type: 'removeVariable', name: 'enabled' }]);
  assert.deepEqual(engine.getSnapshot().variables, []); assert.deepEqual(page(engine).interactions[0].actions, []); assert.deepEqual(node(engine, 'label').bindings, {});
  assert.equal(node(engine, 'button').interactions[0].caseMode, 'if'); assert.equal(node(engine, 'button').interactions[0].condition, false); assert.equal(validateProject(engine.getSnapshot()), true);
});

test('页面与节点扩展事件和七种状态样式验证，非法表达式与字段回滚', () => {
  const engine = fixture(); const stateStyles = Object.fromEntries(['hover', 'pressed', 'selected', 'disabled', 'error', 'focus', 'hint'].map(name => [name, { fill: '#EEEEEE' }]));
  engine.apply([update('input', { selected: true, error: true, stateStyles, interactions: [interaction([{ type: 'setValue', targetId: 'input', value: { op: 'event', name: 'value' } }], { event: 'input' }), interaction([{ type: 'setError', targetId: 'input', value: false }, { type: 'setSelected', targetId: 'button', value: true }, { type: 'setDisabled', targetId: 'button', value: true }], { event: 'focus' })] })]);
  assert.equal(node(engine, 'input').selected, true); const before = engine.getSnapshot();
  for (const patch of [{ bindings: { text: { op: 'javascript', source: 'alert(1)' } } }, { stateStyles: { unknown: { fill: '#000000' } } }, { interactions: [interaction([], { caseMode: 'else' })] }, { bindings: { text: exprVar('missing') } }]) {
    assert.throws(() => engine.apply([update('input', patch)]), { code: 'VALIDATION_ERROR' }); assert.deepEqual(engine.getSnapshot(), before);
  }
});

test('动态面板具有真实状态归属、初始状态和切换动作，删除状态保留子元件', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', nodeIds: ['label'], panelId: 'panel', name: '反馈面板' }, { type: 'addPanelState', pageId: 'home', panelId: 'panel', state: { id: 'state-second', name: '第二状态', nodeIds: ['input'] } }, { type: 'setInitialPanelState', pageId: 'home', panelId: 'panel', stateId: 'state-second' }, update('button', { interactions: [interaction([{ type: 'setPanelState', panelId: 'panel', stateId: 'state-second' }, { type: 'nextPanelState', panelId: 'panel', wrap: true }, { type: 'previousPanelState', panelId: 'panel', wrap: false }])] })]);
  assert.equal(node(engine, 'panel').panel.initialStateId, 'state-second'); assert.deepEqual(getNodeDescendants(page(engine).nodes, 'panel'), ['label', 'input']);
  engine.apply([{ type: 'removePanelState', pageId: 'home', panelId: 'panel', stateId: 'state-second' }]);
  assert.ok(node(engine, 'input')); assert.equal(node(engine, 'panel').panel.states.length, 1); assert.equal(node(engine, 'button').interactions[0].actions.length, 2);
  assert.throws(() => engine.apply([{ type: 'removePanelState', pageId: 'home', panelId: 'panel', stateId: node(engine, 'panel').panel.initialStateId }]), { code: 'COMMAND_ERROR' });
});

test('容器禁止循环/重复归属，移动容器递归且只移动一次，删除容器清理后代和动作', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', nodeIds: ['label'], panelId: 'inner' }, { type: 'createDynamicPanel', pageId: 'home', nodeIds: ['inner'], panelId: 'outer' }]);
  const initial = node(engine, 'label').x, before = engine.getSnapshot();
  assert.throws(() => engine.apply([{ type: 'assignPanelNodes', pageId: 'home', panelId: 'inner', stateId: node(engine, 'inner').panel.initialStateId, nodeIds: ['outer'] }]), { code: 'VALIDATION_ERROR' }); assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([{ type: 'moveContainer', pageId: 'home', nodeId: 'outer', dx: 50, dy: 20 }]); assert.equal(node(engine, 'label').x, initial + 50); assert.equal(node(engine, 'inner').x, before.pages[0].nodes.find(node => node.id === 'inner').x + 50);
  engine.apply([update('button', { interactions: [interaction([{ type: 'setText', targetId: 'label', value: '不会留下悬空动作' }])] }), { type: 'removeNodes', pageId: 'home', nodeIds: ['outer'] }]);
  assert.equal(node(engine, 'label'), undefined); assert.equal(node(engine, 'inner'), undefined); assert.deepEqual(node(engine, 'button').interactions[0].actions, []);
});

test('普通 updateNode 坐标不会隐式二次平移容器后代，组移动会正确展开', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', nodeIds: ['label'], panelId: 'panel' }]);
  const x = node(engine, 'label').x; engine.apply([update('panel', { x: 10 })]); assert.equal(node(engine, 'label').x, x);
  engine.apply([{ type: 'groupNodes', pageId: 'home', groupId: 'group', nodeIds: ['panel', 'input'] }, { type: 'moveGroup', pageId: 'home', groupId: 'group', dx: 20, dy: 0 }]); assert.equal(node(engine, 'label').x, x + 20);
});

function repeaterFixture() {
  const engine = fixture(); engine.apply([{ type: 'createRepeater', pageId: 'home', nodeId: 'repeater', nodeIds: ['label'] }, { type: 'setRepeaterData', pageId: 'home', nodeId: 'repeater', columns: [{ key: 'title', label: '标题', type: 'string' }, { key: 'score', label: '评分', type: 'number' }], rows: [{ id: 'row-a', values: { title: 'A', score: 2 } }, { id: 'row-b', values: { title: 'B', score: 5 } }] }, update('label', { bindings: { text: op('concat', exprItem('title'), ': ', exprItem('score')) } })]); return engine;
}
test('中继器数据增改删、绑定、筛选与排序实际生效，历史可逆', () => {
  const engine = repeaterFixture(); engine.apply([{ type: 'addRepeaterRows', pageId: 'home', nodeId: 'repeater', rows: [{ id: 'row-c', values: { title: 'C', score: 4 } }] }, { type: 'updateRepeaterRow', pageId: 'home', nodeId: 'repeater', rowId: 'row-a', values: { score: 3 } }, { type: 'setRepeaterFilter', pageId: 'home', nodeId: 'repeater', filter: op('gte', exprItem('score'), 3) }, { type: 'setRepeaterSort', pageId: 'home', nodeId: 'repeater', sort: { column: 'score', descending: true } }]);
  const data = node(engine, 'repeater').repeater; assert.deepEqual(selectRepeaterRows(data).map(row => row.values.title), ['B', 'C', 'A']);
  assert.equal(evaluateExpression(node(engine, 'label').bindings.text, { item: data.rows[0].values }), 'A: 3');
  engine.apply([{ type: 'removeRepeaterRows', pageId: 'home', nodeId: 'repeater', rowIds: ['row-b'] }]); assert.deepEqual(selectRepeaterRows(node(engine, 'repeater').repeater).map(row => row.values.title), ['C', 'A']);
  engine.undo(); assert.deepEqual(node(engine, 'repeater').repeater, data);
});

test('中继器动作与类型有效性检查，未知列和错误数据类型整批回滚', () => {
  const engine = repeaterFixture(); engine.apply([update('button', { interactions: [interaction([
    { type: 'addRows', repeaterId: 'repeater', rows: [{ values: { title: '新行', score: 8 } }] },
    { type: 'updateRows', repeaterId: 'repeater', where: op('eq', exprItem('title'), 'A'), values: { score: op('add', exprItem('score'), 1) } },
    { type: 'filterRows', repeaterId: 'repeater', where: op('gt', exprItem('score'), 1) },
    { type: 'sortRows', repeaterId: 'repeater', column: 'score', descending: false },
    { type: 'deleteRows', repeaterId: 'repeater', where: op('lt', exprItem('score'), 0) }
  ])] })]); const before = engine.getSnapshot();
  for (const command of [{ type: 'updateRepeaterRow', pageId: 'home', nodeId: 'repeater', rowId: 'row-a', values: { score: 'not-number' } }, { type: 'setRepeaterFilter', pageId: 'home', nodeId: 'repeater', filter: exprItem('missing') }, { type: 'setRepeaterSort', pageId: 'home', nodeId: 'repeater', sort: { column: 'missing', descending: true } }]) {
    assert.throws(() => engine.apply([{ type: 'renameProject', name: '不应保留' }, command]), { code: 'VALIDATION_ERROR' }); assert.deepEqual(engine.getSnapshot(), before);
  }
});

test('自适应视图按断点选用并合并样式，不修改基础设计；删除元件清理覆盖', () => {
  const engine = fixture(); engine.apply([{ type: 'addAdaptiveView', pageId: 'home', view: { id: 'mobile', name: '手机', minWidth: 0, width: 390, height: 844 } }, { type: 'addAdaptiveView', pageId: 'home', view: { id: 'desktop', name: '桌面', minWidth: 900, width: 1200, height: 800 } }, { type: 'setAdaptiveOverride', pageId: 'home', viewId: 'mobile', nodeId: 'button', patch: { x: 20, width: 350, style: { fontSize: 20 } } }]);
  const base = page(engine), small = resolveAdaptivePage(base, 600), large = resolveAdaptivePage(base, 1400);
  assert.equal(small.width, 390); assert.equal(small.nodes[0].width, 350); assert.equal(small.nodes[0].style.fontSize, 20); assert.equal(small.nodes[0].style.color, base.nodes[0].style.color);
  assert.equal(large.width, 1200); assert.equal(base.nodes[0].x, 100); assert.equal(resolveAdaptivePage(base, 600, null).width, 1200);
  engine.apply([{ type: 'removeNodes', pageId: 'home', nodeIds: ['button'] }]); assert.deepEqual(page(engine).views[0].overrides, {});
});

test('包含动态面板的组件递归复制状态、子元件及表达式引用，主更新保持内部 ID 稳定', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', nodeIds: ['button', 'label'], panelId: 'panel' }, { type: 'addPanelState', pageId: 'home', panelId: 'panel', state: { id: 'second-state', name: '第二', nodeIds: ['input'] } }, update('button', { interactions: [interaction([{ type: 'setPanelState', panelId: 'panel', stateId: 'second-state' }, { type: 'setText', targetId: 'label', value: exprNode('input', 'value') }])] }), { type: 'createComponent', pageId: 'home', nodeIds: ['panel'], componentId: 'dynamic-component', name: '高级组件' }, { type: 'insertComponent', pageId: 'home', componentId: 'dynamic-component', instanceId: 'dynamic-instance', x: 500, y: 300 }]);
  let snapshot = engine.getSnapshot(), group = snapshot.pages[0].groups[0], component = snapshot.components[0];
  const sourcePanel = component.nodes.find(node => node.type === 'dynamicPanel'), sourceButton = component.nodes.find(node => node.type === 'button');
  const mapped = id => group.nodeIds[group.sourceIds.indexOf(id)]; const instancePanel = node(engine, mapped(sourcePanel.id)), instanceButton = node(engine, mapped(sourceButton.id));
  assert.equal(instanceButton.interactions[0].actions[0].panelId, instancePanel.id); assert.equal(instanceButton.interactions[0].actions[0].stateId, instancePanel.panel.states[1].id);
  assert.notEqual(instancePanel.panel.states[0].id, sourcePanel.panel.states[0].id); assert.ok(group.nodeIds.includes(instanceButton.interactions[0].actions[1].value.nodeId));
  const internalBefore = structuredClone(group.internalIds);
  engine.apply([{ type: 'updateComponentNode', componentId: 'dynamic-component', nodeId: sourceButton.id, patch: { text: '新版按钮' } }]);
  assert.deepEqual(page(engine).groups[0].internalIds, internalBefore); assert.equal(validateProject(engine.getSnapshot()), true);
});

test('包含中继器的组件重新映射行 ID 与模板引用，同时保留 item 绑定', () => {
  const engine = repeaterFixture(); engine.apply([{ type: 'createComponent', pageId: 'home', nodeIds: ['repeater'], componentId: 'list-component', name: '数据列表' }, { type: 'insertComponent', pageId: 'home', componentId: 'list-component', instanceId: 'list-instance', x: 600, y: 400 }]);
  const snapshot = engine.getSnapshot(), group = snapshot.pages[0].groups[0], source = snapshot.components[0].nodes.find(node => node.type === 'repeater');
  const instance = snapshot.pages[0].nodes.find(node => node.id === group.nodeIds[group.sourceIds.indexOf(source.id)]);
  assert.notEqual(instance.repeater.rows[0].id, source.repeater.rows[0].id); assert.ok(instance.repeater.templateIds.every(id => group.nodeIds.includes(id)));
  assert.equal(validateProject(snapshot), true);
});

test('复杂容器复制重映射状态/表达式/绑定且保持自适应覆盖与可撤销性', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', nodeIds: ['button', 'label'], panelId: 'panel' }, update('button', { interactions: [interaction([{ type: 'setText', targetId: 'label', value: exprNode('label', 'text') }])] }), { type: 'addAdaptiveView', pageId: 'home', view: { id: 'mobile', name: '手机', minWidth: 0, width: 390, height: 844, overrides: { label: { x: 20, style: { fontSize: 12 } } } } }]);
  const before = engine.getSnapshot(); engine.apply([{ type: 'duplicateNodes', pageId: 'home', nodeIds: ['panel'], dx: 30, dy: 40, idMap: { panel: 'panel-copy', button: 'button-copy', label: 'label-copy' } }]);
  const cloned = node(engine, 'panel-copy'); assert.deepEqual(cloned.panel.states[0].nodeIds, ['button-copy', 'label-copy']); assert.notEqual(cloned.panel.states[0].id, node(engine, 'panel').panel.states[0].id);
  assert.equal(node(engine, 'button-copy').interactions[0].actions[0].targetId, 'label-copy'); assert.equal(node(engine, 'button-copy').interactions[0].actions[0].value.nodeId, 'label-copy');
  assert.equal(page(engine).views[0].overrides['label-copy'].x, 50); engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
});

test('跨页复制清理不可达外部动作和条件，组件实例复制保留主定义关联', () => {
  const engine = fixture(); engine.apply([update('button', { interactions: [interaction([{ type: 'setText', targetId: 'label', value: '外部' }])] }), { type: 'addPage', page: { id: 'other' } }, { type: 'duplicateNodes', pageId: 'home', nodeIds: ['button'], targetPageId: 'other', idMap: { button: 'foreign-button' } }]);
  assert.deepEqual(engine.getSnapshot().pages[1].nodes[0].interactions[0].actions, []); assert.equal(node(engine, 'button').interactions[0].actions.length, 1);
  engine.apply([{ type: 'createComponent', pageId: 'home', nodeIds: ['button', 'label'], name: '组件', componentId: 'component' }, { type: 'insertComponent', pageId: 'home', componentId: 'component', instanceId: 'instance', x: 400, y: 300 }]);
  const firstId = page(engine).groups[0].nodeIds[0]; engine.apply([{ type: 'duplicateNodes', pageId: 'home', nodeIds: [firstId], idMap: { [firstId]: 'instance-button-copy' } }]);
  assert.equal(page(engine).groups.length, 2); assert.equal(page(engine).groups[1].componentId, 'component'); assert.ok(page(engine).groups[1].nodeIds.includes('instance-button-copy'));
});

test('连接线随端点移动并在删除端点时级联清理；普通改字清除旧富文本', () => {
  const engine = fixture(); engine.apply([{ type: 'addNode', pageId: 'home', node: { id: 'link', type: 'connector', connector: { from: { nodeId: 'button', side: 'right' }, to: { nodeId: 'label', side: 'left' }, route: 'straight', arrow: 'end' } } }, update('label', { text: '富文本', richText: makeRichText('富文本') })]);
  const beforeX = node(engine, 'link').x; engine.apply([update('button', { x: 50 }), update('label', { text: '普通文字' })]); assert.notEqual(node(engine, 'link').x, beforeX); assert.equal(node(engine, 'label').richText, null);
  engine.apply([{ type: 'removeNodes', pageId: 'home', nodeIds: ['button'] }]); assert.equal(node(engine, 'link'), undefined);
});

test('高级结构组合写入仍保持版本冲突和原子失败，旧文件输入未被原地修改', () => {
  const engine = fixture(), before = engine.getSnapshot();
  assert.throws(() => engine.apply([{ type: 'createDynamicPanel', pageId: 'home', panelId: 'panel' }, { type: 'addVariable', variable: { name: 'bad', type: 'number', value: 'bad' } }]), { code: 'VALIDATION_ERROR' }); assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([{ type: 'addVariable', variable: { name: 'count', type: 'number', value: 1 } }], { expectedRevision: 0 });
  assert.throws(() => engine.apply([{ type: 'removeVariable', name: 'count' }], { expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  const old = structuredClone(before); delete old.variables; delete old.pages[0].views; delete old.pages[0].interactions; const original = JSON.stringify(old); const normalized = normalizeProject(old); assert.equal(validateProject(normalized), true); assert.equal(JSON.stringify(old), original);
});

test('选中和错误状态可参与条件，新增数据行动作支持输入值/变量并完整迁移引用', () => {
  const engine = repeaterFixture(); engine.apply([
    { type: 'addVariable', variable: { name: 'score', type: 'number', value: 6 } },
    update('input', { value: '新行', selected: true, error: false }),
    update('button', { interactions: [interaction([{ type: 'addRows', repeaterId: 'repeater', rows: [{ values: { title: exprNode('input', 'value'), score: exprVar('score') } }] }], { condition: op('and', exprNode('input', 'selected'), op('not', exprNode('input', 'error'))) })] }),
    { type: 'updateVariable', name: 'score', patch: { name: 'rating' } },
    { type: 'duplicateNodes', pageId: 'home', nodeIds: ['button', 'input', 'repeater'], idMap: { button: 'button-copy', input: 'input-copy', repeater: 'repeater-copy' } }
  ]);
  const action = node(engine, 'button-copy').interactions[0].actions[0];
  assert.equal(action.repeaterId, 'repeater-copy'); assert.equal(action.rows[0].values.title.nodeId, 'input-copy'); assert.equal(action.rows[0].values.score.name, 'rating');
  assert.equal(chooseInteractionCases(node(engine, 'button-copy').interactions, 'click', { nodes: Object.fromEntries(page(engine).nodes.map(node => [node.id, node])) }).length, 1);
  const before = engine.getSnapshot();
  assert.throws(() => engine.apply([update('button', { interactions: [interaction([{ type: 'addRows', repeaterId: 'repeater', rows: [{ values: { title: '标题', score: '错误类型' } }] }])] })]), { code: 'VALIDATION_ERROR' }); assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([{ type: 'removeVariable', name: 'rating' }]); assert.deepEqual(node(engine, 'button-copy').interactions[0].actions, []);
});

test('删除条件所引用对象后不会意外触发剩余 elseIf/else 分支', () => {
  const engine = fixture(); engine.apply([
    { type: 'addVariable', variable: { name: 'guard', type: 'boolean', value: true } },
    update('button', { interactions: [interaction([], { condition: exprVar('guard') }), interaction([], { caseMode: 'elseIf', condition: true }), interaction([], { caseMode: 'else' }), interaction([], { name: '独立分支', condition: true })] }),
    { type: 'removeVariable', name: 'guard' }
  ]);
  assert.deepEqual(chooseInteractionCases(node(engine, 'button').interactions, 'click').map(item => item.name), ['独立分支']);
});

test('组件内部状态映射必须指向实际实例状态，拒绝保存文件中伪造的映射', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', panelId: 'panel', nodeIds: ['label'] }, { type: 'createComponent', pageId: 'home', nodeIds: ['panel'], componentId: 'component', name: '面板组件' }, { type: 'insertComponent', pageId: 'home', componentId: 'component', instanceId: 'instance', x: 0, y: 0 }]);
  const snapshot = engine.getSnapshot(), group = snapshot.pages[0].groups[0]; group.internalIds[Object.keys(group.internalIds)[0]] = 'nonexistent-state';
  assert.throws(() => new DocumentEngine(snapshot), { code: 'VALIDATION_ERROR' });
});
