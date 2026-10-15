import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankProject, makeNode, DocumentEngine, validateProject } from '../app/core/document.mjs';
import { resolveNodeBaseStyle, resolveNodeStateStyles } from '../app/core/style-model.mjs';

function fixture() {
  const project = createBlankProject('快照粘贴'); project.id = 'clipboard-project'; project.pages[0].id = 'home';
  project.pages[0].nodes = [
    makeNode('button', { id: 'button', text: '复制时按钮', x: 30, y: 40, interactions: [{ event: 'click', actions: [{ type: 'setText', targetId: 'label', value: '内部响应' }, { type: 'setText', targetId: 'outside', value: '外部响应' }] }] }),
    makeNode('text', { id: 'label', text: '复制时文字', x: 230, y: 50 }),
    makeNode('text', { id: 'outside', text: '外部', x: 500, y: 50 })
  ];
  return new DocumentEngine(project);
}
const page = (engine, id = 'home') => engine.getSnapshot().pages.find(page => page.id === id);
const node = (engine, id, pageId = 'home') => page(engine, pageId).nodes.find(node => node.id === id);
function capture(engine, nodeIds, sourceId = 'home') {
  const snapshot = engine.getSnapshot(), source = [...snapshot.pages, ...snapshot.components].find(container => container.id === sourceId);
  return structuredClone({ projectId: snapshot.id, sourceId, nodes: source.nodes, groups: source.groups, views: source.views || [], nodeIds });
}
const paste = (fragment, options = {}) => ({ type: 'pasteFragment', pageId: 'home', fragment, ...options });
const update = (nodeId, patch) => ({ type: 'updateNode', pageId: 'home', nodeId, patch });

function captureWithAppearance(engine, nodeIds) {
  const fragment = capture(engine, nodeIds), project = engine.getSnapshot();
  fragment.appearance = {
    base: Object.fromEntries(fragment.nodes.map(node => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation, placed: node.placed, style: resolveNodeBaseStyle(project, node) }])),
    views: {}, stateStyles: Object.fromEntries(fragment.nodes.map(node => [node.id, resolveNodeStateStyles(project, node)]))
  };
  return fragment;
}

test('桌面外观快照的状态样式字段可严格通过粘贴，旧版快照继续兼容', () => {
  const engine = fixture();
  engine.apply([update('label', { stateStyles: { hover: { color: '#336699', padding: { top: 1, right: 2, bottom: 3, left: 4 } } } })]);
  const fragment = captureWithAppearance(engine, ['label']), recorded = structuredClone(fragment);
  const before = engine.getSnapshot();
  engine.apply([paste(fragment, { idMap: { label: 'renderer-copy' } })]);
  assert.deepEqual(node(engine, 'renderer-copy').stateStyles, node(engine, 'label').stateStyles);
  assert.equal(node(engine, 'renderer-copy').x, node(engine, 'label').x + 24);
  const after = engine.getSnapshot(); engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.deepEqual(engine.getSnapshot(), after);
  const legacy = structuredClone(fragment); delete legacy.appearance.stateStyles;
  engine.apply([paste(legacy, { idMap: { label: 'legacy-appearance-copy' } })]);
  assert.equal(node(engine, 'legacy-appearance-copy').text, '复制时文字'); assert.deepEqual(fragment, recorded);
});

test('外观快照状态必须引用真实元件及合法状态样式，错误整批回滚', () => {
  const engine = fixture(), fragment = captureWithAppearance(engine, ['label']), before = engine.getSnapshot(), revision = engine.revision;
  const mutations = [
    value => { value.appearance.stateStyles.missing = {}; },
    value => { value.appearance.stateStyles.label = { unknownState: {} }; },
    value => { value.appearance.stateStyles.label = { hover: { script: 'not allowed' } }; },
    value => { value.appearance.stateStyles.label = { hover: { padding: { top: 1 } } }; },
    value => { value.appearance.stateStyles.label = { hover: { opacity: NaN } }; },
    value => { value.appearance.stateStyles = null; },
    value => { delete value.appearance.base; },
    value => { value.appearance.extra = {}; }
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(fragment); mutate(invalid);
    assert.throws(() => engine.apply([{ type: 'renameProject', name: '不得部分保留' }, paste(invalid)]), { code: 'VALIDATION_ERROR' });
    assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, revision);
  }
});

