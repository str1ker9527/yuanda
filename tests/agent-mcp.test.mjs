import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAgentServer } from '../app/agent-server.mjs';
import { createBlankProject, DocumentEngine } from '../app/core/document.mjs';
import { exportHtml } from '../app/core/html-export.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(root, '.local/agent-mcp-tests');

async function fixture(t, { extended = false } = {}) {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, 'run-'));
  const connectionFile = path.join(directory, 'connection.json');
  const project = createBlankProject('MCP 协议验收'); project.id = 'mcp-project'; project.pages[0].id = 'mcp-page';
  const engine = new DocumentEngine(project);
  let selection = { pageId: 'mcp-page', nodeIds: [] };
  const state = () => ({ project: engine.getSnapshot(), revision: engine.revision, canUndo: engine.canUndo, canRedo: engine.canRedo, selection: structuredClone(selection), agent: { capabilities: extended ? ['validate', 'selection', 'save', 'export'] : [] } });
  const server = await startAgentServer({ connectionFile, getState: state,
    command: body => { engine.apply(body.commands, body); return state(); },
    undo: () => { engine.undo(); return state(); }, redo: () => { engine.redo(); return state(); },
    libraryList: async () => ({ libraries: [{ id: 'basic', name: '测试库' }], errors: [] }),
    libraryRead: async id => ({ library: { id, name: '测试库', items: [] }, revision: 'test-library-revision' }),
    // Real model/file callbacks verify stdio→HTTP forwarding; the desktop smoke separately tests main.mjs policy.
    validate: extended ? body => { const copy = new DocumentEngine(engine.getSnapshot()); copy.apply(body.commands); return { valid: true, revision: engine.revision, count: body.commands.length }; } : undefined,
    select: extended ? body => { selection = { pageId: body.pageId, nodeIds: body.nodeIds }; return state(); } : undefined,
    save: extended ? async body => { const target = path.join(directory, `${body.name || 'saved'}.yuanda`); await writeFile(target, JSON.stringify(engine.getSnapshot()), { flag: 'wx' }); return { ok: true, path: target, revision: engine.revision }; } : undefined,
    exportFile: extended ? async body => { assert.equal(body.format, 'html'); const target = path.join(directory, `${body.name || 'export'}.html`); await writeFile(target, exportHtml(engine.getSnapshot()), { flag: 'wx' }); return { ok: true, path: target, revision: engine.revision, format: body.format }; } : undefined
  });
  const connection = JSON.parse(await readFile(connectionFile, 'utf8'));
  const child = spawn(process.execPath, [path.join(root, 'scripts/yuanda-mcp.mjs'), '--connection', connectionFile], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map(); let nextId = 0, buffer = '', stdout = '', stderr = '', failure;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    stdout += chunk; buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { failure = new Error('MCP stdout 出现非 JSON 协议内容'); for (const item of pending.values()) item.reject(failure); pending.clear(); continue; }
      const item = pending.get(message.id);
      if (item) { clearTimeout(item.timer); pending.delete(message.id); item.resolve(message); }
    }
  });
  child.on('error', error => { failure = error; for (const item of pending.values()) item.reject(error); pending.clear(); });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => {
    failure ||= new Error(`MCP 子进程提前退出 (${code ?? signal})`);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(failure); }
    pending.clear(); resolve({ code, signal });
  }));
  t.after(async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 3000);
    await exited; clearTimeout(timer);
    await server.close();
    assert(!stdout.includes(connection.token), '协议响应不可泄漏连接令牌');
    assert(!stderr.includes(connection.token), '错误日志不可泄漏连接令牌');
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(testRoot) + path.sep)) throw new Error('测试清理目录越界');
    await rm(resolved, { recursive: true, force: true });
  });
  function rpc(method, params = {}) {
    if (failure) return Promise.reject(failure);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} 超时`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  function notify(method, params = {}) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  const initialize = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'yuanda-real-stdio-test', version: '1.0.0' } });
  assert.equal(initialize.result?.serverInfo?.name, 'yuanda', JSON.stringify(initialize));
  notify('notifications/initialized');
  async function call(name, args = {}) { const response = await rpc('tools/call', { name, arguments: args }); assert(!response.error, JSON.stringify(response.error)); return response.result; }
  return { engine, state, rpc, call, initialize, connection, connectionFile, directory, getStderr: () => stderr };
}

function data(result) { assert(!result.isError, result.content?.[0]?.text); const value = JSON.parse(result.content[0].text); assert.deepEqual(value, result.structuredContent); return value; }

test('标准 MCP initialize/tools/list 和真实 state/schema/selection/library 调用可发现当前项目', async t => {
  const f = await fixture(t);
  assert.equal(f.initialize.result.protocolVersion, '2025-11-25');
  const listed = (await f.rpc('tools/list')).result.tools;
  assert.equal(listed.length, 12);
  for (const name of ['yuanda_apply_commands', 'yuanda_validate_commands', 'yuanda_select', 'yuanda_save', 'yuanda_export']) assert(listed.some(tool => tool.name === name));
  const edit = listed.find(tool => tool.name === 'yuanda_apply_commands');
  assert(edit.inputSchema.required.includes('expectedRevision')); assert.equal(edit.inputSchema.additionalProperties, false);
  assert.equal(listed.find(tool => tool.name === 'yuanda_get_state').annotations.readOnlyHint, true);
  assert.equal(edit.annotations.openWorldHint, false);
  const state = data(await f.call('yuanda_get_state')); assert.equal(state.project.name, 'MCP 协议验收'); assert.equal(state.revision, 0);
  const schema = data(await f.call('yuanda_get_schema')); assert(schema.commands.some(command => command.startsWith('addNode ')));
  assert.deepEqual(data(await f.call('yuanda_get_selection')), { projectId: 'mcp-project', revision: 0, selection: { pageId: 'mcp-page', nodeIds: [] } });
  assert.equal(data(await f.call('yuanda_list_libraries')).libraries[0].id, 'basic');
  assert.equal(data(await f.call('yuanda_get_library', { libraryId: 'basic' })).library.id, 'basic');
  assert.equal(f.getStderr(), '');
});

test('MCP 批量编辑真正进入共享引擎，可撤销重做，陈旧版本拒绝且失败整批回滚', async t => {
  const f = await fixture(t), original = f.state();
  const changed = data(await f.call('yuanda_apply_commands', { expectedRevision: 0, label: 'MCP 实际编辑', commands: [
    { type: 'renameProject', name: 'Agent 已直接改动' },
    { type: 'addNode', pageId: 'mcp-page', node: { id: 'mcp-button', type: 'button', text: '由标准 MCP 写入' } }
  ] }));
  assert.equal(changed.revision, 1); assert.equal(f.engine.getSnapshot().pages[0].nodes[0].text, '由标准 MCP 写入');
  const stale = await f.call('yuanda_apply_commands', { expectedRevision: 0, commands: [{ type: 'renameProject', name: '旧版不应写入' }] });
  assert.equal(stale.isError, true); assert.equal(stale.structuredContent.code, 'REVISION_CONFLICT'); assert.deepEqual(f.state(), changed);
  const invalid = await f.call('yuanda_apply_commands', { expectedRevision: 1, commands: [
    { type: 'renameProject', name: '不可部分保留' },
    { type: 'addNode', pageId: 'mcp-page', node: { id: 'bad', type: 'button', width: -10 } }
  ] });
  assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent.code, 'VALIDATION_ERROR'); assert.deepEqual(f.state(), changed);
  const undone = data(await f.call('yuanda_undo', { expectedRevision: 1 })); assert.deepEqual(undone.project, original.project); assert.equal(undone.revision, 2);
  const redone = data(await f.call('yuanda_redo', { expectedRevision: 2 })); assert.deepEqual(redone.project, changed.project); assert.equal(redone.revision, 3);
});

test('MCP 拒绝错误令牌、不丢状态，下一次调用重新读取已修复的连接文件', async t => {
  const f = await fixture(t), before = f.state();
  const badToken = '1'.repeat(64);
  await writeFile(f.connectionFile, JSON.stringify({ ...f.connection, token: badToken }));
  const read = await f.call('yuanda_get_state'); assert.equal(read.isError, true); assert.equal(read.structuredContent.code, 'UNAUTHORIZED');
  const write = await f.call('yuanda_apply_commands', { expectedRevision: 0, commands: [{ type: 'renameProject', name: '不该修改' }] });
  assert.equal(write.isError, true); assert.equal(write.structuredContent.code, 'UNAUTHORIZED'); assert.deepEqual(f.state(), before);
  assert(!JSON.stringify([read, write]).includes(badToken));
  await writeFile(f.connectionFile, JSON.stringify(f.connection));
  assert.deepEqual(data(await f.call('yuanda_get_state')), before);
});

test('MCP 拒绝连接文件中的非回环 URL 与损坏数据，不暴露原始令牌', async t => {
  const f = await fixture(t), before = f.state();
  for (const url of ['https://example.invalid', 'http://localhost:1234', 'http://127.0.0.1:65536', 'http://127.0.0.1:1234/other', 'http://user@127.0.0.1:1234']) {
    await writeFile(f.connectionFile, JSON.stringify({ ...f.connection, url }));
    const result = await f.call('yuanda_get_state'); assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'INVALID_CONNECTION');
  }
  await writeFile(f.connectionFile, `broken ${f.connection.token}`);
  const corrupt = await f.call('yuanda_get_state'); assert.equal(corrupt.structuredContent.code, 'INVALID_CONNECTION'); assert(!JSON.stringify(corrupt).includes(f.connection.token));
  assert.deepEqual(f.state(), before);
});

test('旧版窗口缺少能力时明确拒绝保存/导出/选区/预检，不虚报成功', async t => {
  const f = await fixture(t), before = f.state();
  for (const [name, args] of [
    ['yuanda_save', { expectedRevision: 0 }], ['yuanda_export', { expectedRevision: 0, format: 'html' }],
    ['yuanda_select', { expectedRevision: 0, pageId: 'mcp-page', nodeIds: [] }],
    ['yuanda_validate_commands', { expectedRevision: 0, commands: [{ type: 'renameProject', name: '检查' }] }]
  ]) { const result = await f.call(name, args); assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'CAPABILITY_UNAVAILABLE'); }
  assert.deepEqual(f.state(), before);
});

test('MCP 输入契约拒绝无版本、额外参数、路径文件名与任意命令工具', async t => {
  const f = await fixture(t), before = f.state();
  for (const [name, args] of [
    ['yuanda_apply_commands', { commands: [{ type: 'renameProject', name: '不该修改' }] }],
    ['yuanda_get_state', { token: 'forbidden' }],
    ['yuanda_save', { expectedRevision: 0, name: '../outside' }],
    ['yuanda_export', { expectedRevision: 0, format: 'html', name: 'D:\\outside' }],
    ['yuanda_get_library', { libraryId: '../file' }]
  ]) { const result = await f.call(name, args); assert.equal(result.isError, true, JSON.stringify(result)); }
  const arbitrary = await f.rpc('tools/call', { name: 'run_shell', arguments: { command: 'anything' } });
  assert(arbitrary.error || arbitrary.result?.isError);
  const shellCommand = await f.call('yuanda_apply_commands', { expectedRevision: 0, commands: [{ type: 'runShell', command: 'anything' }] });
  assert.equal(shellCommand.structuredContent.code, 'COMMAND_ERROR'); assert.deepEqual(f.state(), before);
});

test('新版 HTTP 能力可经 MCP 预检、同步选区、保存及导出，预检与失败不改变文档', async t => {
  const f = await fixture(t, { extended: true }), before = f.state();
  const commands = [{ type: 'addNode', pageId: 'mcp-page', node: { id: 'mcp-visible', type: 'text', text: '已通过标准 MCP 保存' } }];
  assert.deepEqual(data(await f.call('yuanda_validate_commands', { expectedRevision: 0, commands })), { valid: true, revision: 0, count: 1 });
  assert.deepEqual(f.state(), before);
  const invalid = await f.call('yuanda_validate_commands', { expectedRevision: 0, commands: [{ type: 'addNode', pageId: 'mcp-page', node: { type: 'text', width: -1 } }] });
  assert.equal(invalid.isError, true); assert.deepEqual(f.state(), before);
  data(await f.call('yuanda_apply_commands', { expectedRevision: 0, commands }));
  const selected = data(await f.call('yuanda_select', { expectedRevision: 1, pageId: 'mcp-page', nodeIds: ['mcp-visible'] }));
  assert.deepEqual(selected.selection.nodeIds, ['mcp-visible']); assert.equal(selected.revision, 1);
  const saved = data(await f.call('yuanda_save', { expectedRevision: 1, name: 'MCP保存' }));
  assert.deepEqual(JSON.parse(await readFile(saved.path, 'utf8')), f.engine.getSnapshot());
  const html = data(await f.call('yuanda_export', { expectedRevision: 1, format: 'html', name: 'MCP导出' }));
  assert((await readFile(html.path, 'utf8')).includes('已通过标准 MCP 保存')); assert.equal(html.format, 'html');
  const stale = await f.call('yuanda_save', { expectedRevision: 0, name: '旧版本' });
  assert.equal(stale.structuredContent.code, 'REVISION_CONFLICT'); assert.equal(f.engine.revision, 1);
});
