/** Real pointer/keyboard page-tree regression in a new, isolated Electron profile.
 * Production renderer/preload, DocumentEngine, Agent HTTP and HTML exporter are used.
 * Native file pickers are replaced only with fixed paths inside this test run.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { electronExecutable, projectEnvironment } from './platform-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local', 'page-folders-ui');
const script = fileURLToPath(import.meta.url);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!process.versions.electron) {
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(path.join(output, 'run-'));
  const preflight = { platform: process.platform, arch: process.arch, node: process.versions.node };
  let result;
  try {
    for (const relative of ['app/preload.cjs', 'app/renderer/index.html', 'app/renderer/navigation-tools.js', 'app/core/document.mjs', 'app/core/html-export.mjs', 'app/agent-server.mjs']) await access(path.join(root, relative));
    const electron = electronExecutable(root);
    await access(electron);
    preflight.electronPackage = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
    preflight.projectVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    const probe = path.join(directory, 'write-probe.txt');
    await writeFile(probe, 'isolated page folders test', { flag: 'wx' });
    assert.equal(await readFile(probe, 'utf8'), 'isolated page folders test');
    preflight.localRuntimeAndWritableDirectory = true;
    await writeFile(path.join(directory, 'preflight.json'), JSON.stringify(preflight, null, 2));
    const { spawn } = await import('node:child_process');
    const env = projectEnvironment(root, directory); delete env.ELECTRON_RUN_AS_NODE;
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(electron, [script, '--output', directory], { cwd: root, windowsHide: true, stdio: 'inherit', env });
      const timer = setTimeout(() => child.kill(), 120000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
    });
    result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'));
    result = { ...result, directory, exitCode, preflight, ok: result.ok && exitCode === 0 };
  } catch (error) {
    result = { ok: false, directory, preflight, error: error.stack };
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, checks: result.checks?.map(({ name, ok, trustedInputEvents }) => ({ name, ok, trustedInputEvents: trustedInputEvents?.length })), inputDiagnostics: result.ok ? { recordedSteps: result.inputDiagnostics?.length ?? 0 } : result.inputDiagnostics, report: path.join(directory, 'result.json') }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} else void (async () => {
  const { app, BrowserWindow, ipcMain } = await import('electron');
  const directory = process.argv[process.argv.indexOf('--output') + 1];
  assert(directory && path.resolve(directory).startsWith(path.resolve(output) + path.sep), 'An isolated test output directory is required');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.setPath('userData', path.join(directory, 'profile'));
  app.setPath('sessionData', path.join(directory, 'session'));
  app.setPath('logs', path.join(directory, 'logs'));
  app.on('window-all-closed', () => {});
  let editor, preview, server;
  const checks = [], errors = [], fileCalls = [], inputDiagnostics = [];
  const js = (code, win = editor) => win.webContents.executeJavaScript(code);
  const wait = async (predicate, label, timeout = 5000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await predicate()) return; await delay(25); }
    throw new Error(`Timed out: ${label}`);
  };
  const snapshot = async name => {
    if (!editor || editor.isDestroyed()) return null;
    const file = path.join(directory, `${name}.png`);
    await writeFile(file, (await editor.webContents.capturePage()).toPNG()); return file;
  };
  async function rect(selector, win = editor) {
    return js(`(() => {const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Missing input target: '+${JSON.stringify(selector)});const r=element.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()`, win);
  }
  async function click(selector, { button = 'left', win = editor } = {}) {
    const point = await rect(selector, win);
    assert(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`, win), `Input target is covered: ${selector}`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: point.x, y: point.y, button, clickCount: 1 });
    await delay(85);
  }
  async function key(keyCode, modifiers = [], win = editor) {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await delay(85);
  }
  async function type(selector, value) {
    await click(selector); await key('A', [process.platform === 'darwin' ? 'meta' : 'control']);
    await editor.webContents.insertText(value); await delay(40);
    assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).value`), value);
  }
  async function choose(selector, value) {
    const values = await js(`[...document.querySelector(${JSON.stringify(selector)}).options].map(option=>option.value)`);
    const index = values.indexOf(value); assert(index >= 0, `Selectable value missing: ${value}`);
    const trace = async action => inputDiagnostics.push({ selector, requestedValue: value, action, ...await js(`({value:document.querySelector(${JSON.stringify(selector)})?.value,activeId:document.activeElement?.id,activeTag:document.activeElement?.tagName,revision:YuandaEditor.getState().revision})`) });
    await click(selector); await trace('click'); await key('Home'); await trace('Home');
    for (let step = 0; step < index; step++) { await key('Down'); await trace('Down'); }
    await key('Enter'); await trace('Enter'); await key('Tab');
    await wait(() => js(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`), 'selected parent displayed');
  }
  async function drag(selector, destination, during = null) {
    const from = await rect(selector), to = typeof destination === 'string' ? await rect(destination) : destination;
    editor.webContents.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y });
    editor.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step++) {
      editor.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * step / 12), y: Math.round(from.y + (to.y - from.y) * step / 12), button: 'left' });
      await delay(18);
      if (step === 6 && during) await during();
    }
    editor.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1 });
    await delay(180);
  }
  const row = id => `.page-row[data-tree-id="${id}"]`;
  const rowName = id => `${row(id)} .page-name`;
  async function contextAction(id, action) {
    await click(rowName(id), { button: 'right' });
    await wait(() => js('!!document.querySelector("#page-tree-menu")'), 'real context menu');
    await click(`#page-tree-menu [data-tree-action="${action}"]`);
  }
  async function nameDialog(value) {
    await wait(() => js('!!document.querySelector("#page-tree-name-dialog")'), 'name dialog');
    await type('#page-tree-name', value); await click('#page-tree-name-save');
    await wait(() => js('!document.querySelector("#page-tree-name-dialog")'), 'name committed');
  }
  async function check(name, task) {
    const entry = { name, ok: false }; checks.push(entry);
    await writeFile(path.join(directory, 'progress.json'), JSON.stringify({ checks, current: name }, null, 2));
    const before = await js('window.__pageTreeTrusted.length');
    await task();
    entry.trustedInputEvents = await js(`window.__pageTreeTrusted.slice(${before})`);
    assert(entry.trustedInputEvents.every(event => event.trusted), 'All simulated input must be browser-trusted');
    entry.ok = true;
  }
  try {
    const { DocumentEngine, createBlankProject, makeNode } = await import('../app/core/document.mjs');
    const { startAgentServer, schema } = await import('../app/agent-server.mjs');
    const { exportHtml } = await import('../app/core/html-export.mjs');
    const project = createBlankProject('页面文件夹独立验收');
    project.id = 'page-folder-ui-regression';
    Object.assign(project.pages[0], { id: 'home-page', name: '默认首页', width: 1000, height: 700 });
    project.pages[0].nodes = [makeNode('text', { id: 'home-title', x: 60, y: 60, width: 360, height: 60, text: '默认首页内容' })];
    const engine = new DocumentEngine(project);
    let selection = { pageId: 'home-page', nodeIds: [] }, saved = '', filePath = null;
    const projectFile = path.join(directory, 'page-folders.yuanda'), htmlFile = path.join(directory, 'page-folders.html');
    const agent = { enabled: true, requests: 0, port: null, connectionFile: path.join(directory, 'connection.json'), cliPath: '' };
    const getState = () => ({ project: engine.getSnapshot(), revision: engine.revision, canUndo: engine.canUndo, canRedo: engine.canRedo, dirty: JSON.stringify(engine.getSnapshot()) !== saved, filePath, selection, agent, appVersion: 'page-folder-test' });
    const emit = () => { const state = getState(); if (editor && !editor.isDestroyed()) editor.webContents.send('yuanda:state', state); return state; };
    const command = body => { engine.apply(body.commands, { expectedRevision: body.expectedRevision, label: body.label }); return emit(); };
    const saveProject = async () => { const state = engine.getSnapshot(); await writeFile(projectFile, JSON.stringify(state, null, 2)); saved = JSON.stringify(state); filePath = projectFile; fileCalls.push('save'); return emit(); };
    const handlers = {
      getState, getSchema: () => schema, getAgentInfo: () => agent,
      setSelection: value => { selection = value; }, command,
      undo: () => { engine.undo(); return emit(); }, redo: () => { engine.redo(); return emit(); },
      saveProject, saveProjectAs: saveProject,
      openProject: async () => { engine.replace(JSON.parse(await readFile(projectFile, 'utf8'))); saved = JSON.stringify(engine.getSnapshot()); filePath = projectFile; selection = { pageId: null, nodeIds: [] }; fileCalls.push('open'); return emit(); },
      exportHtml: async () => { await writeFile(htmlFile, exportHtml(engine.getSnapshot())); fileCalls.push('html'); return { ok: true, path: htmlFile }; },
      libraryList: () => ({ libraries: [], errors: [] })
    };
    for (const [name, fn] of Object.entries(handlers)) ipcMain.handle(`yuanda:${name}`, async (_event, ...args) => {
      try { return { ok: true, value: await fn(...args) }; } catch (error) { return { ok: false, error: { message: error.message, code: error.code } }; }
    });
    await app.whenReady();
    server = await startAgentServer({ connectionFile: agent.connectionFile, getState, command, undo: handlers.undo, redo: handlers.redo, onActivity: value => { Object.assign(agent, value); emit(); } });
    agent.port = server.port;
    const connection = JSON.parse(await readFile(agent.connectionFile, 'utf8'));
    const headers = { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' };
    const remote = async (commands, expectedRevision = engine.revision) => {
      const response = await fetch(`${connection.url}/v1/commands`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision, commands }) });
      const body = await response.json(); return { status: response.status, body };
    };
    const preferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false };
    editor = new BrowserWindow({ width: 1480, height: 1040, show: false, webPreferences: { ...preferences, preload: path.join(root, 'app/preload.cjs') } });
    editor.removeMenu();
    const observe = (win, label) => win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push({ surface: label, message }); });
    observe(editor, 'editor');
    await editor.loadFile(path.join(root, 'app/renderer/index.html')); editor.webContents.focus();
    await wait(() => js('!!window.YuandaNavigation?.renderPages&&!!window.YuandaEditor.getState()'), 'page-folder UI implementation');
    await delay(250);
    await js("window.__pageTreeTrusted=[];for(const type of ['pointerdown','pointerup','keydown','input','contextmenu'])document.addEventListener(type,event=>__pageTreeTrusted.push({type,trusted:event.isTrusted}),true);void 0");
    const state = () => engine.getSnapshot();
    const target = () => js('window.YuandaEditor.getEditingTarget()');
    const visibleRows = () => js('[...document.querySelectorAll("#page-list [data-tree-id]")].map(row=>row.dataset.treeId)');
    const folders = () => state().pageFolders;
    const page = id => state().pages.find(item => item.id === id);
    const folder = id => folders().find(item => item.id === id);
    const mixedOrder = () => state().pageTreeOrder;
    let productFolder, approvalFolder, detailPage, helpPage;

    await check('mouse-creates-folder-without-changing-canvas-or-tabs', async () => {
      const beforeTarget = await target(), beforeTabs = await js('YuandaNavigation.getTabs()');
      await click('#add-page-folder'); await nameDialog('产品区');
      await wait(() => folders()?.length === 1, 'new folder committed');
      productFolder = folders()[0].id;
      assert.equal(folder(productFolder).name, '产品区'); assert.equal(folder(productFolder).parentId, null);
      assert.deepEqual(await target(), beforeTarget); assert.deepEqual(await js('YuandaNavigation.getTabs()'), beforeTabs);
      assert.equal(await js(`document.querySelector(${JSON.stringify(row(productFolder))}).dataset.treeKind`), 'folder');
      assert.equal(state().pages.length, 1, 'A folder must not be a fake canvas page');
    });
    await check('context-creates-real-child-page-and-renames-it-with-keyboard-input', async () => {
      await contextAction(productFolder, 'add-page');
      await wait(() => state().pages.length === 2, 'child page created');
      detailPage = state().pages.find(item => item.id !== 'home-page').id;
      assert.equal(page(detailPage).parentId, productFolder);
      await contextAction(detailPage, 'rename'); await nameDialog('订单详情');
      assert.equal(page(detailPage).name, '订单详情');
      await click(rowName(detailPage)); assert.equal((await target()).id, detailPage);
      await click('[data-insert="text"]');
      await wait(() => page(detailPage).nodes.length === 1, 'real child page accepts canvas content');
      assert.equal(page('home-page').nodes.length, 1, 'Editing the child must not edit the previous page');
    });
    await check('nested-folder-rename-and-persistent-collapse-preserve-current-page', async () => {
      await contextAction(productFolder, 'add-folder'); await nameDialog('审批草稿');
      approvalFolder = folders().find(item => item.id !== productFolder).id;
      assert.equal(folder(approvalFolder).parentId, productFolder);
      await contextAction(approvalFolder, 'rename'); await nameDialog('审批区');
      assert.equal(folder(approvalFolder).name, '审批区');
      await click(rowName(detailPage)); const beforeTarget = await target(), beforeTabs = await js('YuandaNavigation.getTabs()');
      await click(rowName(productFolder));
      assert.deepEqual(await target(), beforeTarget); assert.deepEqual(await js('YuandaNavigation.getTabs()'), beforeTabs);
      await click(`${row(productFolder)} [data-page-tree-toggle]`);
      await wait(() => folder(productFolder).collapsed === true, 'folder collapse enters document model');
      assert(!(await visibleRows()).includes(detailPage)); assert(!(await visibleRows()).includes(approvalFolder));
      assert.deepEqual(await target(), beforeTarget);
      await click(rowName(productFolder)); await key('Right');
      await wait(() => folder(productFolder).collapsed === false, 'keyboard expands selected folder');
      assert((await visibleRows()).includes(detailPage)); assert((await visibleRows()).includes(approvalFolder));
      assert(!((await js('YuandaNavigation.getTabs()')).some(value => value.endsWith(productFolder))));
    });
    await check('pointer-and-keyboard-reparent-and-reorder-real-tree-items', async () => {
      await drag(rowName(detailPage), row(approvalFolder));
      await wait(() => page(detailPage).parentId === approvalFolder, 'drag page into nested folder');
      await click(rowName(detailPage)); await key('Left', ['alt']);
      await wait(() => page(detailPage).parentId === productFolder, 'Alt Left outdents page');
      assert(mixedOrder().indexOf(detailPage) > mixedOrder().indexOf(approvalFolder));
      await key('Up', ['alt']);
      await wait(() => mixedOrder().indexOf(detailPage) < mixedOrder().indexOf(approvalFolder), 'Alt Up reorders siblings');
      await key('Down', ['alt']);
      await wait(() => mixedOrder().indexOf(detailPage) > mixedOrder().indexOf(approvalFolder), 'Alt Down reorders siblings');
      await key('Right', ['alt']);
      await wait(() => page(detailPage).parentId === approvalFolder, 'Alt Right indents into preceding folder');
      await key('Left', [process.platform === 'darwin' ? 'meta' : 'control']);
      await wait(() => page(detailPage).parentId === productFolder, 'Ctrl or Cmd Left supports host shortcut alternative');
      await drag(rowName(detailPage), row(approvalFolder));
      await wait(() => page(detailPage).parentId === approvalFolder, 'restore nested child');
      const home = await rect(row('home-page'));
      await drag(rowName(productFolder), { x: home.x, y: home.top + 2 });
      await wait(() => mixedOrder()[0] === productFolder, 'move complete branch before home');
      assert.equal(folder(approvalFolder).parentId, productFolder); assert.equal(page(detailPage).parentId, approvalFolder);
      assert.equal(state().pages[0].id, 'home-page', 'Mixed tree order must be independent of legacy real-page array order');
    });
    await check('cycle-drop-keeps-document-and-visible-tree-unchanged', async () => {
      const before = state(), revision = engine.revision, rows = await visibleRows();
      await drag(rowName(productFolder), row(detailPage));
      assert.equal(engine.revision, revision); assert.deepEqual(state(), before); assert.deepEqual(await visibleRows(), rows);
    });
    await check('page-tools-parent-dropdown-displays-folder-and-accepts-real-page-or-folder', async () => {
      await click(rowName(detailPage));
      await wait(() => js(`document.querySelector('#page-tools-target')?.dataset.treeId===${JSON.stringify(detailPage)}`), 'tools target current real page');
      assert.equal(await js('document.querySelector("#page-tree-parent").value'), approvalFolder);
      const options = await js('[...document.querySelector("#page-tree-parent").options].map(option=>option.value)');
      assert(options.includes(productFolder)); assert(options.includes(approvalFolder)); assert(options.includes('home-page')); assert(!options.includes(detailPage));
      await choose('#page-tree-parent', productFolder);
      await wait(() => page(detailPage).parentId === productFolder, 'select parent folder');
      await choose('#page-tree-parent', 'home-page');
      await wait(() => page(detailPage).parentId === 'home-page', 'select parent real page');
      await choose('#page-tree-parent', approvalFolder);
      await wait(() => page(detailPage).parentId === approvalFolder, 'restore nested parent');
      assert.equal((await target()).id, detailPage); assert.equal(state().pages.length, 2);
    });
    await check('folder-tools-identify-target-and-exclude-self-and-all-descendants', async () => {
      await click(rowName(productFolder));
      await wait(() => js(`document.querySelector('#page-tools-target')?.dataset.treeId===${JSON.stringify(productFolder)}`), 'tools target selected folder');
      assert.match(await js('document.querySelector("#page-tools-target").textContent'), /文件夹.*产品区/);
      const options = await js('[...document.querySelector("#page-tree-parent").options].map(option=>option.value)');
      for (const forbidden of [productFolder, approvalFolder, detailPage]) assert(!options.includes(forbidden), 'A self/descendant cycle target cannot be selected');
      assert(options.includes('home-page')); assert(options.includes(''));
      assert.equal(await js('document.querySelector("#page-tree-parent").value'), '');
      await choose('#page-tree-parent', 'home-page');
      await wait(() => folder(productFolder).parentId === 'home-page', 'folder can be a child of a real page');
      assert.equal(folder(approvalFolder).parentId, productFolder); assert.equal(page(detailPage).parentId, approvalFolder);
      assert.equal((await target()).id, detailPage, 'Changing the selected folder must not replace the current canvas');
      await choose('#page-tree-parent', '');
      await wait(() => folder(productFolder).parentId === null, 'folder returns to top level');
      await click(rowName(detailPage));
    });
    await check('page-tools-up-down-reorder-only-mixed-siblings-and-preserve-parentage', async () => {
      await wait(() => js(`document.querySelector('#page-tools-target')?.dataset.treeId===${JSON.stringify(detailPage)}`), 'tools target child page');
      assert(await js('document.querySelector("#page-tree-move-up").disabled&&document.querySelector("#page-tree-move-down").disabled'), 'An only child has no sibling move');
      await choose('#page-tree-parent', productFolder);
      const beforeParents = [...state().pages, ...folders()].map(item => [item.id, item.parentId]);
      const otherOrder = mixedOrder().filter(id => ![detailPage, approvalFolder].includes(id));
      assert(mixedOrder().indexOf(detailPage) < mixedOrder().indexOf(approvalFolder));
      await click('#page-tree-move-down');
      await wait(() => mixedOrder().indexOf(approvalFolder) < mixedOrder().indexOf(detailPage), 'page crosses sibling folder downward');
      assert.deepEqual(mixedOrder().filter(id => ![detailPage, approvalFolder].includes(id)), otherOrder);
      assert.deepEqual([...state().pages, ...folders()].map(item => [item.id, item.parentId]).sort(), beforeParents.sort());
      await click('#page-tree-move-up');
      await wait(() => mixedOrder().indexOf(detailPage) < mixedOrder().indexOf(approvalFolder), 'page crosses sibling folder upward');
      await choose('#page-tree-parent', approvalFolder);
      await click(rowName(productFolder));
      await wait(() => js(`document.querySelector('#page-tools-target')?.dataset.treeId===${JSON.stringify(productFolder)}`), 'tools target folder before sibling reorder');
      if (mixedOrder().indexOf(productFolder) > mixedOrder().indexOf('home-page')) {
        await click('#page-tree-move-up');
        await wait(() => mixedOrder().indexOf(productFolder) < mixedOrder().indexOf('home-page'), 'place folder first using sibling control');
      }
      assert.equal(await js('document.querySelector("#page-tree-move-up").disabled'), true);
      await click('#page-tree-move-down');
      await wait(() => mixedOrder().indexOf(productFolder) > mixedOrder().indexOf('home-page'), 'folder crosses sibling page downward');
      assert.equal(folder(productFolder).parentId, null); assert.equal(folder(approvalFolder).parentId, productFolder); assert.equal(page(detailPage).parentId, approvalFolder);
      await click('#page-tree-move-up');
      await wait(() => mixedOrder()[0] === productFolder, 'folder restored above home');
      assert.equal((await target()).id, detailPage); await click(rowName(detailPage));
    });
    await check('header-add-page-remains-real-and-gallery-excludes-folders', async () => {
      await click(rowName('home-page')); await click('#add-page');
      await wait(() => state().pages.length === 3, 'header creates a real page');
      helpPage = state().pages.find(item => !['home-page', detailPage].includes(item.id)).id;
      assert.equal(page(helpPage).parentId, null);
      await contextAction(helpPage, 'rename'); await nameDialog('帮助页');
      await click('#open-gallery');
      const ids = await js('[...document.querySelectorAll(".gallery-item[data-gallery-kind=page]")].map(item=>item.dataset.galleryId)');
      assert.deepEqual(new Set(ids), new Set(state().pages.map(item => item.id)));
      assert(!ids.includes(productFolder)); assert(!ids.includes(approvalFolder));
      await click(`[data-gallery-id="${detailPage}"]`);
      assert.equal((await target()).id, detailPage);
      assert.equal(await js('document.querySelector("#navigation-gallery").hidden'), true);
    });
    await check('recursive-delete-cancel-confirm-and-single-undo-restore-entire-branch', async () => {
      await click(rowName(detailPage)); const before = state(), revision = engine.revision;
      await contextAction(productFolder, 'delete');
      await wait(() => js('!!document.querySelector("#page-tree-delete-dialog[open]")'), 'recursive deletion confirmation');
      assert.match(await js('document.querySelector("#page-tree-delete-dialog").textContent'), /产品区/);
      await click('[data-page-tree-delete-cancel]');
      assert.equal(engine.revision, revision); assert.deepEqual(state(), before); assert.equal((await target()).id, detailPage);
      await contextAction(productFolder, 'delete'); await click('[data-page-tree-delete-confirm]');
      await wait(() => !folder(productFolder), 'branch deleted');
      assert.equal(folder(approvalFolder), undefined); assert.equal(page(detailPage), undefined);
      assert.equal(state().pages.length, 2); assert(page((await target()).id), 'Selection falls back to a surviving real page');
      assert.equal(engine.revision, revision + 1, 'Recursive branch deletion is one document transaction');
      await click('#undo');
      await wait(() => !!folder(productFolder) && !!folder(approvalFolder) && !!page(detailPage), 'single undo restores descendants');
      assert.deepEqual(state(), before);
      await click(rowName(detailPage)); assert.equal((await target()).id, detailPage);
    });
    await check('agent-change-cancels-in-progress-drag-without-stale-reparent', async () => {
      const beforeParent = page(detailPage).parentId, beforeOrder = mixedOrder();
      let remoteRevision;
      await drag(rowName(detailPage), row('home-page'), async () => {
        assert.equal((await remote([{ type: 'renameProject', name: 'Agent 在拖动中更新项目' }])).status, 200);
        remoteRevision = engine.revision;
        await wait(() => js('!document.querySelector(".navigation-drag-label")'), 'Agent update cancels active drag');
      });
      assert.equal(engine.revision, remoteRevision);
      assert.equal(page(detailPage).parentId, beforeParent); assert.deepEqual(mixedOrder(), beforeOrder);
    });
    await check('agent-change-closes-stale-page-tree-context-menu', async () => {
      await click(rowName(productFolder), { button: 'right' });
      assert(await js('!!document.querySelector("#page-tree-menu")'));
      assert.equal((await remote([{ type: 'renameProject', name: 'Agent 在菜单打开时更新项目' }])).status, 200);
      await wait(() => js('!document.querySelector("#page-tree-menu")'), 'stale context menu dismissed');
    });
    await check('stale-rename-dialog-does-not-overwrite-agent-change', async () => {
      await contextAction(approvalFolder, 'rename'); await type('#page-tree-name', '陈旧窗口名称');
      assert.equal((await remote([{ type: 'updatePageFolder', folderId: approvalFolder, patch: { name: 'Agent 更新审批区' } }])).status, 200);
      const revision = engine.revision;
      await click('#page-tree-name-save');
      assert.equal(engine.revision, revision); assert.equal(folder(approvalFolder).name, 'Agent 更新审批区');
      await key('Escape');
    });
    await check('stale-recursive-delete-confirm-does-not-remove-agent-edits', async () => {
      await contextAction(productFolder, 'delete');
      assert.equal((await remote([{ type: 'updatePage', pageId: detailPage, patch: { annotation: 'Agent 编辑必须保留' } }])).status, 200);
      const revision = engine.revision;
      await click('[data-page-tree-delete-confirm]');
      assert.equal(engine.revision, revision); assert(folder(productFolder)); assert.equal(page(detailPage).annotation, 'Agent 编辑必须保留');
      await key('Escape');
    });
    await check('production-agent-schema-and-revision-guard-update-the-same-visible-tree', async () => {
      const contract = await (await fetch(`${connection.url}/v1/schema`, { headers })).json();
      assert(contract.commands.some(value => value.startsWith('addPageFolder')));
      const beforeTarget = await target(), staleRevision = engine.revision;
      const result = await remote([
        { type: 'addPageFolder', folder: { id: 'agent-folder', name: 'Agent 目录' } },
        { type: 'addPage', page: { id: 'agent-page', name: 'Agent 页面', parentId: 'agent-folder' } }
      ]);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      await wait(() => js('!!document.querySelector("[data-folder-id=agent-folder]")&&!!document.querySelector("[data-page-id=agent-page]")'), 'Agent state broadcast updates both tree kinds');
      assert.equal(page('agent-page').parentId, 'agent-folder'); assert.deepEqual(await target(), beforeTarget);
      assert.equal((await remote([{ type: 'updatePageFolder', folderId: 'agent-folder', patch: { name: '过期覆盖' } }], staleRevision)).status, 409);
      assert.equal(folder('agent-folder').name, 'Agent 目录');
      await click(rowName('agent-folder')); assert.deepEqual(await target(), beforeTarget);
      await click(rowName('agent-page')); assert.equal((await target()).id, 'agent-page');
    });
    await check('save-open-restores-folder-names-parentage-collapse-and-mixed-order', async () => {
      await click(`${row(productFolder)} [data-page-tree-toggle]`);
      await wait(() => folder(productFolder).collapsed, 'saved folder is collapsed');
      await click('#save-project'); await wait(() => fileCalls.includes('save'), 'save writes isolated file');
      const savedState = JSON.parse(await readFile(projectFile, 'utf8'));
      assert.deepEqual(savedState, state());
      await contextAction(productFolder, 'rename'); await nameDialog('未保存的名称');
      assert.equal(folder(productFolder).name, '未保存的名称');
      await click('#open-project'); await wait(() => fileCalls.includes('open'), 'disk project reopened');
      assert.deepEqual(state(), savedState); assert.equal(folder(productFolder).name, '产品区');
      assert.equal(folder(productFolder).collapsed, true); assert.equal(page(detailPage).parentId, approvalFolder);
      assert(!(await visibleRows()).includes(detailPage)); assert.equal(mixedOrder()[0], productFolder);
    });
    await check('exported-html-only-offers-real-pages-and-defaults-to-tree-first-page', async () => {
      assert.equal((await remote([
        { type: 'addPageFolder', folder: { id: 'empty-first-folder', name: '最前方空目录' } },
        { type: 'reorderPageTreeItem', itemId: 'empty-first-folder', index: 0 }
      ])).status, 200);
      assert.equal(mixedOrder()[0], 'empty-first-folder'); assert.equal(folder(productFolder).collapsed, true);
      await click('[data-desktop-menu="file"]'); await click('[data-menu-action="export-html"]');
      await wait(() => fileCalls.includes('html'), 'HTML saved through actual export IPC route');
      preview = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: preferences });
      observe(preview, 'html'); await preview.loadFile(htmlFile); preview.webContents.focus();
      const options = await js('[...document.querySelector("#pages").options].map(option=>({id:option.value,name:option.textContent}))', preview);
      assert.equal(options.length, state().pages.length);
      assert.deepEqual(new Set(options.map(item => item.id)), new Set(state().pages.map(item => item.id)));
      assert(!options.some(item => folders().some(folder => folder.id === item.id)));
      assert.equal(options[0].id, detailPage, 'A collapsed folder must not remove its child from HTML or become the default page');
      assert.equal(await js('document.querySelector("#pages").value', preview), detailPage);
      assert.equal(await js('document.querySelector("#current-page").textContent', preview), '订单详情');
      assert.equal(await js('document.querySelectorAll("#stage .node").length', preview), page(detailPage).nodes.length);
      await click('#pages', { win: preview }); await key('End', [], preview); await key('Enter', [], preview);
      assert.equal(await js('document.querySelector("#pages").value', preview), options.at(-1).id);
      assert.equal(await js('document.querySelector("#current-page").textContent', preview), options.at(-1).name);
      assert.equal(await js('document.querySelector("#runtime-status").hidden', preview), true);
      await writeFile(path.join(directory, 'html-preview.png'), (await preview.webContents.capturePage()).toPNG());
    });

    assert.deepEqual(errors, []);
    preview.destroy(); preview = null; editor.webContents.focus();
    await wait(() => js('document.querySelector("#message-dialog").open'), 'export completion dialog');
    await click('#dialog-ok');
    await click(`${row(productFolder)} [data-page-tree-toggle]`);
    await wait(() => !folder(productFolder).collapsed, 'expand branch for visual review');
    await click(rowName(detailPage)); await click('#zoom-value');
    await wait(() => js('document.querySelectorAll(".toast").length===0'), 'expected conflict notifications disappear', 8000);
    assert.equal((await target()).id, detailPage);
    assert.equal(await js('document.querySelectorAll("dialog[open]").length'), 0);
    assert.equal(await js('document.querySelectorAll("#nodes .design-node").length'), page(detailPage).nodes.length);
    const screenshot = await snapshot('page-folder-workspace');
    const trusted = await js('window.__pageTreeTrusted');
    assert(trusted.length > 0 && trusted.every(event => event.trusted));
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, checks, errors, fileCalls, inputDiagnostics, screenshot, trustedInputEvents: trusted.length, isolation: { userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }, coverage: 'Production page-tree renderer/preload, DocumentEngine and Agent HTTP. Pointer/keyboard input is trusted. Save/open/export IPC writes actual files under this run; native operating-system file pickers are not exercised. No user project or running desktop app is attached.' }, null, 2));
    await server.close(); server = null; preview?.destroy(); editor.destroy(); app.exit(0);
  } catch (error) {
    let failureScreenshot = null, captureError = null;
    try { failureScreenshot = await snapshot('failure'); } catch (failed) { captureError = failed.message; }
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: false, checks, errors, fileCalls, inputDiagnostics, error: error.stack, failureScreenshot, captureError }, null, 2));
    await server?.close(); preview?.destroy(); editor?.destroy(); app.exit(1);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

