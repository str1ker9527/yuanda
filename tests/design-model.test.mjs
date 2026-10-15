import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankProject, makeNode, DocumentEngine, validateProject, normalizeProject } from '../app/core/document.mjs';
import { DESIGN_NODE_KEYS, DESIGN_TYPES } from '../app/core/design-model.mjs';

function projectFixture() {
  const project = createBlankProject('设计模型测试'); project.id = 'design-project'; project.pages[0].id = 'home';
  project.pages[0].nodes = [makeNode('button', { id: 'trigger', x: 40, y: 60, text: '触发' }), makeNode('text', { id: 'target', x: 220, y: 70, text: '等待' })];
  project.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'setText', targetId: 'target', value: '成功' }] }];
  return project;
}
const snapshotPage = engine => engine.getSnapshot().pages.find(page => page.id === 'home');
const componentCommands = [
  { type: 'createComponent', pageId: 'home', nodeIds: ['trigger', 'target'], componentId: 'hero', name: '反馈组件' },
  { type: 'insertComponent', pageId: 'home', componentId: 'hero', instanceId: 'instance-a', x: 400, y: 300 },
  { type: 'insertComponent', pageId: 'home', componentId: 'hero', instanceId: 'instance-b', x: 100, y: 500 }
];

test('旧 v1 项目迁移补齐字段且不改变原始输入；重新保存再打开保持一致', () => {
  const legacy = projectFixture(); delete legacy.styles; delete legacy.components;
  for (const page of legacy.pages) { delete page.parentId; delete page.guides; delete page.groups; for (const node of page.nodes) for (const key of DESIGN_NODE_KEYS) delete node[key]; }
  const before = JSON.stringify(legacy); assert.equal(validateProject(legacy), true);
  const engine = new DocumentEngine(legacy), snapshot = engine.getSnapshot();
  assert.equal(JSON.stringify(legacy), before); assert.deepEqual(snapshot, normalizeProject(legacy));
  assert.deepEqual(snapshot.styles, []); assert.deepEqual(snapshot.components, []); assert.equal(snapshot.pages[0].parentId, null); assert.equal(snapshot.pages[0].nodes[0].annotation, '');
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(snapshot))).getSnapshot(), snapshot);
});

test('所有新基础元件有可编辑模型，表单值、选项及表格内容通过往返校验', () => {
  const project = createBlankProject(); project.pages[0].nodes = DESIGN_TYPES.map(type => makeNode(type));
  const engine = new DocumentEngine(project); assert.equal(validateProject(engine.getSnapshot()), true);
  const table = project.pages[0].nodes.find(node => node.type === 'table'); assert.ok(table.rows.length > 0);
  const dropdown = project.pages[0].nodes.find(node => node.type === 'select'); assert.equal(dropdown.options.length, 2);
  const line = project.pages[0].nodes.find(node => node.type === 'line'); assert.equal(line.style.strokeWidth, 2);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(project))).getSnapshot(), project);
  for (const patch of [{ checked: 'yes' }, { options: [3] }, { rows: [['x', {}]] }, { annotation: 99 }]) {
    assert.throws(() => engine.apply([{ type: 'updateNode', pageId: project.pages[0].id, nodeId: table.id, patch }]), { code: 'VALIDATION_ERROR' });
  }
});

test('页面有层级与明确排序，删除父页提升子页而不丢子页', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([{ type: 'addPage', page: { id: 'child', name: '子页' } }, { type: 'addPage', page: { id: 'grandchild', name: '孙页' } }, { type: 'reparentPage', pageId: 'child', parentId: 'home' }, { type: 'reparentPage', pageId: 'grandchild', parentId: 'child' }, { type: 'reorderPage', pageId: 'grandchild', index: 0 }]);
  assert.deepEqual(engine.getSnapshot().pages.map(page => page.id), ['grandchild', 'home', 'child']);
  engine.apply([{ type: 'removePage', pageId: 'child' }]);
  assert.equal(engine.getSnapshot().pages.find(page => page.id === 'grandchild').parentId, 'home');
  engine.undo(); assert.equal(engine.getSnapshot().pages.find(page => page.id === 'grandchild').parentId, 'child');
});

