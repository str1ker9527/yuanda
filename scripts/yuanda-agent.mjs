#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ci = args.indexOf('--connection');
let connectionFile = process.env.YUANDA_CONNECTION || path.join(root, '.local/yuanda-agent/connection.json');
if (ci !== -1) { if (!args[ci + 1]) throw new Error('--connection 后需要文件路径'); connectionFile = args[ci + 1]; args.splice(ci, 2); }
const current = args.includes('--current');
if (current) args.splice(args.indexOf('--current'), 1);
try {
  const connection = JSON.parse(await readFile(connectionFile, 'utf8'));
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(connection.url)) throw new Error('连接文件不是本机地址');
  const request = async (endpoint, body) => {
    const response = await fetch(`${connection.url}/v1/${endpoint}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${connection.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok) throw new Error(`${result.code}: ${result.message}`); return result;
  };
  const action = args[0] || 'state'; let result;
  if (['state','schema','libraries'].includes(action)) result = await request(action);
  else if (action === 'library') {if(!/^[A-Za-z0-9_-]{1,128}$/.test(args[1]||''))throw new Error('library 后需要已登记的库 ID');result=await request(`libraries/${args[1]}`);}
  else if (['apply','undo','redo'].includes(action)) {
    let body = action === 'apply' ? JSON.parse(await readFile(args[1], 'utf8')) : {};
    if (current) body = { ...body, expectedRevision: (await request('state')).revision };
    if (!Number.isSafeInteger(body.expectedRevision)) throw new Error('请在 JSON 中填写 expectedRevision；撤销/重做请显式加 --current');
    result = await request(action === 'apply' ? 'commands' : action, body);
  } else throw new Error('用法：state | schema | libraries | library 库ID | apply 指令.json | undo --current | redo --current，可加 --connection 连接文件');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) { process.stderr.write(`原搭 Agent：${error.message}\n请先打开原搭，连接文件：${connectionFile}\n`); process.exitCode = 1; }
