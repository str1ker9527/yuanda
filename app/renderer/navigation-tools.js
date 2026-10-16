import { navigationTreeItems, pageTreeMoveCommands, pageTreeDescendants, reorderKeys, boxOf, measurementLines } from './navigation-model.mjs';
import {createPreviewNode,previewVisibleNodes} from './preview-node-renderer.mjs';

/** Editor-only navigation and appearance. Document mutations use the shared command engine. */
const E = window.YuandaEditor;
const $ = selector => document.querySelector(selector);
const create = (tag, className = '', text) => { const item = document.createElement(tag); item.className = className; if (text !== undefined) item.textContent = text; return item; };
const button = (text, action, title = text) => { const item = create('button', '', text); item.type = 'button'; item.title = title; item.addEventListener('click', action); return item; };
const editing = target => !!target?.closest('input,textarea,select,[contenteditable="true"],dialog');
const storageKey = 'yuanda.navigation.v1';
let preferences = { theme: 'light', labels: true, toolbar: [], hidden: [], gallerySize: 220, projects: {} };
try { const saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); preferences = { ...preferences, ...saved, projects: saved.projects || {} }; } catch {}
const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch {} };
const state = () => E.getState();
const project = () => state()?.project;
let projectId = null, tabs = [], previousTarget = '', galleryOpen = false, suppressOpen = false, activeMenu = null, dragging = null;
let selectedTreeId = null, collapsedTreeIds = new Set(), renderedTreeTarget = '', lastTreeNotice = '';
const targetKey = (kind, id) => `${kind}:${id}`;
const target = () => { const value = E.getEditingTarget?.(); return value ? { kind: value.kind || value.type, id: value.id || value.pageId || value.componentId } : { kind: 'page', id: E.getSelection()?.pageId }; };
const navigationSignature = () => JSON.stringify([project()?.id, state()?.revision, target().kind, target().id]);
const itemForKey = key => { const cut = key.indexOf(':'), kind = key.slice(0, cut), id = key.slice(cut + 1); return { kind, id, item: (kind === 'component' ? project()?.components : project()?.pages)?.find(item => item.id === id) }; };
const storeTabs = () => { if (projectId) { preferences.projects[projectId] = { ...preferences.projects[projectId], tabs: [...tabs], collapsedTreeIds: [...collapsedTreeIds] }; const keys = Object.keys(preferences.projects); while (keys.length > 30) delete preferences.projects[keys.shift()]; persist(); } };
const openTarget = async (kind, id) => {
  const key = targetKey(kind, id); if (!itemForKey(key).item) return;
  suppressOpen = false; if (!tabs.includes(key)) tabs.push(key); galleryOpen = false; gallery.hidden = true;
  if (kind === 'component') {
    if (!E.openComponent) { E.toast('母版画布接口正在初始化，请稍后重试。'); return; }
    await E.openComponent(id);
  } else if (E.openPage) await E.openPage(id); else E.select([], id);
  previousTarget = key; storeTabs(); renderTabs();
};

const tabBar = create('div', 'editor-tabs'); tabBar.id = 'editor-tabs';
const galleryButton = button('画廊', () => showGallery(), '页面与母版缩略图'); galleryButton.id = 'open-gallery';
const tabList = create('div', 'editor-tab-list'); tabList.setAttribute('role', 'tablist'); tabList.setAttribute('aria-label', '已打开的页面与母版');
const tabMenuButton = button('标签', event => menu(event.currentTarget, [['关闭当前', () => closeTab(previousTarget)], ['关闭其他', () => closeOthers(previousTarget)], ['关闭全部', closeAll]])); tabMenuButton.id = 'tab-actions';
tabBar.append(galleryButton, tabList, tabMenuButton); $('.canvas-column').prepend(tabBar);