test('复制后命名样式状态改变或删除，粘贴保留捕获的稀疏继承状态', () => {
  const engine = fixture();
  engine.apply([{type:'addStyle',style:{id:'captured-style',name:'复制前样式',style:{color:'#334455'},stateStyles:{hover:{fill:'#112233'}}}},{type:'applyStyle',pageId:'home',nodeIds:['label'],styleId:'captured-style'}]);
  const fragment=captureWithAppearance(engine,['label']);
  engine.apply([paste(fragment,{idMap:{label:'unchanged-style-copy'}})]);
  assert.equal(node(engine,'unchanged-style-copy').styleId,'captured-style');
  engine.apply([{type:'updateStyle',styleId:'captured-style',patch:{stateStyles:{hover:{fill:'#AABBCC'},pressed:{color:'#FF0000'}}}}]);
  engine.apply([paste(fragment,{idMap:{label:'frozen-state-copy'}})]);
  const snapshot=engine.getSnapshot(),pasted=node(engine,'frozen-state-copy');
  assert.equal(pasted.styleId,null);assert.deepEqual(resolveNodeStateStyles(snapshot,pasted),{hover:{fill:'#112233'}});
  engine.apply([{type:'removeStyle',styleId:'captured-style'},paste(fragment,{idMap:{label:'deleted-state-copy'}})]);
  assert.deepEqual(resolveNodeStateStyles(engine.getSnapshot(),node(engine,'deleted-state-copy')),{hover:{fill:'#112233'}});
});

test('项目默认状态变化不会重新污染粘贴快照，隔离资源随整批撤销且仅为实际副本创建', () => {
  const engine=fixture();
  engine.apply([{type:'addDefaultStyleSet',defaultStyleSet:{id:'defaults',name:'项目默认',byType:{text:{stateStyles:{hover:{color:'#112233'}}}}}},{type:'setProjectDefaultStyleSet',defaultStyleSetId:'defaults'}]);
  const fragment=captureWithAppearance(engine,['label']),other=captureWithAppearance(engine,['button']);
  engine.apply([{type:'updateDefaultStyleSet',defaultStyleSetId:'defaults',patch:{byType:{text:{stateStyles:{hover:{color:'#AABBCC'},pressed:{fill:'#FF0000'}}}}}}]);
  engine.apply([paste(other,{idMap:{button:'unchanged-button'}})]);assert.equal(engine.getSnapshot().defaultStyleSets.length,1);
  const before=engine.getSnapshot();engine.apply([paste(fragment,{idMap:{label:'default-state-copy'}})]);
  const saved=engine.getSnapshot(),pasted=node(engine,'default-state-copy');
  assert.equal(saved.defaultStyleSetId,'defaults');assert.equal(saved.defaultStyleSets.length,2);assert.notEqual(pasted.defaultStyleSetId,'defaults');
  assert.deepEqual(resolveNodeStateStyles(saved,pasted),{hover:{color:'#112233'}});assert.equal(pasted.stateStyles.pressed,undefined);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(saved))).getSnapshot(),saved);
  engine.undo();assert.deepEqual(engine.getSnapshot(),before);engine.redo();assert.deepEqual(engine.getSnapshot(),saved);
});

test('关联母版仍存在但复制时样式已删除，粘贴修复旧引用并继续跟随母版', () => {
  const engine=fixture();
  engine.apply([{type:'addStyle',style:{id:'linked-style',name:'母版样式',style:{color:'#334455'},stateStyles:{hover:{fill:'#112233'}}}},{type:'applyStyle',pageId:'home',nodeIds:['label'],styleId:'linked-style'},{type:'createComponent',pageId:'home',nodeIds:['label'],componentId:'styled-card',name:'带样式母版'},{type:'insertComponent',pageId:'home',componentId:'styled-card',instanceId:'styled-instance',x:600,y:100}]);
  const instance=page(engine).groups.find(group=>group.id==='styled-instance'),fragment=captureWithAppearance(engine,[instance.nodeIds[0]]);
  engine.apply([{type:'removeStyle',styleId:'linked-style'},{type:'updateComponentNode',componentId:'styled-card',nodeId:instance.sourceIds[0],patch:{text:'母版新内容'}}]);
  engine.apply([paste(fragment,{idMap:{'styled-instance':'linked-after-delete'}})]);
  const pasted=page(engine).groups.find(group=>group.id==='linked-after-delete');
  assert.equal(pasted.componentId,'styled-card');assert.equal(node(engine,pasted.nodeIds[0]).text,'母版新内容');assert.equal(node(engine,pasted.nodeIds[0]).styleId,null);
  assert.equal(engine.getSnapshot().defaultStyleSets.length,0);assert.equal(validateProject(engine.getSnapshot()),true);
});

