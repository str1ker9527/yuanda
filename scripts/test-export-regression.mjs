import { electronExecutable } from './platform-runtime.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(electronExecutable(root), [path.join(root, 'scripts', 'export-regression.mjs')], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: path.join(root, '.local', 'tmp'), TMP: path.join(root, '.local', 'tmp'), TMPDIR: path.join(root, '.local', 'tmp') } });
const timer = setTimeout(() => { child.kill(); console.error('导出回归超过 45 秒。'); }, 45000);
child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timer); process.exitCode = code || 0; });
