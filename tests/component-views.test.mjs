import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { DocumentEngine, createBlankProject, makeNode, normalizeProject, validateProject } from '../app/core/document.mjs';
import { resolveComponentCanvas, resolveInstancePosition } from '../app/core/component-view-model.mjs';
import { resolveCanvasView, getCanvasViews, getCanvasViewOverrides } from '../app/core/view-model.mjs';
import { captureLibraryItem, validateLibraryItem } from '../app/core/library-model.mjs';
import { exportHtml } from '../app/core/html-export.mjs';
import { assertSameDetachedNodes } from './component-assertions.mjs';

function standaloneComponentResolver(project) {
  // Use the actual product bundle, not a hand-maintained list of dependencies.
  // Do not start the DOM runtime: only load its pure declarations in a fresh VM.
  const runtime=exportHtml(project).match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(runtime); const entry=runtime.indexOf('\n(function htmlRuntime(');assert.ok(entry>0);
  return runInNewContext(`${runtime.slice(0,entry)}\nresolveComponentCanvas`,{structuredClone});
}

const h = { uuid: randomUUID, createBlankProject, validateProject };
const addView = (id, name, parentId = null, componentId = 'card') => ({ type: 'addComponentView', componentId, view: { id, name, parentId } });
const patch = (viewId, nodeId, value, componentId = 'card') => ({ type: 'setComponentViewOverride', componentId, viewId, nodeId, patch: value });
const choose = (viewId, viewMode = 'fixed', instanceId = 'instance', pageId = 'home') => ({ type: 'setComponentInstanceView', pageId, instanceId, viewMode, viewId });
const master = engine => engine.getSnapshot().components.find(item => item.id === 'card');
const page = engine => engine.getSnapshot().pages[0];
const node = (canvas, id) => canvas.nodes.find(item => item.id === id);
function fixture() {
  const project = createBlankProject('组件视图'); project.id = 'view-project'; project.pages[0].id = 'home';
  const engine = new DocumentEngine(project);
  engine.apply([
    { type: 'addComponent', component: { id: 'card', name: '卡片', nodes: [makeNode('button', { id: 'title', text: '共享内容', x: 10, y: 20 }), makeNode('image', { id: 'picture', x: 10, y: 90 })] } },
    { type: 'insertComponent', pageId: 'home', componentId: 'card', instanceId: 'instance', x: 100, y: 200 },
    addView('compact', '紧凑'), addView('mobile', '手机', 'compact'),
    patch('compact', 'title', { x: 25, width: 200, style: { fill: '#111111', color: '#FFFFFF' } }),
    patch('mobile', 'title', { width: 120, style: { color: '#AAAAAA' } })
  ]);
  return engine;
}
function projected(engine, viewId = null, canvasId = 'card') {
  const project = engine.getSnapshot(), canvas = [...project.pages, ...project.components].find(item => item.id === canvasId);
  return resolveCanvasView(project, canvas, viewId);
}
function sourceNodeId(engine, sourceId = 'title', instanceId = 'instance') {
  const group = page(engine).groups.find(item => item.id === instanceId); return group.nodeIds[group.sourceIds.indexOf(sourceId)];
}
function addHostViews(engine) {
  engine.apply([{ type: 'addViewSet', viewSet: { id: 'screens', name: '屏幕', views: [{ id: 'screen-compact', name: '紧凑', parentId: null, minWidth: 600, width: 800, height: 900 }, { id: 'screen-mobile', name: '手机', parentId: 'screen-compact', minWidth: 0, width: 390, height: 844 }] } }, { type: 'setPageViewSet', pageId: 'home', viewSetId: 'screens' }]);
}
function capture(engine, sourceId = 'card', ids = ['title']) {
  const project = engine.getSnapshot(), canvas = [...project.pages, ...project.components].find(item => item.id === sourceId);
  return { projectId: project.id, sourceId, nodes: structuredClone(canvas.nodes), groups: structuredClone(canvas.groups), views: structuredClone(canvas.views || []), nodeIds: ids,
    viewState: { kind: 'component', definitions: structuredClone(canvas.views), overrides: structuredClone(canvas.viewOverrides), activeViewId: 'mobile' } };
}
function capturePage(engine) {
  const project = engine.getSnapshot(), canvas = project.pages[0], definitions = getCanvasViews(project, canvas);
  const appearance = viewId => Object.fromEntries(resolveCanvasView(project, canvas, viewId).nodes.map(node => [node.id, Object.fromEntries(['x', 'y', 'width', 'height', 'rotation', 'style', 'placed'].map(key => [key, structuredClone(node[key])]))]));
  return { projectId: project.id, sourceId: canvas.id, nodes: canvas.nodes, groups: canvas.groups, views: canvas.views, nodeIds: canvas.groups[0].nodeIds,
    viewState: { kind: 'adaptive', definitions: definitions.map(view => ({ ...view, parentId: view.parentId ?? null })), overrides: Object.fromEntries(definitions.map(view => [view.id, getCanvasViewOverrides(project, canvas, view.id) || {}])), activeViewId: null },
    appearance: { base: appearance(null), views: Object.fromEntries(definitions.map(view => [view.id, appearance(view.id)])) } };
}

