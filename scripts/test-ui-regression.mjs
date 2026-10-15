import { electronExecutable } from './platform-runtime.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.local', 'ui-regression');
await mkdir(path.join(root, '.local', 'tmp'), { recursive: true });
const args = [path.join(root, 'scripts', 'ui-regression.mjs'), ...process.argv.slice(2)];
const child = spawn(electronExecutable(root), args, {
  cwd: root, windowsHide: true, stdio: 'inherit',
  env: { ...process.env, TEMP: path.join(root, '.local', 'tmp'), TMP: path.join(root, '.local', 'tmp'), TMPDIR: path.join(root, '.local', 'tmp') }
});
const timer = setTimeout(() => { child.kill(); console.error('UI 回归测试超过 45 秒。'); }, 45000);
child.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
child.on('exit', async code => {
  clearTimeout(timer);
  const output = process.argv.find(value => value.startsWith('--output='))?.slice(9) || 'result.json';
  try { const result = JSON.parse(await readFile(path.join(runtime, output), 'utf8')); console.log(JSON.stringify({ ok: result.ok, checks: result.checks, errors: result.errors, fatal: result.fatal, report: path.join(runtime, output) }, null, 2)); }
  catch { console.error('未生成 UI 回归结果'); }
  process.exitCode = typeof code === 'number' ? code : 1;
});
