import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlankProject, makeNode, DocumentEngine, normalizeProject } from '../app/core/document.mjs';
import { INPUT_TYPES } from '../app/core/design-model.mjs';
import { startAgentServer } from '../app/agent-server.mjs';
import { schema } from '../app/agent-schema.mjs';

function fixture() {
  const project = createBlankProject('表单设置'); project.id = 'forms-project'; project.pages[0].id = 'forms-page';
  project.pages[0].nodes = [makeNode('input', { id: 'single', value: '已有内容' }), makeNode('textarea', { id: 'multi', value: '第一行\n第二行' }), makeNode('text', { id: 'label', text: '初始' })];
  return project;
}
const update = (nodeId, patch) => ({ type: 'updateNode', pageId: 'forms-page', nodeId, patch });

test('旧项目只补表单默认值，不改用户原值和旧输入，JSON重开保持设置', () => {
  const old = fixture(); for (const node of old.pages[0].nodes) { delete node.inputType; delete node.readOnly; delete node.maxLength; }
  const before = structuredClone(old), migrated = normalizeProject(old); assert.deepEqual(old, before);
  assert.deepEqual(migrated.pages[0].nodes.map(node => [node.inputType, node.readOnly, node.maxLength]), Array(3).fill(['text', false, null]));
  const engine = new DocumentEngine(old); engine.apply([update('single', { inputType: 'password', readOnly: true, maxLength: 3 }), update('multi', { maxLength: 0 })]);
  const saved = engine.getSnapshot(); assert.equal(saved.pages[0].nodes[0].value, '已有内容', '长度设置不截断原值');
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(saved))).getSnapshot(), saved);
  engine.undo(); assert.deepEqual(engine.getSnapshot(), migrated); engine.redo(); assert.deepEqual(engine.getSnapshot(), saved);
});

test('八种输入类型、只读和禁用分开建模，允许交互给只读控件设值', () => {
  for (const inputType of INPUT_TYPES) {
    const engine = new DocumentEngine(fixture()); engine.apply([update('single', { inputType, readOnly: true, disabled: false, maxLength: ['number','date'].includes(inputType) ? null : 10 }), update('label', { interactions: [{ event: 'click', actions: [{ type: 'setValue', targetId: 'single', value: '交互设值' }] }] })]);
    assert.equal(engine.getSnapshot().pages[0].nodes[0].inputType, inputType); assert.equal(engine.getSnapshot().pages[0].nodes[0].disabled, false);
  }
});

test('非法类型、非整数长度、错误控件设置原子拒绝，不泄漏同批前置编辑', () => {
  for (const [id, patch] of [['single',{inputType:'file'}],['single',{readOnly:'yes'}],['single',{maxLength:-1}],['single',{maxLength:1.5}],['single',{maxLength:50001}],['single',{maxLength:'3'}],['single',{inputType:'number',maxLength:4}],['single',{inputType:'date',maxLength:4}],['multi',{inputType:'email'}],['label',{readOnly:true}],['label',{maxLength:5}]]) {
    const engine = new DocumentEngine(fixture()), before = engine.getSnapshot();
    assert.throws(() => engine.apply([update('label',{text:'不应保存'}),update(id,patch)]), {code:'VALIDATION_ERROR'});
    assert.deepEqual(engine.getSnapshot(), before); assert.equal(engine.revision, 0);
  }
});

test('母版表单设置同步到实例，撤销仍保留属性', () => {
  const engine = new DocumentEngine(fixture());
  engine.apply([{type:'createComponent',pageId:'forms-page',nodeIds:['single'],componentId:'form-master',name:'输入母版'}, {type:'insertComponent',pageId:'forms-page',componentId:'form-master',instanceId:'form-instance',x:300,y:100}]);
  const sourceId=engine.getSnapshot().components[0].nodes[0].id;
  engine.apply([{type:'updateComponentNode',componentId:'form-master',nodeId:sourceId,patch:{inputType:'password',readOnly:true,maxLength:8}}]);
  const project=engine.getSnapshot(); for(const group of project.pages[0].groups.filter(group=>group.componentId==='form-master')) { const input=project.pages[0].nodes.find(node=>node.id===group.nodeIds[0]); assert.equal(input.inputType,'password'); assert.equal(input.maxLength,8); assert.equal(input.readOnly,true); }
  engine.undo(); assert.equal(engine.getSnapshot().components[0].nodes[0].readOnly,false);
});

test('真实Agent可发现/写入表单约束并保存重开；非法批次不改项目', async t => {
  const testRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','.local','forms-tests'); await mkdir(testRoot,{recursive:true}); const directory=await mkdtemp(path.join(testRoot,'run-'));
  const engine=new DocumentEngine(fixture()), state=()=>({project:engine.getSnapshot(),revision:engine.revision});
  const connectionFile=path.join(directory,'connection.json'); const server=await startAgentServer({connectionFile,getState:state,command:body=>{engine.apply(body.commands,{expectedRevision:body.expectedRevision});return state();},undo:()=>{engine.undo();return state();},redo:()=>{engine.redo();return state();}}); t.after(()=>server.close());
  const connection=JSON.parse(await readFile(connectionFile,'utf8')), headers={Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'};
  const discovered=await (await fetch(connection.url+'/v1/schema',{headers})).json(); for(const key of ['inputType','readOnly','maxLength'])assert(discovered.nodeFields.includes(key)); assert.equal(discovered.schemaRevision,schema.schemaRevision);
  const response=await fetch(connection.url+'/v1/commands',{method:'POST',headers,body:JSON.stringify({expectedRevision:0,commands:[update('single',{inputType:'email',maxLength:80,readOnly:true}),update('multi',{maxLength:120,disabled:true})]})}); assert.equal(response.status,200);
  const saved=engine.getSnapshot(), file=path.join(directory,'agent-forms.yuanda'); await writeFile(file,JSON.stringify(saved)); assert.deepEqual(new DocumentEngine(JSON.parse(await readFile(file,'utf8'))).getSnapshot(),saved);
  const invalid=await fetch(connection.url+'/v1/commands',{method:'POST',headers,body:JSON.stringify({expectedRevision:engine.revision,commands:[update('single',{inputType:'number',maxLength:4})]})}); assert.equal(invalid.status,400); assert.deepEqual(engine.getSnapshot(),saved);
});