test('旧文件只补组件视图与实例默认，显式坏值仍拒绝且不改输入', () => {
  const engine = fixture(), old = engine.getSnapshot(); delete old.components[0].views; delete old.components[0].viewOverrides;
  for (const group of old.pages[0].groups) for (const key of ['viewMode', 'viewId', 'placed']) delete group[key];
  const before = structuredClone(old), migrated = normalizeProject(old); assert.deepEqual(old, before);
  assert.deepEqual(migrated.components[0].views, []); assert.deepEqual(migrated.components[0].viewOverrides, {});
  assert.equal(migrated.pages[0].groups[0].viewMode, 'fixed'); assert.equal(migrated.pages[0].groups[0].viewId, null); assert.equal(migrated.pages[0].groups[0].placed, true);
  assert.equal(validateProject(migrated), true); migrated.components[0].views = null; assert.throws(() => validateProject(migrated));
});

test('逐属性继承和恢复继承不影响共享文字、注释、交互，也不写回投影', () => {
  const engine = fixture(), initial = engine.getSnapshot();
  assert.equal(node(projected(engine, 'mobile'), 'title').x, 25); assert.equal(node(projected(engine, 'mobile'), 'title').width, 120);
  assert.equal(node(projected(engine, 'mobile'), 'title').style.fill, '#111111'); assert.equal(node(projected(engine, 'mobile'), 'title').style.color, '#AAAAAA'); assert.deepEqual(engine.getSnapshot(), initial);
  engine.apply([patch('compact', 'title', { x: 35, style: { fill: '#222222', color: '#EEEEEE' } }), { type: 'updateComponentNode', componentId: 'card', nodeId: 'title', patch: { text: '所有视图共享', annotation: '共同注释', interactions: [{ event: 'click', actions: [{ type: 'setText', targetId: 'picture', value: '共享动作' }] }] } }]);
  const child = node(projected(engine, 'mobile'), 'title'); assert.equal(child.x, 35); assert.equal(child.style.fill, '#222222'); assert.equal(child.style.color, '#AAAAAA'); assert.equal(child.text, '所有视图共享'); assert.equal(child.annotation, '共同注释'); assert.equal(child.interactions[0].actions.length, 1);
  engine.apply([{ type: 'clearComponentViewOverride', componentId: 'card', viewId: 'mobile', nodeId: 'title', fields: ['style.color'] }]); assert.equal(node(projected(engine, 'mobile'), 'title').style.color, '#EEEEEE');
});

test('取消放置独立于隐藏，保留节点与内部引用并受父容器控制', () => {
  const engine = fixture(); engine.apply([{ type: 'componentCommands', componentId: 'card', commands: [{ type: 'createDynamicPanel', panelId: 'panel', nodeIds: ['title'] }] }, patch('compact', 'panel', { placed: false }), patch('mobile', 'title', { placed: true })]);
  const hidden = projected(engine, 'mobile'); assert.equal(node(hidden, 'title').placed, true); assert.equal(node(hidden, 'title').effectivePlaced, false); assert.equal(node(hidden, 'title').visible, true); assert.equal(hidden.nodes.length, 3);
  engine.apply([patch('mobile', 'panel', { placed: true })]); assert.equal(node(projected(engine, 'mobile'), 'title').effectivePlaced, true);
});

