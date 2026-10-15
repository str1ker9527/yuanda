import test from 'node:test';
import assert from 'node:assert/strict';
import { treePages, pageMoveCommands, reorderKeys, boxOf, measurementLines } from '../app/renderer/navigation-model.mjs';
import { DocumentEngine, createBlankProject } from '../app/core/document.mjs';

test('page drag reorders actual engine pages and preserves a valid tree', () => {
  const project = createBlankProject('导航测试'); project.pages[0].id = 'a';
  const engine = new DocumentEngine(project);
  engine.apply([{ type: 'addPage', page: { id: 'b', name: 'B' } }, { type: 'addPage', page: { id: 'c', name: 'C' } }]);
  engine.apply(pageMoveCommands(engine.getSnapshot().pages, 'c', 'a', 'inside'));
  assert.equal(engine.getSnapshot().pages.find(item => item.id === 'c').parentId, 'a');
  assert.deepEqual(treePages(engine.getSnapshot().pages).map(({ page, depth }) => [page.id, depth]), [['a', 0], ['c', 1], ['b', 0]]);
  assert.throws(() => pageMoveCommands(engine.getSnapshot().pages, 'a', 'c', 'inside'), /自己/);
  engine.undo(); assert.equal(engine.getSnapshot().pages.find(item => item.id === 'c').parentId, null);
  engine.apply(pageMoveCommands(engine.getSnapshot().pages, 'c', 'a', 'before'));
  assert.equal(engine.getSnapshot().pages[0].id, 'c');
});
test('tab reorder is deterministic and ignores missing keys', () => {
  assert.deepEqual(reorderKeys(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(reorderKeys(['a', 'b', 'c'], 'a', 'b', true), ['b', 'a', 'c']);
  assert.deepEqual(reorderKeys(['a', 'b'], 'x', 'a'), ['a', 'b']);
});
test('measurement reports gaps and all four page margins in document units', () => {
  const selection = boxOf([{ x: 20, y: 30, width: 100, height: 40 }, { x: 140, y: 60, width: 80, height: 50 }]);
  assert.deepEqual(selection, { x: 20, y: 30, width: 200, height: 80, right: 220, bottom: 110 });
  assert.deepEqual(measurementLines(selection, { x: 0, y: 0, width: 500, height: 400 }, true).map(item => item.distance), [20, 280, 30, 290]);
  assert.equal(measurementLines(selection, { x: 300, y: 30, width: 40, height: 80 })[0].distance, 80);
  assert.equal(boxOf([]), null);
});
