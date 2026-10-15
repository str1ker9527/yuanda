/** Local user image acquisition. No document edits and no HTTP/path API. */
import { open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeImagePayload } from './image-decoder.mjs';
import { IMAGE_LIMITS, inspectImageBytes } from './core/image-format.mjs';
export { IMAGE_LIMITS, inspectImageBytes } from './core/image-format.mjs';

export const CLIPBOARD_TOKEN_TYPE = 'web application/x-yuanda-fragment-token';
const fail = (message, code = 'IMAGE_ERROR') => { throw Object.assign(new Error(message), { code }); };
function size(width, height, frames = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > IMAGE_LIMITS.edge || height > IMAGE_LIMITS.edge || width * height > IMAGE_LIMITS.pixels) fail('图片尺寸超过限制（单边 8192、总像素 16 Mi）');
  if (!Number.isInteger(frames) || frames < 1 || frames > IMAGE_LIMITS.frames || frames > 1 && width * height * frames > IMAGE_LIMITS.animationPixels) fail('动画超过 300 帧或累计像素 64 Mi');
}
export async function readImageFile(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) fail('无效图片文件');
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat(); if (!stat.isFile()) fail('请选择普通图片文件');
    if (stat.size > IMAGE_LIMITS.bytes) fail('图片大于 4 MiB，请先缩小图片');
    const buffer = Buffer.alloc(IMAGE_LIMITS.bytes + 1); let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null); if (!bytesRead) break; offset += bytesRead; }
    if (offset > IMAGE_LIMITS.bytes) fail('读取期间图片超过 4 MiB');
    if (!offset) fail('图片文件为空');
    return { name: path.basename(filePath).slice(0, 200), bytes: buffer.subarray(0, offset) };
  } finally { await handle.close(); }
}


export function createChromiumImageDecoder({ BrowserWindow, session, timeoutMs = 10000 }) {
  const partition = `yuanda-image-${randomUUID()}`; let sandboxSession;
  return async (bytes, info) => {
    const payload = { src: `data:${info.mime};base64,${bytes.toString('base64')}`, format: info.format, limits: IMAGE_LIMITS, ...(info.format === 'svg' ? { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } : {}) };
    if (!sandboxSession) {
      sandboxSession = session.fromPartition(partition, { cache: false });
      sandboxSession.setPermissionRequestHandler((_, __, callback) => callback(false)); sandboxSession.setPermissionCheckHandler(() => false);
      sandboxSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') && details.url !== 'about:blank' }));
    }
    const worker = new BrowserWindow({ show: false, width: 32, height: 32, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, partition } });
    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); worker.webContents.on('will-navigate', event => event.preventDefault());
    let timer;
    try {
      return await Promise.race([(async () => {
        await worker.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; script-src \'none\'; style-src \'none\'; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'));
        return await worker.webContents.executeJavaScript(`(${decodeImagePayload.toString()})(${JSON.stringify(payload)})`);
      })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('图片解码超过 10 秒，已取消'), { code: 'IMAGE_TIMEOUT' })), timeoutMs); })]);
    } finally { clearTimeout(timer); if (!worker.isDestroyed()) worker.destroy(); }
  };
}

export async function prepareImageAsset({ bytes, name = '图片' }, decode) {
  const info = inspectImageBytes(bytes), decoded = await decode(Buffer.from(bytes), info); size(decoded.naturalWidth, decoded.naturalHeight, info.frames);
  const converted = info.format === 'svg' || info.format === 'bmp';
  const src = converted ? decoded.src : `data:${info.mime};base64,${Buffer.from(bytes).toString('base64')}`;
  if (typeof src !== 'string' || converted && !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) fail('图片转换失败');
  const encoded = src.slice(src.indexOf(',') + 1), output = Buffer.from(encoded, 'base64');
  if (output.length > IMAGE_LIMITS.bytes) fail('转换后的 PNG 超过 4 MiB，请缩小源图片');
  if (converted) { const info = inspectImageBytes(output); if (info.width !== decoded.naturalWidth || info.height !== decoded.naturalHeight) fail('转换后的 PNG 尺寸不一致'); }
  return { name: String(name).slice(0, 200) || '图片', src, mime: converted ? 'image/png' : info.mime, naturalWidth: decoded.naturalWidth, naturalHeight: decoded.naturalHeight, sourceFormat: info.format, converted, animated: info.animated, warnings: converted ? [`${info.format.toUpperCase()} 已转换为静态 PNG，原文件保持不变。`] : [] };
}