test('实例固定选择与完整名称路径自动匹配不改ID，文本图片覆盖及撤销保存继续有效', () => {
  const engine = fixture(); addHostViews(engine); const before = engine.getSnapshot(), ids = page(engine).groups[0].nodeIds;
  engine.apply([choose('mobile'), { type: 'setComponentOverride', pageId: 'home', instanceId: 'instance', sourceId: 'title', patch: { text: '实例专用' } }]);
  const after = engine.getSnapshot(), id = sourceNodeId(engine); assert.equal(node(projected(engine, null, 'home'), id).x, 125); assert.equal(node(projected(engine, null, 'home'), id).text, '实例专用'); assert.deepEqual(page(engine).groups[0].nodeIds, ids);
  engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.deepEqual(engine.getSnapshot(), after); assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(), after);
  engine.apply([choose(null, 'auto')]); assert.equal(node(projected(engine, 'screen-mobile', 'home'), id).width, 120); assert.equal(node(projected(engine, null, 'home'), id).width, master(engine).nodes[0].width);
  const project = engine.getSnapshot(); assert.equal(node(resolveComponentCanvas(project, project.pages[0], { path: ['手机'] }), id).width, master(engine).nodes[0].width);
});

test('嵌套实例先解析内部视图，再外层视图覆盖；内容覆盖和状态ID稳定', () => {
  const engine = fixture(); engine.apply([{ type: 'addComponent', component: { id: 'outer', name: '外层', nodes: [makeNode('text', { id: 'outer-note', text: '外层' })] } }, { type: 'componentCommands', componentId: 'outer', commands: [{ type: 'insertComponent', componentId: 'card', instanceId: 'inside', x: 50, y: 60 }, { ...choose(null, 'auto', 'inside', 'outer') }] }, addView('outer-compact', '紧凑', null, 'outer'), addView('outer-mobile', '手机', 'outer-compact', 'outer')]);
  const outer = engine.getSnapshot().components.find(item => item.id === 'outer'), group = outer.groups[0], id = group.nodeIds[group.sourceIds.indexOf('title')];
  engine.apply([patch('outer-mobile', id, { width: 70 }, 'outer')]); const result = projected(engine, 'outer-mobile', 'outer'); assert.equal(node(result, id).x, 75); assert.equal(node(result, id).width, 70); assert.equal(node(result, id).style.color, '#AAAAAA'); assert.deepEqual(result.groups[0].nodeIds, group.nodeIds);
});

test('移除中间视图提升孩子并保其视觉效果；固定实例回退父级，一步撤销', () => {
  const engine = fixture(); engine.apply([choose('compact')]); const before = engine.getSnapshot(), appearance = projected(engine, 'mobile');
  engine.apply([{ type: 'removeComponentView', componentId: 'card', viewId: 'compact' }]); assert.equal(master(engine).views[0].parentId, null); assert.equal(page(engine).groups[0].viewId, null);
  assert.deepEqual(projected(engine, 'mobile').nodes, appearance.nodes); engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
});

test('错误继承、跨组件视图、共享属性伪覆盖和批次后失败全部回滚', () => {
  const engine = fixture(); const before = engine.getSnapshot(), revision = engine.revision;
  for (const command of [addView('again', '紧凑'), { type: 'updateComponentView', componentId: 'card', viewId: 'compact', patch: { parentId: 'mobile' } }, choose('unknown'), choose('mobile', 'auto'), patch('compact', 'title', { text: '禁止' }), patch('mobile', 'missing', { x: 0 }), patch('mobile', 'title', { style: { color: 'javascript:' } }), { type: 'updateComponent', componentId: 'card', patch: { viewOverrides: { compact: { nonexistent: { width: 10 } } } } }]) {
    assert.throws(() => engine.apply([{ type: 'renameProject', name: '应回滚' }, command])); assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, revision);
  }
});

test('主节点删除清理视图覆盖与实例映射，普通复制保留实例视图关联', () => {
  const engine = fixture(); engine.apply([choose('mobile'), { type: 'duplicateNodes', pageId: 'home', nodeIds: [sourceNodeId(engine)], idMap: { instance: 'duplicate' } }]); assert.equal(page(engine).groups.find(group => group.id === 'duplicate').viewId, 'mobile');
  engine.apply([{ type: 'componentCommands', componentId: 'card', commands: [{ type: 'removeNodes', nodeIds: ['title'] }] }]); assert.equal(Object.hasOwn(master(engine).viewOverrides.compact, 'title'), false); assert(page(engine).groups.every(group => group.sourceIds.length === 1)); assert.equal(validateProject(engine.getSnapshot()), true);
});