function menu(anchor, actions, options = {}) {
  activeMenu?.remove(); const root = create('div', 'navigation-menu'); root.setAttribute('role', 'menu');
  if (options.id) root.id = options.id;
  if (options.signature) root.navigationSignature = options.signature;
  for (const [label, fn, action, disabled = false] of actions) { const item = button(label, () => { root.remove(); activeMenu = null; fn(); }); item.setAttribute('role', 'menuitem'); item.disabled = disabled; if (action) item.dataset.treeAction = action; root.append(item); }
  document.body.append(root); const rect = anchor.getBoundingClientRect();
  root.style.left = `${Math.max(8, Math.min(options.x ?? rect.left, innerWidth - root.offsetWidth - 8))}px`; root.style.top = `${Math.max(8, Math.min(options.y ?? rect.bottom + 4, innerHeight - root.offsetHeight - 8))}px`; activeMenu = root;
  root.addEventListener('keydown', event => {
    const items = [...root.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); root.remove(); activeMenu = null; options.restoreFocus?.(); }
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); items[event.key === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (event.key === 'Tab') { root.remove(); activeMenu = null; options.restoreFocus?.(); }
  });
  if (options.focus) root.querySelector('button:not(:disabled)')?.focus();
}
document.addEventListener('pointerdown', event => { if (activeMenu && !activeMenu.contains(event.target)) { activeMenu.remove(); activeMenu = null; } });
function closeTab(key) {
  const index = tabs.indexOf(key); if (index < 0) return;
  tabs.splice(index, 1); storeTabs();
  if (key === previousTarget) {
    if (tabs.length) { const next = itemForKey(tabs[Math.min(index, tabs.length - 1)]); void openTarget(next.kind, next.id); }
    else { suppressOpen = true; showGallery(); }
  }
  renderTabs();
}
function closeOthers(key) { if (!tabs.includes(key)) return; tabs = [key]; storeTabs(); renderTabs(); }
function closeAll() { tabs = []; suppressOpen = true; storeTabs(); renderTabs(); showGallery(); }
function renderTabs() {
  tabList.replaceChildren();
  for (const key of tabs) {
    const { kind, id, item } = itemForKey(key); if (!item) continue;
    const tab = create('div', 'editor-tab'); tab.dataset.tabKey = key; tab.tabIndex = key === previousTarget ? 0 : -1; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(key === previousTarget && !galleryOpen)); tab.title = `${kind === 'component' ? '母版' : '页面'}：${item.name}`;
    tab.append(create('span', 'editor-tab-kind', kind === 'component' ? '母版' : '页'), create('span', 'editor-tab-name', item.name));
    const close = button('×', event => { event.stopPropagation(); closeTab(key); }, `关闭 ${item.name}`); close.setAttribute('aria-label', `关闭 ${item.name}`); tab.append(close);
    tab.addEventListener('click', event => { if (!event.target.closest('button')) void openTarget(kind, id); });
    tab.addEventListener('keydown', event => {
      if (event.key === 'Delete') { event.preventDefault(); closeTab(key); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openTarget(kind, id); }
      else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); const nextIndex = Math.max(0, Math.min(tabs.length - 1, tabs.indexOf(key) + (event.key === 'ArrowLeft' ? -1 : 1)));
        if (event.altKey) { tabs = reorderKeys(tabs, key, tabs[nextIndex], event.key === 'ArrowRight'); storeTabs(); renderTabs(); tabList.querySelector(`[data-tab-key="${CSS.escape(key)}"]`)?.focus(); }
        else { const next = itemForKey(tabs[nextIndex]); void openTarget(next.kind, next.id).then(() => tabList.querySelector(`[data-tab-key="${CSS.escape(tabs[nextIndex])}"]`)?.focus()); }
      }
    });
    tab.addEventListener('contextmenu', event => { event.preventDefault(); menu(tab, [['关闭', () => closeTab(key)], ['关闭其他', () => closeOthers(key)], ['关闭全部', closeAll]]); });
    tab.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      startDrag(event, item.name, move => {
        for (const item of tabList.children) item.classList.remove('drag-before', 'drag-after');
        const hovered = document.elementFromPoint(move.clientX, move.clientY)?.closest('.editor-tab');
        if (!hovered || hovered === tab) return null;
        const after = move.clientX > hovered.getBoundingClientRect().left + hovered.offsetWidth / 2;
        hovered.classList.add(after ? 'drag-after' : 'drag-before'); return { key: hovered.dataset.tabKey, after };
      }, result => { if (result) { tabs = reorderKeys(tabs, key, result.key, result.after); storeTabs(); } renderTabs(); });
    });
    tabList.append(tab);
  }
  galleryButton.setAttribute('aria-pressed', String(galleryOpen));
}
function startDrag(event, label, move, finish) {
  if (event.button !== 0 || dragging) return;
  const source = event.currentTarget, sx = event.clientX, sy = event.clientY, signature = navigationSignature(); let ghost = null, result = null;
  const pointerMove = next => {
    if (!source.isConnected || signature !== navigationSignature()) { stop(true); return; }
    if (!ghost && Math.hypot(next.clientX - sx, next.clientY - sy) < 6) return;
    if (!ghost) { ghost = create('div', 'navigation-drag-label', label); document.body.append(ghost); source.setPointerCapture(event.pointerId); }
    ghost.style.left = `${next.clientX + 13}px`; ghost.style.top = `${next.clientY + 14}px`; result = move(next);
  };
  const stop = cancelled => {
    cancelled ||= !source.isConnected || signature !== navigationSignature();
    document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', pointerUp); document.removeEventListener('pointercancel', cancel);
    if (source.hasPointerCapture(event.pointerId)) source.releasePointerCapture(event.pointerId);
    if (ghost) { ghost.remove(); const suppress = click => { click.preventDefault(); click.stopImmediatePropagation(); }; document.addEventListener('click', suppress, { capture: true, once: true }); setTimeout(() => document.removeEventListener('click', suppress, true), 80); finish(cancelled ? null : result); }
    dragging = null;
  };
  const pointerUp = () => stop(false), cancel = () => stop(true); dragging = { cancel, signature };
  document.addEventListener('pointermove', pointerMove); document.addEventListener('pointerup', pointerUp); document.addEventListener('pointercancel', cancel);
}
const treeItems = () => project() ? navigationTreeItems(project()) : [];
const treeEntry = id => treeItems().find(entry => entry.id === id);
const treeRow = id => $(`#page-list [data-tree-id="${CSS.escape(id || '')}"]`);
let treeFocusEpoch = 0;
const captureTreeFocus = () => ({ epoch: treeFocusEpoch, projectId: project()?.id, activeElement: document.activeElement });
// Async commands may finish after the user has moved to another control.
document.addEventListener('pointerdown', event => { if (event.isTrusted) treeFocusEpoch++; }, true);
document.addEventListener('keydown', event => { if (event.isTrusted) treeFocusEpoch++; }, true);
const focusTree = (id, request = captureTreeFocus()) => {
  if (request.epoch !== treeFocusEpoch || request.projectId !== project()?.id || selectedTreeId !== id) return;
  const activeElement = document.activeElement;
  if (activeElement !== request.activeElement && activeElement !== document.body && !activeElement?.closest('#page-list')) return;
  // Rows already exist after renderPages; a delayed animation-frame focus can steal later input.
  treeRow(id)?.focus({ preventScroll: true });
};
const isCollapsed = entry => entry.kind === 'folder' ? Boolean(entry.item.collapsed) : collapsedTreeIds.has(entry.id);
const defaultParent = () => { const entry = treeEntry(selectedTreeId); return entry?.kind === 'folder' ? entry.id : entry?.parentId || null; };

