import { electronExecutable } from './platform-runtime.mjs';
/** One reproducible native-platform verification entrypoint. Each desktop test uses its own data directory. */
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=path.join(root,'.local','tmp');
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await mkdir(temp,{recursive:true});
const node=process.execPath,electron=electronExecutable(root);
let tasks=[
 ['model-and-http',node,['--test','tests/*.test.mjs']],
 ['mcp-desktop-and-files',node,['scripts/test-agent-mcp-desktop.mjs']],
 ['interaction-authoring',node,['scripts/test-interaction-authoring.mjs']],
 ['interaction-events-runtime',node,['scripts/test-interaction-events.mjs']],
 ['style-inheritance-editor',node,['scripts/test-style-inheritance-editor.mjs']],
 ['style-inheritance-runtime',node,['scripts/test-style-inheritance-runtime.mjs']],
 ['style-inheritance-demo-generate',node,['scripts/generate-style-inheritance-demo.mjs']],
 ['style-inheritance-demo',node,['scripts/test-style-inheritance-demo.mjs']],
 ['style-editor',node,['scripts/test-style-editor.mjs']],
 ['style-runtime',node,['scripts/test-style-runtime.mjs']],
 ['style-demo-generate',node,['scripts/generate-style-demo.mjs']],
 ['style-demo',node,['scripts/test-style-demo.mjs']],
 ['image-input-desktop',node,['scripts/test-image-input-desktop.mjs']],
 ['image-editor',node,['scripts/test-image-editor.mjs']],
 ['image-runtime',node,['scripts/test-image-runtime.mjs']],
 ['image-demo-generate',node,['scripts/generate-image-demo.mjs']],
 ['image-demo',node,['scripts/test-image-demo.mjs']],
 ['view-editor',node,['scripts/test-view-editor.mjs']],
 ['adaptive-runtime',node,['scripts/test-adaptive-runtime.mjs']],
 ['view-demo-generate',node,['scripts/generate-view-demo.mjs']],
 ['view-demo',node,['scripts/test-view-demo.mjs']],
 ['desktop-menus',node,['scripts/test-editor-shell.mjs']],
 ['library-drag-preview',node,['scripts/test-drag-preview.mjs']],
 ['grid-and-guides',node,['scripts/test-grid-guides-ui.mjs']],
 ['project-global-guides',node,['scripts/test-global-guides-ui.mjs']],
 ['panel-docking',node,['scripts/test-docking-ui.mjs']],
 ['workspace-input',node,['scripts/test-ui-regression.mjs','--output=release-source.json']],
 ['advanced-authoring',node,['scripts/run-advanced-ui-regression.mjs']],
 ['hierarchy',node,['scripts/test-hierarchy-ui.mjs']],
 ['repeater-pages-and-import',node,['scripts/test-repeater-ui.mjs']],
 ['dynamic-panel-editor-and-runtime',node,['scripts/test-panel-ui.mjs']],
 ['dynamic-panel-boundaries',node,['scripts/test-panel-boundaries.mjs']],
 ['dynamic-panel-demo-generate',node,['scripts/generate-panel-demo.mjs']],
 ['dynamic-panel-demo',node,['scripts/test-panel-demo.mjs']],
 ['library-demo-generate',node,['scripts/generate-library-demo.mjs']],
 ['local-library-editor-and-html',node,['scripts/test-library-ui.mjs']],
 ['local-library-desktop-files',node,['scripts/test-library-desktop.mjs']],
 ['navigation',node,['scripts/test-navigation-ui.mjs']],
 ['page-folders',node,['scripts/test-page-folders-ui.mjs']],
 ['vectors',electron,['scripts/test-vector-ui.mjs']],
 ['forms',node,['scripts/test-form-ui.mjs']],
 ['editing-safety',node,['scripts/test-edit-safety-ui.mjs']],
 ['close-with-drafts',node,['scripts/test-close-regression.mjs']],
 ['html-runtime',node,['scripts/test-export-regression.mjs']],
 ['demo',node,['scripts/generate-demo.mjs','--verify']],
 ['structure-demo-generate',node,['scripts/generate-structure-demo.mjs']],
 ['structure-demo',node,['scripts/test-structure-demo.mjs']],
 ['desktop-ipc-and-files',node,['scripts/test-desktop.mjs']],
 ['cross-feature-project',node,['scripts/test-complex-project-integration.mjs']]
];
const from=process.argv.find(value=>value.startsWith('--from='))?.slice(7);
if(from){const index=tasks.findIndex(task=>task[0]===from);if(index<0)throw new Error(`未知验证入口：${from}`);tasks=tasks.slice(index);}
const results=[];
for(const[name,executable,args]of tasks){
  console.log(`验证：${name}`);const start=Date.now();
  const result=await new Promise(resolve=>{
    let output='';const child=spawn(executable,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,TEMP:temp,TMP: temp, TMPDIR: temp}});
    child.stdout.on('data',data=>output+=data.toString());child.stderr.on('data',data=>output+=data.toString());
    const timer=setTimeout(()=>{child.kill();},150000);
    child.on('error',error=>{clearTimeout(timer);resolve({ok:false,error:error.message,output});});
    child.on('close',code=>{clearTimeout(timer);resolve({ok:code===0,exitCode:code,output});});
  });
  results.push({name,...result,elapsedMs:Date.now()-start});console.log(`${name}: ${result.ok?'通过':'未通过'}`);
  if(!result.ok){console.error(result.output.slice(-12000));break;}
}
const result={ok:results.length===tasks.length&&results.every(item=>item.ok),version,scope:from?`partial-from-${from}`:'full',checkedAt:new Date().toISOString(),results};
const directory=path.join(root,'.local','release-audit');await mkdir(directory,{recursive:true});const output=path.join(directory,`${from?'partial':'full'}-verification-${version}${from?`-from-${from}`:''}.json`);await writeFile(output,JSON.stringify(result,null,2));if(!from)await writeFile(path.join(directory,'full-verification.json'),JSON.stringify(result,null,2));console.log(`验证记录：${output}`);if(!result.ok)process.exitCode=1;
