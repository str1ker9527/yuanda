import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DocumentEngine, createBlankProject, makeNode, validateProject } from '../app/core/document.mjs';
import { captureLibraryItem, validateLibraryItem } from '../app/core/library-model.mjs';
import { resolveContainerView } from '../app/core/view-model.mjs';

const h = { uuid: randomUUID, createBlankProject, validateProject };
const named = (id, style, parentId = null, stateStyles = {}) => ({ id, name: id, parentId, overrideKeys: Object.keys(style), style: { ...makeNode('rectangle').style, ...style }, stateStyles });
const node = (id, type = 'rectangle', style = {}, extra = {}) => ({ ...makeNode(type, { id, text: id, style, ...extra }), styleOverrideKeys: Object.keys(style), defaultStyleSetId: extra.defaultStyleSetId ?? null });
function fixture() {
  const p = createBlankProject('来源'); p.id = 'source-project'; p.pages[0].id = 'p'; p.styleInheritanceVersion = 1;
  p.defaultStyleSets = [
    { id: 'source-default', name: '来源默认', byType: { rectangle: { style: { radius: 12, fontSize: 21 }, stateStyles: { hover: { color: '#123456' } } } } },
    { id: 'explicit-default', name: '固定默认', byType: { button: { style: { radius: 19 }, stateStyles: { selected: { color: '#654321' } } } } },
    { id: 'unused-default', name: '未使用默认', byType: {} }
  ]; p.defaultStyleSetId = 'source-default';
  p.styles = [named('parent', { fill: '#AA2200' }, null, { hover: { fill: '#00AA22' } }), named('child', { strokeWidth: 5 }, 'parent', { hover: { strokeWidth: 8 } }), named('unused-style', { fill: '#EEEEEE' })];
  p.pages[0].nodes = [node('a', 'rectangle', { color: '#202020' }, { styleId: 'child' }), node('b', 'button', {}, { styleId: 'child', defaultStyleSetId: 'explicit-default' })];
  return new DocumentEngine(p);
}
const capture = (e, ids = ['a', 'b']) => captureLibraryItem(e.getSnapshot(), { pageId: 'p', nodeIds: ids, name: '继承条目', description: '' }, h).item;
const insert = (e, item) => e.apply([{ type: 'insertLibraryItem', pageId: e.getSnapshot().pages[0].id, item, conflictPolicy: 'copy', x: 400, y: 100 }]);
const appearance = (e, id) => resolveContainerView(e.getSnapshot(), e.getSnapshot().pages[0].id).nodes.find(n => n.id === id);

test('库只捕获命名父链和实际默认集；固定来源默认引用且不写最高局部覆盖', () => {
  const e = fixture(), before = e.getSnapshot(), item = capture(e);
  assert.deepEqual(e.getSnapshot(), before);
  assert.deepEqual(item.project.styles.map(s => s.id), ['parent', 'child']);
  assert.deepEqual(item.project.defaultStyleSets.map(s => s.id), ['source-default', 'explicit-default']);
  assert.equal(item.project.defaultStyleSetId, null);
  assert.deepEqual(item.project.pages[0].nodes.map(n => n.defaultStyleSetId), ['source-default', 'explicit-default']);
  assert.deepEqual(item.project.pages[0].nodes.map(n => n.styleOverrideKeys), [['color'], []]);
  assert.equal(validateLibraryItem(JSON.parse(JSON.stringify(item)), h), true);
});