function nameDialog(title, initialName, save) {
  if (document.querySelector('dialog[open]')) return;
  const dialog = create('dialog', 'page-tree-dialog'); dialog.id = 'page-tree-name-dialog'; dialog.setAttribute('aria-labelledby', 'page-tree-name-title');
  const form = create('form'), heading = create('h2', '', title); heading.id = 'page-tree-name-title';
  const label = create('label', '', '名称'), input = create('input'); input.id = 'page-tree-name'; input.value = initialName; input.required = true; input.maxLength = 200; input.autocomplete = 'off'; label.htmlFor = input.id; label.append(input);
  const error = create('p', 'page-tree-dialog-error'); error.setAttribute('role', 'status');
  const actions = create('div', 'page-tree-dialog-actions'), cancel = button('取消', () => dialog.close()), submit = button('确定', () => {}); submit.id = 'page-tree-name-save'; submit.type = 'submit'; actions.append(cancel, submit);
  form.append(heading, label, error, actions); dialog.append(form); document.body.append(dialog);
  form.addEventListener('submit', async event => {
    event.preventDefault(); const value = input.value.trim(); if (!value) { error.textContent = '请填写名称。'; input.focus(); return; }
    submit.disabled = true;
    try { if (await save(value)) dialog.close(); else error.textContent = '项目已变化或操作未完成，请关闭此窗口后重试。'; }
    catch (failure) { error.textContent = failure.message; }
    finally { submit.disabled = false; }
  });
  dialog.addEventListener('close', () => { dialog.remove(); focusTree(selectedTreeId); }); dialog.showModal(); input.select();
}
function addFolder(parentId = defaultParent()) {
  if (!project()) return;
  const context = E.captureContext(), expectedRevision = state().revision, id = crypto.randomUUID();
  nameDialog('新建页面文件夹', '新建文件夹', async name => {
    const commands = [{ type: 'addPageFolder', folder: { id, name, parentId, collapsed: false } }], parent = treeEntry(parentId);
    if (parent?.kind === 'folder' && parent.item.collapsed) commands.push({ type: 'updatePageFolder', folderId: parentId, patch: { collapsed: false } });
    const ok = await E.command(commands, '新建页面文件夹', context, { expectedRevision });
    if (ok) { if (parentId) collapsedTreeIds.delete(parentId); selectedTreeId = id; renderPages(); storeTabs(); }
    return ok;
  });
}
async function addPage(parentId = defaultParent()) {
  if (!project()) return false;
  const id = crypto.randomUUID(), context = E.captureContext(), expectedRevision = state().revision, focusRequest = captureTreeFocus();
  const commands = [{ type: 'addPage', page: { id, name: `页面 ${project().pages.length + 1}`, parentId } }], parent = treeEntry(parentId);
  if (parent?.kind === 'folder' && parent.item.collapsed) commands.push({ type: 'updatePageFolder', folderId: parentId, patch: { collapsed: false } });
  const ok = await E.command(commands, '添加页面', context, { expectedRevision });
  if (ok) { if (parentId) collapsedTreeIds.delete(parentId); selectedTreeId = id; await openTarget('page', id); renderPages(); focusTree(id, focusRequest); }
  return ok;
}
function renameTreeItem(id) {
  const entry = treeEntry(id); if (!entry) return;
  const context = E.captureContext(), expectedRevision = state().revision;
  nameDialog(entry.kind === 'folder' ? '重命名文件夹' : '重命名页面', entry.name, name => E.command([entry.kind === 'folder' ? { type: 'updatePageFolder', folderId: id, patch: { name } } : { type: 'updatePage', pageId: id, patch: { name } }], '重命名页面树项目', context, { expectedRevision }));
}
async function toggleTreeItem(id) {
  const entry = treeEntry(id), focusRequest = captureTreeFocus(); if (!entry) return;
  if (entry.kind === 'folder') {
    if (!await E.command([{ type: 'updatePageFolder', folderId: id, patch: { collapsed: !entry.item.collapsed } }], '展开或收起文件夹')) return;
  } else if (collapsedTreeIds.has(id)) collapsedTreeIds.delete(id); else collapsedTreeIds.add(id);
  selectedTreeId = id; renderPages(); storeTabs(); focusTree(id, focusRequest);
}
function removeTreeItem(id) {
  const entry = treeEntry(id); if (!entry || document.querySelector('dialog[open]')) return;
  const descendants = pageTreeDescendants(project(), id), pageCount = entry.kind === 'folder' ? descendants.filter(item => item.kind === 'page').length : 1;
  const folderCount = descendants.filter(item => item.kind === 'folder').length;
  const blocked = pageCount >= project().pages.length, context = E.captureContext(), expectedRevision = state().revision;
  const dialog = create('dialog', 'page-tree-dialog'); dialog.id = 'page-tree-delete-dialog'; dialog.setAttribute('aria-labelledby', 'page-tree-delete-title');
  const heading = create('h2', '', entry.kind === 'folder' ? '删除整个文件夹？' : '删除页面？'); heading.id = 'page-tree-delete-title';
  const description = entry.kind === 'folder' ? `将删除“${entry.name}”以及其中的全部 ${pageCount} 个页面、${folderCount} 个子文件夹和页面中的元件。\n删除后可以撤销。` : `将删除“${entry.name}”及其中的 ${entry.item.nodes.length} 个元件。\n${descendants.length ? '它的子页面和子文件夹会保留并提升一级。\n' : ''}删除后可以撤销。`;
  const body = create('p', '', description), error = create('p', 'page-tree-dialog-error', blocked ? '项目必须保留至少一个真实页面。请先在此目录之外添加页面。' : ''); error.setAttribute('role', 'status');
  const actions = create('div', 'page-tree-dialog-actions'), cancel = button('取消', () => dialog.close()), confirm = button(entry.kind === 'folder' ? '删除整个文件夹' : '删除页面', async () => {
    confirm.disabled = true;
    const command = entry.kind === 'folder' ? { type: 'removePageFolder', folderId: id } : { type: 'removePage', pageId: id };
    if (await E.command([command], entry.kind === 'folder' ? '删除整个页面文件夹' : '删除页面', context, { expectedRevision })) { selectedTreeId = treeEntry(entry.parentId)?.id || target().id; dialog.close(); renderPages(); }
    else error.textContent = '项目已变化或删除未完成，请关闭此窗口后重新检查目录内容。';
  });
  cancel.dataset.pageTreeDeleteCancel = ''; confirm.dataset.pageTreeDeleteConfirm = ''; confirm.disabled = blocked; actions.append(cancel, confirm); dialog.append(heading, body, error, actions); document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); focusTree(selectedTreeId); }); dialog.showModal(); cancel.focus();
}
function selectTreeItem(id, open = false) {
  const entry = treeEntry(id); if (!entry) return;
  selectedTreeId = id;
  if (open && entry.kind === 'page') void openTarget('page', id);
  renderPages(); focusTree(id);
}
function treeMenu(entry, anchor, event) {
  selectedTreeId = entry.id; renderPages();
  const openedProjectId = project().id, openedRevision = state().revision;
  const guarded = action => () => {
    if (project()?.id !== openedProjectId || state().revision !== openedRevision) { E.toast('项目已变化，请重新打开页面树菜单。', 'warning'); return; }
    action();
  };
  menu(treeRow(entry.id) || anchor, [
    ['添加子页面', guarded(() => void addPage(entry.id)), 'add-page'],
    ['添加子文件夹', guarded(() => addFolder(entry.id)), 'add-folder'],
    ['重命名…', guarded(() => renameTreeItem(entry.id)), 'rename'],
    [isCollapsed(entry) ? '展开' : '收起', guarded(() => void toggleTreeItem(entry.id)), 'toggle'],
    [entry.kind === 'folder' ? '删除整个文件夹…' : '删除页面…', guarded(() => removeTreeItem(entry.id)), 'delete'],
  ], { id: 'page-tree-menu', x: event?.clientX, y: event?.clientY, signature: navigationSignature(), focus: true, restoreFocus: () => focusTree(entry.id) });
}
async function moveTreeItem(id, destination, position, context = E.captureContext(), expectedRevision = state().revision, { restoreTreeFocus = true } = {}) {
  const focusRequest = captureTreeFocus();
  try {
    const commands = pageTreeMoveCommands(project(), id, destination, position); if (!commands.length) return;
    if (await E.command(commands, '调整页面树', context, { expectedRevision })) { if (position === 'inside') collapsedTreeIds.delete(destination); selectedTreeId = id; renderPages(); storeTabs(); if (restoreTreeFocus) focusTree(id, focusRequest); }
  } catch (error) { E.toast(error.message, 'error'); }
}
async function reparentTreeItem(id, parentId, context = E.captureContext(), expectedRevision = state().revision, { restoreTreeFocus = true } = {}) {
  if (parentId) return moveTreeItem(id, parentId, 'inside', context, expectedRevision, { restoreTreeFocus });
  const entry = treeEntry(id), focusRequest = captureTreeFocus(); if (!entry) return;
  const command = entry.kind === 'folder' ? { type: 'reparentPageFolder', folderId: id, parentId: null } : { type: 'reparentPage', pageId: id, parentId: null };
  if (await E.command([command], '移到页面树顶层', context, { expectedRevision })) { selectedTreeId = id; renderPages(); if (restoreTreeFocus) focusTree(id, focusRequest); }
}
function treeKeydown(event, id) {
  const entry = treeEntry(id); if (!entry) return;
  const modifier = event.ctrlKey || event.metaKey, arrow = event.key.startsWith('Arrow');
  if (event.target.closest('button') && ['Enter', ' '].includes(event.key)) { event.stopPropagation(); return; }
  if ((modifier || event.altKey) && arrow) {
    event.preventDefault(); event.stopImmediatePropagation();
    const siblings = treeItems().filter(item => (item.parentId || null) === (entry.parentId || null)), index = siblings.findIndex(item => item.id === id);
    if (event.key === 'ArrowUp' && index > 0) void moveTreeItem(id, siblings[index - 1].id, 'before');
    else if (event.key === 'ArrowDown' && index < siblings.length - 1) void moveTreeItem(id, siblings[index + 1].id, 'after');
    else if (event.key === 'ArrowRight' && index > 0) void moveTreeItem(id, siblings[index - 1].id, 'inside');
    else if (event.key === 'ArrowLeft' && entry.parentId) void moveTreeItem(id, entry.parentId, 'after');
    return;
  }
  if (modifier && ['s', 'o', 'n', 'z', 'y'].includes(event.key.toLowerCase())) return;
  if (event.key === 'Tab') return;
  event.stopImmediatePropagation();
  if (modifier || arrow || ['Home', 'End', 'Enter', ' ', 'Delete', 'Backspace', 'F2', 'ContextMenu'].includes(event.key) || (event.shiftKey && event.key === 'F10')) event.preventDefault();
  const visible = navigationTreeItems(project(), collapsedTreeIds, true), index = visible.findIndex(item => item.id === id), children = treeItems().filter(item => item.parentId === id);
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]; if (next) selectTreeItem(next.id); }
  else if (event.key === 'Home' || event.key === 'End') selectTreeItem(visible[event.key === 'Home' ? 0 : visible.length - 1]?.id);
  else if (event.key === 'ArrowRight') { if (isCollapsed(entry)) void toggleTreeItem(id); else if (children.length) selectTreeItem(children[0].id); }
  else if (event.key === 'ArrowLeft') { if (children.length && !isCollapsed(entry)) void toggleTreeItem(id); else if (entry.parentId) selectTreeItem(entry.parentId); }
  else if (event.key === 'Enter' || event.key === ' ') { if (entry.kind === 'folder') void toggleTreeItem(id); else selectTreeItem(id, true); }
  else if (event.key === 'F2') renameTreeItem(id);
  else if (event.key === 'Delete' || event.key === 'Backspace') removeTreeItem(id);
  else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) treeMenu(entry, treeRow(id));
}
function renderPages() {
  if (!project()) return;
  if (dragging && dragging.signature !== navigationSignature()) dragging.cancel();
  if (activeMenu?.id === 'page-tree-menu' && activeMenu.navigationSignature !== navigationSignature()) { activeMenu.remove(); activeMenu = null; }
  const container = $('#page-list'), activeTreeId = document.activeElement?.closest('#page-list [data-tree-id]')?.dataset.treeId;
  const items = treeItems(), current = target(), currentKey = targetKey(current.kind, current.id);
  if (currentKey !== renderedTreeTarget) { renderedTreeTarget = currentKey; if (current.kind === 'page') selectedTreeId = current.id; }
  if (!items.some(entry => entry.id === selectedTreeId)) selectedTreeId = current.kind === 'page' ? current.id : items[0]?.id;
  const visible = navigationTreeItems(project(), collapsedTreeIds, true), tabStopId = visible.some(entry => entry.id === selectedTreeId) ? selectedTreeId : visible[0]?.id;
  container.replaceChildren(); container.setAttribute('role', 'tree'); container.setAttribute('aria-label', '页面与文件夹');
  for (const entry of visible) {
    const { id, kind, name, depth } = entry, row = create('div', `page-row${selectedTreeId === id ? ' active tree-selected' : ''}`);
    row.dataset.treeId = id; row.dataset.treeKind = kind; row.dataset[kind === 'folder' ? 'folderId' : 'pageId'] = id;
    row.style.paddingLeft = `${5 + depth * 14}px`; row.tabIndex = id === tabStopId ? 0 : -1;
    row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.setAttribute('aria-selected', String(selectedTreeId === id));
    const children = items.filter(item => item.parentId === id), siblings = items.filter(item => (item.parentId || null) === (entry.parentId || null));
    row.setAttribute('aria-posinset', String(siblings.findIndex(item => item.id === id) + 1)); row.setAttribute('aria-setsize', String(siblings.length));
    row.title = `${kind === 'folder' ? '文件夹' : '页面'}：${name}\n拖到行中间成为子项；拖到上下边缘排序。Ctrl / ⌘ / Alt + 方向键调整层级与顺序。`;
    if (children.length || kind === 'folder') {
      row.setAttribute('aria-expanded', String(!isCollapsed(entry)));
      const toggle = button('', event => { event.stopPropagation(); void toggleTreeItem(id); }, `${isCollapsed(entry) ? '展开' : '收起'} ${name}`); toggle.className = 'page-tree-toggle'; toggle.dataset.pageTreeToggle = id; toggle.tabIndex = -1; toggle.setAttribute('aria-label', toggle.title); toggle.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg>'; row.append(toggle);
    } else row.append(create('span', 'page-tree-toggle-spacer'));
    const icon = create('span', 'page-symbol'); icon.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${kind === 'folder' ? 'folder' : 'page'}"/></svg>`; row.append(icon, create('span', 'page-name', name));
    if (kind === 'folder') row.append(create('span', 'page-tree-count', String(children.length)));
    const remove = button('×', event => { event.stopPropagation(); selectedTreeId = id; removeTreeItem(id); }, kind === 'folder' ? '删除整个文件夹' : '删除页面'); remove.className = 'small-icon'; remove.tabIndex = -1; remove.dataset.pageTreeRemove = id; row.append(remove);
    row.addEventListener('click', event => { if (!event.target.closest('button')) selectTreeItem(id, kind === 'page'); });
    row.addEventListener('dblclick', event => { if (event.target.closest('button')) return; if (kind === 'folder') void toggleTreeItem(id); else renameTreeItem(id); });
    row.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); treeMenu(entry, row, event); });
    row.addEventListener('keydown', event => treeKeydown(event, id), true);
    row.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      const context = E.captureContext(), expectedRevision = state().revision;
      startDrag(event, `${kind === 'folder' ? '文件夹 · ' : ''}${name}`, next => {
        for (const item of container.children) item.classList.remove('page-drop-before', 'page-drop-after', 'page-drop-inside');
        const hovered = document.elementFromPoint(next.clientX, next.clientY)?.closest('#page-list [data-tree-id]');
        if (!hovered || hovered.dataset.treeId === id) return null;
        const rect = hovered.getBoundingClientRect(), fraction = (next.clientY - rect.top) / rect.height, position = fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'inside';
        try { pageTreeMoveCommands(project(), id, hovered.dataset.treeId, position); } catch { return null; }
        hovered.classList.add(`page-drop-${position}`); return { id: hovered.dataset.treeId, position };
      }, result => { for (const item of container.children) item.classList.remove('page-drop-before', 'page-drop-after', 'page-drop-inside'); if (result) void moveTreeItem(id, result.id, result.position, context, expectedRevision); });
    });
    container.append(row);
  }
  if (activeTreeId && treeRow(activeTreeId)) treeRow(activeTreeId).focus({ preventScroll: true });
  const notice = JSON.stringify([project().id, state().revision, selectedTreeId, currentKey]);
  if (notice !== lastTreeNotice) { lastTreeNotice = notice; document.dispatchEvent(new CustomEvent('yuanda:pagetreechange')); }
}
$('#add-page').addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); void addPage(); }, true);
$('#add-page-folder').addEventListener('click', () => addFolder());

