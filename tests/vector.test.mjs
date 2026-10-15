import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeVectorDefaults, normalizeVectorProject, validateVectorProject, reconcileVectorProject, connectorAnchor, connectorPoints, pathData, getVectorGeometry, makeRichText, richTextPlainText, renderVectorHtml, renderRichTextHtml, remapVectorReferences, expandVectorRemoval } from '../app/core/vector-model.mjs';
import { createBlankProject, DocumentEngine, makeNode } from '../app/core/document.mjs';

const node = (id, type = 'rectangle', changes = {}) => ({ id, type, x: 10, y: 20, width: 100, height: 60, rotation: 0, text: '', style: { fill: '#fff', stroke: '#123456', strokeWidth: 2 }, ...nodeVectorDefaults(type), ...changes });
const fixture = () => {
  const a = node('a'), b = node('b', 'rectangle', { x: 300, y: 140 });
  const line = node('line', 'connector', { connector: { from: { nodeId: 'a', side: 'right' }, to: { nodeId: 'b', side: 'left' }, route: 'elbow', arrow: 'end' } });
  return { pages: [{ id: 'page', nodes: [a, b, line] }], components: [] };
};

test('legacy migration supplies only missing vector fields without mutating input or repairing explicit invalid data', () => {
  const legacy = { pages: [{ nodes: [{ id: 'old', type: 'text', text: '旧项目' }] }] };
  const migrated = normalizeVectorProject(legacy);
  assert.equal(legacy.pages[0].nodes[0].richText, undefined);
  assert.equal(migrated.pages[0].nodes[0].richText, null);
  const invalid = normalizeVectorProject({ pages: [{ nodes: [{ id: 'bad', type: 'path', path: null }] }] });
  assert.throws(() => validateVectorProject(invalid), /路径元件必须/);
});

test('connector anchors follow rotated targets and reconcile updates bounds after ordinary node movement', () => {
  const project = fixture(), [a, b, line] = project.pages[0].nodes;
  validateVectorProject(project); reconcileVectorProject(project);
  assert.deepEqual(connectorPoints(line, [a, b]), [{ x: 110, y: 50 }, { x: 205, y: 50 }, { x: 205, y: 170 }, { x: 300, y: 170 }]);
  assert.deepEqual([line.x, line.y, line.width, line.height], [110, 50, 190, 120]);
  b.x = -200; b.y = -100; reconcileVectorProject(project);
  assert.deepEqual([line.x, line.y, line.width, line.height], [-200, -70, 310, 120]);
  a.rotation = 90;
  const anchor = connectorAnchor(a, 'right'); assert.ok(Math.abs(anchor.x - 60) < .000001); assert.ok(Math.abs(anchor.y - 100) < .000001);
  reconcileVectorProject(project); assert.equal(line.rotation, 0);
});

test('connector validation rejects missing, foreign-container, self and connector targets', () => {
  for (const target of ['missing', 'foreign', 'line', 'a']) {
    const project = fixture(); project.pages.push({ id: 'other', nodes: [node('foreign')] });
    project.pages[0].nodes[2].connector.to.nodeId = target;
    assert.throws(() => validateVectorProject(project), /连接线/);
  }
  const project = fixture(); project.pages[0].nodes[2].connector.from.side = 'script'; assert.throws(() => validateVectorProject(project), /锚点/);
});

test('component definition connections receive the same validation and reconciliation as pages', () => {
  const project = fixture(); project.components = [{ id: 'component', nodes: project.pages[0].nodes }]; project.pages = [{ id: 'empty', nodes: [] }];
  validateVectorProject(project); reconcileVectorProject(project);
  assert.equal(project.components[0].nodes[2].width, 190);
});

test('clipboard remapping and explicit endpoint removal preserve reference integrity', () => {
  const { nodes } = fixture().pages[0];
  assert.deepEqual(expandVectorRemoval(nodes, ['a']), ['a', 'line']);
  assert.deepEqual(expandVectorRemoval(nodes, ['line']), ['line']);
  const clone = structuredClone(nodes[2]); remapVectorReferences(clone, new Map([['a', 'a-copy'], ['b', 'b-copy']]));
  assert.equal(clone.connector.from.nodeId, 'a-copy'); assert.equal(clone.connector.to.nodeId, 'b-copy'); assert.equal(nodes[2].connector.from.nodeId, 'a');
});

test('closed cubic path output includes the last-to-first curve and scales controls independently', () => {
  const path = nodeVectorDefaults('path').path; path.closed = true; path.points[0].inX = -.1; path.points[0].inY = .6; path.points[1].outX = .7; path.points[1].outY = .1;
  assert.equal(pathData(path, 200, 100), 'M 0 100 L 100 0 C 140 10 200 100 200 100 C 200 100 -20 60 0 100 Z');
  const n = node('curve', 'path', { path }); assert.equal(getVectorGeometry(n).closed, true);
  assert.match(renderVectorHtml(n), /fill="#fff"/);
});