export class ImageInputService {
  constructor({ decode, clipboard, ClipboardItem }) { Object.assign(this, { decode, clipboard, ClipboardItem }); this.internal = null; }
  async fromFiles(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > IMAGE_LIMITS.count) fail('每次请选择 1–8 张图片');
    const images = []; let total = 0, inputTotal = 0;
    for (const filePath of paths) { const input = await readImageFile(filePath); inputTotal += input.bytes.length; if (inputTotal > IMAGE_LIMITS.batchBytes) fail('本批源图片总量超过 24 MiB'); const asset = await prepareImageAsset(input, this.decode); total += Buffer.from(asset.src.split(',')[1], 'base64').length; if (total > IMAGE_LIMITS.batchBytes) fail('本批图片总量超过 24 MiB'); images.push(asset); }
    return images;
  }
  async markInternal(projectId) {
    const token = randomUUID(); await this.clipboard.write([new this.ClipboardItem({ [CLIPBOARD_TOKEN_TYPE]: new Blob([token], { type: 'application/octet-stream' }), 'text/plain': '原搭元件' })]);
    this.internal = { projectId, token }; return { token };
  }
  async readPaste({ projectId, internalToken }) {
    const items = await this.clipboard.read(); if (!Array.isArray(items) || items.length > IMAGE_LIMITS.count) fail('剪贴板内容数量超过限制');
    const images = []; let total = 0;
    // Raw animated representations take precedence over alternate static copies.
    for (const item of items) {
      const type = ['image/gif','image/webp','image/png','image/jpeg','image/bmp','image/x-ms-bmp','image/svg+xml'].find(type => item.types.includes(type));
      if (!type) continue;
      const blob = await item.getType(type); if (!(blob instanceof Blob) || blob.size > IMAGE_LIMITS.bytes) fail('剪贴板图片超过 4 MiB 或数据无效');
      const asset = await prepareImageAsset({ bytes: Buffer.from(await blob.arrayBuffer()), name: '剪贴板图片' }, this.decode);
      total += Buffer.from(asset.src.split(',')[1], 'base64').length; if (total > IMAGE_LIMITS.batchBytes) fail('剪贴板图片总量超过 24 MiB'); images.push(asset);
    }
    if (images.length) return { kind: 'images', images };
    if (this.internal?.projectId === projectId && this.internal.token === internalToken) for (const item of items) if (item.types.includes(CLIPBOARD_TOKEN_TYPE)) {
      const value = await item.getType(CLIPBOARD_TOKEN_TYPE); if (value instanceof Blob && value.size <= 128 && await value.text() === internalToken) return { kind: 'internal', token: internalToken };
    }
    return { kind: 'empty' };
  }
  async writeImage(src) {
    if (typeof src !== 'string' || src.length > 6 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) fail('复制图片只接受内嵌 PNG');
    const encoded = src.slice(src.indexOf(',') + 1); if (encoded.length % 4) fail('PNG Base64 无效');
    const bytes = Buffer.from(encoded, 'base64'); if (bytes.toString('base64') !== encoded) fail('PNG Base64 无效');
    if (inspectImageBytes(bytes).format !== 'png') fail('复制图片数据不是 PNG');
    await prepareImageAsset({ bytes }, this.decode); await this.clipboard.write([new this.ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]); this.internal = null; return { ok: true };
  }
}
