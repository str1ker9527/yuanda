import { electronExecutable, releaseLayout } from './platform-runtime.mjs';
/** Real production-main + stdio MCP integration, with a fresh hidden Electron profile.
 * Run: node scripts/test-agent-mcp-desktop.mjs [--portable]
 * The main process imports runAgentMcpSmoke only for --yuanda-agent-smoke.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportName = 'agent-smoke-result.json';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Original four-colour PNG from this project's previously accepted manual fixture.
const imageSource = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAAChElEQVR4nO3SoQ3CYBRG0XoMS7AVjknQ3YE9mAkNFlyTirq/Ib05X+4ALy9n+pqFNv37ALORA9pSA9pSW4G+3F7ao+XD5+ddwwMa6FRAA50KaKBTAQ10KqCBTgU00KmABjoV0ECnAhroVEADnQpooFMBDXQqoIFOBTTQqYAGOhXQQKcCGuhUQAOdCmigUwENdCqggU4FNNCpgAY6FdBApwIa6FRAA50KaKBTAQ10KqCBTgU00KmABjoV0ECnAhroVEADnQpooFMBDXQqoIFOBTTQqYAGOhXQQKcCGuhUQAOdCmigUwENdCqggU4FNNCpgAY6FdBApwIa6FRAA50KaKBTAQ10KqCBTgU00KmABjoV0ECnAhroVEADnQpooFMBDXQqoIFOBTTQqYAGOhXQQKcCGuhUQAOdCmigUwENdCqggU4FNNCpgAY6FdBApwIa6FRAA51qE7TZ0Qe0pQa0pbYC/X6ctEfLh+frR8MDGuhUQAOdCmigUwENdCqggU4FNNCpgAY6FdBApwIa6FRAA50KaKBTAQ10KqCBTgU00KmABjoV0ECnAhroVEADnQpooFMBDXQqoIFOBTTQqYAGOhXQQKcCGuhUQAOdCmigUwENdCqggU4FNNCpgAY6FdBApwIa6FRAA50KaKBTAQ10KqCBTgU00KmABjoV0ECnAhroVEADnQpooFMBDXQqoIFOBTTQqYAGOhXQQKcCGuhUQAOdCmigUwENdCqggU4FNNCpgAY6FdBApwIa6FRAA50KaKBTAQ10KqCBTgU00KmABjoV0ECnAhroVEADnQpooFMBDXQqoIFOBTTQqYAGOhXQQKcCGuhUm6DNjj6gLTWgLTWgLbUf/LgL0lFIMpwAAAAASUVORK5CYII=';

function startMcp(connectionFile) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/yuanda-mcp.mjs'), '--connection', connectionFile], {
    cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  const pending = new Map(); let sequence = 0, buffer = '', stderr = '', closed = false;
  const failAll = error => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); } pending.clear(); };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { stderr = (stderr + text).slice(-8000); });
  child.on('error', failAll);
  child.on('exit', code => { closed = true; failAll(new Error(`MCP child exited (${code}): ${stderr}`)); });
  child.stdout.on('data', text => {
    buffer += text;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { failAll(new Error('MCP stdout contained non-JSON protocol output')); child.kill(); return; }
      if (!Object.hasOwn(message, 'id')) continue;
      const job = pending.get(message.id); if (!job) continue;
      pending.delete(message.id); clearTimeout(job.timer);
      if (message.error) job.reject(new Error(`MCP ${message.error.code}: ${message.error.message}`)); else job.resolve(message.result);
    }
  });
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('MCP child is closed')); return; }
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); send({ id, method, params });
  });
  return {
    request, notify: (method, params = {}) => send({ method, params }),
    async callResult(name, args = {}) {
      const result = await request('tools/call', { name, arguments: args });
      return { error: Boolean(result.isError), value: result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text) };
    },
    async call(name, args = {}, expectError = false) {
      const result = await request('tools/call', { name, arguments: args });
      const value = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
      assert.equal(Boolean(result.isError), expectError, `${name}: ${expectError ? 'expected rejection' : JSON.stringify(value).slice(0, 250)}`);
      return value;
    },
    async close() {
      if (closed) return;
      child.stdin.end();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(1500)]);
      if (!closed) child.kill();
      failAll(new Error('MCP test ended'));
    }
  };
}

export async function runAgentMcpSmoke({ window, runtime, getState }) {
  const checks = [], files = [], rendererErrors = []; let mcp, preview;
  const check = name => checks.push(name);
  const inspect = script => window.webContents.executeJavaScript(script);
  const waitUntil = async (predicate, label) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await predicate()) return; await delay(50); }
    throw new Error(`Timed out: ${label}`);
  };
  window.webContents.on('console-message', (_, level, message) => { if (level >= 3) rendererErrors.push(message); });
  const recordFile = async (kind, filePath) => {
    const relative = path.relative(runtime, filePath);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'test files must stay within its isolated runtime');
    const bytes = await readFile(filePath); files.push({ kind, path: filePath, bytes: bytes.length, sha256: sha256(bytes) }); return bytes;
  };
  try {
    assert.equal(window.isVisible(), false, 'integration tests must not show a desktop window');
    assert.equal(getState().project.pages.length, 1);
    assert.equal(getState().project.pages[0].nodes.length, 0, 'isolated test must start with a blank project');
    await waitUntil(() => inspect("Boolean(document.querySelector('#project-name')?.value)"), 'production renderer loaded');
    mcp = startMcp(getState().agent.connectionFile);
    const initialized = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'yuanda-desktop-integration', version: '1.0.0' } });
    assert.ok(initialized.serverInfo?.name);
    assert.equal(initialized.serverInfo.version, JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, 'MCP handshake must identify the packaged application version');
    mcp.notify('notifications/initialized');
    const tools = (await mcp.request('tools/list')).tools.map(tool => tool.name);
    for (const name of ['yuanda_get_state','yuanda_get_schema','yuanda_apply_commands','yuanda_validate_commands','yuanda_select','yuanda_get_selection','yuanda_undo','yuanda_redo','yuanda_save','yuanda_export']) assert.ok(tools.includes(name), `missing MCP tool ${name}`);
    check('standard-stdio-mcp-initialize-and-tools-list');
    const schema = await mcp.call('yuanda_get_schema'); assert.ok(schema.commands.some(value => value.startsWith('addNode')));
    const initial = await mcp.call('yuanda_get_state'), pageId = initial.project.pages[0].id, targetPageId = 'mcp-test-page-two';
    assert.deepEqual(initial.project, getState().project); assert.equal(initial.revision, getState().revision);
    const commands = [
      { type: 'renameProject', name: 'MCP 真实桌面集成验证' },
      { type: 'addPage', page: { id: targetPageId, name: 'Agent 目标页' } },
      { type: 'addNode', pageId: targetPageId, node: { id: 'mcp-target-text', type: 'text', text: 'Agent 跳转成功', x: 90, y: 100 } },
      { type: 'addNode', pageId, node: { id: 'mcp-title', type: 'text', text: '等待 Agent 修改', x: 80, y: 60, width: 420 } },
      { type: 'addNode', pageId, node: { id: 'mcp-button', type: 'button', text: 'Agent 创建的跳转', x: 80, y: 160, width: 240, rotation: 12, interactions: [{ event: 'click', actions: [{ type: 'navigate', pageId: targetPageId }] }] } },
      { type: 'addNode', pageId, node: { id: 'mcp-image', type: 'image', src: imageSource, x: 80, y: 260, width: 240, height: 160 } }
    ];
    const validated = await mcp.call('yuanda_validate_commands', { expectedRevision: initial.revision, commands });
    assert.equal(validated.valid, true); assert.equal(getState().revision, initial.revision); assert.deepEqual(getState().project, initial.project);
    check('mcp-preflight-does-not-mutate-production-engine');
    await mcp.call('yuanda_apply_commands', { expectedRevision: initial.revision, label: 'MCP 批量创建', commands });
    let state = await mcp.call('yuanda_get_state'); assert.equal(state.project.pages.length, 2); assert.equal(state.project.pages[0].nodes.length, 3);
    const created = structuredClone(state.project);
    await mcp.call('yuanda_apply_commands', { expectedRevision: state.revision, commands: [
      { type: 'updateNode', pageId, nodeId: 'mcp-title', patch: { text: 'Agent 已直接修改桌面画布', x: 120 } },
      { type: 'updateNode', pageId, nodeId: 'mcp-button', patch: { style: { fill: '#0055AA' } } }
    ] });
    state = await mcp.call('yuanda_get_state'); const edited = structuredClone(state.project);
    await waitUntil(() => inspect("document.querySelector('.design-node[data-node-id=\"mcp-title\"]')?.textContent.includes('Agent 已直接修改桌面画布')"), 'MCP changes render in real desktop');
    assert.equal(await inspect("document.querySelector('.design-node[data-node-id=\"mcp-title\"]').style.left"), '120px');
    check('mcp-batch-add-and-edit-reaches-real-renderer');
    const rejected = await mcp.call('yuanda_apply_commands', { expectedRevision: initial.revision, commands: [{ type: 'renameProject', name: 'must-not-write' }] }, true);
    assert.equal(rejected.code, 'REVISION_CONFLICT'); assert.deepEqual(getState().project, edited);
    check('stale-agent-revision-rejected-without-mutation');
    await mcp.call('yuanda_select', { expectedRevision: state.revision, pageId, nodeIds: ['mcp-button'] });
    const selection = await mcp.call('yuanda_get_selection'); assert.deepEqual(selection.nodeIds ?? selection.selection?.nodeIds, ['mcp-button']);
    assert.deepEqual(getState().selection, { pageId, nodeIds: ['mcp-button'] });
    await waitUntil(() => inspect("document.querySelector('#selection-overlay .selection-rect')?.style.transform === 'rotate(12deg)'"), 'MCP selection appears in editor');
    check('mcp-selection-reaches-production-state-and-renderer');
    await mcp.call('yuanda_undo', { expectedRevision: state.revision });
    state = await mcp.call('yuanda_get_state'); assert.deepEqual(state.project, created);
    await mcp.call('yuanda_redo', { expectedRevision: state.revision });
    state = await mcp.call('yuanda_get_state'); assert.deepEqual(state.project, edited);
    check('mcp-undo-redo-uses-same-history');
    const saved = await mcp.call('yuanda_save', { expectedRevision: state.revision, name: 'Agent完整工程' });
    assert.equal(saved.ok, true); const savedBytes = await recordFile('editable-project', saved.path);
    assert.deepEqual(JSON.parse(savedBytes.toString('utf8')), edited); assert.equal(getState().dirty, false);
    const savedAgain = await mcp.call('yuanda_save', { expectedRevision: state.revision, name: 'Agent完整工程' });
    assert.notEqual(savedAgain.path, saved.path, 'named saves must not overwrite an existing file');
    assert.deepEqual(await readFile(saved.path), savedBytes); await recordFile('second-editable-project', savedAgain.path);
    check('mcp-save-real-files-without-dialog-or-overwrite');
    const html = await mcp.call('yuanda_export', { expectedRevision: state.revision, format: 'html', name: 'Agent交互演示' });
    assert.equal(html.ok, true); const htmlBytes = await recordFile('interactive-html', html.path);
    assert.ok(htmlBytes.includes(Buffer.from('Agent 已直接修改桌面画布')));
    const rp = await mcp.call('yuanda_export', { expectedRevision: state.revision, format: 'rp', name: 'Agent原生RP' });
    assert.equal(rp.ok, true); const rpBytes = await recordFile('native-rp', rp.path);
    assert.equal(rpBytes.subarray(0, 4).toString('hex'), 'acef0b00', 'RP must be an actual indexed object container, not renamed JSON');
    check('mcp-html-and-native-rp-export-real-files');
    const { BrowserWindow } = await import('electron');
    preview = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    await preview.loadFile(html.path);
    const previewJs = script => preview.webContents.executeJavaScript(script);
    await waitUntil(() => previewJs("Boolean(document.querySelector('[data-node-id=\"mcp-button\"]'))"), 'exported HTML initial page');
    await waitUntil(() => previewJs("[...document.querySelectorAll('[data-node-id=\"mcp-image\"] img')].some(image => image.complete && image.naturalWidth === 240 && image.naturalHeight === 160)"), 'exported HTML PNG decoded');
    assert.equal(await previewJs('typeof window.require'), 'undefined');
    await previewJs("document.querySelector('[data-node-id=\"mcp-button\"]').click()");
    await waitUntil(() => previewJs("document.querySelector('[data-node-id=\"mcp-target-text\"]')?.textContent.includes('Agent 跳转成功')"), 'exported HTML navigation');
    check('exported-html-runs-and-navigates-offline');
    await writeFile(path.join(runtime, 'mcp-html.png'), (await preview.webContents.capturePage()).toPNG());
    preview.destroy(); preview = null;
    const beforeRejectedExport = await readdir(path.dirname(rp.path));
    await mcp.call('yuanda_apply_commands', { expectedRevision: state.revision, commands: [{ type: 'addNode', pageId, node: { id: 'mcp-unsupported-input', type: 'input' } }] });
    state = await mcp.call('yuanda_get_state');
    await mcp.call('yuanda_export', { expectedRevision: state.revision, format: 'rp', name: '不得静默丢失输入框' }, true);
    assert.deepEqual(await readdir(path.dirname(rp.path)), beforeRejectedExport, 'unsupported RP export must not leave a partial deliverable');
    await mcp.call('yuanda_undo', { expectedRevision: state.revision });
    assert.deepEqual(getState().project, edited);
    check('unsupported-rp-content-blocked-before-file-write');
    state = await mcp.call('yuanda_get_state');
    await mcp.call('yuanda_select', { expectedRevision: state.revision, pageId, nodeIds: ['mcp-title'] });
    await waitUntil(() => inspect("document.querySelector('#selection-overlay .selection-rect')?.style.left === '120px'"), 'title selected before pending draft');
    await inspect("document.querySelector('.design-node[data-node-id=\"mcp-title\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); document.querySelector('.inline-editor').value='用户尚未提交的文字草稿'");
    const beforeDraftExport = await readdir(path.dirname(rp.path));
    const draftExport = await mcp.call('yuanda_export', { expectedRevision: state.revision, format: 'html', name: '不得保存过时版本' }, true);
    assert.equal(draftExport.code, 'REVISION_CONFLICT');
    assert.equal(getState().project.pages[0].nodes.find(node => node.id === 'mcp-title').text, '用户尚未提交的文字草稿');
    assert.deepEqual(await readdir(path.dirname(rp.path)), beforeDraftExport);
    await mcp.call('yuanda_undo', { expectedRevision: getState().revision });
    assert.deepEqual(getState().project, edited);
    check('pending-user-draft-flushes-then-stale-export-is-rejected');
    // Hold the real renderer flush briefly to exercise file-operation exclusion.
    // Only this test window is instrumented; the actual production guards run.
    await inspect("window.__mcpOriginalFlush=window.YuandaEditor.flushPendingEdits; window.YuandaEditor.flushPendingEdits=async()=>{await new Promise(resolve=>setTimeout(resolve,100));return window.__mcpOriginalFlush();}; void 0");
    try {
      const revision = getState().revision;
      const pair = await Promise.all(['A','B'].map(suffix => mcp.callResult('yuanda_export', { expectedRevision: revision, format: 'html', name: `互斥导出${suffix}` })));
      assert.equal(pair.filter(result => !result.error).length, 1); assert.equal(pair.find(result => result.error)?.value.code, 'BUSY');
      await recordFile('exclusive-export', pair.find(result => !result.error).value.path);
      assert.deepEqual(getState().project, edited);
      check('concurrent-file-operations-are-excluded-during-renderer-flush');
    } finally { await inspect("window.YuandaEditor.flushPendingEdits=window.__mcpOriginalFlush; delete window.__mcpOriginalFlush"); }
    await mcp.call('yuanda_apply_commands', { expectedRevision: getState().revision, commands: [{ type: 'renameProject', name: 'IO失败仍保留这项修改' }] });
    const beforeIoFailure = getState(), activeFile = beforeIoFailure.filePath, backupFile = `${activeFile}.io-test-original`;
    assert.ok(path.relative(runtime, activeFile) && !path.relative(runtime, activeFile).startsWith('..'));
    await rename(activeFile, backupFile); let collisionCreated = false;
    try {
      await mkdir(activeFile); collisionCreated = true;
      await mcp.call('yuanda_save', { expectedRevision: beforeIoFailure.revision }, true);
      const failed = getState();
      assert.deepEqual(failed.project, beforeIoFailure.project); assert.equal(failed.revision, beforeIoFailure.revision);
      assert.equal(failed.filePath, activeFile); assert.equal(failed.dirty, true);
      check('save-io-failure-preserves-project-path-revision-and-dirty-state');
    } finally { if (collisionCreated) await rmdir(activeFile); await rename(backupFile, activeFile); }
    await mcp.call('yuanda_undo', { expectedRevision: getState().revision });
    assert.deepEqual(getState().project, edited); assert.equal(getState().dirty, false);
    await waitUntil(() => inspect("Boolean(document.querySelector('.design-node[data-node-id=\"mcp-title\"]'))"), 'editor final state');
    await writeFile(path.join(runtime, 'mcp-editor.png'), (await window.webContents.capturePage()).toPNG());
    assert.deepEqual(rendererErrors, []);
    const report = { ok: true, protocolVersion: initialized.protocolVersion, server: initialized.serverInfo, checks, files, rendererErrors,
      note: 'Actual hidden Electron production main, authenticated localhost API and standard stdio MCP child. UI readback and offline HTML execution are real; no vendor Axure process or client MCP discovery is claimed by this test.' };
    await writeFile(path.join(runtime, reportName), JSON.stringify(report, null, 2)); return report;
  } catch (error) {
    await writeFile(path.join(runtime, reportName), JSON.stringify({ ok: false, checks, files, rendererErrors, error: error.stack }, null, 2)); throw error;
  } finally { preview?.destroy(); await mcp?.close(); }
}

async function launch() {
  const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const portable = process.argv.includes('--portable'), build = path.join(root, 'dist', `原搭-${packageInfo.version}`);
  const id = `${Date.now()}-${process.pid}`, runtime = path.join(portable ? build : root, portable ? 'data' : '.local/yuanda-runtime', 'agent-smoke', id);
  await mkdir(path.join(root, '.local/tmp'), { recursive: true });
  const target = portable ? releaseLayout(build).executable : electronExecutable(root);
  const args = [...(portable ? [] : [root]), '--yuanda-agent-smoke', `--yuanda-agent-smoke-id=${id}`];
  const env = { ...process.env, TEMP: path.join(root, '.local/tmp'), TMP: path.join(root, '.local/tmp'), TMPDIR: path.join(root, '.local/tmp') }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(target, args, { cwd: root, windowsHide: true, stdio: 'inherit', env });
  const timer = setTimeout(() => { child.kill(); console.error('MCP desktop integration exceeded 90 seconds'); }, 90000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    let report;
    try { report = JSON.parse(await readFile(path.join(runtime, reportName), 'utf8')); }
    catch (error) { throw new Error(`Electron exited with code ${code} without an integration report at ${path.join(runtime, reportName)}: ${error.message}`); }
    console.log(JSON.stringify({ ok: report.ok, checks: report.checks, files: report.files, error: report.error, report: path.join(runtime, reportName) }, null, 2));
    process.exitCode = code === 0 && report.ok ? 0 : 1;
  } finally { clearTimeout(timer); }
}

if (!process.versions.electron) await launch();
