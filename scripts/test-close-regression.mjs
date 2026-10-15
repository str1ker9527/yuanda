import { electronExecutable } from './platform-runtime.mjs';
/** Production main close path in isolated copies; no --yuanda-smoke bypass. */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local', 'close-regression');
const scenarios = ['inline-save', 'property-cancel', 'inline-discard', 'save-dialog-cancel', 'flush-false', 'flush-error', 'agent-during-flush'];
await mkdir(output, { recursive: true });

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process');
  const run = await mkdtemp(path.join(output, 'run-')), checks = [];
  await mkdir(path.join(root, '.local', 'tmp'), { recursive: true });
  // Each child imports app/main.mjs with only its window constructor substituted.
  // The close/IPC/save code is unchanged. Its sourceRoot keeps
  // recovery, projects, connection files and browser data away from user data.
  for (const scenario of scenarios) {
    const directory = path.join(run, scenario); await mkdir(directory, { recursive: true });
    await cp(path.join(root, 'app'), path.join(directory, 'app'), { recursive: true });
    const mainFile = path.join(directory, 'app', 'main.mjs'), source = await readFile(mainFile, 'utf8');
    assert(source.includes('new BrowserWindow(')); await writeFile(mainFile, source.replaceAll('new BrowserWindow(', 'new globalThis.__CloseTestWindow('));
    const code = await new Promise(resolve => {
      const child = spawn(electronExecutable(root), [fileURLToPath(import.meta.url), '--close-case', scenario, '--close-root', directory], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: path.join(root, '.local', 'tmp'), TMP: path.join(root, '.local', 'tmp'), TMPDIR: path.join(root, '.local', 'tmp') } });
      const timer = setTimeout(() => { child.kill(); }, 30000);
      child.once('error', error => { clearTimeout(timer); console.error(error.message); resolve(1); });
      child.once('exit', value => { clearTimeout(timer); resolve(typeof value === 'number' ? value : 1); });
    });
    let result; try { result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')); } catch (error) { result = { ok: false, error: error.message }; }
    checks.push({ name: scenario, ...result, exitCode: code, ok: result.ok && code === 0, result: path.relative(root, path.join(directory, 'result.json')) });
  }
  const result = { ok: checks.every(check => check.ok), checks, coverage: '生产 app 复制到项目内独立目录，仅将 BrowserWindow 构造器替换成隐藏/offscreen 包装器；close/IPC/文件逻辑原样，非 smoke。真实关闭事件、原生输入、IPC、HTTP Agent 和磁盘写入；替换文件/确认对话框返回值，两项注入 flush 失败。取消关闭后由测试入口退出，未以退出代替断言。' };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
} else {
  const scenario = process.argv[process.argv.indexOf('--close-case') + 1], directory = process.argv[process.argv.indexOf('--close-root') + 1];
  assert(scenarios.includes(scenario)); assert(path.resolve(directory).startsWith(path.resolve(output) + path.sep));
  const electron = createRequire(import.meta.url)('electron'), { app, dialog } = electron;
  const NativeWindow = electron.BrowserWindow;
  let window, expectedExit = null, questionCount = 0, saveCount = 0, errorCount = 0, questionHandler = null;
  const events = [], errors = [], report = path.join(directory, 'result.json'), savedFile = path.join(directory, 'saved.yuanda');
  const recoveryFile = path.join(directory, '.local', 'yuanda-runtime', 'recovery.json');
  const result = (ok, extra = {}) => writeFileSync(report, JSON.stringify({ ok, events, errors, questionCount, saveCount, errorCount, ...extra }, null, 2));
  globalThis.__CloseTestWindow = class extends NativeWindow {
    constructor(options) {
      super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
      window = this;
      this.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
      this.on('close', () => events.push('native-window-close'));
    }
  };
  dialog.showSaveDialog = async () => { saveCount++; events.push('save-dialog'); return scenario === 'save-dialog-cancel' ? { canceled: true } : { canceled: false, filePath: savedFile }; };
  dialog.showMessageBox = async (_owner, options) => {
    if (options.type === 'error') { errorCount++; events.push('error-dialog'); return { response: 0 }; }
    questionCount++; events.push('save-question');
    if (questionHandler) return questionHandler();
    return { response: scenario === 'inline-discard' ? 1 : scenario === 'property-cancel' ? 2 : 0 };
  };
  app.on('will-quit', () => {
    try { assert(expectedExit, '关闭未经过预期断言'); expectedExit(); assert.equal(errors.length, 0); result(true); }
    catch (error) { result(false, { error: error.stack }); process.exitCode = 1; }
  });
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => { for (let n = 0; n < 160; n++) { if (await fn()) return; await delay(25); } throw new Error(`等待超时：${label}`); };
  const js = code => window.webContents.executeJavaScript(code);
  const state = () => js('window.yuanda.getState()');
  const nodeText = value => value.project.pages.find(page => page.id === 'page-home').nodes.find(node => node.id === 'home-title').text;
  const click = async (selector, double = false) => {
    const point = await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw new Error('目标不存在');n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    assert(await js(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`), `目标被遮挡：${selector}`);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    for (let count = 1; count <= (double ? 2 : 1); count++) { window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: count }); window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: count }); }
    await delay(70);
  };
  const type = async (selector, value) => { await click(selector); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] }); await delay(40); await window.webContents.insertText(value); await delay(50); };
  const inline = async value => { await click('#nodes .design-node[data-node-id="home-title"]', true); await wait(() => js('!!document.querySelector(".inline-editor")'), '内联文字编辑器'); await type('.inline-editor', value); };
  const agentCommand = async (commands, revision = undefined) => {
    const current = await state(), connection = JSON.parse(await readFile(current.agent.connectionFile, 'utf8'));
    const response = await fetch(connection.url + '/v1/commands', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: revision ?? current.revision, commands }) });
    return { status: response.status, body: await response.json() };
  };
  const textCommand = text => [{ type: 'updateNode', pageId: 'page-home', nodeId: 'home-title', patch: { text } }];
  async function finishOpen() { assert(!window.isDestroyed()); assert.equal(errors.length, 0); result(true, { keptOpen: true }); app.exit(0); }
  void run().catch(error => { result(false, { error: error.stack }); app.exit(1); });
  async function run() {
    await import(pathToFileURL(path.join(directory, 'app', 'main.mjs')).href);
    await wait(() => window && !window.webContents.isLoading() && js('typeof window.YuandaEditor?.flushPendingEdits === "function"'), '生产编辑器接口');
    window.webContents.focus(); await js('window.YuandaDock.reset()'); await delay(150);
    const initial = await state(); assert.equal(initial.dirty, false); const originalText = nodeText(initial);
    if (scenario === 'inline-save') {
      const draft = '关闭时必须保存最后一次输入'; await inline(draft); assert.equal((await state()).dirty, false); assert.equal(nodeText(await state()), originalText);
      let resolveQuestion; questionHandler = () => new Promise(resolve => { resolveQuestion = resolve; });
      expectedExit = () => { assert.equal(questionCount, 1); assert.equal(saveCount, 1); assert.equal(nodeText({ project: JSON.parse(readFileSync(savedFile, 'utf8')) }), draft); assert.equal(nodeText(JSON.parse(readFileSync(recoveryFile, 'utf8'))), draft); assert(!existsSync(initial.agent.connectionFile)); events.push('saved-and-recovered-final-draft'); };
      window.close(); await wait(() => questionCount === 1, '提交草稿后询问保存'); assert.equal(nodeText(await state()), draft);
      const blocked = await agentCommand(textCommand('不能覆盖保存中的内容')); assert.equal(blocked.status, 400); assert.equal(blocked.body.code, 'BUSY');
      window.close(); await delay(50); assert.equal(questionCount, 1); resolveQuestion({ response: 0 }); return;
    }
    if (scenario === 'inline-discard') {
      await js('window.yuanda.saveProjectAs()'); assert(existsSync(savedFile)); await inline('明确选择不保存的草稿');
      expectedExit = () => { assert.equal(questionCount, 1); assert.equal(saveCount, 1); assert.equal(nodeText({ project: JSON.parse(readFileSync(savedFile, 'utf8')) }), originalText); assert(!existsSync(recoveryFile)); assert(!existsSync(initial.agent.connectionFile)); events.push('discard-kept-existing-file-and-removed-recovery'); };
      window.close(); return;
    }
    if (scenario === 'property-cancel') {
      await click('#nodes .design-node[data-node-id="home-title"]'); await js('window.YuandaDock.show("styles")'); await type('#inspector textarea', '属性里尚未失焦的文字'); assert.equal((await state()).dirty, false);
      window.close(); await wait(() => questionCount === 1, '属性提交后询问保存'); await delay(100); assert.equal(nodeText(await state()), '属性里尚未失焦的文字'); assert(!existsSync(savedFile));
      const reply = await agentCommand([{ type: 'renameProject', name: '取消后继续编辑' }]); assert.equal(reply.status, 200); events.push('cancel-kept-draft-and-unlocked-commands'); await finishOpen(); return;
    }
    if (scenario === 'save-dialog-cancel') {
      await inline('另存对话框取消后仍保留'); window.close(); await wait(() => saveCount === 1, '打开保存对话框'); await delay(100); assert.equal(nodeText(await state()), '另存对话框取消后仍保留'); assert(!existsSync(savedFile));
      assert.equal((await agentCommand([{ type: 'renameProject', name: '取消另存后可继续' }])).status, 200); events.push('save-dialog-cancel-kept-window'); await finishOpen(); return;
    }
    if (scenario === 'flush-false' || scenario === 'flush-error') {
      await inline('提交失败不能关闭');
      await js(`window.YuandaEditor.flushPendingEdits=async()=>{${scenario === 'flush-error' ? "throw new Error('injected flush failure')" : 'return false'}};void 0`);
      window.close(); if (scenario === 'flush-error') await wait(() => errorCount === 1, '关闭错误提示'); await delay(150);
      assert.equal(questionCount, 0); assert.equal(await js('document.querySelector(".inline-editor").value'), '提交失败不能关闭'); assert.equal((await agentCommand([{ type: 'renameProject', name: '提交失败后仍能编辑' }])).status, 200); events.push('failed-flush-kept-draft-and-window'); await finishOpen(); return;
    }
    if (scenario === 'agent-during-flush') {
      const localDraft = '本地正在输入的草稿', remoteText = 'Agent 同时提交的新文字'; await inline(localDraft);
      await js('window.__originalFlush=window.YuandaEditor.flushPendingEdits;window.__flushCalls=0;window.YuandaEditor.flushPendingEdits=async()=>{window.__flushCalls++;await new Promise(resolve=>window.__releaseFlush=resolve);return window.__originalFlush()};void 0');
      window.close(); await wait(() => js('window.__flushCalls===1'), '开始关闭提交'); window.close();
      assert.match(await js('window.yuanda.saveProject().then(()=>"unexpected",error=>error.message)'), /关闭窗口/);
      assert.equal((await agentCommand(textCommand(remoteText))).status, 200); await wait(() => js('window.YuandaEditor.getState().project.pages[0].nodes.find(node=>node.id==="home-title").text===' + JSON.stringify(remoteText)), 'Agent更新同步');
      assert.equal(await js('document.querySelector(".inline-editor").value'), localDraft); await js('window.__releaseFlush()');
      const retainedDraft = 'textarea[aria-label="保留的文字草稿"]';
      await wait(() => js(`!!document.querySelector(${JSON.stringify(retainedDraft)})`), '冲突保留文字'); await delay(100);
      assert.equal(questionCount, 0); assert.equal(await js('window.__flushCalls'), 1); assert.equal(nodeText(await state()), remoteText); assert.equal(await js(`document.querySelector(${JSON.stringify(retainedDraft)}).value`), localDraft);
      assert.equal(await js('JSON.parse(localStorage.getItem("yuanda.pendingTextDraft")).text'), localDraft); assert.equal((await agentCommand([{ type: 'renameProject', name: '冲突后命令已解锁' }])).status, 200); events.push('agent-conflict-kept-both-versions-and-no-double-close'); await finishOpen();
    }
  }
}
