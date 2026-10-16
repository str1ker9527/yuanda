/** Original page organization. Folders never enter the list of drawable pages. */
export const PAGE_TREE_PROJECT_KEYS = ['pageFolders', 'pageTreeOrder'];
export const PAGE_FOLDER_KEYS = ['id', 'name', 'parentId', 'collapsed'];
const own = (object, key) => Object.hasOwn(object, key);
const allItems = project => [...(project.pages || []), ...(project.pageFolders || [])];

/** Called on a cloned project. Null order preserves legacy page-array ordering. */
export function normalizePageTreeProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
  if (!own(project, 'pageFolders')) project.pageFolders = [];
  if (!own(project, 'pageTreeOrder')) project.pageTreeOrder = null;
  if (Array.isArray(project.pageFolders)) for (const folder of project.pageFolders) {
    if (!folder || typeof folder !== 'object' || Array.isArray(folder)) continue;
    if (!own(folder, 'parentId')) folder.parentId = null;
    if (!own(folder, 'collapsed')) folder.collapsed = false;
  }
  return project;
}

/** Flat mixed order; parent links determine hierarchy, this list determines siblings. */
export function getPageTreeOrder(project) {
  return Array.isArray(project.pageTreeOrder) ? [...project.pageTreeOrder] : allItems(project).map(item => item.id);
}

/** DFS presentation order. Hidden children remain in the document and export. */
export function getPageTreeItems(project, { visibleOnly = false } = {}) {
  const folders = new Set((project.pageFolders || []).map(item => item.id));
  const items = new Map(allItems(project).map(item => [item.id, item])), children = new Map();
  for (const id of getPageTreeOrder(project)) {
    const item = items.get(id); if (!item) continue;
    const parentId = item.parentId ?? null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(item);
  }
  const result = [], visited = new Set();
  function visit(parentId, depth) {
    for (const item of children.get(parentId) || []) {
      if (visited.has(item.id)) continue;
      visited.add(item.id); const kind = folders.has(item.id) ? 'folder' : 'page';
      result.push({ id: item.id, name: item.name, parentId: item.parentId ?? null, kind, depth, item });
      if (!(visibleOnly && kind === 'folder' && item.collapsed)) visit(item.id, depth + 1);
    }
  }
  visit(null, 0); return result;
}

export function getOrderedPages(project) {
  return getPageTreeItems(project).filter(entry => entry.kind === 'page').map(entry => entry.item);
}

export function getPageTreeDescendants(project, itemId) {
  const result = new Set(), items = allItems(project); let pending = [itemId];
  while (pending.length) {
    const next = [];
    for (const parentId of pending) for (const item of items) if (item.parentId === parentId && item.id !== itemId && !result.has(item.id)) { result.add(item.id); next.push(item.id); }
    pending = next;
  }
  return [...result];
}

export function validatePageTree(project, h) {
  h.array(project.pageFolders, '页面文件夹', 200);
  for (const folder of project.pageFolders) {
    h.keys(folder, PAGE_FOLDER_KEYS, '页面文件夹'); h.unique(folder.id, '页面文件夹 ID');
    h.string(folder.name, '文件夹名称', 200, 1); h.bool(folder.collapsed, '文件夹折叠状态');
  }
  const items = new Map(allItems(project).map(item => [item.id, item]));
  for (const item of items.values()) {
    if (item.parentId !== null) { h.id(item.parentId, '父页面或文件夹 ID'); if (!items.has(item.parentId)) h.fail(`父页面或文件夹不存在：${item.parentId}`); }
    const visited = new Set([item.id]); let parentId = item.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) h.fail('页面和文件夹层级不能形成循环');
      visited.add(parentId); parentId = items.get(parentId)?.parentId ?? null;
    }
  }
  if (project.pageTreeOrder !== null) {
    h.array(project.pageTreeOrder, '页面目录顺序', 300); const seen = new Set();
    for (const id of project.pageTreeOrder) { h.id(id, '目录项 ID'); if (!items.has(id)) h.fail(`目录顺序含不存在的项目：${id}`); if (seen.has(id)) h.fail(`目录顺序含重复项目：${id}`); seen.add(id); }
    if (seen.size !== items.size) h.fail('目录顺序必须包含每个页面和文件夹');
  }
}

