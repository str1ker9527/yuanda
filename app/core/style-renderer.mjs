/** Original typed style presentation shared by all authoring and HTML surfaces. */
import { inspectImageDataUrl } from './image-format.mjs';

export function styleColor(color, opacity = 1) {
  let value = String(color || '#000000').toLowerCase();
  if (value === 'transparent') return 'rgba(0,0,0,0)';
  if (value === 'white') value = '#ffffff'; if (value === 'black') value = '#000000';
  value = value.slice(1); if (value.length <= 4) value = [...value].map(char => char + char).join('');
  const alpha = value.length === 8 ? parseInt(value.slice(6), 16) / 255 : 1;
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${alpha * opacity})`;
}

/** Read-only box/text metrics. Padding affects text, not an image's source pixels. */
export function resolveNodeVisual(node, options = {}) {
  const style = options.style || node.style || {}, width = Math.max(0, node.width || 0), height = Math.max(0, node.height || 0);
  const vector = ['path', 'connector', 'line'].includes(node.type), uniform = style.strokeWidth || 0;
  const border = vector ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: uniform, right: uniform, bottom: uniform, left: uniform, ...style.borderSides };
  const horizontal = Math.min(1, width / (border.left + border.right || 1)), vertical = Math.min(1, height / (border.top + border.bottom || 1));
  border.left *= horizontal; border.right *= horizontal; border.top *= vertical; border.bottom *= vertical;
  let radii = { topLeft: style.radius || 0, topRight: style.radius || 0, bottomRight: style.radius || 0, bottomLeft: style.radius || 0, ...style.radiusCorners };
  if (node.type === 'ellipse') radii = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  const ratio = Math.min(1, width / (radii.topLeft + radii.topRight || 1), width / (radii.bottomLeft + radii.bottomRight || 1), height / (radii.topLeft + radii.bottomLeft || 1), height / (radii.topRight + radii.bottomRight || 1));
  radii = Object.fromEntries(Object.entries(radii).map(([key, value]) => [key, value * ratio]));
  const fallbackPadding = node.type === 'image' ? { top: node.image?.text?.padding ?? 8, right: node.image?.text?.padding ?? 8, bottom: node.image?.text?.padding ?? 8, left: node.image?.text?.padding ?? 8 }
    : ['button', 'rectangle'].includes(node.type) ? { top: 4, right: 8, bottom: 4, left: 8 }
      : ['input', 'select'].includes(node.type) ? { top: 0, right: 10, bottom: 0, left: 10 }
        : node.type === 'textarea' ? { top: 9, right: 10, bottom: 9, left: 10 } : { top: 0, right: 0, bottom: 0, left: 0 };
  const padding = { ...(style.padding || fallbackPadding) }, inner = { x: border.left, y: border.top, width: Math.max(0, width - border.left - border.right), height: Math.max(0, height - border.top - border.bottom) };
  const fontSize = style.fontSize || 14, family = style.fontFamily ?? node.richText?.fontFamily;
  const text = { fontFamily: family ? JSON.stringify(family) + ',"Segoe UI","Microsoft YaHei",sans-serif' : 'Inter,"Segoe UI","Microsoft YaHei",sans-serif', fontSize,
    fontWeight: style.fontWeight || 400, lineHeight: style.lineHeight ?? fontSize * (node.richText?.lineHeight || 1.45), letterSpacing: style.letterSpacing || 0,
    verticalAlign: style.verticalAlign ?? (node.type === 'image' ? node.image?.text?.verticalAlign || 'middle' : ['text', 'textarea', 'table'].includes(node.type) ? 'top' : 'middle'),
    align: style.align || 'left', color: style.color || '#191919', italic: !!style.italic, decoration: [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none', textCase: style.textCase || 'none' };
  return { style, width, height, border, radii, inner, padding, text, content: { x: inner.x + padding.left, y: inner.y + padding.top, width: Math.max(0, inner.width - padding.left - padding.right), height: Math.max(0, inner.height - padding.top - padding.bottom) } };
}

/** CSS-angle gradients use the same physical coordinate system on SVG paths. */
export function styleGradientGeometry(paint, width, height) {
  if (paint.type === 'radial') return { cx: paint.cx * width, cy: paint.cy * height, rx: paint.radius * width, ry: paint.radius * height };
  const angle = paint.angle * Math.PI / 180, dx = Math.sin(angle), dy = -Math.cos(angle), length = Math.abs(width * dx) + Math.abs(height * dy);
  return { x1: width / 2 - dx * length / 2, y1: height / 2 - dy * length / 2, x2: width / 2 + dx * length / 2, y2: height / 2 + dy * length / 2 };
}

/** Rounded outer or inner rectangles, including unequal border corner radii. */
export function styleRoundedPath(x, y, width, height, corners) {
  const pairs = Object.fromEntries(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(key => { const v = corners[key] || 0; return [key, typeof v === 'number' ? { x: v, y: v } : { x: v.x, y: v.y }]; }));
  const { topLeft: a, topRight: b, bottomRight: c, bottomLeft: d } = pairs;
  const factor = Math.min(1, width / (a.x + b.x || 1), width / (c.x + d.x || 1), height / (a.y + d.y || 1), height / (b.y + c.y || 1));
  for (const p of Object.values(pairs)) { p.x = Math.max(0, p.x * factor); p.y = Math.max(0, p.y * factor); }
  const arc = (p, endX, endY) => p.x && p.y ? `A ${p.x} ${p.y} 0 0 1 ${endX} ${endY}` : `L ${endX} ${endY}`;
  return `M ${x + a.x} ${y} H ${x + width - b.x} ${arc(b, x + width, y + b.y)} V ${y + height - c.y} ${arc(c, x + width - c.x, y + height)} H ${x + d.x} ${arc(d, x, y + height - d.y)} V ${y + a.y} ${arc(a, x + a.x, y)} Z`;
}

export function loadStyleImage(src) {
  const cache = loadStyleImage.cache ||= new Map(); if (cache.has(src)) return cache.get(src);
  let info; try { info = inspectImageDataUrl(src); } catch (error) { return Promise.reject(error); }
  const pending = new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight, info }); image.onerror = () => reject(new Error('填充图片无法解码')); image.src = src; });
  cache.set(src, pending); while (cache.size > 16) cache.delete(cache.keys().next().value); pending.catch(() => { if (cache.get(src) === pending) cache.delete(src); }); return pending;
}

/** Update a private paint server without replacing an animated image element. */
export function applyStylePaint(defs, key, paint, color, width, height, uid, onReady) {
  const doc = defs.ownerDocument, ns = 'http://www.w3.org/2000/svg', make = tag => doc.createElementNS(ns, tag), id = uid + '-' + key;
  const states = defs.__yuandaPaints ||= new Map(); let state = states.get(key);
  const type = paint?.type || 'solid';
  if (!paint) { if (state) { state.element.remove(); states.delete(key); } return color; }
  if (!state || state.type !== type) {
    state?.element.remove(); const element = make(type === 'linear' ? 'linearGradient' : type === 'radial' ? 'radialGradient' : 'pattern'); element.id = id; defs.append(element); state = { element, type, src: null, imageSize: null, stops: [] }; states.set(key, state);
  }
  const el = state.element, attr = values => { for (const [name, value] of Object.entries(values)) el.setAttribute(name, String(value)); };
  if (type === 'image') {
    if (!state.image) { state.image = make('image'); el.append(state.image); }
    if (state.src !== paint.src) {
      state.src = paint.src; state.imageSize = null; const source = paint.src;
      try {
        const info = inspectImageDataUrl(source); state.imageSize = info; state.image.setAttribute('href', source);
        state.framePulse?.remove(); state.framePulse = null;
        // Chromium does not invalidate cached SVG patterns for GIF frames alone.
        // A native, visually negligible opacity pulse invalidates the paint server
        // while retaining the original image and its decoder/animation timeline.
        if (info.animated) { const pulse = make('animate'); for (const [key,value] of Object.entries({attributeName:'opacity',values:'1;0.99999;1',dur:'0.1s',repeatCount:'indefinite'})) pulse.setAttribute(key,value); state.image.append(pulse); state.framePulse = pulse; }
      }
      catch (error) { state.image.removeAttribute('href'); state.error = error; return 'none'; }
      state.ready = loadStyleImage(source).then(size => { if (state.src === source) { state.imageSize = size; state.error = null; onReady?.(); } }).catch(error => { if (state.src === source) { state.error = error; state.image.removeAttribute('href'); } });
    }
    const size = state.imageSize || { width: 1, height: 1 }, tile = paint.fit === 'tile';
    const scale = paint.fit === 'cover' ? Math.max(width / size.width, height / size.height) : paint.fit === 'contain' ? Math.min(width / size.width, height / size.height) : 1;
    const w = paint.fit === 'stretch' ? width : size.width * scale, h = paint.fit === 'stretch' ? height : size.height * scale;
    attr({ patternUnits: 'userSpaceOnUse', x: tile ? (width - w) * paint.positionX : 0, y: tile ? (height - h) * paint.positionY : 0, width: Math.max(.0001, tile ? w : width), height: Math.max(.0001, tile ? h : height) });
    for (const [name, value] of Object.entries({ x: tile ? 0 : (width - w) * paint.positionX, y: tile ? 0 : (height - h) * paint.positionY, width: w, height: h, preserveAspectRatio: 'none' })) state.image.setAttribute(name, String(value));
  } else {
    const g = styleGradientGeometry(paint, width, height); attr({ gradientUnits: 'userSpaceOnUse' });
    if (type === 'linear') attr(g); else attr({ cx: 0, cy: 0, r: 1, gradientTransform: `translate(${g.cx} ${g.cy}) scale(${g.rx} ${g.ry})` });
    while (state.stops.length > paint.stops.length) state.stops.pop().remove();
    while (state.stops.length < paint.stops.length) { const stop = make('stop'); el.append(stop); state.stops.push(stop); }
    paint.stops.forEach((value, index) => { const stop = state.stops[index]; stop.setAttribute('offset', String(value.offset)); stop.setAttribute('stop-color', value.color); stop.setAttribute('stop-opacity', String(value.opacity)); });
  }
  return `url(#${id})`;
}

