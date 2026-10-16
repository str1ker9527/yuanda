'use strict';

// Original editor UI. The main process owns the document; every edit is a command.
const $ = (selector, root = document) => root.querySelector(selector);
const api = window.yuanda;
const types = { rectangle: '矩形', text: '文字', button: '按钮', input: '输入框', image: '图片', ellipse: '椭圆', line: '线段', textarea: '多行文本框', checkbox: '复选框', radio: '单选按钮', select: '下拉列表', table: '表格', dynamicPanel: '动态面板', repeater: '数据列表', path: '矢量路径', connector: '连接线' };
const symbols = { rectangle: '矩', text: 'T', button: '按', input: '入', image: '图', ellipse: '圆', line: '线', textarea: '文', checkbox: '选', radio: '单', select: '列', table: '表', dynamicPanel: '板', repeater: '集' };
let state = null;
let pageId = null;
let componentId = null, lastPageId = null, componentPageCache = null, componentSourceCache = null;
let selected = [];
let activeTab = 'design';
let zoom = .75;
let snap = true;
let clipboard = null, clipboardToken = null, clipboardCopySequence = 0, pendingClipboardCopy = Promise.resolve();
let pointerSession = null;
let inlineEditor = null;
let pendingTextCommit = Promise.resolve(true), textDraftDialog = null, commandFailure = null;
let commandQueue = Promise.resolve();
let reviewedBatch = null;
let firstState = true;
let busy = false;
let inspectorTarget = null;
let viewModel = null, readingContext = null, viewEditCommands = new Set();
let styleRenderer = null, widgetGeometry = null, arrangementModel = null;
let pageTreeModel = null;
const pageTreeReady = import('../core/page-tree-model.mjs').then(module => { pageTreeModel = module; });
const editingContexts = new Map();
const viewModelReady = Promise.all([import('../core/view-model.mjs'),import('../core/view-commands.mjs')]).then(([module,commands]) => { viewModel = module;viewEditCommands=new Set(commands.VIEW_EDIT_COMMANDS); });
const styleRendererReady = Promise.all([import('../core/style-renderer.mjs'),import('../core/widget-geometry.mjs'),import('../core/editor-arrangement.mjs')]).then(([styles,geometry,arrangement])=>{styleRenderer=styles;widgetGeometry=geometry;arrangementModel=arrangement;});
const changed = () => document.dispatchEvent(new CustomEvent('yuanda:editorchange'));

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, title, action, className = '') {
  const element = el('button', className, text);
  element.type = 'button';
  if (title) element.title = title;
  element.addEventListener('click', action);
  return element;
}
function rawPage(targetId = readingContext?.targetId || componentId || pageId) {
  const ordinary = state?.project.pages.find(item => item.id === targetId);
  if (ordinary) return ordinary;
  const component = state?.project.components.find(item => item.id === targetId);
  if (!component) return null;
  if (component !== componentSourceCache) {
    componentSourceCache = component;
    componentPageCache = { parentId:null,background:'#FFFFFF',annotation:'',guides:{horizontal:[],vertical:[]},groups:[],views:[],interactions:[],...component };
  }
  return componentPageCache;
}
function captureContext(targetId = componentId || pageId) {
  const kind = state?.project.components.some(item => item.id === targetId) ? 'component' : 'page';
  const key = `${state?.project.id}:${kind}:${targetId}`;
  const saved = editingContexts.get(key) || { viewId:null,scope:'current' };
  const definitions = viewModel && state ? viewModel.getCanvasViews(state.project, rawPage(targetId)) : [];
  const viewId = definitions.some(view => view.id === saved.viewId) ? saved.viewId : null;
  return { projectId:state?.project.id,targetKind:kind,targetId,viewId,scope:saved.scope,nodeIds:[...selected] };
}
function page(context = readingContext || captureContext()) {
  const source = rawPage(context.targetId); if (!source) return null;
  return viewModel ? viewModel.resolveContainerView(state.project, context.targetId, context.viewId) : source;
}
function rememberContext(context) { editingContexts.set(`${context.projectId}:${context.targetKind}:${context.targetId}`,{viewId:context.viewId,scope:context.scope}); }
async function setEditingView(viewId) {
  const before = captureContext(); if (!await flushPendingEdits($('#adaptive-view-picker'))) return false;
  if (state.project.id !== before.projectId || getEditingTarget().id !== before.targetId) return false;
  const definitions = viewModel.getCanvasViews(state.project,rawPage());
  if (viewId !== null && !definitions.some(view => view.id === viewId)) { toast('此视图已不存在，请重新选择。','warning'); return false; }
  cancelPointer(); window.YuandaVector?.stopTools?.(); rememberContext({...before,viewId}); render(); changed(); return true;
}
async function setEditingScope(scope) {
  if (!['current','all'].includes(scope)) return false;
  const before = captureContext(); if (!await flushPendingEdits($('#view-scope-picker'))) return false;
  if (state.project.id !== before.projectId || getEditingTarget().id !== before.targetId) return false;
  cancelPointer(); rememberContext({...before,scope}); render(); changed(); return true;
}
function getEditingTarget() { return { kind:componentId?'component':'page',id:componentId||pageId }; }
function openPage(id) { if (!state?.project.pages.some(item => item.id === id)) return; setSelection([], id); fitPage(); }
function openComponent(id) {
  if (!state?.project.components.some(item=>item.id===id)) return;
  closeInlineEditor(true); if (!componentId) lastPageId = pageId;
  componentId = id; pageId = id; selected = []; cancelPointer(); render(); changed(); fitPage();
}
function nodes() { return page()?.nodes || []; }
function selectedNodes() { return nodes().filter(node => (readingContext?.nodeIds || selected).includes(node.id)); }
function instanceForNode(id, container = page()) {
  const group = container?.groups?.find(item => item.componentId && item.nodeIds.includes(id));
  return group ? { group, sourceId:group.sourceIds[group.nodeIds.indexOf(id)] } : null;
}
function round(value) { return Math.round(value * 100) / 100; }
function uid() { return crypto.randomUUID(); }
function grid(value) { return window.YuandaWorkspace ? window.YuandaWorkspace.snapValue(value) : snap ? Math.round(value / 8) * 8 : round(value); }
function isEditing(target = document.activeElement) { return !!target?.closest('input,textarea,select,[contenteditable="true"]'); }
function toast(message, tone = '') {
  const item = el('div', `toast ${tone}`, message);
  $('#toast-stack').append(item);
  setTimeout(() => item.remove(), tone === 'error' ? 6500 : 3900);
}
function showDialog(title, content) {
  $('#dialog-title').textContent = title;
  $('#dialog-content').textContent = content;
  if (!$('#message-dialog').open) $('#message-dialog').showModal();
}
function fail(error) {
  if (error?.code === 'REVISION_CONFLICT' || /REVISION_CONFLICT|版本.*冲突|revision.*conflict/i.test(error?.message || '')) {
    toast('项目刚刚被另一处修改，已刷新到最新内容。请确认后再操作。', 'warning');
    api.getState().then(receiveState).catch(() => {});
  } else toast(error?.message || String(error), 'error');
}
const unscopedCommands = new Set(['addAdaptiveView','updateAdaptiveView','removeAdaptiveView','setAdaptiveOverride','addViewSet','updateViewSet','removeViewSet','addViewSetView','updateViewSetView','removeViewSetView','setPageViewSet','detachPageViewSet','setViewOverride','clearViewOverride','clearInstanceViewOverride','addComponentView','updateComponentView','removeComponentView','setComponentViewOverride','clearComponentViewOverride']);
function scopedCommands(commands,context){return commands.map(command=>{
  if(command.pageId!==context.targetId||['componentCommands','viewCommands'].includes(command.type))return command;
  let scoped=unscopedCommands.has(command.type)||!viewEditCommands.has(command.type)?command:{type:'viewCommands',pageId:context.targetId,viewId:context.viewId,scope:context.scope,commands:[command]};
  if(context.targetKind==='component')scoped={type:'componentCommands',componentId:context.targetId,commands:[scoped]};return scoped;
});}
function queueCommands(commandSource, label, context = readingContext || captureContext(), options = {}) {
  context = structuredClone(context);
  const run = async () => {
    if (state.project.id !== context.projectId) throw new Error('项目已切换，此次编辑未写入其他项目。');
    let commands;
    const previousContext = readingContext; readingContext = context;
    try { commands = typeof commandSource === 'function' ? commandSource(context) : commandSource; }
    finally { readingContext = previousContext; }
    if (!commands?.length) return true;
    commands = scopedCommands(commands,context);
    receiveState(await api.command({ commands, expectedRevision: options.expectedRevision ?? state.revision, label }));
    return true;
  };
  commandQueue = commandQueue.then(run).catch(error=>{commandFailure=error;fail(error);return false;});
  return commandQueue;
}
async function invoke(name, ...args) {
  try {
    if (['newProject', 'openProject', 'saveProject', 'saveProjectAs', 'exportHtml', 'exportRp', 'preview'].includes(name)) {
      // A file dialog must not race the final text/property change.
      if (!await flushPendingEdits()) return null;
    }
    await commandQueue;
    const result = await api[name](...args);
    if (result?.project) receiveState(result);
    return result;
  } catch (error) { fail(error); return null; }
}
function receiveState(next) {
  if (!next?.project) return;
  const projectChanged = state?.project.id !== next.project.id;
  const externalChange = state && state.revision !== next.revision;
  const agentSelectionChanged = (next.agentSelectionRevision || 0) !== (state?.agentSelectionRevision || 0);
  if (pointerSession && externalChange) cancelPointer();
  let displacedDraft=null;
  if(inlineEditor&&projectChanged){const editor=inlineEditor,value=editor.element.value;if(value!==editor.original)displacedDraft={editor,value};closeInlineEditor(false);}
  else if(inlineEditor&&externalChange){
    const raw=[...next.project.pages,...next.project.components].find(item=>item.id===inlineEditor.pageId),viewId=inlineEditor.context?.viewId??null,viewExists=!viewId||raw&&viewModel.getCanvasViews(next.project,raw).some(view=>view.id===viewId),container=raw&&viewModel&&viewExists?viewModel.resolveContainerView(next.project,inlineEditor.pageId,viewId):null,updated=container?.nodes.find(item=>item.id===inlineEditor.id);
    if((!updated||updated.text!==inlineEditor.original)&&!inlineEditor.conflictNotified){inlineEditor.conflictNotified=true;toast('这段文字已被另一处修改。你的输入仍保留，完成编辑时可选择如何处理。','warning');}
  }
  state = next;
  if (firstState || projectChanged) {
    componentId = null; componentPageCache = null; componentSourceCache = null;
    pageId = next.selection?.pageId || (pageTreeModel?.getOrderedPages(next.project) || next.project.pages)[0]?.id;
    selected = next.selection?.nodeIds || [];
    clipboard = null; clipboardToken = null; clipboardCopySequence++;
  }
  if (agentSelectionChanged && next.selection?.pageId) {
    cancelPointer();componentId=null;componentPageCache=null;componentSourceCache=null;
    pageId=next.selection.pageId;selected=[...next.selection.nodeIds];
  }
  if (componentId && !next.project.components.some(item=>item.id===componentId)) { componentId=null; pageId=lastPageId; }
  if (!componentId && !next.project.pages.some(item => item.id === pageId)) pageId = (pageTreeModel?.getOrderedPages(next.project) || next.project.pages)[0]?.id;
  selected = selected.filter(id => nodes().some(node => node.id === id));
  render();
  if (firstState) {
    firstState = false;
    requestAnimationFrame(fitPage);
  }
  changed();
  if(displacedDraft)retainTextDraft(displacedDraft.editor,displacedDraft.value);
}
function setSelection(ids, nextPageId = pageId, forceInspector = true) {
  if (!state?.project.pages.some(item => item.id === nextPageId) && !(componentId === nextPageId && state?.project.components.some(item => item.id === nextPageId))) return;
  if (inlineEditor) closeInlineEditor(true);
  const changedPage = nextPageId !== pageId;
  if (changedPage) cancelPointer();
  if (componentId && nextPageId !== componentId && state.project.pages.some(item=>item.id===nextPageId)) componentId = null;
  pageId = nextPageId;
  selected = [...new Set(ids)].filter(id => nodes().some(node => node.id === id));
  if (!componentId) api.setSelection({ pageId, nodeIds: selected }).catch(fail);
  if (changedPage) renderBoard();
  renderPages(); renderLayers(); renderSelection(); renderStatus();
  if (forceInspector) renderInspector();
  if (changedPage) { renderBreadcrumb(); $('#canvas-viewport').scrollTo(0, 0); }
  changed();
}
function render() {
  if (!state) return;
  if (document.activeElement !== $('#project-name')) $('#project-name').value = state.project.name;
  $('#save-status').textContent = state.dirty ? '有未保存修改' : state.filePath ? '已保存到本机' : '未保存的新项目';
  $('#undo').disabled = !state.canUndo;
  $('#redo').disabled = !state.canRedo;
  document.title = `${state.dirty ? '● ' : ''}${state.project.name} · 原搭 ${state.appVersion || ''}`;
  renderPages(); renderLayers(); renderBoard(); renderBreadcrumb(); renderStatus(); renderAgentStatus();
  if (!$('#inspector').contains(document.activeElement) || !isEditing()) renderInspector();
}
function renderBreadcrumb() {
  $('#page-breadcrumb').textContent = `${componentId?'母版 · ':''}${page()?.name || '画布'}`;
  $('#page-size').textContent = page() ? `${page().width} × ${page().height}` : '';
}
function renderPages() {
  if (window.YuandaNavigation?.renderPages) { window.YuandaNavigation.renderPages(); return; }
  const container = $('#page-list'); container.replaceChildren();
  const ordered = [];
  const visit = (parent, depth) => { for (const item of state.project.pages.filter(item => (item.parentId || null) === parent)) { ordered.push({ item, depth }); visit(item.id, depth + 1); } };
  visit(null, 0);
  for (const { item, depth } of ordered) {
    const row = el('div', `page-row${item.id === pageId ? ' active' : ''}`);
    row.dataset.pageId = item.id;
    row.style.paddingLeft = `${12 + depth * 14}px`;
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.title = item.name;
    const icon = el('span', 'page-symbol'); icon.innerHTML = '<svg class="icon"><use href="#i-page"/></svg>';
    row.append(icon, el('span', 'page-name', item.name));
    row.addEventListener('click', () => setSelection([], item.id));
    row.addEventListener('keydown', event => { if (event.key === 'Enter') setSelection([], item.id); });
    row.addEventListener('dblclick', () => { activeTab = 'design'; setSelection([], item.id); window.YuandaDock?.show('styles'); $('#inspector [data-field="pageName"]')?.focus(); });
    if (state.project.pages.length > 1) row.append(button('×', '删除页面', event => {
      event.stopPropagation();
      if (confirm(`删除“${item.name}”及其中的 ${item.nodes.length} 个元件？\n删除后可以撤销。`)) queueCommands([{ type: 'removePage', pageId: item.id }], '删除页面');
    }, 'small-icon'));
    container.append(row);
  }
}
function renderLayers() {
  if(window.YuandaOutline){window.YuandaOutline.render(page(),selected);return;}
  const container = $('#layer-list'); container.replaceChildren();
  $('#layer-count').textContent = nodes().length;
  if (!nodes().length) container.append(el('div', 'empty-layers', '页面还是空白的。\n从上方添加一个元件，开始你的设计。'));
  for (const node of [...nodes()].reverse()) {
    const row = el('div', `layer-row${selected.includes(node.id) ? ' selected' : ''}${!node.visible ? ' dimmed' : ''}`);
    row.dataset.nodeId = node.id;
    row.title = `${node.name} · ${types[node.type]}`;
    row.append(el('span', 'layer-symbol', symbols[node.type]), el('span', 'layer-name', node.name));
    row.addEventListener('click', event => {
      const ids = event.shiftKey ? selected.includes(node.id) ? selected.filter(id => id !== node.id) : [...selected, node.id] : [node.id];
      setSelection(ids);
    });
    row.append(button(node.locked ? '锁' : '—', node.locked ? '解除锁定' : '锁定元件', event => {
      event.stopPropagation(); updateNode(node.id, { locked: !node.locked }, '切换锁定');
    }, `layer-control${node.locked ? ' is-active' : ''}`));
    row.append(button(node.visible ? '显' : '隐', node.visible ? '在预览中隐藏' : '在预览中显示', event => {
      event.stopPropagation(); updateNode(node.id, { visible: !node.visible }, '切换可见性');
    }, `layer-control${!node.visible ? ' is-active' : ''}`));
    container.append(row);
  }
}
function nodeStyle(element, node) {
  const style = node.style;
  Object.assign(element.style, {
    left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px`,
    transform: `rotate(${node.rotation || 0}deg)`, background: style.fill || 'transparent',
    border: `${style.strokeWidth || 0}px solid ${style.stroke || 'transparent'}`,
    borderRadius: `${style.radius || 0}px`, color: style.color || '#27323c',
    fontSize: `${style.fontSize || 14}px`, fontWeight: style.fontWeight || 400,
    textAlign: style.align || 'left', opacity: style.opacity ?? 1,
    justifyContent: style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center'
  });
  if (node.type === 'ellipse') element.style.borderRadius = '50%';
  if (node.type === 'line') { element.style.background = 'transparent'; element.style.border = 'none'; element.style.borderTop = `${Math.max(1, style.strokeWidth)}px solid ${style.stroke === 'transparent' ? style.color : style.stroke}`; }
}
function applyNodeVisual(element,node){
  styleRenderer?.applyNodeVisual(element,node,{contentElement:element.querySelector(':scope > .yuanda-node-content,:scope > .vector-rich-display'),transitions:false});
}
function renderBoard() {
  if (!page()) return;
  const visualPage = page();
  const board = $('#board');
  board.style.width = `${visualPage.width}px`; board.style.height = `${visualPage.height}px`;
  board.style.backgroundColor = page().background; board.dataset.name = page().name;
  const container = $('#nodes'), existing = new Map([...container.children].map(element => [element.dataset.nodeId, element])), retained = new Set();
  let paintIndex = 0;
  for (const sourceNode of window.YuandaAdvanced?.designNodes(page()) || nodes()) {
    const node=window.YuandaStyle?.previewNode(sourceNode)||sourceNode;
    const previous = existing.get(node.id), element = previous || el('div'); retained.add(node.id);
    element.className = `design-node${!node.visible ? ' hidden-node' : ''}${node.locked ? ' locked-node' : ''}`;
    element.style.cssText = '';
    if (node.type !== 'image') element.replaceChildren();
    element.dataset.nodeId = node.id; element.dataset.type = node.type;
    element.dataset.visible = String(node.visible);
    element.dataset.editorHidden = String(!!node.editorHidden);
    element.dataset.placed = String(node.effectivePlaced !== false);
    element.hidden = !!node.editorHidden || (node.effectivePlaced === false || !node.visible) && !selected.includes(node.id);
    element.classList.toggle('selected-unplaced',node.effectivePlaced === false && selected.includes(node.id));
    nodeStyle(element, node);
    if (window.YuandaAdvanced?.renderContainer(element, node)) {
      // Container outlines are editor-only; their children remain editable nodes.
    } else if (node.type === 'image' && window.YuandaImage) {
      window.YuandaImage.renderNode(element, node);
    } else if (window.YuandaVector?.renderNode?.(node, element, nodes())) {
      // Vector geometry and text are rendered by the original vector module.
    } else if (node.type === 'image' && node.src) {
      const img = el('img'); img.src = node.src; img.alt = node.text || node.name; img.draggable = false; element.append(img);
    } else if (node.type === 'table') {
      const table = el('table', 'design-table');
      for (const row of node.rows || []) { const tr = el('tr'); for (const value of row) tr.append(el('td', '', value)); table.append(tr); } const content=el('div','yuanda-node-content');content.append(table);element.append(content);
    } else if (['checkbox','radio'].includes(node.type)) {
      const control = el('input'); control.type = node.type; control.checked = !!node.checked; control.tabIndex = -1; control.style.pointerEvents = 'none';const content=el('div','yuanda-node-content');content.append(control,el('span','',node.text));element.append(content);
    } else element.append(el('div','yuanda-node-content',node.type === 'select'?`${node.value || node.options?.[0] || '请选择'}  ▾`:node.text||''));
    applyNodeVisual(element,node);
    if (!previous) {
      element.addEventListener('pointerdown', event => startNodeDrag(event, node.id));
      element.addEventListener('dblclick', event => { event.stopPropagation();const current=nodes().find(item=>item.id===node.id);if(current?.type==='image'&&window.YuandaImage)window.YuandaImage.edit(node.id);else editText(node.id); });
    }
    if(container.children[paintIndex]!==element)container.insertBefore(element,container.children[paintIndex]||null);paintIndex++;
  }
  for(const element of [...container.children])if(!retained.has(element.dataset.nodeId))element.remove();
  updateZoom(); renderSelection();
}
function findNodeElement(id) { return [...$('#nodes').children].find(item => item.dataset.nodeId === id); }
function renderSelection(preview = null) {
  const overlay = $('#selection-overlay'); overlay.replaceChildren();
  for (const element of $('#nodes').children) {
    const selectedHidden = (element.dataset.visible === 'false' || element.dataset.placed === 'false') && selected.includes(element.dataset.nodeId);
    element.hidden = element.dataset.editorHidden === 'true' || (element.dataset.visible === 'false' || element.dataset.placed === 'false') && !selectedHidden;
    element.classList.toggle('selected-hidden', selectedHidden);
  }
  const visibleNodes = window.YuandaAdvanced?.designNodes(page()) || nodes();
  const selection = selectedNodes().map(node => preview?.get(node.id) || visibleNodes.find(item => item.id === node.id) || node).filter(node => !node.editorHidden);
  for (const node of selection) {
    const box = el('div', `selection-rect${selection.length > 1 ? ' multi' : ''}`);
    const visual=window.YuandaStyle?.previewNode(node)||node,origin=visual.style.transformOrigin||{x:.5,y:.5};
    Object.assign(box.style, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px`, transform: `rotate(${node.rotation || 0}deg)`,transformOrigin:`${origin.x*100}% ${origin.y*100}%` });
    if (selection.length === 1 && !node.locked && !page().groups?.some(group => (group.locked || group.componentId) && group.nodeIds.includes(node.id))) {
      for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
        const handle = el('div', 'resize-handle'); handle.dataset.handle = direction;
        handle.style.width = `${8 / zoom}px`; handle.style.height = `${8 / zoom}px`;
        handle.addEventListener('pointerdown', event => startResize(event, node.id, direction));
        box.append(handle);
      }
      const label = el('span', 'selection-size', `${round(node.width)} × ${round(node.height)}`);
      label.style.fontSize = `${10 / zoom}px`; label.style.bottom = `${-23 / zoom}px`;
      box.append(label);
    }
    overlay.append(box);
  }
}
function renderStatus() {
  const count = selected.length;
  $('#selection-status').textContent = count ? `${count === 1 ? selectedNodes()[0]?.name || '元件' : `已选择 ${count} 个元件`} · 方向键微调 · Delete 删除` : `${nodes().length} 个元件 · Ctrl + S 保存`;
  $('#document-status').textContent = `${state.project.pages.length} 个页面 · ${state.dirty ? '未保存' : '本地编辑'} · v${state.appVersion || '0.1'}`;
  const actionCount = selectedNodes().length === 1 ? (selectedNodes()[0].interactions || []).reduce((total, item) => total + item.actions.length, 0) : 0;
  $('#interaction-count').hidden = !actionCount; $('#interaction-count').textContent = actionCount;
}
function updateZoom() {
  if (!page()) return;
  const visualPage = window.YuandaAdvanced?.designPage(page()) || page();
  $('#board').style.transform = `scale(${zoom})`;
  $('#board-shell').style.width = `${visualPage.width * zoom}px`;
  $('#board-shell').style.height = `${visualPage.height * zoom}px`;
  $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
}
function setZoom(value) { zoom = Math.min(4, Math.max(.1, value)); updateZoom(); renderSelection(); changed(); }
function fitPage() {
  if (!page()) return;
  const viewport = $('#canvas-viewport');
  setZoom(Math.min(1, (viewport.clientWidth - 128) / page().width, (viewport.clientHeight - 120) / page().height));
  viewport.scrollTo(0, 0);
}
function pointOnBoard(event) {
  const bounds = $('#board').getBoundingClientRect();
  return { x: (event.clientX - bounds.left) / zoom, y: (event.clientY - bounds.top) / zoom };
}
function startNodeDrag(event, id) {
  if (event.button !== 0 || inlineEditor) return;
  event.stopPropagation(); event.preventDefault();
  $('#canvas-viewport').focus({ preventScroll: true });
  if (event.shiftKey) {
    if (selected.includes(id)) { setSelection(selected.filter(item => item !== id)); return; }
    setSelection([...selected, id]);
  } else if (!selected.includes(id)) {
    const group = !event.altKey && (window.YuandaOutline?window.YuandaOutline.groupForCanvasNode(id):page().groups?.find(group => group.nodeIds.includes(id)));
    setSelection(group ? group.nodeIds : [id]);
  }
  const moving = (window.YuandaAdvanced?.expandMove?.(selectedNodes()) || selectedNodes()).filter(node => !node.locked && !page().groups?.some(group => group.locked && group.nodeIds.includes(node.id)));
  if (!moving.some(node => node.id === id)) return;
  // Capturing on pointerdown retargets Chromium's click/dblclick to the viewport.
  // Keep a normal click on the node; capture only after an actual drag starts.
  pointerSession = { type: 'move', start: pointOnBoard(event), original: structuredClone(moving), changed: false, capturePending: true, pointerId: event.pointerId, pageId, context:captureContext() };
}
function startResize(event, id, handle) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const node = nodes().find(item => item.id === id);
  pointerSession = { type: 'resize', start: pointOnBoard(event), original: [structuredClone(node)], handle, changed: false, pointerId: event.pointerId, pageId, context:captureContext() };
  $('#canvas-viewport').setPointerCapture(event.pointerId);
}
function pointerMove(event) {
  const session = pointerSession;
  if (!session || session.pointerId !== event.pointerId) return;
  const current = pointOnBoard(event);
  const dx = current.x - session.start.x, dy = current.y - session.start.y;
  if (Math.abs(dx) + Math.abs(dy) < 2 && !session.changed) return;
  if (session.capturePending) {
    session.capturePending = false;
    $('#canvas-viewport').setPointerCapture(event.pointerId);
  }
  session.changed = true;
  if (session.type === 'marquee') {
    const rect = { x: Math.min(current.x, session.start.x), y: Math.min(current.y, session.start.y), width: Math.abs(dx), height: Math.abs(dy) };
    session.rect = rect;
    const marquee = $('#marquee'); marquee.hidden = false;
    Object.assign(marquee.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    return;
  }
  let preview;
  if (session.type === 'move') {
    const origin = session.original[0];
    let shiftX = grid(origin.x + dx) - origin.x, shiftY = grid(origin.y + dy) - origin.y;
    if (window.YuandaWorkspace) ({ dx: shiftX, dy: shiftY } = window.YuandaWorkspace.snapMove(session.original, dx, dy, zoom));
    else if (snap && window.YuandaTools?.snapMove) ({ dx: shiftX, dy: shiftY } = window.YuandaTools.snapMove(session.original, dx, dy, zoom));
    if (event.shiftKey) { if(Math.abs(dx)>=Math.abs(dy))shiftY=0;else shiftX=0; }
    preview = session.original.map(node => ({ ...node, x: round(node.x + shiftX), y: round(node.y + shiftY) }));
  } else {
    const node = session.original[0], handle = session.handle;
    const angle = (node.rotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const localX = cos * dx + sin * dy, localY = -sin * dx + cos * dy;
    let width = node.width, height = node.height;
    if (/[ew]/.test(handle)) width = Math.max(16, grid(node.width + (handle.includes('w') ? -localX : localX)));
    if (/[ns]/.test(handle)) height = Math.max(16, grid(node.height + (handle.includes('n') ? -localY : localY)));
    if (event.shiftKey) {
      const widthRatio=width/node.width,heightRatio=height/node.height;
      const ratio=handle.length===1?(/[ew]/.test(handle)?widthRatio:heightRatio):(Math.abs(widthRatio-1)>=Math.abs(heightRatio-1)?widthRatio:heightRatio);
      const scale=Math.max(16/node.width,16/node.height,ratio);width=round(node.width*scale);height=round(node.height*scale);
    }
    const origin=node.style.transformOrigin||{x:.5,y:.5},anchor={x:handle.includes('w')?1:handle.includes('e')?0:.5,y:handle.includes('n')?1:handle.includes('s')?0:.5};
    const beforeAnchor=widgetGeometry.rotateNodePoint(node,node.x+node.width*anchor.x,node.y+node.height*anchor.y),resized={...node,width,height};
    const afterAnchor=widgetGeometry.rotateNodePoint(resized,node.x+width*anchor.x,node.y+height*anchor.y);
    preview = [{ ...node, x:round(node.x+beforeAnchor.x-afterAnchor.x),y:round(node.y+beforeAnchor.y-afterAnchor.y),width,height }];
    if(window.YuandaWorkspace)preview=[window.YuandaWorkspace.snapResize(node,preview[0],handle,zoom,{preserveAspect:event.shiftKey})];
  }
  session.preview = preview;
  for (const node of preview) { const element = findNodeElement(node.id); if (element) {nodeStyle(element, node);applyNodeVisual(element,node);} }
  renderSelection(new Map(preview.map(node => [node.id, node])));
}
function pointerUp(event) {
  const session = pointerSession;
  if (!session || session.pointerId !== event.pointerId) return;
  pointerSession = null;
  try { $('#canvas-viewport').releasePointerCapture(event.pointerId); } catch {}
  $('#marquee').hidden = true;
  if (session.type === 'marquee') {
    if (session.changed) {
      const rect = session.rect;
      const inside = nodes().filter(node => node.visible && node.effectivePlaced !== false && node.x < rect.x + rect.width && node.x + node.width > rect.x && node.y < rect.y + rect.height && node.y + node.height > rect.y).map(node => node.id);
      setSelection([...session.previous, ...inside]);
    }
    return;
  }
  if (session.changed && session.preview) {
    let commands = session.preview.filter(node => {
      const before = session.original.find(item => item.id === node.id);
      return ['x', 'y', 'width', 'height'].some(key => before[key] !== node[key]);
    }).map(node => ({ type: 'updateNode', pageId: session.pageId, nodeId: node.id, patch: { x: node.x, y: node.y, width: node.width, height: node.height } }));
    if (session.type === 'move') {
      if (window.YuandaTools) commands = window.YuandaTools.moveCommands(session.preview.map(after => { const before = session.original.find(node => node.id === after.id); return { node: before, dx: after.x-before.x, dy: after.y-before.y }; }),session.pageId,session.context);
    }
    queueCommands(commands, session.type === 'move' ? '移动元件' : '调整元件大小',session.context).then(() => { renderBoard(); renderInspector(); });
  } else renderSelection();
  window.YuandaTools?.clearSnap();
}
function cancelPointer() {
  const session = pointerSession; pointerSession = null;
  if (session) { try { $('#canvas-viewport').releasePointerCapture(session.pointerId); } catch {} }
  $('#marquee').hidden = true;
  if (state) renderBoard();
  window.YuandaTools?.clearSnap();
}
function editText(id) {
  const node = nodes().find(item => item.id === id);
  if (!node || node.locked || node.type === 'image') return;
  const instance = instanceForNode(id);
  if (page().groups?.some(group => group.locked && group.nodeIds.includes(id))) { toast('请先解除组锁定'); return; }
  if (!instance && node.type === 'table' && window.YuandaTools) { window.YuandaTools.editTable(id); return; }
  if (!instance && node.richText && window.YuandaVector) { window.YuandaVector.editRichText(id); return; }
  if (inlineEditor) closeInlineEditor(true);
  setSelection([id]);
  const input = el('textarea', 'inline-editor'); input.value = node.text || '';
  Object.assign(input.style, { left: `${node.x}px`, top: `${node.y}px`, width: `${Math.max(node.width, 80)}px`, height: `${Math.max(node.height, 35)}px`, fontSize: `${node.style.fontSize}px`, fontWeight: node.style.fontWeight, textAlign: node.style.align, transform: `rotate(${node.rotation || 0}deg)` });
  const textMetrics=styleRenderer.resolveNodeVisual(node),origin=node.style.transformOrigin||{x:.5,y:.5};Object.assign(input.style,{fontFamily:textMetrics.text.fontFamily,fontStyle:textMetrics.text.italic?'italic':'normal',lineHeight:textMetrics.text.lineHeight+'px',letterSpacing:textMetrics.text.letterSpacing+'px',textDecoration:textMetrics.text.decoration,textTransform:textMetrics.text.textCase,padding:`${textMetrics.padding.top}px ${textMetrics.padding.right}px ${textMetrics.padding.bottom}px ${textMetrics.padding.left}px`,transformOrigin:`${origin.x*100}% ${origin.y*100}%`});
  inlineEditor = { element: input, id, pageId, projectId:state.project.id, original: node.text || '', instance, node:structuredClone(node),context:captureContext() };
  input.addEventListener('blur', () => closeInlineEditor(true));
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); closeInlineEditor(false); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); closeInlineEditor(true); }
  });
  $('#board').append(input); input.focus(); input.select();
}
function closeInlineEditor(commit) {
  const editor = inlineEditor; if (!editor) return;
  inlineEditor = null;
  const value = editor.element.value; editor.element.remove();
  if (commit && value !== editor.original) {
    let conflict=false;
    pendingTextCommit=queueCommands(()=>{
      const container=state.project.id===editor.projectId?page(editor.context||captureContext(editor.pageId)):null,current=container?.nodes.find(item=>item.id===editor.id);
      if(state.project.id!==editor.projectId||!current||current.text!==editor.original){conflict=true;retainTextDraft(editor,value);return [];}
      return [draftTextCommand(editor,value)];
    },'修改文字',editor.context||captureContext(editor.pageId)).then(ok=>{if(ok===false)retainTextDraft(editor,value);return ok!==false&&!conflict;});
  }
}
function draftTextCommand(editor,value) {
  const container=[...state.project.pages,...state.project.components].find(item=>item.id===editor.pageId),instance=instanceForNode(editor.id,container);
  const command=instance?{type:'setComponentOverride',pageId:editor.pageId,instanceId:instance.group.id,sourceId:instance.sourceId,patch:{text:value}}:{type:'updateNode',pageId:editor.pageId,nodeId:editor.id,patch:{text:value,richText:null}};
  return command;
}
function retainTextDraft(editor,value) {
  if(textDraftDialog?.open)return;
  const saved={projectId:editor.projectId,pageId:editor.pageId,id:editor.id,original:editor.original,text:value,node:editor.node,context:editor.context};
  try{localStorage.setItem('yuanda.pendingTextDraft',JSON.stringify(saved));}catch{}
  const dialog=el('dialog','workspace-dialog');textDraftDialog=dialog;
  const title=el('h2','','这段输入还未保存'),description=el('p','small-note','原元件已变化或刚才未能写入。你的输入保留在下面，请选择如何处理。');
  const input=el('textarea');input.value=value;input.readOnly=true;input.setAttribute('aria-label','保留的文字草稿');input.style.cssText='width:100%;min-height:140px;margin:14px 0';
  const controls=el('div','workspace-row');
  const finish=()=>{try{localStorage.removeItem('yuanda.pendingTextDraft');}catch{}dialog.close();pendingTextCommit=Promise.resolve(true);};
  const replace=button('用我的输入替换','确认替换目前元件的文字',async()=>{
    const target=[...state.project.pages,...state.project.components].find(item=>item.id===editor.pageId)?.nodes.find(item=>item.id===editor.id);
    if(state.project.id!==editor.projectId||!target){toast('原元件已不存在，可选择保留为新文字。','warning');return;}
    if(await queueCommands([draftTextCommand(editor,input.value)],'处理文字冲突',editor.context||captureContext(editor.pageId)))finish();
  },'workspace-button');
  controls.append(replace,button('保留为新文字','在当前画布添加一段文字，保留原元件',async()=>{
    const original=editor.node||{},targetPage=pageId;
    const node=makeNode('text',{text:input.value,name:'恢复的文字草稿',x:original.x??40,y:original.y??40,width:Math.max(100,original.width||240),height:Math.max(40,original.height||80),style:original.style||{}});
    if(await queueCommands([{type:'addNode',pageId:targetPage,node}],'保留文字草稿')){finish();setSelection([node.id]);}
  },'workspace-button'),button('采用最新内容','放弃上方草稿并使用目前项目中的内容',finish,'workspace-button'));
  dialog.append(title,description,input,controls);dialog.addEventListener('cancel',event=>event.preventDefault());dialog.addEventListener('close',()=>{textDraftDialog=null;dialog.remove();});document.body.append(dialog);dialog.showModal();input.focus();input.select();
}
async function flushPendingEdits(keepFocus = null) {
  if(textDraftDialog?.open)return false;
  if(window.YuandaImage?.hasPendingDraft()){toast('请先应用或取消图片编辑中的选区，再保存或关闭项目。','warning');return false;}
  if(window.YuandaStyle?.hasPendingDraft()){toast('请先保存或取消样式草稿，再保存或关闭项目。','warning');return false;}
  if(window.YuandaVector?.hasPendingDraft()){toast('请先保存或取消富文本编辑。','warning');return false;}
  commandFailure=null;closeInlineEditor(true);
  if(isEditing()&&document.activeElement!==keepFocus)document.activeElement?.blur();
  const styleSaved=await window.YuandaStyle?.flush();await commandQueue;const textSaved=await pendingTextCommit;
  return styleSaved!==false&&textSaved&&!commandFailure&&!inlineEditor&&!textDraftDialog?.open;
}