test('组件快照粘贴补齐目标组件继承树，失败时不污染目标页面共享树', () => {
  const engine = fixture(), fragment = capture(engine); engine.apply([{ type: 'addComponent', component: { id: 'target', nodes: [makeNode('text', { id: 'placeholder' })] } }]);
  engine.apply([{ type: 'componentCommands', componentId: 'target', commands: [{ type: 'pasteFragment', fragment, dx: 10, dy: 20, idMap: { title: 'pasted-title' } }] }]);
  const target = engine.getSnapshot().components.find(item => item.id === 'target'), child = target.views.find(view => view.name === '手机'); assert.equal(target.views.length, 2); assert.equal(node(projected(engine, child.id, 'target'), 'pasted-title').x, 35); assert.equal(node(projected(engine, child.id, 'target'), 'pasted-title').width, 120);
  const before = engine.getSnapshot(); assert.throws(() => engine.apply([{ type: 'pasteFragment', pageId: 'home', fragment }]), { code: 'VIEW_MAPPING_REQUIRED' }); assert.deepEqual(engine.getSnapshot(), before);
  addHostViews(engine); const definitions = structuredClone(engine.getSnapshot().viewSets); engine.apply([{ type: 'pasteFragment', pageId: 'home', fragment, dx: 0, dy: 0, idMap: { title: 'page-copy' } }]); assert.deepEqual(engine.getSnapshot().viewSets, definitions); assert.equal(node(projected(engine, 'screen-mobile', 'home'), 'page-copy').width, 120);
});

test('组件视图库跨项目复制完整映射视图ID/父ID/补丁键及实例选择，后续更新与undo保留', () => {
  const engine = fixture(); engine.apply([choose('mobile')]); const item = captureLibraryItem(engine.getSnapshot(), { pageId: 'home', nodeIds: page(engine).groups[0].nodeIds, name: '组件变体', description: '' }, h).item;
  const target = fixture(), before = target.getSnapshot(); target.apply([{ type: 'insertLibraryItem', pageId: 'home', item, x: 700, y: 50, conflictPolicy: 'copy' }]);
  const state = target.getSnapshot(), added = state.components.find(component => component.id !== 'card'), instance = state.pages[0].groups.find(group => group.componentId === added.id), child = added.views.find(view => view.name === '手机');
  assert.notEqual(child.id, 'mobile'); assert.equal(instance.viewId, child.id); assert.equal(child.parentId, added.views.find(view => view.name === '紧凑').id); assert(!Object.hasOwn(added.viewOverrides, 'mobile'));
  assert.deepEqual(state.components[0], before.components[0]); const titleId = added.nodes.find(node => node.type === 'button').id; assert(Object.hasOwn(added.viewOverrides[child.id], titleId));
  target.apply([{ type: 'updateComponentNode', componentId: added.id, nodeId: titleId, patch: { text: '导入后修改' } }]); assert(target.getSnapshot().pages[0].nodes.some(node => node.text === '导入后修改')); target.undo(); target.undo(); assert.deepEqual(target.getSnapshot(), before);
});

test('库不携带页面视图集或切屏动作，捕获明确清理且保留组件视图', () => {
  const engine = fixture(); addHostViews(engine); engine.apply([{ type: 'addNode', pageId: 'home', node: { id: 'switcher', type: 'button', interactions: [{ event: 'click', actions: [{ type: 'setAdaptiveView', mode: 'view', viewId: 'screen-mobile' }] }] } }]);
  const item = captureLibraryItem(engine.getSnapshot(), { pageId: 'home', nodeIds: ['switcher', ...page(engine).groups[0].nodeIds], name: '基础结构', description: '' }, h).item;
  assert.deepEqual(item.project.viewSets, []); assert.equal(item.project.pages[0].viewSetId, null); assert.deepEqual(item.project.pages[0].viewOverrides, {}); assert.equal(item.project.components[0].views.length, 2); assert(item.warnings.some(value => value.includes('切换页面自适应'))); assert.equal(item.project.pages[0].nodes.find(node => node.id === 'switcher').interactions[0].actions.length, 0);
  const bad = structuredClone(item); bad.project.viewSets = structuredClone(engine.getSnapshot().viewSets); assert.throws(() => validateLibraryItem(bad, h), /页面自适应视图/);
  const action = structuredClone(item); action.project.pages[0].nodes[0].interactions = [{ event: 'click', actions: [{ type: 'setAdaptiveView', mode: 'base' }] }]; assert.throws(() => validateLibraryItem(action, h), /不能包含切换页面/);
});