test('同ID宿主默认和命名定义保持不变；导入新父链更新继续穿透默认层', () => {
  const item = capture(fixture()), p = createBlankProject('宿主'); p.pages[0].id = 'host';
  p.defaultStyleSets = [{ id: 'source-default', name: '来源默认', byType: { rectangle: { style: { radius: 1, fontSize: 9 }, stateStyles: {} } } }]; p.defaultStyleSetId = 'source-default';
  p.styles = [named('parent', { fill: '#0000FF' }), named('child', { strokeWidth: 1 }, 'parent')]; p.pages[0].nodes = [node('existing', 'rectangle', {}, { styleId: 'child' })];
  const e = new DocumentEngine(p), before = e.getSnapshot(); insert(e, item); const saved = e.getSnapshot(), imported = saved.pages[0].nodes.filter(n => n.id !== 'existing'), a = imported.find(n => n.text === 'a');
  assert.equal(saved.defaultStyleSetId, before.defaultStyleSetId); assert.deepEqual(saved.defaultStyleSets[0], before.defaultStyleSets[0]); assert.deepEqual(saved.styles.slice(0, 2), before.styles);
  assert.notEqual(a.defaultStyleSetId, 'source-default'); assert.notEqual(a.styleId, 'child');
  const child = saved.styles.find(s => s.id === a.styleId), parent = saved.styles.find(s => s.id === child.parentId);
  assert.notEqual(parent.id, 'parent'); assert.deepEqual(a.styleOverrideKeys, ['color']);
  assert.equal(appearance(e, a.id).style.radius, 12); assert.equal(appearance(e, a.id).style.fill, '#AA2200');
  assert.deepEqual(appearance(e, a.id).stateStyles.hover, { color: '#123456', fill: '#00AA22', strokeWidth: 8 });
  e.apply([{ type: 'updateStyle', styleId: parent.id, patch: { style: { fill: '#CC6600' }, stateStyles: { hover: { fill: '#00CC66' } } } }]);
  assert.equal(appearance(e, a.id).style.fill, '#CC6600'); assert.equal(appearance(e, a.id).stateStyles.hover.fill, '#00CC66'); assert.equal(appearance(e, 'existing').style.fill, '#0000FF');
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(e.getSnapshot()))).getSnapshot(), e.getSnapshot());
  e.undo(); assert.deepEqual(e.getSnapshot(), saved); e.undo(); assert.deepEqual(e.getSnapshot(), before); e.redo(); assert.deepEqual(e.getSnapshot(), saved);
});

test('纯内置默认来源插入后不接受宿主当前或未来默认；仍可接受新命名修改', () => {
  const source = createBlankProject('无默认集'); source.pages[0].id = 'p'; source.pages[0].nodes = [node('a', 'rectangle', {}, { styleId: 'base' })]; source.styles = [named('base', { color: '#ABCDEF' })];
  const item = capture(new DocumentEngine(source), ['a']); assert.deepEqual(item.project.defaultStyleSets, []);
  const p = createBlankProject('宿主'); p.defaultStyleSets = [{ id: 'hot', name: 'Hot', byType: { rectangle: { style: { fill: '#FF0000' }, stateStyles: { hover: { fill: '#FFFF00' } } } } }]; p.defaultStyleSetId = 'hot';
  const e = new DocumentEngine(p); insert(e, item); const saved = e.getSnapshot(), a = saved.pages[0].nodes[0], set = saved.defaultStyleSets.find(s => s.id === a.defaultStyleSetId);
  assert(set); assert.deepEqual(set.byType, {}); assert.equal(saved.defaultStyleSetId, 'hot'); assert.equal(appearance(e, a.id).style.fill, '#FFFFFF'); assert.deepEqual(appearance(e, a.id).stateStyles, {});
  e.apply([{ type: 'updateStyle', styleId: a.styleId, patch: { style: { fill: '#0000FF' } } }]); assert.equal(appearance(e, a.id).style.fill, '#0000FF');
  const switched = e.getSnapshot(); switched.defaultStyleSets[0].byType.rectangle.style.fill = '#00FF00'; e.replace(switched); assert.equal(appearance(e, a.id).style.fill, '#0000FF');
});

test('嵌套母版的默认和命名状态依赖完整重映射，定义继续同步', () => {
  const source = fixture(); source.apply([{ type: 'createComponent', pageId: 'p', componentId: 'inner', nodeIds: ['a'], name: '内层' }, { type: 'insertComponent', pageId: 'p', componentId: 'inner', instanceId: 'inner-copy', x: 100, y: 100 }]);
  const members = source.getSnapshot().pages[0].groups.find(g => g.id === 'inner-copy').nodeIds;
  source.apply([{ type: 'createComponent', pageId: 'p', componentId: 'outer', nodeIds: members, name: '外层' }, { type: 'insertComponent', pageId: 'p', componentId: 'outer', instanceId: 'outer-copy', x: 300, y: 100 }]);
  const ids = source.getSnapshot().pages[0].groups.find(g => g.id === 'outer-copy').nodeIds, item = capture(source, ids), target = new DocumentEngine(createBlankProject('目标')); insert(target, item);
  const saved = target.getSnapshot(), leaf = saved.components.find(c => c.name === '内层').nodes[0], parent = saved.styles.find(s => s.id === saved.styles.find(s => s.id === leaf.styleId).parentId), inserted = saved.pages[0].nodes[0];
  assert.equal(appearance(target, inserted.id).style.radius, 12); assert.equal(appearance(target, inserted.id).stateStyles.hover.strokeWidth, 8);
  target.apply([{ type: 'updateStyle', styleId: parent.id, patch: { style: { fill: '#112233' } } }]); assert.equal(appearance(target, inserted.id).style.fill, '#112233'); assert.deepEqual(leaf.styleOverrideKeys, ['color']);
});

