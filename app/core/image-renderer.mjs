/** Original image presentation shared by the editor, offline player and raster export. */
import { inspectImageDataUrl } from './image-format.mjs';
import { resolveNodeVisual, styleColor } from './style-renderer.mjs';

export function computeImageLayout(node, options = {}) {
  const image = node.image || {}, positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  const width = Math.max(0, options.width ?? node.width ?? 0), height = Math.max(0, options.height ?? node.height ?? 0);
  const sourceWidth = positive(options.naturalWidth, positive(image.naturalWidth, Math.max(1, width)));
  const sourceHeight = positive(options.naturalHeight, positive(image.naturalHeight, Math.max(1, height)));
  const originalWidth = positive(options.originalWidth, sourceWidth), originalHeight = positive(options.originalHeight, sourceHeight);
  const normalized = image.crop || { x: 0, y: 0, width: 1, height: 1 };
  const crop = { x: normalized.x * sourceWidth, y: normalized.y * sourceHeight, width: normalized.width * sourceWidth, height: normalized.height * sourceHeight };
  const tiles = [], tile = (sx, sy, sw, sh, dx, dy, dw, dh) => {
    if (sw > 0 && sh > 0 && dw > 0 && dh > 0) tiles.push({ source: { x: sx, y: sy, width: sw, height: sh }, destination: { x: dx, y: dy, width: dw, height: dh } });
  };
  if (width > 0 && height > 0 && crop.width > 0 && crop.height > 0) {
    if (image.corners) {
      const c = image.corners, maxWidth = normalized.width * originalWidth, maxHeight = normalized.height * originalHeight;
      // A replacement image can have different dimensions. Clamp presentation,
      // never mutate the saved corner choices while resolving the new resource.
      const capX = Math.min(1, Math.max(0, maxWidth - 1e-6) / (c.left + c.right || 1));
      const capY = Math.min(1, Math.max(0, maxHeight - 1e-6) / (c.top + c.bottom || 1));
      const left = c.left * capX, right = c.right * capX, top = c.top * capY, bottom = c.bottom * capY;
      const factor = Math.min(1, width / (left + right || 1), height / (top + bottom || 1));
      const xs = [crop.x, crop.x + left * sourceWidth / originalWidth, crop.x + crop.width - right * sourceWidth / originalWidth, crop.x + crop.width];
      const ys = [crop.y, crop.y + top * sourceHeight / originalHeight, crop.y + crop.height - bottom * sourceHeight / originalHeight, crop.y + crop.height];
      const xd = [0, left * factor, width - right * factor, width], yd = [0, top * factor, height - bottom * factor, height];
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) tile(xs[x], ys[y], xs[x + 1] - xs[x], ys[y + 1] - ys[y], xd[x], yd[y], xd[x + 1] - xd[x], yd[y + 1] - yd[y]);
    } else if ((image.fit || 'cover') === 'cover') {
      const scale = Math.max(width / crop.width, height / crop.height), sw = width / scale, sh = height / scale;
      tile(crop.x + (crop.width - sw) / 2, crop.y + (crop.height - sh) / 2, sw, sh, 0, 0, width, height);
    } else tile(crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  }
  const filters = image.filters || {}, filter = filters.enabled ? `hue-rotate(${filters.hue ?? 0}deg) saturate(${filters.saturation ?? 1}) brightness(${filters.brightness ?? 1}) contrast(${filters.contrast ?? 1})` : 'none';
  return { width, height, sourceWidth, sourceHeight, crop, tiles, cuts: (image.cuts || []).map(rect => ({ x: rect.x * sourceWidth, y: rect.y * sourceHeight, width: rect.width * sourceWidth, height: rect.height * sourceHeight })), flipX: !!image.flipX, flipY: !!image.flipY, filter };
}

/** Only data URLs enter the browser. Decoded dimensions outrank stale metadata. */
export function loadImageSource(node, options = {}) {
  const src = options.original ? node.src : node.image?.optimization?.src || node.src;
  if (!src) return Promise.resolve({ image: null, src: '', width: 0, height: 0 });
  if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) return Promise.reject(new Error('图片必须是内嵌 PNG、JPEG、WebP 或 GIF'));
  const cache = loadImageSource.cache ||= new Map();
  if (cache.has(src)) { const value = cache.get(src); cache.delete(src); cache.set(src, value); return value; }
  try { inspectImageDataUrl(src); } catch (error) { return Promise.reject(error); }
  const pending = new Promise((resolve, reject) => {
    const img = new Image(); img.decoding = 'async';
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return reject(new Error('图片尺寸无效'));
      if (img.naturalWidth > 8192 || img.naturalHeight > 8192 || img.naturalWidth * img.naturalHeight > 16 * 1024 * 1024) return reject(new Error('图片超过 8192 边长或 1600 万像素限制'));
      resolve({ image: img, src, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('图片无法解码')); img.src = src;
  });
  cache.set(src, pending); while (cache.size > 32) cache.delete(cache.keys().next().value);
  pending.catch(() => { if (cache.get(src) === pending) cache.delete(src); });
  return pending;
}

