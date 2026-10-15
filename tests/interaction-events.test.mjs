import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankProject, makeNode, DocumentEngine, normalizeProject, validateProject } from '../app/core/document.mjs';
import { getInteractionEvents, getEventSettings, chooseInteractionCases, INTERACTION_EVENT_PROPERTIES } from '../app/core/interaction-model.mjs';
import { exportHtml } from '../app/core/html-export.mjs';

const branch = (event, actions, extra = {}) => ({event, actions, ...extra});
function fixture() {
  const project = createBlankProject('交互能力'); project.pages[0].id='home';
  project.pages[0].nodes = [makeNode('button',{id:'button'}),makeNode('input',{id:'input'}),makeNode('text',{id:'label'})];
  return new DocumentEngine(project);
}
const patch = (nodeId, value) => ({type:'updateNode',pageId:'home',nodeId,patch:value});
const text = value => ({type:'setText',targetId:'label',value});

test('旧交互迁移不改输入，缺省事件自动启用、动作保留缺省true语义',()=>{
  const old=fixture().getSnapshot();delete old.pages[0].eventSettings;for(const node of old.pages[0].nodes)delete node.eventSettings;
  old.pages[0].nodes[0].interactions=[branch('click',[text('旧项目')])];const original=structuredClone(old),next=normalizeProject(old);
  assert.deepEqual(old,original);assert.deepEqual(next.pages[0].eventSettings,{});assert.deepEqual(getEventSettings(next.pages[0].nodes[0],'click'),{enabled:true,executionMode:'automatic'});
  assert.equal(Object.hasOwn(next.pages[0].nodes[0].interactions[0].actions[0],'enabled'),false);validateProject(next);
  assert.match(exportHtml(next),/function getEventSettings/);
});

test('共享事件能力区分页面、普通元件、表单和动态面板',()=>{
  const page=getInteractionEvents('page'),button=getInteractionEvents({type:'button'}),input=getInteractionEvents({type:'input'}),panel=getInteractionEvents({type:'dynamicPanel'});
  for(const event of ['contextmenu','mousemove','keyup'])assert(page.includes(event)&&button.includes(event));
  for(const event of ['windowResize','windowScroll','variableChange','adaptiveViewChange'])assert(page.includes(event)&&!button.includes(event));
  assert(!button.includes('stateChange'));assert(panel.includes('stateChange'));assert(panel.includes('drag'));assert(input.includes('input'));assert(!button.includes('input'));
  for(const key of ['variableName','previousValue','windowWidth','scrollDeltaY','ctrlKey'])assert(INTERACTION_EVENT_PROPERTIES.includes(key));
});

test('事件、分支和动作启用互相独立，保存重开与undo保持三层状态',()=>{
  const engine=fixture(),actions=[text('第一步'),{...text('停用步骤'),enabled:false}];
  engine.apply([patch('button',{eventSettings:{click:{enabled:false,executionMode:'menu'}},interactions:[branch('click',actions),branch('click',[text('分支停用')],{enabled:false})]})],{expectedRevision:0});
  const saved=engine.getSnapshot(),button=saved.pages[0].nodes[0];assert.deepEqual(chooseInteractionCases(button.interactions,'click',{},getEventSettings(button,'click')),[]);
  engine.apply([patch('button',{eventSettings:{click:{enabled:true,executionMode:'menu'}}})],{expectedRevision:1});
  const enabled=engine.getSnapshot().pages[0].nodes[0];assert.equal(enabled.interactions[1].enabled,false);assert.equal(enabled.interactions[0].actions[1].enabled,false);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(engine.getSnapshot()))).getSnapshot(),engine.getSnapshot());engine.undo();assert.deepEqual(engine.getSnapshot(),saved);
});

