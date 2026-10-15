import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createBlankProject, makeNode, DocumentEngine } from '../app/core/document.mjs';
import { makeRichText } from '../app/core/vector-model.mjs';
import { exportRp, getRpExportStatus, encodeRpContainer } from '../app/core/rp-export.mjs';
import { auditGeneratedProject, inspectGeneratedRp, rpField } from '../scripts/inspect-generated-rp.mjs';

// This test-only reader checks framing independently of the writer. Passing it
// does NOT certify arbitrary Axure compatibility; unsupported content is blocked.
function partsOf(buffer) {
  assert.equal(buffer.subarray(0,4).toString('hex'),'acef0b00');
  const indexBytes=buffer.subarray(8,8+buffer.readUInt32LE(4));
  let cursor=0;
  const variable=()=>{let result=0,shift=0;for(;;){const b=indexBytes[cursor++];result+=(b&127)*2**shift;if(!(b&128))return result;shift+=7;assert.ok(shift<35);}};
  assert.equal(variable(),0);
  const length=variable(); assert.equal(cursor+length,indexBytes.length);
  const index=JSON.parse(indexBytes.subarray(cursor).toString('utf8'));
  const result=[]; let previous=8+indexBytes.length;
  function visit(group,path='') {
    for(const [name,child] of Object.entries(group.children??{})) visit(child,`${path}/${name}`);
    for(const [name,offset] of Object.entries(group.parts??{})) {
      const start=8+indexBytes.length+offset;
      assert.equal(start,previous,'record offsets cover the body contiguously');
      assert.equal(buffer.readUInt32LE(start),0,'zero checksum is not claimed as validated');
      const bytes=buffer.subarray(start+8,start+8+buffer.readUInt32LE(start+4));
      previous=start+8+bytes.length; result.push({path,name,bytes});
    }
  }
  visit(index.root); assert.equal(previous,buffer.length);
  return result;
}

test('accepted basic subset is available while full project roundtrip stays unclaimed',()=>{
  const project=createBlankProject(); const status=getRpExportStatus(project);
  assert.equal(status.verifiedInAxure,false);
  assert.equal(status.artifactNativeVerified,false);
  assert.equal(status.basicSubsetUserAccepted,true);
  assert.equal(status.status,'limited-compatible');
  assert.equal(status.verification.fullProjectRoundtrip,false);
  assert.ok(exportRp(project).data.length);
});

test('unsupported content is enumerated and never silently discarded',()=>{
  const project=createBlankProject();
  const input=makeNode('input');
  const button=makeNode('button',{interactions:[{event:'click',actions:[{type:'wait',ms:100}]}]});
  project.pages[0].nodes.push(input,button);
  const status=getRpExportStatus(project);
  assert.equal(status.unsupported.length,2);
  assert.throws(()=>exportRp(project,{allowUnverified:true}),/已停止导出避免丢失/);
});

test('explicit research export produces bounded indexed GZip object packages',()=>{
  const project=createBlankProject();
  project.pages[0].name='自主页面 🌱';
  project.pages[0].nodes.push(makeNode('rectangle',{text:'原搭自有文本'}));
  const snapshot=structuredClone(project);
  const {data,warnings}=exportRp(project,{allowUnverified:true});
  const records=partsOf(data); assert.equal(records.length,4,'page, specification configuration, HTML configuration and document');
  assert.ok(records.some(x=>x.name==='DesignDocument'));
  const bodies=records.map(({bytes})=>gunzipSync(bytes));
  for(const bytes of bodies) { assert.equal(bytes.readInt32LE(0),27); assert.equal(bytes.readInt32LE(bytes.length-4),28); }
  assert.ok(bodies.some(bytes=>bytes.includes(Buffer.from('原搭自有文本'))));
  assert.ok(bodies.some(bytes=>bytes.includes(Buffer.from('自主页面 🌱'))));
  assert.deepEqual(warnings,[]); assert.deepEqual(project,snapshot);
});

test('multiple pages receive separate package records',()=>{
  const project=createBlankProject();
  const second=structuredClone(project.pages[0]); second.id='rp-page-two';second.name='第二页'; project.pages.push(second);
  const records=partsOf(exportRp(project,{allowUnverified:true}).data);
  assert.equal(records.filter(x=>x.name==='package').length,4,'two pages and two generator configurations');
  assert.equal(new Set(records.filter(x=>x.path).map(x=>x.path)).size,4);
});

test('container length fields remain correct with non-ASCII names and large varints',()=>{
  const bytes=Buffer.alloc(70000,42);
  const records=partsOf(encodeRpContainer([{group:['own'],name:'自有字段'.repeat(100),bytes}]));
  assert.deepEqual(records[0].bytes,bytes);
});

test('research mode still validates project structure',()=>{
  const project=createBlankProject();project.pages[0].width=Infinity;
  assert.throws(()=>exportRp(project,{allowUnverified:true}),/有限数值/);
});