test('复制后改字移动或删除源，粘贴仍使用复制时快照，输入快照保持不变', () => {
  const engine = fixture(), fragment = capture(engine, ['label']), recorded = structuredClone(fragment);
  engine.apply([update('label', { text: '后改内容', x: 800, style: { color: '#123456' } })]);
  engine.apply([paste(fragment, { idMap: { button: 'ignored-button', label: 'first-copy', outside: 'ignored-outside' } })]);
  assert.equal(node(engine, 'first-copy').text, '复制时文字'); assert.equal(node(engine, 'first-copy').x, 254); assert.equal(node(engine, 'first-copy').style.color, '#191919');
  assert.equal(node(engine, 'ignored-button'), undefined);
  engine.apply([{ type: 'removeNodes', pageId: 'home', nodeIds: ['label'] }]);
  const before = engine.getSnapshot(); engine.apply([paste(fragment, { idMap: { label: 'second-copy' }, dx: 0, dy: 0 })]);
  assert.equal(node(engine, 'second-copy').text, '复制时文字'); assert.equal(node(engine, 'second-copy').x, 230);
  const after = engine.getSnapshot(); engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.deepEqual(engine.getSnapshot(), after);
  assert.deepEqual(fragment, recorded); assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(), after);
});

test('同页粘贴内部动作重映射，仍存在的外部引用保留，已删除的外部引用清理', () => {
  const engine = fixture(), fragment = capture(engine, ['button', 'label']);
  engine.apply([paste(fragment, { idMap: { button: 'button-copy', label: 'label-copy' } })]);
  assert.deepEqual(node(engine, 'button-copy').interactions[0].actions.map(action => action.targetId), ['label-copy', 'outside']);
  engine.apply([{ type: 'removeNodes', pageId: 'home', nodeIds: ['outside'] }]);
  engine.apply([paste(fragment, { idMap: { button: 'button-copy-2', label: 'label-copy-2' } })]);
  assert.deepEqual(node(engine, 'button-copy-2').interactions[0].actions.map(action => action.targetId), ['label-copy-2']);
});

test('跨页粘贴和原页面已删除时仍保留完整组、容器后代及复制时交互', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', panelId: 'panel', nodeIds: ['button', 'label'] }, { type: 'groupNodes', pageId: 'home', nodeIds: ['panel', 'outside'], groupId: 'whole-group' }]);
  const fragment = capture(engine, ['panel']), panel = node(engine, 'panel'), sourceState = panel.panel.states[0].id;
  engine.apply([{ type: 'addPage', page: { id: 'target', name: '目标' } }, { type: 'removePage', pageId: 'home' }]);
  engine.apply([paste(fragment, { pageId: 'target', dx: 100, dy: 200, idMap: { panel: 'panel-copy', button: 'button-copy', label: 'label-copy', outside: 'outside-copy', 'whole-group': 'group-copy', [sourceState]: 'state-copy' } })]);
  assert.equal(page(engine, 'target').groups[0].id, 'group-copy'); assert.equal(page(engine, 'target').nodes.length, 4);
  assert.deepEqual(node(engine, 'panel-copy', 'target').panel.states[0].nodeIds, ['button-copy', 'label-copy']); assert.equal(node(engine, 'panel-copy', 'target').panel.initialStateId, 'state-copy');
  assert.equal(node(engine, 'button-copy', 'target').text, '复制时按钮'); assert.deepEqual(node(engine, 'button-copy', 'target').interactions[0].actions.map(action => action.targetId), ['label-copy', 'outside-copy']);
  assert.equal(node(engine, 'label-copy', 'target').x, 330);
});

