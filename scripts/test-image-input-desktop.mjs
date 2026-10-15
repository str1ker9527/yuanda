import { electronExecutable } from './platform-runtime.mjs';
/** Production IPC + real sandbox decoders; OS clipboard is replaced by an in-memory adapter. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, '.local/image-input-desktop');
await mkdir(output, { recursive: true });
if (!process.versions.electron) {
  const { spawn } = await import('node:child_process'), directory = await mkdtemp(path.join(output, 'run-'));
  await cp(path.join(root, 'app'), path.join(directory, 'app'), { recursive: true });
  const main = path.join(directory, 'app/main.mjs'); await writeFile(main, (await readFile(main, 'utf8')).replaceAll('new BrowserWindow(', 'new globalThis.__ImageWindow('));
  const temporary = path.join(root, '.local/tmp'); await mkdir(temporary, { recursive: true });
  const code = await new Promise(resolve => { const child = spawn(electronExecutable(root), [fileURLToPath(import.meta.url), '--test-root', directory], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary } }); const timer = setTimeout(() => child.kill(), 110000); child.once('error', error => { clearTimeout(timer); console.error(error); resolve(1); }); child.once('exit', code => { clearTimeout(timer); resolve(code); }); });
  const result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8').catch(() => '{"ok":false}')); await writeFile(path.join(output, 'result.json'), JSON.stringify({ ...result, directory }, null, 2)); console.log(JSON.stringify({ ok: result.ok, checks: result.checks, error: result.error, evidence: path.join(output, 'result.json') }, null, 2)); process.exitCode = code === 0 && result.ok ? 0 : 1;
} else {
  const directory = process.argv[process.argv.indexOf('--test-root') + 1]; assert(path.resolve(directory).startsWith(output + path.sep));
  const { app, BrowserWindow, dialog, clipboard, ClipboardItem, session } = createRequire(import.meta.url)('electron');
  // Never invoke the real clipboard adapter: all representations remain test-owned.
  const actualRead = clipboard.read, actualWrite = clipboard.write; let clipItems = [];
  clipboard.read = async () => clipItems; clipboard.write = async items => { clipItems = items; };
  let window, openResult = { canceled: true, filePaths: [] }, holdOpen = false, resolveOpen, messages = 0;
  const checks = [], errors = [], delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async fn => { for (let i = 0; i < 240; i++) { if (await fn()) return; await delay(25); } throw new Error('等待图片桌面检查超时'); };
  globalThis.__ImageWindow = class extends BrowserWindow { constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }); window = this; } };
  dialog.showOpenDialog = async () => holdOpen ? new Promise(resolve => resolveOpen = resolve) : openResult;
  dialog.showMessageBox = async () => { messages++; return { response: 2 }; };
  const js = code => window.webContents.executeJavaScript(code), call = (name, ...args) => js(`window.yuanda.${name}(${args.map(value => JSON.stringify(value)).join(',')})`), state = () => call('getState');
  const failed = async (name, ...args) => { try { await call(name, ...args); } catch (error) { return error.message; } throw new Error(`应拒绝 ${name}`); };
  async function check(name, run) { await run(); checks.push({ name, ok: true }); }
  let base, context, assets, files;
  async function run() {
    await import(pathToFileURL(path.join(directory, 'app/main.mjs')).href); await wait(() => window && !window.webContents.isLoading() && js('!!window.YuandaEditor?.getState()'));
    base = await state(); context = { projectId: base.project.id, expectedRevision: base.revision };
    const raster = await js(`(()=>{const c=document.createElement('canvas');c.width=7;c.height=5;const x=c.getContext('2d');x.fillStyle='#d02030';x.fillRect(0,0,7,5);return Object.fromEntries(['png','jpeg','webp'].map(type=>[type,c.toDataURL('image/'+type)]));})()`);
    const bmp = Buffer.alloc(78); bmp.write('BM'); bmp.writeUInt32LE(78, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(3, 18); bmp.writeInt32LE(2, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.fill(200, 54);
    const gif = Buffer.from('47494638396102000100800000ff00000000ff21f904000a0000002c0000000002000100000202040a0021f904000a0000002c00000000020001000002024c0a003b', 'hex');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 9"><defs><linearGradient id="g"><stop stop-color="#111"/><stop offset="1" stop-color="#eee"/></linearGradient></defs><rect width="13" height="9" fill="url(#g)"/></svg>');
    files = {};
    for (const [format, bytes] of Object.entries({ ...Object.fromEntries(Object.entries(raster).map(([format, src]) => [format, Buffer.from(src.split(',')[1], 'base64')])), bmp, gif, svg })) { const file = path.join(directory, `own.${format}`); await writeFile(file, bytes); files[format] = file; }
    assets = {};
    await check('six-formats-real-dialog-ipc-and-sandbox-decode', async () => {
      for (const format of Object.keys(files)) { openResult = { canceled: false, filePaths: [files[format]] }; const asset = await call('importImage', context); assets[format] = asset;
        assert.equal(asset.sourceFormat, format); assert.equal(asset.converted, ['bmp','svg'].includes(format)); assert.equal(asset.projectId, base.project.id); assert.equal(asset.revision, base.revision); assert(asset.naturalWidth > 0 && asset.naturalHeight > 0);
        assert.equal(asset.naturalWidth, format === 'bmp' ? 3 : format === 'gif' ? 2 : format === 'svg' ? 13 : 7);
        if (format === 'gif') { assert.equal(asset.animated, true); assert.deepEqual(Buffer.from(asset.src.split(',')[1], 'base64'), gif); }
      }
      assert.deepEqual((await state()).project, base.project); assert.equal((await state()).revision, base.revision);
    });
    await check('jpeg-exif-natural-size-and-corrupt-pixels-real-decode', async () => {
      const jpeg = await readFile(files.jpeg), exif = Buffer.alloc(36); exif[0] = 255; exif[1] = 225; exif.writeUInt16BE(34, 2); exif.write('Exif\0\0', 4); exif.write('II', 10); exif.writeUInt16LE(42, 12); exif.writeUInt32LE(8, 14); exif.writeUInt16LE(1, 18); exif.writeUInt16LE(0x112, 20); exif.writeUInt16LE(3, 22); exif.writeUInt32LE(1, 24); exif.writeUInt16LE(6, 28);
      const file = path.join(directory, 'rotated.jpeg'); await writeFile(file, Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)])); openResult = { canceled: false, filePaths: [file] }; const asset = await call('importImage', context); assert.equal(asset.naturalWidth, 5); assert.equal(asset.naturalHeight, 7);
      const broken = Buffer.from(await readFile(files.png)); let p = 8; while (p < broken.length) { const size = broken.readUInt32BE(p); if (broken.toString('ascii', p + 4, p + 8) === 'IDAT') { broken.fill(0, p + 8, p + 8 + size); break; } p += 12 + size; }
      const damaged = path.join(directory, 'damaged.png'); await writeFile(damaged, broken); openResult = { canceled: false, filePaths: [damaged] }; assert.match(await failed('importImage', context), /损坏|解码/);
    });
    await check('gif-original-bytes-animate-in-real-chromium', async () => {
      const viewer = new BrowserWindow({ show: false, width: 90, height: 60, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
      try {
        await viewer.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0"><img width="80" height="40" src="${assets.gif.src}"></body>`));
        const colors = new Set(); for (let i = 0; i < 8; i++) { await delay(65); const bitmap = (await viewer.webContents.capturePage({ x: 1, y: 1, width: 1, height: 1 })).toBitmap(); colors.add(bitmap.subarray(0, 3).toString('hex')); }
        assert(colors.size >= 2, 'GIF 应实际显示至少两种动画帧颜色');
      } finally { viewer.destroy(); }
    });
    await check('svg-static-profile-blocks-code-external-recursion-and-excessive-size', async () => {
      const bad = ['<script>alert(1)</script>','<foreignObject/>','<image href="https://example.invalid/a.png"/>','<rect onclick="alert(1)"/>','<use id="loop" href="#loop"/>','<style>@import url(https://example.invalid/a.css);</style>'];
      for (const child of bad) { const file = path.join(directory, 'bad.svg'); await writeFile(file, `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${child}</svg>`); openResult = { canceled: false, filePaths: [file] }; await failed('importImage', context); }
      const huge = path.join(directory, 'huge.svg'); await writeFile(huge, '<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="1"/>'); openResult = { canceled: false, filePaths: [huge] }; assert.match(await failed('importImage', context), /8192/);
    });
    await check('real-file-object-drop-preload-and-fake-file-rejection', async () => {
      await js('(()=>{const i=document.createElement("input");i.type="file";i.id="image-test-file";i.multiple=true;document.body.append(i)})()');
      window.webContents.debugger.attach('1.3'); const { root: dom } = await window.webContents.debugger.sendCommand('DOM.getDocument'); const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: dom.nodeId, selector: '#image-test-file' });
      await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [files.png, files.gif] });
      const result = await js(`window.yuanda.importDroppedImages([...document.querySelector('#image-test-file').files],${JSON.stringify(context)})`); assert.equal(result.images.length, 2); assert.equal(result.images[1].animated, true); window.webContents.debugger.detach();
      await assert.rejects(js(`window.yuanda.importDroppedImages([new File(['x'],'fake.png')],${JSON.stringify(context)})`), /真实图片/);
      await assert.rejects(js(`window.yuanda.importDroppedImages(['${files.png.replaceAll('\\','/')}'],${JSON.stringify(context)})`));
    });
    await check('clipboard-token-priority-and-png-copy-through-production-ipc', async () => {
      const { token } = await call('markInternalClipboard', { projectId: base.project.id }); assert.equal((await call('readPasteSource', { ...context, internalToken: token })).kind, 'internal');
      clipItems = [new ClipboardItem({ 'image/gif': new Blob([gif], { type: 'image/gif' }) })]; const copied = await call('readPasteSource', { ...context, internalToken: token }); assert.equal(copied.kind, 'images'); assert.equal(copied.images[0].animated, true);
      clipItems = [new ClipboardItem({ 'text/plain': 'test-only' })]; assert.equal((await call('readPasteSource', { ...context, internalToken: token })).kind, 'empty');
      await call('writeClipboardImage', { src: assets.png.src }); assert(clipItems[0].types.includes('image/png')); assert.equal((await call('readPasteSource', context)).kind, 'images');
      assert.match(await failed('writeClipboardImage', { src: assets.gif.src }), /PNG/); assert.equal((await state()).revision, base.revision);
    });
    await check('dialog-cancel-revision-conflict-close-and-live-agent-race', async () => {
      openResult = { canceled: true, filePaths: [] }; assert.equal(await call('importImage', context), null); await failed('importImage', { ...context, expectedRevision: context.expectedRevision + 1 });
      holdOpen = true; const pending = call('importImage', context); await wait(() => !!resolveOpen);
      const connection = JSON.parse(await readFile(base.agent.connectionFile, 'utf8')); const response = await fetch(connection.url + '/v1/commands', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: base.revision, commands: [{ type: 'renameProject', name: 'must not write' }] }) }); assert.equal(response.status, 400); assert.equal((await response.json()).code, 'BUSY');
      assert.match(await failed('readPasteSource', context), /当前文件窗口/); window.close(); await delay(40); assert.equal(window.isDestroyed(), false); assert.equal(messages, 0);
      resolveOpen({ canceled: true, filePaths: [] }); assert.equal(await pending, null); holdOpen = false; assert.deepEqual((await state()).project, base.project);
    });
    await check('untrusted-window-ipc-is-rejected-and-decode-timeout-disposes-worker', async () => {
      const alien = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(directory, 'app/preload.cjs') } });
      await alien.loadURL('data:text/html,test'); await assert.rejects(alien.webContents.executeJavaScript(`window.yuanda.readPasteSource(${JSON.stringify(context)})`), /无效窗口/); alien.destroy();
      const { createChromiumImageDecoder, inspectImageBytes } = await import('../app/image-input.mjs'); const before = BrowserWindow.getAllWindows().length;
      await assert.rejects(createChromiumImageDecoder({ BrowserWindow, session, timeoutMs: 1 })(gif, inspectImageBytes(gif))); assert.equal(BrowserWindow.getAllWindows().length, before);
    });
  }
  async function finish(ok, error) { clipboard.read = actualRead; clipboard.write = actualWrite; await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok, checks, errors, error: error?.stack, coverage: '真实 Electron 主进程、生产 preload/IPC、隐藏 Chromium 六格式解码、真实磁盘 File 对象（CDP file input）、Agent HTTP/关闭互斥。文件对话框返回测试路径；OS 剪贴板全程以内存 adapter 隔离，未读取/写入用户剪贴板，不代表真实 OS 格式桥已经验收。' }, null, 2)); app.exit(ok ? 0 : 1); }
  void run().then(() => finish(true)).catch(error => finish(false, error));
}
