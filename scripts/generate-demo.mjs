import { electronExecutable } from './platform-runtime.mjs';
/** Generate original v0.2 samples. --verify also exercises the exported HTML with real Electron input. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createDemoProject, DocumentEngine, validateProject } from '../app/core/document.mjs';
import { exportHtml } from '../app/core/html-export.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectFile = path.join(root, 'samples', 'yuanda', '原搭体验-0.2.yuanda');
const htmlFile = path.join(root, 'exports', '原搭体验-0.2.html');
const output = path.join(root, '.local', 'demo-verification');
const hash = value => createHash('sha256').update(value).digest('hex');

async function writeGenerated(file, content) {
  let previous;
  try { previous = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous === content) return 'unchanged';
  if (previous !== undefined) {
    const backup = path.join(output, 'previous', new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(backup, { recursive: true }); await writeFile(path.join(backup, path.basename(file)), previous, { flag: 'wx' });
  }
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); return previous === undefined ? 'created' : 'regenerated';
}

async function generate() {
  const project = createDemoProject(); assert.equal(validateProject(project), true);
  const serialized = JSON.stringify(project, null, 2) + '\n'; assert.deepEqual(new DocumentEngine(JSON.parse(serialized)).getSnapshot(), project);
  const html = exportHtml(project);
  const projectStatus = await writeGenerated(projectFile, serialized), htmlStatus = await writeGenerated(htmlFile, html);
  console.log(JSON.stringify({ project: { path: projectFile, status: projectStatus, sha256: hash(serialized) }, html: { path: htmlFile, status: htmlStatus, sha256: hash(html) }, pages: project.pages.map(page => ({ name: page.name, nodes: page.nodes.length })) }, null, 2));
  if (!process.argv.includes('--verify')) return;
  await mkdir(path.join(root, '.local', 'tmp'), { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(electronExecutable(root), [fileURLToPath(import.meta.url), '--verify-rendered'], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: path.join(root, '.local', 'tmp'), TMP: path.join(root, '.local', 'tmp'), TMPDIR: path.join(root, '.local', 'tmp') } });
    const timer = setTimeout(() => { child.kill(); reject(new Error('示例验证超过 45 秒')); }, 45000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); if (code) reject(new Error(`示例验证失败，退出码 ${code}`)); else resolve(); });
  });
}

async function verify() {
  const { app, BrowserWindow } = await import('electron');
  mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(output, 'profile')); app.setPath('sessionData', path.join(output, 'browser')); app.setPath('logs', path.join(output, 'logs'));
  const reportFile = path.join(output, 'report.json');
  try {
    const project = JSON.parse(await readFile(projectFile, 'utf8')); validateProject(project);
    const html = await readFile(htmlFile, 'utf8'); assert.equal(html, exportHtml(project));
    await app.whenReady();
    const win = new BrowserWindow({ width: 1320, height: 1220, useContentSize: true, show: false, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    const errors = [], checks = [], screenshots = []; win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    const js = code => win.webContents.executeJavaScript(code), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (predicate, label) => { for (let count = 0; count < 100; count++) { if (await predicate()) return; await delay(25); } throw new Error(`等待超时：${label}`); };
    const selector = id => `[data-node-id="${id}"]`, text = id => js(`document.querySelector(${JSON.stringify(selector(id))})?.textContent`);
    const click = async target => {
      const point = await js(`(() => { const n=document.querySelector(${JSON.stringify(target)}); if(!n)throw new Error('找不到点击目标'); n.scrollIntoView({block:'nearest',inline:'nearest'}); const r=n.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2); return {x,y,hit:n.contains(document.elementFromPoint(x,y)),visible:r.width>0&&r.height>0&&!n.hidden}; })()`);
      assert.equal(point.visible, true, target); assert.equal(point.hit, true, `点击目标被遮挡：${target}`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 }); await delay(70);
    };
    const key = async keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await delay(40); };
    const fill = async (id, value) => { await click(selector(id)); await win.webContents.insertText(value); await delay(70); };
    const screenshot = async name => { const file = path.join(output, `${name}.png`); await writeFile(file, (await win.webContents.capturePage()).toPNG()); screenshots.push(file); };
    const check = async (name, task) => { try { await task(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.stack }); } };
    await win.loadFile(htmlFile); win.webContents.focus(); await delay(120);
    await js(`window.__demoInputs=[];for(const type of ['click','input','change','keydown'])document.addEventListener(type,event=>window.__demoInputs.push({type,trusted:event.isTrusted,target:event.target.dataset.nodeId||event.target.closest('[data-node-id]')?.dataset.nodeId||event.target.id}),true)`);
    await check('model-roundtrip-and-neutral-visual-system', async () => {
      assert.equal(project.pages.length, 3);
      const neutral = value => value === 'transparent' || /^#([\da-f]{2})\1\1(?:[\da-f]{2})?$/i.test(value);
      for (const page of project.pages) for (const node of page.nodes) { for (const field of ['fill', 'stroke', 'color']) assert.ok(neutral(node.style[field]), `${node.id} ${field}`); assert.ok([400, 500, 600].includes(node.style.fontWeight)); assert.ok(node.style.radius <= 6); }
      assert.equal(await text('home-title'), '把一个页面，\n变成可以操作的体验。'); await screenshot('01-home');
    });
    await check('real-mouse-appointment-dialog-and-wait-feedback', async () => {
      await click(selector('home-open')); assert.equal(await js(`document.querySelector('${selector('modal-card')}').hidden`), false);
      await fill('modal-input', '小原'); await click(selector('modal-submit'));
      await waitFor(async () => (await text('modal-status')).includes('预约成功'), '预约完成提示'); await screenshot('02-appointment');
      await click(selector('modal-close')); assert.equal(await js(`document.querySelector('${selector('modal-card')}').hidden`), true);
    });
    await check('real-mouse-navigation-to-dashboard-and-lab', async () => {
      await click(selector('home-dashboard')); await waitFor(async () => !!(await text('dash-title')), '工作台'); await screenshot('03-dashboard');
      await click(selector('dash-lab')); await waitFor(async () => (await text('lab-title')) === '交互实验室', '实验室'); await screenshot('04-lab');
    });
    await check('dynamic-panel-states-really-switch-in-place', async () => {
      assert.equal(await js("document.querySelector('[data-state-id=lab-state-a]').hidden"), false);
      await click(selector('lab-state-detail')); assert.equal(await js("document.querySelector('[data-state-id=lab-state-a]').hidden"), true); assert.equal(await js("document.querySelector('[data-state-id=lab-state-b]').hidden"), false);
      await click(selector('lab-state-overview')); assert.equal(await js("document.querySelector('[data-state-id=lab-state-a]').hidden"), false);
    });
    await check('native-form-input-select-checkbox-and-condition-feedback', async () => {
      await click(selector('lab-form-submit')); assert.ok((await text('lab-form-result')).includes('请填写称呼'));
      await fill('lab-name', '小原'); await click(selector('lab-consent') + ' input');
      await click(selector('lab-purpose')); await key('Down'); await key('Enter'); await click(selector('lab-form-submit'));
      assert.equal(await text('lab-form-result'), '已记录：小原 / 需求评审');
    });
    await check('variable-counter-and-if-else-feedback', async () => {
      await click(selector('lab-check-count')); assert.equal(await text('lab-counter-result'), '还差 3 次，请继续点击。');
      for (let index = 0; index < 3; index++) await click(selector('lab-add-count'));
      assert.equal(await text('lab-count'), '3'); await click(selector('lab-check-count')); assert.equal(await text('lab-counter-result'), '已经达到 3 次，可以继续。');
    });
    const listTitles = () => js(`Array.from(document.querySelectorAll('${selector('lab-list')} .repeater-item')).filter(row=>!row.hidden).sort((a,b)=>parseFloat(a.style.top)-parseFloat(b.style.top)).map(row=>row.querySelector('${selector('lab-row-title')}').textContent)`);
    await check('repeater-sort-filter-restore-and-add-real-row', async () => {
      assert.deepEqual(await listTitles(), ['整理页面层级', '填写元件注释', '连接页面交互']);
      await click(selector('lab-data-sort')); assert.deepEqual(await listTitles(), ['填写元件注释', '连接页面交互', '整理页面层级']);
      await click(selector('lab-data-filter')); assert.deepEqual(await listTitles(), ['连接页面交互', '整理页面层级']);
      await click(selector('lab-data-reset')); assert.equal((await listTitles()).length, 3);
      await fill('lab-new-item', '完成一次完整试玩'); await click(selector('lab-data-add')); assert.deepEqual(await listTitles(), ['填写元件注释', '连接页面交互', '整理页面层级', '完成一次完整试玩']);
      assert.equal(await js(`document.querySelector('${selector('lab-new-item')} > .yuanda-native-control').value`), ''); await screenshot('05-lab-filled');
      await js(`document.querySelector('${selector('lab-back')}').scrollIntoView({block:'end'})`); await screenshot('06-lab-bottom');
    });
    await check('restart-restores-variable-form-and-dataset', async () => {
      await click('#restart'); assert.equal(await text('lab-count'), '0'); assert.equal((await listTitles()).length, 3);
      assert.equal(await js(`document.querySelector('${selector('lab-name')} > .yuanda-native-control').value`), ''); assert.equal(await js(`document.querySelector('${selector('lab-consent')} input').checked`), false);
      await click(selector('lab-back')); assert.equal(await text('dash-title'), '从这里继续试玩');
    });
    const inputs = await js('window.__demoInputs'); assert.ok(inputs.some(event => event.type === 'click' && event.trusted)); assert.ok(inputs.some(event => event.type === 'input' && event.trusted));
    const report = { ok: checks.every(check => check.ok) && errors.length === 0, projectFile, htmlFile, htmlSha256: hash(html), checks, errors, inputs, screenshots, viewport: await js('({width:innerWidth,height:innerHeight})'), coverage: '自己生成的离线 HTML；真实 Chromium 鼠标和键盘输入；没有通过调用 DOM click 或直接修改页面状态完成交互。' };
    await writeFile(reportFile, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ok: report.ok, checks, errors, report: reportFile, screenshots }, null, 2)); win.destroy(); app.exit(report.ok ? 0 : 1);
  } catch (error) { await writeFile(reportFile, JSON.stringify({ ok: false, fatal: error.stack }, null, 2)); console.error(error.stack); app.exit(1); }
}

if (process.argv.includes('--verify-rendered')) void verify();
else void generate().catch(error => { console.error(error.stack); process.exitCode = 1; });