test('中继器快照保留数据行、模板绑定和内部引用，源修改不改变粘贴数据', () => {
  const engine = fixture(); engine.apply([{ type: 'createRepeater', pageId: 'home', nodeId: 'list', nodeIds: ['label'] }, update('label', { bindings: { text: { op: 'item', column: 'title' } } })]);
  const fragment = capture(engine, ['list']), oldRow = node(engine, 'list').repeater.rows[0];
  engine.apply([{ type: 'updateRepeaterRow', pageId: 'home', nodeId: 'list', rowId: oldRow.id, values: { title: '后改数据' } }]);
  engine.apply([paste(fragment, { idMap: { list: 'list-copy', label: 'template-copy', [oldRow.id]: 'first-row-copy' } })]);
  const list = node(engine, 'list-copy'); assert.equal(list.repeater.rows[0].id, 'first-row-copy'); assert.equal(list.repeater.rows[0].values.title, oldRow.values.title); assert.deepEqual(list.repeater.templateIds, ['template-copy']);
  assert.deepEqual(node(engine, 'template-copy').bindings, { text: { op: 'item', column: 'title' } });
});

test('同页粘贴恢复复制时的面板状态归属，保留快照内容、现有状态成员和撤销重做', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', panelId: 'panel', nodeIds: ['label'] }, { type: 'addPanelState', pageId: 'home', panelId: 'panel', state: { id: 'alternate', name: '其他状态' } }]);
  const originalStateId = node(engine, 'panel').panel.initialStateId, fragment = capture(engine, ['label']), captured = structuredClone(fragment);
  engine.apply([update('label', { text: '复制之后修改', x: 900 }), { type: 'assignPanelNodes', pageId: 'home', panelId: 'panel', stateId: 'alternate', nodeIds: ['label'] }, { type: 'assignPanelNodes', pageId: 'home', panelId: 'panel', stateId: originalStateId, nodeIds: ['outside'] }]);
  const before = engine.getSnapshot(); engine.apply([paste(fragment, { idMap: { label: 'state-copy' } })]);
  const panel = node(engine, 'panel'); assert.deepEqual(panel.panel.states.find(state => state.id === originalStateId).nodeIds, ['outside', 'state-copy']); assert.deepEqual(panel.panel.states.find(state => state.id === 'alternate').nodeIds, ['label']);
  assert.equal(node(engine, 'state-copy').text, '复制时文字'); assert.equal(node(engine, 'state-copy').x, 254); assert.deepEqual(fragment, captured);
  const after = engine.getSnapshot(); engine.undo(); assert.deepEqual(engine.getSnapshot(), before); engine.redo(); assert.deepEqual(engine.getSnapshot(), after);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(), after);
});

test('同页复制中继器内的嵌套面板或单个模板元件，保留模板归属及数据行绑定', () => {
  const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', panelId: 'panel', nodeIds: ['label'] }, { type: 'createRepeater', pageId: 'home', nodeId: 'list', nodeIds: ['panel'] }, update('label', { bindings: { text: { op: 'item', column: 'title' } }, interactions: [{ event: 'click', condition: { op: 'eq', args: [{ op: 'item', column: 'title' }, '第一条数据'] }, actions: [{ type: 'setText', targetId: 'label', value: { op: 'item', column: 'title' } }] }] })]);
  const child = capture(engine, ['label']), container = capture(engine, ['panel']);
  engine.apply([paste(child, { idMap: { label: 'child-copy' } }), paste(container, { idMap: { panel: 'panel-copy', label: 'nested-copy' } })]);
  assert.deepEqual(node(engine, 'panel').panel.states[0].nodeIds, ['label', 'child-copy']); assert.deepEqual(node(engine, 'list').repeater.templateIds, ['panel', 'panel-copy']);
  assert.deepEqual(node(engine, 'panel-copy').panel.states[0].nodeIds, ['nested-copy']);
  for (const id of ['child-copy', 'nested-copy']) { const copied = node(engine, id); assert.deepEqual(copied.bindings, { text: { op: 'item', column: 'title' } }); assert.equal(copied.interactions[0].condition.op, 'eq'); assert.equal(copied.interactions[0].actions[0].value.op, 'item'); assert.equal(copied.interactions[0].actions[0].targetId, id); }
  assert.equal(validateProject(engine.getSnapshot()), true);
});