test('页面循环和失效父引用被整体拒绝，前置改名不会泄漏', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply([{ type: 'addPage', page: { id: 'child', parentId: 'home' } }]); const before = engine.getSnapshot(), revision = engine.revision;
  for (const parentId of ['child', 'missing', 'home']) {
    assert.throws(() => engine.apply([{ type: 'renameProject', name: '不应保留' }, { type: 'reparentPage', pageId: 'home', parentId }]), { code: 'VALIDATION_ERROR' });
    assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, revision);
  }
});

test('参考线与注释在命令、撤销和保存中真实持久化', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([{ type: 'setPageGuides', pageId: 'home', guides: { horizontal: [80, 300], vertical: [64, 600] } }, { type: 'updateNode', pageId: 'home', nodeId: 'trigger', patch: { annotation: '按钮先反馈，随后进入详情。' } }]);
  const result = engine.getSnapshot(); assert.deepEqual(result.pages[0].guides.vertical, [64, 600]); assert.equal(result.pages[0].nodes[0].annotation, '按钮先反馈，随后进入详情。');
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(result))).getSnapshot(), result);
  engine.undo(); assert.deepEqual(snapshotPage(engine).guides.horizontal, []); engine.redo(); assert.deepEqual(engine.getSnapshot(), result);
  assert.throws(() => engine.apply([{ type: 'setPageGuides', pageId: 'home', guides: { horizontal: [80, 80], vertical: [] } }]), { code: 'VALIDATION_ERROR' });
});

test('命名样式同步多个元件，局部改色保留关联和其他属性继承', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([{ type: 'addStyle', style: { id: 'brand-style', name: '品牌按钮', style: { fill: '#229966', color: '#FFFFFF' } } }, { type: 'applyStyle', pageId: 'home', nodeIds: ['trigger', 'target'], styleId: 'brand-style' }]);
  engine.apply([{ type: 'updateStyle', styleId: 'brand-style', patch: { name: '新版品牌', style: { fill: '#112233', radius: 24 } } }]);
  assert.ok(snapshotPage(engine).nodes.every(node => node.style.fill === '#112233' && node.style.radius === 24));
  engine.apply([{ type: 'updateNode', pageId: 'home', nodeId: 'target', patch: { style: { fill: '#ABCDEF' } } }]);
  engine.apply([{ type: 'updateStyle', styleId: 'brand-style', patch: { style: { fill: '#999999' } } }]);
  assert.equal(snapshotPage(engine).nodes[0].style.fill, '#999999'); assert.equal(snapshotPage(engine).nodes[1].style.fill, '#ABCDEF'); assert.equal(snapshotPage(engine).nodes[1].styleId, 'brand-style');
  assert.deepEqual(snapshotPage(engine).nodes[1].styleOverrideKeys, ['fill']);
  engine.apply([{type:'updateStyle',styleId:'brand-style',patch:{style:{radius:32}}}]);
  assert.equal(snapshotPage(engine).nodes[1].style.radius,32);
  engine.apply([{type:'clearStyleOverrides',pageId:'home',nodeIds:['target'],keys:['fill']}]);
  assert.equal(snapshotPage(engine).nodes[1].style.fill,'#999999');
});

test('删除命名样式解除引用并保留最后外观，撤销完整恢复', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([{ type: 'addStyle', style: { id: 'brand-style', name: '品牌', style: { fill: '#112233' } } }, { type: 'applyStyle', pageId: 'home', nodeIds: ['trigger'], styleId: 'brand-style' }]); const before = engine.getSnapshot();
  engine.apply([{ type: 'removeStyle', styleId: 'brand-style' }]);
  assert.equal(snapshotPage(engine).nodes[0].styleId, null); assert.deepEqual(snapshotPage(engine).nodes[0].style, before.pages[0].nodes[0].style);
  assert.equal(engine.getSnapshot().styles.length, 0); engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
});