test('解除auto组件和删除定义烘焙每个已有宿主视图，样式、位置、放置均不丢', () => {
  for (const type of ['detachComponent', 'removeComponent']) {
    const engine = fixture(); addHostViews(engine); engine.apply([choose(null, 'auto'), patch('mobile', 'picture', { placed: false })]);
    const before = engine.getSnapshot(), visuals = [null, 'screen-compact', 'screen-mobile'].map(viewId => projected(engine, viewId, 'home').nodes);
    engine.apply([type === 'detachComponent' ? { type, pageId: 'home', instanceId: 'instance' } : { type, componentId: 'card' }]);
    for (const [index, viewId] of [null, 'screen-compact', 'screen-mobile'].entries()) assertSameDetachedNodes(projected(engine, viewId, 'home').nodes, visuals[index]);
    assert.equal(page(engine).groups[0].componentId, null); assert.equal(page(engine).groups[0].viewId, null); assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(engine.getSnapshot()))).getSnapshot(), engine.getSnapshot()); engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
  }
});

test('删除嵌套主定义将外层组件各视图烘焙，不影响外层实例与自身布局覆盖', () => {
  const engine = fixture(); engine.apply([{ type: 'addComponent', component: { id: 'outer', name: '外层', nodes: [makeNode('text', { id: 'outer-note', text: '外层' })] } }, { type: 'componentCommands', componentId: 'outer', commands: [{ type: 'insertComponent', componentId: 'card', instanceId: 'inside', x: 50, y: 60 }, choose(null, 'auto', 'inside', 'outer')] }, addView('outer-compact', '紧凑', null, 'outer'), addView('outer-mobile', '手机', 'outer-compact', 'outer'), { type: 'insertComponent', pageId: 'home', componentId: 'outer', instanceId: 'outer-instance', x: 600, y: 100 }, choose('outer-mobile', 'fixed', 'outer-instance')]);
  const before = engine.getSnapshot(), visuals = [null, 'outer-compact', 'outer-mobile'].map(viewId => projected(engine, viewId, 'outer').nodes), pageBefore = projected(engine, null, 'home').nodes;
  engine.apply([{ type: 'removeComponent', componentId: 'card' }]);
  for (const [index, viewId] of [null, 'outer-compact', 'outer-mobile'].entries()) assertSameDetachedNodes(projected(engine, viewId, 'outer').nodes, visuals[index]);
  assertSameDetachedNodes(projected(engine, null, 'home').nodes, pageBefore); engine.undo(); assert.deepEqual(engine.getSnapshot(), before);
});

test('快照后删除auto主定义，粘贴把Base及全部已有屏幕外观转成普通元件', () => {
  const engine = fixture(); addHostViews(engine); engine.apply([choose(null, 'auto'), patch('mobile', 'picture', { placed: false })]);
  const id = sourceNodeId(engine), fragment = capturePage(engine), snapshot = structuredClone(fragment);
  const visuals = [null, 'screen-compact', 'screen-mobile'].map(viewId => node(projected(engine, viewId, 'home'), id));
  engine.apply([{ type: 'removeComponent', componentId: 'card' }, { type: 'pasteFragment', pageId: 'home', fragment, dx: 0, dy: 0, idMap: { [id]: 'restored-title' } }]);
  for (const [index, viewId] of [null, 'screen-compact', 'screen-mobile'].entries()) { const restored = node(projected(engine, viewId, 'home'), 'restored-title'); for (const key of ['x', 'y', 'width', 'height', 'rotation', 'style', 'placed']) assert.deepEqual(restored[key], visuals[index][key]); }
  assert.deepEqual(fragment, snapshot); assert.equal(page(engine).groups.find(group => group.nodeIds.includes('restored-title')).componentId, null);
});

test('快照固定视图被删除时安全脱离并保复制时外观，未知快照外观字段原子拒绝', () => {
  const engine = fixture(); engine.apply([choose('mobile')]); const id = sourceNodeId(engine), fragment = capturePage(engine);
  engine.apply([{ type: 'removeComponentView', componentId: 'card', viewId: 'mobile' }, { type: 'pasteFragment', pageId: 'home', fragment, dx: 0, dy: 0, idMap: { [id]: 'removed-view-copy' } }]);
  assert.equal(node(projected(engine, null, 'home'), 'removed-view-copy').width, 120); assert.equal(page(engine).groups.find(group => group.nodeIds.includes('removed-view-copy')).componentId, null);
  const before = engine.getSnapshot(), bad = structuredClone(fragment); bad.appearance.base[id].text = '不能伪造内容覆盖'; assert.throws(() => engine.apply([{ type: 'pasteFragment', pageId: 'home', fragment: bad }])); assert.deepEqual(engine.getSnapshot(), before);
});