/** SVG shadows follow the actual path, with inner clipping and spread. */
export function applyStyleShadows(defs, shadows, uid, width, height) {
  const previous = defs.__yuandaShadow; const signature = JSON.stringify([shadows, width, height]);
  if (previous?.signature === signature) return previous.url;
  previous?.element?.remove();
  if (!shadows?.length) { defs.__yuandaShadow = { signature, url: '' }; return ''; }
  const make = (tag, attrs = {}) => { const el = defs.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); return el; };
  const extent = Math.max(...shadows.map(s => Math.max(Math.abs(s.x), Math.abs(s.y)) + s.blur * 3 + Math.abs(s.spread) + 4)), id = uid + '-shadow';
  const filter = make('filter', { id, filterUnits: 'userSpaceOnUse', x: -extent, y: -extent, width: width + extent * 2, height: height + extent * 2, 'color-interpolation-filters': 'sRGB' }); defs.append(filter);
  const outer = [], inner = [];
  shadows.forEach((s, index) => {
    const name = 'shadow' + index, spread = s.inset ? -s.spread : s.spread;
    filter.append(make('feMorphology', { in: 'SourceAlpha', operator: spread >= 0 ? 'dilate' : 'erode', radius: Math.abs(spread), result: name + '-spread' }), make('feGaussianBlur', { in: name + '-spread', stdDeviation: s.blur / 2, result: name + '-blur' }), make('feOffset', { in: name + '-blur', dx: s.x, dy: s.y, result: name + '-offset' }));
    if (s.inset) filter.append(make('feComposite', { in: 'SourceAlpha', in2: name + '-offset', operator: 'out', result: name + '-mask' }));
    filter.append(make('feFlood', { 'flood-color': s.color, 'flood-opacity': s.opacity, result: name + '-color' }), make('feComposite', { in: name + '-color', in2: name + (s.inset ? '-mask' : '-offset'), operator: 'in', result: name }));
    (s.inset ? inner : outer).unshift(name);
  });
  const merge = make('feMerge'); for (const name of [...outer, 'SourceGraphic', ...inner]) merge.append(make('feMergeNode', { in: name })); filter.append(merge);
  const url = `url(#${id})`; defs.__yuandaShadow = { signature, element: filter, url }; return url;
}

