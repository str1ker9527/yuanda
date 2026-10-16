/** Original sample: real page folders and cross-folder navigation. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankProject, DocumentEngine } from '../app/core/document.mjs';
import { exportHtml } from '../app/core/html-export.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = createBlankProject('页面目录体验'); project.id = 'page-folder-demo';
project.pages[0].id = 'folder-home'; project.pages[0].name = '产品首页';
const engine = new DocumentEngine(project);
engine.apply([
  { type: 'addPageFolder', folder: { id: 'folder-product', name: '产品设计' } },
  { type: 'addPageFolder', folder: { id: 'folder-order', name: '订单流程', parentId: 'folder-product' } },
  { type: 'addPageFolder', folder: { id: 'folder-notes', name: '待整理', collapsed: true } },
  { type: 'reparentPage', pageId: 'folder-home', parentId: 'folder-product' },
  { type: 'addPage', page: { id: 'folder-detail', name: '订单详情', parentId: 'folder-order' } },
  { type: 'addPage', page: { id: 'folder-complete', name: '完成页', parentId: 'folder-order' } },
  { type: 'addPage', page: { id: 'folder-help', name: '使用说明' } },
  { type: 'reorderPageTreeItem', itemId: 'folder-product', index: 0 }
]);
const pages = [
  ['folder-home', '产品首页', '左侧“产品设计”是真文件夹。把页面拖到目录行中间即可归类；拖到行上、下边缘可以排序。', '查看订单', 'folder-detail'],
  ['folder-detail', '订单详情', '本页位于 产品设计 / 订单流程。页面跳转继续使用页面编号，改名和移动目录不会改变跳转目标。', '完成订单', 'folder-complete'],
  ['folder-complete', '完成页', '目录只负责组织页面，不会作为空白页面出现在预览里。当前流程的交互仍然可以跨目录执行。', '返回首页', 'folder-home'],
  ['folder-help', '页面目录使用说明', '在目录上按右键可以添加子页、添加子目录或改名。Delete 会先显示删除范围；Ctrl+Z 可恢复整个删除。完整工程请保存为 .yuanda。含目录的 .rp 导出目前会明确提示尚未支持。', '回到产品首页', 'folder-home']
];
engine.apply(pages.flatMap(([pageId, title, description, label, destination]) => [
  { type: 'addNode', pageId, node: { id: `${pageId}-title`, type: 'text', text: title, x: 80, y: 72, width: 1000, height: 64, style: { fontSize: 36, fontWeight: 700 } } },
  { type: 'addNode', pageId, node: { id: `${pageId}-body`, type: 'text', text: description, x: 80, y: 164, width: 920, height: 160, style: { fontSize: 20 } } },
  { type: 'addNode', pageId, node: { id: `${pageId}-next`, type: 'button', text: label, x: 80, y: 360, width: 220, height: 52, interactions: [{ event: 'click', actions: [{ type: 'navigate', pageId: destination }] }] } }
]));
await mkdir(path.join(root, 'samples/yuanda'), { recursive: true });
await mkdir(path.join(root, 'exports'), { recursive: true });
const document = engine.getSnapshot();
await writeFile(path.join(root, 'samples/yuanda/页面目录体验.yuanda'), JSON.stringify(document, null, 2));
await writeFile(path.join(root, 'exports/页面目录体验.html'), exportHtml(document));
console.log('已生成页面目录体验工程与交互 HTML（4 个页面，3 个文件夹）。');
