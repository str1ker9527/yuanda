import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAgentServer } from '../app/agent-server.mjs';
import { createBlankProject, DocumentEngine } from '../app/core/document.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(projectRoot, '.local', 'agent-server-tests');

async function fixture(t) {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, 'run-'));
  const connectionFile = path.join(directory, 'connection.json');
  const project = createBlankProject('Agent 测试'); project.id = 'agent-project'; project.pages[0].id = 'page-one';
  const engine = new DocumentEngine(project);
  const state = () => ({ project: engine.getSnapshot(), revision: engine.revision, canUndo: engine.canUndo, canRedo: engine.canRedo });
  const activities = [];
  const server = await startAgentServer({
    connectionFile, getState: state,
    command: body => { engine.apply(body.commands, { expectedRevision: body.expectedRevision, label: body.label }); return state(); },
    undo: () => { engine.undo(); return state(); }, redo: () => { engine.redo(); return state(); },
    onActivity: activity => activities.push(activity)
  });
  const connection = JSON.parse(await readFile(connectionFile, 'utf8'));
  t.after(async () => {
    await server.close();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(testRoot) + path.sep)) throw new Error('测试清理目录不在项目测试根目录内');
    await rm(resolved, { recursive: true, force: true });
  });
  function request({ method = 'GET', route = '/v1/state', body, headers = {}, auth = true } = {}) {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(connection.url + route, {
        method, headers: { ...(auth ? { Authorization: `Bearer ${connection.token}` } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers }
      }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          try { resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); }
        });
        response.on('error', reject);
      });
      req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('本机 HTTP 测试超时'))); req.end(data);
    });
  }
  return { request, engine, state, server, connectionFile, connection, activities };
}

test('Agent 只监听回环地址，连接文件提供可用令牌与只读接口', async t => {
  const f = await fixture(t);
  assert.equal(f.connection.url, `http://127.0.0.1:${f.server.port}`); assert.equal(f.connection.token.length, 64);
  const response = await f.request(); assert.equal(response.status, 200); assert.equal(response.body.project.name, 'Agent 测试'); assert.equal(response.body.revision, 0);
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['x-content-type-options'], 'nosniff');
  const schema = await f.request({ route: '/v1/schema' }); assert.equal(schema.status, 200); assert.ok(schema.body.nodeTypes.includes('button')); assert.ok(schema.body.example.commands[0].type === 'addNode');
  assert.equal(f.activities.length, 0);
});

test('真实Agent发现视图范围命令，保存当前布局并整体撤销，不受编辑器选择影响',async t=>{
  const f=await fixture(t),discovery=await f.request({route:'/v1/schema'});
  assert.ok(JSON.stringify(discovery.body).includes('viewCommands'));assert.ok(JSON.stringify(discovery.body).includes('setAdaptiveView'));
  const setup=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:0,commands:[
    {type:'addNode',pageId:'page-one',node:{type:'text',id:'view-label',text:'共享标题',x:20}},
    {type:'addViewSet',viewSet:{id:'agent-sizes',name:'Agent尺寸',views:[{id:'agent-small',name:'手机',parentId:null,minWidth:0,width:390,height:844}]}},
    {type:'setPageViewSet',pageId:'page-one',viewSetId:'agent-sizes'}
  ]}});assert.equal(setup.status,200);const revision=f.engine.revision;
  const changed=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:revision,commands:[{type:'viewCommands',pageId:'page-one',viewId:'agent-small',scope:'current',commands:[{type:'updateNode',pageId:'page-one',nodeId:'view-label',patch:{x:150}}]}]}});
  assert.equal(changed.status,200);const snapshot=f.engine.getSnapshot();assert.equal(snapshot.pages[0].nodes[0].x,20);assert.equal(snapshot.pages[0].viewOverrides['agent-small']['view-label'].x,150);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(snapshot))).getSnapshot(),snapshot);
  const conflict=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:revision,commands:[{type:'renameProject',name:'不应写入'}]}});assert.equal(conflict.status,409);
  const undo=await f.request({method:'POST',route:'/v1/undo',body:{expectedRevision:f.engine.revision}});assert.equal(undo.status,200);assert.deepEqual(f.engine.getSnapshot().pages[0].viewOverrides,{});
});

