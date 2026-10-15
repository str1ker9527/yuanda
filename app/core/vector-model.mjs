/** Original vector, connector and structured-text model. No vendor code or assets. */
import { rotateNodePoint } from './widget-geometry.mjs';
export const VECTOR_TYPES = ['path', 'connector'];
export const VECTOR_NODE_KEYS = ['path', 'connector', 'richText'];
const own = (value, key) => Object.hasOwn(value, key);
const copy = value => structuredClone(value);
const sides = ['top', 'right', 'bottom', 'left', 'center'];
const alignments = ['left', 'center', 'right'];
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function fail(message) { const error = new Error(message); error.code = 'VALIDATION_ERROR'; throw error; }
function fields(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} 必须为普通对象`);
  if (Reflect.ownKeys(value).some(key => !keys.includes(key)) || keys.some(key => !own(value, key))) fail(`${label} 的字段不完整或含未知字段`);
}
const color = value => typeof value === 'string' && /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|transparent|white|black)$/i.test(value);
const containers = project => [...(project.pages || []), ...(project.components || [])];

export function nodeVectorDefaults(type) {
  const point = (x, y) => ({ x, y, inX: null, inY: null, outX: null, outY: null });
  return { path: type === 'path' ? { closed: false, points: [point(0, 1), point(.5, 0), point(1, 1)] } : null, connector: null, richText: null };
}
/** Only missing fields are migrated; explicitly invalid values remain visible to validation. */
export function normalizeVectorProject(input) {
  const project = copy(input);
  for (const container of containers(project)) if (Array.isArray(container.nodes)) for (const node of container.nodes) {
    if (!node || typeof node !== 'object') continue;
    for (const [key, value] of Object.entries(nodeVectorDefaults(node.type))) if (!own(node, key)) node[key] = value;
    if (Array.isArray(node.richText?.paragraphs)) for (const paragraph of node.richText.paragraphs) if (Array.isArray(paragraph?.runs)) for (const run of paragraph.runs) {
      if (!run || typeof run !== 'object' || Array.isArray(run)) continue;
      if (!own(run, 'strike')) run.strike = false;
      if (!own(run, 'baseline')) run.baseline = 'normal';
    }
  }
  return project;
}
export function richTextPlainText(richText) { return richText.paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n'); }
export function makeRichText(text, style = {}) {
  return { fontFamily: style.fontFamily || 'Microsoft YaHei', lineHeight: style.lineHeight == null ? 1.5 : Math.max(.5, Math.min(5, style.lineHeight / (style.fontSize || 14))), paragraphs: String(text).split('\n').map(text => ({ align: style.align || 'left', list: 'none', runs: [{ text, bold: Number(style.fontWeight) >= 600, italic: !!style.italic, underline: !!style.underline, strike: !!style.strike, baseline: 'normal', color: null }] })) };
}
/** Safe typed CSS shared by editable, exported, and thumbnail rich text. */
export function richRunStyle(run) {
  return { fontWeight: run.bold ? '700' : '400', fontStyle: run.italic ? 'italic' : 'normal', textDecoration: [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none', verticalAlign: run.baseline === 'super' ? 'super' : run.baseline === 'sub' ? 'sub' : 'baseline', fontSize: run.baseline && run.baseline !== 'normal' ? '.75em' : '1em', color: run.color || 'inherit' };
}
export function validateVectorProject(project) {
  for (const container of containers(project)) {
    const nodeMap = new Map(container.nodes.map(node => [node.id, node]));
    for (const node of container.nodes) {
      if (!VECTOR_NODE_KEYS.every(key => own(node, key))) fail('元件缺少矢量扩展字段');
      if (node.path !== null) {
        if (node.type !== 'path') fail('只有路径元件可包含路径');
        fields(node.path, ['closed', 'points'], '路径');
        if (typeof node.path.closed !== 'boolean' || !Array.isArray(node.path.points) || node.path.points.length < (node.path.closed ? 3 : 2) || node.path.points.length > 2000) fail('路径需要 2–2000 个点（闭合路径至少 3 个）');
        for (const point of node.path.points) {
          fields(point, ['x', 'y', 'inX', 'inY', 'outX', 'outY'], '路径点');
          if (!finite(point.x, 0, 1) || !finite(point.y, 0, 1)) fail('路径点坐标必须在 0 到 1 之间');
          for (const [x, y] of [['inX', 'inY'], ['outX', 'outY']]) {
            if ((point[x] === null) !== (point[y] === null)) fail('曲线控制点的横纵坐标必须同时存在');
            if (point[x] !== null && (!finite(point[x], -10, 10) || !finite(point[y], -10, 10))) fail('曲线控制点超出范围');
          }
        }
      } else if (node.type === 'path') fail('路径元件必须包含路径');
      if (node.connector !== null) {
        if (node.type !== 'connector') fail('只有连接线可包含端点引用');
        fields(node.connector, ['from', 'to', 'route', 'arrow'], '连接线');
        if (!['straight', 'elbow'].includes(node.connector.route) || !['none', 'end', 'both'].includes(node.connector.arrow)) fail('连接线样式不受支持');
        for (const endpoint of [node.connector.from, node.connector.to]) {
          fields(endpoint, ['nodeId', 'side'], '连接线端点');
          const target = nodeMap.get(endpoint.nodeId);
          if (!target || target.type === 'connector' || !sides.includes(endpoint.side)) fail('连接线必须引用同一页面/组件中的普通元件和有效锚点');
        }
        if (node.connector.from.nodeId === node.connector.to.nodeId) fail('连接线的两个目标必须不同');
      } else if (node.type === 'connector') fail('连接线必须指定两个端点');
      if (node.richText !== null) {
        if (!['text', 'rectangle', 'button', 'ellipse'].includes(node.type)) fail('这个元件类型不支持富文本');
        const rich = node.richText; fields(rich, ['fontFamily', 'lineHeight', 'paragraphs'], '富文本');
        if (typeof rich.fontFamily !== 'string' || !rich.fontFamily.trim() || rich.fontFamily.length > 100 || /[<>;{}\r\n]/.test(rich.fontFamily)) fail('字体名称无效');
        if (!finite(rich.lineHeight, .5, 5) || !Array.isArray(rich.paragraphs) || !rich.paragraphs.length || rich.paragraphs.length > 1000) fail('富文本行高或段落数量无效');
        let total = 0, runs = 0;
        for (const paragraph of rich.paragraphs) {
          fields(paragraph, ['align', 'list', 'runs'], '富文本段落');
          if (!alignments.includes(paragraph.align) || !['none', 'bullet', 'number'].includes(paragraph.list) || !Array.isArray(paragraph.runs) || !paragraph.runs.length || paragraph.runs.length > 2000) fail('富文本段落设置无效');
          for (const run of paragraph.runs) {
            fields(run, ['text', 'bold', 'italic', 'underline', 'strike', 'baseline', 'color'], '富文本片段');
            if (typeof run.text !== 'string' || typeof run.bold !== 'boolean' || typeof run.italic !== 'boolean' || typeof run.underline !== 'boolean' || typeof run.strike !== 'boolean' || !['normal', 'super', 'sub'].includes(run.baseline) || (run.color !== null && !color(run.color))) fail('富文本片段设置无效');
            total += run.text.length; runs++;
          }
        }
        if (total > 50000 || runs > 5000) fail('富文本内容过大');
        if (node.text !== richTextPlainText(rich)) fail('富文本与元件纯文字不一致，请同时更新或清除 richText');
      }
    }
  }
  return true;
}

/** Side anchors follow target rotation, in document coordinates. */
export function connectorAnchor(node, side) {
  const offsets = { top: [0, -node.height / 2], right: [node.width / 2, 0], bottom: [0, node.height / 2], left: [-node.width / 2, 0], center: [0, 0] };
  const [x, y] = offsets[side] || offsets.center;
  return rotateNodePoint(node, node.x + node.width / 2 + x, node.y + node.height / 2 + y);
}
export function connectorPoints(node, nodes) {
  const data = node.connector;
  if (!data) return [];
  const from = nodes.find(item => item.id === data.from.nodeId), to = nodes.find(item => item.id === data.to.nodeId);
  if (!from || !to) return [];
  const a = connectorAnchor(from, data.from.side), b = connectorAnchor(to, data.to.side);
  if (data.route === 'straight') return [a, b];
  if (['top', 'bottom'].includes(data.from.side)) { const middle = (a.y + b.y) / 2; return [a, { x: a.x, y: middle }, { x: b.x, y: middle }, b]; }
  const middle = (a.x + b.x) / 2; return [a, { x: middle, y: a.y }, { x: middle, y: b.y }, b];
}
/** Run after ordinary node edits. Never removes invalid references silently. */
export function reconcileVectorProject(project) {
  for (const container of containers(project)) for (const node of container.nodes) if (node.type === 'connector' && node.connector) {
    const points = connectorPoints(node, container.nodes); if (!points.length) continue;
    node.x = Math.min(...points.map(point => point.x)); node.y = Math.min(...points.map(point => point.y));
    node.width = Math.max(1, Math.max(...points.map(point => point.x)) - node.x); node.height = Math.max(1, Math.max(...points.map(point => point.y)) - node.y); node.rotation = 0;
  }
  return project;
}
const fmt = value => String(Math.round(value * 10000) / 10000);
export function pathData(path, width, height) {
  const points = path?.points; if (!points?.length) return '';
  let d = `M ${fmt(points[0].x * width)} ${fmt(points[0].y * height)}`;
  const count = path.closed ? points.length + 1 : points.length;
  for (let index = 1; index < count; index++) {
    const a = points[index - 1], b = points[index % points.length];
    if (a.outX !== null || b.inX !== null) d += ` C ${fmt((a.outX ?? a.x) * width)} ${fmt((a.outY ?? a.y) * height)} ${fmt((b.inX ?? b.x) * width)} ${fmt((b.inY ?? b.y) * height)} ${fmt(b.x * width)} ${fmt(b.y * height)}`;
    else d += ` L ${fmt(b.x * width)} ${fmt(b.y * height)}`;
  }
  return d + (path.closed ? ' Z' : '');
}
export function getVectorGeometry(node, nodes = []) {
  if (node.type === 'path' && node.path) return { width: node.width, height: node.height, d: pathData(node.path, node.width, node.height), closed: node.path.closed, arrow: 'none' };
  if (node.type !== 'connector' || !node.connector) return null;
  const points = connectorPoints(node, nodes);
  const d = points.map((point, index) => `${index ? 'L' : 'M'} ${fmt(point.x - node.x)} ${fmt(point.y - node.y)}`).join(' ');
  return { width: node.width, height: node.height, d, closed: false, arrow: node.connector.arrow };
}
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
/** HTML export only: no HTML supplied by the document is ever interpreted. */
export function renderVectorHtml(node, nodes = []) {
  const geometry = getVectorGeometry(node, nodes); if (!geometry) return '';
  const id = `arrow-${String(node.id).replace(/[^\w-]/g, '_')}`, stroke = escape(node.style.stroke), thickness = fmt(node.style.strokeWidth);
  const marker = geometry.arrow === 'none' ? '' : `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${stroke}"/></marker></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${fmt(geometry.width)} ${fmt(geometry.height)}" style="overflow:visible;display:block">${marker}<path d="${escape(geometry.d)}" fill="${geometry.closed ? escape(node.style.fill) : 'none'}" stroke="${stroke}" stroke-width="${thickness}" stroke-linejoin="round"${geometry.arrow !== 'none' ? ` marker-end="url(#${id})"` : ''}${geometry.arrow === 'both' ? ` marker-start="url(#${id})"` : ''}/></svg>`;
}
export function renderRichTextHtml(node) {
  if (!node.richText) return '';
  const rich = node.richText; let number = 0;
  return `<div style="font-family:${escape(rich.fontFamily)};line-height:${fmt(rich.lineHeight)};white-space:pre-wrap;width:100%">${rich.paragraphs.map(paragraph => {
    const prefix = paragraph.list === 'bullet' ? '• ' : paragraph.list === 'number' ? `${++number}. ` : (number = 0, '');
    return `<div style="text-align:${paragraph.align};min-height:1em">${escape(prefix)}${paragraph.runs.map(run => { const style = richRunStyle(run); return `<span style="font-weight:${style.fontWeight};font-style:${style.fontStyle};text-decoration:${style.textDecoration};vertical-align:${style.verticalAlign};font-size:${style.fontSize};color:${escape(style.color)}">${escape(run.text)}</span>`; }).join('')}</div>`;
  }).join('')}</div>`;
}

/** Reused by clipboard/import code; external endpoints retain their IDs. */
export function remapVectorReferences(node, ids) {
  if (node.connector) for (const endpoint of [node.connector.from, node.connector.to]) endpoint.nodeId = ids.get(endpoint.nodeId) || endpoint.nodeId;
  return node;
}
/** Explicit removal path: a removed endpoint also removes its now-dangling lines. */
export function expandVectorRemoval(nodes, ids) {
  const removal = new Set(ids);
  for (const node of nodes) if (node.connector && (removal.has(node.connector.from.nodeId) || removal.has(node.connector.to.nodeId))) removal.add(node.id);
  return [...removal];
}