test('事件设置默认补齐，非法设置、错误作用域、动作enabled类型均原子拒绝',()=>{
  const engine=fixture();engine.apply([patch('button',{eventSettings:{click:{enabled:false}}})]);assert.deepEqual(engine.getSnapshot().pages[0].nodes[0].eventSettings.click,{enabled:false,executionMode:'automatic'});
  for(const invalid of [{eventSettings:{click:{enabled:'false',executionMode:'automatic'}}},{eventSettings:{click:{enabled:true,executionMode:'code'}}},{eventSettings:{constructor:{enabled:true,executionMode:'automatic'}}},{eventSettings:{windowResize:{enabled:true,executionMode:'automatic'}}},{interactions:[branch('windowResize',[text('bad')])]},{interactions:[branch('click',[{...text('bad'),enabled:0}])]}]) {
    const before=engine.getSnapshot(),revision=engine.revision;assert.throws(()=>engine.apply([patch('label',{text:'不得落盘'}),patch('button',invalid)]));assert.deepEqual(engine.getSnapshot(),before);assert.equal(engine.revision,revision);
  }
});

test('新页面事件和元件事件接受安全表达式，事件修改仍遵守版本冲突',()=>{
  const engine=fixture();engine.apply([{type:'updatePage',pageId:'home',patch:{interactions:['windowResize','windowScroll','variableChange'].map(event=>branch(event,[text({op:'event',name:event==='variableChange'?'variableName':event==='windowResize'?'windowWidth':'scrollDeltaY'})]))}},patch('button',{interactions:['contextmenu','mousemove','keyup'].map(event=>branch(event,[text({op:'event',name:'key'})]))})],{expectedRevision:0});
  const before=engine.getSnapshot();assert.throws(()=>engine.apply([patch('button',{eventSettings:{click:{enabled:false}}})],{expectedRevision:0}),error=>error.code==='REVISION_CONFLICT');assert.deepEqual(engine.getSnapshot(),before);
});

test('focus和triggerEvent目标类型与事件范围校验，删除目标会清理动作',()=>{
  const engine=fixture();engine.apply([patch('button',{interactions:[branch('click',[{type:'focus',targetId:'input'},{type:'triggerEvent',targetId:'input',event:'keyup'}])]})]);
  for(const action of [{type:'focus',targetId:'label'},{type:'triggerEvent',targetId:'button',event:'windowResize'},{type:'triggerEvent',targetId:'missing',event:'click'}])assert.throws(()=>engine.apply([patch('button',{interactions:[branch('click',[action])]})]));
  engine.apply([{type:'removeNodes',pageId:'home',nodeIds:['input']}]);assert.deepEqual(engine.getSnapshot().pages[0].nodes[0].interactions[0].actions,[]);
});

test('复制元件保留事件设置并重映射focus与triggerEvent的内部目标',()=>{
  const engine=fixture();engine.apply([patch('button',{eventSettings:{click:{enabled:true,executionMode:'menu'}},interactions:[branch('click',[{type:'focus',targetId:'input',enabled:false},{type:'triggerEvent',targetId:'input',event:'input'}])]})]);
  engine.apply([{type:'duplicateNodes',pageId:'home',nodeIds:['button','input'],dx:30,dy:30,idMap:{button:'button-copy',input:'input-copy'}}]);
  const copied=engine.getSnapshot().pages[0].nodes.find(node=>node.id==='button-copy');assert.deepEqual(copied.eventSettings,{click:{enabled:true,executionMode:'menu'}});assert(copied.interactions[0].actions.every(action=>action.targetId==='input-copy'));assert.equal(copied.interactions[0].actions[0].enabled,false);
});

test('旧无效stateChange保留可读性，但新事件配置和触发动作不提供它',()=>{
  const engine=fixture();engine.apply([patch('button',{interactions:[branch('stateChange',[text('旧数据')])]})]);assert.equal(engine.getSnapshot().pages[0].nodes[0].interactions[0].event,'stateChange');
  assert.throws(()=>engine.apply([patch('button',{eventSettings:{stateChange:{enabled:true,executionMode:'automatic'}}})]));
  assert.throws(()=>engine.apply([patch('input',{interactions:[branch('click',[{type:'triggerEvent',targetId:'button',event:'stateChange'}])]})]));
});
