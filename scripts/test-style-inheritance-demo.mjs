import { electronExecutable } from './platform-runtime.mjs';
/** Verify the actual generated tutorial, then a derived component fixture, in Chromium. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.local/style-inheritance-demo');
await mkdir(output, { recursive: true });

if (!process.versions.electron) {
  const { spawn } = await import('node:child_process');
  const directory = await mkdtemp(path.join(output, 'run-'));
  const env = { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise(resolve => {
    const child = spawn(electronExecutable(root), [fileURLToPath(import.meta.url), '--output', directory], { cwd: root, windowsHide: true, env, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill(), 90000);
    child.once('error', () => { clearTimeout(timer); resolve(1); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
  let result; try { result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8')); }
  catch (error) { result = { ok: false, error: error.message }; }
  Object.assign(result, { directory, exitCode: code }); result.ok &&= code === 0;
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
} else void (async () => {
  const { app, BrowserWindow } = createRequire(import.meta.url)('electron');
  const directory = process.argv[process.argv.indexOf('--output') + 1];
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.setPath('userData', path.join(directory, 'profile')); app.setPath('sessionData', path.join(directory, 'session')); app.setPath('logs', path.join(directory, 'logs'));
  app.on('window-all-closed', () => {});
  let win; const checks = [], errors = [], external = [], screenshots = [];
  try {
    const projectFile = path.join(root, 'samples/yuanda/共享样式与格式刷体验.yuanda');
    const sourceText = await readFile(projectFile, 'utf8'), project = JSON.parse(sourceText);
    const htmlFile = path.join(root, 'exports/共享样式与格式刷体验.html'), originalHtml = await readFile(htmlFile, 'utf8');
    await app.whenReady();
    win = new BrowserWindow({ width: 1300, height: 1320, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
    win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { external.push(details.url); callback({ cancel: true }); });
    await win.loadFile(htmlFile); win.webContents.focus(); win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const js = script => win.webContents.executeJavaScript(script), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const selector = id => `[data-node-id="${id}"]`;
    const wait = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(30); } throw new Error(`Timed out: ${label}`); };
    const style = async (id, key) => key === 'backgroundColor'
      ? js(`getComputedStyle(document.querySelector(${JSON.stringify(selector(id) + ' > .yuanda-style-decoration > path')})).fill`)
      : js(`getComputedStyle(document.querySelector(${JSON.stringify(selector(id))}))[${JSON.stringify(key)}]`);
    const point = async id => js(`(()=>{const node=document.querySelector(${JSON.stringify(selector(id))});node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    const hover = async id => { win.webContents.sendInputEvent({ type: 'mouseMove', ...await point(id) }); await delay(80); };
    const away = async () => { win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 }); await delay(80); };
    const click = async id => { const at = await point(id); assert.equal(await js(`document.querySelector(${JSON.stringify(selector(id))}).contains(document.elementFromPoint(${at.x},${at.y}))`), true); for (const type of ['mouseMove','mouseDown','mouseUp']) win.webContents.sendInputEvent({ type, ...at, button: 'left', clickCount: 1 }); await delay(80); };
    const shot = async name => { const file = path.join(directory, name + '.png'); await writeFile(file, (await win.webContents.capturePage()).toPNG()); screenshots.push(file); };
    const check = async (name, test) => { await test(); checks.push(name); };
    await wait(() => js("Boolean(document.querySelector('[data-node-id=\"local-card\"]'))"), 'tutorial loaded');
    await js("window.__trusted=[];for(const type of ['click','input'])document.addEventListener(type,event=>__trusted.push(event.isTrusted),true)");
    await check('tutorial-covers-default-parent-child-and-local-layers', async () => {
      assert.equal(await js('document.querySelectorAll(".node").length'), project.pages[0].nodes.length);
      assert.deepEqual(await js('JSON.parse(document.querySelector("#yuanda-model").textContent)'), project);
      assert.equal(await style('default-card', 'borderRadius'), '10px');
      assert.equal(await style('parent-card', 'borderRadius'), '18px');
      assert.equal(await style('child-card', 'borderTopWidth'), '2px');
      assert.equal(await style('child-card', 'fontWeight'), '600');
      assert.equal(await style('local-card', 'borderRadius'), '4px');
      assert.equal(await style('local-card', 'backgroundColor'), 'rgb(255, 255, 255)');
      assert.equal(await style('default-card', 'fontSize'), '19px');
    });
    await check('parent-hover-reaches-child-and-local-card-then-releases', async () => {
      for (const id of ['parent-card','child-card','local-card']) { await hover(id); assert.equal(await style(id, 'backgroundColor'), 'rgb(222, 222, 222)'); }
      await away(); assert.equal(await style('local-card', 'backgroundColor'), 'rgb(255, 255, 255)');
    });
    await check('tutorial-selected-disabled-and-reset-actions-work', async () => {
      await click('select-card'); await away(); assert.equal(await style('child-card', 'backgroundColor'), 'rgb(34, 34, 34)');
      await click('disable-card'); assert.equal(await style('child-card', 'opacity'), '0.4');
      await click('reset-card'); await away(); assert.equal(await style('child-card', 'opacity'), '1'); assert.equal(await style('child-card', 'backgroundColor'), 'rgb(241, 241, 241)');
    });
    await check('native-input-and-runtime-style-survive-adaptive-view-switch', async () => {
      await click('demo-input'); await win.webContents.insertText('继承演示真实输入');
      await wait(() => js("document.querySelector('[data-node-id=\"input-echo\"]').textContent==='刚刚输入：继承演示真实输入'"), 'input echo');
      await click('runtime-change'); assert.equal(await style('local-card', 'borderTopWidth'), '5px');
      await click('switch-view'); await away(); assert.equal(await style('child-card', 'fontSize'), '21px');
      assert.equal(await style('parent-card', 'backgroundColor'), 'rgb(231, 231, 231)');
      assert.equal(await style('local-card', 'borderTopWidth'), '5px');
      assert.equal(await js("document.querySelector('[data-node-id=\"demo-input\"] input').value"), '继承演示真实输入');
      await click('base-view'); assert.equal(await style('child-card', 'fontSize'), '19px'); assert.equal(await style('local-card', 'borderTopWidth'), '5px');
      assert.equal(await js('__trusted.length>0&&__trusted.every(Boolean)'), true);
    });
    await shot('01-tutorial-after-interaction');
    await check('component-derived-from-tutorial-follows-parent-with-local-overrides', async () => {
      const { DocumentEngine } = await import('../app/core/document.mjs');
      const { exportHtml } = await import('../app/core/html-export.mjs');
      const engine = new DocumentEngine(project), pageId = project.pages[0].id;
      engine.apply([
        { type: 'createComponent', pageId, componentId: 'tutorial-card-component', nodeIds: ['parent-card','child-card','local-card'], name: '演示卡片母版' },
        { type: 'insertComponent', pageId, componentId: 'tutorial-card-component', instanceId: 'tutorial-card-instance', x: 330, y: 254 },
        { type: 'updateStyle', styleId: 'card-parent', patch: { style: { fill: '#BBDDCC', radius: 22, fontSize: 24 } } }
      ]);
      const saved = engine.getSnapshot(), group = saved.pages[0].groups.find(value => value.componentId === 'tutorial-card-component');
      assert.ok(group); const component = saved.components.find(value => value.id === group.componentId);
      const childSourceId = component.nodes.find(node => node.name === 'child-card').id;
      const localSourceId = component.nodes.find(node => node.name === 'local-card').id;
      const childId = group.nodeIds[group.sourceIds.indexOf(childSourceId)], localId = group.nodeIds[group.sourceIds.indexOf(localSourceId)];
      assert.ok(childId && localId, 'component must map its real source IDs');
      const derived = path.join(directory, 'component-derived.html'); await writeFile(derived, exportHtml(saved));
      await win.loadFile(derived); await away();
      await wait(() => js(`Boolean(document.querySelector(${JSON.stringify(selector(childId))}))`), 'component rendered');
      assert.equal(await style(childId, 'backgroundColor'), 'rgb(187, 221, 204)'); assert.equal(await style(childId, 'borderRadius'), '22px'); assert.equal(await style(childId, 'fontSize'), '24px');
      assert.equal(await style(localId, 'backgroundColor'), 'rgb(255, 255, 255)'); assert.equal(await style(localId, 'borderRadius'), '4px'); assert.equal(await style(localId, 'fontSize'), '24px');
      await hover(localId); assert.equal(await style(localId, 'backgroundColor'), 'rgb(222, 222, 222)'); await away();
    });
    await shot('02-derived-component');
    await check('fixtures-remain-unchanged-and-html-is-offline-sandboxed', async () => {
      assert.equal(await readFile(projectFile, 'utf8'), sourceText); assert.equal(await readFile(htmlFile, 'utf8'), originalHtml);
      assert.equal(await js('typeof window.require'), 'undefined'); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    });
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, checks, errors, external, screenshots,
      coverage: 'Actual generated tutorial in hidden Electron with trusted pointer/text input. Additional component fixture is derived only inside the isolated test directory. Original tutorial files are unchanged.' }, null, 2));
    win.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: false, checks, errors, external, screenshots, error: error.stack }, null, 2)); win?.destroy(); app.exit(1);
  }
})().catch(error => { console.error(error); createRequire(import.meta.url)('electron').app.exit(1); });
