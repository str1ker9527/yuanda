import { electronExecutable } from './platform-runtime.mjs';
/** Isolated offscreen Electron regression; all user interactions use trusted input. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.local', 'navigation-ui');
const report = path.join(runtime, 'result.json');
await mkdir(runtime, { recursive: true });
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process');
  await mkdir(path.join(root, '.local', 'tmp'), { recursive: true });
  const child = spawn(electronExecutable(root), [fileURLToPath(import.meta.url)], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: path.join(root, '.local', 'tmp'), TMP: path.join(root, '.local', 'tmp'), TMPDIR: path.join(root, '.local', 'tmp') } });
  const timer = setTimeout(() => { child.kill(); console.error('导航 UI 测试超过 80 秒'); }, 80000);
  child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
  child.on('exit', async code => { clearTimeout(timer); try { console.log(await readFile(report, 'utf8')); } catch {} process.exitCode = code || 0; });
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron');
  const runId = String(Date.now());
  app.setPath('userData', path.join(runtime, `profile-${runId}`)); app.setPath('sessionData', path.join(runtime, `browser-${runId}`)); app.setPath('logs', path.join(runtime, 'logs'));
  const checks = [], errors = [];
  void run().catch(async error => { await writeFile(report, JSON.stringify({ ok: false, checks, errors, fatal: error.stack }, null, 2)); app.exit(1); });
  async function run() {
    const { DocumentEngine, createBlankProject, makeNode } = await import('../app/core/document.mjs');
    const project = createBlankProject('导航实测'); project.id = 'navigation-regression'; project.pages[0].id = 'page-a'; project.pages[0].name = '首页'; project.pages[0].width = 1600; project.pages[0].height = 1200;
    project.pages[0].nodes = [makeNode('rectangle', { id: 'box-a', x: 80, y: 80, width: 160, height: 80, text: '测距 A' }), makeNode('rectangle', { id: 'box-b', x: 320, y: 80, width: 160, height: 80, text: '测距 B' })];
    const engine = new DocumentEngine(project);
    engine.apply([{ type: 'addPage', page: { id: 'page-b', name: '详情' } }, { type: 'addPage', page: { id: 'page-c', name: '设置' } }, { type: 'createComponent', pageId: 'page-a', nodeIds: ['box-a'], componentId: 'master-a', name: '卡片母版' }]);
    let selection = { pageId: 'page-a', nodeIds: [] }, win;
    const agent = { enabled: true, port: 0, requests: 0, connectionFile: '', cliPath: '' };
    const getState = () => ({ project: engine.getSnapshot(), revision: engine.revision, canUndo: engine.canUndo, canRedo: engine.canRedo, dirty: false, selection, agent, appVersion: 'test' });
    const emit = () => { const result = getState(); win.webContents.send('yuanda:state', result); return result; };
    const handlers = { getState, getAgentInfo: () => agent, setSelection: value => { selection = value; }, command: body => { engine.apply(body.commands, { expectedRevision: body.expectedRevision, label: body.label }); return emit(); }, undo: () => { engine.undo(); return emit(); }, redo: () => { engine.redo(); return emit(); } };
    for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(`yuanda:${name}`, async (_event, ...args) => { try { return { ok: true, value: await fn(...args) }; } catch (error) { return { ok: false, error: { message: error.message, code: error.code } }; } });
    await app.whenReady();
    win = new BrowserWindow({ width: 1480, height: 960, show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'app/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const reload = () => new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
    const wait = async (fn, label) => { const deadline = Date.now() + 4000; while (Date.now() < deadline) { if (await fn()) return; await delay(25); } throw new Error(`等待超时：${label}`); };
    const check = async (name, fn) => { try { await fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.stack }); await writeFile(path.join(runtime, `${name}-failure.png`), (await win.webContents.capturePage()).toPNG()); checks[checks.length-1].dialog=await js("(()=>{const d=document.querySelector('#navigation-settings');return d?{scrollTop:d.scrollTop,height:d.clientHeight,scrollHeight:d.scrollHeight,footer:document.querySelector('.navigation-setting-footer').getBoundingClientRect().toJSON()}:null})()"); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await delay(80); } };
    const rect = async selector => js(`(() => { const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('缺少 ${selector.replaceAll("'", '')}');const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
    const click = async selector => { const p = await rect(selector); assert(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${p.x},${p.y}))`), `目标被遮挡 ${selector}`); win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await delay(100); };
    const key = async (keyCode, modifiers = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(100); };
    const drag = async (selector, to) => { const from = await rect(selector); win.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y }); win.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 }); for (let step = 1; step <= 10; step++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * step / 10), y: Math.round(from.y + (to.y - from.y) * step / 10), button: 'left' }); await delay(20); } win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1 }); await delay(200); };
    await win.loadFile(path.join(root, 'app/renderer/index.html')); win.webContents.focus();
    await wait(() => js('!!window.YuandaNavigation && !!window.YuandaEditor.getState()'), '模块就绪');
    await delay(250);
    await check('page-drag-reparents-through-engine', async () => { await drag('[data-page-id="page-c"]', await rect('[data-page-id="page-a"]')); await wait(() => engine.getSnapshot().pages.find(item => item.id === 'page-c').parentId === 'page-a', '页面成为子页面'); });
    await check('page-keyboard-outdent-and-undo', async () => { await click('[data-page-id="page-c"] .page-name'); await key('Left', ['alt']); await wait(() => engine.getSnapshot().pages.find(item => item.id === 'page-c').parentId === null, '退出子页面'); await click('#undo'); await wait(() => engine.getSnapshot().pages.find(item => item.id === 'page-c').parentId === 'page-a', '页面层级撤销'); });
    await check('page-tabs-open-reorder-close', async () => {
      await click('[data-page-id="page-b"] .page-name'); await click('[data-page-id="page-a"] .page-name');
      await wait(() => js('window.YuandaNavigation.getTabs().length>=3'), '多页面标签');
      const to = await rect('[data-tab-key="page:page-a"]'); await drag('[data-tab-key="page:page-b"] .editor-tab-name', { x: to.left + 4, y: to.y });
      assert.equal((await js('window.YuandaNavigation.getTabs()'))[0], 'page:page-b');
      await click('[data-tab-key="page:page-b"] button'); assert(!(await js('window.YuandaNavigation.getTabs()')).includes('page:page-b'));
    });
    await check('gallery-search-opens-real-component-canvas', async () => {
      await click('#open-gallery'); await click('[aria-label="搜索页面或母版"]'); await win.webContents.insertText('卡片'); await delay(120);
      assert.equal(await js("document.querySelectorAll('.gallery-item').length"), 1);
      await click('[data-gallery-id="master-a"]'); await wait(() => js("window.YuandaEditor.getEditingTarget().kind==='component' && window.YuandaEditor.getEditingTarget().id==='master-a'"), '母版画布');
      assert(await js("!!document.querySelector('[data-tab-key=\"component:master-a\"]')")); assert(await js("document.querySelector('#navigation-gallery').hidden"));
    });
    await check('theme-toolbar-preferences-save-without-document-changes', async () => {
      const before = JSON.stringify(engine.getSnapshot()); await click('#workspace-settings');
      await click('[aria-label="编辑器外观"]'); await key('End'); await key('Enter');
      await wait(() => js("document.documentElement.dataset.editorTheme==='dark'"), '深色外观');
      await click('[aria-label="显示工具名称"]'); await click('[aria-label="显示 矩形"]');
      assert(await js("document.querySelector('.toolbar').classList.contains('hide-tool-labels')")); assert(await js("document.querySelector('[data-insert=rectangle]').hidden"));
      await click('[data-toolbar-key="insert:text"] button'); assert((await js('window.YuandaNavigation.getPreferences().toolbar')).indexOf('insert:text') < (await js('window.YuandaNavigation.getPreferences().toolbar')).indexOf('insert:rectangle'));
      assert.equal(JSON.stringify(engine.getSnapshot()), before);
      await key('Escape'); await reload(); await wait(() => js("!!window.YuandaNavigation && document.documentElement.dataset.editorTheme==='dark'"), '外观跨重载记忆'); assert(await js("document.querySelector('[data-insert=rectangle]').hidden"));
    });
    await check('utility-toolbar-hides-and-defaults-restore', async () => {
      await click('#workspace-settings');
      const dialog = await rect('#navigation-settings');
      win.webContents.sendInputEvent({ type: 'mouseWheel', x: dialog.x, y: dialog.y, deltaX: 0, deltaY: -400 }); await delay(500);
      await click('[aria-label="显示 Agent 工作台"]'); assert(await js("document.querySelector('#agent-toggle').hidden"));
      win.webContents.sendInputEvent({ type: 'mouseWheel', x: dialog.x, y: dialog.y, deltaX: 0, deltaY: -400 }); await delay(500);
      await click('.navigation-setting-footer button:first-child');
      assert(await js("!document.querySelector('#agent-toggle').hidden&&!document.querySelector('[data-insert=rectangle]').hidden&&!document.querySelector('.toolbar').classList.contains('hide-tool-labels')"));
      await key('Escape');
    });
    await check('alt-measures-document-gap-and-space-pans-without-moving-node', async () => {
      await click('[data-page-id="page-a"] .page-name');
      await js('window.YuandaEditor.setZoom(.8)'); await delay(100);
      await click('.design-node[data-node-id="box-a"]'); const b = await rect('.design-node[data-node-id="box-b"]');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: b.x, y: b.y }); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' }); await delay(100);
      assert(await js("[...document.querySelectorAll('#measure-overlay text')].some(t=>t.textContent==='80')"));
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' }); await delay(50); assert(await js("!document.querySelector('#measure-overlay')"));
      const before = JSON.stringify(engine.getSnapshot()), initial = await js('document.querySelector("#canvas-viewport").scrollLeft');
      await click('#page-breadcrumb'); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
      const v = await rect('#canvas-viewport'); await drag('#canvas-viewport', { x: v.x - 120, y: v.y - 60 }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' }); await delay(100);
      assert(await js(`document.querySelector('#canvas-viewport').scrollLeft>${initial}`)); assert.equal(JSON.stringify(engine.getSnapshot()), before);
    });
    await check('close-all-and-gallery-reopen', async () => { await click('#tab-actions'); await click('.navigation-menu button:last-child'); assert.deepEqual(await js('window.YuandaNavigation.getTabs()'), []); assert(await js("!document.querySelector('#navigation-gallery').hidden")); await click('[data-gallery-id="page-b"]'); assert.equal(await js('window.YuandaEditor.getEditingTarget().id'), 'page-b'); });
    await writeFile(path.join(runtime, 'workspace.png'), (await win.webContents.capturePage()).toPNG());
    await writeFile(report, JSON.stringify({ ok: checks.every(item => item.ok) && !errors.length, checks, errors }, null, 2)); win.destroy(); app.exit(checks.every(item => item.ok) && !errors.length ? 0 : 1);
  }
}