test('组移动整体改变坐标，锁定阻止 Agent 改动、移动和删除', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([{ type: 'groupNodes', pageId: 'home', nodeIds: ['trigger', 'target'], groupId: 'g1', name: '反馈组' }, { type: 'moveGroup', pageId: 'home', groupId: 'g1', dx: 50, dy: 70 }]);
  assert.deepEqual(snapshotPage(engine).nodes.map(node => [node.x, node.y]), [[90, 130], [270, 140]]);
  engine.apply([{ type: 'lockGroup', pageId: 'home', groupId: 'g1', locked: true }]); const before = engine.getSnapshot();
  for (const command of [{ type: 'updateNode', pageId: 'home', nodeId: 'trigger', patch: { text: '改动' } }, { type: 'moveGroup', pageId: 'home', groupId: 'g1', dx: 1, dy: 1 }, { type: 'removeNodes', pageId: 'home', nodeIds: ['trigger'] }, { type: 'ungroup', pageId: 'home', groupId: 'g1' }]) {
    assert.throws(() => engine.apply([command]), { code: 'LOCKED' }); assert.deepEqual(engine.getSnapshot(), before);
  }
  engine.apply([{ type: 'lockGroup', pageId: 'home', groupId: 'g1', locked: false }, { type: 'ungroup', pageId: 'home', groupId: 'g1' }]); assert.deepEqual(snapshotPage(engine).groups, []);
});

test('单元件锁定同样阻止直接指令，解锁后可操作；删除后清理缩小的普通组', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply([{ type: 'updateNode', pageId: 'home', nodeId: 'trigger', patch: { locked: true } }]);
  assert.throws(() => engine.apply([{ type: 'updateNode', pageId: 'home', nodeId: 'trigger', patch: { x: 500 } }]), { code: 'LOCKED' });
  engine.apply([{ type: 'updateNode', pageId: 'home', nodeId: 'trigger', patch: { locked: false } }, { type: 'groupNodes', pageId: 'home', nodeIds: ['trigger', 'target'], groupId: 'g1' }]);
  engine.apply([{ type: 'removeNodes', pageId: 'home', nodeIds: ['target'] }]); assert.deepEqual(snapshotPage(engine).groups, []); assert.deepEqual(snapshotPage(engine).nodes[0].interactions[0].actions, []);
});

test('组件来自选中元件，两个实例偏移独立且内部动作引用各自实例', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply(componentCommands); const project = engine.getSnapshot(), page = project.pages[0], component = project.components[0];
  assert.equal(component.nodes[0].x, 0); assert.equal(component.nodes[1].x, 180); assert.equal(page.nodes.length, 6);
  for (const instance of page.groups) {
    const first = page.nodes.find(node => node.id === instance.nodeIds[0]); assert.equal(first.x, instance.x); assert.equal(first.y, instance.y);
    assert.equal(first.interactions[0].actions[0].targetId, instance.nodeIds[1]);
  }
  assert.notEqual(page.groups[0].nodeIds[0], page.groups[1].nodeIds[0]);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(project))).getSnapshot(), project);
});

test('修改主定义同步所有实例并保留稳定 ID、实例移动偏移和主节点注释', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply(componentCommands);
  const before = engine.getSnapshot(), sourceId = before.components[0].nodes[1].id, previousIds = before.pages[0].groups.map(group => [...group.nodeIds]);
  engine.apply([{ type: 'moveGroup', pageId: 'home', groupId: 'instance-a', dx: 20, dy: -10 }, { type: 'updateComponentNode', componentId: 'hero', nodeId: sourceId, patch: { text: '主定义更新', x: 200, annotation: '同步注释' } }]);
  const page = snapshotPage(engine);
  assert.deepEqual(page.groups.map(group => group.nodeIds), previousIds);
  assert.equal(page.nodes.find(node => node.id === page.groups[0].nodeIds[1]).x, 620);
  assert.equal(page.nodes.find(node => node.id === page.groups[1].nodeIds[1]).x, 300);
  assert.ok(page.groups.every(group => page.nodes.find(node => node.id === group.nodeIds[1]).text === '主定义更新'));
  assert.equal(page.nodes.find(node => node.id === 'target').text, '等待');
});