function updateNode(id, patch, label = '修改属性', targetPage = pageId, context = captureContext(targetPage)) {
  const container = [...state.project.pages,...state.project.components].find(item=>item.id===targetPage);
  const instance = instanceForNode(id, container);
  if (instance && Object.keys(patch).every(key=>key==='text'||key==='src')) return queueCommands([{type:'setComponentOverride',pageId:targetPage,instanceId:instance.group.id,sourceId:instance.sourceId,patch}],label,context);
  return queueCommands([{ type: 'updateNode', pageId: targetPage, nodeId: id, patch }], label,context);
}
function makeNode(type, overrides = {}) {
  const isText = type === 'text', isButton = type === 'button', isInput = type === 'input';
  const node = {
    id: uid(), type, name: types[type], x: 64, y: 64,
    width: isText ? 240 : isButton ? 160 : isInput ? 240 : 200,
    height: isText ? 44 : isButton || isInput ? 44 : 140,
    rotation: 0, visible: true, locked: false,
    text: isText ? '把你的想法写在这里' : isButton ? '开始体验' : isInput ? '请输入内容' : '', src: '',
    interactions: []
  };
  return { ...node, ...overrides, ...(overrides.style?{style:{...overrides.style}}:{}) };
}
async function insertNode(type, overrides = {}) {
  if (!page()) return;
  const node = makeNode(type, overrides);
  const stagger = (nodes().length % 6) * 16;
  node.x = grid(Math.max(24, (page().width - node.width) / 2 + stagger));
  node.y = grid(Math.max(24, (page().height - node.height) / 2 + stagger));
  if (overrides.x !== undefined) node.x = overrides.x;
  if (overrides.y !== undefined) node.y = overrides.y;
  node.name = overrides.name || `${types[type]} ${nodes().filter(item => item.type === type).length + 1}`;
  await queueCommands([{ type: 'addNode', pageId, node }], `添加${types[type]}`);
  setSelection([node.id]);
}
async function importImage() {
  if(window.YuandaImage)return window.YuandaImage.importFile();
  toast('图片工具正在载入，请稍后再试。','warning');
}
async function copySelection() {
  const selection = selectedNodes(); if (!selection.length) return false;
  const fragment=copyFragment(),projectId=state.project.id,sequence=++clipboardCopySequence;
  try{const marked=await api.markInternalClipboard({projectId});if(sequence!==clipboardCopySequence||state.project.id!==projectId)return false;clipboard=fragment;clipboardToken=marked.token;toast(`已复制 ${selection.length} 个元件，可用 Ctrl + V 粘贴`);return true;}catch(error){fail(error);return false;}
}
function copyFragment() {
  const container=rawPage(),definitions=viewModel.getCanvasViews(state.project,container),context=captureContext();
  const viewState={kind:context.targetKind==='component'?'component':'adaptive',definitions:definitions.map(({id,name,parentId,minWidth,width,height})=>({id,name,parentId:parentId??null,...(minWidth===undefined?{}:{minWidth}),...(width===undefined?{}:{width}),...(height===undefined?{}:{height})})),overrides:Object.fromEntries(definitions.map(view=>[view.id,viewModel.getCanvasViewOverrides(state.project,container,view.id)||{}])),activeViewId:context.viewId};
  const appearanceFor=viewId=>Object.fromEntries(viewModel.resolveContainerView(state.project,container.id,viewId).nodes.map(({id,x,y,width,height,rotation,style,placed})=>[id,{x,y,width,height,rotation,style,placed:placed!==false}]));
  const appearance={base:appearanceFor(null),views:Object.fromEntries(definitions.map(view=>[view.id,appearanceFor(view.id)])),stateStyles:Object.fromEntries(viewModel.resolveContainerView(state.project,container.id,null).nodes.map(node=>[node.id,structuredClone(node.stateStyles||{})]))};
  return structuredClone({projectId:state.project.id,sourceId:container.id,nodes:container.nodes,groups:container.groups||[],views:container.views||[],nodeIds:[...selected],viewState,appearance});
}
async function pasteNodes(source = clipboard) {
  if (!source?.nodeIds.length || !page()) return;
  const target=pageId,idMap=Object.fromEntries(source.nodes.map(node=>[node.id,uid()]));
  await queueCommands([{type:'pasteFragment',pageId:target,fragment:source,idMap}], '粘贴元件');
  if(pageId===target)setSelection(source.nodeIds.map(id=>idMap[id]));
}
async function pasteCurrentSource() {
  const context=captureContext();
  await pendingClipboardCopy;
  if(!await flushPendingEdits())return;
  if(state.project.id!==context.projectId){toast('项目已切换，请重新粘贴。','warning');return;}
  const expectedRevision=state.revision;
  try{const result=await api.readPasteSource({projectId:context.projectId,expectedRevision,internalToken:clipboardToken});
    if(result.kind==='internal'&&clipboard&&result.token===clipboardToken){const source=clipboard,target=context.targetId,idMap=Object.fromEntries(source.nodes.map(node=>[node.id,uid()]));const ok=await queueCommands([{type:'pasteFragment',pageId:target,fragment:source,idMap}],'粘贴元件',context,{expectedRevision});if(ok&&getEditingTarget().id===target&&captureContext().viewId===context.viewId)setSelection(source.nodeIds.map(id=>idMap[id]));}
    else if(result.kind==='images')await window.YuandaImage?.insertAssets(result.images,context,result.revision);
    else toast('剪贴板中没有可粘贴的图片或原搭元件。');
  }catch(error){fail(error);}
}
function duplicateSelection() { if (selected.length) return pasteNodes(copyFragment()); }
async function cutSelection() {
  const context=captureContext(),revision=state.revision,ids=selectedNodes().filter(node=>!node.locked).map(node=>node.id);
  if(!ids.length)return false;
  pendingClipboardCopy=copySelection();if(!await pendingClipboardCopy)return false;
  return queueCommands([{type:'removeNodes',pageId:context.targetId,nodeIds:ids}],'剪切元件',context,{expectedRevision:revision});
}
function deleteSelection() {
  const ids = selectedNodes().filter(node => !node.locked).map(node => node.id);
  if (!ids.length) { if (selected.length) toast('选中的元件已锁定，请先解除锁定。', 'warning'); return; }
  return queueCommands([{ type: 'removeNodes', pageId, nodeIds: ids }], '删除元件');
}
function arrangeSelection(kind,distribution=false) {
  const context=captureContext(),ids=[...selected];
  return queueCommands(()=>arrangementModel[distribution?'distributionCommands':'alignCommands'](rawPage(context.targetId),ids,kind,{geometryPage:page(context)}),distribution?'等距分布':'对齐元件',context).then(result=>{renderInspector();return result;});
}
function alignSelection(kind) {return arrangeSelection(kind);}
function distributeSelection(axis) {return arrangeSelection(axis,true);}
function arrangementCount() {try{return arrangementModel.arrangementUnits(rawPage(),selected,{geometryPage:page()}).length;}catch{return 0;}}
function layerSelection(kind) {
  const context=captureContext(),ids=[...selected];
  return queueCommands(()=>arrangementModel.layerCommands(rawPage(context.targetId),ids,kind),'调整层级',context);
}
function reorderSelection(front) {return layerSelection(front?'front':'back');}

