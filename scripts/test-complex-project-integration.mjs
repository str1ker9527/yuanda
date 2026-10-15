import { electronExecutable, releaseLayout } from './platform-runtime.mjs';
/** Cross-feature acceptance against current source or its portable application.
 * node scripts/test-complex-project-integration.mjs [--dist]
 * Only isolated copies, new samples and .local evidence are written.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local', 'complex-project-integration');
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const frozen = process.argv.includes('--dist') ? releaseLayout(path.join(root,'dist',`原搭-${packageInfo.version}`)).app : root;
const sha = value => createHash('sha256').update(value).digest('hex');
await mkdir(output, { recursive: true });

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process');
  const directory = await mkdtemp(path.join(output, 'run-'));
  await cp(path.join(frozen, 'app'), path.join(directory, 'app'), { recursive: true });
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await cp(path.join(frozen, 'scripts/yuanda-agent.mjs'), path.join(directory, 'scripts/yuanda-agent.mjs'));
  const original = await readFile(path.join(frozen, 'app/main.mjs'), 'utf8');
  const instrumented = original.replaceAll('new BrowserWindow(', 'new globalThis.__ComplexTestWindow(');
  assert.notEqual(instrumented, original); assert.equal(instrumented.replaceAll('new globalThis.__ComplexTestWindow(', 'new BrowserWindow('), original);
  await writeFile(path.join(directory, 'app/main.mjs'), instrumented);
  const sourceFiles = [];
  async function auditCopy(relative = 'app') {
    for (const entry of await readdir(path.join(frozen, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name); if (entry.isDirectory()) { await auditCopy(name); continue; }
      const source = await readFile(path.join(frozen, name)), copied = await readFile(path.join(directory, name));
      assert.equal(name === 'app/main.mjs' ? copied.toString('utf8').replaceAll('new globalThis.__ComplexTestWindow(', 'new BrowserWindow(') : sha(copied), name === 'app/main.mjs' ? source.toString('utf8') : sha(source));
      sourceFiles.push({ path: name, sha256: sha(source) });
    }
  }
  await auditCopy();
  const provenance = { testedVersion: JSON.parse(await readFile(path.join(frozen, 'package.json'), 'utf8')).version, testedKind: process.argv.includes('--dist') ? 'portable-copy' : 'source-copy', sourceMainSha256: sha(original), windowOnlyInstrumentation: true, sourceRoot: frozen, sourceFiles };
  await writeFile(path.join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2));
  const temporary = path.join(root, '.local', 'tmp'); await mkdir(temporary, { recursive: true });
  const code = await new Promise(resolve => {
    const child = spawn(electronExecutable(root), [fileURLToPath(import.meta.url), '--integration-root', directory], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary } });
    const timer = setTimeout(() => { child.kill(); }, 90000);
    child.once('error', error => { clearTimeout(timer); console.error(error.message); resolve(1); });
    child.once('exit', value => { clearTimeout(timer); resolve(typeof value === 'number' ? value : 1); });
  });
  let result; try { result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')); } catch (error) { result = { ok: false, error: error.message }; }
  provenance.sourceUnchangedAfterTest = (await Promise.all(sourceFiles.map(async file => sha(await readFile(path.join(frozen, file.path))) === file.sha256))).every(Boolean);
  result = { ...result, ok: result.ok === true && code === 0, exitCode: code, directory, provenance };
  result.ok &&= provenance.sourceUnchangedAfterTest;
  if (result.ok) {
    const samples = path.join(root, 'samples', 'yuanda-complex', path.basename(directory)); await mkdir(samples, { recursive: true });
    await cp(path.join(directory, 'complex-saved.yuanda'), path.join(samples, '跨功能整合项目.yuanda'));
    await cp(path.join(directory, 'complex-export.html'), path.join(samples, '跨功能整合项目.html')); result.samples = samples;
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, checks: result.checks?.map(({ name, ok }) => ({ name, ok })), error: result.error, errors: result.errors, samples: result.samples, evidence: path.join(output, 'result.json') }, null, 2)); process.exitCode = result.ok ? 0 : 1;
} else {
  const directory = process.argv[process.argv.indexOf('--integration-root') + 1];
  assert(path.resolve(directory).startsWith(path.resolve(output) + path.sep));
  const electron = createRequire(import.meta.url)('electron'), { app, dialog } = electron, NativeWindow = electron.BrowserWindow;
  let editor, viewer; const checks = [], errors = [], dialogs = [], requests = [];
  const saved = path.join(directory, 'complex-saved.yuanda'), html = path.join(directory, 'complex-export.html');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label) => { const deadline = Date.now() + 6000; while (Date.now() < deadline) { if (await predicate()) return; await delay(25); } throw new Error(`等待超时：${label}`); };
  const js = (window, code) => window.webContents.executeJavaScript(code);
  const state = () => js(editor, 'window.yuanda.getState()');
  const snap = async name => { const filename = path.join(directory, `${name}.png`); await writeFile(filename, (await (viewer || editor).webContents.capturePage()).toPNG()); return filename; };
  globalThis.__ComplexTestWindow = class extends NativeWindow {
    constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); editor = this; this.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push({ surface: 'editor', message }); }); }
  };
  dialog.showSaveDialog = async (_owner, options) => { const filePath = options.title.includes('HTML') ? html : saved; dialogs.push({ kind: 'save', title: options.title, path: filePath }); return { canceled: false, filePath }; };
  dialog.showOpenDialog = async (_owner, options) => { dialogs.push({ kind: 'open', title: options.title, path: saved }); return { canceled: false, filePaths: [saved] }; };
  dialog.showMessageBox = async (_owner, options) => { dialogs.push({ kind: 'message', title: options.title, response: options.type === 'error' ? 0 : 1 }); if (options.type === 'error') throw new Error(options.detail || options.message); return { response: 1 }; };
  async function click(window, selector) {
    const p = await js(window, `(() => { const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('缺少目标 '+${JSON.stringify(selector)});node.scrollIntoView({block:'nearest',inline:'nearest'});const r=node.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    assert(await js(window, `document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${p.x},${p.y}))`), `点击目标不可见：${selector}`);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...p }); window.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 }); window.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await delay(90);
  }
  async function remote(commands, expectedRevision) {
    const current = await state(), connection = JSON.parse(await readFile(current.agent.connectionFile, 'utf8'));
    const response = await fetch(`${connection.url}/v1/commands`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: expectedRevision ?? current.revision, label: '复杂项目整合验证', commands }) });
    const reply = await response.json(); requests.push({ types: commands.map(command => command.type), expectedRevision: expectedRevision ?? current.revision, status: response.status, revision: reply.revision, code: reply.code });
    assert.equal(response.status, 200, JSON.stringify(reply)); await wait(async () => (await js(editor, 'window.YuandaEditor.getState().revision')) === reply.revision, 'Agent 同步'); return reply;
  }
  const nodeSelector = id => `[data-node-id="${id}"]`;
  const page = project => project.pages.find(page => page.id === 'integrated-page');
  const instanceMap = (project, id) => { const group = page(project).groups.find(group => group.id === id); return Object.fromEntries(group.sourceIds.map((sourceId, i) => [sourceId, group.nodeIds[i]])); };
  const expression = (op, ...args) => ({ op, args });
  const item = column => ({ op: 'item', column }), variable = name => ({ op: 'var', name });
  const branch = actions => [{ event: 'click', actions }];
  const add = (type, id, x, y, width, height, extra = {}) => ({ id, name: id, type, x, y, width, height, ...extra });
  async function check(name, task) { const details = await task(); checks.push({ name, ok: true, details }); }
  async function finish(ok, error) { if (!ok) await snap('failure').catch(() => {}); const inputTrace = { editor: editor ? await js(editor, 'window.__integrationClicks||[]').catch(() => []) : [], html: viewer ? await js(viewer, 'window.__integrationClicks||[]').catch(() => []) : [] }; await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok, checks, errors, dialogs, requests, inputTrace, error: error?.stack, coverage: '所选源码或发行版 app 的独立副本，仅替换隐藏/offscreen窗口构造。生产 Agent HTTP、IPC、原子保存、重新打开和 HTML 导出原样运行。文件对话框返回项目内指定样本路径，确认对话框返回不保存；HTML 功能由真实鼠标点击和实际窗口尺寸变化驱动。测试完成由测试入口退出，未把它计作正常关闭验收。' }, null, 2)); const connection = (await state().catch(() => null))?.agent.connectionFile; if (connection) await import('node:fs/promises').then(fs => fs.unlink(connection).catch(() => {})); app.exit(ok ? 0 : 1); }
  void run().then(() => finish(errors.length === 0)).catch(error => finish(false, error));
  async function run() {
    await import(pathToFileURL(path.join(directory, 'app/main.mjs')).href);
    await wait(() => editor && !editor.webContents.isLoading() && js(editor, '!!window.YuandaEditor?.getState()'), '隔离生产应用启动'); editor.webContents.focus();
    const recordClicks = "window.__integrationClicks=[];document.addEventListener('click',event=>window.__integrationClicks.push({target:event.target.id||event.target.closest('[data-node-id]')?.dataset.nodeId||event.target.className,trusted:event.isTrusted}),true)";
    await js(editor, recordClicks);
    let originalMap, copyMap, originalStateMap, copyStateMap, captured, copiedIds;
    await check('agent-builds-component-panel-repeater-view-graph', async () => {
      const initial = await state();
      const component = { id: 'catalog-card', name: '带状态的条目母版', width: 420, height: 140, nodes: [
        add('text', 'card-heading', 0, 0, 230, 35, { text: '母版标题' }),
        add('button', 'card-action', 260, 0, 145, 35, { text: '查看条目', interactions: branch([{ type: 'nextPanelState', panelId: 'card-panel', wrap: true }, { type: 'setVariable', name: 'chosen', value: item('title') }, { type: 'setVariable', name: 'clicks', value: expression('add', variable('clicks'), 1) }]) }),
        add('dynamicPanel', 'card-panel', 0, 45, 405, 82, { panel: { initialStateId: 'card-overview', clip: true, states: [{ id: 'card-overview', name: '概要', nodeIds: ['card-summary'] }, { id: 'card-detail', name: '详情', nodeIds: ['card-details'] }] } }),
        add('text', 'card-summary', 10, 55, 380, 40, { bindings: { text: expression('concat', item('title'), ' / 分数 ', item('score')) } }),
        add('text', 'card-details', 10, 55, 380, 40, { bindings: { text: expression('concat', '已查看：', item('title')) } })
      ] };
      await remote([
        { type: 'renameProject', name: '母版与列表跨功能整合' },
        { type: 'addPage', page: { id: 'integrated-page', name: '组合工作台', width: 1100, height: 900 } },
        { type: 'addPage', page: { id: 'receipt-page', name: '状态回执', width: 900, height: 500 } },
        ...initial.project.pages.map(page => ({ type: 'removePage', pageId: page.id })),
        { type: 'addVariable', variable: { name: 'chosen', type: 'string', value: '尚未选择' } }, { type: 'addVariable', variable: { name: 'clicks', type: 'number', value: 0 } },
        { type: 'addComponent', component },
        { type: 'insertComponent', pageId: 'integrated-page', componentId: component.id, instanceId: 'primary-card', x: 60, y: 240 },
        { type: 'addNode', pageId: 'integrated-page', node: add('text', 'page-title', 40, 20, 960, 40, { text: '原始内容与复制快照并列验证', style: { fontSize: 24 } }) },
        { type: 'addNode', pageId: 'integrated-page', node: add('text', 'live-summary', 40, 75, 650, 40, { bindings: { text: expression('concat', '最近选择：', variable('chosen'), ' / 点击 ', variable('clicks')) } }) },
        { type: 'addNode', pageId: 'integrated-page', node: add('button', 'to-receipt', 780, 75, 250, 36, { text: '查看跨页状态', interactions: branch([{ type: 'navigate', pageId: 'receipt-page' }]) }) },
        { type: 'addNode', pageId: 'receipt-page', node: add('text', 'receipt-summary', 40, 60, 800, 60, { bindings: { text: expression('concat', '跨页保留：', variable('chosen'), ' / 点击 ', variable('clicks')) } }) },
        { type: 'addNode', pageId: 'receipt-page', node: add('button', 'back', 40, 160, 180, 40, { text: '返回组合工作台', interactions: branch([{ type: 'navigate', pageId: 'integrated-page' }]) }) }
      ]);
      originalMap = instanceMap((await state()).project, 'primary-card');
      await remote([
        { type: 'createRepeater', pageId: 'integrated-page', nodeId: 'primary-repeat' },
        { type: 'updateNode', pageId: 'integrated-page', nodeId: 'primary-repeat', patch: { x: 40, y: 220, width: 460, height: 390 } },
        { type: 'setRepeaterTemplate', pageId: 'integrated-page', nodeId: 'primary-repeat', nodeIds: ['card-heading', 'card-action', 'card-panel'].map(id => originalMap[id]) },
        { type: 'setRepeaterData', pageId: 'integrated-page', nodeId: 'primary-repeat', columns: [{ key: 'title', label: '标题', type: 'string' }, { key: 'score', label: '分数', type: 'number' }], rows: [{ id: 'row-alpha', values: { title: 'Alpha', score: 1 } }, { id: 'row-beta', values: { title: 'Beta', score: 2 } }] },
        { type: 'updateNode', pageId: 'integrated-page', nodeId: 'primary-repeat', patch: { repeater: { ...(page((await state()).project).nodes.find(node => node.id === 'primary-repeat')?.repeater || {}), columns: [{ key: 'title', label: '标题', type: 'string' }, { key: 'score', label: '分数', type: 'number' }], rows: [{ id: 'row-alpha', values: { title: 'Alpha', score: 1 } }, { id: 'row-beta', values: { title: 'Beta', score: 2 } }], templateIds: ['card-heading', 'card-action', 'card-panel'].map(id => originalMap[id]), itemWidth: 440, itemHeight: 155, layout: 'vertical', gap: 10, columnsCount: 1, filter: null, sort: null } } },
        { type: 'setComponentOverride', pageId: 'integrated-page', instanceId: 'primary-card', sourceId: 'card-heading', patch: { text: '复制时的实例标题' } },
        { type: 'addAdaptiveView', pageId: 'integrated-page', view: { id: 'narrow', name: '窄屏叠放', minWidth: 0, width: 520, height: 1200, overrides: { 'page-title': { text: '窄屏 · 两份列表依次排列', width: 440 }, 'live-summary': { width: 440 }, 'to-receipt': { x: 40, y: 120, width: 300 }, 'primary-repeat': { x: 40, y: 220 } } } },
        { type: 'addAdaptiveView', pageId: 'integrated-page', view: { id: 'wide', name: '宽屏并列', minWidth: 1100, width: 1100, height: 900, overrides: { 'page-title': { text: '宽屏 · 原列表与复制快照并列' } } } }
      ]);
      const project = (await state()).project, source = page(project); captured = structuredClone({ projectId: project.id, sourceId: source.id, nodes: source.nodes, groups: source.groups, views: source.views, nodeIds: ['primary-repeat'] });
      await writeFile(path.join(directory, 'captured-fragment.json'), JSON.stringify(captured, null, 2));
      assert.equal(source.nodes.find(node => node.id === originalMap['card-panel']).panel.states[0].nodeIds[0], originalMap['card-summary']);
      return { componentNodes: project.components[0].nodes.length, instanceId: 'primary-card', repeaterTemplateRoots: source.nodes.find(node => node.id === 'primary-repeat').repeater.templateIds, views: source.views.map(view => view.id) };
    });
    await check('snapshot-paste-preserves-old-data-while-master-stays-linked', async () => {
      await remote([{ type: 'updateRepeaterRow', pageId: 'integrated-page', nodeId: 'primary-repeat', rowId: 'row-alpha', values: { title: 'Agent Alpha' } }, { type: 'componentCommands', componentId: 'catalog-card', commands: [{ type: 'updateNode', nodeId: 'card-action', patch: { text: '查看并计数' } }] }, { type: 'setComponentOverride', pageId: 'integrated-page', instanceId: 'primary-card', sourceId: 'card-heading', patch: { text: '更新后的原列表标题' } }]);
      const { getNodeInternalIds } = await import(pathToFileURL(path.join(directory, 'app/core/interaction-model.mjs')).href);
      const idMap = Object.fromEntries([...captured.nodes.map(node => node.id), ...getNodeInternalIds(captured.nodes), ...captured.groups.map(group => group.id)].map((id, index) => [id, `snapshot-object-${index}`])); idMap['primary-repeat'] = 'snapshot-repeat'; idMap['primary-card'] = 'snapshot-card';
      await remote([{ type: 'pasteFragment', pageId: 'integrated-page', fragment: captured, idMap, dx: 540, dy: 0 }]);
      let project = (await state()).project; copyMap = instanceMap(project, 'snapshot-card');
      const current = page(project), original = current.nodes.find(node => node.id === 'primary-repeat'), copy = current.nodes.find(node => node.id === 'snapshot-repeat');
      assert.equal(original.repeater.rows[0].values.title, 'Agent Alpha'); assert.equal(copy.repeater.rows[0].values.title, 'Alpha');
      assert.equal(current.nodes.find(node => node.id === originalMap['card-heading']).text, '更新后的原列表标题'); assert.equal(current.nodes.find(node => node.id === copyMap['card-heading']).text, '复制时的实例标题');
      for (const map of [originalMap, copyMap]) { const action = current.nodes.find(node => node.id === map['card-action']); assert.equal(action.text, '查看并计数'); assert.equal(action.interactions[0].actions[0].panelId, map['card-panel']); }
      copiedIds = ['snapshot-repeat', ...Object.values(copyMap)];
      await remote([
        ...copiedIds.map(nodeId => { const node = current.nodes.find(node => node.id === nodeId); return { type: 'setAdaptiveOverride', pageId: current.id, viewId: 'narrow', nodeId, patch: { x: node.x - 540, y: node.y + 450 } }; }),
        { type: 'addNode', pageId: current.id, node: add('button', 'sort-primary', 40, 170, 140, 35, { text: '原列表降序', interactions: branch([{ type: 'sortRows', repeaterId: 'primary-repeat', column: 'score', descending: true }]) }) },
        { type: 'addNode', pageId: current.id, node: add('button', 'filter-primary', 190, 170, 140, 35, { text: '原列表筛选', interactions: branch([{ type: 'filterRows', repeaterId: 'primary-repeat', where: expression('gt', item('score'), 1) }]) }) },
        { type: 'addNode', pageId: current.id, node: add('button', 'clear-primary', 340, 170, 140, 35, { text: '清除筛选', interactions: branch([{ type: 'filterRows', repeaterId: 'primary-repeat', where: null }]) }) },
        { type: 'addNode', pageId: current.id, node: add('button', 'add-snapshot', 580, 170, 260, 35, { text: '仅给快照新增 Gamma', interactions: branch([{ type: 'addRows', repeaterId: 'snapshot-repeat', rows: [{ values: { title: 'Gamma', score: 3 } }] }]) }) },
        { type: 'setAdaptiveOverride', pageId: current.id, viewId: 'narrow', nodeId: 'add-snapshot', patch: { x: 40, y: 620 } }
      ]);
      project = (await state()).project;
      const panelStates = map => page(project).nodes.find(node => node.id === map['card-panel']).panel.states.map(state => state.id); originalStateMap = panelStates(originalMap); copyStateMap = panelStates(copyMap);
      return { copiedRows: copy.repeater.rows, originalRows: original.repeater.rows, originalMap, copyMap, originalStateMap, copyStateMap };
    });
    await check('production-save-reopen-undo-redo-and-reference-roundtrip', async () => {
      await click(editor, '#save-project'); await wait(async () => !(await state()).dirty, '生产接口保存');
      const first = JSON.parse(await readFile(saved, 'utf8')); assert.deepEqual(first, (await state()).project);
      await click(editor, '#open-project'); await wait(async () => !(await state()).canUndo, '重新打开清空历史'); assert.deepEqual((await state()).project, first);
      await remote([{ type: 'componentCommands', componentId: 'catalog-card', commands: [{ type: 'updateNode', nodeId: 'card-action', patch: { style: { fill: '#303030' } } }] }, { type: 'updateRepeaterRow', pageId: 'integrated-page', nodeId: 'primary-repeat', rowId: 'row-beta', values: { score: 8 } }, { type: 'setAdaptiveOverride', pageId: 'integrated-page', viewId: 'narrow', nodeId: 'live-summary', patch: { style: { fontSize: 15 } } }]);
      const changed = (await state()).project; assert.notDeepEqual(changed, first);
      await click(editor, '#undo'); await wait(async () => (await state()).canRedo, '整批撤销'); assert.deepEqual((await state()).project, first);
      await click(editor, '#redo'); await wait(async () => !(await state()).canRedo, '整批重做'); assert.deepEqual((await state()).project, changed);
      await click(editor, '#save-project'); await wait(async () => !(await state()).dirty, '重做后保存'); assert.deepEqual(JSON.parse(await readFile(`${saved}.bak`, 'utf8')), first);
      await click(editor, '#open-project'); await wait(async () => !(await state()).canUndo, '再次重新打开'); assert.deepEqual((await state()).project, changed);
      await click(editor, '#export-toggle'); await click(editor, '#export-html'); await wait(async () => { try { return (await readFile(html, 'utf8')).includes('yuanda-model'); } catch { return false; } }, '生产接口导出 HTML');
      const { exportHtml } = await import(pathToFileURL(path.join(directory, 'app/core/html-export.mjs')).href); assert.equal(await readFile(html, 'utf8'), exportHtml(changed));
      await snap('editor-saved-project'); return { savedSha256: sha(await readFile(saved)), htmlSha256: sha(await readFile(html)), nodeCount: page(changed).nodes.length, componentCount: changed.components.length, exactModelRoundtrip: true, oneUndoAndOneRedo: true, backupMatchesFirstSave: true };
    });
    viewer = new NativeWindow({ width: 1280, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    viewer.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push({ surface: 'html', message }); }); await viewer.loadFile(html); viewer.webContents.focus();
    await js(viewer, recordClicks);
    await wait(() => js(viewer, '!!document.querySelector(".repeater-item")'), '导出网页初始化');
    const row = (repeaterId, rowId) => `${nodeSelector(repeaterId)} .repeater-item[data-row-id="${rowId}"]`;
    const model = (await state()).project, copyRows = page(model).nodes.find(node => node.id === 'snapshot-repeat').repeater.rows;
    const visibleState = (selector, stateId) => js(viewer, `!document.querySelector(${JSON.stringify(`${selector} [data-state-id="${stateId}"]`)}).hidden`);
    await check('html-component-in-repeater-keeps-row-local-panel-state-and-shared-variables', async () => {
      const a = row('primary-repeat', 'row-alpha'), b = row('primary-repeat', 'row-beta'), ca = row('snapshot-repeat', copyRows[0].id), cb = row('snapshot-repeat', copyRows[1].id);
      assert.equal(await js(viewer, 'document.querySelector("#stage").style.width'), '1100px');
      await click(viewer, `${a} ${nodeSelector(originalMap['card-action'])}`);
      await wait(() => js(viewer, `document.querySelector(${JSON.stringify(nodeSelector('live-summary'))}).textContent==='最近选择：Agent Alpha / 点击 1'`), '主实例共享变量更新');
      assert(await visibleState(a, originalStateMap[1])); assert(await visibleState(b, originalStateMap[0])); assert(await visibleState(ca, copyStateMap[0]));
      await click(viewer, `${cb} ${nodeSelector(copyMap['card-action'])}`);
      await wait(() => js(viewer, `document.querySelector(${JSON.stringify(nodeSelector('live-summary'))}).textContent==='最近选择：Beta / 点击 2'`), '快照实例共享变量更新');
      assert(await visibleState(cb, copyStateMap[1])); assert(await visibleState(ca, copyStateMap[0])); assert(await visibleState(a, originalStateMap[1]));
      return { screenshot: await snap('html-wide-linked-components'), isolatedRows: true, bothComponentReferencesRemapped: true };
    });
    await check('adaptive-resize-preserves-live-panel-state-and-copy-data-isolation', async () => {
      viewer.setContentSize(600, 1000); await wait(() => js(viewer, 'document.querySelector("#stage").style.width==="520px"'), '窗口宽度自动触发窄屏视图');
      assert.equal(await js(viewer, `document.querySelector(${JSON.stringify(nodeSelector('snapshot-repeat'))}).style.left`), '40px'); assert.equal(await js(viewer, `document.querySelector(${JSON.stringify(nodeSelector('snapshot-repeat'))}).style.top`), '670px');
      assert(await visibleState(row('primary-repeat', 'row-alpha'), originalStateMap[1])); assert(await visibleState(row('snapshot-repeat', copyRows[1].id), copyStateMap[1]));
      await click(viewer, nodeSelector('add-snapshot'));
      const visibleRows = id => js(viewer, `[...document.querySelectorAll(${JSON.stringify(`${nodeSelector(id)} > .repeater-content > .repeater-item`)})].filter(item=>!item.hidden).length`);
      await wait(async () => await visibleRows('snapshot-repeat') === 3, '只给快照增加运行时行'); assert.equal(await visibleRows('primary-repeat'), 2);
      await click(viewer, nodeSelector('sort-primary')); assert.equal(await js(viewer, `document.querySelector(${JSON.stringify(`${nodeSelector('primary-repeat')} .repeater-item`)}).dataset.rowId`), 'row-beta');
      assert(await visibleState(row('primary-repeat', 'row-alpha'), originalStateMap[1]));
      await click(viewer, nodeSelector('filter-primary')); assert.equal(await visibleRows('primary-repeat'), 1); assert.equal(await visibleRows('snapshot-repeat'), 3);
      await click(viewer, nodeSelector('clear-primary')); assert.equal(await visibleRows('primary-repeat'), 2); assert(await visibleState(row('primary-repeat', 'row-alpha'), originalStateMap[1]));
      assert.equal(await js(viewer, `document.querySelector(${JSON.stringify(nodeSelector('live-summary'))}).textContent`), '最近选择：Beta / 点击 2');
      assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), (await state()).project, '演示运行不能修改设计文件'); return { screenshot: await snap('html-narrow-runtime-state'), originalVisibleRows: 2, snapshotVisibleRows: 3, panelStatesSurviveResizeSortFilter: true };
    });
    await check('navigation-retains-variables-and-reentry-resets-runtime-only-list-changes', async () => {
      await click(viewer, nodeSelector('to-receipt')); await wait(() => js(viewer, `document.querySelector(${JSON.stringify(nodeSelector('receipt-summary'))})?.textContent==='跨页保留：Beta / 点击 2'`), '跨页变量联动');
      await click(viewer, nodeSelector('back')); await wait(() => js(viewer, `document.querySelectorAll(${JSON.stringify(`${nodeSelector('snapshot-repeat')} .repeater-item`)}).length===2`), '再次进入页面恢复设计数据');
      assert.equal(await js(viewer, `document.querySelector(${JSON.stringify(nodeSelector('live-summary'))}).textContent`), '最近选择：Beta / 点击 2');
      assert(await visibleState(row('primary-repeat', 'row-alpha'), originalStateMap[0])); assert.equal(await js(viewer, 'document.querySelector("#runtime-status").hidden'), true);
      const editorClicks = await js(editor, 'window.__integrationClicks'), viewerClicks = await js(viewer, 'window.__integrationClicks');
      assert(editorClicks.length >= 8 && viewerClicks.length >= 8); assert([...editorClicks, ...viewerClicks].every(event => event.trusted));
      return { screenshot: await snap('html-returned-clean-runtime'), sharedVariablesRetained: true, originalSavedRowsRestored: true, trustedEditorClicks: editorClicks.length, trustedViewerClicks: viewerClicks.length };
    });
  }
}
