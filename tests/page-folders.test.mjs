import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBlankProject, makeNode, DocumentEngine, validateProject, normalizeProject } from '../app/core/document.mjs';
import { getPageTreeOrder, getPageTreeItems, getPageTreeDescendants, getOrderedPages } from '../app/core/page-tree-model.mjs';
import { captureLibraryItem, validateLibraryItem } from '../app/core/library-model.mjs';
import { exportHtml } from '../app/core/html-export.mjs';
import { exportRp, getRpExportStatus } from '../app/core/rp-export.mjs';
import { auditGeneratedProject, inspectGeneratedRp, rpField } from '../scripts/inspect-generated-rp.mjs';
const libraryHelpers = { uuid: randomUUID, createBlankProject, validateProject };
function fixture() {
  const project = createBlankProject('页面文件夹测试'); project.id = 'project'; project.pages[0].id = 'home';
  project.pages[0].nodes = [makeNode('button', { id: 'button', text: '导航' }), makeNode('text', { id: 'label', text: '首页' })];
  return new DocumentEngine(project);
}
const addFolder = (id, parentId = null, collapsed = false) => ({ type: 'addPageFolder', folder: { id, name: id, parentId, collapsed } });
const addPage = (id, parentId = null) => ({ type: 'addPage', page: { id, name: id, parentId } });
const reorder = (itemId, index) => ({ type: 'reorderPageTreeItem', itemId, index });
const treeIds = project => getPageTreeItems(project).map(row => row.id);
const embedded = html => JSON.parse(html.match(/<script id="yuanda-model" type="application\/json">([\s\S]*?)<\/script>/)[1]);

test('旧项目无损补目录元数据，真实页面数组与旧首项顺序保持兼容', () => {
  const old = fixture().getSnapshot(); delete old.pageFolders; delete old.pageTreeOrder;
  const before = structuredClone(old), project = normalizeProject(old);
  assert.deepEqual(old, before); assert.deepEqual(project.pageFolders, []); assert.equal(project.pageTreeOrder, null);
  assert.deepEqual(getPageTreeOrder(project), ['home']); assert.deepEqual(getOrderedPages(project), project.pages);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(project))).getSnapshot(), project);
});

test('创建目录、改名、折叠是可撤销模型命令，目录没有画布字段', () => {
  const engine = fixture(), before = engine.getSnapshot();
  engine.apply([addFolder('folder'), { type: 'updatePageFolder', folderId: 'folder', patch: { name: '交付页面', collapsed: true } }]);
  const after = engine.getSnapshot(); assert.equal(after.pages.length, 1);
  assert.deepEqual(after.pageFolders, [{ id: 'folder', name: '交付页面', parentId: null, collapsed: true }]);
  assert.deepEqual(after.pageTreeOrder, ['home', 'folder']); assert.equal(engine.revision, 1);
  engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.deepEqual(engine.getSnapshot(), after);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(), after);
});

test('页面和目录可混合嵌套，DFS 显示顺序与折叠过滤分离', () => {
  const engine = fixture(); engine.apply([addFolder('folder'), addPage('nested', 'folder'), addFolder('subfolder', 'nested'), addPage('deep', 'subfolder'), reorder('folder', 0)]);
  let project = engine.getSnapshot();
  assert.deepEqual(getPageTreeItems(project).map(({ id, kind, depth }) => [id, kind, depth]), [['folder', 'folder', 0], ['nested', 'page', 1], ['subfolder', 'folder', 2], ['deep', 'page', 3], ['home', 'page', 0]]);
  assert.deepEqual(getPageTreeDescendants(project, 'folder'), ['nested', 'subfolder', 'deep']);
  engine.apply([{ type: 'updatePageFolder', folderId: 'folder', patch: { collapsed: true } }]); project = engine.getSnapshot();
  assert.deepEqual(getPageTreeItems(project, { visibleOnly: true }).map(row => row.id), ['folder', 'home']);
  assert.deepEqual(getOrderedPages(project).map(page => page.id), ['nested', 'deep', 'home']);
});

test('混排与移动独立，跨目录移动保留子树和真实页面内容', () => {
  const engine = fixture(); engine.apply([addFolder('a'), addFolder('b'), addFolder('child', 'a'), addPage('one', 'child'), addPage('two', 'b')]);
  const beforeNodes = engine.getSnapshot().pages[0].nodes;
  engine.apply([{ type: 'reparentPageFolder', folderId: 'child', parentId: 'b' }, reorder('child', 2), { type: 'reparentPage', pageId: 'home', parentId: 'a' }, reorder('a', 0)]);
  const project = engine.getSnapshot(); assert.deepEqual(treeIds(project), ['a', 'home', 'b', 'child', 'one', 'two']);
  assert.deepEqual(project.pages.find(page => page.id === 'home').nodes, beforeNodes);
  engine.apply([{ type: 'reparentPageFolder', folderId: 'child', parentId: null }]);
  assert.equal(getPageTreeItems(engine.getSnapshot()).find(row => row.id === 'child').depth, 0);
});

