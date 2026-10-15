import { releaseLayout } from './platform-runtime.mjs';
/** Isolated Electron UI regression: real input events, production renderer/preload/core.
 * Run: node_modules/electron/dist/electron.exe scripts/ui-regression.mjs
 * No production main process, user files, network calls, or DOM handler invocation.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { writeFile,readFile } from 'node:fs/promises';
import { DocumentEngine, createBlankProject, makeNode } from '../app/core/document.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.local', 'ui-regression');
mkdirSync(runtime, { recursive: true });
app.setPath('userData', path.join(runtime, 'profile'));
app.setPath('sessionData', path.join(runtime, 'browser'));
app.setPath('logs', path.join(runtime, 'logs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9) || 'result.json';
const packageInfo=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const source = process.argv.includes('--dist') ? releaseLayout(path.join(root,'dist',`原搭-${packageInfo.version}`)).app : root;

void run().catch(async error => {
  await writeFile(path.join(runtime, output), JSON.stringify({ ok: false, fatal: error.stack }, null, 2));
  console.error(error.stack); app.exit(1);
});

async function run() {
  const project = createBlankProject('鼠标与编辑回归');
  project.id = 'regression-project';
  const page = project.pages[0]; page.id = 'regression-page'; page.width = 1000; page.height = 650;
  page.nodes = [
    makeNode('text', { id: 'regression-text', name: '双击测试文字', x: 80, y: 100, width: 350, height: 60, text: '双击后修改这里', style: { fontSize: 30 } }),
    makeNode('button', { id: 'regression-button', name: '测试按钮', x: 80, y: 240, width: 220, height: 56, text: '按钮也能改文字' })
  ];
  const engine = new DocumentEngine(project);
  let selection = { pageId: page.id, nodeIds: [] }, win;
  const agent = { enabled: true, port: 0, requests: 0, connectionFile: path.join(runtime, 'test-connection.json'), cliPath: path.join(root, 'scripts', 'yuanda-agent.mjs') };
  const getState = () => ({ project: engine.getSnapshot(), revision: engine.revision, canUndo: engine.canUndo, canRedo: engine.canRedo, dirty: engine.revision > 0, filePath: null, selection, agent, appVersion: 'test' });
  const emit = () => { const next = getState(); win.webContents.send('yuanda:state', next); return next; };
  const api = {
    getState, getAgentInfo: () => agent,
    validateCommands: body => {
      assert.equal(body.expectedRevision, engine.revision);
      const draft = new DocumentEngine(engine.getSnapshot()); draft.apply(body.commands);
      return { valid:true, revision:engine.revision, count:body.commands.length };
    },
    setSelection: value => { selection = value; },
    command: body => { engine.apply(body.commands, { expectedRevision: body.expectedRevision, label: body.label }); return emit(); },
    undo: () => { engine.undo(); return emit(); }, redo: () => { engine.redo(); return emit(); }
  };
  for (const [name, fn] of Object.entries(api)) ipcMain.handle(`yuanda:${name}`, async (_event, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: { message: error.message, code: error.code } }; }
  });
  await app.whenReady();
  win = new BrowserWindow({ width: 1480, height: 960, show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(source, 'app', 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const js = code => win.webContents.executeJavaScript(code);
  const waitFor = async (predicate, label, max = 2000) => {
    const deadline = Date.now() + max;
    while (Date.now() < deadline) { if (await predicate()) return; await delay(25); }
    throw new Error(`等待超时：${label}`);
  };
  const checks = [], traces = {}, diagnostics = {};
  const check = async (name, task) => {
    try { await task(); checks.push({ name, ok: true }); }
    catch (error) { checks.push({ name, ok: false, error: error.stack }); }
    traces[name] = await js('(window.__inputTrace || []).splice(0)');
    diagnostics[name] = await js(`(() => { const info = selector => { const n=document.querySelector(selector),r=n.getBoundingClientRect();return {hidden:n.hidden,expanded:n.getAttribute('aria-expanded'),rect:{left:r.left,top:r.top,width:r.width,height:r.height,bottom:r.bottom},display:getComputedStyle(n).display}; }; return {window:{width:innerWidth,height:innerHeight},toggle:info('#agent-toggle'),panel:info('#agent-panel'),apply:info('#agent-apply')};})()`);
  };
  await win.loadFile(path.join(source, 'app', 'renderer', 'index.html'));
  win.webContents.focus();
  await waitFor(() => js("document.querySelector('#project-name')?.value === '鼠标与编辑回归'"), '渲染载入');
  await delay(150);
  const installTrace = () => js(`window.__inputTrace = []; window.__uiErrors = []; window.addEventListener('error',event=>window.__uiErrors.push(event.message)); for (const type of ['pointerdown','pointerup','click','dblclick','gotpointercapture','lostpointercapture','keydown','keyup']) document.addEventListener(type, event => window.__inputTrace.push({type,target:event.target.id || event.target.dataset.nodeId || event.target.className,detail:event.detail,button:event.button,key:event.key,focus:document.activeElement?.id||document.activeElement?.dataset.panelMenu,trusted:event.isTrusted}), true);`);
  await installTrace();

  const center = async selector => {
    const point = await js(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('缺少测试目标'); const r = element.getBoundingClientRect(); const x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2); return {x,y,width:r.width,height:r.height,visible:!element.hidden && r.bottom>0 && r.top<innerHeight, hit:element.contains(document.elementFromPoint(x,y))}; })()`);
    assert.equal(point.visible, true, `目标不可见 ${selector}`); assert.equal(point.hit, true, `目标被遮挡 ${selector}`); return point;
  };
  const mouseClick = async (selector, count = 1) => {
    const point = await center(selector);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: count });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: count });
    await delay(80);
  };
  const doubleClick = async selector => { await mouseClick(selector, 1); await mouseClick(selector, 2); };
  const dragMouse = async (selector, target, modifiers=[]) => {
    const from = await center(selector), to = typeof target === 'string' ? await center(target) : target;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1, modifiers });
    for (let step = 1; step <= 8; step++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * step / 8), y: Math.round(from.y + (to.y - from.y) * step / 8), button: 'left', modifiers });
      await delay(20);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1, modifiers });
    await delay(150);
  };
  const key = async (keyCode, modifiers = []) => {
    keyCode = ({ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right'})[keyCode] || keyCode;
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter' && !modifiers.length) win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(40);
  };
  if (await js('!!window.YuandaDock')) {
    await mouseClick('#panels-toggle'); await mouseClick('#reset-workspace');
  }

  await check('real-double-click-opens-editor', async () => {
    await doubleClick('[data-node-id="regression-text"].design-node');
    await waitFor(() => js("document.activeElement?.classList.contains('inline-editor')"), '双击进入文本编辑');
    await key('A', ['control']); await win.webContents.insertText('真实双击修改成功'); await key('Enter', ['control']);
    await waitFor(() => engine.getSnapshot().pages[0].nodes.find(node => node.id === 'regression-text').text === '真实双击修改成功', '文字提交到引擎');
  });
  await key('Escape');
  await check('enter-opens-selected-text-editor',async()=>{
    await mouseClick('[data-node-id="regression-text"].design-node');await key('Enter');
    await waitFor(()=>js("document.activeElement?.classList.contains('inline-editor')"),'Enter进入编辑');await key('Escape');
  });
  await check('shift-resize-retains-aspect-ratio',async()=>{
    await mouseClick('[data-node-id="regression-text"].design-node');
    const original=engine.getSnapshot().pages[0].nodes.find(node=>node.id==='regression-text'),handle=await center('.resize-handle[data-handle="se"]');
    await dragMouse('.resize-handle[data-handle="se"]',{x:handle.x+85,y:handle.y+25},['shift']);
    const resized=engine.getSnapshot().pages[0].nodes.find(node=>node.id==='regression-text');assert(resized.width>original.width);assert(Math.abs(resized.width/resized.height-original.width/original.height)<.003);
    await key('Z',['control']);
  });
  await check('library-drag-then-real-double-click', async () => {
    const originalIds = new Set(engine.getSnapshot().pages[0].nodes.map(node => node.id));
    const drop = await js("(() => { const r=document.querySelector('#board').getBoundingClientRect(); return {x:Math.round(r.left+r.width*.60),y:Math.round(r.top+r.height*.32)}; })()");
    await dragMouse('.library-widget[data-library-type="text"]', drop);
    await waitFor(() => engine.getSnapshot().pages[0].nodes.some(node => !originalIds.has(node.id)), '元件库拖入文字');
    const inserted = engine.getSnapshot().pages[0].nodes.find(node => !originalIds.has(node.id));
    await doubleClick(`.design-node[data-node-id="${inserted.id}"]`);
    await waitFor(() => js("document.activeElement?.classList.contains('inline-editor')"), '新元件双击编辑');
    await key('A', ['control']); await win.webContents.insertText('元件库拖入后也可以编辑'); await key('Enter', ['control']);
    await waitFor(() => engine.getSnapshot().pages[0].nodes.find(node => node.id === inserted.id).text === '元件库拖入后也可以编辑', '拖入后文字保存');
  });
  await key('Escape');
  await check('ruler-drag-creates-guide', async () => {
    diagnostics.rulerBefore = await js('({view:window.YuandaTools.getView(),pageId:window.YuandaEditor.getPage()?.id})');
    const before = engine.getSnapshot().pages[0].guides.horizontal.length;
    const target = await center('#canvas-viewport');
    await dragMouse('#ruler-x', { x: target.x, y: target.y - 30 });
    await waitFor(() => engine.getSnapshot().pages[0].guides.horizontal.length === before + 1, '从标尺拖入参考线');
  });
  await check('guide-real-click-delete-removes-it',async()=>{
    assert(engine.getSnapshot().pages[0].guides.horizontal.length>0);
    const before=engine.getSnapshot().pages[0].guides.horizontal.length;
    await mouseClick('#guide-layer .canvas-guide.horizontal');
    await key('Delete');
    await waitFor(()=>engine.getSnapshot().pages[0].guides.horizontal.length===before-1,'选中后删除参考线');
  });
  await check('panel-drag-dock-float-resize-hide-reopen-restore', async () => {
    await dragMouse('[data-panel-id="library"] .panel-header h2', '#dock-right-bottom');
    assert.equal(await js("window.YuandaDock.getLayout().panels.library.zone"), 'right-bottom');
    const canvas = await center('#canvas-viewport');
    await dragMouse('[data-panel-id="library"] .panel-header h2', { x: canvas.x, y: canvas.y - 120 });
    assert.equal(await js("window.YuandaDock.getLayout().panels.library.mode"), 'float');
    const originalSize = await js("(() => {const r=document.querySelector('[data-panel-id=library]').getBoundingClientRect();return {x:Math.round(r.right-3),y:Math.round(r.bottom-3),width:r.width,height:r.height};})()");
    await dragMouse('[data-panel-id="library"] .panel-resize-handle', { x: originalSize.x + 35, y: originalSize.y + 35 });
    await delay(180);
    assert(await js(`window.YuandaDock.getLayout().panels.library.width > ${originalSize.width + 10}`), '浮动面板右下角可真实拖动缩放');
    await mouseClick('[data-panel-id="library"] [data-panel-hide]');
    assert.equal(await js("window.YuandaDock.getLayout().panels.library.hidden"), true);
    await mouseClick('#panels-toggle'); await mouseClick('[data-panel-menu="library"]');
    assert.equal(await js("document.querySelector('[data-panel-id=library]').hidden"), false);
    await delay(150);
    const saved = await js('window.YuandaDock.getLayout().panels.library');
    traces['panels-before-reload'] = await js('window.__inputTrace.splice(0)');
    errors.push(...await js('window.__uiErrors'));
    await win.webContents.reload();
    await waitFor(() => js("!!window.YuandaDock && !!document.querySelector('.library-widget')"), '重新载入布局');
    await installTrace();
    const restored = await js('window.YuandaDock.getLayout().panels.library');
    assert.deepEqual(restored, saved, '浮动位置与尺寸在重载后保持');
    await mouseClick('#panels-toggle');
    diagnostics.menuBeforeKey = await js("({focused:document.activeElement?.outerHTML,hidden:document.querySelector('#panels-menu').hidden})");
    await key('ArrowUp'); await key('Enter');
    diagnostics.menuAfterKey = await js("({focused:document.activeElement?.outerHTML,hidden:document.querySelector('#panels-menu').hidden})");
    assert.equal(await js("window.YuandaDock.getLayout().panels.library.mode"), 'dock');
    assert.equal(await js("window.YuandaDock.getLayout().panels.library.zone"), 'left-bottom');
    await mouseClick('[data-panel-id="notes"] [data-panel-hide]');
    assert.equal(await js("window.YuandaDock.getLayout().panels.notes.hidden"), true);
    await mouseClick('#panels-toggle');
    for (let count = 0; count < 6; count++) await key('ArrowDown');
    await key('Enter');
    assert.equal(await js("window.YuandaDock.getLayout().panels.notes.hidden"), false, '键盘菜单可以重新打开面板');
  });
  await check('real-agent-toggle-visible-and-operable', async () => {
    await mouseClick('#agent-toggle');
    assert.equal(await js("document.querySelector('#agent-panel').hidden"), false);
    const rect = await js("(() => { const r = document.querySelector('#agent-panel').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight};})()");
    assert(rect.top >= 0 && rect.bottom <= rect.viewport, `Agent面板超出可见窗口：${JSON.stringify(rect)}`);
    const before = engine.getSnapshot().pages[0].nodes.length;
    await mouseClick('#agent-example-card');
    assert.equal(await js("document.querySelector('#agent-apply').disabled"), false);
    await mouseClick('#agent-apply');
    await waitFor(() => engine.getSnapshot().pages[0].nodes.length === before + 3, '真实点击应用Agent修改');
    await mouseClick('#agent-close');
    assert.equal(await js("document.querySelector('#agent-panel').hidden"), true);
  });
  // A short window exposes clipped panels which programmatic .click() cannot detect.
  win.setSize(1100, 720); await delay(150);
  await check('agent-visible-at-minimum-window-size', async () => {
    if (await js("!document.querySelector('#agent-panel').hidden")) await mouseClick('#agent-close');
    await mouseClick('#agent-toggle');
    await center('#agent-apply');
    await center('#agent-close');
    await mouseClick('#agent-close');
  });
  errors.push(...await js('window.__uiErrors || []'));
  await delay(180);
  await writeFile(path.join(runtime, 'ui-regression.png'), (await win.webContents.capturePage()).toPNG());
  const result = { ok: checks.every(item => item.ok) && !errors.length, source, checks, traces, diagnostics, errors,
    coverage: '真实 Chromium 鼠标 down/up、clickCount 双击和键盘输入；fixture 使用生产文档引擎与 preload。未使用 DOM .click() 或手工 dispatchEvent 触发功能。' };
  await writeFile(path.join(runtime, output), JSON.stringify(result, null, 2));
  win.destroy(); app.exit(result.ok ? 0 : 1);
}