/** Paint an existing SVG geometry. Caller retains its hit path and arrow nodes. */
export function applyVectorVisual(drawing, path, node, options = {}) {
  const style = options.style || node.style, geometry = options.geometry || { width: node.width, height: node.height, closed: true }, doc = drawing.ownerDocument;
  let state = drawing.__yuandaVectorStyle;
  if (!state) { const defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs'); drawing.prepend(defs); state = { defs, uid: options.uid || `yvs-${applyVectorVisual.serial = (applyVectorVisual.serial || 0) + 1}` }; Object.defineProperty(drawing, '__yuandaVectorStyle', { value: state }); }
  state.node = node; state.options = options;
  const refresh = () => { if (drawing.__yuandaVectorStyle === state) applyVectorVisual(drawing, path, state.node, state.options); };
  const timing = style.transition || {}, cssTransition = options.transitions !== false && (timing.duration || timing.delay) ? ['fill','fill-opacity','stroke','stroke-opacity','stop-color','stop-opacity'].map(key => `${key} ${timing.duration || 0}ms ${timing.easing || 'ease'} ${timing.delay || 0}ms`).join(',') : 'none';
  path.style.transition = cssTransition;
  const fill = applyStylePaint(state.defs, 'fill', style.fillPaint, style.fill, geometry.width, geometry.height, state.uid, refresh), stroke = applyStylePaint(state.defs, 'stroke', style.strokePaint, style.stroke, geometry.width, geometry.height, state.uid, refresh);
  for (const paint of state.defs.__yuandaPaints?.values() || []) for (const stop of paint.stops) stop.style.transition = cssTransition;
  for (const [key, value] of Object.entries({ fill: geometry.closed ? fill : 'none', 'fill-opacity': style.fillOpacity ?? 1, stroke, 'stroke-opacity': style.strokeOpacity ?? 1, 'stroke-width': style.strokeWidth, 'stroke-linejoin': 'round', 'stroke-linecap': style.strokeStyle === 'dotted' ? 'round' : 'butt' })) path.setAttribute(key, String(value));
  const dash = style.strokeStyle === 'dashed' ? `${style.strokeWidth * 3} ${style.strokeWidth * 2}` : style.strokeStyle === 'dotted' ? `0 ${style.strokeWidth * 2}` : '';
  if (dash) path.setAttribute('stroke-dasharray', dash); else path.removeAttribute('stroke-dasharray');
  const filter = applyStyleShadows(state.defs, style.shadows, state.uid, geometry.width, geometry.height); if (filter) path.setAttribute('filter', filter); else path.removeAttribute('filter');
  for (const marker of options.markers || []) { marker.setAttribute('fill', stroke); marker.setAttribute('fill-opacity', String(style.strokeOpacity ?? 1)); }
  drawing.style.overflow = 'visible'; return state;
}

/** Stable, pointer-transparent decorations. Never replaces real content or controls. */
export function applyNodeVisual(element, node, options = {}) {
  const metrics = resolveNodeVisual(node, options), { style, width, height, border, radii, padding, text } = metrics, doc = element.ownerDocument;
  const vector = ['path', 'connector', 'line'].includes(node.type), transition = style.transition || {}, animated = options.transitions !== false && (transition.duration || transition.delay);
  const cssTransition = animated ? `color ${transition.duration || 0}ms ${transition.easing || 'ease'} ${transition.delay || 0}ms,opacity ${transition.duration || 0}ms ${transition.easing || 'ease'} ${transition.delay || 0}ms,filter ${transition.duration || 0}ms ${transition.easing || 'ease'} ${transition.delay || 0}ms,box-shadow ${transition.duration || 0}ms ${transition.easing || 'ease'} ${transition.delay || 0}ms,transform ${transition.duration || 0}ms ${transition.easing || 'ease'} ${transition.delay || 0}ms` : 'none';
  const boxShadows = (style.shadows || []).filter(s => !s.inset).map(s => `${s.inset ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${styleColor(s.color, s.opacity)}`).join(',') || 'none';
  Object.assign(element.style, { boxSizing: 'border-box', width: width + 'px', height: height + 'px', background: 'transparent', borderStyle: 'solid', borderColor: 'transparent', borderWidth: `${border.top}px ${border.right}px ${border.bottom}px ${border.left}px`, borderRadius: node.type === 'ellipse' ? '50%' : `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`, opacity: String(style.opacity ?? 1), color: text.color, fontFamily: text.fontFamily, fontSize: text.fontSize + 'px', fontWeight: String(text.fontWeight), fontStyle: text.italic ? 'italic' : 'normal', letterSpacing: text.letterSpacing + 'px', lineHeight: text.lineHeight + 'px', textAlign: text.align, textDecoration: text.decoration, textTransform: text.textCase, textShadow: (style.textShadows || []).map(s => `${s.x}px ${s.y}px ${s.blur}px ${styleColor(s.color, s.opacity)}`).join(',') || 'none', padding: '0', filter: style.blur ? `blur(${style.blur}px)` : 'none', backdropFilter: style.backdropBlur ? `blur(${style.backdropBlur}px)` : 'none', transformOrigin: `${(style.transformOrigin?.x ?? .5) * 100}% ${(style.transformOrigin?.y ?? .5) * 100}%`, transition: cssTransition, boxShadow: vector ? 'none' : boxShadows });
  if (node.type === 'image') { element.style.textDecoration = 'none'; element.style.textShadow = 'none'; }
  const content = options.contentElement, control = options.controlElement;
  if (content) Object.assign(content.style, { position: 'relative', zIndex: '2', boxSizing: 'border-box', width: '100%', maxHeight: '100%', overflow: 'hidden', fontFamily: text.fontFamily, lineHeight: text.lineHeight + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', padding: `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px` });
  if (content && !control) Object.assign(element.style, { display: 'flex', flexDirection: 'column', justifyContent: text.verticalAlign === 'top' ? 'flex-start' : text.verticalAlign === 'bottom' ? 'flex-end' : 'center', alignItems: 'stretch' });
  if (control) Object.assign(control.style, { position: 'relative', zIndex: '2', boxSizing: 'border-box', width: '100%', height: '100%', minWidth: '0', minHeight: '0', border: '0', background: 'transparent', borderRadius: 'inherit', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', fontStyle: 'inherit', lineHeight: text.lineHeight + 'px', letterSpacing: 'inherit', textAlign: 'inherit', textDecoration: 'inherit', textTransform: 'inherit', textShadow: 'inherit', padding: `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`, outlineOffset: '2px', resize: 'none' });
  if (vector) { element.style.overflow = 'visible'; return metrics; }
  if (!node.panel) { element.style.overflow = 'clip'; element.style.overflowClipMargin = 'border-box'; }
  let state = element.__yuandaVisual;
  const make = (tag, attrs = {}) => { const el = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); return el; };
  if (!state) {
    const drawing = make('svg', { 'aria-hidden': 'true', focusable: 'false' }), defs = make('defs'), fill = make('path'), borderGroup = make('g'), ring = make('path'); drawing.append(defs, fill, borderGroup); borderGroup.append(ring); drawing.classList.add('yuanda-style-decoration');
    Object.assign(drawing.style, { position: 'absolute', pointerEvents: 'none', overflow: 'visible', zIndex: '-1' }); state = { drawing, defs, fill, borderGroup, ring, uid: options.uid || `ys-${applyNodeVisual.serial = (applyNodeVisual.serial || 0) + 1}` };
    Object.defineProperty(element, '__yuandaVisual', { value: state, configurable: true });
  }
  // Keep cached nodes even when a caller has just replaced ordinary text children.
  if (state.drawing.parentElement !== element) element.prepend(state.drawing);
  element.style.isolation = 'isolate'; state.node = node; state.options = options;
  Object.assign(state.drawing.style, { left: -border.left + 'px', top: -border.top + 'px', width: width + 'px', height: height + 'px' }); state.drawing.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const innerShadows = (style.shadows || []).filter(s => s.inset).map(s => `inset ${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${styleColor(s.color, s.opacity)}`).join(',');
  if (innerShadows) {
    if (!state.inset) { state.inset = doc.createElement('div'); state.inset.classList.add('yuanda-style-inset'); state.inset.setAttribute('aria-hidden', 'true'); }
    if (state.inset.parentElement !== element) element.append(state.inset);
    Object.assign(state.inset.style, { position: 'absolute', pointerEvents: 'none', zIndex: '1', boxSizing: 'border-box', left: -border.left + 'px', top: -border.top + 'px', width: width + 'px', height: height + 'px', borderRadius: 'inherit', border: 'solid transparent', borderWidth: `${border.top}px ${border.right}px ${border.bottom}px ${border.left}px`, boxShadow: innerShadows, transition: cssTransition });
  } else state.inset?.remove();
  const refresh = () => { if (element.__yuandaVisual === state) applyNodeVisual(element, state.node, state.options); };
  const svgTransition = animated ? ['fill','fill-opacity','stroke','stroke-opacity','stop-color','stop-opacity'].map(key => `${key} ${transition.duration || 0}ms ${transition.easing || 'ease'} ${transition.delay || 0}ms`).join(',') : 'none';
  state.fill.style.transition = svgTransition; state.ring.style.transition = svgTransition;
  const fill = applyStylePaint(state.defs, 'fill', style.fillPaint, style.fill, width, height, state.uid, refresh), stroke = applyStylePaint(state.defs, 'stroke', style.strokePaint, style.stroke, width, height, state.uid, refresh);
  const outer = node.type === 'ellipse' ? `M 0 ${height / 2} A ${width / 2} ${height / 2} 0 1 0 ${width} ${height / 2} A ${width / 2} ${height / 2} 0 1 0 0 ${height / 2} Z` : styleRoundedPath(0, 0, width, height, radii);
  for (const paint of state.defs.__yuandaPaints?.values() || []) for (const stop of paint.stops) stop.style.transition = svgTransition;
  state.fill.setAttribute('d', outer); state.fill.setAttribute('fill', fill); state.fill.setAttribute('fill-opacity', String(style.fillOpacity ?? 1));
  const innerRadii = { topLeft: { x: Math.max(0, radii.topLeft - border.left), y: Math.max(0, radii.topLeft - border.top) }, topRight: { x: Math.max(0, radii.topRight - border.right), y: Math.max(0, radii.topRight - border.top) }, bottomRight: { x: Math.max(0, radii.bottomRight - border.right), y: Math.max(0, radii.bottomRight - border.bottom) }, bottomLeft: { x: Math.max(0, radii.bottomLeft - border.left), y: Math.max(0, radii.bottomLeft - border.bottom) } };
  const iw = metrics.inner.width, ih = metrics.inner.height, inner = iw && ih ? node.type === 'ellipse' ? `M ${border.left} ${border.top + ih / 2} A ${iw / 2} ${ih / 2} 0 1 0 ${width - border.right} ${border.top + ih / 2} A ${iw / 2} ${ih / 2} 0 1 0 ${border.left} ${border.top + ih / 2} Z` : styleRoundedPath(border.left, border.top, iw, ih, innerRadii) : '';
  state.ring.setAttribute('d', outer + ' ' + inner); state.ring.setAttribute('fill-rule', 'evenodd'); state.ring.setAttribute('fill', stroke); state.ring.setAttribute('fill-opacity', String(style.strokeOpacity ?? 1));
  if (style.strokeStyle && style.strokeStyle !== 'solid') {
    if (!state.dashMask) { state.dashMask = make('mask', { id: state.uid + '-dash', maskUnits: 'userSpaceOnUse' }); state.defs.append(state.dashMask); }
    state.dashMask.replaceChildren();
    const half = { top: border.top / 2, right: border.right / 2, bottom: border.bottom / 2, left: border.left / 2 }, cw = width - half.left - half.right, ch = height - half.top - half.bottom;
    const middleCorners = { topLeft: { x: Math.max(0,radii.topLeft-half.left), y: Math.max(0,radii.topLeft-half.top) }, topRight: { x: Math.max(0,radii.topRight-half.right), y: Math.max(0,radii.topRight-half.top) }, bottomRight: { x: Math.max(0,radii.bottomRight-half.right), y: Math.max(0,radii.bottomRight-half.bottom) }, bottomLeft: { x: Math.max(0,radii.bottomLeft-half.left), y: Math.max(0,radii.bottomLeft-half.bottom) } };
    const middle = node.type === 'ellipse' ? `M ${half.left} ${half.top+ch/2} A ${cw/2} ${ch/2} 0 1 0 ${width-half.right} ${half.top+ch/2} A ${cw/2} ${ch/2} 0 1 0 ${half.left} ${half.top+ch/2} Z` : styleRoundedPath(half.left,half.top,cw,ch,middleCorners);
    const regions = [ [border.top,`0,0 ${width},0 ${width/2},${height/2}`], [border.right,`${width},0 ${width},${height} ${width/2},${height/2}`], [border.bottom,`${width},${height} 0,${height} ${width/2},${height/2}`], [border.left,`0,${height} 0,0 ${width/2},${height/2}`] ];
    regions.forEach(([size, points], index) => { if (!size) return; const id = state.uid + '-side-' + index, clip = make('clipPath',{id}); clip.append(make('polygon',{points})); state.dashMask.append(clip,make('path',{d:middle,fill:'none',stroke:'white','stroke-width':size,'clip-path':`url(#${id})`,'stroke-linecap':style.strokeStyle==='dotted'?'round':'butt','stroke-dasharray':style.strokeStyle==='dotted'?`0 ${size*2}`:`${size*3} ${size*2}`})); });
    state.ring.setAttribute('mask', `url(#${state.uid}-dash)`);
  } else state.ring.removeAttribute('mask');
  return metrics;
}