test('旧 reorderPage 保持真实页面索引并同步目录中的页面槽位', () => {
  const engine = fixture(); engine.apply([addFolder('folder'), addPage('second'), addPage('third')]);
  engine.apply([{ type: 'reorderPage', pageId: 'third', index: 0 }]);
  const project = engine.getSnapshot(); assert.deepEqual(project.pages.map(page => page.id), ['third', 'home', 'second']);
  assert.deepEqual(project.pageTreeOrder, ['third', 'folder', 'home', 'second']);
  assert.deepEqual(treeIds(project), ['third', 'folder', 'home', 'second']);
});

test('删除真实父页面提升直接子页和子目录，其余后代保留', () => {
  const engine = fixture(); engine.apply([addFolder('parent'), { type: 'reparentPage', pageId: 'home', parentId: 'parent' }, addFolder('childFolder', 'home'), addPage('childPage', 'home'), addPage('grandchild', 'childFolder')]);
  const before = engine.getSnapshot(); engine.apply([{ type: 'removePage', pageId: 'home' }]);
  const after = engine.getSnapshot(); assert.equal(after.pageFolders.find(folder => folder.id === 'childFolder').parentId, 'parent');
  assert.equal(after.pages.find(page => page.id === 'childPage').parentId, 'parent'); assert.equal(after.pages.find(page => page.id === 'grandchild').parentId, 'childFolder');
  assert.ok(!after.pageTreeOrder.includes('home')); engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
});

test('删除文件夹递归删除跨页面和目录的全部后代，并清理页面/元件/母版中的跳转', () => {
  const engine = fixture(); engine.apply([addFolder('folder'), addPage('child', 'folder'), addFolder('insidePage', 'child'), addPage('grandchild', 'insidePage'), addPage('survivor')]);
  const branches = [{ event: 'click', actions: [{ type: 'navigate', pageId: 'child' }, { type: 'navigate', pageId: 'grandchild' }, { type: 'navigate', pageId: 'survivor' }] }];
  engine.apply([{ type: 'updateNode', pageId: 'home', nodeId: 'button', patch: { interactions: branches } }, { type: 'updatePage', pageId: 'home', patch: { interactions: [{ event: 'load', actions: branches[0].actions }] } }, { type: 'createComponent', pageId: 'home', nodeIds: ['button'], componentId: 'master', name: '有跳转的母版' }]);
  const before = engine.getSnapshot(); engine.apply([{ type: 'removePageFolder', folderId: 'folder' }]);
  const after = engine.getSnapshot(); assert.deepEqual(after.pages.map(page => page.id), ['home', 'survivor']); assert.deepEqual(after.pageFolders, []); assert.deepEqual(after.pageTreeOrder, ['home', 'survivor']);
  assert.deepEqual(after.pages[0].interactions[0].actions, [{ type: 'navigate', pageId: 'survivor' }]);
  for (const canvas of [...after.pages, ...after.components]) for (const node of canvas.nodes) for (const interaction of node.interactions) assert.ok(interaction.actions.every(action => !['child', 'grandchild'].includes(action.pageId)));
  assert.equal(validateProject(after), true); engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.deepEqual(engine.getSnapshot(), after);
});

test('禁止删除最后真实页面所在目录，空文件夹可删，整批失败不泄漏', () => {
  const engine = fixture(); engine.apply([addFolder('folder'), { type: 'reparentPage', pageId: 'home', parentId: 'folder' }]); const before = engine.getSnapshot(), revision = engine.revision;
  assert.throws(() => engine.apply([{ type: 'renameProject', name: '不能保留' }, { type: 'removePageFolder', folderId: 'folder' }]), /最后一个页面/);
  assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, revision);
  engine.apply([addFolder('empty'), { type: 'removePageFolder', folderId: 'empty' }]); assert.deepEqual(engine.getSnapshot(), before);
});

test('非法父级、目录自环和页目录混合环拒绝且不修改项目', () => {
  const engine = fixture(); engine.apply([addFolder('folder', 'home'), addPage('child', 'folder')]); const before = engine.getSnapshot(), revision = engine.revision;
  for (const command of [
    { type: 'reparentPageFolder', folderId: 'folder', parentId: 'folder' },
    { type: 'reparentPageFolder', folderId: 'folder', parentId: 'child' },
    { type: 'reparentPageFolder', folderId: 'folder', parentId: 'missing' },
    { type: 'reparentPage', pageId: 'home', parentId: 'folder' },
    { type: 'updatePage', pageId: 'home', patch: { parentId: 'child' } },
    addFolder('invalid', 'button'), addPage('invalid', 'button')
  ]) {
    assert.throws(() => engine.apply([{ type: 'renameProject', name: '失败不保留' }, command]), { code: 'VALIDATION_ERROR' });
    assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, revision);
  }
});

