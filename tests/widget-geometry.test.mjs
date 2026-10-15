import test from 'node:test';
import assert from 'node:assert/strict';
import { getNodeOrigin, rotateNodePoint, getNodeBounds } from '../app/core/widget-geometry.mjs';
import { connectorAnchor, makeRichText, normalizeVectorProject, validateVectorProject, richRunStyle, renderRichTextHtml } from '../app/core/vector-model.mjs';

const near = (actual, expected) => { for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-8, `${key}: ${actual[key]} != ${expected[key]}`); };
const node = { x: 100, y: 200, width: 80, height: 40, rotation: 90, style: { transformOrigin: { x: 0, y: 0 } } };

test('非中心旋转原点同时改变外框与连线锚点，默认仍为旧中心', () => {
  near(getNodeOrigin(node), { x: 100, y: 200 });
  near(rotateNodePoint(node, 180, 220), { x: 80, y: 280 });
  near(connectorAnchor(node, 'right'), { x: 80, y: 280 });
  near(getNodeBounds(node), { left: 60, top: 200, right: 100, bottom: 280, width: 40, height: 80 });
  near(connectorAnchor({ ...node, style: {} }, 'right'), { x: 140, y: 260 });
  near(getNodeOrigin({ ...node, style: { transformOrigin: { x: 1, y: .25 } } }), { x: 180, y: 210 });
});

test('旋转多圈与零角度不改变几何定义，计算不修改节点', () => {
  const saved = structuredClone(node);
  near(getNodeBounds({ ...node, rotation: 0 }), { left: 100, top: 200, width: 80, height: 40 });
  near(getNodeBounds({ ...node, rotation: 450 }), getNodeBounds(node));
  assert.deepEqual(node, saved);
});

test('旧富文本仅补删除线和基线字段，错误的显式值仍拒绝', () => {
  const richText = makeRichText('旧文字'), run = richText.paragraphs[0].runs[0];
  delete run.strike; delete run.baseline;
  const original = { pages: [{ nodes: [{ id: 'text', type: 'text', text: '旧文字', richText }] }], components: [] };
  const migrated = normalizeVectorProject(original);
  assert.equal(run.baseline, undefined);
  assert.equal(migrated.pages[0].nodes[0].richText.paragraphs[0].runs[0].baseline, 'normal');
  validateVectorProject(migrated);
  for (const patch of [{ strike: 'true' }, { baseline: 'middle' }, { baseline: null }, { script: 'alert(1)' }]) {
    const invalid = structuredClone(migrated); Object.assign(invalid.pages[0].nodes[0].richText.paragraphs[0].runs[0], patch);
    assert.throws(() => validateVectorProject(normalizeVectorProject(invalid)), /富文本片段/);
  }
});

test('上下标与删除线保持独立，纯文本内容不变且导出转义用户文字', () => {
  const rich = makeRichText('<H2O>', { italic: true, strike: true, fontFamily: 'Arial', lineHeight: 30, fontSize: 20 });
  const run = rich.paragraphs[0].runs[0];run.baseline = 'sub';run.underline = true;
  const style = richRunStyle(run);
  assert.equal(style.fontStyle, 'italic');assert.equal(style.textDecoration, 'underline line-through');assert.equal(style.verticalAlign, 'sub');assert.equal(style.fontSize, '.75em');
  const rendered = renderRichTextHtml({ richText: rich });
  assert.match(rendered, /&lt;H2O&gt;/);assert.match(rendered, /vertical-align:sub/);assert.doesNotMatch(rendered, /<H2O>/);
  assert.equal(rich.lineHeight, 1.5);assert.equal(rich.paragraphs[0].runs[0].text, '<H2O>');
});
