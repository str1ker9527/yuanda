import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { schema } from './agent-schema.mjs';
export { schema };

export async function startAgentServer({ connectionFile, getState, command, undo, redo, save, exportFile, select, validate, libraryList = async()=>({libraries:[],errors:[]}), libraryRead, onActivity = () => {} }) {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  let requests = 0, lastActivity = null;
  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(data));
    };
    try {
      const boundAddress = server.address();
      const localHost = boundAddress && typeof boundAddress === 'object' ? `127.0.0.1:${boundAddress.port}` : '';
      if (req.headers.origin !== undefined || req.headers.host !== localHost) return reply(403, { code: 'LOCAL_ONLY', message: '仅接受本机 Agent 连接' });
      const supplied = Buffer.from(req.headers.authorization || '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, { code: 'UNAUTHORIZED', message: '访问令牌无效' });
      if (req.method === 'GET' && req.url === '/v1/schema') return reply(200, schema);
      if (req.method === 'GET' && req.url === '/v1/state') return reply(200, getState());
      if (req.method === 'GET' && req.url === '/v1/libraries') return reply(200, await libraryList());
      if (req.method === 'GET' && /^\/v1\/libraries\/[A-Za-z0-9_-]{1,128}$/.test(req.url) && libraryRead) return reply(200, await libraryRead(req.url.slice('/v1/libraries/'.length)));
      const handlers = { '/v1/commands': command, '/v1/undo': undo, '/v1/redo': redo, '/v1/save': save, '/v1/export': exportFile, '/v1/selection': select, '/v1/validate': validate };
      if (req.method !== 'POST' || typeof handlers[req.url] !== 'function') return reply(404, { code: 'NOT_FOUND', message: '接口不存在' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { code: 'CONTENT_TYPE', message: '请提交 application/json' });
      let bytes = 0, chunks = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 36 * 1024 * 1024) { reply(413, { code: 'TOO_LARGE', message: '指令内容过大' }); req.resume(); return; } chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { code: 'BAD_JSON', message: '不是有效 JSON' }); }
      if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== getState().revision) return reply(409, { code: 'REVISION_CONFLICT', message: '项目已变化，请重新读取 state 后提交版本号' });
      const result = await handlers[req.url](body);
      requests++; lastActivity = new Date().toISOString(); onActivity({ requests, lastActivity });
      reply(200, result);
    } catch (error) { reply(error.code === 'REVISION_CONFLICT' ? 409 : 400, { code: error.code || 'REQUEST_ERROR', message: error.message }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await mkdir(path.dirname(connectionFile), { recursive: true });
  try { await writeFile(connectionFile, JSON.stringify({ version: 1, url: `http://127.0.0.1:${port}`, token, pid: process.pid }, null, 2), { mode: 0o600 }); }
  catch (error) { server.close(); throw error; }
  return { port, connectionFile, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await unlink(connectionFile).catch(() => {}); } };
}