test('源元件、原容器或原状态删除后，快照仍可粘贴成独立元件并清理数据行绑定', () => {
  for (const removed of ['source', 'container', 'state']) {
    const engine = fixture(); engine.apply([{ type: 'createDynamicPanel', pageId: 'home', panelId: 'panel', nodeIds: ['label'] }, { type: 'addPanelState', pageId: 'home', panelId: 'panel', state: { id: 'alternate', name: '备用状态' } }, { type: 'createRepeater', pageId: 'home', nodeId: 'list', nodeIds: ['panel'] }, update('label', { bindings: { text: { op: 'item', column: 'title' } }, interactions: [{ event: 'click', condition: { op: 'eq', args: [{ op: 'item', column: 'title' }, '第一条数据'] }, actions: [{ type: 'setText', targetId: 'label', value: { op: 'item', column: 'title' } }] }] })]);
    const fragment = capture(engine, ['label']), stateId = node(engine, 'panel').panel.initialStateId;
    engine.apply([removed === 'state' ? { type: 'removePanelState', pageId: 'home', panelId: 'panel', stateId } : { type: 'removeNodes', pageId: 'home', nodeIds: [removed === 'source' ? 'label' : 'panel'] }]);
    engine.apply([paste(fragment, { idMap: { label: 'standalone-copy' } })]);
    const copied = node(engine, 'standalone-copy'); assert.equal(copied.text, '复制时文字', removed); assert.deepEqual(copied.bindings, {}, removed); assert.equal(copied.interactions[0].condition, false, removed); assert.deepEqual(copied.interactions[0].actions, [], removed);
    for (const owner of page(engine).nodes) { assert.ok(!owner.panel?.states.some(state => state.nodeIds.includes(copied.id)), removed); assert.ok(!owner.repeater?.templateIds.includes(copied.id), removed); }
    assert.equal(validateProject(engine.getSnapshot()), true);
  }
});

test('跨页粘贴单个模板子元件不会加入源容器，仍会清理失去上下文的数据行绑定', () => {
  const engine = fixture(); engine.apply([{ type: 'createRepeater', pageId: 'home', nodeId: 'list', nodeIds: ['label'] }, update('label', { bindings: { text: { op: 'item', column: 'title' } } }), { type: 'addPage', page: { id: 'target' } }]);
  const fragment = capture(engine, ['label']); engine.apply([paste(fragment, { pageId: 'target', idMap: { label: 'cross-page-copy' } })]);
  assert.deepEqual(node(engine, 'list').repeater.templateIds, ['label']); assert.deepEqual(node(engine, 'cross-page-copy', 'target').bindings, {});
});

test('母版画布内粘贴模板子元件也恢复原容器归属，页面实例同步并保持内部 ID 有效', () => {
  const engine = fixture(); engine.apply([{ type: 'createRepeater', pageId: 'home', nodeId: 'list', nodeIds: ['label'] }, update('label', { bindings: { text: { op: 'item', column: 'title' } } }), { type: 'createComponent', pageId: 'home', nodeIds: ['list'], componentId: 'card', name: '列表母版' }, { type: 'insertComponent', pageId: 'home', componentId: 'card', instanceId: 'card-instance', x: 600, y: 100 }]);
  const component = engine.getSnapshot().components[0], template = component.nodes.find(node => node.type === 'text'), fragment = capture(engine, [template.id], component.id);
  engine.apply([{ type: 'componentCommands', componentId: component.id, commands: [paste(fragment, { pageId: component.id, idMap: { [template.id]: 'master-template-copy' } })] }]);
  const changed = engine.getSnapshot().components[0]; assert.ok(changed.nodes.find(node => node.repeater).repeater.templateIds.includes('master-template-copy'));
  assert.deepEqual(changed.nodes.find(node => node.id === 'master-template-copy').bindings, { text: { op: 'item', column: 'title' } });
  const instance = page(engine).groups.find(group => group.id === 'card-instance'), instanceId = instance.nodeIds[instance.sourceIds.indexOf('master-template-copy')];
  assert.ok(page(engine).nodes.find(node => node.repeater && instance.nodeIds.includes(node.id)).repeater.templateIds.includes(instanceId)); assert.equal(validateProject(engine.getSnapshot()), true);
});