export function appendPageTreeEntry(project, id) {
  if (Array.isArray(project.pageTreeOrder)) project.pageTreeOrder.push(id);
}
export function removePageTreeEntries(project, removedIds) {
  if (Array.isArray(project.pageTreeOrder)) project.pageTreeOrder = project.pageTreeOrder.filter(id => !removedIds.has(id));
}
/** Legacy reorderPage indexes real pages; folder slots retain their positions. */
export function syncLegacyPageOrder(project) {
  if (!Array.isArray(project.pageTreeOrder)) return;
  const ids = new Set(project.pages.map(page => page.id)); let index = 0;
  project.pageTreeOrder = project.pageTreeOrder.map(id => ids.has(id) ? project.pages[index++].id : id);
}

export function applyPageTreeCommand(project, command, h) {
  const check = (required, optional = []) => {
    h.keys(command, ['type', ...required, ...optional], '页面文件夹命令', false);
    for (const key of required) if (!own(command, key)) h.fail(`页面文件夹命令缺少 ${key}`, 'COMMAND_ERROR');
  };
  const folderFor = id => { const folder = project.pageFolders.find(item => item.id === id); if (!folder) h.fail(`找不到页面文件夹：${id}`, 'COMMAND_ERROR'); return folder; };
  switch (command.type) {
    case 'addPageFolder': {
      check(['folder']); h.keys(command.folder, PAGE_FOLDER_KEYS, '新增文件夹', false);
      project.pageTreeOrder = getPageTreeOrder(project);
      const folder = { id: h.uuid(), name: '新文件夹', parentId: null, collapsed: false, ...structuredClone(command.folder) };
      project.pageFolders.push(folder); appendPageTreeEntry(project, folder.id); return true;
    }
    case 'updatePageFolder': {
      check(['folderId', 'patch']); h.keys(command.patch, ['name', 'collapsed'], '文件夹修改', false);
      Object.assign(folderFor(command.folderId), structuredClone(command.patch)); return true;
    }
    case 'reparentPageFolder': check(['folderId', 'parentId']); folderFor(command.folderId).parentId = command.parentId; return true;
    case 'reorderPageTreeItem': {
      check(['itemId', 'index']); const order = getPageTreeOrder(project);
      const before = order.indexOf(command.itemId); if (before < 0) h.fail('目录项不存在', 'COMMAND_ERROR');
      if (!Number.isInteger(command.index) || command.index < 0 || command.index >= order.length) h.fail('目录排序位置超出范围', 'COMMAND_ERROR');
      order.splice(before, 1); order.splice(command.index, 0, command.itemId); project.pageTreeOrder = order;
      const pages = new Map(project.pages.map(page => [page.id, page])); project.pages = order.filter(id => pages.has(id)).map(id => pages.get(id)); return true;
    }
    case 'removePageFolder': {
      check(['folderId']); folderFor(command.folderId);
      const removedIds = new Set([command.folderId, ...getPageTreeDescendants(project, command.folderId)]);
      const removedPages = project.pages.filter(page => removedIds.has(page.id));
      if (removedPages.length === project.pages.length) h.fail('不能删除包含最后一个页面的文件夹', 'COMMAND_ERROR');
      project.pages = project.pages.filter(page => !removedIds.has(page.id));
      project.pageFolders = project.pageFolders.filter(folder => !removedIds.has(folder.id)); removePageTreeEntries(project, removedIds);
      const removedNodes = removedPages.flatMap(page => page.nodes);
      h.cleanReferences(project, new Set([...removedNodes.map(node => node.id), ...h.getNodeInternalIds(removedNodes)]), new Set(removedPages.map(page => page.id))); return true;
    }
    default: return false;
  }
}