test('缺失、错误长度、相同长度错误令牌均不能读写项目', async t => {
  const f = await fixture(t);
  for (const headers of [{}, { Authorization: 'Bearer bad' }, { Authorization: `Bearer ${'0'.repeat(64)}` }]) {
    const response = await f.request({ auth: false, headers }); assert.equal(response.status, 401); assert.equal(response.body.code, 'UNAUTHORIZED');
  }
  const write = await f.request({ auth: false, method: 'POST', route: '/v1/commands', body: { expectedRevision: 0, commands: [{ type: 'renameProject', name: '不应写入' }] } });
  assert.equal(write.status, 401); assert.equal(f.engine.revision, 0); assert.equal(f.engine.getSnapshot().name, 'Agent 测试');
});

test('真实Agent发现完整样式合同，复合样式原子写入/保存/撤销且坏图拒绝',async t=>{
  const f=await fixture(t),discovery=await f.request({route:'/v1/schema'});
  assert.equal(discovery.body.schemaRevision,13);for(const field of ['fillPaint','borderSides','radiusCorners','shadows','transition','transformOrigin'])assert(discovery.body.styleFields.includes(field));assert(discovery.body.structures.styleText.includes('px'));
  const style={fontFamily:'Microsoft YaHei',italic:true,strike:true,lineHeight:24,padding:{top:2,right:3,bottom:4,left:5},fillPaint:{type:'linear',angle:90,stops:[{offset:0,color:'#000000',opacity:1},{offset:1,color:'#FFFFFF',opacity:.5}]},transition:{duration:150,delay:0,easing:'ease-in'},transformOrigin:{x:0,y:1}};
  const before=f.engine.getSnapshot(),result=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:0,commands:[{type:'addNode',pageId:'page-one',node:{id:'styled',type:'button',style}},{type:'updateNode',pageId:'page-one',nodeId:'styled',patch:{stateStyles:{hover:{fillPaint:null,strike:false}}}}]}});
  assert.equal(result.status,200);const saved=f.engine.getSnapshot();for(const [key,value]of Object.entries(style))assert.deepEqual(saved.pages[0].nodes[0].style[key],value);assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(saved))).getSnapshot(),saved);
  const bad=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:f.engine.revision,commands:[{type:'renameProject',name:'不得泄漏'},{type:'updateNode',pageId:'page-one',nodeId:'styled',patch:{style:{fillPaint:{type:'image',src:'data:image/png;base64,AAAA',fit:'cover',positionX:.5,positionY:.5}}}}]}});
  assert.equal(bad.status,400);assert.equal(bad.body.code,'VALIDATION_ERROR');assert.deepEqual(f.engine.getSnapshot(),saved);
  const undo=await f.request({method:'POST',route:'/v1/undo',body:{expectedRevision:f.engine.revision}});assert.equal(undo.status,200);assert.deepEqual(f.engine.getSnapshot(),before);
});

