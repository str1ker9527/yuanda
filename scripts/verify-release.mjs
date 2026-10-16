import { electronExecutable, releaseLayout } from './platform-runtime.mjs';
/** Compare packaged application bytes with this checkout; never reads runtime tokens or projects. */
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const info=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const release=path.join(root,'dist',`原搭-${info.version}`),packaged=releaseLayout(release).app;
const files=[];
async function walk(relative){for(const item of await readdir(path.join(root,relative),{withFileTypes:true})){const name=path.posix.join(relative,item.name);if(item.isDirectory())await walk(name);else if(item.isFile())files.push(name);}}
await walk('app');
files.push('scripts/yuanda-agent.mjs','scripts/yuanda-mcp.mjs','scripts/smoke-desktop.mjs','scripts/test-agent-mcp-desktop.mjs','scripts/platform-runtime.mjs','docs/试玩指南.md','docs/Agent接入.md','docs/文件说明.md','LICENSE');
for(const dependency of ['@modelcontextprotocol/server','@modelcontextprotocol/core','zod'])await walk(`node_modules/${dependency}`);
const sha=data=>createHash('sha256').update(data).digest('hex'),checks=[];
for(const name of files.sort()){
  const source=await readFile(path.join(root,name)),copy=await readFile(path.join(packaged,name));
  checks.push({path:name,bytes:copy.length,sha256:sha(copy),matchesSource:sha(source)===sha(copy)});
}
const packagedInfo=JSON.parse(await readFile(path.join(packaged,'package.json'),'utf8'));
for(const [sourceName,releaseName] of [['samples/yuanda/页面目录体验.yuanda','projects/页面目录体验.yuanda'],['exports/页面目录体验.html','exports/页面目录体验.html']]){
  const source=await readFile(path.join(root,sourceName)),copy=await readFile(path.join(release,releaseName));
  checks.push({path:sourceName,releasePath:releaseName,bytes:copy.length,sha256:sha(copy),matchesSource:sha(source)===sha(copy)});
}
const executable=await readFile(releaseLayout(release).executable),electron=await readFile(electronExecutable(root));
let signatureVerified=null;
if(process.platform==='darwin')await promisify(execFile)('/usr/bin/codesign',['--verify','--deep','--strict',releaseLayout(release).bundle]).then(()=>signatureVerified=true);
const result={ok:checks.every(item=>item.matchesSource)&&packagedInfo.version===info.version&&(process.platform==='darwin'?signatureVerified:sha(executable)===sha(electron)),version:info.version,platform:process.platform,release,executable:{bytes:executable.length,sha256:sha(executable),matchesRuntime:sha(executable)===sha(electron),signatureVerified,comparison:process.platform==='darwin'?'Application source bytes plus local code-signature integrity; signing changes Mach-O bytes.':'Unmodified runtime executable bytes.'},files:checks};
const output=path.join(root,'.local','release-audit');await mkdir(output,{recursive:true});await writeFile(path.join(output,`${info.version}.json`),JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:result.ok,version:result.version,checkedFiles:checks.length,report:path.join(output,`${info.version}.json`)},null,2));if(!result.ok)process.exitCode=1;
