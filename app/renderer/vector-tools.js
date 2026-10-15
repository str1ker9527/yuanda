import { getVectorGeometry, pathData, makeRichText, richTextPlainText, richRunStyle, remapVectorReferences } from '../core/vector-model.mjs';
import { rotateNodePoint } from '../core/widget-geometry.mjs';
import { applyVectorVisual } from '../core/style-renderer.mjs';

/** Original drawing tools. Model edits use the same command queue as the Agent. */
const E = window.YuandaEditor;
const $ = selector => document.querySelector(selector);
const T = () => window.YuandaTools;
const svg = (tag, attributes = {}) => { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value)); return element; };
const html = (tag, cls, text) => { const element = document.createElement(tag); if (cls) element.className = cls; if (text !== undefined) element.textContent = text; return element; };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const point = (x, y) => ({ x, y, inX: null, inY: null, outX: null, outY: null });
let pen = null, editId = null, pointIndex = 0, pointDrag = null, pending = false, richDialog = null;

/** Safe DOM renderer; user strings only reach textContent or typed style properties. */
function renderNode(node, element, nodes = []) {
  const geometry = getVectorGeometry(node, nodes)||(node.type==='line'?{width:node.width,height:node.height,d:`M 0 ${node.style.strokeWidth/2} L ${node.width} ${node.style.strokeWidth/2}`,closed:false,arrow:'none'}:null);
  if (geometry) {
    element.replaceChildren(); element.style.background = 'transparent'; element.style.border = 'none'; element.style.padding = '0'; element.style.overflow = 'visible'; element.style.pointerEvents = 'none';
    const drawing = svg('svg', { width: '100%', height: '100%', viewBox: `0 0 ${geometry.width} ${geometry.height}`, 'aria-hidden': 'true' }); drawing.classList.add('vector-drawing');
    const stroke = node.style.stroke;
    if (geometry.arrow !== 'none') {
      const defs = svg('defs'), marker = svg('marker', { id: `editor-arrow-${node.id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
      marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 Z', fill: stroke })); defs.append(marker); drawing.append(defs);
    }
    const path = svg('path', { d: geometry.d, fill: geometry.closed ? node.style.fill : 'none', stroke, 'stroke-width': node.style.strokeWidth, 'stroke-linejoin': 'round' });
    if (geometry.arrow !== 'none') path.setAttribute('marker-end', `url(#editor-arrow-${node.id})`);
    if (geometry.arrow === 'both') path.setAttribute('marker-start', `url(#editor-arrow-${node.id})`);
    const hit = svg('path', { d: geometry.d, fill: geometry.closed ? 'transparent' : 'none', stroke: 'transparent', 'stroke-width': Math.max(12, node.style.strokeWidth) }); hit.style.pointerEvents = geometry.closed ? 'all' : 'stroke'; drawing.append(hit, path); element.append(drawing);applyVectorVisual(drawing,path,node,{geometry,uid:`editor-${node.id}`,markers:[...drawing.querySelectorAll('marker path')]});return true;
  }
  if (!node.richText) return false;
  element.replaceChildren(); const root = richDom(node.richText,false,node.style); root.className = 'vector-rich-display'; element.append(root); return true;
}
function richDom(rich, editable = false, style = {}) {
  const root = html('div'); root.style.fontFamily = style.fontFamily?JSON.stringify(style.fontFamily)+',"Segoe UI","Microsoft YaHei",sans-serif':rich.fontFamily; root.style.lineHeight = style.lineHeight==null?rich.lineHeight:`${style.lineHeight}px`; let count = 0;
  for (const paragraph of rich.paragraphs) {
    const block = html('div', 'vector-paragraph'); block.style.textAlign = paragraph.align; block.dataset.list = paragraph.list;
    if (paragraph.list === 'number') block.dataset.marker = `${++count}. `; else { count = 0; block.dataset.marker = paragraph.list === 'bullet' ? '• ' : ''; }
    for (const run of paragraph.runs) {
      const span = html('span', '', run.text); Object.assign(span.style, richRunStyle(run)); block.append(span);
    }
    if (!paragraph.runs.some(run => run.text)) block.append(document.createElement('br'));
    root.append(block);
  }
  if (editable) { root.contentEditable = 'true'; root.spellcheck = false; root.setAttribute('role', 'textbox'); root.setAttribute('aria-multiline', 'true'); root.setAttribute('aria-label', '富文本内容'); }
  return root;
}
function patchNode(node, patch, label) { return E.command([{ type: 'updateNode', pageId: E.getPage().id, nodeId: node.id, patch }], label); }
function selectedNode() { return E.getNodes().length === 1 ? E.getNodes()[0] : null; }
function currentEdit() { return E.getPage()?.nodes.find(node => node.id === editId); }
function unlocked(node) { if (node.locked || E.getPage()?.groups?.some(group => group.locked && group.nodeIds.includes(node.id))) { E.toast('请先解锁元件或元件组', 'warning'); return false; } return true; }
function toolMode() { return pen ? 'pen' : editId ? 'points' : null; }

function startPen() {
  if (!E.getPage()) return; editId = null; pen = { pageId: E.getPage().id, points: [], cursor: null }; E.select([]); $('#board').classList.add('vector-pen-mode'); drawOverlay(); E.toast('点击放点，按住拖动拉出曲线。Enter 完成，点击首点闭合，Esc 取消。');
}
function stopTools() { pen = null; editId = null; pointDrag = null; $('#board')?.classList.remove('vector-pen-mode'); $('#vector-overlay')?.remove(); $('#vector-tool-hint')?.remove(); schedule(); }
async function finishPen(closed = false) {
  if (!pen) return; const source = pen.points;
  if (source.length < (closed ? 3 : 2)) { E.toast('先画出至少两个点；闭合需要三个点', 'warning'); return; }
  const extent = source.flatMap(p => [{x:p.x,y:p.y},...(p.inX === null ? []:[{x:p.inX,y:p.inY}]),...(p.outX === null ? []:[{x:p.outX,y:p.outY}])]);
  const minX = Math.min(...extent.map(p => p.x)), minY = Math.min(...extent.map(p => p.y));
  const width = Math.max(1, Math.max(...extent.map(p => p.x)) - minX), height = Math.max(1, Math.max(...extent.map(p => p.y)) - minY);
  const points = source.map(p => ({ x: (p.x-minX)/width, y:(p.y-minY)/height, inX:p.inX === null ? null:(p.inX-minX)/width, inY:p.inY === null ? null:(p.inY-minY)/height, outX:p.outX === null ? null:(p.outX-minX)/width, outY:p.outY === null ? null:(p.outY-minY)/height }));
  stopTools(); await E.insert('path', { name: closed ? '闭合路径' : '钢笔路径', x:minX, y:minY, width, height, path:{closed,points}, style:{fill:closed?'#e7efff':'transparent',stroke:'#191919',strokeWidth:2,radius:0} });
}
function startPointEdit() { const node = selectedNode(); if (!node || node.type !== 'path' || !unlocked(node)) return; pen = null; editId = node.id; pointIndex = 0; drawOverlay(); schedule(); E.toast('拖动方点修改路径，拖圆点调整曲线。Delete 删除当前点，Esc 退出。'); }
function documentToLocal(node, value) {
  const plain=rotateNodePoint({...node,rotation:-(node.rotation||0)},value.x,value.y);
  return {x:(plain.x-node.x)/node.width,y:(plain.y-node.y)/node.height};
}
function drawOverlay() {
  $('#vector-overlay')?.remove(); $('#vector-tool-hint')?.remove(); const board=$('#board'); if (!board || (!pen&&!editId)) return;
  const overlay=svg('svg',{width:E.getPage().width,height:E.getPage().height}); overlay.id='vector-overlay'; const z=E.getZoom(), size=7/z;
  if (pen) {
    const points=pen.points; if(points.length) {
      const draft={closed:false,points:points.map(p=>({...p}))}; let d=pathData(draft,1,1); if(pen.cursor&&!pointDrag)d+=` L ${pen.cursor.x} ${pen.cursor.y}`;
      overlay.append(svg('path',{d,fill:'none',stroke:'#2962ff','stroke-width':1.5/z}));
      for(const p of points) { if(p.outX!==null) { overlay.append(svg('line',{x1:p.inX,y1:p.inY,x2:p.outX,y2:p.outY,stroke:'#7797ec','stroke-width':1/z})); overlay.append(svg('circle',{cx:p.outX,cy:p.outY,r:3/z,fill:'#fff',stroke:'#2962ff'})); } overlay.append(svg('rect',{x:p.x-size/2,y:p.y-size/2,width:size,height:size,fill:'#fff',stroke:'#2962ff','stroke-width':1/z})); }
    }
  } else {
    const node=currentEdit(); if(!node||node.type!=='path') { stopTools(); return; }
    const path=pointDrag?.draft||node.path,origin=node.style.transformOrigin||{x:.5,y:.5},group=svg('g',{transform:`translate(${node.x} ${node.y}) rotate(${node.rotation||0} ${node.width*origin.x} ${node.height*origin.y})`});
    group.append(svg('path',{d:pathData(path,node.width,node.height),fill:'none',stroke:'#2962ff','stroke-width':1/z}));
    path.points.forEach((p,index)=>{
      for(const which of ['in','out']) if(p[`${which}X`]!==null) {
        group.append(svg('line',{x1:p.x*node.width,y1:p.y*node.height,x2:p[`${which}X`]*node.width,y2:p[`${which}Y`]*node.height,stroke:'#8ca5e5','stroke-width':1/z}));
        const control=svg('circle',{cx:p[`${which}X`]*node.width,cy:p[`${which}Y`]*node.height,r:4/z,fill:'#fff',stroke:'#2962ff','stroke-width':1/z}); control.classList.add('vector-control-point'); control.addEventListener('pointerdown',event=>startPointDrag(event,index,which));group.append(control);
      }
      const handle=svg('rect',{x:p.x*node.width-size/2,y:p.y*node.height-size/2,width:size,height:size,fill:index===pointIndex?'#2962ff':'#fff',stroke:'#2962ff','stroke-width':1/z}); handle.classList.add('vector-control-point');handle.addEventListener('pointerdown',event=>startPointDrag(event,index,'point'));group.append(handle);
    }); overlay.append(group);
  }
  board.append(overlay);
  const hint=html('div','vector-tool-hint');hint.id='vector-tool-hint';hint.append(html('span','',pen?'钢笔 · Enter 完成 · 点击首点闭合':'编辑矢量点 · Delete 删点 · Esc 退出'));
  const finish=T().btn(pen?'完成':'退出',()=>pen?finishPen(false):stopTools());hint.append(finish);$('#canvas-viewport').append(hint);
}
function startPointDrag(event,index,which) {
  if(event.button!==0)return;const node=currentEdit();if(!node||!unlocked(node))return;event.preventDefault();event.stopImmediatePropagation();pointIndex=index;pointDrag={kind:'point',index,which,nodeId:node.id,context:E.captureContext(),source:structuredClone(node),signature:pointSignature(node),draft:structuredClone(node.path)};drawOverlay();
}
function pointSignature(node){return JSON.stringify([node.path,node.x,node.y,node.width,node.height,node.rotation,node.style.transformOrigin]);}
async function commitPointDrag(drag){
  const context=E.getEditingContext(),latest=E.getPage(drag.context)?.nodes.find(node=>node.id===drag.nodeId);
  if(context.projectId!==drag.context.projectId||context.targetId!==drag.context.targetId||context.viewId!==drag.context.viewId||!latest||pointSignature(latest)!==drag.signature){E.toast('路径或编辑位置已变化，本次拖动未覆盖最新内容。','warning');return;}
  await E.command([{type:'updateNode',pageId:drag.context.targetId,nodeId:drag.nodeId,patch:{path:drag.draft}}],'移动矢量点',drag.context,{expectedRevision:E.getState().revision});
}
function deletePoint() { const node=currentEdit();if(!node)return;const path=structuredClone(node.path);if(path.points.length<=(path.closed?3:2)){E.toast('路径点不能少于最小数量','warning');return;}path.points.splice(pointIndex,1);pointIndex=Math.max(0,pointIndex-1);patchNode(node,{path},'删除路径点'); }
function curvePoint() {const node=currentEdit()||selectedNode();if(!node||node.type!=='path')return;const path=structuredClone(node.path),index=Math.min(pointIndex,path.points.length-1),p=path.points[index];if(p.inX!==null||p.outX!==null){p.inX=p.inY=p.outX=p.outY=null;}else{const previous=path.points[(index+path.points.length-1)%path.points.length],next=path.points[(index+1)%path.points.length],dx=(next.x-previous.x)/6,dy=(next.y-previous.y)/6;p.inX=p.x-dx;p.inY=p.y-dy;p.outX=p.x+dx;p.outY=p.y+dy;}patchNode(node,{path},'切换曲线控制点');}
function addPoint() {const node=currentEdit()||selectedNode();if(!node||node.type!=='path')return;const path=structuredClone(node.path),a=path.points[pointIndex],b=path.points[(pointIndex+1)%path.points.length];path.points.splice(pointIndex+1,0,point((a.x+b.x)/2,(a.y+b.y)/2));pointIndex++;patchNode(node,{path},'添加路径点');}
function flip(axis) {const node=selectedNode();if(!node?.path)return;const path=structuredClone(node.path);for(const p of path.points)for(const key of axis==='x'?['x','inX','outX']:['y','inY','outY'])if(p[key]!==null)p[key]=1-p[key];patchNode(node,{path},axis==='x'?'水平翻转路径':'垂直翻转路径');}

function connectSelection() {
  const nodes=E.getNodes().filter(node=>node.type!=='connector');if(nodes.length!==2){E.toast('按住 Shift 选中两个元件，再创建连接线','warning');return;}
  const [from,to]=nodes, horizontal=Math.abs(to.x-from.x)>=Math.abs(to.y-from.y),forward=horizontal?to.x>=from.x:to.y>=from.y;
  E.insert('connector',{name:`${from.name} → ${to.name}`,connector:{from:{nodeId:from.id,side:horizontal?(forward?'right':'left'):(forward?'bottom':'top')},to:{nodeId:to.id,side:horizontal?(forward?'left':'right'):(forward?'top':'bottom')},route:'elbow',arrow:'end'},style:{fill:'transparent',stroke:'#58677e',strokeWidth:2,radius:0}});
}
function connectorSettings(node,section) {
  const options=E.getPage().nodes.filter(n=>n.type!=='connector').map(n=>[n.id,n.name]), sideOptions=[['top','上侧'],['right','右侧'],['bottom','下侧'],['left','左侧'],['center','中心']];
  for(const [key,label] of [['from','起点'],['to','终点']]) section.append(T().field(`${label}元件`,node.connector[key].nodeId,value=>{const connector=structuredClone(node.connector);connector[key].nodeId=value;patchNode(node,{connector},'修改连接线目标');},{options}),T().field(`${label}位置`,node.connector[key].side,value=>{const connector=structuredClone(node.connector);connector[key].side=value;patchNode(node,{connector},'修改连接点');},{options:sideOptions}));
  section.append(T().field('路线',node.connector.route,route=>patchNode(node,{connector:{...node.connector,route}},'修改连接线路线'),{options:[['straight','直线'],['elbow','折线']]}),T().field('箭头',node.connector.arrow,arrow=>patchNode(node,{connector:{...node.connector,arrow}},'修改连接线箭头'),{options:[['none','无'],['end','终点'],['both','两端']]}),T().note('移动或旋转目标元件后，连接线会保持连接。'));
}

async function editRichText(nodeId) {
  const context=E.captureContext();if(!await E.flushPendingEdits())return;
  const now=E.getEditingContext();if(now.projectId!==context.projectId||now.targetId!==context.targetId||now.viewId!==context.viewId){E.toast('编辑位置已变化，请重新打开富文本。','warning');return;}
  const node=E.getPage(context)?.nodes.find(node=>node.id===nodeId);if(!node||!unlocked(node)||!['text','rectangle','button','ellipse'].includes(node.type))return;
  const signature=JSON.stringify([node.text,node.richText]),markDirty=()=>{if(richDialog)richDialog.dataset.dirty='true';};
  const rich=structuredClone(node.richText||makeRichText(node.text,node.style));let lastRange=null;
  T().openModal('富文本编辑',(body,dialog)=>{
    richDialog=dialog;dialog.dataset.dirty='false';dialog.addEventListener('close',()=>{if(richDialog===dialog)richDialog=null;});
    const editor=richDom(rich,true,node.style);editor.classList.add('vector-rich-editor');editor.style.fontSize=`${node.style.fontSize}px`;editor.style.color=node.style.color;
    const toolbar=html('div','vector-rich-toolbar');
    const restore=()=>{const selection=window.getSelection();if(lastRange&&editor.contains(lastRange.commonAncestorContainer)){selection.removeAllRanges();selection.addRange(lastRange);}return selection;};
    const applyInline=style=>{
      const selection=restore();if(!selection?.rangeCount||selection.isCollapsed){E.toast('先选中要设置格式的文字','warning');return;}
      const range=selection.getRangeAt(0);if(!editor.contains(range.commonAncestorContainer))return;
      const patch={};if(style.fontWeight)patch.bold=Number(style.fontWeight)>=600;if(style.fontStyle)patch.italic=style.fontStyle==='italic';
      if(style.textDecoration==='none'){patch.underline=false;patch.strike=false;}else{if(style.textDecoration?.includes('underline'))patch.underline=true;if(style.textDecoration?.includes('line-through'))patch.strike=true;}
      if(style.verticalAlign)patch.baseline=style.verticalAlign==='super'?'super':style.verticalAlign==='sub'?'sub':'normal';if(style.color)patch.color=style.color;
      const edit={range,patch},content=readRichEditor(editor,rich,edit),rendered=richDom(content,true);editor.replaceChildren(...rendered.childNodes);
      if(edit.selection){const next=document.createRange(),walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let offset=0,start=false,end=false;
        while(walker.nextNode()){const text=walker.currentNode,length=text.textContent.length;if(!start&&edit.selection.start<=offset+length){next.setStart(text,Math.max(0,edit.selection.start-offset));start=true;}if(start&&edit.selection.end<=offset+length){next.setEnd(text,Math.max(0,edit.selection.end-offset));end=true;break;}offset+=length;}
        if(start&&end){selection.removeAllRanges();selection.addRange(next);lastRange=next.cloneRange();}}
      markDirty();editor.focus();
    };
    for(const [label,style] of [['粗体',{fontWeight:'700'}],['斜体',{fontStyle:'italic'}],['下划线',{textDecoration:'underline'}],['删除线',{textDecoration:'line-through'}],['上标',{verticalAlign:'super',fontSize:'.75em'}],['下标',{verticalAlign:'sub',fontSize:'.75em'}],['普通基线',{verticalAlign:'baseline',fontSize:'1em'}],['清除格式',{fontWeight:'400',fontStyle:'normal',textDecoration:'none',verticalAlign:'baseline',fontSize:'1em',color:node.style.color}]]){const button=T().btn(label,()=>applyInline(style));button.addEventListener('pointerdown',event=>event.preventDefault());toolbar.append(button);}
    const blocks=()=>{const selection=restore(),range=selection?.rangeCount?selection.getRangeAt(0):null;return [...editor.children].filter(block=>!range||range.intersectsNode(block));};
    const setParagraph=(key,value)=>{for(const block of blocks()){if(key==='align')block.style.textAlign=value;else block.dataset.list=value;}markDirty();refreshMarkers();editor.focus();};
    for(const [label,value]of [['无列表','none'],['项目列表','bullet'],['编号列表','number']]){const button=T().btn(label,()=>setParagraph('list',value));button.addEventListener('pointerdown',event=>event.preventDefault());toolbar.append(button);}
    function refreshMarkers(){let count=0;for(const block of editor.children){block.classList.add('vector-paragraph');const list=block.dataset.list||'none';if(list==='number')block.dataset.marker=`${++count}. `;else{count=0;block.dataset.marker=list==='bullet'?'• ':'';}}}
    body.append(T().row(T().field('段落对齐','left',value=>setParagraph('align',value),{options:[['left','左对齐'],['center','居中'],['right','右对齐']]})),toolbar,editor,T().note('选中文字可设置粗斜体、下划线、删除线和上下标；点击段落设置列表。整体字体与行高在外观面板调整。粘贴只接收纯文字。修改与Agent使用同一份项目，冲突时保留编辑内容。'));
    const capture=()=>{const selection=window.getSelection();if(selection?.rangeCount&&editor.contains(selection.anchorNode)&&editor.contains(selection.focusNode))lastRange=selection.getRangeAt(0).cloneRange();};
    editor.addEventListener('keyup',capture);editor.addEventListener('pointerup',capture);editor.addEventListener('input',()=>{markDirty();refreshMarkers();});
    editor.addEventListener('paste',event=>{event.preventDefault();const text=event.clipboardData.getData('text/plain'),selection=restore();if(!selection?.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();const inserted=document.createTextNode(text);range.insertNode(inserted);range.setStartAfter(inserted);range.collapse(true);selection.removeAllRanges();selection.addRange(range);markDirty();});
    body.append(T().row(T().btn('取消',()=>dialog.close()),T().btn('保存文字',async()=>{
      const latest=E.getState().project.id===context.projectId?E.getPage(context)?.nodes.find(item=>item.id===nodeId):null;
      if(!latest||JSON.stringify([latest.text,latest.richText])!==signature){E.toast('原文字已变化，未覆盖最新内容。编辑内容仍保留，请先复制需要的文字再重新打开。','warning');return;}
      const content=readRichEditor(editor,rich),ok=await E.command([{type:'updateNode',pageId:context.targetId,nodeId,patch:{richText:content,text:richTextPlainText(content)}}],'编辑富文本',context,{expectedRevision:E.getState().revision});
      if(ok){dialog.dataset.dirty='false';dialog.close();}
    })));
    setTimeout(()=>editor.focus(),0);
  });
}
function readRichEditor(editor,settings,edit=null) {
  const paragraphs=[];let offset=0;
  const read=(block,inlineNodes=null)=>{
    const runs=[];
    let characters=0,breaks=0;const count=value=>{if(value.nodeType===Node.TEXT_NODE)characters+=value.textContent.length;else if(value.tagName==='BR')breaks++;else for(const child of value.childNodes||[])count(child);};for(const value of inlineNodes||[block])count(value);
    const append=(text,style,value)=>{
      if(!text)return;let start=0,end=0;
      if(edit?.range.intersectsNode(value)){start=edit.range.startContainer===value?edit.range.startOffset:0;end=edit.range.endContainer===value?edit.range.endOffset:text.length;}
      if(end>start){if(start)runs.push({text:text.slice(0,start),...style});runs.push({text:text.slice(start,end),...style,...edit.patch});if(end<text.length)runs.push({text:text.slice(end),...style});if(!edit.selection)edit.selection={start:offset+start,end:offset+end};else edit.selection.end=offset+end;}else runs.push({text,...style});
      offset+=text.length;
    };
    function visit(value,style){if(value.nodeType===Node.TEXT_NODE){append(value.textContent,style,value);return;}if(value.nodeType!==Node.ELEMENT_NODE)return;
      if(value.tagName==='BR'){if(characters||breaks>1)append('\n',style,value);return;}
      const next={...style},s=value.style;
      if(['B','STRONG'].includes(value.tagName))next.bold=true;if(['I','EM'].includes(value.tagName))next.italic=true;if(value.tagName==='U')next.underline=true;
      if(['S','STRIKE','DEL'].includes(value.tagName))next.strike=true;if(value.tagName==='SUP')next.baseline='super';if(value.tagName==='SUB')next.baseline='sub';
      if(s.fontWeight)next.bold=Number(s.fontWeight)>=600||s.fontWeight==='bold';if(s.fontStyle)next.italic=s.fontStyle==='italic';if(s.textDecoration){next.underline=s.textDecoration.includes('underline');next.strike=s.textDecoration.includes('line-through');}if(s.verticalAlign)next.baseline=s.verticalAlign==='super'?'super':s.verticalAlign==='sub'?'sub':'normal';
      if(s.color){const match=s.color.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);if(match){next.color='#'+match.slice(1,4).map(n=>Number(n).toString(16).padStart(2,'0')).join('');if(match[4]!==undefined&&Number(match[4])<1)next.color+=Math.round(Math.max(0,Number(match[4]))*255).toString(16).padStart(2,'0');}else if(/^#[\da-f]{3,8}$/i.test(s.color))next.color=s.color;else if(s.color==='transparent')next.color='#00000000';}
      for(const child of value.childNodes)visit(child,next);
    }
    const defaults={bold:false,italic:false,underline:false,strike:false,baseline:'normal',color:null};if(inlineNodes)for(const child of inlineNodes)visit(child,defaults);else visit(block,defaults);
    paragraphs.push({align:['left','center','right'].includes(block?.style?.textAlign)?block.style.textAlign:'left',list:['bullet','number'].includes(block?.dataset?.list)?block.dataset.list:'none',runs:runs.length?runs:[{text:'',bold:false,italic:false,underline:false,strike:false,baseline:'normal',color:null}]});
  };
  let inline=null;
  for(const child of editor.childNodes){if(child.nodeType===Node.ELEMENT_NODE&&['DIV','P','LI'].includes(child.tagName)){if(inline){read(null,inline);inline=null;}read(child);}else{if(!inline)inline=[];inline.push(child);}}
  if(inline)read(null,inline);if(!paragraphs.length)read(html('div'));
  return{fontFamily:settings.fontFamily,lineHeight:settings.lineHeight,paragraphs};
}

function renderProperties() {
  const old=$('#vector-properties');if(old?.contains(document.activeElement))return;old?.remove();const node=selectedNode();if(!node)return;
  if(!['path','connector','text','rectangle','button','ellipse'].includes(node.type))return;
  const section=html('section','inspector-section');section.id='vector-properties';section.append(html('h3','',node.type==='path'?'矢量路径':node.type==='connector'?'连接线':'文字排版'));
  if(node.type==='path'){
    section.append(T().row(T().btn(editId===node.id?'退出编辑点':'编辑点',()=>editId===node.id?stopTools():startPointEdit()),T().btn('加点',addPoint),T().btn('曲线/尖角',curvePoint)),T().row(T().btn('水平翻转',()=>flip('x')),T().btn('垂直翻转',()=>flip('y'))),T().check('闭合路径',node.path.closed,closed=>patchNode(node,{path:{...node.path,closed}},'切换路径闭合')),T().note(`${node.path.points.length} 个点 · 控制柄可拖动`));
  }else if(node.type==='connector')connectorSettings(node,section);
  else section.append(T().btn('编辑富文本…',()=>editRichText(node.id)),T().note('可设置选中文字的格式与段落列表；整体字体和行高在外观面板调整。'));
  $('#inspector')?.append(section);
}
function render(){pending=false;if(!E?.getPage()||!T())return;if(pen&&pen.pageId!==E.getPage().id)stopTools();if(editId&&!E.getPage().nodes.some(n=>n.id===editId))editId=null;renderProperties();drawOverlay();}
function schedule(){if(pending)return;pending=true;requestAnimationFrame(render);}
function install(){if(!E||!T())return;const host=$('#library-panel-content');if(host&&!$('#vector-library-tools')){const section=html('section','workspace-section');section.id='vector-library-tools';section.append(html('h3','workspace-section-title','矢量与连接'),T().row(T().btn('钢笔路径',startPen),T().btn('连接两元件',connectSelection)),T().note('钢笔可以绘制直线与曲线；连接线会跟随目标移动。'));host.append(section);}if(E.getPage())E.refresh();schedule();}
document.addEventListener('yuanda:editorchange',schedule);
document.addEventListener('yuanda:panelactivate',schedule);
document.addEventListener('pointerdown',event=>{
  if(!pen||event.button!==0||!event.target.closest('#board'))return;event.preventDefault();event.stopImmediatePropagation();const p=E.point(event),first=pen.points[0];
  if(first&&pen.points.length>=3&&Math.hypot(p.x-first.x,p.y-first.y)<9/E.getZoom()){finishPen(true);return;}
  if(pen.points.length&&Math.hypot(p.x-pen.points.at(-1).x,p.y-pen.points.at(-1).y)<2/E.getZoom())return;
  pen.points.push(point(p.x,p.y));pointDrag={kind:'pen',start:p};drawOverlay();
},true);
document.addEventListener('pointermove',event=>{
  if(pen){pen.cursor=E.point(event);if(pointDrag?.kind==='pen'){const p=pen.points.at(-1),cursor=pen.cursor;if(Math.hypot(cursor.x-p.x,cursor.y-p.y)>3/E.getZoom()){p.outX=cursor.x;p.outY=cursor.y;p.inX=2*p.x-cursor.x;p.inY=2*p.y-cursor.y;}}drawOverlay();return;}
  if(pointDrag?.kind==='point'){const node=pointDrag.source,cursor=documentToLocal(node,E.point(event)),p=pointDrag.draft.points[pointDrag.index];if(pointDrag.which==='point'){const x=clamp(cursor.x,0,1),y=clamp(cursor.y,0,1),dx=x-p.x,dy=y-p.y;p.x=x;p.y=y;for(const side of ['in','out'])if(p[`${side}X`]!==null){p[`${side}X`]+=dx;p[`${side}Y`]+=dy;}}else{p[`${pointDrag.which}X`]=clamp(cursor.x,-10,10);p[`${pointDrag.which}Y`]=clamp(cursor.y,-10,10);}drawOverlay();}
},true);
document.addEventListener('pointerup',event=>{if(!pointDrag)return;event.preventDefault();event.stopImmediatePropagation();const drag=pointDrag;pointDrag=null;if(drag.kind==='point')void commitPointDrag(drag);drawOverlay();},true);
document.addEventListener('pointercancel',()=>{pointDrag=null;drawOverlay();},true);
document.addEventListener('dblclick',event=>{if(pen&&event.target.closest('#board')){event.preventDefault();event.stopImmediatePropagation();finishPen(false);}},true);
document.addEventListener('keydown',event=>{
  if(event.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;
  if(toolMode()&&['Escape','Enter','Delete','Backspace'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape')stopTools();else if(event.key==='Enter')pen?finishPen(false):stopTools();else if(editId)deletePoint();return;}
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key.toLowerCase()==='p'){event.preventDefault();event.stopImmediatePropagation();startPen();}
},true);
window.YuandaVector={renderNode,editRichText,startPen,startPointEdit,connectSelection,stopTools,remapReferences:remapVectorReferences,mode:toolMode,hasPendingDraft:()=>!!richDialog?.open&&richDialog.dataset.dirty==='true'};
install();