test('new authoring features cannot silently disappear from an experimental RP', () => {
  const project = createBlankProject(); const page = project.pages[0];
  page.nodes.push(makeNode('rectangle', { id: 'rp-extra-a', annotation: '元件说明', text: '加粗信息', richText: makeRichText('加粗信息'), disabled: true }), makeNode('rectangle', { id: 'rp-extra-b' }));
  page.annotation = '页面说明'; page.guides.horizontal.push(120);
  const engine = new DocumentEngine(project);
  engine.apply([{ type: 'groupNodes', pageId: page.id, nodeIds: ['rp-extra-a', 'rp-extra-b'], name: '分组' }]);
  const snapshot = engine.getSnapshot();
  const unsupported = getRpExportStatus(snapshot).unsupported.join('\n');
  for (const feature of ['元件注释', '页面注释', '参考线', '分组', '富文本', '禁用']) assert.match(unsupported, new RegExp(feature));
  assert.throws(() => exportRp(snapshot, { allowUnverified: true }), /已停止导出避免丢失/);
  assert.throws(() => exportRp(snapshot, { allowUnverified: true, allowLossy: true }), /已停止导出避免丢失/);
});

const png=readFileSync(new URL('../samples/rp-batch-20261015/四色测试图.png',import.meta.url));
function imageLinkProject(){const project=createBlankProject('独立图片跳转');const first=project.pages[0];first.name='首页';const second=structuredClone(first);second.id='destination';second.name='目标 🌱';project.pages.push(second);
  first.nodes.push(makeNode('image',{id:'own-image',name:'自有图片',src:`data:image/png;base64,${png.toString('base64')}`,width:240,height:160,rotation:12}),makeNode('button',{id:'own-link',name:'全按钮跳转',text:'打开目标',interactions:[{event:'click',actions:[{type:'navigate',pageId:second.id}]}]}));
  second.nodes.push(makeNode('button',{id:'back-link',text:'返回',interactions:[{event:'click',actions:[{type:'navigate',pageId:first.id}]}]}));return project;}

test('independent reader resolves image bytes and both forward and backward click targets',()=>{
  const project=imageLinkProject(),snapshot=structuredClone(project),result=exportRp(project),audit=auditGeneratedProject(result.data,project);
  assert.deepEqual({pages:audit.pages,nodes:audit.nodes,images:audit.images,links:audit.links},{pages:2,nodes:3,images:1,links:2});
  assert.equal(result.status.status,'limited-compatible');assert.equal(result.status.verifiedInAxure,false);assert.match(result.status.verification.imagesAndLinks,/native-pending/);assert.deepEqual(project,snapshot);
});

test('internal click links also resolve on the same page and on an image',()=>{
  const project=imageLinkProject();project.pages[0].nodes[0].interactions=[{event:'click',name:'',condition:null,caseMode:'if',enabled:true,actions:[{type:'navigate',pageId:project.pages[0].id}]}];
  assert.equal(auditGeneratedProject(exportRp(project).data,project).links,3);
});

test('unsupported image edits and non-click or conditional actions cannot be bypassed',()=>{
  for(const change of [node=>{node.image.fit='cover';},node=>{node.image.flipX=true;},node=>{node.image.crop={x:0,y:0,width:.5,height:1};},node=>{node.image.filters.enabled=true;},node=>{node.text='hidden but authored';},node=>{node.interactions=[{event:'dblclick',actions:[{type:'navigate',pageId:'destination'}]}];}]){
    const project=imageLinkProject();change(project.pages[0].nodes[0]);assert.equal(getRpExportStatus(project).canExport,false);assert.throws(()=>exportRp(project,{allowLossy:true}),/已停止导出避免丢失/);
  }
  for(const change of [interaction=>interaction.condition=true,interaction=>interaction.enabled=false,interaction=>interaction.actions.push({type:'navigate',pageId:'destination'})]){const project=imageLinkProject();change(project.pages[0].nodes[1].interactions[0]);assert.throws(()=>exportRp(project),/已停止导出避免丢失/);}
});

test('advanced authored styles and style libraries are not silently reduced',()=>{
  for(const style of [{fontFamily:'Georgia'},{padding:{top:1,right:2,bottom:3,left:4}},{fillOpacity:.5},{italic:true},{transformOrigin:{x:0,y:0}}]){
    const project=createBlankProject();project.pages[0].nodes.push(makeNode('rectangle',{style}));assert.equal(getRpExportStatus(project).canExport,false);assert.throws(()=>exportRp(project),/高级样式/);
  }
  const project=createBlankProject();project.defaultStyleSets=[{id:'test'}];assert.match(getRpExportStatus(project).unsupported.join(','),/默认样式集/);
});

test('RP refuses disabled event/action and visitor choice instead of silently enabling navigation',()=>{
  for(const change of [node=>{node.eventSettings={click:{enabled:false,executionMode:'automatic'}};},node=>{node.eventSettings={click:{enabled:true,executionMode:'menu'}};},node=>{node.interactions[0].actions[0].enabled=false;}]){
    const project=imageLinkProject();change(project.pages[0].nodes[1]);assert.equal(getRpExportStatus(project).canExport,false);assert.throws(()=>exportRp(project),/已停止导出避免丢失/);
  }
});