test('HTML实际打包的组件解析不依赖编辑器模块或修改存储项目', () => {
  const engine = fixture(); engine.apply([choose('mobile')]); const project = engine.getSnapshot(), before = structuredClone(project);
  const standalone = standaloneComponentResolver(project); const result = standalone(project, project.pages[0], { path: [] });
  assert.equal(node(result, sourceNodeId(engine)).width, 120); assert.deepEqual(project, before); assert.deepEqual(result.groups, project.pages[0].groups);
});

test('解除组件物化命名样式与状态；后续主定义或命名样式变化不再继承，HTML投影与编辑器一致', () => {
  const engine=fixture();
  engine.apply([
    {type:'addStyle',style:{id:'detached-brand',name:'物化样式',style:{fontSize:23,fill:'#123456'},stateStyles:{hover:{fill:'#abcdef'}}}},
    {type:'componentCommands',componentId:'card',commands:[{type:'applyStyle',nodeIds:['title'],styleId:'detached-brand'}]},choose('mobile')
  ]);
  const id=sourceNodeId(engine),before=engine.getSnapshot(),visual=node(projected(engine,null,'home'),id);
  const standalone=standaloneComponentResolver(before),fromHtml=node(standalone(before,before.pages[0],{path:[]}),id);
  assert.deepEqual(JSON.parse(JSON.stringify(fromHtml.style)),visual.style);
  assert.deepEqual(JSON.parse(JSON.stringify(fromHtml.stateStyles)),visual.stateStyles);
  assert.equal(visual.style.fontSize,23);assert.equal(visual.stateStyles.hover.fill,'#abcdef');assert.deepEqual(engine.getSnapshot(),before);
  engine.apply([{type:'detachComponent',pageId:'home',instanceId:'instance'}]);
  const detached=node(page(engine),id);assert.equal(detached.styleId,null);assert.deepEqual(new Set(detached.styleOverrideKeys),new Set(Object.keys(detached.style)));
  engine.apply([
    {type:'updateStyle',styleId:'detached-brand',patch:{style:{fontSize:42},stateStyles:{hover:{fill:'#ff0000'}}}},
    {type:'updateComponentNode',componentId:'card',nodeId:'title',patch:{x:500,text:'主定义新内容'}}
  ]);
  const after=node(projected(engine,null,'home'),id);
  for(const key of ['x','y','width','height','rotation','text','style','stateStyles','interactions'])assert.deepEqual(after[key],visual[key],key);
  const saved=engine.getSnapshot(),reopened=new DocumentEngine(JSON.parse(JSON.stringify(saved)));assert.deepEqual(reopened.getSnapshot(),saved);
  assert.deepEqual(node(projected(reopened,null,'home'),id).style,visual.style);
});

test('保留名称ID可安全保存为自有视图字典键，不污染对象原型', () => {
  const engine = fixture(); engine.apply([addView('constructor', '保留名称'), patch('constructor', 'title', { width: 333 })]); assert.equal(node(projected(engine, 'constructor'), 'title').width, 333); assert.equal(Object.prototype.width, undefined);
  engine.apply([addView('__proto__', '原型名称'), patch('__proto__', 'title', { width: 222 })]); assert.equal(node(projected(engine, '__proto__'), 'title').width, 222); assert.equal(Object.prototype.width, undefined);
});

