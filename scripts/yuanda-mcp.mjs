#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { startAgentMcp } from '../app/agent-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const args = process.argv.slice(2);
  let connectionFile = process.env.YUANDA_CONNECTION || path.join(root, '.local/yuanda-agent/connection.json');
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--connection' || !args[1]) throw new Error('用法：yuanda-mcp.mjs --connection 连接文件绝对路径');
    connectionFile = args[1];
  }
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await startAgentMcp({ connectionFile: path.resolve(connectionFile), version });
} catch {
  // Never print connection data, SDK exception payloads, or other text on protocol stdout.
  process.stderr.write('原搭 MCP 启动失败，请使用完整便携版，并检查 --connection 参数和项目内 MCP 依赖。\n');
  process.exitCode = 1;
}