/** The same line breaking and baseline placement is used for DOM and canvas. */
export function computeImageTextLayout(node, options = {}) {
  const style = options.style || node.style || {}, visual = resolveNodeVisual(node,{style}), settings = visual.text, width = options.width ?? visual.inner.width, height = options.height ?? visual.inner.height;
  const box = visual.padding, padding = box.left, fontSize = settings.fontSize, lineHeight = settings.lineHeight, usable = Math.max(0, width - box.left - box.right);
  const font = `${settings.italic?'italic ':''}${settings.fontWeight} ${fontSize}px ${settings.fontFamily}`;
  const measure = options.measure || (value => ({ width: [...value].length * fontSize })), lines = [];
  let content = String(node.text || '');if(settings.textCase==='uppercase')content=content.toUpperCase();else if(settings.textCase==='lowercase')content=content.toLowerCase();else if(settings.textCase==='capitalize')content=content.replace(/(^|\s)(\S)/gu,(_,space,char)=>space+char.toUpperCase());
  for (const paragraph of content.split('\n')) { let line = ''; for (const char of paragraph) { if (line && measure(line + char).width > usable) { lines.push(line); line = char; } else line += char; } lines.push(line); }
  const blockHeight = lines.length * lineHeight, y = settings.verticalAlign === 'top' ? box.top : settings.verticalAlign === 'bottom' ? height - box.bottom - blockHeight : box.top+(height-box.top-box.bottom-blockHeight)/2;
  const metrics = measure('Mg'), ascent = metrics.fontBoundingBoxAscent ?? fontSize * .8, descent = metrics.fontBoundingBoxDescent ?? fontSize * .2;
  const baseline=(lineHeight-ascent-descent)/2+ascent,decorations=[];
  lines.forEach((line,index)=>{const length=measure(line).width,x=settings.align==='right'?width-box.right-length:settings.align==='center'?box.left+(usable-length)/2:box.left,bottom=y+index*lineHeight+baseline,thickness=Math.max(1,fontSize/14);if(style.underline)decorations.push({x,y:bottom+Math.max(1,fontSize*.08),width:length,height:thickness});if(style.strike)decorations.push({x,y:bottom-fontSize*.3,width:length,height:thickness});});
  return { lines, font, fontSize, lineHeight, padding, paddingBox:box, usable, y, baseline, align: settings.align, color: settings.color, letterSpacing:settings.letterSpacing, decoration:settings.decoration,decorations };
}