test('实例原点和放置逐宿主视图继承；母版新增或移动节点继续跟随且不强迫源节点置入', () => {
  const engine = fixture(); addHostViews(engine); const project = engine.getSnapshot(), group = project.pages[0].groups[0];
  group.placed = false; group.viewOverrides = { 'screen-compact': { x: 400, placed: true }, 'screen-mobile': { y: 600 } }; engine.replace(project);
  assert.deepEqual(resolveInstancePosition(project, project.pages[0], group, 'screen-mobile'), { x: 400, y: 600, placed: true });
  engine.apply([{ type: 'updateComponentNode', componentId: 'card', nodeId: 'title', patch: { x: 45 } }, { type: 'componentCommands', componentId: 'card', commands: [{ type: 'addNode', node: { id: 'later', type: 'button', x: 80, y: 90 } }, { type: 'addNode', node: { id: 'unplaced-source', type: 'text', placed: false } }] }]);
  const id = sourceNodeId(engine, 'later'); assert.equal(node(projected(engine, null, 'home'), id).placed, false); assert.equal(node(projected(engine, 'screen-mobile', 'home'), id).x, 480); assert.equal(node(projected(engine, 'screen-mobile', 'home'), id).y, 690); assert.equal(node(projected(engine, 'screen-mobile', 'home'), id).effectivePlaced, true);
  assert.equal(node(projected(engine, 'screen-mobile', 'home'), sourceNodeId(engine)).x, 445); assert.equal(node(projected(engine, 'screen-mobile', 'home'), sourceNodeId(engine, 'unplaced-source')).placed, false);
});

test('快照映射完整实例的宿主位置与放置，目标无匹配树原子拒绝，创建母版保留新树', () => {
  const engine = fixture(); addHostViews(engine); const project = engine.getSnapshot(); project.pages[0].groups[0].viewOverrides = { 'screen-mobile': { x: 450, placed: false } }; engine.replace(project);
  const fragment = capturePage(engine); engine.apply([{ type: 'pasteFragment', pageId: 'home', fragment, dx: 20, dy: 40, idMap: { instance: 'moved-copy' } }]);
  const copied = page(engine).groups.find(group => group.id === 'moved-copy'); assert.deepEqual(copied.viewOverrides, { 'screen-mobile': { x: 470, placed: false } });
  engine.apply([{ type: 'createComponent', pageId: 'home', nodeIds: page(engine).groups.find(group => group.id === 'instance').nodeIds, componentId: 'wrapped', name: '带视图的母版' }]);
  const wrapped = engine.getSnapshot().components.find(component => component.id === 'wrapped'), mobile = wrapped.views.find(view => view.name === '手机'); assert(mobile); assert(Object.hasOwn(wrapped.groups[0].viewOverrides, mobile.id)); assert.equal(wrapped.groups[0].viewOverrides[mobile.id].placed, false);
  assert.equal(validateProject(engine.getSnapshot()), true);
});

test('库清顶层页面实例视图覆盖但完整重映射内部组件的宿主覆盖，解除关联保各屏位置', () => {
  const engine = fixture(); addHostViews(engine); const project = engine.getSnapshot(); project.pages[0].groups[0].viewOverrides = { 'screen-mobile': { x: 450, placed: false } }; engine.replace(project);
  engine.apply([{ type: 'createComponent', pageId: 'home', nodeIds: page(engine).groups[0].nodeIds, componentId: 'wrapped', name: '带视图的母版' }, { type: 'insertComponent', pageId: 'home', componentId: 'wrapped', instanceId: 'wrapped-instance', x: 900, y: 50 }]);
  const wrappedInstance = page(engine).groups.find(group => group.id === 'wrapped-instance'), item = captureLibraryItem(engine.getSnapshot(), { pageId: 'home', nodeIds: wrappedInstance.nodeIds, name: '嵌套视图', description: '' }, h).item;
  assert.deepEqual(item.project.pages[0].groups[0].viewOverrides, {});
  const target = new DocumentEngine(createBlankProject()); target.apply([{ type: 'insertLibraryItem', pageId: target.getSnapshot().pages[0].id, item, conflictPolicy: 'copy' }]);
  const imported = target.getSnapshot().components.find(component => component.name === '带视图的母版'), mobile = imported.views.find(view => view.name === '手机'); assert.deepEqual(Object.keys(imported.groups[0].viewOverrides), [mobile.id]); assert.equal(imported.groups[0].viewOverrides[mobile.id].placed, false);
  const old = [null, 'screen-compact', 'screen-mobile'].map(viewId => projected(engine, viewId, 'home').nodes); engine.apply([{ type: 'detachComponent', pageId: 'home', instanceId: 'instance' }]);
  for (const [index, viewId] of [null, 'screen-compact', 'screen-mobile'].entries()) assertSameDetachedNodes(projected(engine, viewId, 'home').nodes, old[index]);
});