test('主定义增删节点正确增删实例节点并清理外部引用', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply(componentCommands);
  let project = engine.getSnapshot(); const firstInstanceTarget = project.pages[0].groups[0].nodeIds[1];
  engine.apply([{ type: 'updateNode', pageId: 'home', nodeId: 'trigger', patch: { interactions: [{ event: 'click', actions: [{ type: 'setText', targetId: firstInstanceTarget, value: '外部' }] }] } }]);
  const sourceFirst = { ...project.components[0].nodes[0], interactions: [] }, added = makeNode('checkbox', { id: 'source-new', x: 20, y: 100 });
  engine.apply([{ type: 'updateComponent', componentId: 'hero', patch: { nodes: [sourceFirst, added] } }]);
  project = engine.getSnapshot(); assert.equal(project.pages[0].nodes.some(node => node.id === firstInstanceTarget), false);
  assert.deepEqual(project.pages[0].nodes.find(node => node.id === 'trigger').interactions[0].actions, []);
  for (const group of project.pages[0].groups) assert.equal(project.pages[0].nodes.find(node => node.id === group.nodeIds[1]).type, 'checkbox');
});

test('组件实例不接受直接改内容；解除关联后不再随主定义同步', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply(componentCommands); let project = engine.getSnapshot();
  const instanceNodeId = project.pages[0].groups[0].nodeIds[1], sourceId = project.components[0].nodes[1].id;
  assert.throws(() => engine.apply([{ type: 'updateNode', pageId: 'home', nodeId: instanceNodeId, patch: { text: '本地覆盖' } }]), { code: 'COMPONENT_LINKED' });
  engine.apply([{ type: 'detachComponent', pageId: 'home', instanceId: 'instance-a' }, { type: 'updateNode', pageId: 'home', nodeId: instanceNodeId, patch: { text: '独立内容' } }, { type: 'updateComponentNode', componentId: 'hero', nodeId: sourceId, patch: { text: '主定义内容' } }]);
  project = engine.getSnapshot(); assert.equal(project.pages[0].groups[0].componentId, null); assert.equal(project.pages[0].nodes.find(node => node.id === instanceNodeId).text, '独立内容');
  assert.equal(project.pages[0].nodes.find(node => node.id === project.pages[0].groups[1].nodeIds[1]).text, '主定义内容');
});

test('删除主组件保留所有实例外观和交互；删除实例任一节点清理整个实例', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply(componentCommands); const before = engine.getSnapshot();
  engine.apply([{ type: 'removeComponent', componentId: 'hero' }]);
  assert.equal(engine.getSnapshot().components.length, 0);
  const omitProvenance = nodes => nodes.map(({styleOverrideKeys,...node}) => node);
  assert.deepEqual(omitProvenance(snapshotPage(engine).nodes), omitProvenance(before.pages[0].nodes));
  for (const group of before.pages[0].groups) for (const id of group.nodeIds) {
    const detached = snapshotPage(engine).nodes.find(node => node.id === id);
    assert.deepEqual(new Set(detached.styleOverrideKeys), new Set(Object.keys(detached.style)));
  }
  assert.ok(snapshotPage(engine).groups.every(group => group.componentId === null));
  engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([{ type: 'removeNodes', pageId: 'home', nodeIds: [before.pages[0].groups[0].nodeIds[0]] }]);
  assert.equal(snapshotPage(engine).groups.length, 1); assert.ok(before.pages[0].groups[0].nodeIds.every(id => !snapshotPage(engine).nodes.some(node => node.id === id)));
});

