import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankProject, makeNode, DocumentEngine, validateProject, normalizeProject, COMPONENT_EDIT_COMMANDS } from '../app/core/document.mjs';
import { assertSameDetachedNodes } from './component-assertions.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGPgEpH7D8IACDMCd0kivAIAAAAASUVORK5CYII=';
const otherPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGOICnD7D8IAD4sD3y2NEkEAAAAASUVORK5CYII=';
const text = (id, value = id) => makeNode('text', { id, text: value, x: 10, y: 20 });
function fixture() {
  const project = createBlankProject('母版画布'); project.id = 'component-test'; project.pages[0].id = 'home';
  project.pages[0].nodes = [text('page-label', '页面')];
  const engine = new DocumentEngine(project);
  engine.apply([
    { type: 'addComponent', component: { id: 'card', name: '卡片', nodes: [text('title', '标题'), makeNode('image', { id: 'photo', x: 10, y: 80, src: png })] } },
    { type: 'insertComponent', pageId: 'home', componentId: 'card', instanceId: 'first', x: 100, y: 200 },
    { type: 'insertComponent', pageId: 'home', componentId: 'card', instanceId: 'second', x: 500, y: 200 }
  ]);
  return engine;
}
const component = (engine, id = 'card') => engine.getSnapshot().components.find(item => item.id === id);
const page = engine => engine.getSnapshot().pages[0];
const group = (engine, id = 'first') => page(engine).groups.find(item => item.id === id);
function instanceNode(engine, sourceId, id = 'first') { const current = page(engine), owner = current.groups.find(group => group.id === id); return current.nodes.find(node => node.id === owner.nodeIds[owner.sourceIds.indexOf(sourceId)]); }
const edit = (commands, componentId = 'card') => ({ type: 'componentCommands', componentId, commands });
const override = (sourceId, patch, instanceId = 'first') => ({ type: 'setComponentOverride', pageId: 'home', instanceId, sourceId, patch });

test('真实母版画布复用添加、修改、复制、图层与命名样式命令，整体同步并一步撤销', () => {
  const engine = fixture(); engine.apply([{ type: 'addStyle', style: { id: 'shared', name: '统一', style: { color: '#334455' } } }]);
  const before = engine.getSnapshot(), ids = group(engine).nodeIds;
  engine.apply([edit([
    { type: 'addNode', node: { type: 'button', id: 'cta', text: '开始' } },
    { type: 'updateNode', pageId: 'card', nodeId: 'title', patch: { text: '新标题', x: 30 } },
    { type: 'applyStyle', nodeIds: ['title'], styleId: 'shared' },
    { type: 'duplicateNodes', nodeIds: ['cta'], idMap: { cta: 'cta-copy' }, dx: 0, dy: 60 },
    { type: 'reorderNode', nodeId: 'cta-copy', index: 0 }
  ])]);
  assert.deepEqual(component(engine).nodes.map(node => node.id), ['cta-copy', 'title', 'photo', 'cta']);
  assert.equal(instanceNode(engine, 'title').text, '新标题'); assert.equal(instanceNode(engine, 'title').x, 130);
  assert.equal(instanceNode(engine, 'title').style.color, '#334455');
  assert.ok(ids.every(id => group(engine).nodeIds.includes(id))); assert.equal(group(engine, 'second').nodeIds.length, 4);
  const after = engine.getSnapshot(); engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.deepEqual(engine.getSnapshot(), after);
});

test('母版背景、注释、参考线与普通组持久化，旧定义只补缺失字段', () => {
  const engine = fixture(); engine.apply([edit([
    { type: 'updatePage', patch: { name: '新卡片', width: 420, height: 300, background: '#FAFAFA', annotation: '这是主定义' } },
    { type: 'setPageGuides', guides: { horizontal: [20], vertical: [10, 300] } },
    { type: 'groupNodes', nodeIds: ['title', 'photo'], groupId: 'source-group' },
    { type: 'moveGroup', groupId: 'source-group', dx: 10, dy: 30 }
  ])]);
  const snapshot = engine.getSnapshot(), saved = JSON.parse(JSON.stringify(snapshot));
  assert.equal(component(engine).background, '#FAFAFA'); assert.equal(component(engine).annotation, '这是主定义');
  assert.deepEqual(component(engine).guides.vertical, [10, 300]); assert.equal(component(engine).nodes[0].y, 50);
  assert.deepEqual(new DocumentEngine(saved).getSnapshot(), snapshot);
  const legacy = structuredClone(snapshot); for (const name of ['background', 'annotation', 'guides', 'groups']) delete legacy.components[0][name];
  for (const owner of legacy.pages[0].groups) delete owner.overrides;
  const original = JSON.stringify(legacy), normalized = normalizeProject(legacy); assert.equal(JSON.stringify(legacy), original);
  assert.equal(normalized.components[0].background, '#FFFFFF'); assert.deepEqual(normalized.pages[0].groups[0].overrides, {});
  const bad = structuredClone(snapshot); bad.components[0].guides = null; assert.throws(() => validateProject(bad), { code: 'VALIDATION_ERROR' });
});

