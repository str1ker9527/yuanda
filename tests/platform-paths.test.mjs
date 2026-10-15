import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { electronExecutable, releaseLayout, portableBase } from '../app/platform-paths.mjs';
import { projectEnvironment, resolveNpmCli, copyReleaseRuntime, updatePlistStrings } from '../scripts/platform-runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('Windows runtime and release layout remain compatible with existing portable folders',()=>{
  const base='D:\\Projects\\原搭 project',release=base+'\\dist\\原搭-v1';
  assert.equal(electronExecutable(base,'win32'),base+'\\node_modules\\electron\\dist\\electron.exe');
  const value=releaseLayout(release,'win32');assert.equal(value.executable,release+'\\原搭.exe');assert.equal(value.app,release+'\\resources\\app');assert.equal(value.runtime,release+'\\data');assert.equal(portableBase(value.executable,'win32'),release);
});
test('macOS layout stores all mutable portable data outside the application bundle',()=>{
  const base='/Users/example/dev/原搭 project',release=base+'/dist/原搭-v1',value=releaseLayout(release,'darwin');
  assert.equal(electronExecutable(base,'darwin'),base+'/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  assert.equal(value.bundle,release+'/原搭.app');assert.equal(value.app,value.bundle+'/Contents/Resources/app');assert.equal(value.executable,value.bundle+'/Contents/MacOS/Electron');
  assert.equal(portableBase(value.executable,'darwin'),release);
  for(const field of ['runtime','projects','exports'])assert(!value[field].startsWith(value.bundle+'/'));
  assert.throws(()=>portableBase('/usr/bin/node','darwin'),/bundle/);
});
test('Linux development runtime uses the native executable and rejects unknown platforms',()=>{
  assert.equal(electronExecutable('/work/原搭','linux'),'/work/原搭/node_modules/electron/dist/electron');
  assert.equal(releaseLayout('/release','linux').executable,'/release/yuanda');
  assert.throws(()=>electronExecutable('/work','unknown'),/Unsupported/);
});
test('Mac bundle branding preserves nested plist dictionaries and inserts new fields at the root',()=>{
  const before='<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>Electron</string><key>Nested</key><dict><key>mode</key><string>unchanged</string></dict></dict></plist>';
  const after=updatePlistStrings(before,{CFBundleName:'原搭 & tools',CFBundleDisplayName:'原搭 $&'});
  assert(after.includes('<string>原搭 &amp; tools</string>'));
  assert(after.includes('<key>Nested</key><dict><key>mode</key><string>unchanged</string></dict>'));
  assert(after.indexOf('CFBundleDisplayName')>after.indexOf('</dict>'));assert(after.includes('<string>原搭 $&amp;</string>'));
  assert.throws(()=>updatePlistStrings('binary plist',{}),/XML dictionary/);
});
test('temporary files and npm/Electron caches use project-owned paths on every platform',()=>{
  const temporary=path.join(root,'.local','test-temp'),inherited={TMPDIR:'/outside',OTHER:'retained'};
  const env=projectEnvironment(root,temporary,inherited);assert.equal(env.TMPDIR,temporary);assert.equal(env.TMP,temporary);assert.equal(env.TEMP,temporary);assert.equal(env.OTHER,'retained');assert.equal(inherited.TMPDIR,'/outside');
  for(const key of ['npm_config_cache','ELECTRON_CACHE','electron_config_cache'])assert(env[key].startsWith(path.join(root,'.local')+path.sep));
});
test('npm CLI resolver handles Windows sibling and Unix prefix layouts without shell execution',async()=>{
  await mkdir(path.join(root,'.local','platform-tests'),{recursive:true});const directory=await mkdtemp(path.join(root,'.local','platform-tests','npm-'));
  for(const relative of ['node_modules/npm/bin/npm-cli.js','../lib/node_modules/npm/bin/npm-cli.js']){
    const executable=path.join(directory,relative.startsWith('../')?'unix/bin':'windows','node'),cli=path.resolve(path.dirname(executable),relative);
    await mkdir(path.dirname(cli),{recursive:true});await writeFile(cli,'// fixture');assert.equal(await resolveNpmCli({executable,env:{PATH:''}}),cli);
  }
  await assert.rejects(resolveNpmCli({executable:path.join(directory,'missing/node'),env:{PATH:''}}),/未找到 npm/);
});
test('native runtime isolation copies and hashes the executable without touching original files',async()=>{
  if(process.platform==='darwin')return; // Mac bundle copy is exercised by native --dist UI validation, not a fake executable.
  await mkdir(path.join(root,'.local','platform-tests'),{recursive:true});const directory=await mkdtemp(path.join(root,'.local','platform-tests','runtime-')),release=path.join(directory,'release'),target=path.join(directory,'copy'),layout=releaseLayout(release);
  await mkdir(path.join(release,'resources'),{recursive:true});await writeFile(layout.executable,'native-runtime-fixture');await writeFile(path.join(release,'resources/default_app.asar'),'default-app-fixture');
  const result=await copyReleaseRuntime(release,target);assert.equal(result.executable,releaseLayout(target).executable);assert.equal(result.originalExecutable,layout.executable);assert.equal(result.files.length,2);assert.equal(await readFile(result.executable,'utf8'),'native-runtime-fixture');assert.equal(await readFile(layout.executable,'utf8'),'native-runtime-fixture');
});
test('Mac-shaped runtime fixture excludes packaged app resources so the test harness remains the entrypoint',async()=>{
  await mkdir(path.join(root,'.local','platform-tests'),{recursive:true});const directory=await mkdtemp(path.join(root,'.local','platform-tests','mac-layout-')),release=path.join(directory,'release'),target=path.join(directory,'copy'),layout=releaseLayout(release,'darwin');
  await mkdir(path.dirname(layout.executable),{recursive:true});await mkdir(layout.app,{recursive:true});await writeFile(layout.executable,'not-a-real-Mach-O');await writeFile(path.join(layout.resources,'default_app.asar'),'default-app-fixture');await writeFile(path.join(layout.app,'package.json'),'{"main":"app/main.mjs"}');
  const result=await copyReleaseRuntime(release,target,{platform:'darwin'});assert.equal(result.files.length,2);assert.equal(await readFile(result.executable,'utf8'),'not-a-real-Mach-O');await assert.rejects(readFile(path.join(releaseLayout(target,'darwin').app,'package.json')),{code:'ENOENT'});assert(await readFile(path.join(layout.app,'package.json'),'utf8'));
});
