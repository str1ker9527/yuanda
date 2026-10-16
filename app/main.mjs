import { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard, ClipboardItem } from 'electron';
import { mkdir, readFile, writeFile, rename, open, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { DocumentEngine, createDemoProject, createBlankProject, validateProject } from './core/document.mjs';
import { exportHtml } from './core/html-export.mjs';
import { exportRp } from './core/rp-export.mjs';
import { writeAgentArtifact } from './agent-files.mjs';
import { startAgentServer, schema as agentSchema } from './agent-server.mjs';
import { appendFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { LibraryStore } from './library-store.mjs';
import { ImageInputService, createChromiumImageDecoder } from './image-input.mjs';
import { portableBase } from './platform-paths.mjs';
import { getOrderedPages } from './core/page-tree-model.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.dirname(appDir);
const portable = !process.defaultApp;
const base = portable ? portableBase(process.execPath) : sourceRoot;
const smoke = process.argv.includes('--yuanda-smoke');
const agentSmoke = process.argv.includes('--yuanda-agent-smoke');
const agentSmokeId = process.argv.find(value=>value.startsWith('--yuanda-agent-smoke-id='))?.split('=')[1];
if (agentSmoke && !/^[A-Za-z0-9-]{1,100}$/.test(agentSmokeId || '')) throw new Error('Agent 测试必须使用隔离运行编号');
const hiddenSmoke = smoke || agentSmoke;
const runtime = path.join(base, portable ? 'data' : '.local/yuanda-runtime', agentSmoke ? `agent-smoke/${agentSmokeId}` : smoke ? 'smoke' : '');
const exportsDir = agentSmoke ? path.join(runtime, 'exports') : path.join(base, 'exports');
const projectsDir = agentSmoke ? path.join(runtime, 'projects') : path.join(base, portable ? 'projects' : 'samples/yuanda');
const connectionFile = agentSmoke ? path.join(runtime, 'connection.json') : path.join(portable ? runtime : path.join(sourceRoot, '.local/yuanda-agent'), smoke ? 'smoke-connection.json' : 'connection.json');
mkdirSync(runtime, { recursive: true });
const log = message => appendFileSync(path.join(runtime, 'startup.log'), `${new Date().toISOString()} ${message}\n`);
log('starting');
process.on('uncaughtException', error => { log(error.stack); app.exit(1); });
process.on('unhandledRejection', error => { log(error?.stack || String(error)); app.exit(1); });
app.setPath('userData', runtime);
app.setPath('sessionData', path.join(runtime, 'browser'));
app.setPath('logs', path.join(runtime, 'logs'));
app.setName('原搭');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Electron waits for the entry module to finish before emitting ready.
  // Start asynchronously without top-level-await on app.whenReady().
  void bootstrap().catch(error => { log(error.stack); app.exit(1); });
  async function bootstrap() {
  let window, server, quitting = false, closePending = false, closeApproved = false, ioBusy = false, agentFilePending = false, discardOnClose = false;
  let filePath = null, savedDigest = '', selection = { pageId: null, nodeIds: [] }, agentSelectionRevision = 0;
  let agent = { enabled: false, port: null, connectionFile, cliPath: path.join(sourceRoot, 'scripts/yuanda-agent.mjs'), requests: 0, lastActivity: null, capabilities: ['save','export','selection','validate'], mcp: { command: process.execPath, args: [path.join(sourceRoot,'scripts/yuanda-mcp.mjs'),'--connection',connectionFile], env: { ELECTRON_RUN_AS_NODE: '1' } } };
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let initialProject=agentSmoke ? createBlankProject('Agent 集成验收') : createDemoProject();
  if (portable && !hiddenSmoke) {
    try { initialProject=JSON.parse(await readFile(path.join(projectsDir,'原搭-图片与跳转演示.yuanda'),'utf8'));validateProject(initialProject); }
    catch { log('using built-in editable demo');initialProject=createDemoProject(); }
  }
  const engine = new DocumentEngine(initialProject);
  const libraries = new LibraryStore(path.join(runtime, 'libraries'));
  const images = new ImageInputService({ decode: createChromiumImageDecoder({ BrowserWindow, session }), clipboard, ClipboardItem });
  savedDigest = digest(engine.getSnapshot());
  const recoveryFile = path.join(runtime, 'recovery.json');
  if (!hiddenSmoke) {
    try {
      const recovery = JSON.parse(await readFile(recoveryFile, 'utf8'));
      validateProject(recovery.project); engine.replace(recovery.project);
      filePath = typeof recovery.filePath === 'string' ? recovery.filePath : null;
      savedDigest = typeof recovery.savedDigest === 'string' ? recovery.savedDigest : '';
      // A clean old-format recovery stays clean after adding schema defaults.
      if (savedDigest === digest(recovery.project)) savedDigest = digest(engine.getSnapshot());
    } catch (error) { if (error.code !== 'ENOENT') await writeFile(path.join(runtime, 'recovery-error.txt'), `恢复文件未载入：${error.message}\n`); }
  }
  let recoveryTimer, recoveryQueue = Promise.resolve();
  async function atomicWrite(destination, content, backup = false) {
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    if (backup) await copyFile(destination, `${destination}.bak`).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rename(temporary, destination);
  }
  const getState = () => {
    const project = engine.getSnapshot(), selectedPage = project.pages.find(page => page.id === selection.pageId);
    // A folder deletion may remove the selected canvas. Agents must never receive stale page/node IDs.
    const currentSelection = selectedPage
      ? { pageId: selectedPage.id, nodeIds: selection.nodeIds.filter(id => selectedPage.nodes.some(node => node.id === id)) }
      : { pageId: selection.pageId === null ? null : getOrderedPages(project)[0]?.id ?? null, nodeIds: [] };
    selection = currentSelection;
    return { project, revision: engine.revision, canUndo: engine.canUndo, canRedo: engine.canRedo, filePath, dirty: digest(project) !== savedDigest, selection: currentSelection, agentSelectionRevision, agent: { ...agent }, appVersion: app.getVersion() };
  };
  function persist() {
    const value = JSON.stringify({ project: engine.getSnapshot(), filePath, savedDigest });
    recoveryQueue = recoveryQueue.then(() => atomicWrite(recoveryFile, value)).catch(error => writeFile(path.join(runtime, 'save-error.txt'), error.message).catch(() => {}));
    return recoveryQueue;
  }
  function broadcast(persistDocument = true) {
    if (window && !window.isDestroyed()) window.webContents.send('yuanda:state', getState());
    if (persistDocument) { clearTimeout(recoveryTimer); recoveryTimer = setTimeout(persist, 300); }
  }
  function editable() { if (ioBusy || quitting) { const error = new Error('正在处理文件窗口，请完成后再编辑'); error.code = 'BUSY'; throw error; } }
  function command(body) { editable(); engine.apply(body.commands, { expectedRevision: body.expectedRevision, label: body.label || '编辑' }); broadcast(); return getState(); }
  function undo() { editable(); engine.undo(); broadcast(); return getState(); }
  function redo() { editable(); engine.redo(); broadcast(); return getState(); }
  function safeName() { return engine.getSnapshot().name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || '原搭项目'; }
  async function agentFileAction(body, action) {
    editable();
    if (agentFilePending || closePending) throw Object.assign(new Error('正在处理另一项文件操作'), { code:'BUSY' });
    agentFilePending = true;
    try {
      if (window && !await window.webContents.executeJavaScript('window.YuandaEditor.flushPendingEdits()')) throw Object.assign(new Error('请先处理画布中的编辑冲突'), {code:'BUSY'});
      editable();
      if (body.expectedRevision !== engine.revision) throw Object.assign(new Error('项目已变化，请重新读取后操作'), {code:'REVISION_CONFLICT'});
      ioBusy = true;
      return await action(engine.getSnapshot());
    } finally { ioBusy = false; agentFilePending = false; }
  }
  async function agentSave(body) {
    return agentFileAction(body, async project => {
      let target=filePath;
      if (body.name !== undefined || !target) target=await writeAgentArtifact(projectsDir,body.name ?? safeName(),'yuanda',JSON.stringify(project,null,2));
      else await atomicWrite(target,JSON.stringify(project,null,2),true);
      filePath=target;savedDigest=digest(project);broadcast();
      return {ok:true,path:target,revision:engine.revision,format:'yuanda',dirty:false};
    });
  }
  async function agentExport(body) {
    return agentFileAction(body, async project => {
      if (!['html','rp'].includes(body.format)) throw new Error('导出格式必须是 html 或 rp');
      const result=body.format==='rp'?exportRp(project):null;
      const target=await writeAgentArtifact(exportsDir,body.name ?? safeName(),body.format,result?result.data:exportHtml(project));
      return {ok:true,path:target,revision:engine.revision,format:body.format,...(result?{status:result.status,warnings:result.warnings}:{})};
    });
  }
  async function agentSelect(body) {
    return agentFileAction(body, async project => {
      const page=project.pages.find(value=>value.id===body.pageId);
      if (!page || !Array.isArray(body.nodeIds) || body.nodeIds.some(id=>!page.nodes.some(node=>node.id===id))) throw new Error('选区中的页面或元件不存在');
      selection={pageId:page.id,nodeIds:[...new Set(body.nodeIds)]};agentSelectionRevision++;broadcast(false);
      return {selection:structuredClone(selection),revision:engine.revision};
    });
  }
  function imageContext(context, optional = false) {
    const projectId = engine.getSnapshot().id, revision = engine.revision;
    if (!(optional && context === undefined) && (!context || context.projectId !== projectId || context.expectedRevision !== revision)) throw Object.assign(new Error('项目已变化，请重新发起图片操作'), { code: 'REVISION_CONFLICT' });
    return { projectId, revision };
  }
  async function save(as = false) {
    let target = filePath;
    if (as || !target) {
      await mkdir(projectsDir, { recursive: true });
      const result = await dialog.showSaveDialog(window, { title: '保存原搭项目', defaultPath: target || path.join(projectsDir, `${safeName()}.yuanda`), filters: [{ name: '原搭可编辑项目', extensions: ['yuanda'] }] });
      if (result.canceled) return null;
      target = result.filePath;
      if (path.extname(target).toLowerCase() !== '.yuanda') target += '.yuanda';
    }
    const project = engine.getSnapshot();
    await atomicWrite(target, JSON.stringify(project, null, 2), true);
    filePath = target; savedDigest = digest(project); broadcast(); return getState();
  }
  async function mayDiscard(closing = false) {
    if (!getState().dirty) return true;
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: '保存当前修改？', message: '当前项目还有未保存的修改。', buttons: ['保存', '不保存', '取消'], defaultId: 0, cancelId: 2, noLink: true });
    if (response === 2) return false;
    if (closing && response === 1) discardOnClose = true;
    return response === 0 ? !!(await save()) : true;
  }
  const api = {
    getState, command, undo, redo,
    libraryList: () => libraries.list(),
    libraryCreate: options => libraries.create(options),
    libraryEdit: body => libraries.edit(body),
    libraryRemove: body => libraries.remove(body),
    async libraryLoad() {
      const result = await dialog.showOpenDialog(window, {title:'加载原搭元件库',properties:['openFile'],filters:[{name:'原搭元件库',extensions:['yuandalib']}]});
      return result.canceled ? null : libraries.install(result.filePaths[0]);
    },
    librarySaveSelection(body) {
      if(body?.expectedProjectRevision!==engine.revision) {const error=new Error('项目已变化，请重新选择后保存到元件库');error.code='REVISION_CONFLICT';throw error;}
      const {id,expectedRevision,pageId,nodeIds,name,description,folderId}=body;
      return libraries.saveSelection({id,expectedRevision,project:engine.getSnapshot(),pageId,nodeIds,name,description,...(folderId===undefined?{}:{folderId})});
    },
    async libraryReveal({id}) {const record=await libraries.read(id);shell.showItemInFolder(record.path);return {ok:true,path:record.path};},
    async libraryExport({id}) {
      const record=await libraries.read(id),name=record.library.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)||'原搭元件库';
      const result=await dialog.showSaveDialog(window,{title:'导出原搭元件库',defaultPath:path.join(exportsDir,`${name}.yuandalib`),filters:[{name:'原搭元件库',extensions:['yuandalib']}]});
      if(result.canceled)return null;const target=/\.yuandalib$/i.test(result.filePath)?result.filePath:`${result.filePath}.yuandalib`;
      return libraries.export({id,target});
    },
    getSchema: () => agentSchema,
    validateCommands(body) {
      if (body?.expectedRevision !== engine.revision) { const error=new Error('项目已变化，请重新检查这批指令'); error.code='REVISION_CONFLICT'; throw error; }
      const previewEngine = new DocumentEngine(engine.getSnapshot());
      previewEngine.apply(body.commands, {label:'检查指令'});
      return {valid:true,revision:engine.revision,count:body.commands.length};
    },
    async newProject() { if (!await mayDiscard()) return null; engine.replace(createBlankProject()); filePath = null; savedDigest = digest(engine.getSnapshot()); selection = { pageId: null, nodeIds: [] }; broadcast(); return getState(); },
    async openProject() {
      if (!await mayDiscard()) return null;
      const result = await dialog.showOpenDialog(window, { title: '打开原搭项目', defaultPath: projectsDir, filters: [{ name: '原搭项目', extensions: ['yuanda'] }], properties: ['openFile'] });
      if (result.canceled) return null;
      const handle = await open(result.filePaths[0], 'r');
      let project; try { if ((await handle.stat()).size > 40 * 1024 * 1024) throw new Error('项目大于 40 MiB，暂不支持打开'); project = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
      engine.replace(project); filePath = result.filePaths[0]; savedDigest = digest(engine.getSnapshot()); selection = { pageId: null, nodeIds: [] }; broadcast(); return getState();
    },
    saveProject: () => save(), saveProjectAs: () => save(true),
    async exportHtml() {
      await mkdir(exportsDir, { recursive: true });
      const result = await dialog.showSaveDialog(window, { title: '导出可交互 HTML', defaultPath: path.join(exportsDir, `${safeName()}.html`), filters: [{ name: '独立交互网页', extensions: ['html'] }] });
      if (result.canceled) return null;
      const target = /\.html?$/i.test(result.filePath) ? result.filePath : `${result.filePath}.html`;
      await atomicWrite(target, exportHtml(engine.getSnapshot())); return { ok: true, path: target, message: 'HTML 已导出，可直接在浏览器中打开。' };
    },
    async preview() {
      const target = path.join(runtime, 'preview', '原搭预览.html');
      await atomicWrite(target, exportHtml(engine.getSnapshot()));
      const preview = new BrowserWindow({ width: 1280, height: 900, title: '原搭 · 交互预览', autoHideMenuBar: true, show: !smoke, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      preview.webContents.on('will-navigate', event => event.preventDefault());
      await preview.loadFile(target); return { ok: true, path: target };
    },
    async exportRp() {
      let result;
      try { result=exportRp(engine.getSnapshot()); }
      catch (error) { return {ok:false,message:error.message}; }
      await mkdir(exportsDir,{recursive:true});
      const choice=await dialog.showSaveDialog(window,{title:'导出 Axure RP（基础兼容）',defaultPath:path.join(exportsDir,`${safeName()}.rp`),filters:[{name:'Axure 项目',extensions:['rp']}]});
      if(choice.canceled)return null;
      const target=/\.rp$/i.test(choice.filePath)?choice.filePath:`${choice.filePath}.rp`;
      await atomicWrite(target,result.data,true);
      return {ok:true,path:target,status:result.status,warnings:result.warnings,message:`已导出：${target}\n\n这是基础兼容 RP。请继续保存原搭工程以保留全部编辑数据。`};
    },
    async importImage(context) {
      const origin = imageContext(context, true);
      const result = await dialog.showOpenDialog(window, { title: '插入图片', properties: ['openFile'], filters: [{ name: '图片（最大 4 MiB；SVG 转为 PNG）', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }] });
      if (result.canceled) return null;
      return { ...(await images.fromFiles([result.filePaths[0]]))[0], ...origin };
    },
    async importDroppedImages(paths, context) { const origin = imageContext(context); return { images: await images.fromFiles(paths), ...origin }; },
    async markInternalClipboard(context) {
      if (!context || context.projectId !== engine.getSnapshot().id) throw Object.assign(new Error('项目已切换，未复制元件'), { code: 'REVISION_CONFLICT' });
      return images.markInternal(context.projectId);
    },
    async readPasteSource(context) { const origin = imageContext(context); return { ...await images.readPaste(context), ...origin }; },
    async writeClipboardImage(body) { return images.writeImage(body?.src); },
    getAgentInfo: () => ({ ...agent }),
    setSelection(value) {
      const page = engine.getSnapshot().pages.find(item => item.id === value?.pageId);
      if (!page || !Array.isArray(value.nodeIds)) return;
      selection = { pageId: page.id, nodeIds: value.nodeIds.filter(id => page.nodes.some(node => node.id === id)) };
    },
    async openFolder(kind) {
      const folder = kind === 'exports' ? exportsDir : kind === 'project' ? filePath ? path.dirname(filePath) : projectsDir : kind === 'docs' ? path.join(sourceRoot, 'docs') : null;
      if (!folder) throw new Error('不支持此文件夹'); await mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error);
    }
  };
  for (const [name, fn] of Object.entries(api)) ipcMain.handle(`yuanda:${name}`, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window?.webContents.mainFrame) return { ok: false, error: { message: '无效窗口', code: 'FORBIDDEN' } };
    const exclusive = ['newProject','openProject','saveProject','saveProjectAs','exportHtml','exportRp','importImage','importDroppedImages','markInternalClipboard','readPasteSource','writeClipboardImage','libraryCreate','libraryEdit','libraryRemove','libraryLoad','librarySaveSelection','libraryExport'].includes(name);
    if (exclusive && (ioBusy || agentFilePending || closePending || quitting)) return { ok: false, error: { message: '请先完成当前文件窗口或关闭窗口中的操作', code: 'BUSY' } };
    try { if (exclusive) ioBusy = true; return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: { message: error.message, code: error.code || 'APP_ERROR' } }; }
    finally { if (exclusive) ioBusy = false; }
  });
  await app.whenReady();
  log('ready');
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  try {
    server = await startAgentServer({ connectionFile, getState, command, undo, redo, save:agentSave, exportFile:agentExport, select:agentSelect, validate:body=>api.validateCommands(body), libraryList:()=>libraries.summaries(), libraryRead:async id=>{const {library,revision}=await libraries.read(id);return {library,revision};}, onActivity(value) { Object.assign(agent, value); broadcast(false); } });
    Object.assign(agent, { enabled: true, port: server.port });
  } catch (error) { await writeFile(path.join(runtime, 'agent-error.txt'), error.message); }
  window = new BrowserWindow({ width: 1480, height: 960, minWidth: 1100, minHeight: 720, title: '原搭', backgroundColor: '#f5f5f5', autoHideMenuBar: true, show: !hiddenSmoke, webPreferences: { preload: path.join(appDir, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, ...(hiddenSmoke?{offscreen:true,backgroundThrottling:false}:{}) } });
  window.removeMenu(); // The accessible in-window menu is the editor's single menu bar.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  app.on('second-instance', () => { if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.focus(); });
  window.on('close', event => {
    if (closeApproved || hiddenSmoke) return;
    event.preventDefault();
    if (ioBusy || agentFilePending || closePending || quitting) return;
    closePending = true;
    void (async () => {
      // Renderer drafts must reach the command engine before dirty/save decisions.
      // Commands remain writable while flushing; file operations and duplicate
      // close requests wait. A conflict or rejected draft keeps the window open.
      const flushed = await window.webContents.executeJavaScript('window.YuandaEditor.flushPendingEdits()');
      if (flushed !== true) return;
      quitting = true;
      if (!await mayDiscard(true)) return;
      clearTimeout(recoveryTimer);
      if (discardOnClose) { await recoveryQueue; await unlink(recoveryFile).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      else await persist();
      await server?.close(); server = null; closeApproved = true; app.quit();
    })().catch(async error => {
      discardOnClose = false;
      await dialog.showMessageBox(window, { type: 'error', title: '未能退出', message: '当前修改仍保留在窗口中。请另存到可写的位置后重试。', detail: error.message });
    }).finally(() => { quitting = false; closePending = false; });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { if (server) { try { unlinkSync(connectionFile); } catch {} } });
  await window.loadFile(path.join(appDir, 'renderer/index.html'));
  log('editor-loaded');
  if (agentSmoke) {
    try {
      const {runAgentMcpSmoke}=await import('../scripts/test-agent-mcp-desktop.mjs');
      await runAgentMcpSmoke({window,engine,api,runtime,getState,atomicWrite});
      await server?.close();server=null;app.exit(0);
    } catch(error) {await writeFile(path.join(runtime,'agent-smoke-result.json'),JSON.stringify({ok:false,error:error.stack},null,2));app.exit(1);}
  }
  if (smoke) {
    try {
      const { runSmoke } = await import('../scripts/smoke-desktop.mjs');
      await runSmoke({ window, engine, api, runtime, getState, atomicWrite });
      await server?.close(); server = null; app.exit(0);
    } catch (error) { await writeFile(path.join(runtime, 'smoke-result.json'), JSON.stringify({ ok: false, error: error.stack }, null, 2)); app.exit(1); }
  }
  }
}