test('path schema rejects malformed handles, nonfinite coordinates, too few closed points and unknown fields', () => {
  const modifications = [p => { p.points[0].inX = .2; }, p => { p.points[0].x = Infinity; }, p => { p.closed = true; p.points.pop(); }, p => { p.script = 'x'; }];
  for (const edit of modifications) { const n = node('path', 'path'); edit(n.path); assert.throws(() => validateVectorProject({ pages: [{ nodes: [n] }] })); }
});

test('structured rich text retains paragraphs, local formatting and literal markup in HTML', () => {
  const n = node('text', 'text', { text: '<script>alert(1)</script>\n第二段' });
  n.richText = makeRichText(n.text); n.richText.paragraphs[0].runs[0].bold = true; n.richText.paragraphs[1].list = 'number';
  validateVectorProject({ pages: [{ nodes: [n] }] });
  assert.equal(richTextPlainText(n.richText), n.text);
  const output = renderRichTextHtml(n); assert.ok(!output.includes('<script>')); assert.match(output, /&lt;script&gt;/); assert.match(output, /font-weight:700/); assert.match(output, /1\. /);
  const restored = JSON.parse(JSON.stringify(n)); assert.deepEqual(restored.richText, n.richText);
});

test('rich text rejects divergent plain text, CSS injection and unknown inline payloads', () => {
  const n = node('text', 'text', { text: 'hello' }); n.richText = makeRichText(n.text);
  n.text = 'different'; assert.throws(() => validateVectorProject({ pages: [{ nodes: [n] }] }), /不一致/);
  n.text = 'hello'; n.richText.fontFamily = 'Arial;background:url(https://example.com)'; assert.throws(() => validateVectorProject({ pages: [{ nodes: [n] }] }), /字体/);
  n.richText.fontFamily = 'Arial'; n.richText.paragraphs[0].runs[0].html = '<img>'; assert.throws(() => validateVectorProject({ pages: [{ nodes: [n] }] }), /未知/);
});

test('horizontal connections remain nonzero height and arrow marker IDs are safe', () => {
  const project = fixture(); project.pages[0].nodes[1].y = 20; const line = project.pages[0].nodes[2]; line.connector.route = 'straight'; line.connector.arrow = 'both';
  reconcileVectorProject(project); assert.equal(line.height, 1);
  const output = renderVectorHtml(line, project.pages[0].nodes); assert.match(output, /marker-start/); assert.match(output, /marker-end/); assert.match(output, /viewBox="0 0 190 1"/);
});

test('shared command engine moves and removes connected objects atomically with undo and JSON reopening', () => {
  const project = createBlankProject('连接线事务'); const page = project.pages[0];
  page.nodes = [makeNode('rectangle', { id: 'a', x: 10, y: 20, width: 100, height: 60 }), makeNode('rectangle', { id: 'b', x: 300, y: 140, width: 100, height: 60 }), makeNode('connector', { id: 'line', connector: fixture().pages[0].nodes[2].connector })];
  const engine = new DocumentEngine(project);
  engine.apply([{ type: 'updateNode', pageId: page.id, nodeId: 'b', patch: { x: 500 } }]);
  assert.equal(engine.getSnapshot().pages[0].nodes.find(n => n.id === 'line').width, 390);
  engine.apply([{ type: 'removeNodes', pageId: page.id, nodeIds: ['a'] }]);
  assert.deepEqual(engine.getSnapshot().pages[0].nodes.map(n => n.id), ['b']);
  engine.undo(); assert.equal(engine.getSnapshot().pages[0].nodes.length, 3);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(engine.getSnapshot()))).getSnapshot(), engine.getSnapshot());
});

test('shared command engine clears rich text on explicit plain-text edit and restores it on undo', () => {
  const project = createBlankProject('文字事务'), page = project.pages[0], rich = makeRichText('原文');
  page.nodes = [makeNode('text', { id: 'label', text: '原文', richText: rich })];
  const engine = new DocumentEngine(project);
  engine.apply([{ type: 'updateNode', pageId: page.id, nodeId: 'label', patch: { text: '普通文字修改' } }]);
  assert.equal(engine.getSnapshot().pages[0].nodes[0].richText, null);
  engine.undo(); assert.deepEqual(engine.getSnapshot().pages[0].nodes[0].richText, rich);
});

test('invalid vector batch rolls back all prior ordinary node edits', () => {
  const project = createBlankProject('回滚事务'), page = project.pages[0]; page.nodes = [makeNode('path', { id: 'path' })];
  const engine = new DocumentEngine(project), before = engine.getSnapshot();
  assert.throws(() => engine.apply([{ type: 'updateNode', pageId: page.id, nodeId: 'path', patch: { x: 999 } }, { type: 'updateNode', pageId: page.id, nodeId: 'path', patch: { path: { closed: true, points: [] } } }]));
  assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, 0);
});