test('目录 ID 全局唯一、元数据和完整混排顺序严格验证', () => {
  const engine = fixture(); engine.apply([addFolder('folder')]); const before = engine.getSnapshot();
  for (const patch of [{ name: '' }, { collapsed: 'yes' }, { nodes: [] }, { id: 'changed' }, { parentId: 'home' }]) assert.throws(() => engine.apply([{ type: 'updatePageFolder', folderId: 'folder', patch }]));
  for (const id of ['home', 'button', 'project', 'folder']) assert.throws(() => engine.apply([addFolder(id)]));
  for (const pageTreeOrder of [[], ['home'], ['home', 'folder', 'folder'], ['home', 'missing'], ['home', 'folder', 1], {}, 'bad']) assert.throws(() => validateProject({ ...before, pageTreeOrder }));
  for (const index of [-1, 2, 0.5, '0']) assert.throws(() => engine.apply([reorder('folder', index)]));
  assert.throws(() => engine.apply([reorder('missing', 0)])); assert.deepEqual(engine.getSnapshot(), before);
});

test('目录不能当成编辑画布、跳转目标、元件复制目的地或母版命令入口', () => {
  const engine = fixture(); engine.apply([addFolder('folder'), { type: 'createComponent', pageId: 'home', nodeIds: ['label'], componentId: 'master', name: '母版' }]); const before = engine.getSnapshot();
  for (const command of [
    { type: 'addNode', pageId: 'folder', node: { type: 'rectangle' } },
    { type: 'updatePage', pageId: 'folder', patch: { background: '#000000' } },
    { type: 'removePage', pageId: 'folder' },
    { type: 'duplicateNodes', pageId: 'home', nodeIds: ['button'], targetPageId: 'folder' },
    { type: 'createComponent', pageId: 'folder', nodeIds: ['button'], name: '错误画布' },
    { type: 'componentCommands', componentId: 'master', commands: [addFolder('hidden')] },
    { type: 'updateNode', pageId: 'home', nodeId: 'button', patch: { interactions: [{ event: 'click', actions: [{ type: 'navigate', pageId: 'folder' }] }] } }
  ]) { assert.throws(() => engine.apply([command])); assert.deepEqual(engine.getSnapshot(), before); }
});

test('目录内页面选区可进元件库，库条目不能夹带项目目录或把目录当选区', () => {
  const engine = fixture(); engine.apply([addFolder('folder'), { type: 'reparentPage', pageId: 'home', parentId: 'folder' }]);
  const options = { pageId: 'home', nodeIds: ['button'], name: '按钮', description: '' };
  const item = captureLibraryItem(engine.getSnapshot(), options, libraryHelpers).item;
  assert.deepEqual(item.project.pageFolders, []); assert.equal(item.project.pages[0].parentId, null); assert.equal(validateLibraryItem(item, libraryHelpers), true);
  assert.throws(() => captureLibraryItem(engine.getSnapshot(), { ...options, pageId: 'folder' }, libraryHelpers), /画布不存在/);
  const contaminated = structuredClone(item); contaminated.project.pageFolders = [{ id: 'foreign', name: '夹带目录', parentId: null, collapsed: false }];
  assert.equal(validateProject(contaminated.project), true); assert.throws(() => validateLibraryItem(contaminated, libraryHelpers), /页面文件夹/);
});

test('HTML 第一项为树中第一真实页，空目录不变画布、折叠不丢页、输入不修改', () => {
  const engine = fixture(); engine.apply([addFolder('empty'), reorder('empty', 0), addFolder('folder', null, true), addPage('first', 'folder'), addPage('second', 'first'), reorder('folder', 1)]);
  const before = engine.getSnapshot(), data = embedded(exportHtml(before));
  assert.deepEqual(data.pages.map(page => page.id), ['first', 'second', 'home']); assert.equal(data.pages[0].id, getOrderedPages(before)[0].id);
  assert.ok(data.pages.every(page => Array.isArray(page.nodes))); assert.deepEqual(before, engine.getSnapshot());
  assert.deepEqual(data.pageFolders, before.pageFolders); assert.equal(data.pageFolders.find(folder => folder.id === 'folder').collapsed, true);
});

