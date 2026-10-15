import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentEngine, createBlankProject, makeNode } from '../app/core/document.mjs';

// Minimal regressions from independent hierarchy review. All fixtures are original,
// in-memory projects; no installed application, local reports or filesystem needed.
function fixture(ids = ['a', 'b', 'c']) {
  const project = createBlankProject('层级边界回归');
  project.id = 'hierarchy-regression-project';
  project.pages[0].id = 'page';
  project.pages[0].nodes = ids.map((id, index) => makeNode('rectangle', {
    id, x: index * 100, y: index * 20, width: 80, height: 60
  }));
  return new DocumentEngine(project);
}

const page = engine => engine.getSnapshot().pages[0];
const node = (engine, id) => page(engine).nodes.find(item => item.id === id);
const group = (engine, id) => page(engine).groups.find(item => item.id === id);
const nodeItem = id => ({ kind: 'node', id });
const groupItem = id => ({ kind: 'group', id });
const command = (type, fields = {}) => ({ type, pageId: 'page', ...fields });
const apply = (engine, type, fields) => engine.apply([command(type, fields)]);

function addPanel(engine, id = 'panel', nodeIds = []) {
  apply(engine, 'createDynamicPanel', { panelId: id, nodeIds });
  return node(engine, id).panel.initialStateId;
}

function addMaster(engine, nodes = [makeNode('text', { id: 'ma' }), makeNode('text', { id: 'mb' })]) {
  engine.apply([
    { type: 'addComponent', component: { id: 'master', name: '测试母版', nodes } },
    command('insertComponent', { componentId: 'master', instanceId: 'instance', x: 50, y: 60 })
  ]);
}

function capture(engine, nodeIds) {
  const snapshot = engine.getSnapshot(), source = snapshot.pages[0];
  return { projectId: snapshot.id, sourceId: source.id, nodes: source.nodes,
    groups: source.groups, views: source.views, nodeIds };
}

function assertRejectedAtomically(engine, rejectedCommand, code) {
  const before = engine.getSnapshot(), revision = engine.revision;
  assert.throws(() => engine.apply([
    { type: 'renameProject', name: '不应提交的前置修改' }, rejectedCommand
  ]), { code });
  assert.deepEqual(engine.getSnapshot(), before);
  assert.equal(engine.revision, revision);
}

function assertRoundTripAndHistory(engine, before, after = engine.getSnapshot()) {
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(), after);
  engine.undo();
  assert.deepEqual(engine.getSnapshot(), before);
  engine.redo();
  assert.deepEqual(engine.getSnapshot(), after);
}

test('锁定面板后不能解开其内部的嵌套组，失败批次完整回滚', () => {
  const engine = fixture();
  engine.apply([
    command('groupItems', { items: [nodeItem('a'), nodeItem('b')], groupId: 'inner' }),
    command('groupItems', { items: [groupItem('inner'), nodeItem('c')], groupId: 'outer' })
  ]);
  const stateId = addPanel(engine);
  engine.apply([
    command('reparentItems', { items: [groupItem('outer')], parent: { kind: 'panelState', panelId: 'panel', stateId } }),
    command('updateNode', { nodeId: 'panel', patch: { locked: true } })
  ]);

  assertRejectedAtomically(engine, command('ungroup', { groupId: 'inner' }), 'LOCKED');
  assert.equal(group(engine, 'inner').parentGroupId, 'outer');
});

test('自身解锁例外不能绕过祖先面板的锁定', () => {
  const engine = fixture(['a']);
  addPanel(engine, 'panel', ['a']);
  engine.apply([
    command('updateNode', { nodeId: 'a', patch: { locked: true } }),
    command('updateNode', { nodeId: 'panel', patch: { locked: true } })
  ]);

  assertRejectedAtomically(engine, command('updateNode', { nodeId: 'a', patch: { locked: false } }), 'LOCKED');
  assert.equal(node(engine, 'a').locked, true);
});

test('母版删减为单节点时清理过小的普通父组并保留实例关联', () => {
  const engine = fixture(['outside']);
  addMaster(engine);
  apply(engine, 'groupItems', { items: [groupItem('instance'), nodeItem('outside')], groupId: 'outer' });
  apply(engine, 'removeNodes', { nodeIds: ['outside'] });
  const originalInstance = group(engine, 'instance');
  const remainingId = originalInstance.nodeIds[originalInstance.sourceIds.indexOf('mb')];
  assert.equal(group(engine, 'outer').nodeIds.length, 2);
  const before = engine.getSnapshot();

  engine.apply([{ type: 'componentCommands', componentId: 'master', commands: [
    { type: 'removeNodes', nodeIds: ['ma'] }
  ] }]);

  assert.equal(group(engine, 'outer'), undefined);
  assert.equal(group(engine, 'instance').componentId, 'master');
  assert.equal(group(engine, 'instance').parentGroupId, null);
  assert.deepEqual(group(engine, 'instance').nodeIds, [remainingId]);
  assertRoundTripAndHistory(engine, before);
});