test('真实Agent使用默认与命名继承、局部覆盖和格式快照，冲突与失败不泄漏',async t=>{
  const f=await fixture(t),discovery=await f.request({route:'/v1/schema'});
  assert.equal(discovery.body.schemaRevision,13);
  for(const command of ['addDefaultStyleSet','setProjectDefaultStyleSet','setStyleParent','clearStyleOverrides','applyStyleSnapshot','updateStyleFromNode'])assert(discovery.body.commands.some(value=>value.startsWith(command+' ')));
  for(const field of ['styleInheritanceVersion','defaultStyleSets','defaultStyleSetId'])assert(discovery.body.projectFields.includes(field));
  for(const field of ['styleOverrideKeys','defaultStyleSetId'])assert(discovery.body.nodeFields.includes(field));
  const post=commands=>f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:f.engine.revision,commands}});
  const initial=f.engine.getSnapshot();
  const setup=await post([
    {type:'addDefaultStyleSet',defaultStyleSet:{id:'project-default',name:'全局按钮',byType:{button:{style:{fontSize:20,padding:{top:3,right:5,bottom:3,left:5}},stateStyles:{hover:{opacity:.6}}}}}},
    {type:'setProjectDefaultStyleSet',defaultStyleSetId:'project-default'},
    {type:'addStyle',style:{id:'parent-style',name:'父样式',style:{fill:'#111111',fontSize:24}}},
    {type:'addStyle',style:{id:'child-style',name:'子样式',parentId:'parent-style',style:{color:'#FFFFFF'}}},
    {type:'addNode',pageId:'page-one',node:{id:'inherit-a',type:'button',styleId:'child-style',text:'不复制的文字'}},
    {type:'addNode',pageId:'page-one',node:{id:'inherit-b',type:'button',styleId:'child-style',text:'保留目标文字'}}
  ]);
  assert.equal(setup.status,200,JSON.stringify(setup.body));
  const read=id=>f.engine.getSnapshot().pages[0].nodes.find(node=>node.id===id);
  assert.equal(read('inherit-a').style.fontSize,24);assert.deepEqual(read('inherit-a').style.padding,{top:3,right:5,bottom:3,left:5});assert.deepEqual(read('inherit-a').styleOverrideKeys,[]);
  const edit=await post([{type:'updateNode',pageId:'page-one',nodeId:'inherit-a',patch:{style:{fontSize:42}}},{type:'updateStyle',styleId:'parent-style',patch:{style:{fontSize:28,fill:'#222222'}}}]);
  assert.equal(edit.status,200,JSON.stringify(edit.body));assert.equal(read('inherit-a').styleId,'child-style');assert.equal(read('inherit-a').style.fontSize,42);assert.equal(read('inherit-b').style.fontSize,28);assert.equal(read('inherit-a').style.fill,'#222222');assert(read('inherit-a').styleOverrideKeys.includes('fontSize'));
  const clear=await post([{type:'clearStyleOverrides',pageId:'page-one',nodeIds:['inherit-a'],keys:['fontSize']}]);assert.equal(clear.status,200,JSON.stringify(clear.body));assert.equal(read('inherit-a').style.fontSize,28);
  const revision=f.engine.revision,snapshot={style:{letterSpacing:2,fillOpacity:.75},stateStyles:{focus:{stroke:'#333333'}}};
  const copied=await post([{type:'applyStyleSnapshot',pageId:'page-one',nodeIds:['inherit-a','inherit-b'],snapshot}]);assert.equal(copied.status,200,JSON.stringify(copied.body));assert.equal(read('inherit-b').text,'保留目标文字');assert.equal(read('inherit-b').styleId,'child-style');assert.equal(read('inherit-b').style.letterSpacing,2);assert.deepEqual(read('inherit-b').stateStyles.focus,{stroke:'#333333'});
  const saved=f.engine.getSnapshot();assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(saved))).getSnapshot(),saved);
  const stale=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:revision,commands:[{type:'setStyleParent',styleId:'child-style',parentId:null}]}});assert.equal(stale.status,409);assert.deepEqual(f.engine.getSnapshot(),saved);
  const invalid=await post([{type:'renameProject',name:'不可泄漏'},{type:'setStyleParent',styleId:'parent-style',parentId:'child-style'}]);assert.equal(invalid.status,400);assert.deepEqual(f.engine.getSnapshot(),saved);
  const undo=await f.request({method:'POST',route:'/v1/undo',body:{expectedRevision:f.engine.revision}});assert.equal(undo.status,200);assert.equal(read('inherit-b').style.letterSpacing,0);assert.equal(read('inherit-b').stateStyles.focus,undefined);
  const redo=await f.request({method:'POST',route:'/v1/redo',body:{expectedRevision:f.engine.revision}});assert.equal(redo.status,200);assert.deepEqual(f.engine.getSnapshot(),saved);assert.notDeepEqual(saved,initial);
});