test('连接线与端点一起粘贴时重映射，跨页单独粘贴失去目标的连接线会跳过', () => {
  const engine = fixture(); engine.apply([{ type: 'addNode', pageId: 'home', node: { id: 'link', type: 'connector', connector: { from: { nodeId: 'button', side: 'right' }, to: { nodeId: 'label', side: 'left' }, route: 'straight', arrow: 'end' } } }]);
  const complete = capture(engine, ['button', 'label', 'link']), connectorOnly = capture(engine, ['link']);
  engine.apply([{ type: 'addPage', page: { id: 'target' } }, paste(complete, { pageId: 'target', idMap: { button: 'button-copy', label: 'label-copy', link: 'link-copy' } })]);
  assert.equal(node(engine, 'link-copy', 'target').connector.from.nodeId, 'button-copy'); assert.equal(node(engine, 'link-copy', 'target').connector.to.nodeId, 'label-copy');
  const count = page(engine, 'target').nodes.length; engine.apply([paste(connectorOnly, { pageId: 'target' })]); assert.equal(page(engine, 'target').nodes.length, count);
});

test('命名样式变化或删除后粘贴保留快照外观，不重新套用新版样式', () => {
  const engine = fixture(); engine.apply([{ type: 'addStyle', style: { id: 'brand', name: '品牌', style: { color: '#334455' } } }, { type: 'applyStyle', pageId: 'home', nodeIds: ['label'], styleId: 'brand' }]);
  const fragment = capture(engine, ['label']);
  engine.apply([paste(fragment, { idMap: { label: 'same-style' } })]); assert.equal(node(engine, 'same-style').styleId, 'brand');
  engine.apply([{ type: 'updateStyle', styleId: 'brand', patch: { style: { color: '#998877' } } }, paste(fragment, { idMap: { label: 'old-style' } })]);
  assert.equal(node(engine, 'old-style').styleId, null); assert.equal(node(engine, 'old-style').style.color, '#334455');
  engine.apply([{ type: 'removeStyle', styleId: 'brand' }, paste(fragment, { idMap: { label: 'deleted-style' } })]);
  assert.equal(node(engine, 'deleted-style').styleId, null); assert.equal(node(engine, 'deleted-style').style.color, '#334455');
});

test('母版仍存在时粘贴保留关联；母版删除后粘贴保留快照内容成为普通组', () => {
  const engine = fixture(); engine.apply([update('button', { interactions: [] }), { type: 'createComponent', pageId: 'home', nodeIds: ['button', 'label'], componentId: 'card', name: '卡片' }, { type: 'insertComponent', pageId: 'home', componentId: 'card', instanceId: 'instance', x: 600, y: 100 }]);
  const instance = page(engine).groups[0], fragment = capture(engine, [instance.nodeIds[0]]), sourceId = instance.sourceIds[0];
  engine.apply([{ type: 'updateComponentNode', componentId: 'card', nodeId: sourceId, patch: { text: '主定义新版' } }, paste(fragment, { idMap: { instance: 'linked-paste' } })]);
  let owner = page(engine).groups.find(group => group.id === 'linked-paste'); assert.equal(owner.componentId, 'card'); assert.equal(node(engine, owner.nodeIds[owner.sourceIds.indexOf(sourceId)]).text, '主定义新版');
  engine.apply([{ type: 'removeComponent', componentId: 'card' }, paste(fragment, { idMap: { instance: 'detached-paste' } })]);
  owner = page(engine).groups.find(group => group.id === 'detached-paste'); assert.equal(owner.componentId, null); assert.deepEqual(owner.sourceIds, []); assert.deepEqual(owner.overrides, {});
  assert.equal(node(engine, owner.nodeIds[0]).text, '复制时按钮');
});

test('普通锁定组或元件的粘贴副本解锁，不改变原件锁定', () => {
  const engine = fixture(); engine.apply([update('button', { locked: true }), update('label', { locked: true })]);
  let fragment = capture(engine, ['label']); engine.apply([paste(fragment, { idMap: { label: 'unlocked-copy' } })]);
  assert.equal(node(engine, 'unlocked-copy').locked, false); assert.equal(node(engine, 'label').locked, true);
  engine.apply([update('button', { locked: false }), update('label', { locked: false }), { type: 'groupNodes', pageId: 'home', nodeIds: ['button', 'label'], groupId: 'locked-group' }, { type: 'lockGroup', pageId: 'home', groupId: 'locked-group', locked: true }]);
  fragment = capture(engine, ['button']); engine.apply([paste(fragment, { idMap: { 'locked-group': 'unlocked-group' } })]);
  assert.equal(page(engine).groups.find(group => group.id === 'locked-group').locked, true); assert.equal(page(engine).groups.find(group => group.id === 'unlocked-group').locked, false);
});