test('白名单隔离其他页面和母版，禁止递归、项目结构和伪造页面字段，失败整批不泄漏', () => {
  const engine = fixture(), before = engine.getSnapshot(), revision = engine.revision;
  const invalid = [
    { type: 'updateNode', pageId: 'home', nodeId: 'page-label', patch: { text: '越权' } },
    { type: 'updateNode', nodeId: 'page-label', patch: { text: '越权' } },
    { type: 'duplicateNodes', nodeIds: ['title'], targetPageId: 'home' },
    { type: 'renameProject', name: '越权' }, { type: 'removeComponent', componentId: 'card' },
    { type: 'componentCommands', componentId: 'card', commands: [] },
    { type: 'updatePage', patch: { nodes: [] } }, { type: 'updatePage', patch: { views: [] } },
    { type: 'updateNode', nodeId: 'title', patch: { interactions: [{ event: 'click', actions: [{ type: 'setText', targetId: 'page-label', value: '越权引用' }] }] } }
  ];
  for (const command of invalid) {
    assert.throws(() => engine.apply([edit([{ type: 'updateNode', nodeId: 'title', patch: { text: '不应留下' } }, command])]));
    assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, revision);
  }
  assert.equal(COMPONENT_EDIT_COMMANDS.includes('componentCommands'), false); assert.ok(Object.isFrozen(COMPONENT_EDIT_COMMANDS));
  const repeated = Array.from({ length: 501 }, () => ({ type: 'updateNode', nodeId: 'title', patch: { text: '批量' } }));
  assert.throws(() => engine.apply([edit(repeated), edit(repeated)]), /1000 项/); assert.deepEqual(engine.getSnapshot(), before);
});

test('母版动态面板归属、移动和内部引用正常映射到每个实例', () => {
  const engine = fixture(); engine.apply([edit([
    { type: 'createDynamicPanel', nodeIds: ['title', 'photo'], panelId: 'source-panel' },
    { type: 'moveContainer', nodeId: 'source-panel', dx: 40, dy: 50 },
    { type: 'updateNode', nodeId: 'title', patch: { interactions: [{ event: 'click', actions: [{ type: 'setVisible', targetId: 'photo', value: false }] }] } }
  ])]);
  assert.equal(component(engine).nodes.find(node => node.id === 'title').x, 50);
  for (const ownerId of ['first', 'second']) {
    const panel = instanceNode(engine, 'source-panel', ownerId), title = instanceNode(engine, 'title', ownerId), photo = instanceNode(engine, 'photo', ownerId);
    assert.deepEqual(panel.panel.states[0].nodeIds, [title.id, photo.id]); assert.equal(title.interactions[0].actions[0].targetId, photo.id);
  }
});

test('文字与图片实例覆盖保留主定义的后续位置样式和其他实例更新', () => {
  const engine = fixture(); engine.apply([override('title', { text: '专用标题' }), override('photo', { src: otherPng })]);
  engine.apply([edit([
    { type: 'updateNode', nodeId: 'title', patch: { text: '第二版标题', x: 60, style: { color: '#778899' } } },
    { type: 'updateNode', nodeId: 'photo', patch: { src: '', width: 220 } }
  ])]);
  assert.equal(instanceNode(engine, 'title').text, '专用标题'); assert.equal(instanceNode(engine, 'title').x, 160); assert.equal(instanceNode(engine, 'title').style.color, '#778899');
  assert.equal(instanceNode(engine, 'title', 'second').text, '第二版标题'); assert.equal(instanceNode(engine, 'photo').src, otherPng); assert.equal(instanceNode(engine, 'photo').width, 220);
  assert.equal(instanceNode(engine, 'photo', 'second').src, '');
  const snapshot = engine.getSnapshot(); assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(snapshot))).getSnapshot(), snapshot);
  engine.apply([{ type: 'clearComponentOverride', pageId: 'home', instanceId: 'first', sourceId: 'title', fields: ['text'] }]);
  assert.equal(instanceNode(engine, 'title').text, '第二版标题'); assert.equal(instanceNode(engine, 'photo').src, otherPng);
  engine.undo(); assert.deepEqual(engine.getSnapshot(), snapshot);
});