/** Keeps image DOM identity and src stable across text, variable and view updates. */
export function paintImageContent(container, node, options = {}) {
  let state = container.__yuandaImage;
  const doc = container.ownerDocument, create = cls => { const el = doc.createElement('div'); el.className = cls; el.style.pointerEvents = 'none'; return el; };
  if (!state) {
    const raster = create('yuanda-image-raster'), text = create('yuanda-image-text');
    Object.assign(raster.style, { position: 'absolute', zIndex: '0', inset: '0', overflow: 'hidden', transformOrigin: '50% 50%' });
    Object.assign(text.style, { position: 'absolute', zIndex: '2', inset: '0', display: 'flex', whiteSpace: 'pre-wrap', overflow: 'hidden', lineHeight: '1.45' });
    const span = doc.createElement('div'); Object.assign(span.style, { position: 'absolute', whiteSpace: 'pre' }); text.append(span);
    container.replaceChildren(raster, text); state = { raster, text, span, tiles: [], source: null, original: null, src: null, originalSrc: null, ready: Promise.resolve(), error: null, request: 0 };
    Object.defineProperty(container, '__yuandaImage', { value: state, configurable: true });
  }
  state.node = node; state.options = options;
  const render = () => {
    const current = state.node, settings = current.image || {}, style = state.options.style || current.style || {}, visual = resolveNodeVisual(current,{style});
    const width = state.options.width ?? visual.inner.width, height = state.options.height ?? visual.inner.height;
    const layout = computeImageLayout(current, { width, height, naturalWidth: state.source?.width, naturalHeight: state.source?.height, originalWidth: state.original?.width, originalHeight: state.original?.height }); state.layout = layout;
    Object.assign(state.raster.style, { width: `${width}px`, height: `${height}px`, transform: `scale(${layout.flipX ? -1 : 1},${layout.flipY ? -1 : 1})`, filter: layout.filter, visibility: state.source?.image ? 'visible' : 'hidden' });
    while (state.tiles.length > layout.tiles.length) { const removed = state.tiles.pop(); removed.box.remove(); }
    while (state.tiles.length < layout.tiles.length) {
      const box = create('yuanda-image-tile'), img = doc.createElement('img'); img.alt = ''; img.setAttribute('aria-hidden', 'true'); img.draggable = false;
      Object.assign(box.style, { position: 'absolute', overflow: 'hidden' });
      Object.assign(img.style, { position: 'absolute', maxWidth: 'none', maxHeight: 'none', objectFit: 'fill', pointerEvents: 'none' }); box.append(img); state.raster.append(box); state.tiles.push({ box, img });
    }
    // Luminance masking makes overlapping cut rectangles a union, not XOR.
    const mask = layout.cuts.length ? 'url("data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.sourceWidth} ${layout.sourceHeight}" preserveAspectRatio="none"><rect width="100%" height="100%" fill="white"/>${layout.cuts.map(cut => `<rect x="${cut.x}" y="${cut.y}" width="${cut.width}" height="${cut.height}" fill="black"/>`).join('')}</svg>`) + '")' : 'none';
    for (let index = 0; index < layout.tiles.length; index++) {
      const { source: s, destination: d } = layout.tiles[index], { box, img } = state.tiles[index], sx = d.width / s.width, sy = d.height / s.height;
      Object.assign(box.style, { left: `${d.x}px`, top: `${d.y}px`, width: `${d.width}px`, height: `${d.height}px` });
      Object.assign(img.style, { left: `${-s.x * sx}px`, top: `${-s.y * sy}px`, width: `${layout.sourceWidth * sx}px`, height: `${layout.sourceHeight * sy}px`, maskImage: mask, maskMode: 'luminance', maskSize: '100% 100%', maskRepeat: 'no-repeat' });
      if (state.source?.src && img.getAttribute('src') !== state.source.src) img.src = state.source.src;
    }
    const text = settings.text || {}; state.text.hidden = !text.enabled;
    if (text.enabled) {
    const measureContext = state.measureContext ||= doc.createElement('canvas').getContext('2d');
    measureContext.font = `${visual.text.italic?'italic ':''}${visual.text.fontWeight} ${visual.text.fontSize}px ${visual.text.fontFamily}`;measureContext.letterSpacing=`${visual.text.letterSpacing}px`;
    const textLayout = computeImageTextLayout(current, { width, height, style, measure: value => measureContext.measureText(value) });
    const pad=textLayout.paddingBox;
    const shadows=(style.textShadows||[]).map(shadow=>`${shadow.x}px ${shadow.y}px ${shadow.blur}px ${styleColor(shadow.color,shadow.opacity)}`).join(',')||'none';
    Object.assign(state.text.style, { width: `${width}px`, height: `${height}px`, color: textLayout.color, font: textLayout.font, lineHeight: `${textLayout.lineHeight}px`, letterSpacing:`${textLayout.letterSpacing}px`, textDecoration:'none', textTransform:'none', textAlign: textLayout.align, clipPath: `inset(${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px)`, textShadow:shadows });
    Object.assign(state.span.style, { left: `${pad.left}px`, top: `${textLayout.y}px`, width: `${textLayout.usable}px` });
    const signature = JSON.stringify(textLayout.lines);
    if (state.textSignature !== signature) { state.span.replaceChildren(...textLayout.lines.map(line => { const row = doc.createElement('div'); row.style.height = `${textLayout.lineHeight}px`; row.textContent = line || '\u200b'; return row; })); state.textSignature = signature; }
    for (const row of state.span.children) row.style.height = `${textLayout.lineHeight}px`;
    if(!state.decorations){state.decorations=doc.createElement('div');state.decorations.className='yuanda-image-text-decoration';Object.assign(state.decorations.style,{position:'absolute',inset:'0',pointerEvents:'none'});state.text.append(state.decorations);}
    state.decorations.replaceChildren(...textLayout.decorations.map(rect=>{const line=doc.createElement('div');Object.assign(line.style,{position:'absolute',left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`,background:textLayout.color,boxShadow:shadows});return line;}));
    }
    container.dataset.imageReady = String(!!state.source?.image); container.dataset.imageError = state.error?.message || '';
  };
  const src = node.image?.optimization?.src || node.src || '', originalSrc = node.src || '';
  if (state.src !== src || state.originalSrc !== originalSrc) {
    state.src = src; state.originalSrc = originalSrc; state.source = null; state.original = null; state.error = null; const request = ++state.request;
    state.ready = Promise.all([loadImageSource(node), loadImageSource(node, { original: true })]).then(([source, original]) => {
      if (request !== state.request) return state.layout; state.source = source; state.original = original; render(); return state.layout;
    }).catch(error => { if (request === state.request) { state.error = error; render(); } return null; });
  }
  render(); return state;
}

/** Raster export shares the tile geometry, cut masks, filter order and flipping. */
export async function drawImageContent(target, node, options = {}) {
  const canvas = target.canvas || target, doc = canvas.ownerDocument || document;
  const [source, original] = await Promise.all([loadImageSource(node), loadImageSource(node, { original: true })]);
  const visual = resolveNodeVisual(node,{style:options.style||node.style});
  const width = Math.max(1, Math.round(options.width ?? visual.inner.width)), height = Math.max(1, Math.round(options.height ?? visual.inner.height));
  if (width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) throw new Error('图片导出超过 8192 边长或 1600 万像素限制，请降低尺寸');
  const layout = computeImageLayout(node, { width, height, naturalWidth: source.width, naturalHeight: source.height, originalWidth: original.width, originalHeight: original.height });
  const surface = doc.createElement('canvas'); surface.width = width; surface.height = height; const ctx = surface.getContext('2d');
  if (source.image) {
    const pixels = doc.createElement('canvas'); pixels.width = source.width; pixels.height = source.height;
    const p = pixels.getContext('2d'); p.drawImage(source.image, 0, 0); p.globalCompositeOperation = 'destination-out';
    for (const cut of layout.cuts) p.fillRect(cut.x, cut.y, cut.width, cut.height);
    ctx.save(); ctx.translate(layout.flipX ? width : 0, layout.flipY ? height : 0); ctx.scale(layout.flipX ? -1 : 1, layout.flipY ? -1 : 1); ctx.filter = layout.filter;
    for (const { source: s, destination: d } of layout.tiles) ctx.drawImage(pixels, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height);
    ctx.restore();
  }
  if (options.includeText !== false && node.image?.text?.enabled) {
    const style = options.style || node.style || {};
    ctx.font = `${visual.text.italic?'italic ':''}${visual.text.fontWeight} ${visual.text.fontSize}px ${visual.text.fontFamily}`;ctx.letterSpacing=`${visual.text.letterSpacing}px`;
    const text = computeImageTextLayout(node, { width, height, style, measure: value => ctx.measureText(value) }), padding = text.paddingBox;
    ctx.fillStyle = text.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = text.align;
    const x = text.align === 'right' ? width - padding.right : text.align === 'center' ? padding.left+text.usable/2 : padding.left;
    const textLayer=doc.createElement('canvas'),shadowMask=doc.createElement('canvas');
    for(const layer of [textLayer,shadowMask]){
      layer.width=width;layer.height=height;const lettering=layer.getContext('2d');Object.assign(lettering,{font:ctx.font,letterSpacing:ctx.letterSpacing,fillStyle:layer===textLayer?text.color:'#000000',textBaseline:'alphabetic',textAlign:text.align});
      text.lines.forEach((line,index)=>lettering.fillText(line,x,text.y+index*text.lineHeight+text.baseline));
      for(const rect of text.decorations)lettering.fillRect(rect.x,rect.y,rect.width,rect.height);
    }
    ctx.save();ctx.beginPath();ctx.rect(padding.left,padding.top,text.usable,Math.max(0,height-padding.top-padding.bottom));ctx.clip();
    for(const shadow of [...(style.textShadows||[])].reverse()){ctx.save();const shift=width+shadow.blur*4+Math.abs(shadow.x)+10;ctx.shadowOffsetX=shift+shadow.x;ctx.shadowOffsetY=shadow.y;ctx.shadowBlur=shadow.blur;ctx.shadowColor=styleColor(shadow.color,shadow.opacity);ctx.drawImage(shadowMask,-shift,0);ctx.restore();}
    ctx.drawImage(textLayer,0,0);ctx.restore();
  }
  const selection = options.selection || { x: 0, y: 0, width: 1, height: 1 };
  if (![selection.x, selection.y, selection.width, selection.height].every(Number.isFinite) || selection.x < 0 || selection.y < 0 || selection.width <= 0 || selection.height <= 0 || selection.x + selection.width > 1.000000001 || selection.y + selection.height > 1.000000001) throw new Error('图片选择区域无效');
  canvas.width = Math.max(1, Math.round(width * selection.width)); canvas.height = Math.max(1, Math.round(height * selection.height));
  canvas.getContext('2d').drawImage(surface, width * selection.x, height * selection.y, width * selection.width, height * selection.height, 0, 0, canvas.width, canvas.height);
  return { canvas, width: canvas.width, height: canvas.height, layout };
}