test('源页面自适应覆盖随副本保存；粘贴到母版只保留基础节点，不写入不支持的视图', () => {
  const engine = fixture(); engine.apply([{ type: 'addAdaptiveView', pageId: 'home', view: { id: 'small', name: '小屏', minWidth: 0, width: 500, height: 800, overrides: { label: { x: 50, text: '小屏文字' } } } }, { type: 'addComponent', component: { id: 'card', nodes: [{ id: 'source-title', type: 'text', text: '主定义' }] } }]);
  const fragment = capture(engine, ['label']);
  engine.apply([{ type: 'addPage', page: { id: 'target' } }, paste(fragment, { pageId: 'target', idMap: { label: 'view-copy' }, dx: 10, dy: 20 })]);
  assert.equal(page(engine, 'target').views[0].overrides['view-copy'].x, 60); assert.equal(page(engine, 'target').views[0].overrides['view-copy'].text, '小屏文字');
  engine.apply([{ type: 'componentCommands', componentId: 'card', commands: [{ ...paste(fragment, { idMap: { label: 'in-master' } }), pageId: 'card' }] }]);
  const card = engine.getSnapshot().components[0]; assert.equal(card.nodes.find(node => node.id === 'in-master').text, '复制时文字'); assert.deepEqual(card.views, []); assert.deepEqual(card.viewOverrides, {});
  const fromMaster = capture(engine, ['source-title'], 'card'); engine.apply([paste(fromMaster, { idMap: { 'source-title': 'from-master' } })]); assert.equal(node(engine, 'from-master').text, '主定义');
});

test('剪贴板引用的变量或导航页面删除后粘贴清理失效动作和条件', () => {
  const engine = fixture(); engine.apply([{ type: 'addVariable', variable: { name: 'count', type: 'number', value: 1 } }, { type: 'addPage', page: { id: 'target' } }, update('button', { interactions: [{ event: 'click', actions: [{ type: 'navigate', pageId: 'target' }, { type: 'setVariable', name: 'count', value: 2 }] }] }), update('label', { bindings: { text: { op: 'var', name: 'count' } } })]);
  const fragment = capture(engine, ['button', 'label']); engine.apply([{ type: 'removePage', pageId: 'target' }, { type: 'removeVariable', name: 'count' }, paste(fragment, { idMap: { button: 'button-copy', label: 'label-copy' } })]);
  assert.deepEqual(node(engine, 'button-copy').interactions[0].actions, []); assert.deepEqual(node(engine, 'label-copy').bindings, {}); assert.equal(validateProject(engine.getSnapshot()), true);
});

test('跨项目、无效快照和冲突ID原子拒绝，不泄漏前置修改；同一快照能多次粘贴', () => {
  const engine = fixture(), fragment = capture(engine, ['label']), before = engine.getSnapshot();
  for (const command of [paste({ ...fragment, projectId: 'another-project' }), paste({ ...fragment, nodeIds: ['missing'] }), paste(fragment, { idMap: { label: 'outside' } }), paste(fragment, { idMap: { unowned: 'invalid-copy' } }), paste({ ...fragment, groups: [{ id: 'invalid-group' }] }), paste({ ...fragment, nodes: fragment.nodes.map(node => node.id === 'label' ? { ...node, x: NaN } : node) })]) {
    assert.throws(() => engine.apply([update('outside', { text: '不应留下' }), command])); assert.deepEqual(engine.getSnapshot(), before);
  }
  const cyclic = structuredClone(fragment); cyclic.nodes[0].bindings.text = cyclic.nodes[0];
  assert.throws(() => engine.apply([paste(cyclic)]), /循环引用/); assert.deepEqual(engine.getSnapshot(), before);
  engine.apply([paste(fragment), paste(fragment)]); assert.equal(page(engine).nodes.length, 5); assert.equal(new Set(page(engine).nodes.map(node => node.id)).size, 5);
});