test('真实Agent发现并编辑图片，裁剪/调色/切片可保存与整体撤销，旧版本拒绝',async t=>{
  const f=await fixture(t),schema=await f.request({route:'/v1/schema'});
  assert.equal(schema.body.schemaRevision,13);assert(schema.body.nodeFields.includes('image'));assert(schema.body.commands.some(c=>c.startsWith('sliceImage ')));
  const setup=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:0,commands:[{type:'addNode',pageId:'page-one',node:{id:'agent-image',type:'image',src:'data:image/gif;base64,R0lGODlhAgABAIAAAP8AAAAA/yH5BAAKAAAALAAAAAACAAEAAAICBAoAIfkEAAoAAAAsAAAAAAIAAQAAAgJMCgA7',width:200,height:100,style:{strokeWidth:0,radius:0}}}]}});assert.equal(setup.status,200);const before=f.state();
  const commands=[{type:'cropImage',pageId:'page-one',nodeId:'agent-image',crop:{x:.1,y:0,width:.8,height:1}},{type:'setImageOptions',pageId:'page-one',nodeId:'agent-image',patch:{flipX:true,filters:{enabled:true,saturation:0}}},{type:'sliceImage',pageId:'page-one',nodeId:'agent-image',axis:'vertical',ids:['agent-slice']}];
  const result=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:before.revision,commands}});assert.equal(result.status,200);const saved=f.engine.getSnapshot();assert.equal(saved.pages[0].nodes.length,2);assert.equal(saved.pages[0].nodes[1].image.filters.saturation,0);assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(saved))).getSnapshot(),saved);
  const stale=await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:before.revision,commands}});assert.equal(stale.status,409);
  const undo=await f.request({method:'POST',route:'/v1/undo',body:{expectedRevision:f.engine.revision}});assert.equal(undo.status,200);assert.deepEqual(f.engine.getSnapshot(),before.project);
});

test('即使有令牌也拒绝网页 Origin、非回环 Host 与错误端口', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: 'https://example.invalid' }, { Origin: 'null' }, { Host: `localhost:${f.server.port}` }, { Host: 'evil.example:80' }, { Host: '127.0.0.1:1' }]) {
    const response = await f.request({ headers }); assert.equal(response.status, 403); assert.equal(response.body.code, 'LOCAL_ONLY');
  }
  assert.equal(f.engine.revision, 0);
});

test('commands、undo、redo 走同一个引擎，返回真实状态并记录活动', async t => {
  const f = await fixture(t);
  const apply = await f.request({ method: 'POST', route: '/v1/commands', body: { expectedRevision: 0, commands: [{ type: 'renameProject', name: 'Agent 已编辑' }, { type: 'addNode', pageId: 'page-one', node: { id: 'agent-button', type: 'button', text: '点我' } }] } });
  assert.equal(apply.status, 200); assert.equal(apply.body.revision, 1); assert.equal(apply.body.project.pages[0].nodes[0].text, '点我'); assert.equal(apply.body.canUndo, true);
  const undo = await f.request({ method: 'POST', route: '/v1/undo', body: { expectedRevision: 1 } });
  assert.equal(undo.status, 200); assert.equal(undo.body.revision, 2); assert.equal(undo.body.project.name, 'Agent 测试'); assert.equal(undo.body.project.pages[0].nodes.length, 0); assert.equal(undo.body.canRedo, true);
  const redo = await f.request({ method: 'POST', route: '/v1/redo', body: { expectedRevision: 2 } });
  assert.equal(redo.status, 200); assert.equal(redo.body.revision, 3); assert.equal(redo.body.project.name, 'Agent 已编辑'); assert.equal(redo.body.project.pages[0].nodes.length, 1);
  assert.deepEqual(f.activities.map(item => item.requests), [1, 2, 3]); assert.ok(f.activities.every(item => Number.isFinite(Date.parse(item.lastActivity))));
});

