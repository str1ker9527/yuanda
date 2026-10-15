import { electronExecutable } from './platform-runtime.mjs';
/** Real-input, isolated Electron regression for draft preservation and movement.
 * Run with Node: node scripts/test-edit-safety-ui.mjs
 * Production renderer/preload/core and authenticated loopback Agent HTTP are used.
 * Native close/save dialogs belong to the separate desktop shutdown regression.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.local', 'edit-safety-ui');
const report = path.join(runtime, 'result.json');
const runId = process.argv.find(value => value.startsWith('--run-id='))?.slice(9) || `${Date.now()}-${process.pid}`;
await mkdir(runtime, { recursive: true });

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process');
  const temporary = path.join(root, '.local', 'tmp'); await mkdir(temporary, { recursive: true });
  const child = spawn(electronExecutable(root), [fileURLToPath(import.meta.url), `--run-id=${runId}`], {
    cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary }
  });
  const timeout = setTimeout(() => { child.kill(); console.error('编辑保护 UI 测试超过 90 秒'); }, 90000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', async code => {
    clearTimeout(timeout);
    try {
      const result = JSON.parse(await readFile(report, 'utf8')); assert.equal(result.runId, runId, '测试结果必须来自本轮运行');
      console.log(JSON.stringify({ ok: result.ok, checks: result.checks.map(({ name, ok, error }) => ({ name, ok, ...(error ? { error } : {}) })), errors: result.errors, fatal: result.fatal, report }, null, 2));
      process.exitCode = code === 0 && result.ok ? 0 : 1;
    } catch (error) { console.error(`未生成本轮编辑保护 UI 测试结果：${error.message}`); process.exitCode = 1; }
  });
} else {
  const { app, BrowserWindow, ipcMain } = await import('electron');
  const { DocumentEngine, createBlankProject, makeNode } = await import('../app/core/document.mjs');
  const { startAgentServer, schema } = await import('../app/agent-server.mjs');
  const checks = [], errors = [];
  app.setPath('userData', path.join(runtime, `profile-${runId}`));
  app.setPath('sessionData', path.join(runtime, `browser-${runId}`));
  app.setPath('logs', path.join(runtime, 'logs'));
  app.on('window-all-closed', () => {}); // Each check destroys its isolated window.
  let win, currentApi;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label) => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { if (await predicate()) return; await delay(25); } throw new Error(`等待超时：${label}`); };
  const js = code => win.webContents.executeJavaScript(code);
  const screenshot = async name => { const file = path.join(runtime, `${name}.png`); await writeFile(file, (await win.webContents.capturePage()).toPNG()); return file; };
  const rect = async selector => js(`(() => { const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('找不到目标');const r=element.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),left:r.left,top:r.top,width:r.width,height:r.height}; })()`);
  async function click(selector, clickCount = 1) {
    const point = await rect(selector);
    assert(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`), `目标不可点击或被遮挡：${selector}`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount });
    await delay(70);
  }
  async function key(keyCode, modifiers = []) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(70);
  }
  async function typeDraft(value) {
    await click('.design-node[data-node-id="text-a"]', 1); await click('.design-node[data-node-id="text-a"]', 2);
    await wait(() => js('!!document.querySelector(".inline-editor")'), '真实双击打开文字编辑');
    await key('A', ['control']); await win.webContents.insertText(value);
    assert.equal(await js('document.querySelector(".inline-editor").value'), value);
  }
  async function saveDraftAsNew(value) {
    const selector = 'dialog[open] [aria-label="保留的文字草稿"]';
    await wait(() => js(`!!document.querySelector(${JSON.stringify(selector)})`), '保留草稿对话框');
    assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).value`), value);
    assert.equal(await js('JSON.parse(localStorage.getItem("yuanda.pendingTextDraft")).text'), value);
    const picture = await screenshot(`${checks.length}-retained-draft`);
    await click('dialog[open] .workspace-row button:nth-child(2)');
    await wait(() => js('!document.querySelector("dialog[open]")'), '保留为新文字完成');
    assert.equal(await js('localStorage.getItem("yuanda.pendingTextDraft")'), null); return picture;
  }
  function fixture(name) {
    const project = createBlankProject(`编辑保护 · ${name}`); project.id = `edit-safety-${name}`;
    Object.assign(project.pages[0], { id: 'page-home', name: '首页', width: 1200, height: 900 });
    project.pages[0].nodes = [
      makeNode('text', { id: 'text-a', x: 100, y: 90, width: 360, height: 56, text: '原来的文字', style: { fontSize: 24 } }),
      makeNode('text', { id: 'text-b', x: 550, y: 90, width: 250, height: 56, text: '另一个元件' }),
      makeNode('rectangle', { id: 'inner-a', x: 260, y: 380, width: 100, height: 50, text: '子元件 A' }),
      makeNode('rectangle', { id: 'inner-b', x: 400, y: 380, width: 100, height: 50, text: '子元件 B' }),
      makeNode('rectangle', { id: 'outer-child', x: 560, y: 500, width: 100, height: 50, text: '另一层内容' })
    ];
    const engine = new DocumentEngine(project);
    engine.apply([
      { type: 'addPage', page: { id: 'page-next', name: '第二页' } },
      { type: 'createDynamicPanel', pageId: 'page-home', panelId: 'inner-panel', nodeIds: ['inner-a', 'inner-b'] },
      { type: 'updateNode', pageId: 'page-home', nodeId: 'inner-panel', patch: { x: 230, y: 340, width: 310, height: 150 } },
      { type: 'groupNodes', pageId: 'page-home', nodeIds: ['inner-a', 'inner-b'], groupId: 'inside-group' },
      { type: 'createDynamicPanel', pageId: 'page-home', panelId: 'outer-panel', nodeIds: ['inner-panel', 'outer-child'] },
      { type: 'updateNode', pageId: 'page-home', nodeId: 'outer-panel', patch: { x: 180, y: 280, width: 540, height: 320 } }
    ]); return engine;
  }
  async function check(name, task) {
    const record = { name, ok: false }, engine = fixture(name); let server;
    checks.push(record);
    let selection = { pageId: 'page-home', nodeIds: [] };
    const connectionFile = path.join(runtime, `connection-${name}.json`), agent = { enabled: true, port: 0, requests: 0, connectionFile, cliPath: '' };
    const getState = () => ({ project: engine.getSnapshot(), revision: engine.revision, canUndo: engine.canUndo, canRedo: engine.canRedo, dirty: true, filePath: null, selection, agent, appVersion: 'test' });
    const emit = () => { const state = getState(); if (win && !win.isDestroyed()) win.webContents.send('yuanda:state', state); return state; };
    const command = body => { engine.apply(body.commands, { expectedRevision: body.expectedRevision, label: body.label }); return emit(); };
    currentApi = { getState, getAgentInfo: () => agent, getSchema: () => schema, setSelection: value => { selection = value; }, command, undo: () => { engine.undo(); return emit(); }, redo: () => { engine.redo(); return emit(); } };
    try {
      server = await startAgentServer({ connectionFile, getState, command, undo: currentApi.undo, redo: currentApi.redo, onActivity(value) { Object.assign(agent, value); emit(); } }); agent.port = server.port;
      const connection = JSON.parse(await readFile(connectionFile, 'utf8'));
      const remote = async commands => {
        const response = await fetch(`${connection.url}/v1/commands`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: engine.revision, label: '外部 Agent 实测', commands }) });
        const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
        await wait(() => js(`window.YuandaEditor.getState().revision===${engine.revision}`), 'Agent 广播抵达编辑器'); await delay(100);
      };
      win = new BrowserWindow({ width: 1480, height: 960, show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'app/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true, partition: `edit-safety-${runId}-${name}` } });
      win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push({ check: name, message }); });
      await win.loadFile(path.join(root, 'app/renderer/index.html')); win.webContents.focus();
      await wait(() => js('!!window.YuandaMovement && !!window.YuandaNavigation && !!window.YuandaEditor.getState()'), '生产编辑器就绪'); await delay(180);
      await js("window.__safetyTrace=[];for(const type of ['pointerdown','pointerup','dblclick','keydown','input'])document.addEventListener(type,event=>window.__safetyTrace.push({type,key:event.key||'',target:event.target.id||event.target.dataset.nodeId||event.target.className,trusted:event.isTrusted}),true)");
      record.details = await task({ engine, remote, emit });
      record.screenshot = await screenshot(`${name}-passed`); record.ok = true;
    } catch (error) { record.error = error.stack; if (win && !win.isDestroyed()) record.screenshot = await screenshot(`${name}-failure`); }
    finally {
      if (win && !win.isDestroyed()) { record.inputTrace = await js('window.__safetyTrace||[]').catch(() => []); win.destroy(); win = null; }
      await server?.close();
    }
  }
  void run().catch(async error => { await writeFile(report, JSON.stringify({ ok: false, runId, checks, errors, fatal: error.stack }, null, 2)); app.exit(1); });
  async function run() {
    for (const name of ['getState', 'getAgentInfo', 'getSchema', 'setSelection', 'command', 'undo', 'redo']) ipcMain.handle(`yuanda:${name}`, async (_event, ...args) => { try { return { ok: true, value: await currentApi[name](...args) }; } catch (error) { return { ok: false, error: { message: error.message, code: error.code } }; } });
    await app.whenReady();
    const find = (engine, id) => engine.getSnapshot().pages.flatMap(page => page.nodes).find(node => node.id === id);
    await check('unrelated-agent-edit-preserves-draft', async ({ engine, remote }) => {
      const draft = '人工输入仍然保留'; await typeDraft(draft);
      await remote([{ type: 'updateNode', pageId: 'page-home', nodeId: 'text-b', patch: { text: 'Agent 修改别处' } }, { type: 'renameProject', name: 'Agent 改项目名称' }]);
      assert.equal(await js('document.querySelector(".inline-editor").value'), draft); assert.equal(await js('document.activeElement.className'), 'inline-editor');
      await key('Enter', ['control']); await wait(() => find(engine, 'text-a').text === draft, 'Ctrl Enter 提交草稿');
      assert.equal(find(engine, 'text-b').text, 'Agent 修改别处'); assert.equal(engine.getSnapshot().name, 'Agent 改项目名称');
      assert.equal(await js('!!document.querySelector("dialog[open]")'), false); return { committed: draft, remoteEdit: 'preserved' };
    });
    await check('same-node-conflict-keeps-both-versions', async ({ engine, remote }) => {
      const draft = '人工版本需要留下'; await typeDraft(draft);
      await remote([{ type: 'updateNode', pageId: 'page-home', nodeId: 'text-a', patch: { text: 'Agent 的新版本' } }]);
      assert.equal(await js('document.querySelector(".inline-editor").value'), draft); await key('Enter', ['control']);
      const conflictScreenshot = await saveDraftAsNew(draft);
      assert.equal(find(engine, 'text-a').text, 'Agent 的新版本'); assert(engine.getSnapshot().pages[0].nodes.some(node => node.id !== 'text-a' && node.text === draft));
      return { conflictScreenshot, bothVersions: ['Agent 的新版本', draft] };
    });
    await check('deleted-node-preserves-draft-as-new-text', async ({ engine, remote }) => {
      const draft = '原元件删除后还在的输入'; await typeDraft(draft);
      await remote([{ type: 'removeNodes', pageId: 'page-home', nodeIds: ['text-a'] }]);
      assert.equal(await js('document.querySelector(".inline-editor").value'), draft); await key('Enter', ['control']);
      const conflictScreenshot = await saveDraftAsNew(draft); assert.equal(find(engine, 'text-a'), undefined); assert(engine.getSnapshot().pages[0].nodes.some(node => node.text === draft)); return { conflictScreenshot, recovered: draft };
    });
    await check('removed-page-preserves-draft-on-surviving-page', async ({ engine, remote }) => {
      const draft = '原页面删除后恢复到第二页'; await typeDraft(draft);
      await remote([{ type: 'removePage', pageId: 'page-home' }]);
      assert.equal(await js('window.YuandaEditor.getEditingTarget().id'), 'page-next');
      assert.equal(await js('document.querySelector(".inline-editor").value'), draft); await key('Enter', ['control']);
      const conflictScreenshot = await saveDraftAsNew(draft); assert(engine.getSnapshot().pages.find(page => page.id === 'page-next').nodes.some(node => node.text === draft)); return { conflictScreenshot, recoveredPage: 'page-next' };
    });
    await check('replaced-project-retains-displaced-draft', async ({ engine, emit }) => {
      const draft = '切换项目时尚未提交的输入'; await typeDraft(draft);
      const next = createBlankProject('切换后的项目'); next.id = 'replacement-project'; next.pages[0].id = 'replacement-page';
      engine.replace(next); emit();
      const conflictScreenshot = await saveDraftAsNew(draft); assert.equal(engine.getSnapshot().id, 'replacement-project'); assert(engine.getSnapshot().pages[0].nodes.some(node => node.text === draft)); return { conflictScreenshot, recoveredProject: 'replacement-project', note: '项目替换使用真实 engine.replace 与生产状态广播；其余冲突使用真实 Agent HTTP。' };
    });
    await check('nested-group-container-drag-moves-once-and-undoes-once', async ({ engine }) => {
      const before = engine.getSnapshot(), beforeRevision = engine.revision;
      const bounds = await rect('.design-node[data-node-id="outer-panel"]'), from = { x: Math.round(bounds.left + 22), y: Math.round(bounds.top + 18) }, to = { x: from.x + 72, y: from.y + 45 };
      assert.equal(await js(`document.elementFromPoint(${from.x},${from.y})?.closest('.design-node')?.dataset.nodeId`), 'outer-panel', '拖动起点必须命中父面板');
      win.webContents.sendInputEvent({ type: 'mouseMove', ...from }); win.webContents.sendInputEvent({ type: 'mouseDown', ...from, button: 'left', clickCount: 1 });
      for (let step = 1; step <= 12; step++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * step / 12), y: Math.round(from.y + (to.y - from.y) * step / 12), button: 'left' }); await delay(20); }
      win.webContents.sendInputEvent({ type: 'mouseUp', ...to, button: 'left', clickCount: 1 });
      await wait(() => engine.revision > beforeRevision, '真实拖动提交'); assert.equal(engine.revision, beforeRevision + 1, '拖动只有一个事务');
      const old = id => before.pages[0].nodes.find(node => node.id === id), after = engine.getSnapshot(), moved = id => after.pages[0].nodes.find(node => node.id === id);
      const dx = moved('outer-panel').x - old('outer-panel').x, dy = moved('outer-panel').y - old('outer-panel').y;
      assert(dx > 0 && dy > 0); const offsets = {};
      for (const id of ['outer-panel', 'inner-panel', 'inner-a', 'inner-b', 'outer-child']) { offsets[id] = { x: moved(id).x - old(id).x, y: moved(id).y - old(id).y }; assert(Math.abs(offsets[id].x - dx) < .001 && Math.abs(offsets[id].y - dy) < .001, `${id} 不应重复位移`); }
      const movedScreenshot = await screenshot('nested-group-container-after-drag');
      await click('#undo'); await wait(() => engine.revision === beforeRevision + 2, '一次撤销'); assert.deepEqual(engine.getSnapshot(), before);
      return { movedScreenshot, offsets, oneUndoRestoresOriginal: true };
    });
    const ok = checks.every(check => check.ok) && !errors.length;
    await writeFile(report, JSON.stringify({ ok, runId, checks, errors, coverage: '隐藏 offscreen Electron；生产 renderer/preload/文档引擎。人类操作只使用可信鼠标键盘输入；Agent 冲突通过带令牌回环 HTTP；DOM 仅用于读取、定位和事件记录。所有 fixture、连接文件、截图和测试运行数据仅位于项目 .local/edit-safety-ui。' }, null, 2));
    app.exit(ok ? 0 : 1);
  }
}