test('命名样式在组件主定义及实例中同步，删除后同样保留外观', () => {
  const engine = new DocumentEngine(projectFixture());
  engine.apply([{ type: 'addStyle', style: { id: 'brand-style', name: '品牌', style: { fill: '#118866' } } }, { type: 'applyStyle', pageId: 'home', nodeIds: ['trigger'], styleId: 'brand-style' }, ...componentCommands]);
  engine.apply([{ type: 'updateStyle', styleId: 'brand-style', patch: { style: { fill: '#553399' } } }]);
  let project = engine.getSnapshot(); assert.equal(project.components[0].nodes[0].style.fill, '#553399');
  for (const group of project.pages[0].groups) assert.equal(project.pages[0].nodes.find(node => node.id === group.nodeIds[0]).style.fill, '#553399');
  engine.apply([{ type: 'removeStyle', styleId: 'brand-style' }]); project = engine.getSnapshot();
  assert.equal(project.components[0].nodes[0].styleId, null); assert.equal(project.components[0].nodes[0].style.fill, '#553399');
});

test('组引用、组件源映射和跨组件源节点引用拒绝无效文件', () => {
  const engine = new DocumentEngine(projectFixture()); engine.apply(componentCommands); const valid = engine.getSnapshot();
  for (const damage of [
    project => { project.pages[0].groups[0].nodeIds[0] = 'missing'; },
    project => { project.pages[0].groups[0].sourceIds[0] = 'missing'; },
    project => { project.pages[0].groups[0].sourceIds[0] = project.pages[0].groups[0].sourceIds[1]; },
    project => { project.pages[0].groups[0].componentId = 'missing'; },
    project => { project.components[0].nodes[0].interactions[0].actions[0].targetId = 'target'; }
  ]) { const invalid = structuredClone(valid); damage(invalid); assert.throws(() => validateProject(invalid), { code: 'VALIDATION_ERROR' }); }
});

test('新增设计能力仍遵守原子批次、版本冲突及一步撤销', () => {
  const engine = new DocumentEngine(projectFixture()); const before = engine.getSnapshot();
  assert.throws(() => engine.apply([...componentCommands, { type: 'setPageGuides', pageId: 'home', guides: { horizontal: ['bad'], vertical: [] } }], { expectedRevision: 0 }), { code: 'VALIDATION_ERROR' });
  assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.canUndo, false); assert.equal(engine.revision, 0);
  engine.apply(componentCommands, { expectedRevision: 0 }); assert.equal(engine.revision, 1);
  assert.throws(() => engine.apply([{ type: 'removeComponent', componentId: 'hero' }], { expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.equal(engine.getSnapshot().components.length, 1);
});

test('不能将引用未选中外部节点的交互静默丢弃为组件', () => {
  const engine = new DocumentEngine(projectFixture()); const before = engine.getSnapshot();
  assert.throws(() => engine.apply([{ type: 'createComponent', pageId: 'home', nodeIds: ['trigger'], name: '不完整组件' }]), { code: 'COMMAND_ERROR' });
  assert.deepEqual(engine.getSnapshot(), before);
});

test('旧节点通过 updatePage 写入后快照仍规范化，非法组件数据原子拒绝', () => {
  const engine = new DocumentEngine(projectFixture()); const oldNode = makeNode('text', { id: 'legacy-added' }); for (const key of DESIGN_NODE_KEYS) delete oldNode[key];
  engine.apply([{ type: 'updatePage', pageId: 'home', patch: { nodes: [oldNode] } }]);
  assert.equal(snapshotPage(engine).nodes[0].annotation, ''); assert.equal(snapshotPage(engine).nodes[0].styleId, null);
  engine.apply([{ type: 'addComponent', component: { id: 'single', name: '独立定义', nodes: [{ id: 'source-one', type: 'text', text: '主定义' }] } }, { type: 'insertComponent', pageId: 'home', componentId: 'single', instanceId: 'single-instance', x: 10, y: 20 }]);
  const before = engine.getSnapshot();
  assert.throws(() => engine.apply([{ type: 'updateComponent', componentId: 'single', patch: { nodes: null } }]), { code: 'VALIDATION_ERROR' }); assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([{ type: 'detachComponent', pageId: 'home', instanceId: 'single-instance' }]); assert.equal(snapshotPage(engine).groups.length, 0); assert.equal(snapshotPage(engine).nodes.length, 2);
});
