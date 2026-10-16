import { getPageTreeItems, getPageTreeOrder } from '../core/page-tree-model.mjs';

/** Original navigation algorithms, independent of the desktop shell. */
export function navigationTreeItems(project, collapsedPageIds = new Set(), visibleOnly = false) {
  const items = getPageTreeItems(project), hidden = new Set();
  return items.filter(entry => {
    const invisible = hidden.has(entry.parentId);
    if (invisible || (entry.kind === 'folder' ? entry.item.collapsed : collapsedPageIds.has(entry.id))) hidden.add(entry.id);
    return !visibleOnly || !invisible;
  });
}
export function pageTreeMoveCommands(project, sourceId, targetId, position) {
  const items = getPageTreeItems(project), source = items.find(item => item.id === sourceId), target = items.find(item => item.id === targetId);
  if (!source || !target || sourceId === targetId) return [];
  if (!['before', 'after', 'inside'].includes(position)) throw new Error('请选择有效的页面树放置位置。');
  const parentId = position === 'inside' ? targetId : target.parentId || null;
  const byId = new Map(items.map(item => [item.id, item])), visited = new Set();
  for (let ancestor = parentId; ancestor; ancestor = byId.get(ancestor)?.parentId) {
    if (ancestor === sourceId || visited.has(ancestor)) throw new Error('不能把页面或文件夹放进自己或自己的子项里。');
    visited.add(ancestor);
  }
  const order = getPageTreeOrder(project).filter(id => id !== sourceId);
  const index = order.indexOf(targetId) + Number(position !== 'before');
  const commands = [source.kind === 'folder' ? { type: 'reparentPageFolder', folderId: sourceId, parentId } : { type: 'reparentPage', pageId: sourceId, parentId }, { type: 'reorderPageTreeItem', itemId: sourceId, index }];
  if (position === 'inside' && target.kind === 'folder' && target.item.collapsed) commands.push({ type: 'updatePageFolder', folderId: targetId, patch: { collapsed: false } });
  return commands;
}
export function pageTreeDescendants(project, id) {
  const items = getPageTreeItems(project), included = new Set([id]);
  return items.filter(entry => { if (!included.has(entry.parentId)) return false; included.add(entry.id); return true; });
}
export function treePages(pages, parentId = null, depth = 0, visited = new Set()) {
  const result = [];
  for (const page of pages.filter(item => (item.parentId || null) === parentId)) {
    if (visited.has(page.id)) continue;
    visited.add(page.id); result.push({ page, depth }); result.push(...treePages(pages, page.id, depth + 1, visited));
  }
  return result;
}
export function pageMoveCommands(pages, sourceId, targetId, position) {
  const source = pages.find(item => item.id === sourceId), target = pages.find(item => item.id === targetId);
  if (!source || !target || sourceId === targetId) return [];
  const parentId = position === 'inside' ? targetId : target.parentId || null;
  let ancestor = parentId;
  const seen = new Set();
  while (ancestor) {
    if (ancestor === sourceId || seen.has(ancestor)) throw new Error('不能把页面放进自己或自己的子页面里。');
    seen.add(ancestor); ancestor = pages.find(item => item.id === ancestor)?.parentId;
  }
  const without = pages.filter(item => item.id !== sourceId);
  let index = without.findIndex(item => item.id === targetId);
  if (position !== 'before') index++;
  return [{ type: 'reparentPage', pageId: sourceId, parentId }, { type: 'reorderPage', pageId: sourceId, index }];
}
export function reorderKeys(keys, source, target, after = false) {
  if (source === target || !keys.includes(source) || !keys.includes(target)) return [...keys];
  const result = keys.filter(key => key !== source), index = result.indexOf(target);
  result.splice(index + Number(after), 0, source); return result;
}
export function boxOf(nodes) {
  if (!nodes.length) return null;
  const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y));
  const right = Math.max(...nodes.map(n => n.x + n.width)), bottom = Math.max(...nodes.map(n => n.y + n.height));
  return { x, y, width: right - x, height: bottom - y, right, bottom };
}
export function measurementLines(source, target, page = false) {
  const a = { ...source, right: source.x + source.width, bottom: source.y + source.height };
  const b = { ...target, right: target.x + target.width, bottom: target.y + target.height };
  const lines = [], mx = a.x + a.width / 2, my = a.y + a.height / 2;
  const add = (x1, y1, x2, y2) => lines.push({ x1, y1, x2, y2, distance: Math.round(Math.hypot(x2 - x1, y2 - y1) * 100) / 100 });
  if (page) { add(b.x, my, a.x, my); add(a.right, my, b.right, my); add(mx, b.y, mx, a.y); add(mx, a.bottom, mx, b.bottom); return lines; }
  if (a.right <= b.x) add(a.right, my, b.x, my);
  else if (b.right <= a.x) add(b.right, my, a.x, my);
  else if (a.x !== b.x) add(Math.min(a.x, b.x), Math.max(a.bottom, b.bottom) + 12, Math.max(a.x, b.x), Math.max(a.bottom, b.bottom) + 12);
  if (a.bottom <= b.y) add(mx, a.bottom, mx, b.y);
  else if (b.bottom <= a.y) add(mx, b.bottom, mx, a.y);
  else if (a.y !== b.y) add(Math.max(a.right, b.right) + 12, Math.min(a.y, b.y), Math.max(a.right, b.right) + 12, Math.max(a.y, b.y));
  return lines;
}