test('覆盖保护锁定、拒绝未知字段/源ID/非法图片；直接写实例仍不允许', () => {
  const engine = fixture(); let before = engine.getSnapshot();
  for (const command of [override('missing', { text: '失败' }), override('title', { x: 10 }), override('title', {}), override('title', { src: png }), override('photo', { src: 'https://example.org/image.png' }), override('title', { text: null }), { type: 'updateNode', pageId: 'home', nodeId: instanceNode(engine, 'title').id, patch: { text: '绕过' } }]) {
    assert.throws(() => engine.apply([command])); assert.deepEqual(engine.getSnapshot(), before);
  }
  engine.apply([{ type: 'lockGroup', pageId: 'home', groupId: 'first', locked: true }]); before = engine.getSnapshot();
  assert.throws(() => engine.apply([override('title', { text: '失败' })]), { code: 'LOCKED' }); assert.deepEqual(engine.getSnapshot(), before);
  engine.undo(); engine.apply([edit([{ type: 'updateNode', nodeId: 'title', patch: { locked: true } }])]);
  assert.throws(() => engine.apply([override('title', { text: '失败' })]), { code: 'LOCKED' });
});

test('复制与跨页复制保留实例覆盖，解除或删除定义后保留最终内容并移除关联数据', () => {
  const engine = fixture(); engine.apply([override('title', { text: '保留的覆盖' })]);
  const original = group(engine), titleId = instanceNode(engine, 'title').id;
  engine.apply([{ type: 'addPage', page: { id: 'other', name: '其他' } }, { type: 'duplicateNodes', pageId: 'home', nodeIds: [titleId], targetPageId: 'other', dx: 30, dy: 40, idMap: { [original.id]: 'copied-group' } }]);
  const copiedPage = engine.getSnapshot().pages[1], copiedGroup = copiedPage.groups[0];
  assert.equal(copiedGroup.id, 'copied-group'); assert.deepEqual(copiedGroup.overrides, { title: { text: '保留的覆盖' } });
  assert.equal(copiedPage.nodes.find(node => node.id === copiedGroup.nodeIds[copiedGroup.sourceIds.indexOf('title')]).text, '保留的覆盖');
  engine.apply([{ type: 'detachComponent', pageId: 'home', instanceId: 'first' }, { type: 'removeComponent', componentId: 'card' }]);
  assert.equal(page(engine).nodes.find(node => node.id === titleId).text, '保留的覆盖');
  assert.ok(engine.getSnapshot().pages.flatMap(page => page.groups).every(group => group.componentId === null && !Object.keys(group.overrides).length));
});

test('删除主节点清理实例、覆盖与对实例的外部动作引用，撤销全部恢复', () => {
  const engine = fixture(); engine.apply([override('title', { text: '将删除' }), { type: 'updateNode', pageId: 'home', nodeId: 'page-label', patch: { interactions: [{ event: 'click', actions: [{ type: 'setText', targetId: instanceNode(engine, 'title').id, value: '更新' }] }] } }]);
  const before = engine.getSnapshot(); engine.apply([edit([{ type: 'removeNodes', nodeIds: ['title'] }])]);
  assert.deepEqual(group(engine).sourceIds, ['photo']); assert.deepEqual(group(engine).overrides, {});
  assert.deepEqual(page(engine).nodes.find(node => node.id === 'page-label').interactions[0].actions, []);
  engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
});