test('旧库迁移保留关联差异和状态，不把来源默认缓存错误变成新继承', () => {
  const e = fixture(), item = capture(e, ['a']), legacy = structuredClone(item);
  delete legacy.project.styleInheritanceVersion; delete legacy.project.defaultStyleSets; delete legacy.project.defaultStyleSetId;
  legacy.project.styles = [{ id: 'old-style', name: '旧样式', style: makeNode('rectangle', { style: { fill: '#990000' } }).style }];
  const old = legacy.project.pages[0].nodes[0]; old.styleId = 'old-style'; old.style.fill = '#770000'; old.stateStyles = { hover: { fill: '#007700' } }; delete old.styleOverrideKeys; delete old.defaultStyleSetId;
  assert.equal(validateLibraryItem(legacy, h), true); const target = new DocumentEngine(createBlankProject('目标')); insert(target, legacy); const added = target.getSnapshot().pages[0].nodes[0];
  assert.equal(appearance(target, added.id).style.fill, '#770000'); assert.equal(appearance(target, added.id).stateStyles.hover.fill, '#007700'); assert(added.styleOverrideKeys.includes('fill'));
  const local = structuredClone(legacy); local.project.pages[0].nodes[0].styleId = null; const target2 = new DocumentEngine(createBlankProject()); insert(target2, local); assert.equal(appearance(target2, target2.getSnapshot().pages[0].nodes[0].id).style.fill, '#770000');
});

test('坏父链和默认依赖拒绝整笔事务，已生成资源与revision不泄漏', () => {
  for (const mutate of [p => { p.styles.find(s => s.id === 'parent').parentId = 'child'; }, p => { p.defaultStyleSets = []; }, p => { p.styles.find(s => s.id === 'child').overrideKeys.push('notStyle'); }]) {
    const item = capture(fixture()); mutate(item.project); const target = new DocumentEngine(createBlankProject()), before = target.getSnapshot();
    assert.throws(() => target.apply([{ type: 'renameProject', name: '不应保留' }, { type: 'insertLibraryItem', pageId: before.pages[0].id, item, conflictPolicy: 'copy' }])); assert.deepEqual(target.getSnapshot(), before); assert.equal(target.revision, 0); assert.equal(target.canUndo, false);
  }
});

test('导入超过默认集上限时，资源、目标元件和历史一起回滚', () => {
  const item = capture(fixture()), p = createBlankProject('容量目标');
  p.defaultStyleSets = Array.from({ length: 100 }, (_, index) => ({ id: 'set-' + index, name: '默认 ' + index, byType: {} })); p.defaultStyleSetId = 'set-0';
  const target = new DocumentEngine(p), before = target.getSnapshot(); assert.throws(() => insert(target, item)); assert.deepEqual(target.getSnapshot(), before); assert.equal(target.revision, 0); assert.equal(target.canUndo, false);
});

test('旧库带图迁移和空来源默认集不会增加图片存储副本', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGPgEpH7D8IACDMCd0kivAIAAAAASUVORK5CYII=', item = capture(fixture(), ['a']);
  delete item.project.styleInheritanceVersion; delete item.project.defaultStyleSets; delete item.project.defaultStyleSetId;
  const old = item.project.pages[0].nodes[0]; old.styleId = null; delete old.styleOverrideKeys; delete old.defaultStyleSetId; old.style.fillPaint = { type: 'image', src: png, fit: 'cover', positionX: .5, positionY: .5 }; item.project.styles = [];
  const target = new DocumentEngine(createBlankProject()); insert(target, item); const saved = target.getSnapshot();
  assert.equal(JSON.stringify(saved).split(png).length - 1, 1); assert.equal(saved.defaultStyleSets.length, 1); assert.deepEqual(saved.defaultStyleSets[0].byType, {});
  assert.equal(appearance(target, saved.pages[0].nodes[0].id).style.fillPaint.src, png);
});