test('宿主成员置入补丁不能复活已取消放置的实例或组件源；组子视图重新置入仍有效', () => {
  for (const reason of ['group-base', 'group-view', 'source-base', 'source-view']) {
    const engine = fixture(); addHostViews(engine); engine.apply([choose(null, 'auto')]);
    const project = engine.getSnapshot(), host = project.pages[0], group = host.groups[0], id = group.nodeIds[group.sourceIds.indexOf('title')];
    host.viewOverrides = { 'screen-compact': { [id]: { placed: true } }, 'screen-mobile': { [id]: { placed: true } } };
    if (reason === 'group-base') group.placed = false;
    if (reason === 'group-view') group.viewOverrides = { 'screen-mobile': { placed: false } };
    if (reason === 'source-base') project.components[0].nodes.find(n => n.id === 'title').placed = false;
    if (reason === 'source-view') project.components[0].viewOverrides.mobile.title.placed = false;
    engine.replace(project); const before = engine.getSnapshot(), resolved = node(projected(engine, 'screen-mobile', 'home'), id);
    assert.equal(resolved.placed, false, reason); assert.equal(resolved.effectivePlaced, false, reason); assert.deepEqual(engine.getSnapshot(), before);
    assert.equal(validateProject(before), true); assert.equal(node(resolveCanvasView(new DocumentEngine(JSON.parse(JSON.stringify(before))).getSnapshot(), before.pages[0], 'screen-mobile'), id).effectivePlaced, false);
    if (reason === 'group-base') {
      const reopened = engine.getSnapshot(); reopened.pages[0].groups[0].viewOverrides = { 'screen-mobile': { placed: true } }; engine.replace(reopened);
      assert.equal(node(projected(engine, 'screen-mobile', 'home'), id).effectivePlaced, true);
      assert.equal(node(projected(engine, 'screen-compact', 'home'), id).effectivePlaced, false);
    }
  }
});

test('嵌套组件和普通组的取消放置最终生效，普通源节点仍可在自己的视图重新置入', () => {
  for (const reason of ['nested-group', 'nested-source', 'ordinary-group']) {
    const engine = fixture(); addHostViews(engine);
    engine.apply([{ type: 'addComponent', component: { id: 'outer', name: '外层', nodes: [makeNode('text', { id: 'note', placed: false })] } },
      { type: 'componentCommands', componentId: 'outer', commands: [{ type: 'insertComponent', componentId: 'card', instanceId: 'inside', x: 50, y: 60 }, choose(null, 'auto', 'inside', 'outer')] },
      addView('outer-compact', '紧凑', null, 'outer'), addView('outer-mobile', '手机', 'outer-compact', 'outer'),
      { type: 'insertComponent', pageId: 'home', componentId: 'outer', instanceId: 'outer-instance', x: 600, y: 100 }, choose('outer-mobile', 'fixed', 'outer-instance')]);
    const project = engine.getSnapshot(), outer = project.components.find(c => c.id === 'outer'), inner = outer.groups[0], innerId = inner.nodeIds[inner.sourceIds.indexOf('title')], instance = project.pages[0].groups.find(g => g.id === 'outer-instance'), pageId = instance.nodeIds[instance.sourceIds.indexOf(innerId)];
    outer.viewOverrides = { 'outer-mobile': { [innerId]: { placed: true }, note: { placed: true } } };
    project.pages[0].viewOverrides = { 'screen-mobile': { [pageId]: { placed: true } } };
    if (reason === 'nested-group') inner.viewOverrides = { 'outer-mobile': { placed: false } };
    if (reason === 'nested-source') project.components.find(c => c.id === 'card').viewOverrides.mobile.title.placed = false;
    if (reason === 'ordinary-group') { inner.componentId = null; inner.sourceIds = []; inner.internalIds = {}; inner.overrides = {}; inner.viewMode = 'fixed'; inner.viewId = null; inner.viewOverrides = {}; inner.placed = false; }
    engine.replace(project); const before = engine.getSnapshot();
    assert.equal(node(projected(engine, 'outer-mobile', 'outer'), innerId).effectivePlaced, false, reason);
    assert.equal(node(projected(engine, 'screen-mobile', 'home'), pageId).effectivePlaced, false, reason);
    assert.equal(node(projected(engine, 'outer-mobile', 'outer'), 'note').effectivePlaced, true);
    const standalone = standaloneComponentResolver(before);
    assert.equal(node(standalone(before, before.components.find(c => c.id === 'outer'), { viewId: 'outer-mobile', path: ['紧凑', '手机'] }), innerId).placed, false);
    assert.deepEqual(engine.getSnapshot(), before);
  }
});