function section(title) {
  const wrapper = el('section', 'inspector-section');
  if (title) wrapper.append(el('h3', '', title));
  (inspectorTarget || $('#inspector')).append(wrapper); return wrapper;
}
function field(label, value, onChange, options = {}) {
  const wrapper = el('label', `field${options.full ? ' full' : ''}`);
  if (label) wrapper.append(el('span', '', label));
  let input;
  if (options.options) {
    input = el('select');
    for (const item of options.options) {
      const option = el('option', '', item.label); option.value = item.value; input.append(option);
    }
  } else if (options.multiline) input = el('textarea');
  else { input = el('input'); input.type = options.number ? 'number' : 'text'; }
  input.value = value ?? '';
  if (options.min !== undefined) input.min = options.min;
  if (options.max !== undefined) input.max = options.max;
  if (options.step) input.step = options.step;
  if (options.key) input.dataset.field = options.key;
  let lastSubmitted = value;
  input.addEventListener('change', () => {
    let next = options.number ? Number(input.value) : input.value;
    if (options.number && (!Number.isFinite(next) || input.value === '')) { input.value = value; return; }
    if (options.min !== undefined) next = Math.max(options.min, next);
    if (options.max !== undefined) next = Math.min(options.max, next);
    input.value = next;
    if (next !== lastSubmitted) { lastSubmitted = next; onChange(next); }
  });
  if (options.prefix) {
    const group = el('div', 'field-prefix'); group.append(el('span', '', options.prefix), input); wrapper.append(group);
  } else wrapper.append(input);
  return wrapper;
}
function colorField(label, value, onChange, full = false) {
  const wrapper = el('label', `field${full ? ' full' : ''}`); wrapper.append(el('span', '', label));
  const group = el('div', 'color-field'), picker = el('input'), text = el('input');
  picker.type = 'color'; picker.value = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff';
  picker.setAttribute('aria-label', label); text.type = 'text'; text.value = value || 'transparent';
  picker.addEventListener('input', () => { text.value = picker.value; });
  picker.addEventListener('change', () => onChange(picker.value));
  text.addEventListener('change', () => onChange(text.value.trim()));
  group.append(picker, text); wrapper.append(group); return wrapper;
}
function checkbox(label, value, onChange) {
  const wrapper = el('label'), input = el('input'); input.type = 'checkbox'; input.checked = value;
  input.addEventListener('change', () => onChange(input.checked)); wrapper.append(input, document.createTextNode(label)); return wrapper;
}
function alignmentControls(container) {
  const row = el('div', 'alignment-row');
  for (const [kind, label, icon] of [['left', '左对齐', '⊢'], ['center', '水平居中', '↔'], ['right', '右对齐', '⊣'], ['top', '顶部对齐', '⊤'], ['middle', '垂直居中', '↕'], ['bottom', '底部对齐', '⊥']]) row.append(button(icon, label, () => alignSelection(kind)));
  container.append(row);
}
function renderInspector() {
  inspectorTarget = $('#inspector'); renderDesignInspector();
  const interactions = $('#interactions-panel-content');
  if (interactions && state && !inlineEditor) { interactions.replaceChildren(); inspectorTarget = interactions; renderInteractions(selectedNodes()); }
  inspectorTarget = null;
}
function renderDesignInspector() {
  if (!state || inlineEditor) return;
  if(window.YuandaStyle?.preserveInspector())return;
  $('#design-tab').classList.toggle('active', activeTab === 'design');
  $('#interaction-tab').classList.toggle('active', activeTab === 'interaction');
  const root = $('#inspector'); root.replaceChildren();
  const selection = selectedNodes();
  if (activeTab === 'interaction' && !$('#interactions-panel-content')) { renderInteractions(selection); return; }
  if (!selection.length) {
    const item = page(); if (!item) return;
    const currentPageId = item.id;
    const summary = section(); summary.append(el('h3', '', componentId?'母版设置':'页面设置'), field(componentId?'母版名称':'页面名称', item.name, value => queueCommands([{ type: 'updatePage', pageId: currentPageId, patch: { name: value } }], '重命名'), { key: 'pageName' }));
    const layout = section('画板'); const grid = el('div', 'property-grid');
    if (!componentId && captureContext().viewId) grid.append(button('在视图管理修改画板尺寸','共享视图集的尺寸会影响引用它的全部页面',()=>window.YuandaAdvanced?.manageViews(),'workspace-button'));
    else grid.append(field('宽度', item.width, value => queueCommands([{ type: 'updatePage', pageId: currentPageId, patch: { width: value } }], '调整画板'), { number: true, min: 100 }), field('高度', item.height, value => queueCommands([{ type: 'updatePage', pageId: currentPageId, patch: { height: value } }], '调整画板'), { number: true, min: 100 }));
    grid.append(colorField('背景颜色（共享）', item.background, value => queueCommands([{ type: 'updatePage', pageId: currentPageId, patch: { background: value } }], '修改背景'), true));
    layout.append(grid);
    const hint = el('div', 'empty-state'); hint.append(el('span', 'empty-symbol', '↖'), document.createTextNode('选中元件，调整样式与交互。\n也可以框选或按住 Shift 多选。')); root.append(hint);
    const help = section('从设计到体验'); help.append(el('p', 'small-note', '在「交互」中设置点击后的动作。完成后，点击右上角「预览」亲自体验，或导出一个可离线打开的 HTML 文件。'));
    return;
  }
  if (selection.length > 1) {
    const summary = section(); summary.append(el('h3', '', `已选择 ${selection.length} 个元件`), el('p', 'small-note', '拖动可以一起移动，复制时会保留组内的交互关系。锁定元件不会被移动。'));
    alignmentControls(section('对齐')); renderArrangement();
    const style = section('批量外观');
    style.append(colorField('填充颜色', selection[0].style.fill, value => queueCommands(selection.filter(node => !node.locked).map(node => ({ type: 'updateNode', pageId, nodeId: node.id, patch: { style: { fill: value } } })), '批量修改填充')));
    return;
  }
  const node = selection[0], targetPage = pageId, targetContext=captureContext();
  const update = (patch, label) => updateNode(node.id, patch, label, targetPage,targetContext);
  const instance = instanceForNode(node.id);
  if (instance) {
    const item = section('母版实例');
    item.append(el('p','small-note',`来自「${instance.group.name}」。这里修改文字或图片，只影响当前实例。布局与交互跟随母版。`));
    item.append(field(node.type==='image'?'图片说明':'当前实例文字',node.text,value=>update({text:value},'修改实例文字'),{multiline:true,full:true,key:'instanceText'}));
    if (node.type==='image') window.YuandaImage?.renderInspector(item,node,{context:targetContext,linked:true});
    const reset=button('恢复母版内容','移除当前元件的文字和图片覆盖',()=>queueCommands([{type:'clearComponentOverride',pageId:targetPage,instanceId:instance.group.id,sourceId:instance.sourceId}],'恢复母版内容'),'text-button');
    reset.disabled=!instance.group.overrides?.[instance.sourceId];item.append(reset);
    item.append(button('打开母版画布','修改后同步全部实例',()=>openComponent(instance.group.componentId),'text-button'));
    item.append(button('解除当前实例关联','保留外观，改为普通元件',()=>queueCommands([{type:'detachComponent',pageId:targetPage,instanceId:instance.group.id}],'解除母版关联'),'text-button'));
    return;
  }
  const summary = section();
  const caption = el('div', 'element-summary'), label = el('div'); label.append(el('strong', '', types[node.type]), el('div', 'element-caption', node.locked ? '已锁定 · 解除后可拖动' : '自由排版 · 可添加交互'));
  caption.append(el('div', 'element-badge', symbols[node.type]), label); summary.append(caption, field('元件名称', node.name, value => update({ name: value }, '重命名元件')));
  const toggles = el('div', 'toggle-row'); toggles.append(checkbox('可见', node.visible, value => update({ visible: value }, '修改可见性')), checkbox('锁定', node.locked, value => update({ locked: value }, '修改锁定'))); summary.append(toggles);
  const layout = section('位置与大小'), dimensions = el('div', 'property-grid');
  for (const [key, prefix] of [['x', 'X'], ['y', 'Y'], ['width', 'W'], ['height', 'H']]) dimensions.append(field('', round(node[key]), value => update({ [key]: value }, '调整布局'), { number: true, min: key === 'width' || key === 'height' ? 1 : undefined, prefix,key:`layout-${key}` }));
  dimensions.append(field('旋转', node.rotation, value => update({ rotation: value }), { number: true, step: 1, prefix: '°' }));
  layout.append(dimensions); const alignWrapper = el('div'); alignWrapper.style.marginTop = '12px'; alignmentControls(alignWrapper); layout.append(alignWrapper);
  if (node.type !== 'image') {
    const text = section(node.type === 'input' ? '输入框内容' : '文字内容');text.append(field('内容',node.text,value=>update({text:value},'修改文字'),{multiline:true,full:true}));
  } else {
    const image = section('图片');window.YuandaImage?.renderInspector(image,node,{context:targetContext});
  }
  const appearance=section();appearance.classList.add('style-inspector-section');window.YuandaStyle?.renderInspector(appearance,node,{context:targetContext});
  renderArrangement();
  const details = section(); details.append(el('div', 'node-id', `元件 ID · ${node.id}`));
}
function renderArrangement() {
  const arrangement = section('排列');
  const row = el('div', 'action-row'); row.append(button('置于顶层', '', () => reorderSelection(true)), button('置于底层', '', () => reorderSelection(false))); arrangement.append(row);
  const actions = el('div', 'action-row'); actions.style.marginTop = '8px'; actions.append(button('复制副本', 'Ctrl+D', duplicateSelection), button('删除', 'Delete', deleteSelection, 'danger-button')); arrangement.append(actions);
}
function renderInteractions(selection) {
  if (window.YuandaAdvanced && Array.isArray(state?.project.variables)) { window.YuandaAdvanced.renderInteractions(); return; }
  const root = inspectorTarget || $('#inspector');
  if (selection.length !== 1) {
    const empty = el('div', 'empty-state'); empty.append(el('span', 'empty-symbol', '↗'), document.createTextNode(selection.length ? '请只选中一个元件，\n为它设置点击后的动作。' : '先选中一个按钮或其他元件，\n再让它回应你的点击。')); root.append(empty); return;
  }
  const node = selection[0], targetPage = pageId;
  const currentActions = () => structuredClone((state.project.pages.find(item => item.id === targetPage)?.nodes.find(item => item.id === node.id)?.interactions || []).filter(item => item.event === 'click').flatMap(item => item.actions));
  const actions = currentActions();
  const commit = source => queueCommands(() => {
    const next = typeof source === 'function' ? source(currentActions()) : source;
    if (!next) return [];
    const interactions = [];
    for (let offset = 0; offset < next.length; offset += 100) interactions.push({ event: 'click', actions: next.slice(offset, offset + 100) });
    return [{ type: 'updateNode', pageId: targetPage, nodeId: node.id, patch: { interactions } }];
  }, '修改点击交互');
  const updateAction = (index, patch) => commit(next => { if (!next[index]) return null; next[index] = { ...next[index], ...patch }; return next; });
  const container = section();
  const title = el('div', 'section-title'); title.append(el('h3', '', '点击时'), el('span', 'quiet-counter', `${actions.length} 个动作`)); container.append(title, el('p', 'interaction-order', '动作会从上到下依次执行。加入“等待”可以控制节奏。点击右上角「预览」体验效果。'));
  const actionOptions = [{ value: 'setText', label: '修改文字' }, { value: 'toggleVisible', label: '切换显示 / 隐藏' }, { value: 'setVisible', label: '显示或隐藏元件' }, { value: 'navigate', label: '跳转页面' }, { value: 'wait', label: '等待一会儿' }];
  const defaults = type => type === 'wait' ? { type, ms: 1000 } : type === 'navigate' ? { type, pageId: state.project.pages.find(item => item.id !== targetPage)?.id || targetPage } : type === 'setText' ? { type, targetId: node.id, value: '交互已触发' } : type === 'setVisible' ? { type, targetId: node.id, value: true } : { type, targetId: node.id };
  actions.forEach((action, index) => {
    const card = el('div', 'interaction-card'), header = el('div', 'interaction-card-header');
    header.append(el('span', '', `动作 ${index + 1}`));
    const controls = el('div');
    if (index > 0) controls.append(button('↑', '上移', () => commit(next => { if (!next[index]) return null; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }).then(renderInspector), 'small-icon'));
    if (index < actions.length - 1) controls.append(button('↓', '下移', () => commit(next => { if (!next[index + 1]) return null; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; }).then(renderInspector), 'small-icon'));
    controls.append(button('×', '删除动作', () => commit(next => next.filter((_, itemIndex) => itemIndex !== index)).then(renderInspector), 'small-icon')); header.append(controls); card.append(header);
    card.append(field('', action.type, value => commit(next => { if (!next[index]) return null; next[index] = defaults(value); return next; }).then(renderInspector), { options: actionOptions }));
    if (['setText', 'toggleVisible', 'setVisible'].includes(action.type)) card.append(field('作用于', action.targetId, value => updateAction(index, { targetId: value }), { options: nodes().map(item => ({ value: item.id, label: `${item.name}${item.id === node.id ? '（自己）' : ''}` })) }));
    if (action.type === 'setText') card.append(field('变成什么文字', action.value, value => updateAction(index, { value }), { multiline: true }));
    if (action.type === 'setVisible') card.append(field('效果', String(action.value), value => updateAction(index, { value: value === 'true' }), { options: [{ value: 'true', label: '显示' }, { value: 'false', label: '隐藏' }] }));
    if (action.type === 'navigate') card.append(field('前往页面', action.pageId, value => updateAction(index, { pageId: value }), { options: state.project.pages.map(item => ({ value: item.id, label: item.name })) }));
    if (action.type === 'wait') card.append(field('等待时长（毫秒）', action.ms, value => updateAction(index, { ms: value }), { number: true, min: 0, max: 60000, step: 100 }));
    container.append(card);
  });
  container.append(button('＋ 添加动作', '', () => commit(next => [...next, defaults('setText')]).then(renderInspector), 'add-action'));
  const help = section('小提示'); help.append(el('p', 'small-note', '想制作一个反馈按钮？先修改提示文字，等待 1000 毫秒，再修改为“已完成”。预览中会按这个顺序播放。'));
}

