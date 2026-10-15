/** Isolated renderer test: trusted button/checkbox input, DOM select change events. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { electronExecutable, projectEnvironment } from './platform-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'.local/interaction-authoring');
await mkdir(output,{recursive:true});
if(!process.versions.electron){
  const {spawn}=await import('node:child_process'),directory=await mkdtemp(path.join(output,'run-')),env=projectEnvironment(root,directory);delete env.ELECTRON_RUN_AS_NODE;
  const code=await new Promise(resolve=>{const child=spawn(electronExecutable(root),[fileURLToPath(import.meta.url),'--output',directory],{cwd:root,windowsHide:true,stdio:'inherit',env}),timer=setTimeout(()=>child.kill(),90000);child.once('error',()=>{clearTimeout(timer);resolve(1);});child.once('exit',code=>{clearTimeout(timer);resolve(code??1);});});
  let result;try{result=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8'));}catch(error){result={ok:false,error:error.message};}result.exitCode=code;result.directory=directory;result.ok&&=code===0;await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}else void(async()=>{
  const {app,BrowserWindow,ipcMain}=await import('electron'),directory=process.argv[process.argv.indexOf('--output')+1],checks=[],errors=[];let win;
  app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',path.join(directory,'profile'));app.setPath('sessionData',path.join(directory,'session'));app.setPath('logs',path.join(directory,'logs'));
  try{
    const {DocumentEngine,createBlankProject,makeNode}=await import('../app/core/document.mjs'),project=createBlankProject('交互编辑器');project.pages[0].id='authoring-page';
    project.pages[0].nodes=[makeNode('button',{id:'trigger',text:'交互按钮',x:50,y:60,interactions:[{event:'click',name:'运行',actions:[{type:'setText',targetId:'label',value:'完成'}]}]}),makeNode('text',{id:'label',text:'待运行',x:250,y:60}),makeNode('input',{id:'entry',x:50,y:160})];
    const engine=new DocumentEngine(project);engine.apply([{type:'addAdaptiveView',pageId:'authoring-page',view:{id:'phone',name:'手机',minWidth:0,width:390,height:844}}]);
    let selection={pageId:'authoring-page',nodeIds:[]};
    const getState=()=>({project:engine.getSnapshot(),revision:engine.revision,canUndo:engine.canUndo,canRedo:engine.canRedo,dirty:true,selection,agent:{enabled:false}}),emit=()=>{const state=getState();win.webContents.send('yuanda:state',state);return state;};
    const api={getState,getAgentInfo:()=>({enabled:false}),setSelection:value=>selection=value,command:batch=>{engine.apply(batch.commands,{expectedRevision:batch.expectedRevision,label:batch.label});return emit();},undo:()=>{engine.undo();return emit();},redo:()=>{engine.redo();return emit();},libraryList:()=>({libraries:[],errors:[]})};
    for(const[name,fn]of Object.entries(api))ipcMain.handle('yuanda:'+name,async(_, ...args)=>{try{return{ok:true,value:await fn(...args)};}catch(error){return{ok:false,error:{message:error.message,code:error.code}};}});
    await app.whenReady();win=new BrowserWindow({width:1550,height:1100,show:false,webPreferences:{preload:path.join(root,'app/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});win.removeMenu();win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});
    const js=source=>win.webContents.executeJavaScript(source),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),wait=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await delay(30);}throw new Error('Timed out: '+label);};
    const rootSelector='#interactions-panel-content',field=label=>`${rootSelector} [aria-label="${label}"]`;
    const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await delay(60);const p=await js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)}),r=element.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);return{x,y,hit:element.contains(document.elementFromPoint(x,y))}})()`);assert(p.hit,'Uncovered '+selector);for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,x:p.x,y:p.y,button:'left',clickCount:1});await delay(110);};
    const select=async(selector,value)=>{await js(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};if(input.value!==${JSON.stringify(value)})throw new Error('Missing option');input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(120);};
    const selectNode=async ids=>{await js(`YuandaEditor.select(${JSON.stringify(ids)});YuandaDock.show('interactions');YuandaDock.activate('interactions');void 0`);await delay(220);};
    const button=async(text,within='document')=>{const selector=await js(`(()=>{const e=[...${within}.querySelectorAll('button')].find(item=>item.textContent===${JSON.stringify(text)});if(!e)throw new Error('Missing button');e.dataset.authoringClick='target';return '[data-authoring-click="target"]';})()`);await click(selector);await js(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-authoring-click')`);};
    const node=()=>engine.getSnapshot().pages[0].nodes.find(item=>item.id==='trigger');
    const check=async(name,fn)=>{await fn();checks.push(name);};
    await win.loadFile(path.join(root,'app/renderer/index.html'));win.webContents.focus();await wait(()=>js('!!window.YuandaAdvanced&&!!YuandaEditor.getState()'),'ready');await selectNode(['trigger']);await wait(()=>js(`!!document.querySelector(${JSON.stringify(field('触发事件'))})`),'interaction model loaded');
    await check('target-aware-events',async()=>{const names=await js(`Array.from(document.querySelector(${JSON.stringify(field('触发事件'))}).options,o=>o.value)`);assert(names.includes('contextmenu'));assert(names.includes('keyup'));assert(!names.includes('stateChange'));assert(!names.includes('windowResize'));});
    await check('event-and-action-disable-are-independent-and-undoable',async()=>{
      await click('.advanced-action-row .action-enabled input');await wait(()=>node().interactions[0].actions[0].enabled===false,'action disabled');
      await click('.interaction-event-settings input');await wait(()=>node().eventSettings.click.enabled===false,'event disabled');
      await click('.interaction-event-settings input');await wait(()=>node().eventSettings.click.enabled===true,'event enabled');assert.equal(node().interactions[0].actions[0].enabled,false);
      await click('#undo');assert.equal(node().eventSettings.click.enabled,false);await click('#redo');assert.equal(node().eventSettings.click.enabled,true);
    });
    await check('visitor-choice-mode-is-authored',async()=>{await select(field('触发后'),'menu');assert.equal(node().eventSettings.click.executionMode,'menu');});
    await check('adaptive-view-action-has-a-usable-editor',async()=>{
      await button('添加动作',`document.querySelector('${rootSelector}')`);await select('dialog[open] [aria-label="动作"]','setAdaptiveView');await select('dialog[open] [aria-label="切换方式"]','view');await select('dialog[open] [aria-label="目标视图"]','phone');await button('保存动作',`document.querySelector('dialog[open]')`);await wait(()=>node().interactions[0].actions.length===2,'view action');assert.deepEqual(node().interactions[0].actions[1],{type:'setAdaptiveView',mode:'view',viewId:'phone'});
    });
    await check('focus-and-forward-event-actions-are-editable',async()=>{
      for(const type of ['focus','triggerEvent']){await button('添加动作',`document.querySelector('${rootSelector}')`);await select('dialog[open] [aria-label="动作"]',type);await select('dialog[open] [aria-label="目标元件"]','entry');if(type==='triggerEvent')await select('dialog[open] [aria-label="触发事件"]','keyup');await button('保存动作',`document.querySelector('dialog[open]')`);}
      assert.deepEqual(node().interactions[0].actions.slice(-2),[{type:'focus',targetId:'entry'},{type:'triggerEvent',targetId:'entry',event:'keyup'}]);
    });
    await check('new-event-data-is-available-in-expression-editor',async()=>{
      await button('添加动作',`document.querySelector('${rootSelector}')`);await select('dialog[open] [aria-label="动作"]','setText');await click('dialog[open] .expression-value');await select('.expression-dialog[open] [aria-label="取值方式"]','event');
      const names=await js(`Array.from(document.querySelector('.expression-dialog[open] [aria-label="事件字段"]').options,o=>o.value)`),{INTERACTION_EVENT_PROPERTIES}=await import('../app/core/interaction-model.mjs');assert.deepEqual(names,INTERACTION_EVENT_PROPERTIES);
      await select('.expression-dialog[open] [aria-label="事件字段"]','previousValue');await button('取消',`document.querySelector('.expression-dialog[open]')`);await button('取消',`document.querySelector('dialog[open]')`);
    });
    await check('page-events-and-settings-survive-project-reload',async()=>{
      await selectNode([]);await select(field('触发事件'),'variableChange');await click('.interaction-event-settings input');await wait(()=>engine.getSnapshot().pages[0].eventSettings.variableChange.enabled===false,'page event disabled');
      const restored=new DocumentEngine(JSON.parse(JSON.stringify(engine.getSnapshot())));assert.equal(restored.getSnapshot().pages[0].eventSettings.variableChange.enabled,false);assert.equal(restored.getSnapshot().pages[0].nodes[0].interactions[0].actions[0].enabled,false);
    });
    assert.deepEqual(errors,[]);await writeFile(path.join(directory,'result.json'),JSON.stringify({ok:true,checks,errors,input:'trusted button/checkbox input; DOM select change events'},null,2));win.destroy();app.exit(0);
  }catch(error){await writeFile(path.join(directory,'result.json'),JSON.stringify({ok:false,checks,errors,error:error.stack},null,2));win?.destroy();app.exit(1);}
})();
