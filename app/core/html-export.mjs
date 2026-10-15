import { validateProject } from './document.mjs';
import { evaluateExpression, chooseInteractionCases, getEventSettings, selectRepeaterRows, selectRepeaterPage, resolveAdaptivePage, getNodeDescendants } from './interaction-model.mjs';
import { getVectorGeometry, connectorPoints, connectorAnchor, pathData, richRunStyle } from './vector-model.mjs';
import { htmlRuntime } from './html-runtime.mjs';
import { resolveViewChain, getCanvasViews, getCanvasViewOverrides, selectAdaptiveView, resolveCanvasView } from './view-model.mjs';
import { resolveComponentCanvas } from './component-view-model.mjs';
import { computeImageLayout, loadImageSource, computeImageTextLayout, paintImageContent } from './image-renderer.mjs';
import { inspectImageBytes, inspectImageDataUrl } from './image-format.mjs';
import { getNodeOrigin, rotateNodePoint, getNodeBounds } from './widget-geometry.mjs';
import { styleColor, resolveNodeVisual, styleGradientGeometry, styleRoundedPath, loadStyleImage, applyStylePaint, applyStyleShadows, applyVectorVisual, applyNodeVisual } from './style-renderer.mjs';
import { newStyleDefaults, getBuiltinStyle, resolveNamedStylePatch, resolveNodeBaseStyle, resolveNodeStateStyles, resolveNodeBaseAppearance } from './style-model.mjs';

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** 独立的离线 HTML，数据与经审核的运行器分开序列化，不包含任何外部资源。 */
export function exportHtml(project) {
  validateProject(project);
  const functions = [evaluateExpression, chooseInteractionCases, getEventSettings, selectRepeaterRows, selectRepeaterPage, newStyleDefaults, getBuiltinStyle, resolveNamedStylePatch, resolveNodeBaseStyle, resolveNodeStateStyles, resolveNodeBaseAppearance, resolveComponentCanvas, resolveViewChain, getCanvasViewOverrides, getCanvasViews, selectAdaptiveView, resolveCanvasView, resolveAdaptivePage, getNodeDescendants, getNodeOrigin, rotateNodePoint, getNodeBounds, connectorAnchor, connectorPoints, pathData, getVectorGeometry, richRunStyle, inspectImageBytes, inspectImageDataUrl, styleColor, resolveNodeVisual, styleGradientGeometry, styleRoundedPath, loadStyleImage, applyStylePaint, applyStyleShadows, applyVectorVisual, applyNodeVisual, computeImageLayout, loadImageSource, computeImageTextLayout, paintImageContent];
  const runtime = `const fmt=value=>String(Math.round(value*10000)/10000);\n${functions.map(fn => fn.toString()).join('\n')}\n(${htmlRuntime.toString()})(evaluateExpression,chooseInteractionCases,selectRepeaterRows,resolveAdaptivePage,getNodeDescendants,getVectorGeometry,connectorPoints,selectRepeaterPage,getCanvasViews,selectAdaptiveView,paintImageContent,applyNodeVisual,applyVectorVisual,resolveNodeVisual,getNodeBounds,rotateNodePoint,richRunStyle,getEventSettings);`;
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(project.name)} · 原搭交互演示</title>
<style>
.pinned-layer{position:fixed;inset:0;pointer-events:none;z-index:9000}.pinned-layer>.node{pointer-events:auto}.node-dynamicPanel{display:block}.node-dynamicPanel>.panel-state{touch-action:auto}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif;background:#f6f6f6;color:#191919}button,input,select,textarea{font:inherit}.viewer-bar{height:54px;display:flex;align-items:center;gap:16px;padding:0 22px;background:#fff;border-bottom:1px solid #e6e6e6;position:sticky;top:0;z-index:10000}.brand{font-weight:600;color:#191919}.project-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:30vw}.viewer-bar select,.viewer-bar button{border:1px solid #ddd;border-radius:4px;background:white;padding:6px 10px;color:#333;cursor:pointer;font-size:12px}.viewer-bar #pages{margin-left:auto;max-width:220px}.viewer-shell{padding:26px;overflow:auto;min-height:calc(100vh - 54px)}#stage{position:relative;margin:0 auto;border:1px solid #e6e6e6;overflow:hidden}.node{position:absolute;box-sizing:border-box;margin:0;padding:0;display:flex;align-items:center;white-space:pre-wrap;overflow:hidden;line-height:1.45;border-style:solid;outline-offset:3px;flex-shrink:0}.node[hidden],.panel-state[hidden],[hidden]{display:none!important}.node-input,.node-textarea,.node-select{display:block;padding:0 10px}.node-textarea{padding:9px 10px;resize:none}.node-select{appearance:auto}.node-button{padding:0 10px}.node-image{object-fit:cover}.node-table table{width:100%;height:100%;border-collapse:collapse}.node-table th,.node-table td{border:1px solid currentColor;padding:5px 8px;text-align:inherit;font-weight:inherit}.node-table th{font-weight:600;background:#00000005}.check-label{display:flex;align-items:center;gap:7px;width:100%;height:100%;cursor:inherit}.check-label input{margin:0 0 0 5px;accent-color:currentColor;flex-shrink:0}.check-label span{white-space:pre-wrap}.interactive{cursor:pointer}.interactive:focus-visible,.node:focus-visible{outline:2px solid #777}.node[aria-disabled=true]{cursor:default}.panel-state,.repeater-content{position:absolute;left:0;top:0;width:100%;height:100%}.repeater-item{position:absolute}.rich-content{width:100%;white-space:pre-wrap}.rich-paragraph{min-height:1em}.runtime-status{position:fixed;left:20px;right:20px;bottom:16px;z-index:20000;padding:12px 16px;background:#fff;border:1px solid #bbb;color:#333;font-size:13px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:700px){.viewer-bar{padding:0 10px;gap:8px}.project-name{display:none}.viewer-shell{padding:12px}.viewer-bar select{max-width:135px}}
</style></head>
<body><header class="viewer-bar"><span class="brand">原搭</span><span class="project-name">${escapeHtml(project.name)}</span><label class="sr-only" for="pages">选择页面</label><select id="pages"></select><label class="sr-only" for="views">选择自适应视图</label><select id="views" hidden></select><button id="restart" type="button">重新体验</button><span id="current-page" class="sr-only" aria-live="polite"></span></header>
<main class="viewer-shell"><div id="stage" aria-label="原型画布"></div></main><div id="runtime-status" class="runtime-status" role="status" hidden></div>
<script id="yuanda-model" type="application/json">${safeJson(project)}</script>
<script>${runtime}</script>
</body></html>`;
}