const gallery = create('section', 'navigation-gallery'); gallery.id = 'navigation-gallery'; gallery.hidden = true; gallery.setAttribute('aria-label', '项目画廊');
const galleryControls = create('div', 'gallery-controls'), gallerySearch = create('input'), galleryFilter = create('select'), gallerySize = create('input'), galleryGrid = create('div', 'gallery-grid');
gallerySearch.type = 'search'; gallerySearch.placeholder = '搜索页面或母版'; gallerySearch.setAttribute('aria-label', '搜索页面或母版');
galleryFilter.setAttribute('aria-label', '画廊类型'); for (const [value, name] of [['all', '全部'], ['page', '页面'], ['component', '母版']]) { const option = create('option', '', name); option.value = value; galleryFilter.append(option); }
gallerySize.type = 'range'; gallerySize.min = 150; gallerySize.max = 360; gallerySize.value = Math.min(360, Math.max(150, Number(preferences.gallerySize) || 220)); gallerySize.setAttribute('aria-label', '缩略图大小');
const sizeLabel = create('label', '', '大小'); sizeLabel.append(gallerySize);
galleryControls.append(create('h2', '', '项目画廊'), gallerySearch, galleryFilter, sizeLabel, button('返回画布', () => hideGallery()));
gallery.append(galleryControls, galleryGrid); $('.canvas-column').append(gallery);
gallerySearch.addEventListener('input', renderGallery); galleryFilter.addEventListener('change', renderGallery); gallerySize.addEventListener('input', () => { preferences.gallerySize = Number(gallerySize.value); persist(); galleryGrid.style.setProperty('--gallery-size', `${preferences.gallerySize}px`); });
function showGallery() { galleryOpen = true; gallery.hidden = false; renderGallery(); renderTabs(); }
function hideGallery() { galleryOpen = false; gallery.hidden = true; suppressOpen = false; const current = target(); const key = targetKey(current.kind, current.id); if (itemForKey(key).item && !tabs.includes(key)) tabs.push(key); storeTabs(); renderTabs(); }
const svgNS = 'http://www.w3.org/2000/svg';
function svgElement(name, attrs = {}) { const result = document.createElementNS(svgNS, name); for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value)); return result; }
function thumbnail(item) {
  if(E.getViewModel())item=E.getViewModel().resolveContainerView(project(),item.id,null);
  const width = item.width || 1200, height = item.height || 800;
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${item.name}缩略图`, preserveAspectRatio: 'xMidYMid meet' });
  svg.append(svgElement('rect', { width, height, fill: item.background || '#fff' }));
  for(const node of previewVisibleNodes(item.nodes||[])){
    const foreign=svgElement('foreignObject',{x:node.x,y:node.y,width:node.width,height:node.height});foreign.style.overflow='visible';
    const content=createPreviewNode(node,item.nodes||[]);content.style.left='0';content.style.top='0';foreign.append(content);svg.append(foreign);
  }
  return svg;
}
function renderGallery() {
  if (!galleryOpen || !project()) return;
  galleryGrid.replaceChildren(); galleryGrid.style.setProperty('--gallery-size', `${preferences.gallerySize}px`);
  const query = gallerySearch.value.trim().toLocaleLowerCase();
  const items = [...treeItems().filter(entry => entry.kind === 'page').map(entry => ({ kind: 'page', item: entry.item })), ...(project().components || []).map(item => ({ kind: 'component', item }))];
  for (const { kind, item } of items.filter(({ kind, item }) => (galleryFilter.value === 'all' || galleryFilter.value === kind) && item.name.toLocaleLowerCase().includes(query))) {
    const tile = button('', () => void openTarget(kind, item.id), `打开${kind === 'page' ? '页面' : '母版'} ${item.name}`); tile.className = 'gallery-item'; tile.dataset.galleryId = item.id; tile.dataset.galleryKind = kind;
    const label = create('div', 'gallery-item-title'); label.append(create('strong', '', item.name), create('span', '', kind === 'page' ? '页面' : '母版'));
    tile.append(thumbnail(item), label); galleryGrid.append(tile);
  }
  if (!galleryGrid.children.length) galleryGrid.append(create('p', 'gallery-empty', '没有符合搜索条件的页面或母版。'));
}

const toolbarEntries = [
  ...[...$('.toolgroup').children].filter(item => item.tagName === 'BUTTON').map(item => ({ item, key: item.id, label: item.getAttribute('aria-label') || item.title, parent: $('.toolgroup'), group: '历史操作' })),
  ...[...$('.insert-tools').children].filter(item => item.tagName === 'BUTTON').map((item, index) => ({ item, key: item.id || `insert:${item.dataset.insert || index}`, label: item.textContent.trim() || item.title, parent: $('.insert-tools'), group: '插入元件' })),
  ...[['#snap-toggle', 'snap-toggle', '吸附'], ['.panel-menu-wrapper', 'panels-menu-wrapper', '面板'], ['#agent-toggle', 'agent-toggle', 'Agent 工作台'], ['.zoom-control', 'zoom-control', '缩放']].map(([selector, key, label]) => ({ item: $(selector), key, label, parent: $('.toolbar-right'), group: '工作区工具' }))
];
// Give utility labels their own span without replacing the controls or handlers.
for (const selector of ['#snap-toggle', '#panels-toggle', '#agent-toggle']) {
  const control = $(selector);
  for (const child of [...control.childNodes]) if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) { const span = create('span', 'toolbar-item-label', child.textContent); child.replaceWith(span); }
}
const snapIcon = svgElement('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }); snapIcon.classList.add('icon'); snapIcon.append(svgElement('path', { d: 'M4 3v7a6 6 0 0 0 12 0V3h-4v7a2 2 0 0 1-4 0V3ZM4 6h4m4 0h4' })); $('#snap-toggle').prepend(snapIcon);
const defaultOrder = toolbarEntries.map(item => item.key);
function applyPreferences() {
  document.documentElement.dataset.editorTheme = preferences.theme === 'dark' ? 'dark' : 'light';
  $('.toolbar').classList.toggle('hide-tool-labels', !preferences.labels);
  const order = [...new Set([...(Array.isArray(preferences.toolbar) ? preferences.toolbar : []), ...defaultOrder])].filter(key => defaultOrder.includes(key));
  for (const key of order) { const entry = toolbarEntries.find(item => item.key === key); entry.item.hidden = (preferences.hidden || []).includes(key); entry.parent.append(entry.item); }
  if ($('#workspace-settings')) $('.toolbar-right').append($('#workspace-settings'));
  preferences.toolbar = order; document.dispatchEvent(new CustomEvent('yuanda:layoutchange'));
}
function settings() {
  const dialog = create('dialog', 'navigation-settings'); dialog.id = 'navigation-settings'; const content = create('div');
  const heading = create('h2', '', '工作区外观与工具栏');
  const theme = create('select'); theme.setAttribute('aria-label', '编辑器外观'); for (const [value, label] of [['light', '浅色'], ['dark', '深色']]) { const option = create('option', '', label); option.value = value; theme.append(option); } theme.value = preferences.theme; theme.addEventListener('change', () => { preferences.theme = theme.value; persist(); applyPreferences(); });
  const labelToggle = create('input'); labelToggle.type = 'checkbox'; labelToggle.checked = preferences.labels; labelToggle.setAttribute('aria-label', '显示工具名称'); labelToggle.addEventListener('change', () => { preferences.labels = labelToggle.checked; persist(); applyPreferences(); });
  const label = create('label', '', '显示工具名称'); label.prepend(labelToggle);
  const appearance = create('div', 'navigation-setting-row'); appearance.append(create('span', '', '编辑器外观'), theme, label);
  const list = create('div');
  const renderList = () => {
    list.replaceChildren();
    for (const [index, key] of preferences.toolbar.entries()) {
      const entry = toolbarEntries.find(item => item.key === key), row = create('div', 'navigation-setting-row'); row.dataset.toolbarKey = key;
      const groupKeys = preferences.toolbar.filter(key => toolbarEntries.find(item => item.key === key).group === entry.group), groupIndex = groupKeys.indexOf(key);
      if (groupIndex === 0) list.append(create('h3', 'workspace-section-title', entry.group));
      const visible = create('input'); visible.type = 'checkbox'; visible.checked = !preferences.hidden.includes(key); visible.setAttribute('aria-label', `显示 ${entry.label}`);
      visible.addEventListener('change', () => { preferences.hidden = preferences.hidden.filter(item => item !== key); if (!visible.checked) preferences.hidden.push(key); persist(); applyPreferences(); });
      const caption = create('label', '', entry.label); caption.prepend(visible);
      const up = button('上移', () => { preferences.toolbar = reorderKeys(preferences.toolbar, key, groupKeys[groupIndex - 1]); persist(); applyPreferences(); renderList(); }); up.disabled = groupIndex === 0;
      const down = button('下移', () => { preferences.toolbar = reorderKeys(preferences.toolbar, key, groupKeys[groupIndex + 1], true); persist(); applyPreferences(); renderList(); }); down.disabled = groupIndex === groupKeys.length - 1;
      row.append(caption, up, down); list.append(row);
    }
  };
  renderList();
  const footer = create('div', 'navigation-setting-footer');
  footer.append(button('恢复工具栏默认', () => { preferences.toolbar = [...defaultOrder]; preferences.hidden = []; preferences.labels = true; labelToggle.checked = true; persist(); applyPreferences(); renderList(); }), button('完成', () => dialog.close()));
  content.append(heading, appearance, create('p', '', '外观只影响编辑器。页面颜色、导出的 HTML 和项目内容保持自己的设计。工具栏可隐藏、在所属区域内排序；隐藏的元件仍可从元件库添加。'), list, footer); dialog.append(content); document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}
const settingsButton = button('工作区', settings, '深浅色、工具栏显示和顺序'); settingsButton.id = 'workspace-settings'; $('.toolbar-right').append(settingsButton); applyPreferences();

const viewport = $('#canvas-viewport'); let spaceHeld = false, altHeld = false, pan = null, lastPointer = null;
function clearMeasure() { $('#measure-overlay')?.remove(); }
function renderMeasure(event = lastPointer) {
  clearMeasure(); if (!altHeld || !event || editing(document.activeElement) || galleryOpen) return;
  const selected = E.getNodes(); if (!selected.length) return;
  const board = $('#board'), boardRect = board.getBoundingClientRect(), scale = E.getZoom();
  const bounds = ids => boxOf(ids.map(id => { const item = document.querySelector(`.design-node[data-node-id="${CSS.escape(id)}"]`); if (!item) return null; const r = item.getBoundingClientRect(); return { x: (r.left - boardRect.left) / scale, y: (r.top - boardRect.top) / scale, width: r.width / scale, height: r.height / scale }; }).filter(Boolean));
  const source = bounds(selected.map(item => item.id)); if (!source) return;
  const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('.design-node'), id = hovered?.dataset.nodeId;
  const destination = id && !selected.some(item => item.id === id) ? bounds([id]) : { x: 0, y: 0, width: E.getPage().width, height: E.getPage().height };
  if (!destination) return;
  const lines = measurementLines(source, destination, !(id && !selected.some(item => item.id === id)));
  const overlay = svgElement('svg', { id: 'measure-overlay', width: E.getPage().width, height: E.getPage().height, 'aria-hidden': 'true' });
  for (const line of lines) {
    overlay.append(svgElement('line', { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }));
    const horizontal = line.y1 === line.y2, tick = 4 / scale;
    for (const [x, y] of [[line.x1, line.y1], [line.x2, line.y2]]) overlay.append(svgElement('line', { x1: x - (horizontal ? 0 : tick), y1: y - (horizontal ? tick : 0), x2: x + (horizontal ? 0 : tick), y2: y + (horizontal ? tick : 0) }));
    const label = `${line.distance}`, x = (line.x1 + line.x2) / 2, y = (line.y1 + line.y2) / 2;
    overlay.append(svgElement('rect', { x: x - (label.length * 3.5 + 4) / scale, y: y - 8 / scale, width: (label.length * 7 + 8) / scale, height: 16 / scale, rx: 2 / scale }));
    const text = svgElement('text', { x, y, 'font-size': 11 / scale }); text.textContent = label; overlay.append(text);
  }
  board.append(overlay);
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { dragging?.cancel(); activeMenu?.remove(); clearMeasure(); if (galleryOpen) hideGallery(); }
  if (editing(event.target)) return;
  if (event.target.closest('#page-list,[role="menu"]')) return;
  if (event.code === 'Space') { event.preventDefault(); event.stopImmediatePropagation(); spaceHeld = true; viewport.classList.add('space-pan'); }
  if (event.key === 'Alt') { altHeld = true; renderMeasure(); }
}, true);
document.addEventListener('keyup', event => {
  if (event.code === 'Space') { spaceHeld = false; viewport.classList.remove('space-pan'); }
  if (event.key === 'Alt') { altHeld = false; clearMeasure(); }
}, true);
viewport.addEventListener('pointerdown', event => {
  if (!spaceHeld || event.button !== 0) return;
  event.preventDefault(); event.stopImmediatePropagation(); pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.setPointerCapture(event.pointerId); viewport.classList.add('space-panning'); clearMeasure();
}, true);
document.addEventListener('pointermove', event => {
  lastPointer = { clientX: event.clientX, clientY: event.clientY };
  if (pan) { event.preventDefault(); event.stopImmediatePropagation(); viewport.scrollLeft = pan.left - (event.clientX - pan.x); viewport.scrollTop = pan.top - (event.clientY - pan.y); }
  else if (altHeld && viewport.contains(event.target)) renderMeasure(event);
}, true);
function stopPan() { if (!pan) return; if (viewport.hasPointerCapture(pan.id)) viewport.releasePointerCapture(pan.id); pan = null; viewport.classList.remove('space-panning'); }
document.addEventListener('pointerup', event => { if (pan) { event.preventDefault(); event.stopImmediatePropagation(); stopPan(); } }, true);
document.addEventListener('pointercancel', stopPan, true);
window.addEventListener('blur', () => { spaceHeld = false; altHeld = false; viewport.classList.remove('space-pan'); stopPan(); clearMeasure(); dragging?.cancel(); });
viewport.addEventListener('scroll', () => { if (altHeld) renderMeasure(); }, { passive: true });

function refresh() {
  if (!project()) return;
  if (dragging && dragging.signature !== navigationSignature()) dragging.cancel();
  if (activeMenu?.id === 'page-tree-menu' && activeMenu.navigationSignature !== navigationSignature()) { activeMenu.remove(); activeMenu = null; }
  if (projectId !== project().id) {
    projectId = project().id; const saved = preferences.projects[projectId] || {};
    tabs = (saved.tabs || []).filter(key => typeof key === 'string' && itemForKey(key).item); collapsedTreeIds = new Set(Array.isArray(saved.collapsedTreeIds) ? saved.collapsedTreeIds : []);
    selectedTreeId = null; renderedTreeTarget = ''; previousTarget = ''; suppressOpen = false; galleryOpen = false; gallery.hidden = true;
  }
  tabs = tabs.filter(key => itemForKey(key).item);
  const current = target(), key = targetKey(current.kind, current.id);
  if (itemForKey(key).item && key !== previousTarget) { if (!tabs.includes(key)) tabs.push(key); previousTarget = key; suppressOpen = false; if (galleryOpen) { galleryOpen = false; gallery.hidden = true; } }
  if (!tabs.length && !suppressOpen && itemForKey(key).item) tabs.push(key);
  renderTabs(); renderPages(); renderGallery(); storeTabs(); clearMeasure();
}
document.addEventListener('yuanda:editorchange', refresh);
window.YuandaNavigation = { openTarget, showGallery, hideGallery, closeAll, closeTab, settings, renderPages, addPage, addFolder, moveTreeItem, reparentTreeItem, getTreeItems: treeItems, getTreeDescendants: id => pageTreeDescendants(project(), id), getTreeSelection: () => { const entry = treeEntry(selectedTreeId); return entry ? { id: entry.id, kind: entry.kind } : null; }, getTabs: () => [...tabs], getPreferences: () => structuredClone(preferences), refresh };
refresh();