test('Agent 发现并写入高级项目，容器与变量变更可整体撤销', async t => {
  const f = await fixture(t);
  const contract = (await f.request({route:'/v1/schema'})).body;
  assert(contract.nodeTypes.includes('dynamicPanel')); assert(contract.nodeTypes.includes('connector'));
  assert(contract.events.includes('input')); assert(contract.commands.some(item=>item.startsWith('duplicateNodes ')));
  const before = f.state().project;
  const response = await f.request({method:'POST',route:'/v1/commands',body:{expectedRevision:0,label:'Agent 创建交互容器',commands:[
    {type:'addVariable',variable:{name:'count',type:'number',value:0}},
    {type:'addNode',pageId:'page-one',node:{id:'agent-text',type:'text',text:'计数',bindings:{text:{op:'var',name:'count'}}}},
    {type:'createDynamicPanel',pageId:'page-one',panelId:'agent-panel',nodeIds:['agent-text'],name:'动态内容'},
    {type:'updatePage',pageId:'page-one',patch:{annotation:'由 Agent 写入的设计说明'}},
    {type:'setPageGuides',pageId:'page-one',guides:{horizontal:[120],vertical:[80]}}
  ]}});
  assert.equal(response.status,200);assert.equal(response.body.project.pages[0].nodes.find(node=>node.id==='agent-panel').panel.states[0].nodeIds[0],'agent-text');
  assert.equal(response.body.project.pages[0].annotation,'由 Agent 写入的设计说明');
  const undo=await f.request({method:'POST',route:'/v1/undo',body:{expectedRevision:response.body.revision}});
  assert.equal(undo.status,200);assert.deepEqual(undo.body.project,before);
});

test('陈旧版本、缺失版本及并发同版本请求不会覆盖后来编辑', async t => {
  const f = await fixture(t);
  const concurrent = await Promise.all(['作者 A', '作者 B'].map(name => f.request({ method: 'POST', route: '/v1/commands', body: { expectedRevision: 0, commands: [{ type: 'renameProject', name }] } })));
  assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409]); assert.equal(f.engine.revision, 1);
  const before = f.state();
  for (const route of ['/v1/commands', '/v1/undo', '/v1/redo']) {
    const response = await f.request({ method: 'POST', route, body: { expectedRevision: 0, commands: [] } }); assert.equal(response.status, 409); assert.equal(response.body.code, 'REVISION_CONFLICT');
  }
  const absent = await f.request({ method: 'POST', route: '/v1/commands', body: { commands: [] } }); assert.equal(absent.status, 409);
  assert.deepEqual(f.state(), before);
});

test('HTTP 批次后项无效时前项一并回滚，客户端收到可理解错误', async t => {
  const f = await fixture(t); const before = f.state();
  const response = await f.request({ method: 'POST', route: '/v1/commands', body: { expectedRevision: 0, commands: [{ type: 'renameProject', name: '不应保留' }, { type: 'addNode', pageId: 'page-one', node: { type: 'button', width: -10 } }] } });
  assert.equal(response.status, 400); assert.equal(response.body.code, 'VALIDATION_ERROR'); assert.ok(response.body.message.includes('宽度'));
  assert.deepEqual(f.state(), before); assert.equal(f.activities.length, 0);
});

test('坏 JSON、错误内容类型、未知路由及未知命令安全失败', async t => {
  const f = await fixture(t);
  const badJson = await f.request({ method: 'POST', route: '/v1/commands', body: '{ broken' }); assert.equal(badJson.status, 400); assert.equal(badJson.body.code, 'BAD_JSON');
  const wrongType = await f.request({ method: 'POST', route: '/v1/commands', body: '{}', headers: { 'Content-Type': 'text/plain' } }); assert.equal(wrongType.status, 415);
  const noRoute = await f.request({ route: '/v1/arbitrary-file' }); assert.equal(noRoute.status, 404);
  const noCommand = await f.request({ method: 'POST', route: '/v1/commands', body: { expectedRevision: 0, commands: [{ type: 'runShell', command: 'anything' }] } }); assert.equal(noCommand.status, 400); assert.equal(noCommand.body.code, 'COMMAND_ERROR');
  assert.equal(f.engine.revision, 0);
});

test('关闭服务器清理带令牌的连接文件', async t => {
  const f = await fixture(t); await access(f.connectionFile); await f.server.close();
  await assert.rejects(access(f.connectionFile), { code: 'ENOENT' });
});
