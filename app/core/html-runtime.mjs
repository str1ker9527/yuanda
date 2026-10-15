/** 原搭离线预览运行器。只解释经验证的数据和表达式，不执行项目提供的代码。 */
export function htmlRuntime(evaluateExpression, chooseInteractionCases, selectRepeaterRows, resolveAdaptivePage, getNodeDescendants, getVectorGeometry, connectorPoints, selectRepeaterPage, getCanvasViews, selectAdaptiveView, paintImageContent, applyNodeVisual, applyVectorVisual, resolveNodeVisual, getNodeBounds, rotateNodePoint, richRunStyle, getEventSettings) {
  'use strict';
  const project = JSON.parse(document.getElementById('yuanda-model').textContent);
  const stage = document.getElementById('stage'), picker = document.getElementById('pages'), viewPicker = document.getElementById('views');
  const clone = value => JSON.parse(JSON.stringify(value));
  const variables = Object.fromEntries((project.variables || []).map(variable => [variable.name, clone(variable.value)]));
  let page = null, root = null, generation = 0, serial = 0, requestedView, activeView = null, pending = new Map(), queues = new Map();
  let records = new Set(), instanceCount = 0, lastPointer = { x: 0, y: 0 };
  let runtimeChanges = new WeakMap();
  let repeaterStates = new WeakMap();
  const pinnedLayer=element('div','pinned-layer');document.body.append(pinnedLayer);
  let pointerDrag=null,suppressedClick=null,protectedGesture=null;
  let caseMenu=null, focusCause=null, menuFocusTransfer=0, continuousEvents=new Map();
  const causeDepth=event=>Math.max(event?._interactionDepth||0,event?._viewDepth||0);
  const nextCause=event=>({_interactionDepth:causeDepth(event)+1,_viewDepth:causeDepth(event)+1});
  function focusMenuControl(control){menuFocusTransfer++;try{control?.focus({preventScroll:true});}finally{menuFocusTransfer--;}}
  function changed(node, ...keys) { const fields = runtimeChanges.get(node) || new Set(); keys.forEach(key => fields.add(key)); runtimeChanges.set(node, fields); }
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const context = (scope, event = {}) => ({ variables, nodes: scope?.nodes || root?.nodes, item: scope?.item || {}, row: scope?.rowId ? { id: scope.rowId, marked: (scope.repeaterNode?.repeater.markedRowIds || []).includes(scope.rowId) } : null, getRepeater: id => { const owner = scopeFor(scope, id); return getRepeaterPage(owner?.nodes.get(id), owner); }, event });
  function getRepeaterPage(node, scope) {
    if (!node?.repeater) return null;
    let state = repeaterStates.get(node);
    if (!state) { state = { currentPage: node.repeater.pagination?.initialPage ?? 1, pageSize: node.repeater.pagination?.pageSize ?? null }; repeaterStates.set(node, state); }
    const result = selectRepeaterPage(node.repeater, context(scope), state.currentPage, state.pageSize); state.currentPage = result.currentPage; return result;
  }
  const evaluate = (value, scope, event) => evaluateExpression(value, context(scope, event));
  function notice(error) { const output = document.getElementById('runtime-status'); if (output) { output.hidden = false; output.textContent = '此步骤未完成：' + error.message; } console.error(error); }
  function wait(ms, stamp) {
    return new Promise(resolve => { const timer = setTimeout(() => { pending.delete(timer); resolve(stamp === generation); }, ms); pending.set(timer, resolve); });
  }
  function element(tag, className) { const result = document.createElement(tag); if (className) result.className = className; return result; }
  function svg(tag, attributes) { const result = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, String(value)); return result; }
  function scopeFor(scope, id) { for (let found = scope; found; found = found.parent) if (found.own.has(id)) return found; return root; }
  function recordFor(scope, id) { return scopeFor(scope, id)?.records.get(id); }
  function disabled(record) { for (let current = record; current; current = current.parentRecord) if (current.node.disabled) return true; return false; }
  function belongsTo(record,ancestor){for(let current=record;current;current=current.parentRecord)if(current===ancestor)return true;return false;}
  function shown(record){for(let current=record;current;current=current.parentRecord){if(!current.node.visible||current.node.effectivePlaced===false)return false;for(let parent=current.anchor?.parentElement||current.el.parentElement;parent&&parent!==pinnedLayer;parent=parent.parentElement)if(parent.hidden)return false;}return true;}
  function viewport(){const top=document.querySelector('.viewer-bar').getBoundingClientRect().bottom;return{left:0,top,width:window.innerWidth,height:Math.max(1,window.innerHeight-top),right:window.innerWidth,bottom:window.innerHeight};}
  function descendants(scope, id) { return getNodeDescendants([...scope.nodes.values()], id); }
  function newScope(parent, ids, item, key) {
    const nodes = new Map(parent.nodes), own = new Set(ids);
    for (const id of ids) if (nodes.has(id)) { const source = nodes.get(id), copied = clone(source); nodes.set(id, copied); if (runtimeChanges.has(source)) runtimeChanges.set(copied, new Set(runtimeChanges.get(source))); }
    return { parent, nodes, own, item, key, records: new Map() };
  }
  function applyBinding(node, key, scope, chain = new Set()) {
    const token = scope.key + ':' + node.id + ':' + key;
    if (chain.has(token)) throw new Error('数据绑定存在循环引用：' + node.name);
    chain.add(token); const expression = node.bindings[key];
    function dependencies(value) {
      if (!value || typeof value !== 'object') return;
      if (value.op === 'node') {
        const owner = scopeFor(scope, value.nodeId), referenced = owner?.nodes.get(value.nodeId);
        if (referenced && Object.hasOwn(referenced.bindings || {}, value.property)) applyBinding(referenced, value.property, owner, chain);
      }
      for (const argument of value.args || []) dependencies(argument);
    }
    dependencies(expression); const value = evaluate(expression, scope);
    node[key] = key === 'checked' || key === 'visible' ? Boolean(value) : String(value ?? '');
    if (key === 'text') node.richText = null;
    chain.delete(token);
  }
  function stateStyle(record) {
    const node = record.node, styles = node.stateStyles || {}, flags = record.flags, inactive = disabled(record);
    return { ...node.style, ...(['input', 'textarea'].includes(node.type) && !node.value ? styles.hint : {}), ...(!inactive && flags.hover ? styles.hover : {}), ...(!inactive && flags.focus ? styles.focus : {}), ...(!inactive && flags.pressed ? styles.pressed : {}), ...(node.selected ? styles.selected : {}), ...(node.error ? styles.error : {}), ...(inactive ? styles.disabled : {}) };
  }
  function drawVector(record, style) {
    const node = record.node, all = [...record.scope.nodes.values()].map(value => { const source = recordFor(record.scope, value.id); return source ? { ...value, style: stateStyle(source) } : value; });
    if (node.type === 'connector') {
      const points = connectorPoints(node, all);
      if (points.length) { node.x = Math.min(...points.map(point => point.x)); node.y = Math.min(...points.map(point => point.y)); node.width = Math.max(1, Math.max(...points.map(point => point.x)) - node.x); node.height = Math.max(1, Math.max(...points.map(point => point.y)) - node.y); }
    }
    const geometry = getVectorGeometry(node, all); if (!geometry) return;
    let visual = record.vector;
    if (!visual) { const drawing = svg('svg', { width: '100%', height: '100%', 'aria-hidden': 'true' }), path = svg('path', {}); drawing.append(path); record.el.replaceChildren(drawing); visual = record.vector = { drawing, path, markerPaths: [], arrow: null }; }
    const { drawing, path } = visual; drawing.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`); path.setAttribute('d', geometry.d); const id = 'arrow-' + record.uid;
    if (visual.arrow !== geometry.arrow) { visual.arrowDefs?.remove(); visual.markerPaths = []; path.removeAttribute('marker-start'); path.removeAttribute('marker-end'); if (geometry.arrow !== 'none') { const defs = svg('defs', {}), marker = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }), arrow = svg('path', { d: 'M 0 0 L 10 5 L 0 10 Z' }); marker.append(arrow); defs.append(marker); drawing.append(defs); visual.arrowDefs = defs; visual.markerPaths = [arrow]; path.setAttribute('marker-end', `url(#${id})`); if (geometry.arrow === 'both') path.setAttribute('marker-start', `url(#${id})`); } visual.arrow = geometry.arrow; }
    applyVectorVisual(drawing, path, node, { style, geometry, uid: 'vector-' + record.uid, markers: visual.markerPaths });
  }
  function drawRichText(record) {
    const rich = record.node.richText, content = element('div', 'rich-content yuanda-node-content'); let index = 0;
    for (const paragraph of rich.paragraphs) {
      const line = element('div', 'rich-paragraph'); line.style.textAlign = paragraph.align;
      const prefix = paragraph.list === 'bullet' ? '• ' : paragraph.list === 'number' ? `${++index}. ` : (index = 0, '');
      if (prefix) { const marker = element('span'); marker.textContent = prefix; line.append(marker); }
      for (const run of paragraph.runs) { const span = element('span'); span.textContent = run.text; Object.assign(span.style, richRunStyle(run)); line.append(span); }
      content.append(line);
    }
    record.el.replaceChildren(content); record.textContent = content;
  }
  function updateRecord(record) {
    const { node, el, scope } = record;
    for (const key of Object.keys(node.bindings || {})) if (key !== 'checked' || !record.pendingChecked) applyBinding(node, key, scope);
    const inactive = disabled(record); if (inactive) record.flags = {};
    const style = stateStyle(record), parentNode = record.parentRecord?.node;
    if (node.type === 'path' || node.type === 'connector') drawVector(record, style);
    Object.assign(el.style, { left: node.x - (parentNode?.x || 0) + 'px', top: node.y - (parentNode?.y || 0) + 'px', width: node.width + 'px', height: node.height + 'px', transform: `rotate(${node.rotation || 0}deg)` });
    el.hidden = !node.visible || node.effectivePlaced === false; el.setAttribute('aria-disabled', String(inactive)); el.setAttribute('aria-invalid', String(!!node.error)); el.dataset.selected = String(!!node.selected);
    if (node.type === 'path' || node.type === 'connector') { el.style.border = 'none'; el.style.background = 'transparent'; el.style.overflow = 'visible'; }
    if (node.type === 'line') { if (!record.line) { const drawing = svg('svg', { width: '100%', height: '100%' }), path = svg('path', {}); drawing.append(path); el.replaceChildren(drawing); record.line = { drawing, path }; } record.line.drawing.setAttribute('viewBox', `0 0 ${node.width} ${node.height}`); record.line.path.setAttribute('d', `M 0 ${style.strokeWidth / 2} H ${node.width}`); applyVectorVisual(record.line.drawing, record.line.path, node, { style, geometry: { width: node.width, height: node.height, closed: false }, uid: 'line-' + record.uid }); }
    if (record.input) {
      const input = record.input; input.disabled = inactive;
      if (node.type === 'input' || node.type === 'textarea') {
        if (node.type === 'input' && input.type !== (node.inputType || 'text')) input.type = node.inputType || 'text';
        input.readOnly = !!node.readOnly;
        if (node.maxLength != null) input.maxLength = node.maxLength; else input.removeAttribute('maxlength');
        input.setAttribute('aria-readonly', String(!!node.readOnly));
      }
      if (node.type === 'checkbox' || node.type === 'radio') { input.checked = !!node.checked; record.label.textContent = node.text; }
      else { if (input.value !== String(node.value ?? '')) input.value = String(node.value ?? ''); if ('placeholder' in input) input.placeholder = node.text; }
    } else if (node.type === 'image') { paintImageContent(el, node, { style }); }
    else if (!node.panel && !node.repeater && !['path', 'connector', 'line', 'table'].includes(node.type)) {
      const signature = JSON.stringify([node.text, node.richText]); if (record.textSignature !== signature) { if (node.richText) drawRichText(record); else { record.textContent = element('div', 'yuanda-node-content'); record.textContent.textContent = node.text; el.replaceChildren(record.textContent); } record.textSignature = signature; }
    }
    if (el.tagName === 'BUTTON') el.disabled = inactive;
    if (node.panel) { el.style.overflow='visible';const scroll=node.panel.scroll||{x:'none',y:'none'},scrolling=scroll.x!=='none'||scroll.y!=='none';for(const [id,state]of record.states){state.hidden=id!==record.stateId;for(const axis of ['x','y'])state.style[axis==='x'?'overflowX':'overflowY']=scroll[axis]==='auto'?'auto':scroll[axis]==='always'?'scroll':scrolling||node.panel.clip?'hidden':'visible';}el.style.touchAction=node.panel.drag?.enabled?'none':'auto'; }
    if (node.repeater) updateRepeater(record);
    applyNodeVisual(el, node, { style, contentElement: record.textContent || record.checkLabel, controlElement: ['input', 'textarea', 'select'].includes(node.type) ? record.input : null, uid: 'node-' + record.uid });
  }
  function disposeWithin(container) {
    const roots=[...records].filter(record=>container.contains(record.el)||record.anchor&&container.contains(record.anchor));
    for (const record of [...records]) if(roots.some(root=>belongsTo(record,root))){if(pointerDrag?.record===record)endDrag(null,true);records.delete(record);record.scope.records.delete(record.node.id);record.el.remove();record.anchor?.remove();instanceCount--;}
    container.replaceChildren();
  }
  function updateRepeater(record) {
    const data = record.node.repeater, rows = getRepeaterPage(record.node, record.scope).rows;
    // Keep a row's own nodes, focus and input values when sorting/filtering. Only
    // deleting a data row disposes that row; a filter merely hides it.
    record.items ||= new Map();
    const existing = new Map(data.rows.map(row => [row.id, row])), visible = new Set(rows.map(row => row.id));
    for (const [id, item] of record.items) {
      if (!existing.has(id)) { disposeWithin(item.el); item.el.remove(); record.items.delete(id); }
      else { item.el.hidden = !visible.has(id); item.scope.item = existing.get(id).values; }
    }
    const ids = [...new Set(data.templateIds.flatMap(id => [id, ...descendants(record.scope, id)]))];
    let index = 0;
    for (const row of rows) {
      let entry = record.items.get(row.id);
      if (!entry) {
        const item = element('div', 'repeater-item'); item.dataset.rowId = row.id;
        const scope = newScope(record.scope, ids, row.values, record.scope.key + ':' + record.node.id + ':' + row.id);
        scope.rowId = row.id; scope.repeaterNode = record.node;
        entry = { el: item, scope }; record.items.set(row.id, entry); record.content.append(item);
        for (const id of data.templateIds) createNode(scope.nodes.get(id), item, scope, record);
      }
      const item = entry.el; entry.scope.item = row.values; item.hidden = false;
      const column = data.layout === 'vertical' ? 0 : data.layout === 'horizontal' ? index : index % data.columnsCount;
      const line = data.layout === 'vertical' ? index : data.layout === 'horizontal' ? 0 : Math.floor(index / data.columnsCount);
      Object.assign(item.style, { left: column * (data.itemWidth + data.gap) + 'px', top: line * (data.itemHeight + data.gap) + 'px', width: data.itemWidth + 'px', height: data.itemHeight + 'px' });
      const next = record.content.children[index] || null;
      if (next !== item) {
        if (record.content.moveBefore) record.content.moveBefore(item, next);
        else record.content.insertBefore(item, next);
      }
      index++;
    }
  }
  function refresh() {
    for (const record of [...records]) if (records.has(record) && record.node.type !== 'connector') updateRecord(record);
    for (const record of [...records]) if (record.node.type === 'connector') updateRecord(record);
    layoutPanels();
    if(caseMenu?.owner&&(!records.has(caseMenu.owner)||disabled(caseMenu.owner)||!shown(caseMenu.owner)))caseMenu.cancel();
    for(const record of records)queueLoad(record);
  }
  function queueLoad(record){if(record.loadFired||record.node.effectivePlaced===false)return;record.loadFired=true;Promise.resolve().then(()=>{if(records.has(record))activate(record,'load');});}
  function layoutPanels(){
    for(const record of [...records].reverse())if(record.node.panel){const {node,el}=record,panel=node.panel;
      if(panel.sizeMode==='content'){let width=1,height=1;const state=panel.states.find(state=>state.id===record.stateId);for(const id of state?.nodeIds||[]){const child=record.scope.records.get(id);if(!child?.node.visible||child.node.effectivePlaced===false||child.node.panel?.pin)continue;const bounds=getNodeBounds({...child.node,style:stateStyle(child)});width=Math.max(width,bounds.right-node.x);height=Math.max(height,bounds.bottom-node.y);}node.width=Math.min(100000,width);node.height=Math.min(100000,height);applyNodeVisual(el,node,{style:stateStyle(record),uid:'node-'+record.uid});}
      if(panel.pin){if(el.parentElement!==pinnedLayer)pinnedLayer.append(el);const view=viewport(),pin=panel.pin,shift=record.pinShift||{x:0,y:0};const x=pin.horizontal==='left'?pin.offsetX:pin.horizontal==='right'?view.width-node.width-pin.offsetX:(view.width-node.width)/2+pin.offsetX;const y=pin.vertical==='top'?view.top+pin.offsetY:pin.vertical==='bottom'?view.bottom-node.height-pin.offsetY:view.top+(view.height-node.height)/2+pin.offsetY;Object.assign(el.style,{position:'fixed',left:x+shift.x+'px',top:y+shift.y+'px'});}
      else{if(record.anchor&&el.parentElement===pinnedLayer)record.anchor.after(el);el.style.position='absolute';}
    }
    for(const record of records)if(record.node.panel?.pin)record.el.hidden=!shown(record);
    if(pointerDrag&&(!shown(pointerDrag.record)||disabled(pointerDrag.record)))endDrag(null,true);
  }
  function translateRecord(record,dx,dy){const targets=new Set([record.node.id,...descendants(record.scope,record.node.id)].map(id=>record.scope.nodes.get(id)));for(const child of records)if(belongsTo(child,record))targets.add(child.node);for(const target of targets)if(target){target.x+=dx;target.y+=dy;changed(target,'x','y');}if(record.node.panel?.pin){record.pinShift||={x:0,y:0};record.pinShift.x+=dx;record.pinShift.y+=dy;}}
  function dragData(record,event,dx=0,dy=0,cancelled=false){return{...eventData(event,record),deltaX:dx,deltaY:dy,cancelled};}
  function parentAngle(record){let angle=0;for(let parent=record.parentRecord;parent;parent=parent.parentRecord){angle+=parent.node.rotation||0;if(parent.node.panel?.pin)break;}return angle*Math.PI/180;}
  function dragBoundary(record,rect,angle){
    if(record.node.panel.drag.bounds==='viewport'){const bound=viewport();return{angle:0,left:bound.left-rect.left,right:bound.right-rect.right,top:bound.top-rect.top,bottom:bound.bottom-rect.bottom};}
    if(record.node.panel.drag.bounds!=='parent')return null;
    // Bounds belong to the visible state/row viewport, not its screen-aligned
    // bounding box. Inverse rotation keeps a child inside oblique parents too.
    const container=record.anchor?.parentElement||stage,bound=container.getBoundingClientRect(),rotation=parentAngle(record),c=Math.cos(rotation),s=Math.sin(rotation);
    const dx=rect.left+rect.width/2-bound.left-bound.width/2,dy=rect.top+rect.height/2-bound.top-bound.height/2;
    const x=dx*c+dy*s+container.offsetWidth/2,y=-dx*s+dy*c+container.offsetHeight/2,relative=angle+(record.node.rotation||0)*Math.PI/180-rotation;
    const width=Math.abs(record.node.width*Math.cos(relative))+Math.abs(record.node.height*Math.sin(relative)),height=Math.abs(record.node.width*Math.sin(relative))+Math.abs(record.node.height*Math.cos(relative));
    return{angle:rotation,left:container.clientLeft-x+width/2,right:container.clientLeft+container.clientWidth-x-width/2,top:container.clientTop-y+height/2,bottom:container.clientTop+container.clientHeight-y-height/2};
  }
  function beginDrag(record,event){
    if(pointerDrag||event.button!==0||!record.node.panel.drag?.enabled||disabled(record)||!shown(record))return;
    if(event.target.closest('input,textarea,select,button,label,a,[contenteditable=true]'))return;
    for(let el=event.target;el&&el!==record.el;el=el.parentElement)if(el.classList.contains('interactive')||el.classList.contains('node-dynamicPanel')&&[...records].some(other=>other.el===el&&other.node.panel.drag?.enabled))return;
    const rect=record.el.getBoundingClientRect(),angle=record.node.panel.pin?0:parentAngle(record);
    pointerDrag={record,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,lastX:0,lastY:0,angle,bound:dragBoundary(record,rect,angle),started:false,stamp:generation};
    record.el.setPointerCapture(event.pointerId);
  }
  function moveDrag(event){const drag=pointerDrag;if(!drag||event.pointerId!==drag.pointerId)return;const record=drag.record;if(drag.stamp!==generation||!records.has(record)||disabled(record)||!shown(record)){endDrag(event,true);return;}
    let dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;if(!drag.started&&Math.hypot(dx,dy)<3)return;
    if(!drag.started){drag.started=true;activate(record,'dragStart',event,dragData(record,event));}
    const settings=record.node.panel.drag,c=Math.cos(drag.angle),s=Math.sin(drag.angle);let localX=dx*c+dy*s,localY=-dx*s+dy*c;if(settings.axis==='x')localY=0;if(settings.axis==='y')localX=0;dx=localX*c-localY*s;dy=localX*s+localY*c;
    const bound=drag.bound;
    if(bound){const relative=drag.angle-bound.angle,bc=Math.cos(relative),bs=Math.sin(relative),clamp=(value,low,high)=>low<=high?Math.max(low,Math.min(high,value)):(low+high)/2;
      if(settings.axis==='both'){const x=clamp(localX*bc-localY*bs,bound.left,bound.right),y=clamp(localX*bs+localY*bc,bound.top,bound.bottom);localX=x*bc+y*bs;localY=-x*bs+y*bc;}
      else{let low=-Infinity,high=Infinity;const unit=settings.axis==='x'?{x:bc,y:bs}:{x:-bs,y:bc};for(const [component,min,max]of [[unit.x,bound.left,bound.right],[unit.y,bound.top,bound.bottom]])if(Math.abs(component)>1e-8){const a=min/component,b=max/component;low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));}const value=low<=high?clamp(settings.axis==='x'?localX:localY,low,high):0;if(settings.axis==='x')localX=value;else localY=value;}
    }
    const stepX=localX-drag.lastX,stepY=localY-drag.lastY;drag.lastX=localX;drag.lastY=localY;translateRecord(record,stepX,stepY);refresh();if(pointerDrag!==drag)return;event.preventDefault();activate(record,'drag',event,dragData(record,event,localX,localY));
  }
  function endDrag(event,cancelled=false){const drag=pointerDrag;if(!drag)return;pointerDrag=null;try{if(drag.record.el.hasPointerCapture(drag.pointerId))drag.record.el.releasePointerCapture(drag.pointerId);}catch{}if(drag.started){suppressedClick={record:drag.record,until:Date.now()+600};if(records.has(drag.record)&&drag.stamp===generation)activate(drag.record,'dragEnd',event||{},dragData(drag.record,event,drag.lastX,drag.lastY,cancelled));}}
  document.addEventListener('pointerdown',event=>{const control=event.target.closest('input,textarea,select,button,label,a,[contenteditable=true],.interactive');protectedGesture=control?.closest('.node-dynamicPanel')?{control,pointerId:event.pointerId}:null;},true);
  document.addEventListener('pointermove',moveDrag,{passive:false});document.addEventListener('pointerup',event=>{if(pointerDrag?.pointerId===event.pointerId)endDrag(event);});document.addEventListener('pointercancel',event=>{if(pointerDrag?.pointerId===event.pointerId)endDrag(event,true);if(protectedGesture?.pointerId===event.pointerId)protectedGesture=null;});
  document.addEventListener('click',event=>{const protectedControl=protectedGesture?.control;protectedGesture=null;if(event.detail>0&&protectedControl&&!protectedControl.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();return;}if(suppressedClick&&Date.now()<suppressedClick.until){const record=suppressedClick.record;if(record.el.contains(event.target)||event.target===record.el){event.preventDefault();event.stopImmediatePropagation();suppressedClick=null;}}},true);
  window.addEventListener('blur',()=>endDrag(null,true));
  function eventData(event, record) { const input = record?.input || event?.target,content=record?.states.get(record.stateId);return { value: input?.value ?? record?.node.value ?? '', checked: input?.checked ?? record?.node.checked ?? false, rowId: record?.scope.rowId ?? null, key: event?.key || '', x: event?.clientX == null ? lastPointer.x : event.clientX - stage.getBoundingClientRect().left, y: event?.clientY == null ? lastPointer.y : event.clientY - stage.getBoundingClientRect().top,deltaX:0,deltaY:0,scrollX:record?content?.scrollLeft||0:window.scrollX,scrollY:record?content?.scrollTop||0:window.scrollY,cancelled:false,windowWidth:window.innerWidth,windowHeight:window.innerHeight,scrollDeltaX:0,scrollDeltaY:0,ctrlKey:!!event?.ctrlKey,shiftKey:!!event?.shiftKey,altKey:!!event?.altKey,metaKey:!!event?.metaKey }; }
  function hasEvent(record,type) {const target=record?.node||page;return !!target&&getEventSettings(target,type).enabled&&(target.interactions||[]).some(branch=>branch.event===type&&branch.enabled!==false&&branch.actions.some(action=>action.enabled!==false));}
  function selectCase(cases,owner,data,stamp) {
    caseMenu?.cancel();
    return new Promise(resolve=>{
      const panel=element('div','runtime-case-menu'),heading=element('div'),previous=document.activeElement,buttons=[];
      panel.setAttribute('role','dialog');panel.setAttribute('aria-label','选择要执行的分支');
      Object.assign(panel.style,{position:'fixed',zIndex:'30000',minWidth:'210px',maxWidth:'min(420px, calc(100vw - 16px))',maxHeight:'min(480px, calc(100vh - 16px))',overflow:'auto',padding:'8px',border:'1px solid #cbd5e1',borderRadius:'8px',background:'#fff',color:'#172033',boxShadow:'0 12px 36px #0003',font:'14px "Segoe UI",sans-serif'});
      heading.textContent='选择要执行的分支';Object.assign(heading.style,{padding:'6px 8px',fontSize:'12px',color:'#64748b'});panel.append(heading);
      let finished=false;
      const finish=chosen=>{if(finished)return;finished=true;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keyboard,true);window.removeEventListener('blur',cancel);panel.remove();if(caseMenu?.element===panel)caseMenu=null;resolve(stamp===generation&&(!owner||records.has(owner)&&shown(owner)&&!disabled(owner))?chosen:null);if(previous?.isConnected&&document.activeElement===document.body)focusMenuControl(previous);};
      const cancel=()=>finish(null),outside=event=>{if(!panel.contains(event.target))cancel();};
      const keyboard=event=>{if(!panel.contains(event.target)&&event.key!=='Escape')return;let index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;focusMenuControl(buttons[index]);}else if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopImmediatePropagation();if(index>=0)finish(cases[index]);}else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}else if(event.key==='Tab'){event.preventDefault();event.stopImmediatePropagation();focusMenuControl(buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length]);}};
      cases.forEach((branch,index)=>{const button=element('button');button.type='button';button.dataset.caseIndex=String(index);button.textContent=branch.name||`分支 ${index+1}`;Object.assign(button.style,{display:'block',width:'100%',border:'0',borderRadius:'4px',padding:'9px 10px',background:'#f1f5f9',color:'inherit',textAlign:'left',cursor:'pointer',marginTop:'3px',whiteSpace:'normal'});button.addEventListener('click',()=>finish(branch));panel.append(button);buttons.push(button);});
      document.body.append(panel);const bounds=owner?.el.getBoundingClientRect(),stageBounds=stage.getBoundingClientRect(),x=bounds?.left??stageBounds.left+data.x,y=bounds?.bottom??stageBounds.top+data.y;
      panel.style.left=Math.max(8,Math.min(x,window.innerWidth-panel.offsetWidth-8))+'px';panel.style.top=Math.max(8,Math.min(y,window.innerHeight-panel.offsetHeight-8))+'px';
      caseMenu={owner,cancel,element:panel};document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keyboard,true);window.addEventListener('blur',cancel);focusMenuControl(buttons[0]);
    });
  }
  async function executeEvent(record,type,data,stamp) {
    if(stamp!==generation||(record&&(!records.has(record)||disabled(record))))return;
    if(causeDepth(data)>32)throw new Error('交互事件相互触发超过 32 次，请检查循环条件');
    const scope=record?.scope||root,target=record?.node||page,settings=getEventSettings(target,type);
    let cases=chooseInteractionCases(target.interactions||[],type,context(scope,data),settings);
    if(settings.executionMode==='menu') {cases=cases.filter(branch=>branch.actions.some(action=>action.enabled!==false));if(!cases.length)return;const chosen=await selectCase(cases,record,data,stamp);cases=chosen?[chosen]:[];}
    await run(cases.flatMap(branch=>branch.actions),scope,data,stamp,record);
  }
  function activate(record, type, event = {}, suppliedData) {
    if (record && (disabled(record) || !records.has(record))) return;
    if(menuFocusTransfer&&['focus','blur'].includes(type))return;
    if(!hasEvent(record,type))return;
    const stamp = generation, key = record?.uid || 'page';
    const data = suppliedData || eventData(event, record);
    if(focusCause&&['focus','blur'].includes(type))Object.assign(data,nextCause(focusCause));
    const continuous=['mousemove','windowResize','windowScroll','scroll'].includes(type),token=key+':'+type;
    if(continuous&&continuousEvents.has(token)){continuousEvents.get(token).data=data;return;}
    const entry={data};if(continuous)continuousEvents.set(token,entry);
    const previous = queues.get(key) || Promise.resolve();
    const task = previous.then(async () => {
      if(continuous)await new Promise(resolve=>requestAnimationFrame(resolve));
      if (stamp !== generation || (record && (!records.has(record) || disabled(record)))) return;
      await executeEvent(record,type,entry.data,stamp);
    }).catch(notice);
    queues.set(key, task); task.finally(() => { if (queues.get(key) === task) queues.delete(key);if(continuous&&continuousEvents.get(token)===entry)continuousEvents.delete(token); });
  }
  function nativeChange(record) {
    const { node, input, scope } = record;
    // Native checkbox click -> input -> change is one gesture. Do not let a
    // checked binding undo its new value before the change event captures it.
    if (['checkbox', 'radio'].includes(node.type)) record.pendingChecked = true;
    if (node.type === 'radio' && input.checked && node.radioGroup) for (const other of records) if (other.node.type === 'radio' && other.scope === scope && other.node.radioGroup === node.radioGroup) { other.node.checked = other === record; other.input.checked = other === record; }
    node.value = input.value; node.checked = !!input.checked; changed(node, 'value');
  }
  function bindEvents(record) {
    const { el, node } = record, target = record.input || el;
    const events = ['click', 'dblclick', 'contextmenu', 'mousemove', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup', 'change', 'input', 'focus', 'blur', 'keydown', 'keyup'];
    for (const type of events) (['mouseenter','mouseleave'].includes(type) ? el : target).addEventListener(type, event => {
      if (disabled(record)) return;
      if(type==='contextmenu'&&hasEvent(record,type))event.preventDefault();
      if(node.panel&&event.target!==el){for(let child=event.target;child&&child!==el;child=child.parentElement)if(child.matches('input,textarea,select,button,label,a,[contenteditable=true],.interactive,.node-dynamicPanel'))return;}
      if (['input', 'change', 'click'].includes(type) && record.input) nativeChange(record);
      // A value binding may repaint the input during refresh. Capture the
      // visitor's native value first so input -> variable -> binding works.
      const data = eventData(event, record);
      if (type === 'change') record.pendingChecked = false;
      if (type === 'mouseenter') record.flags.hover = true; if (type === 'mouseleave') { record.flags.hover = false; record.flags.pressed = false; }
      if (type === 'mousedown') record.flags.pressed = true; if (type === 'mouseup') record.flags.pressed = false;
      if (type === 'focus') record.flags.focus = true; if (type === 'blur') record.flags.focus = false;
      if (['input', 'change'].includes(type)) refresh(); else {updateRecord(record);if(node.panel)layoutPanels();for(const connector of records)if(connector.node.type==='connector'&&[connector.node.connector?.from?.nodeId,connector.node.connector?.to?.nodeId].some(id=>id&&recordFor(connector.scope,id)===record))updateRecord(connector);}
      activate(record, type, event, data);
      if (type === 'keydown' && !record.input && el.tagName !== 'BUTTON' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(record, 'click', event); }
    });
    if(node.panel){el.addEventListener('pointerdown',event=>beginDrag(record,event));el.addEventListener('lostpointercapture',event=>{if(pointerDrag?.record===record&&pointerDrag.pointerId===event.pointerId)endDrag(event,true);});}
    if (['click','dblclick','contextmenu','keydown','keyup','focus','blur'].some(type=>hasEvent(record,type))) {
      el.classList.add('interactive'); if (!record.input && el.tagName !== 'BUTTON') { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    }
  }
  function createNode(node, container, scope, parentRecord = null) {
    if (!node) return; if (++instanceCount > 30000) throw new Error('此页展开后的元件超过 30000 个，请减少中继器展示数据。');
    const tag = node.type === 'button' ? 'button' : 'div';
    const el = element(tag, 'node node-' + node.type); el.dataset.nodeId = node.id; el.setAttribute('aria-label', node.name);
    const record = { node, el, scope, parentRecord, uid: 'n' + ++serial, flags: {}, input: null, label: null, states: new Map(), stateId: node.panel?.initialStateId };
    records.add(record); scope.records.set(node.id, record);if(node.panel){record.anchor=document.createComment('panel '+node.id);container.append(record.anchor);}container.append(el);
    if (tag === 'button') el.type = 'button'; if (tag === 'img') el.draggable = false;
    if (['input', 'textarea', 'select'].includes(node.type)) {
      const input = record.input = element(node.type, 'yuanda-native-control'); input.setAttribute('aria-label', node.name); input.autocomplete = 'off'; if (node.type === 'input') input.type = node.inputType || 'text'; el.append(input);
      if (node.type === 'select') { for (const value of node.options || []) { const option = element('option'); option.value = value; option.textContent = value; input.append(option); } if (!node.value && node.options?.length) node.value = node.options[0]; }
    }
    if (node.type === 'checkbox' || node.type === 'radio') { const label = element('label', 'check-label'), input = element('input'); input.type = node.type; input.name = node.radioGroup ? scope.key + ':' + node.radioGroup : record.uid; input.setAttribute('aria-label', node.name); const text = element('span'); label.append(input, text); el.append(label); record.input = input; record.label = text; record.checkLabel = label; }
    if (node.type === 'table') { const table = element('table'); for (const [index, cells] of (node.rows || []).entries()) { const row = element('tr'); for (const value of cells) { const cell = element(index === 0 ? 'th' : 'td'); cell.textContent = value; row.append(cell); } table.append(row); } el.append(table); }
    if (node.panel) for (const state of node.panel.states) { const content = element('div', 'panel-state'); content.dataset.stateId = state.id; record.states.set(state.id, content);el.append(content);content.addEventListener('scroll',event=>{if(record.stateId===state.id&&!disabled(record)&&shown(record))activate(record,'scroll',event,eventData(event,record));},{passive:true});for (const id of state.nodeIds) createNode(scope.nodes.get(id), content, scope, record); }
    if (node.repeater) { record.content = element('div', 'repeater-content'); el.append(record.content); el.style.overflow = 'auto'; }
    updateRecord(record); bindEvents(record);
    queueLoad(record);
    return record;
  }
  async function run(actions, scope, event, stamp, owner) {
    for (const action of actions) {
      if (stamp !== generation || (owner && !records.has(owner))) return;
      if(action.enabled===false)continue;
      const record = recordFor(scope, action.targetId || action.panelId || action.repeaterId), node = record?.node;
      const value = () => evaluate(action.value, scope, event);
      let variableEvent=null;
      if (action.type === 'wait') { if (!await wait(action.ms, stamp)) return; continue; }
      if (action.type === 'navigate') { requestedView=undefined;showPage(action.pageId); return; }
      if(action.type==='setAdaptiveView'){const depth=causeDepth(event)+1;if(depth>32)throw new Error('视图切换事件相互触发超过 32 次，请检查交互条件');requestedView=action.mode==='auto'?undefined:action.mode==='base'?null:action.viewId;applyAdaptiveView('action',depth);continue;}
      if (action.type === 'setVariable') { const variable = (project.variables || []).find(item => item.name === action.name), result = value(),previousValue=variables[action.name]; variables[action.name] = variable?.type === 'number' ? number(result) : variable?.type === 'boolean' ? Boolean(result) : String(result ?? '');if(!Object.is(previousValue,variables[action.name]))variableEvent={...eventData({}),variableName:action.name,previousValue,value:variables[action.name],...nextCause(event)}; }
      else if (!node) continue;
      else if(action.type==='focus') {if(!disabled(record)&&shown(record)){focusCause=event;try{(record.input||record.el).focus();}finally{focusCause=null;}}}
      else if(action.type==='triggerEvent') {await executeEvent(record,action.event,{...eventData({},record),...nextCause(event)},stamp);if(stamp!==generation)return;}
      else if (action.type === 'setText') { node.text = String(value() ?? ''); node.richText = null; changed(node, 'text'); if (record.input && !['checkbox', 'radio'].includes(node.type)) { node.value = node.text; changed(node, 'value'); } }
      else if (action.type === 'setValue') { node.value = String(value() ?? ''); changed(node, 'value'); }
      else if (action.type === 'setChecked') { node.checked = Boolean(value()); if (node.type === 'radio' && node.checked && node.radioGroup) for (const other of records) if (other !== record && other.scope === record.scope && other.node.type === 'radio' && other.node.radioGroup === node.radioGroup) other.node.checked = false; }
      else if (action.type === 'setVisible') { node.visible = Boolean(value()); changed(node, 'visible'); }
      else if (action.type === 'toggleVisible') { node.visible = !node.visible; changed(node, 'visible'); }
      else if (['setDisabled', 'setSelected', 'setError'].includes(action.type)) { const key = { setDisabled: 'disabled', setSelected: 'selected', setError: 'error' }[action.type]; node[key] = Boolean(value()); changed(node, key); }
      else if (action.type === 'setStyle') { node.style = { ...node.style, ...clone(action.style) }; changed(node, ...Object.keys(action.style).map(key => 'style.' + key)); }
      else if (action.type === 'move') {
        const x = number(evaluate(action.x, scope, event)), y = number(evaluate(action.y, scope, event)); const dx = action.relative ? x : x - node.x, dy = action.relative ? y : y - node.y;
        translateRecord(record,dx,dy);
      } else if (action.type === 'resize') { node.width = Math.max(1, number(evaluate(action.width, scope, event))); node.height = Math.max(1, number(evaluate(action.height, scope, event)));if(node.panel)node.panel.sizeMode='fixed'; changed(node, 'width', 'height'); }
      else if (['setPanelState', 'nextPanelState', 'previousPanelState'].includes(action.type) && node.panel) {
        let id = action.stateId; if (action.type !== 'setPanelState') { const states = node.panel.states, index = states.findIndex(state => state.id === record.stateId), next = index + (action.type === 'nextPanelState' ? 1 : -1); id = states[action.wrap ? (next + states.length) % states.length : Math.max(0, Math.min(states.length - 1, next))].id; }
        if (record.stateId !== id) { record.stateId = id; activate(record, 'stateChange', {}, {...eventData(event,record),...nextCause(event)}); }
      } else if (node.repeater) {
        const data = node.repeater, rowContext = row => ({ ...context(scope, event), item: row.values, row: { id: row.id, marked: (data.markedRowIds || []).includes(row.id) } });
        const matches = row => action.where == null || Boolean(evaluateExpression(action.where, rowContext(row)));
        if (action.type === 'addRows') {
          if (data.rows.length + action.rows.length > 10000) throw new Error('数据列表最多 10000 行');
          data.rows.push(...action.rows.map(row => { let id; do { id = 'runtime-row-' + ++serial; } while (data.rows.some(item => item.id === id)); return { id, values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => [key, evaluate(value, scope, event)])) }; }));
        }
        else if (action.type === 'deleteRows') { data.rows = data.rows.filter(row => !matches(row)); data.markedRowIds = (data.markedRowIds || []).filter(id => data.rows.some(row => row.id === id)); }
        else if (action.type === 'updateRows') { for (const row of data.rows) if (matches(row)) { const updates = Object.fromEntries(Object.entries(action.values).map(([key, expression]) => [key, evaluateExpression(expression, rowContext(row))])); Object.assign(row.values, updates); } }
        else if (action.type === 'filterRows') data.filter = clone(action.where);
        else if (action.type === 'sortRows') data.sort = { column: action.column, descending: action.descending };
        else if (action.type === 'markRows') {
          const changes = data.rows.filter(matches).map(row => { const marked = evaluateExpression(action.marked, rowContext(row)); if (typeof marked !== 'boolean') throw new Error('行标记需要“是/否”布尔值'); return [row.id, marked]; });
          const marks = new Set(data.markedRowIds || []); for (const [id, marked] of changes) { if (marked) marks.add(id); else marks.delete(id); } data.markedRowIds = [...marks];
        } else if (action.type === 'setRepeaterPage' || action.type === 'setRepeaterPageSize') {
          getRepeaterPage(node, record.scope); const state = repeaterStates.get(node), next = value();
          if (action.type === 'setRepeaterPageSize' && next === null) { state.pageSize = null; state.currentPage = 1; }
          else { if (typeof next !== 'number' || !Number.isInteger(next) || (action.type === 'setRepeaterPageSize' && (next < 1 || next > 10000))) throw new Error('分页需要整数；每页数量应为 1–10000，或不限');
            if (action.type === 'setRepeaterPage') state.currentPage = next; else { state.pageSize = next; state.currentPage = 1; }
          }
        }
      }
      refresh();
      if(variableEvent)activate(null,'variableChange',{},variableEvent);
    }
  }
  function selectedView(source) { return selectAdaptiveView(project,source,window.innerWidth,requestedView); }
  const viewOptionValue=id=>id==='auto'||id==='base'?'view:'+id:id;
  const selectedOptionValue=()=>requestedView===undefined?'auto':requestedView===null?'base':viewOptionValue(requestedView);
  function applyAdaptiveView(reason='selector',depth=0) {
    if (!page) return;
    const source = project.pages.find(item => item.id === page.id), previousViewId=activeView, adapted = resolveAdaptivePage(source, window.innerWidth, requestedView, project);
    const models = new Map(adapted.nodes.map(node => [node.id, node]));
    const live = new Set(root.nodes.values());
    for (const record of records) for (const node of record.scope.nodes.values()) live.add(node);
    // Reapply design-time view values only to properties not changed by the
    // visitor or an interaction. No DOM rebuild, load event, or wait reset.
    for (const node of live) {
      const model = models.get(node.id), touched = runtimeChanges.get(node) || new Set(); if (!model) continue;
      node.placed=model.placed;node.effectivePlaced=model.effectivePlaced;
      for (const key of ['x', 'y', 'width', 'height', 'rotation', 'visible', 'disabled', 'text', 'value']) if (!touched.has(key)) node[key] = clone(model[key]);
      if(!touched.has('text'))node.richText=clone(model.richText);
      for (const [key, value] of Object.entries(model.style)) if (!touched.has('style.' + key)) node.style[key] = clone(value);
      // State patches are authored effective layers, never runtime/local ownership metadata.
      node.stateStyles = clone(model.stateStyles || {});
    }
    page.width = adapted.width; page.height = adapted.height; activeView = selectedView(source);
    Object.assign(stage.style, { width: page.width + 'px', height: page.height + 'px' }); refresh();
    if(viewPicker)viewPicker.value=selectedOptionValue();
    if(previousViewId!==activeView)activate(null,'adaptiveViewChange',{}, {viewId:activeView,previousViewId,reason,_viewDepth:depth,_interactionDepth:depth});
  }
  function showPage(id) {
    const source = project.pages.find(page => page.id === id); if (!source) return;
    generation++;caseMenu?.cancel();continuousEvents=new Map();endDrag(null,true);suppressedClick=null;protectedGesture=null;pinnedLayer.replaceChildren(); for (const [timer, resolve] of pending) { clearTimeout(timer); resolve(false); } pending = new Map(); queues = new Map(); records = new Set(); instanceCount = 0; runtimeChanges = new WeakMap(); repeaterStates = new WeakMap();
    const status = document.getElementById('runtime-status'); if (status) { status.hidden = true; status.textContent = ''; }
    activeView = selectedView(source); page = resolveAdaptivePage(source, window.innerWidth, requestedView, project); stage.replaceChildren();
    root = { nodes: new Map(page.nodes.map(node => [node.id, node])), own: new Set(page.nodes.map(node => node.id)), records: new Map(), parent: null, item: {}, key: page.id };
    Object.assign(stage.style, { width: page.width + 'px', height: page.height + 'px', background: page.background }); picker.value = page.id;
    document.getElementById('current-page').textContent = page.name; document.title = page.name + ' · ' + project.name;
    if (viewPicker) {const views=getCanvasViews(project,source);viewPicker.replaceChildren(); for (const [id, title] of [['auto', '自动适应'], ['base', '基础视图'], ...views.map(view => [viewOptionValue(view.id), view.name])]) { const option = element('option'); option.value = id; option.textContent = title; viewPicker.append(option); } viewPicker.value = selectedOptionValue(); viewPicker.hidden = !views.length; }
    const owned = new Set(page.nodes.flatMap(node => node.panel ? node.panel.states.flatMap(state => state.nodeIds) : node.repeater?.templateIds || []));
    try { for (const node of page.nodes) if (!owned.has(node.id)) createNode(node, stage, root); refresh(); activate(null, 'load');activate(null,'windowResize',{}, {...eventData({}),reason:'load'}); } catch (error) { notice(error); }
  }
  for (const page of project.pages) { const option = element('option'); option.value = page.id; option.textContent = page.name; picker.append(option); }
  picker.addEventListener('change', () => { requestedView = undefined; showPage(picker.value); });
  if (viewPicker) viewPicker.addEventListener('change', () => { requestedView = viewPicker.value === 'auto' ? undefined : viewPicker.value === 'base' ? null : viewPicker.value.startsWith('view:')?viewPicker.value.slice(5):viewPicker.value; applyAdaptiveView(); });
  document.getElementById('restart').addEventListener('click', () => { for (const variable of project.variables || []) variables[variable.name] = clone(variable.value); showPage(page.id); });
  window.addEventListener('resize', () => { if(!page)return;caseMenu?.cancel();if(requestedView===undefined){const source=project.pages.find(item=>item.id===page.id);if(selectedView(source)!==activeView)applyAdaptiveView('resize');}layoutPanels();activate(null,'windowResize',{}, {...eventData({}),reason:'resize'}); });
  let previousScroll={x:window.scrollX,y:window.scrollY};
  window.addEventListener('scroll',event=>{const current={x:window.scrollX,y:window.scrollY},data={...eventData(event),scrollDeltaX:current.x-previousScroll.x,scrollDeltaY:current.y-previousScroll.y};previousScroll=current;if(page)activate(null,'windowScroll',event,data);},{passive:true});
  stage.tabIndex = 0;
  for (const type of ['click', 'dblclick', 'contextmenu', 'mousemove', 'mouseenter', 'mouseleave', 'mousedown', 'mouseup', 'change', 'input', 'focus', 'blur']) {
    for(const surface of [stage,pinnedLayer])surface.addEventListener(type, event => { if (page) {if(['mouseenter','mouseleave'].includes(type)&&event.target!==surface)return;if(type==='contextmenu'&&hasEvent(null,type))event.preventDefault();activate(null, type, event, eventData(event));} }, true);
  }
  for(const type of ['keydown','keyup'])document.addEventListener(type,event=>{if(page&&!event.target.closest?.('.viewer-bar,.runtime-case-menu'))activate(null,type,event,eventData(event));},true);
  stage.addEventListener('pointermove', event => { lastPointer = { x: event.clientX - stage.getBoundingClientRect().left, y: event.clientY - stage.getBoundingClientRect().top }; });
  showPage(project.pages[0].id);
}