test('嵌套母版按依赖顺序同步，节点ID稳定，内层覆盖与外层专用覆盖独立', () => {
  const engine = fixture(); engine.apply([{ type: 'addComponent', component: { id: 'shell', name: '容器母版', nodes: [text('shell-label')] } }, edit([{ type: 'insertComponent', componentId: 'card', instanceId: 'nested-card', x: 80, y: 100 }, { type: 'setComponentOverride', instanceId: 'nested-card', sourceId: 'title', patch: { text: '嵌套覆盖' } }], 'shell'), { type: 'insertComponent', pageId: 'home', componentId: 'shell', instanceId: 'shell-on-page', x: 300, y: 400 }]);
  const nested = component(engine, 'shell').groups[0], nestedTitleId = nested.nodeIds[nested.sourceIds.indexOf('title')], outerId = instanceNode(engine, nestedTitleId, 'shell-on-page').id;
  engine.apply([override(nestedTitleId, { text: '外层覆盖' }, 'shell-on-page'), edit([{ type: 'updateNode', nodeId: 'title', patch: { text: '基础新版', x: 40, style: { color: '#123456' } } }])]);
  assert.equal(component(engine, 'shell').nodes.find(node => node.id === nestedTitleId).text, '嵌套覆盖');
  const result = instanceNode(engine, nestedTitleId, 'shell-on-page'); assert.equal(result.id, outerId); assert.equal(result.text, '外层覆盖'); assert.equal(result.x, 420); assert.equal(result.style.color, '#123456');
  assert.equal(validateProject(engine.getSnapshot()), true); assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(engine.getSnapshot()))).getSnapshot(), engine.getSnapshot());
});

test('嵌套母版不能循环或越过16层，失败不影响之前保存内容', () => {
  const engine = fixture(), before = engine.getSnapshot();
  assert.throws(() => engine.apply([edit([{ type: 'insertComponent', componentId: 'card', x: 0, y: 0 }])]), /循环/); assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([{ type: 'addComponent', component: { id: 'parent', nodes: [text('parent-label')] } }, edit([{ type: 'insertComponent', componentId: 'card', x: 0, y: 0 }], 'parent')]);
  const second = engine.getSnapshot(); assert.throws(() => engine.apply([edit([{ type: 'insertComponent', componentId: 'parent', x: 0, y: 0 }])]), /循环/); assert.deepEqual(engine.getSnapshot(), second);
  const deep = fixture();
  for (let index = 1; index <= 15; index++) deep.apply([{ type: 'addComponent', component: { id: `level-${index}`, nodes: [text(`level-label-${index}`)] } }, edit([{ type: 'insertComponent', componentId: index === 1 ? 'card' : `level-${index - 1}`, x: 1, y: 1 }], `level-${index}`)]);
  const deepest = deep.getSnapshot();
  assert.throws(() => deep.apply([{ type: 'addComponent', component: { id: 'level-16', nodes: [text('level-label-16')] } }, edit([{ type: 'insertComponent', componentId: 'level-15', x: 1, y: 1 }], 'level-16')]), /16 层/);
  assert.deepEqual(deep.getSnapshot(), deepest);
});

test('删除嵌套主定义会解除子实例但保留父母版与页面最终内容', () => {
  const engine = fixture(); engine.apply([{ type: 'addComponent', component: { id: 'shell', nodes: [text('shell-label')] } }, edit([{ type: 'insertComponent', componentId: 'card', instanceId: 'nested-card', x: 80, y: 100 }], 'shell'), { type: 'insertComponent', pageId: 'home', componentId: 'shell', instanceId: 'shell-on-page', x: 300, y: 400 }]);
  const before = engine.getSnapshot(), shellNodes = component(engine, 'shell').nodes, pageNodes = page(engine).nodes;
  engine.apply([{ type: 'removeComponent', componentId: 'card' }]);
  assertSameDetachedNodes(component(engine, 'shell').nodes, shellNodes); assertSameDetachedNodes(page(engine).nodes, pageNodes); assert.equal(component(engine, 'shell').groups[0].componentId, null);
  engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
});

test('组件命令遵守修订号冲突、锁定与元件容量限制', () => {
  const engine = fixture(); const before = engine.getSnapshot();
  assert.throws(() => engine.apply([edit([{ type: 'updateNode', nodeId: 'title', patch: { text: '旧写入' } }])], { expectedRevision: engine.revision - 1 }), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([edit([{ type: 'groupNodes', nodeIds: ['title', 'photo'], groupId: 'locked-source' }, { type: 'lockGroup', groupId: 'locked-source', locked: true }])]);
  assert.throws(() => engine.apply([edit([{ type: 'removeNodes', nodeIds: ['title'] }])]), { code: 'LOCKED' });
  assert.throws(() => engine.apply([{ type: 'updateComponentNode', componentId: 'card', nodeId: 'title', patch: { text: '绕过锁' } }]), { code: 'LOCKED' });
  const many = fixture(), huge = Array.from({ length: 3400 }, (_, index) => text(`many-${index}`)), previous = many.getSnapshot();
  assert.throws(() => many.apply([{ type: 'updateComponent', componentId: 'card', patch: { nodes: huge } }]), /数量限制|10000/);
  assert.deepEqual(many.getSnapshot(), previous);
});
