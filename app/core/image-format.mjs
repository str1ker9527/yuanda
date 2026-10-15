/** Portable original container preflight shared by model, desktop and browser. */
export const IMAGE_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, batchBytes: 24 * 1024 * 1024, count: 8, edge: 8192, pixels: 16 * 1024 * 1024, frames: 300, animationPixels: 64 * 1024 * 1024 });

/** Header/block bounds are checked before handing compressed pixels to Chromium. */
export function inspectImageBytes(input) {
  const IMAGE_LIMITS = {bytes:4*1024*1024,edge:8192,pixels:16*1024*1024,frames:300,animationPixels:64*1024*1024};
  const mimes = {png:'image/png',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',svg:'image/svg+xml'};
  const fail = message => { throw Object.assign(new Error(message),{code:'IMAGE_ERROR'}); };
  const size = (width,height,frames=1) => {
    if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>IMAGE_LIMITS.edge||height>IMAGE_LIMITS.edge||width*height>IMAGE_LIMITS.pixels) fail('图片尺寸超过限制（单边 8192、总像素 16 Mi）');
    if (!Number.isInteger(frames)||frames<1||frames>IMAGE_LIMITS.frames||frames>1&&width*height*frames>IMAGE_LIMITS.animationPixels) fail('动画超过 300 帧或累计像素 64 Mi');
  };
  const b = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!b||!b.length||b.length>IMAGE_LIMITS.bytes) fail('图片须为 1 字节至 4 MiB');
  const view = new DataView(b.buffer,b.byteOffset,b.byteLength);
  const ascii = (start,end) => {let value='';for(let i=start;i<end;i++)value+=String.fromCharCode(b[i]);return value;};
  const signature = (offset,bytes) => bytes.every((value,index)=>b[offset+index]===value);
  const findPair = (first,second,start) => {for(let i=start;i<b.length-1;i++)if(b[i]===first&&b[i+1]===second)return i;return -1;};
  const u24 = offset => b[offset]+b[offset+1]*256+b[offset+2]*65536;
  const crcTable=Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1?0xEDB88320^(value>>>1):value>>>1;return value>>>0;});
  const crc32=bytes=>{let value=0xFFFFFFFF;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return(value^0xFFFFFFFF)>>>0;};
  let format, width, height, frames = 1;
  const need = (offset, count) => { if (offset < 0 || count < 0 || offset + count > b.length) fail('图片内容截断'); };
  if (b.length >= 8 && signature(0,[137,80,78,71,13,10,26,10])) {
    format = 'png'; let p = 8, ended = false, imageData = false, animation = false, frameCount = 0;
    while (p < b.length) { need(p, 12); const length = view.getUint32(p), type = ascii(p + 4,p + 8); need(p + 12, length);
      if (crc32(b.subarray(p + 4, p + 8 + length)) !== view.getUint32(p + 8 + length)) fail('PNG 数据校验失败，图片可能已损坏');
      if (p === 8) { if (type !== 'IHDR' || length !== 13) fail('PNG 图像头无效'); width = view.getUint32(p + 8); height = view.getUint32(p + 12); size(width, height); }
      else if (type === 'IHDR') fail('PNG 图像头重复');
      if (type === 'acTL') { if (length !== 8 || animation) fail('PNG 动画头无效'); animation = true; frames = view.getUint32(p + 8); size(width, height, frames); }
      if (type === 'fcTL') { if (length !== 26 || !animation) fail('PNG 动画帧头无效'); const w = view.getUint32(p + 12), h = view.getUint32(p + 16), x = view.getUint32(p + 20), y = view.getUint32(p + 24); size(w, h); if (x + w > width || y + h > height) fail('PNG 动画帧超出画布'); size(width, height, ++frameCount); }
      if (type === 'IDAT') imageData = true; p += length + 12;
      if (type === 'IEND') { if (length || p !== b.length) fail('PNG 结尾无效'); ended = true; break; }
    } if (!ended || !imageData || animation && frameCount !== frames) fail('PNG 内容或动画帧数不完整');
  } else if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) {
    format = 'jpeg'; let p = 2;
    while (p < b.length) { if (b[p++] !== 255) fail('JPEG 标记无效'); while (b[p] === 255) p++; need(p, 1); const marker = b[p++]; if (marker === 0xDA || marker === 0xD9) break; if (marker === 1 || marker >= 0xD0 && marker <= 0xD7) continue;
      need(p, 2); const length = view.getUint16(p); if (length < 2) fail('JPEG 数据长度无效'); need(p, length);
      if ([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)) { if (length < 8) fail('JPEG 图像头无效'); height = view.getUint16(p + 3); width = view.getUint16(p + 5); size(width, height); }
      p += length;
    } if (!width || findPair(255,217,p) < 0) fail('JPEG 内容不完整');
  } else if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0,6))) {
    format = 'gif'; need(0, 13); width = view.getUint16(6,true); height = view.getUint16(8,true); size(width, height);
    let p = 13 + (b[10] & 128 ? 3 * 2 ** ((b[10] & 7) + 1) : 0), ended = false; frames = 0;
    const blocks = () => { while (true) { need(p, 1); const length = b[p++]; if (!length) return; need(p, length); p += length; } };
    while (p < b.length) { const tag = b[p++]; if (tag === 0x3B) { ended = true; if (p !== b.length) fail('GIF 结尾无效'); break; }
      if (tag === 0x21) { need(p++, 1); blocks(); }
      else if (tag === 0x2C) { need(p, 9); const x = view.getUint16(p,true), y = view.getUint16(p + 2,true), w = view.getUint16(p + 4,true), h = view.getUint16(p + 6,true), packed = b[p + 8]; size(w, h); if (x + w > width || y + h > height) fail('GIF 帧超出画布'); p += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0); need(p, 1); const codeSize = b[p++]; if (codeSize < 2 || codeSize > 8) fail('GIF 编码无效'); blocks(); frames++; size(width, height, frames); }
      else fail('GIF 数据块无效');
    } if (!ended || !frames) fail('GIF 内容不完整');
  } else if (b.length >= 12 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') {
    format = 'webp'; if (view.getUint32(4,true) + 8 !== b.length) fail('WebP 数据长度无效'); let p = 12, counted = 0, extended = false;
    while (p < b.length) { need(p, 8); const type = ascii(p,p + 4), length = view.getUint32(p + 4,true), start = p + 8; need(start, length); p = start + length + length % 2; need(p, 0);
      if (type === 'VP8X') { if (length !== 10 || extended || width) fail('WebP 图像头无效'); extended = true; width = u24(start + 4) + 1; height = u24(start + 7) + 1; size(width, height); }
      if (type === 'VP8 ' || type === 'VP8L') {
        let w, h;
        if (type === 'VP8 ') { if (length < 10 || !signature(start + 3,[0x9D,1,0x2A])) fail('WebP 帧头无效'); w = view.getUint16(start + 6,true) & 0x3FFF; h = view.getUint16(start + 8,true) & 0x3FFF; }
        else { if (length < 5 || b[start] !== 0x2F) fail('WebP 无损帧头无效'); const bits = view.getUint32(start + 1,true); w = (bits & 0x3FFF) + 1; h = ((bits >>> 14) & 0x3FFF) + 1; }
        size(w, h); if (width && (w > width || h > height)) fail('WebP 像素帧超出画布'); width ??= w; height ??= h;
      }
      if (type === 'ANMF') {
        if (length < 16 || !extended) fail('WebP 动画帧无效'); const x = u24(start) * 2, y = u24(start + 3) * 2, w = u24(start + 6) + 1, h = u24(start + 9) + 1;
        size(w, h); if (x + w > width || y + h > height) fail('WebP 动画帧超出画布'); counted++; size(width, height, counted);
        let nested = start + 16, found = false;
        while (nested < start + length) {
          need(nested, 8); const tag = ascii(nested,nested + 4), bytes = view.getUint32(nested + 4,true), data = nested + 8;
          if (data + bytes + bytes % 2 > start + length) fail('WebP 动画压缩帧截断'); let pw, ph;
          if (tag === 'VP8 ') { if (bytes < 10 || !signature(data + 3,[0x9D,1,0x2A])) fail('WebP 动画压缩帧头无效'); pw = view.getUint16(data + 6,true) & 0x3FFF; ph = view.getUint16(data + 8,true) & 0x3FFF; }
          if (tag === 'VP8L') { if (bytes < 5 || b[data] !== 0x2F) fail('WebP 动画无损帧头无效'); const bits = view.getUint32(data + 1,true); pw = (bits & 0x3FFF) + 1; ph = ((bits >>> 14) & 0x3FFF) + 1; }
          if (pw !== undefined) { size(pw, ph); if (pw !== w || ph !== h || found) fail('WebP 动画压缩尺寸不一致'); found = true; }
          nested = data + bytes + bytes % 2;
        }
        if (!found) fail('WebP 动画缺少压缩帧');
      }
    } frames = counted || 1;
  } else if (b.length >= 2 && ascii(0,2) === 'BM') {
    format = 'bmp'; need(0, 26); const header = view.getUint32(14,true), offset = view.getUint32(10,true); need(14, header); if (offset < 14 + header || offset >= b.length) fail('BMP 像素位置无效');
    if (header === 12) { width = view.getUint16(18,true); height = view.getUint16(20,true); }
    else { if (header < 40 || header > 124) fail('暂不支持此 BMP 图像头'); width = view.getInt32(18,true); height = Math.abs(view.getInt32(22,true)); }
  } else if (/^\s*(?:<\?xml\b|<!--|<svg\b)/i.test(new TextDecoder('utf-8').decode(b).replace(/^\uFEFF/, ''))) format = 'svg';
  else fail('无法识别图片，请使用 PNG、JPEG、WebP、GIF、BMP 或静态 SVG');
  if (format !== 'svg') size(width, height, frames);
  return { format, mime: mimes[format], width, height, animated: frames > 1, frames };
}


/** Portable data URL preflight. This validates container structure, not compressed pixels. */
export function inspectImageDataUrl(src) {
  const fail=message=>{throw Object.assign(new Error(message),{code:'IMAGE_ERROR'});};
  if(typeof src!=='string'||src.length>Math.ceil(4*1024*1024/3)*4+40)fail('单张图片必须不超过 4 MiB');
  const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if(!match||match[2].length%4)fail('图片仅支持有效的内嵌 PNG、JPEG、WebP、GIF 数据');
  let binary;try{binary=atob(match[2]);}catch{fail('图片 Base64 无效');}
  if(btoa(binary)!==match[2])fail('图片 Base64 无效');
  const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0)),info=inspectImageBytes(bytes);
  if(info.mime!==match[1])fail('图片声明格式与实际数据不一致');
  return {...info,bytes:bytes.byteLength};
}
