import assert from 'node:assert/strict';
import { BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { exportHtml } from '../app/core/html-export.mjs';

export async function runSmoke({ window, engine, api, runtime, getState, atomicWrite }) {
  const errors = [];
  window.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); });
  const inspect = code => window.webContents.executeJavaScript(code);
  const waitUntil = async (test, label) => { for (let n = 0; n < 50; n++) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`超时：${label}`); };
  await waitUntil(() => inspect("document.querySelector('#project-name')?.value?.length > 0"), '编辑器载入');
  await inspect('window.YuandaDock?.reset()');
  assert.equal(await inspect("typeof window.require"), 'undefined');
  assert.equal(await inspect("typeof window.yuanda.command"), 'function');
  assert.equal(await inspect("[...document.querySelectorAll('.design-node[data-visible=\"false\"]')].every(node => node.hidden)"), true);
  await inspect("document.querySelector('.layer-row[data-node-id=\"modal-shade\"]').click()");
  assert.equal(await inspect("document.querySelector('.design-node[data-node-id=\"modal-shade\"]').hidden"), false);
  await inspect("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  assert.equal(await inspect("document.querySelector('.design-node[data-node-id=\"modal-shade\"]').hidden"), true);
  const initial = getState();
  await inspect("document.querySelector('[data-insert=rectangle]').click()");
  await waitUntil(() => getState().revision > initial.revision, '添加矩形');
  assert.equal(getState().project.pages[0].nodes.length, initial.project.pages[0].nodes.length + 1);
  await inspect("document.querySelector('#undo').click()");
  await waitUntil(() => getState().project.pages[0].nodes.length === initial.project.pages[0].nodes.length, '撤销');
  await inspect("document.querySelector('#redo').click()");
  await waitUntil(() => getState().project.pages[0].nodes.length === initial.project.pages[0].nodes.length + 1, '重做');
  const beforeReview=getState().revision;
  await inspect("document.querySelector('#agent-toggle').click(); document.querySelector('#agent-example-card').click()");
  await waitUntil(()=>inspect("!document.querySelector('#agent-apply').disabled"),'Agent 完整预检查');
  assert.equal(getState().revision,beforeReview,'检查指令不会修改项目和历史');
  const beforeCard = getState().revision;
  await inspect("document.querySelector('#agent-apply').click()");
  await waitUntil(() => getState().revision > beforeCard, '界面 Agent 批量操作');
  api.undo();
  await inspect("document.querySelector('#agent-close').click()");
  const schema=await inspect('window.yuanda.getSchema()');
  assert(schema.commands.some(value=>value.startsWith('componentCommands')));
  const dryRevision=getState().revision;
  const validBatch=await inspect(`window.yuanda.validateCommands({expectedRevision:${dryRevision},commands:[{type:'addVariable',variable:{name:'检查计数',type:'number',value:0}},{type:'updateNode',pageId:'page-home',nodeId:'home-open',patch:{interactions:[{event:'click',actions:[{type:'setVariable',name:'检查计数',value:1}]}]}}]})`);
  assert.equal(validBatch.valid,true);assert.equal(getState().revision,dryRevision);
  const invalidBatch=await inspect(`window.yuanda.validateCommands({expectedRevision:${dryRevision},commands:[{type:'updateNode',pageId:'page-home',nodeId:'home-open',patch:{interactions:[{event:'click',actions:[{type:'setVariable',name:'不存在的变量',value:1}]}]}}]}).then(()=>false,error=>Boolean(error.message))`);
  assert.equal(invalidBatch,true);assert.equal(getState().revision,dryRevision);
  const connection = JSON.parse(await readFile(getState().agent.connectionFile, 'utf8'));
  const response = await fetch(connection.url + '/v1/commands', { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: getState().revision, label: '真实 Agent 验证', commands: [{ type: 'updateNode', pageId: 'page-home', nodeId: 'home-title', patch: { text: 'Agent 已成功修改画布' } }] }) });
  assert.equal(response.status, 200);
  await waitUntil(() => inspect("document.querySelector('#nodes').textContent.includes('Agent 已成功修改画布')"), 'Agent 修改实时显示');
  api.undo();
  const beforeInheritance=engine.getSnapshot();
  const inherited=await fetch(connection.url+'/v1/commands',{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:getState().revision,commands:[
    {type:'addStyle',style:{id:'smoke-style-parent',name:'运行验收父样式',style:{fill:'#111111',fontSize:20}}},
    {type:'addStyle',style:{id:'smoke-style-child',name:'运行验收子样式',parentId:'smoke-style-parent',style:{color:'#FFFFFF'}}},
    {type:'applyStyle',pageId:'page-home',nodeIds:['home-open'],styleId:'smoke-style-child'},
    {type:'updateNode',pageId:'page-home',nodeId:'home-open',patch:{style:{fontSize:33}}},
    {type:'updateStyle',styleId:'smoke-style-parent',patch:{style:{fontSize:26,fill:'#333333'}}}
  ]})});
  assert.equal(inherited.status,200);const inheritedNode=engine.getSnapshot().pages[0].nodes.find(node=>node.id==='home-open');assert.equal(inheritedNode.styleId,'smoke-style-child');assert.equal(inheritedNode.style.fontSize,33);assert.equal(inheritedNode.style.fill,'#333333');assert(inheritedNode.styleOverrideKeys.includes('fontSize'));
  await waitUntil(()=>inspect("getComputedStyle(document.querySelector('.design-node[data-node-id=\"home-open\"]')).fontSize==='33px'"),'实际程序呈现Agent继承与局部覆盖');
  api.undo();assert.deepEqual(engine.getSnapshot(),beforeInheritance);
  const saved = path.join(runtime, 'smoke-saved.yuanda'), html = path.join(runtime, 'smoke-export.html');
  const originalDialogs = { save: dialog.showSaveDialog, open: dialog.showOpenDialog, message: dialog.showMessageBox };
  try {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [saved] });
    dialog.showMessageBox = async () => ({ response: 1 });
    await inspect("window.yuanda.saveProjectAs()");
    assert.equal(getState().dirty, false);
    const savedProject = JSON.parse(await readFile(saved, 'utf8'));
    assert.deepEqual(savedProject, engine.getSnapshot());
    api.command({ expectedRevision: getState().revision, commands: [{ type: 'renameProject', name: '临时改名' }] });
    await inspect("window.yuanda.openProject()");
    assert.deepEqual(engine.getSnapshot(), savedProject);
    // Exercise the UI's pending text -> command -> file write order.
    await inspect("document.querySelector('.layer-row[data-node-id=\"home-title\"]').click(); const input = document.querySelector('#inspector textarea'); input.value = '保存前的最后一次修改'; input.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#save-project').click()");
    await waitUntil(() => !getState().dirty && getState().project.pages[0].nodes.find(n => n.id === 'home-title').text === '保存前的最后一次修改', '保存前提交最后修改');
    assert.equal(JSON.parse(await readFile(saved, 'utf8')).pages[0].nodes.find(n => n.id === 'home-title').text, '保存前的最后一次修改');
    api.undo();
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: html });
    const exported = await inspect("window.yuanda.exportHtml()"); assert.equal(exported.ok, true);
    assert.equal(await readFile(html, 'utf8'), exportHtml(engine.getSnapshot()));
  } finally { dialog.showSaveDialog = originalDialogs.save; dialog.showOpenDialog = originalDialogs.open; dialog.showMessageBox = originalDialogs.message; }
  const preview = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await preview.loadFile(html);
  const js = code => preview.webContents.executeJavaScript(code);
  const node = id => `[data-node-id="${id}"]`;
  assert.equal(await js(`document.querySelector('${node('modal-card')}').hidden`), true);
  await js(`document.querySelector('${node('home-open')}').click()`);
  await waitUntil(() => js(`!document.querySelector('${node('modal-card')}').hidden`), '导出 HTML 打开弹窗');
  await js(`document.querySelector('${node('modal-submit')}').click()`);
  await waitUntil(() => js(`document.querySelector('${node('modal-status')}').textContent.includes('预约成功')`), '等待与文字动作');
  await js(`document.querySelector('${node('modal-close')}').click()`);
  await waitUntil(() => js(`document.querySelector('${node('modal-card')}').hidden`), '关闭弹窗');
  await js(`document.querySelector('${node('home-dashboard')}').click()`);
  await waitUntil(() => js(`!!document.querySelector('${node('dash-back')}')`), '导出跳页');
  assert.equal(await js('typeof window.require'), 'undefined');
  preview.close();
  assert.deepEqual(errors, []);
  await inspect("document.activeElement?.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await writeFile(path.join(runtime, 'editor.png'), (await window.webContents.capturePage()).toPNG());
  await writeFile(path.join(runtime, 'smoke-result.json'), JSON.stringify({ ok: true, checks: ['editor-loaded','renderer-sandbox','hidden-layer-selection','insert','undo','redo','ui-agent-batch','agent-schema-current','preflight-validates-dependent-commands-without-mutation','preflight-rejects-missing-variable','authenticated-agent-live-edit','authenticated-agent-inherited-and-local-style','save-open-disk-roundtrip','flush-before-save','export-file','offline-html-modal','ordered-wait-text','hide','navigate'], rendererErrors: errors, note: '文件对话框在测试中返回指定样本路径；桌面IPC、文件写入、Agent真实HTTP和HTML均真实运行。此脚本通过DOM调用验证主进程链路；真实鼠标键盘另见UI回归脚本。' }, null, 2));
}