test('styleOverrideKeys effective values drive encoded style instead of stale cached values',()=>{
  const project=createBlankProject(),node=makeNode('rectangle');node.style.fill='#ff0000';node.style.fontFamily='Georgia';project.pages[0].nodes.push(node);
  // No local override exists: rendering uses builtin white and default font.
  assert.equal(getRpExportStatus(project).canExport,true);const data=exportRp(project).data,result=inspectGeneratedRp(data),objects=result.packages[0].objects,shape=objects.find(o=>o.type==='Axure:DiagramObject:VectorShape'),style=objects.find(o=>o.id===rpField(shape,'MyStyle').guid),fill=rpField(style,'PropList').find(p=>p.get('DOAName')===-1073741817).get('Value');assert.equal(fill.get('fill-color'),-1);
});

test('text and button/rectangle padding and vertical alignment match the editor defaults',()=>{
  const project=createBlankProject();project.pages[0].nodes=['text','button','rectangle'].map((type,index)=>makeNode(type,{id:`padding-${index}`,name:`padding-${type}`}));
  const data=exportRp(project).data;assert.equal(auditGeneratedProject(data,project).passed,true);
  const objects=inspectGeneratedRp(data).packages[0].objects;
  for(const shape of objects.filter(object=>object.type==='Axure:DiagramObject:VectorShape')){
    const name=rpField(shape,'name-block').get('text'),style=objects.find(object=>object.id===rpField(shape,'MyStyle').guid),properties=new Map(rpField(style,'PropList').map(property=>[property.get('DOAName')+1073741824,property.get('Value')]));
    assert.deepEqual([10,11,12,13,14].map(key=>properties.get(key)),name==='padding-text'?[0,0,0,0,0]:[1,8,4,8,4]);
  }
});

test('independent semantic audit rejects changed geometry, visible styles, page and state data',()=>{
  const project=imageLinkProject(),data=exportRp(project).data;
  const styleChange=(key,value)=>changed=>{const node=changed.pages[0].nodes[1];node.style[key]=value;if(!node.styleOverrideKeys.includes(key))node.styleOverrideKeys.push(key);};
  const mutations=[
    p=>{p.pages[0].width+=1;},p=>{p.pages[0].height+=1;},p=>{p.pages[0].background='#123456';},
    ...['x','y','width','height','rotation'].map(key=>p=>{p.pages[0].nodes[1][key]+=1;}),
    p=>{p.pages[0].nodes[1].visible=false;},p=>{p.pages[0].nodes[1].locked=true;},p=>{p.pages[0].nodes[1].text='changed';},
    ...Object.entries({fontSize:30,fontWeight:700,align:'right',color:'#123456',fill:'#123456',stroke:'#123456',strokeWidth:5,opacity:.35,radius:15,verticalAlign:'top',padding:{top:1,right:2,bottom:3,left:4}}).map(([key,value])=>styleChange(key,value)),
    p=>{p.pages[0].nodes[1].interactions[0].actions[0].pageId=p.pages[0].id;}
  ];
  for(const mutate of mutations){const changed=structuredClone(project);mutate(changed);assert.throws(()=>auditGeneratedProject(data,changed),/RP audit:/);}
  assert.equal(auditGeneratedProject(data,project).passed,true);
});

test('document-wide relationships are reported even without basic node actions', () => {
  const project = createBlankProject(); const a = project.pages[0]; a.nodes.push(makeNode('rectangle', { id: 'rp-master-node' }));
  const engine = new DocumentEngine(project);
  engine.apply([{ type: 'addPage', page: { id: 'rp-child', name: '子页面', parentId: a.id } }, { type: 'createComponent', pageId: a.id, nodeIds: ['rp-master-node'], componentId: 'rp-component', name: '母版' }, { type: 'addStyle', style: { name: '共享样式', style: a.nodes[0].style } }]);
  const result = getRpExportStatus(engine.getSnapshot());
  assert.ok(result.unsupported.some(value => value.includes('页面父子层级')));
  assert.ok(result.unsupported.some(value => value.includes('母版定义')));
  assert.ok(result.unsupported.some(value => value.includes('共享样式库')));
  assert.throws(() => exportRp(engine.getSnapshot(), { allowUnverified: true }), /已停止导出避免丢失/);
});

test('shared adaptive views and unplaced nodes cannot silently disappear in experimental RP',()=>{
  const project=createBlankProject();project.pages[0].nodes=[makeNode('rectangle',{id:'unplaced',placed:false})];
  project.viewSets=[{id:'shared-views',name:'共享尺寸',views:[{id:'small-view',name:'窄屏',parentId:null,minWidth:0,width:390,height:844}]}];
  project.pages[0].viewSetId='shared-views';
  const status=getRpExportStatus(project);assert.match(status.unsupported.join('\n'),/共享自适应视图集/);assert.match(status.unsupported.join('\n'),/取消放置/);
  assert.throws(()=>exportRp(project,{allowUnverified:true}),/已停止导出避免丢失/);
});
