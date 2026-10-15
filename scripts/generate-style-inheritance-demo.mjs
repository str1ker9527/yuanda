/** Original reproducible tutorial: editor inheritance and offline prototype interactions. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { DocumentEngine, createBlankProject, makeNode } from '../app/core/document.mjs';
import { exportHtml } from '../app/core/html-export.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = createBlankProject('共享样式与格式刷体验'), page = project.pages[0]; project.id = 'style-inheritance-demo'; page.id = 'inheritance-demo'; page.name = '共享样式与格式刷体验'; page.width = 1200; page.height = 1160; page.background = '#FFFFFF';
const named = (id, name, style, parentId = null, stateStyles = {}) => ({ id, name, parentId, overrideKeys: Object.keys(style), style: { ...makeNode('rectangle').style, ...style }, stateStyles });
project.defaultStyleSets = [{ id: 'demo-defaults', name: '清爽界面默认', byType: {
  rectangle: { style: { fill: '#FAFAFA', stroke: '#D8D8D8', strokeWidth: 1, radius: 10, fontFamily: 'Microsoft YaHei', fontSize: 19, color: '#333333', lineHeight: 32, padding: { top: 18, right: 18, bottom: 18, left: 18 } }, stateStyles: {} },
  input: { style: { fill: '#FFFFFF', stroke: '#BDBDBD', strokeWidth: 1, radius: 8, fontSize: 17, padding: { top: 9, right: 14, bottom: 9, left: 14 } }, stateStyles: { focus: { stroke: '#191919', strokeWidth: 2, shadows: [{ inset: false, x: 0, y: 0, blur: 0, spread: 3, color: '#000000', opacity: .06 }] } } }
} }]; project.defaultStyleSetId = 'demo-defaults';
project.styles = [named('card-parent', '卡片基础', { fill: '#F1F1F1', stroke: '#BBBBBB', radius: 18 }, null, { hover: { fill: '#DEDEDE' }, selected: { fill: '#222222', color: '#FFFFFF' }, disabled: { opacity: .4 } }), named('card-child', '重点卡片', { stroke: '#333333', strokeWidth: 2, fontWeight: 600 }, 'card-parent')];
const add = (type, id, text, x, y, width, height, style = {}, extra = {}) => { const value = makeNode(type, { id, name: id, text, x, y, width, height, style, ...extra }); value.styleOverrideKeys = Object.keys(style); page.nodes.push(value); return value; };
const text = (id, value, x, y, width, height, size = 15, color = '#666666') => add('text', id, value, x, y, width, height, { fontSize: size, lineHeight: size * 1.5, color, fill: 'transparent', strokeWidth: 0 });
const button = (id, label, x, y, width, actions) => add('button', id, label, x, y, width, 42, { fill: '#FFFFFF', color: '#191919', stroke: '#C8C8C8', strokeWidth: 1, radius: 6, fontSize: 14 }, { interactions: [{ event: 'click', actions }] });
text('heading', '改一处，许多地方一起变。', 48, 26, 1104, 64, 36, '#191919');
text('intro', '默认样式打底，命名样式逐级继承，单个元件还可以保留自己的小变化。', 48, 102, 1104, 34, 18);
text('scope-note', '在原搭编辑器里修改样式定义；在这个网页里移动鼠标、点按钮，体验运行时效果。', 48, 147, 1104, 30, 15);
const positions = [48, 330, 612, 894];
['01  类型默认', '02  命名父样式', '03  命名子样式', '04  单个元件覆盖'].forEach((label, i) => text('label-' + i, label, positions[i], 209, 258, 30, 18, '#191919'));
add('rectangle', 'default-card', '默认的边框\n默认的圆角', 48, 254, 258, 154);
add('rectangle', 'parent-card', '卡片基础\n圆角变为 18', 330, 254, 258, 154, {}, { styleId: 'card-parent' });
add('rectangle', 'child-card', '重点卡片\n继承父级 + 加粗边框', 612, 254, 258, 154, {}, { styleId: 'card-child' });
add('rectangle', 'local-card', '重点卡片的实例\n单独改白色与小圆角', 894, 254, 258, 154, { fill: '#FFFFFF', radius: 4 }, { styleId: 'card-child' });
text('layers-help', '把鼠标移到后三张卡片：它们共享悬停样式。第四张的普通状态有局部覆盖，悬停仍使用继承的状态样式。', 48, 432, 1104, 48, 15);
text('runtime-title', '先在网页里试玩', 48, 510, 1104, 34, 23, '#191919');
button('select-card', '选中重点卡片', 48, 563, 170, [{ type: 'setSelected', targetId: 'child-card', value: true }]);
button('disable-card', '禁用重点卡片', 238, 563, 170, [{ type: 'setDisabled', targetId: 'child-card', value: true }]);
button('reset-card', '恢复普通状态', 428, 563, 170, [{ type: 'setSelected', targetId: 'child-card', value: false }, { type: 'setDisabled', targetId: 'child-card', value: false }]);
button('runtime-change', '运行时加粗第四张', 618, 563, 244, [{ type: 'setStyle', targetId: 'local-card', style: { strokeWidth: 5, stroke: '#191919' } }]);
button('switch-view', '切换对比视图', 882, 563, 270, [{ type: 'setAdaptiveView', mode: 'view', viewId: 'comparison' }]);
add('input', 'demo-input', '这里可以输入文字', 48, 640, 420, 54, {}, { value: '', interactions: [{ event: 'input', actions: [{ type: 'setText', targetId: 'input-echo', value: { op: 'concat', args: ['刚刚输入：', { op: 'event', name: 'value' }] } }] }] });
text('input-echo', '刚刚输入：', 498, 646, 654, 46, 16);
text('runtime-help', '试着输入文字，再切换视图。输入内容和运行中加粗的边框会保留；网页重新开始后回到设计初态。', 48, 714, 1104, 48, 15);
button('base-view', '回到基础视图', 48, 778, 170, [{ type: 'setAdaptiveView', mode: 'base' }]);
text('editor-title', '再回到原搭编辑器里修改', 48, 854, 1104, 34, 23, '#191919');
text('editor-steps', '1. 修改「清爽界面默认」的矩形字号，观察四张卡片一起变化。\n2. 修改「卡片基础」的普通填充：父卡片和子卡片会跟随，第四张保留自己的白色。\n3. 选中第四张，恢复 fill / radius 的继承；再用格式刷把捕获的外观复制给其他元件。', 48, 910, 1104, 132, 16);
text('editor-boundary', '命名定义、默认集和格式刷属于编辑器能力；上面的网页按钮只改变本次演示中的元件。', 48, 1070, 1104, 42, 14);
page.views = [{ id: 'comparison', name: '对比视图', minWidth: 2000, width: 1200, height: 1160, overrides: { 'parent-card': { style: { fill: '#E7E7E7' } }, 'child-card': { style: { fontSize: 21 } }, 'local-card': { style: { strokeWidth: 1 } }, 'demo-input': { width: 440 } } }];
const saved = new DocumentEngine(project).getSnapshot(), files = [[path.join(root, 'samples/yuanda/共享样式与格式刷体验.yuanda'), JSON.stringify(saved, null, 2) + '\n'], [path.join(root, 'exports/共享样式与格式刷体验.html'), exportHtml(saved)]];
const backups = [], stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const [file, content] of files) {
  await mkdir(path.dirname(file), { recursive: true }); let previous; try { previous = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== undefined && previous !== content) { const backup = path.join(root, '.local/style-inheritance-demo/backups', stamp, path.basename(file)); await mkdir(path.dirname(backup), { recursive: true }); await copyFile(file, backup); backups.push(backup); }
  if (previous !== content) await writeFile(file, content);
}
console.log(JSON.stringify({ files: files.map(([file]) => file), backups, nodes: saved.pages[0].nodes.length, styles: saved.styles.length, defaultSets: saved.defaultStyleSets.length }, null, 2));