test('RP 明确阻止任何目录组织，空文件夹也不会被静默丢弃', () => {
  const engine = fixture(); assert.equal(getRpExportStatus(engine.getSnapshot()).canExport, true);
  engine.apply([addFolder('empty')]); let status = getRpExportStatus(engine.getSnapshot());
  assert.equal(status.canExport, false); assert.ok(status.unsupported.some(reason => reason.includes('页面文件夹'))); assert.throws(() => exportRp(engine.getSnapshot()), /页面文件夹/);
  engine.apply([{ type: 'reparentPage', pageId: 'home', parentId: 'empty' }]); assert.throws(() => exportRp(engine.getSnapshot()), /页面文件夹/);
  engine.apply([{ type: 'reparentPage', pageId: 'home', parentId: null }, { type: 'removePageFolder', folderId: 'empty' }]);
  status = getRpExportStatus(engine.getSnapshot()); assert.equal(status.canExport, true); assert.ok(exportRp(engine.getSnapshot()).data.byteLength > 0);
});

test('混合顺序保存后继续新增、删页、撤销重做和版本冲突均一致', () => {
  const engine = fixture(); engine.apply([addFolder('folder')]); const saved = new DocumentEngine(JSON.parse(JSON.stringify(engine.getSnapshot())));
  saved.apply([addPage('second', 'folder')], { expectedRevision: 0 }); assert.deepEqual(saved.getSnapshot().pageTreeOrder, ['home', 'folder', 'second']);
  assert.throws(() => saved.apply([addFolder('stale')], { expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  const beforeDelete = saved.getSnapshot(); saved.apply([{ type: 'removePage', pageId: 'second' }]); assert.deepEqual(saved.getSnapshot().pageTreeOrder, ['home', 'folder']);
  saved.undo(); assert.deepEqual(saved.getSnapshot(), beforeDelete); saved.redo(); assert.equal(validateProject(saved.getSnapshot()), true);
});

test('无目录的显式混排顺序同时决定 RP 页包、站点树及 HTML 落地顺序', () => {
  const engine = fixture(); engine.apply([addPage('second')]); const project = engine.getSnapshot();
  project.pageTreeOrder = ['second', 'home']; assert.deepEqual(project.pages.map(page => page.id), ['home', 'second']);
  const expected = { ...project, pages: getOrderedPages(project) }, { data } = exportRp(project);
  assert.equal(auditGeneratedProject(data, expected).passed, true);
  const decoded = inspectGeneratedRp(data), objects = decoded.packages.flatMap(pkg => pkg.objects), byId = new Map(objects.map(object => [object.id, object]));
  const doc = objects.find(object => object.type === 'Axure:DesignDocument'), sitemap = byId.get(rpField(doc, 'sitemap').guid), tree = byId.get(rpField(sitemap, 'tree').guid);
  const mapping = new Map([...rpField(sitemap, 'node-table')].map(([key, value]) => [key.guid, value.guid]));
  const info = new Map(objects.filter(object => object.type === 'Axure:PackageInfo').map(object => [rpField(object, 'package-id').guid, rpField(object, 'package-name')]));
  assert.deepEqual(rpField(tree, 'children').map(child => info.get(mapping.get(child.guid))), ['second', project.pages[0].name]);
  assert.deepEqual(embedded(exportHtml(project)).pages.map(page => page.id), ['second', 'home']);
  assert.deepEqual(project.pages.map(page => page.id), ['home', 'second']);
});

test('目录 ID 与样式、母版、实例组及面板状态同属全局唯一空间', () => {
  const engine = fixture(); engine.apply([{ type: 'addStyle', style: { id: 'style', name: '样式', style: { fill: '#123456' } } }, { type: 'createComponent', pageId: 'home', nodeIds: ['button'], componentId: 'master', name: '母版' }, { type: 'insertComponent', pageId: 'home', componentId: 'master', instanceId: 'instance', x: 0, y: 0 }, { type: 'createDynamicPanel', pageId: 'home', panelId: 'panel', nodeIds: ['label'] }]);
  const before = engine.getSnapshot(), stateId = before.pages[0].nodes.find(node => node.id === 'panel').panel.states[0].id;
  for (const id of ['style', 'master', 'instance', stateId]) { assert.throws(() => engine.apply([addFolder(id)]), /重复/); assert.deepEqual(engine.getSnapshot(), before); }
  engine.apply([addFolder('folder')]); const withFolder = engine.getSnapshot();
  assert.throws(() => engine.apply([{ type: 'updatePage', pageId: 'home', patch: { id: 'changed' } }]), /不支持的字段/);
  const broken = structuredClone(withFolder); broken.pages[0].id = 'changed'; assert.throws(() => engine.replace(broken), /目录顺序/); assert.deepEqual(engine.getSnapshot(), withFolder);
});