test('旧状态成员命令不能只移走母版实例的一个根节点', () => {
  const engine = fixture([]);
  addMaster(engine);
  const stateId = addPanel(engine), members = group(engine, 'instance').nodeIds;

  assertRejectedAtomically(engine, command('assignPanelNodes', {
    panelId: 'panel', stateId, nodeIds: [members[0]]
  }), 'COMPONENT_LINKED');
  assert.deepEqual(node(engine, 'panel').panel.states[0].nodeIds, []);
  assert.deepEqual(group(engine, 'instance').nodeIds, members);
});

test('复制内层组只复制所选组，不携带未选中的祖先及兄弟元件', () => {
  const engine = fixture();
  engine.apply([
    command('groupItems', { items: [nodeItem('a'), nodeItem('b')], groupId: 'inner' }),
    command('groupItems', { items: [groupItem('inner'), nodeItem('c')], groupId: 'outer' })
  ]);
  const fragment = capture(engine, ['a', 'b']), recorded = structuredClone(fragment);
  const before = engine.getSnapshot();

  apply(engine, 'pasteFragment', {
    fragment, idMap: { a: 'copy-a', b: 'copy-b', c: 'copy-c', inner: 'copy-inner', outer: 'copy-outer' }
  });

  assert.equal(node(engine, 'copy-c'), undefined);
  assert.equal(group(engine, 'copy-outer'), undefined);
  assert.deepEqual(group(engine, 'copy-inner').nodeIds, ['copy-a', 'copy-b']);
  assert.equal(group(engine, 'copy-inner').parentGroupId, null);
  assert.deepEqual(group(engine, 'outer'), before.pages[0].groups.find(item => item.id === 'outer'));
  assert.deepEqual(fragment, recorded);
  assertRoundTripAndHistory(engine, before);
});

test('跨页复制过滤悬空连线后，提升存活子实例而不留下失效父组引用', () => {
  const engine = fixture(['outside']);
  addMaster(engine, [makeNode('text', { id: 'ma' })]);
  const memberId = group(engine, 'instance').nodeIds[0];
  apply(engine, 'addNode', { node: makeNode('connector', {
    id: 'wire', connector: { from: { nodeId: memberId, side: 'right' },
      to: { nodeId: 'outside', side: 'left' }, route: 'straight', arrow: 'end' }
  }) });
  apply(engine, 'groupItems', { items: [groupItem('instance'), nodeItem('wire')], groupId: 'outer' });
  const fragment = capture(engine, [memberId, 'wire']);
  engine.apply([{ type: 'addPage', page: { id: 'destination' } }]);
  const before = engine.getSnapshot();

  engine.apply([{ type: 'pasteFragment', pageId: 'destination', fragment,
    idMap: { instance: 'copy-instance', outer: 'copy-outer', wire: 'copy-wire', [memberId]: 'copy-member' } }]);

  const destination = engine.getSnapshot().pages.find(item => item.id === 'destination');
  assert.deepEqual(destination.nodes.map(item => item.id), ['copy-member']);
  assert.equal(destination.groups.length, 1);
  assert.equal(destination.groups[0].id, 'copy-instance');
  assert.equal(destination.groups[0].componentId, 'master');
  assert.equal(destination.groups[0].parentGroupId, null);
  assert.deepEqual(engine.getSnapshot().pages[0], before.pages[0]);
  assertRoundTripAndHistory(engine, before);
});

test('按所有根节点移动完整母版实例时保留关联，不静默解除母版', () => {
  const engine = fixture([]);
  addMaster(engine);
  const stateId = addPanel(engine), originalInstance = group(engine, 'instance');
  const before = engine.getSnapshot();

  apply(engine, 'reparentItems', { items: originalInstance.nodeIds.map(nodeItem),
    parent: { kind: 'panelState', panelId: 'panel', stateId } });

  assert.deepEqual(group(engine, 'instance'), originalInstance);
  assert.deepEqual(new Set(node(engine, 'panel').panel.states[0].nodeIds), new Set(originalInstance.nodeIds));
  assertRoundTripAndHistory(engine, before);
});

test('仅选择面板根移动完整母版，内部状态及子节点映射保持稳定', () => {
  const engine = fixture([]), masterPanel = makeNode('dynamicPanel', { id: 'master-panel' });
  masterPanel.panel.states[0].nodeIds = ['master-child'];
  addMaster(engine, [masterPanel, makeNode('text', { id: 'master-child' })]);
  const stateId = addPanel(engine, 'destination'), originalInstance = group(engine, 'instance');
  const rootId = originalInstance.nodeIds[originalInstance.sourceIds.indexOf('master-panel')];
  const childId = originalInstance.nodeIds[originalInstance.sourceIds.indexOf('master-child')];
  const originalPanel = node(engine, rootId), before = engine.getSnapshot();

  apply(engine, 'reparentItems', { items: [nodeItem(rootId)],
    parent: { kind: 'panelState', panelId: 'destination', stateId } });

  assert.deepEqual(group(engine, 'instance'), originalInstance);
  assert.deepEqual(node(engine, rootId), originalPanel);
  assert.deepEqual(node(engine, 'destination').panel.states[0].nodeIds, [rootId]);
  assert.deepEqual(node(engine, rootId).panel.states[0].nodeIds, [childId]);
  assertRoundTripAndHistory(engine, before);
});
