import { cp, mkdir, readFile, writeFile, rename, access, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronExecutable, releaseLayout, projectEnvironment, updatePlistStrings } from './platform-runtime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!['win32', 'darwin'].includes(process.platform)) throw new Error('桌面打包目前支持 Windows 与 macOS 本机；Linux 仅提供开发运行入口，尚未验收发行包。');
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'dist', `原搭-${packageInfo.version}`);
await access(electronExecutable(root)); // A Windows node_modules folder cannot supply a Mac runtime.
try { await access(output); throw new Error(`${output} 已存在。为保护项目与运行数据，请使用新的版本号或保留旧文件夹后再构建。`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const staging = path.join(root, 'dist', `build-${Date.now()}`);
await mkdir(staging, { recursive: true });
await cp(path.join(root, 'node_modules/electron/dist'), staging, { recursive: true, verbatimSymlinks: true });
const mac = process.platform === 'darwin', layout = releaseLayout(staging), finalLayout = releaseLayout(output);
if (mac) await rename(path.join(staging, 'Electron.app'), layout.bundle);
else await rename(path.join(staging, 'electron.exe'), layout.executable);
const destination = layout.app;
await mkdir(destination, { recursive: true });
await cp(path.join(root, 'app'), path.join(destination, 'app'), { recursive: true });
await mkdir(path.join(destination, 'scripts'), { recursive: true });
for (const name of ['yuanda-agent.mjs', 'yuanda-mcp.mjs', 'smoke-desktop.mjs', 'test-agent-mcp-desktop.mjs', 'platform-runtime.mjs']) await cp(path.join(root, 'scripts', name), path.join(destination, 'scripts', name));
for (const name of ['@modelcontextprotocol/server','@modelcontextprotocol/core','zod']) {
  const source=path.join(root,'node_modules',name),info=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
  if(info.version!==packageInfo.dependencies[name])throw new Error(`MCP 依赖版本与锁定版本不同：${name}`);
  await cp(source,path.join(destination,'node_modules',name),{recursive:true});
}
for (const name of ['试玩指南.md', 'Agent接入.md', '文件说明.md']) await cp(path.join(root, 'docs', name), path.join(destination, 'docs', name));
await cp(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
await writeFile(path.join(destination, 'package.json'), JSON.stringify({ name: packageInfo.name, productName: '原搭', version: packageInfo.version, type: 'module', main: 'app/main.mjs', license: 'MIT', dependencies:packageInfo.dependencies }, null, 2));
const mcp={command:finalLayout.executable,args:[path.join(finalLayout.app,'scripts/yuanda-mcp.mjs'),'--connection',path.join(output,'data/connection.json')],env:{ELECTRON_RUN_AS_NODE:'1'}};
await writeFile(path.join(staging,'Agent-MCP配置.json'),JSON.stringify({mcpServers:{yuanda:mcp}},null,2));
await writeFile(path.join(staging,'Agent-Codex配置.toml'),`[mcp_servers.yuanda]\ncommand = '${mcp.command}'\nargs = [${mcp.args.map(v=>`'${v}'`).join(', ')}]\nenabled = true\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n[mcp_servers.yuanda.env]\nELECTRON_RUN_AS_NODE = '1'\n`);
await mkdir(path.join(staging,'projects'),{recursive:true});await mkdir(path.join(staging,'exports'),{recursive:true});
await cp(path.join(root,'samples/rp-agent-demo-20261015-v2/原搭-图片与跳转演示.yuanda'),path.join(staging,'projects/原搭-图片与跳转演示.yuanda'));
await cp(path.join(root,'samples/rp-agent-demo-20261015-v2/原搭-图片与跳转演示.rp'),path.join(staging,'exports/原搭-图片与跳转演示.rp'));
await cp(path.join(root,'samples/yuanda/页面目录体验.yuanda'),path.join(staging,'projects/页面目录体验.yuanda'));
await cp(path.join(root,'exports/页面目录体验.html'),path.join(staging,'exports/页面目录体验.html'));
await writeFile(path.join(staging, '先读我.txt'), `原搭 ${packageInfo.version}\n\n双击「${mac?'原搭.app':'原搭.exe'}」打开。请保留整个文件夹，包括旁边的 projects、exports 和 data。\n这是开发预览便携版，不需要安装 Node.js。首次打开自带可编辑演示。\nRP支持基础图形、文字、多页、静态PNG与单击跳页；复杂内容会提示并停止导出。保存.yuanda工程保留全部编辑数据，导出HTML保留交互。\nRP演示工程在 projects/原搭-图片与跳转演示.yuanda，已生成RP在 exports。页面目录演示在 projects/页面目录体验.yuanda，对应HTML在 exports；含目录的RP导出暂不支持。\nAgent连接配置见 Agent-MCP配置.json / Agent-Codex配置.toml。\n个人项目放 projects，导出放 exports，恢复与Agent连接放 data；不要公开 data 里的连接令牌。\n这是单独的新版本，可通过“打开”选择旧版 .yuanda 文件。退出后可整体移动文件夹，移动后重新复制应用显示的 Agent 连接说明。\n${mac?'macOS 包仅供本机开发，使用临时签名，尚未经过 Developer ID 签名与 Apple 公证；不是面向他人分发的正式 Mac 安装包。请放在自己的可写开发目录，勿单独移动 .app 到 /Applications。\n':''}`);
if (mac) {
  const run = promisify(execFile), environment = projectEnvironment(root);
  await mkdir(environment.TMPDIR, { recursive: true });
  async function brand(plist, fields) {
    await run('/usr/bin/plutil', ['-convert', 'xml1', plist], { env: environment });
    await writeFile(plist, updatePlistStrings(await readFile(plist, 'utf8'), fields));
    await run('/usr/bin/plutil', ['-lint', plist], { env: environment });
  }
  await brand(path.join(layout.bundle, 'Contents/Info.plist'), { CFBundleName:'原搭', CFBundleDisplayName:'原搭', CFBundleIdentifier:'org.yuanda.prototype', CFBundleShortVersionString:packageInfo.version.split('-')[0], CFBundleVersion:packageInfo.version.split('-')[0] });
  for (const entry of await readdir(path.join(layout.bundle, 'Contents/Frameworks'), { withFileTypes:true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('Electron Helper') || !entry.name.endsWith('.app')) continue;
    const suffix=entry.name.slice('Electron Helper'.length, -4), id=suffix.toLowerCase().replace(/[^a-z0-9]/g,'');
    await brand(path.join(layout.bundle,'Contents/Frameworks',entry.name,'Contents/Info.plist'), { CFBundleName:`原搭 Helper${suffix}`,CFBundleDisplayName:`原搭 Helper${suffix}`,CFBundleIdentifier:`org.yuanda.prototype.helper${id?'.'+id:''}` });
  }
  // Local development signature only. Public distribution needs Developer ID signing and notarization.
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', layout.bundle], { env:environment });
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', layout.bundle], { env:environment });
}
await writeFile(path.join(staging,'BUILD-INFO.json'),JSON.stringify({version:packageInfo.version,platform:process.platform,architecture:process.arch,createdAt:new Date().toISOString(),macSigning:mac?'ad-hoc-local-development-only':null,notarized:false},null,2));
await rename(staging, output);
console.log(`已生成：${mac?finalLayout.bundle:finalLayout.executable}`);