function renderAgentStatus() {
  const agent = state?.agent;
  $('#agent-status').textContent = agent?.enabled ? `本地入口已就绪 · 已处理 ${agent.requests || 0} 次请求` : '本地入口暂未开启';
  const dot = $('#agent-toggle .status-dot'); if (dot) dot.style.background = agent?.enabled ? 'var(--text)' : 'var(--muted)';
}
function toggleAgent(open = $('#agent-panel').hidden) {
  $('#agent-panel').hidden = !open; $('#agent-toggle').classList.toggle('active', open); $('#agent-toggle').setAttribute('aria-expanded', String(open));
}
function clearReview() { reviewedBatch = null; $('#agent-apply').disabled = true; $('#agent-validation').textContent = '应用前会检查整批指令'; }
async function reviewCommands() {
  try {
    clearReview();
    const source = $('#agent-commands').value, revision = state.revision;
    const parsed = JSON.parse(source);
    let commands = Array.isArray(parsed) ? parsed : parsed.commands;
    if (!Array.isArray(commands) || !commands.length) throw new Error('请提供非空的 commands 指令数组。');
    if (componentId) commands = commands.map(command=>command.pageId===componentId?{type:'componentCommands',componentId,commands:[command]}:command);
    const names = { addNode: '添加元件', updateNode: '修改元件', removeNodes: '删除元件', addPage: '添加页面', updatePage: '修改页面', removePage: '删除页面', reorderNode: '排列元件', renameProject: '修改项目名称' };
    $('#agent-validation').textContent='正在检查整批指令…';
    const result = await api.validateCommands({commands,expectedRevision:revision});
    if ($('#agent-commands').value!==source || state.revision!==revision) { clearReview(); $('#agent-validation').textContent='内容或项目已变化，请重新检查'; return; }
    const counts = new Map(); for (const command of commands) { const label=names[command.type]||command.type;counts.set(label,(counts.get(label)||0)+1); }
    reviewedBatch = { commands, revision:result.revision, source };
    $('#agent-validation').textContent = `检查通过 · ${commands.length} 条：${[...counts].map(([name, count]) => `${name} ${count}`).join('、')}`;
    $('#agent-validation').title = '整批指令已在临时副本中完整验证，尚未改变项目。应用时仍检查版本。';
    $('#agent-apply').disabled = false;
  } catch (error) { clearReview(); $('#agent-validation').textContent = error.message; toast(error.message, 'error'); }
}
function putAgentExample(kind) {
  let commands;
  if (kind === 'style') {
    const targets = selectedNodes().length ? selectedNodes() : nodes().filter(node => node.type === 'button' || node.type === 'rectangle').slice(0, 3);
    if (!targets.length) { toast('先添加或选中一个元件，再试试换色。'); return; }
    commands = targets.map(node => ({ type: 'updateNode', pageId, nodeId: node.id, patch: { style: { fill: node.type === 'button' ? '#191919' : '#f2f2f2', ...(node.type === 'button' ? { color: '#ffffff' } : {}) } } }));
  } else {
    const x = grid(Math.max(32, (page().width - 320) / 2)), y = grid(Math.max(32, (page().height - 200) / 2));
    const card = makeNode('rectangle', { name: 'Agent 添加的卡片', x, y, width: 320, height: 200, style: { fill: '#ffffff', stroke: '#dddddd', strokeWidth: 1, radius: 4 } });
    const title = makeNode('text', { name: '卡片标题', x: x + 24, y: y + 26, width: 270, height: 36, text: 'Agent 已添加这张卡片', style: { fontSize: 21, fontWeight: 500 } });
    const note = makeNode('text', { name: '卡片说明', x: x + 24, y: y + 78, width: 270, height: 65, text: '双击可以改字，拖动可以换位置。\n按 Ctrl + Z 可撤销本次添加。', style: { fontSize: 14, color: '#666666' } });
    commands = [card, title, note].map(node => ({ type: 'addNode', pageId, node }));
  }
  commands=scopedCommands(commands,captureContext());
  $('#agent-commands').value = JSON.stringify({ commands }, null, 2); clearReview(); reviewCommands();
}
async function applyReviewed() {
  const batch = reviewedBatch;
  if (!batch || batch.source !== $('#agent-commands').value) { clearReview(); return; }
  $('#agent-apply').disabled = true;
  try {
    await commandQueue;
    receiveState(await api.command({ commands: batch.commands, expectedRevision: batch.revision, label: 'Agent 工作台修改' }));
    clearReview(); $('#agent-validation').textContent = '修改已应用，可以用撤销恢复。'; toast('整批修改已应用 · Ctrl + Z 可以撤销');
  } catch (error) { clearReview(); fail(error); }
}
async function exportFile(kind) {
  $('#export-menu').hidden = true; $('#export-toggle').setAttribute('aria-expanded', 'false');
  if (busy) return; busy = true;
  try {
    const result = await invoke(kind);
    if (!result) return;
    if (kind === 'exportRp') { showDialog(result.ok ? 'RP 已导出' : '当前项目含尚未支持的 RP 内容', result.message || (result.ok ? `已导出：${result.path}` : '请先保存原搭工程。此项目仍可导出可交互 HTML。')); return; }
    if (result.ok === false) showDialog('未能完成', result.message || '操作未完成，请稍后重试。');
    else if (kind === 'exportHtml') showDialog('HTML 已导出', `双击这个文件，就能在浏览器中操作你的原型。\n\n${result.path || ''}${result.message ? `\n\n${result.message}` : ''}`);
    else if (kind === 'preview') toast(result.message || '已打开交互预览');
  } finally { busy = false; }
}

