import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectEnvironment, resolveNpmCli } from './platform-runtime.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(root, '.local/tmp');
await mkdir(temporary, { recursive: true });
const env = projectEnvironment(root, temporary);
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`安装进程退出：${code}`)));
});
// Locate npm's JavaScript entry point without relying on Windows shell quoting.
const npmCli = await resolveNpmCli();
await run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund']);
await run(process.execPath, [path.join(root, 'node_modules/electron/install.js')]);
console.log('安装完成：依赖、下载缓存和临时文件均位于项目内。');
