/** Self-contained DOM decoder, executed only inside a disposable sandboxed window. */
export async function decodeImagePayload(payload) {
  const reject = message => { throw new Error(message); };
  const checkSize = (width, height) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > payload.limits.edge || height > payload.limits.edge || width * height > payload.limits.pixels) reject('图片尺寸超过限制（单边 8192、总像素 16 Mi）');
  };
  let src = payload.src, svgSize;
  if (payload.format === 'svg') {
    const text = payload.text;
    if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) reject('SVG 不支持文档类型、实体定义或外部样式');
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
    if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') reject('SVG 不是有效的静态图像');
    const tags = new Set(['svg','g','defs','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','title','desc','clipPath','mask','linearGradient','radialGradient','stop','use','symbol']);
    const css = new Set(['fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','opacity','color','font-family','font-size','font-style','font-weight','text-anchor','dominant-baseline','display','visibility','clip-path','clip-rule','mask','stop-color','stop-opacity','vector-effect','paint-order']);
    const elements = [...root.querySelectorAll('*'), root], byId = new Map(), references = new Map();
    if (elements.length > 5000) reject('SVG 元素超过 5000 个');
    const localReferences = value => {
      if (/[\\@]|(?:https?|file|javascript|data):/i.test(value)) reject('SVG 不能引用外部资源或嵌入代码');
      const refs = [];
      const rest = value.replace(/url\(\s*['"]?#([A-Za-z0-9_:-]+)['"]?\s*\)/gi, (_, id) => { refs.push(id); return ''; });
      if (/url\s*\(/i.test(rest)) reject('SVG 仅支持本图中的 # 引用');
      return refs;
    };
    for (const el of elements) {
      if (el.namespaceURI !== root.namespaceURI || !tags.has(el.localName)) reject(`SVG 不支持元素 ${el.localName}，请导出为 PNG 后使用`);
      let depth = 0; for (let parent = el; parent; parent = parent.parentElement) if (++depth > 64) reject('SVG 嵌套超过 64 层');
      if (el.id) { if (byId.has(el.id)) reject('SVG 元素 ID 重复'); byId.set(el.id, el); }
      const refs = [];
      for (const attr of el.attributes) {
        if (/^on/i.test(attr.localName) || ['filter','src','base'].includes(attr.localName)) reject('SVG 含不支持的脚本、滤镜或资源属性');
        if (attr.localName === 'href') {
          if (!/^#[A-Za-z0-9_:-]+$/.test(attr.value)) reject('SVG 引用必须指向本图中的 # 元素');
          refs.push(attr.value.slice(1));
        } else if (attr.localName === 'style') {
          for (const declaration of attr.value.split(';').filter(value => value.trim())) {
            const separator = declaration.indexOf(':'), key = declaration.slice(0, separator).trim().toLowerCase();
            if (separator < 0 || !css.has(key)) reject('SVG 内联样式含不支持的属性');
            refs.push(...localReferences(declaration.slice(separator + 1)));
          }
        } else if (!['xmlns','space'].includes(attr.localName) && attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/') refs.push(...localReferences(attr.value));
      }
      references.set(el, refs);
    }
    // Also follow descendants: <use href="#group"> can otherwise reference an ancestor.
    const done = new Set(), active = new Set();
    function visit(el, depth = 0) {
      if (active.has(el) || depth > 64) reject('SVG 内部引用循环或过深');
      if (done.has(el)) return;
      active.add(el);
      for (const child of el.children) visit(child, depth + 1);
      for (const id of references.get(el) || []) { const target = byId.get(id); if (!target) reject('SVG 内部引用不存在'); visit(target, depth + 1); }
      active.delete(el); done.add(el);
    }
    visit(root);
    const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
    const length = name => { const value = root.getAttribute(name); if (value === null || value === '100%') return null; if (!/^\s*\d+(?:\.\d+)?(?:px)?\s*$/.test(value)) reject('SVG 尺寸请使用像素或 viewBox'); return parseFloat(value); };
    let width = length('width'), height = length('height');
    if (width === null && height === null && hasBox) { width = box[2]; height = box[3]; }
    else if (width === null && hasBox) width = height * box[2] / box[3];
    else if (height === null && hasBox) height = width * box[3] / box[2];
    width = Math.ceil(width ?? 0); height = Math.ceil(height ?? 0); checkSize(width, height); svgSize = { width, height };
    root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
    src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
  }
  const image = new Image(); image.src = src;
  try { await image.decode(); } catch { reject('图片损坏或当前浏览器无法解码'); }
  const width = svgSize?.width ?? image.naturalWidth, height = svgSize?.height ?? image.naturalHeight; checkSize(width, height);
  const result = { naturalWidth: width, naturalHeight: height };
  if (payload.format === 'svg' || payload.format === 'bmp') {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) reject('无法创建图片转换画布');
    context.drawImage(image, 0, 0, width, height); result.src = canvas.toDataURL('image/png'); canvas.width = canvas.height = 0;
  }
  image.src = ''; return result;
}