$('#new-project').addEventListener('click', () => invoke('newProject'));
$('#open-project').addEventListener('click', () => invoke('openProject'));
$('#save-project').addEventListener('click', async () => { const result = await invoke('saveProject'); if (result) toast('项目已保存到你的电脑'); });
$('#save-as').addEventListener('click', () => { $('#export-menu').hidden = true; invoke('saveProjectAs'); });
$('#project-name').addEventListener('change', event => { const name = event.target.value.trim(); if (name && name !== state.project.name) queueCommands([{ type: 'renameProject', name }], '重命名项目'); else event.target.value = state.project.name; });
$('#undo').addEventListener('click', () => invoke('undo'));
$('#redo').addEventListener('click', () => invoke('redo'));
$('#preview-project').addEventListener('click', () => exportFile('preview'));
$('#export-html').addEventListener('click', () => exportFile('exportHtml'));
$('#export-rp').addEventListener('click', () => exportFile('exportRp'));
$('#export-toggle').addEventListener('click', () => { const open = $('#export-menu').hidden; $('#export-menu').hidden = !open; $('#export-toggle').setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', event => { if (!event.target.closest('.dropdown')) { $('#export-menu').hidden = true; $('#export-toggle').setAttribute('aria-expanded', 'false'); } });
for (const item of document.querySelectorAll('[data-insert]')) item.addEventListener('click', () => insertNode(item.dataset.insert));
$('#select-tool').addEventListener('click', () => $('#canvas-viewport').focus());
$('#import-image').addEventListener('click', importImage);
$('#add-page').addEventListener('click', async () => {
  const newPage = { id: uid(), name: `页面 ${state.project.pages.length + 1}`, width: 1200, height: 800, background: '#ffffff', nodes: [] };
  await queueCommands([{ type: 'addPage', page: newPage }], '添加页面'); setSelection([], newPage.id); fitPage();
});
$('#zoom-in').addEventListener('click', () => setZoom(zoom + .1));
$('#zoom-out').addEventListener('click', () => setZoom(zoom - .1));
$('#zoom-value').addEventListener('click', fitPage);
$('#snap-toggle').addEventListener('click', () => { if(window.YuandaWorkspace){window.YuandaWorkspace.toggle('snapping');return;}snap = !snap; $('#snap-toggle').classList.toggle('active', snap); $('#snap-toggle').setAttribute('aria-pressed', String(snap)); $('#snap-state').textContent = snap ? '开' : '关'; });
for (const item of document.querySelectorAll('[data-tab]')) item.addEventListener('click', () => { activeTab = item.dataset.tab; window.YuandaDock?.show(activeTab === 'interaction' ? 'interactions' : 'styles'); renderInspector(); });
document.addEventListener('yuanda:panelactivate', event => { if (['styles','interactions'].includes(event.detail?.id)) { activeTab = event.detail.id === 'interactions' ? 'interaction' : 'design'; renderInspector(); } });
$('#agent-toggle').addEventListener('click', () => toggleAgent());
$('#agent-close').addEventListener('click', () => toggleAgent(false));
$('#agent-commands').addEventListener('input', clearReview);
$('#agent-review').addEventListener('click', reviewCommands);
$('#agent-apply').addEventListener('click', applyReviewed);
$('#agent-example-style').addEventListener('click', () => putAgentExample('style'));
$('#agent-example-card').addEventListener('click', () => putAgentExample('card'));
$('#copy-agent-info').addEventListener('click', async () => {
  try {
    const agent = await api.getAgentInfo();
    const content = `请通过 yuanda MCP 直接编辑原搭当前项目。先调用 yuanda_get_state 与 yuanda_get_schema，再用 yuanda_apply_commands 提交带 expectedRevision 的整批修改；可以撤销、重做、保存及导出。\n\n未配置的本地客户端可使用以下 MCP 配置：\n${JSON.stringify({mcpServers:{yuanda:agent.mcp}},null,2)}\n\n只连接本机正在运行的原搭，不要公开连接文件或其中的临时令牌。`;
    await navigator.clipboard.writeText(content); toast('连接说明已复制，可粘贴给本地 Agent');
  } catch (error) { fail(error); }
});
$('#dialog-close').addEventListener('click', () => $('#message-dialog').close());
$('#dialog-ok').addEventListener('click', () => $('#message-dialog').close());
$('#help-button').addEventListener('click', () => showDialog('原搭 · 快速上手', '① 点击上方的矩形、文字、按钮等工具，添加元件。\n② 拖动元件移动，拖动绿色手柄调整大小；右栏可以精确修改。\n③ 双击文字即可编辑，按 Ctrl + Enter 完成。\n④ 点击「交互」为元件设置点击动作，再点右上角「预览」体验。\n⑤ 点击「保存」保留可编辑项目，点击「导出」制作独立 HTML。\n\n常用快捷键\nCtrl + S 保存　Ctrl + O 打开\nCtrl + Z 撤销　Ctrl + Shift + Z 重做\nCtrl + C / V 复制、粘贴　Ctrl + D 复制副本\nShift + 点击 多选　Delete 删除\n方向键移动 1 像素，Shift + 方向键移动 10 像素\nCtrl + 滚轮缩放，点击缩放百分比适应窗口\n\nAgent 工作台可以检查和应用本地指令，与手动编辑共享同一份项目和撤销记录。'));
$('#board').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('.design-node,.resize-handle,.inline-editor')) return;
  event.preventDefault(); $('#canvas-viewport').focus({ preventScroll: true });
  const previous = event.shiftKey ? [...selected] : [];
  if (!event.shiftKey) setSelection([]);
  pointerSession = { type: 'marquee', start: pointOnBoard(event), previous, pointerId: event.pointerId, changed: false };
  $('#canvas-viewport').setPointerCapture(event.pointerId);
});
$('#canvas-viewport').addEventListener('pointerdown', event => {
  if (event.button === 0 && !event.target.closest('#board')) { setSelection([]); $('#canvas-viewport').focus({ preventScroll: true }); }
});
// Listen on the document so a drag which crosses the viewport before capture
// still completes, while ordinary clicks retain the original node target.
document.addEventListener('pointermove', pointerMove);
document.addEventListener('pointerup', pointerUp);
document.addEventListener('pointercancel', cancelPointer);
$('#canvas-viewport').addEventListener('wheel', event => {
  if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08)); }
}, { passive: false });
document.addEventListener('keydown', event => {
  if (!state || document.querySelector('dialog[open]')) return;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (modifier && key === 's') { event.preventDefault(); if (inlineEditor) closeInlineEditor(true); document.activeElement?.blur(); invoke(event.shiftKey ? 'saveProjectAs' : 'saveProject'); return; }
  if (modifier && key === 'o') { event.preventDefault(); invoke('openProject'); return; }
  if (isEditing()) return;
  if (modifier && key === 'z') { event.preventDefault(); invoke(event.shiftKey ? 'redo' : 'undo'); return; }
  if (modifier && key === 'y') { event.preventDefault(); invoke('redo'); return; }
  if (modifier && key === 'a') { event.preventDefault(); setSelection(nodes().map(node => node.id)); return; }
  if (modifier && key === 'c') { event.preventDefault(); pendingClipboardCopy=copySelection(); return; }
  if (modifier && key === 'v') { event.preventDefault(); pasteCurrentSource(); return; }
  if (modifier && key === 'd') { event.preventDefault(); duplicateSelection(); return; }
  if (modifier && (key === '=' || key === '+')) { event.preventDefault(); setZoom(zoom + .1); return; }
  if (modifier && key === '-') { event.preventDefault(); setZoom(zoom - .1); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  if (event.key === 'Escape') { cancelPointer(); setSelection([]); $('#export-menu').hidden = true; return; }
  if (event.key === 'Enter' && !modifier && !event.altKey && selected.length===1 && !event.target.closest('button,[role="menu"],[role="tablist"]')) { event.preventDefault();editText(selected[0]);return; }
  if (event.key.startsWith('Arrow') && selected.length) {
    if (event.target.closest('button,[role="menu"],[role="tablist"]')) return;
    event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0;
    const dy = event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0;
    const ids = [...selected], currentPage = pageId,context=captureContext();
    queueCommands(() => { const selection = (page(context)?.nodes || []).filter(node => ids.includes(node.id) && !node.locked && node.effectivePlaced!==false); return window.YuandaTools ? window.YuandaTools.moveCommands(selection.map(node => ({ node, dx, dy })),currentPage,context) : [{type:'moveNodes',pageId:currentPage,nodeIds:selection.map(node=>node.id),dx,dy}]; }, '微调位置',context); return;
  }
  if (!modifier && !event.altKey) {
    if (key === 'r') insertNode('rectangle');
    if (key === 't') insertNode('text');
    if (key === 'b') insertNode('button');
    if (key === 'v') $('#canvas-viewport').focus();
  }
});

window.YuandaEditor = {
  getState: () => state, getPage: page, getSelection: () => ({ pageId, nodeIds: [...selected] }),
  getRawPage:rawPage,getEditingContext:()=>readingContext||captureContext(),captureContext,getViewModel:()=>viewModel,setEditingView,setEditingScope,
  getEditingTarget, openPage, openComponent,
  getNodes: selectedNodes, getZoom: () => zoom, command: queueCommands, select: setSelection,
  insert: insertNode, makeNode, editText, setZoom, fitPage, point: pointOnBoard, toast, showDialog,
  copy:()=>pendingClipboardCopy=copySelection(),cut:cutSelection,paste:pasteCurrentSource,duplicate:duplicateSelection,remove:deleteSelection,
  align:alignSelection,distribute:distributeSelection,arrangementCount,layer:layerSelection,reorder:reorderSelection,exportFile,importImage,
  refresh: () => { render(); changed(); }, flush: () => commandQueue, flushPendingEdits, invoke
};
if (!api) showDialog('请从桌面程序打开', '这个界面需要原搭桌面程序提供本地保存和编辑能力。请双击“原搭.exe”打开。');
else {
  api.onState(receiveState);
  Promise.all([api.getState(),viewModelReady,styleRendererReady,pageTreeReady]).then(([next])=>{receiveState(next);try{const saved=JSON.parse(localStorage.getItem('yuanda.pendingTextDraft'));if(saved&&typeof saved.text==='string')retainTextDraft(saved,saved.text);}catch{}}).catch(error => showDialog('原搭未能打开项目', error.message));
}
