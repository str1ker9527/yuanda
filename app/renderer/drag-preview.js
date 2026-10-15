import {makeNode} from '../core/document.mjs';
import {resolveContainerView} from '../core/view-model.mjs';
import {resolveNodeBaseStyle} from '../core/style-model.mjs';
import {getNodeBounds} from '../core/widget-geometry.mjs';
import {createPreviewNode,previewVisibleNodes} from './preview-node-renderer.mjs';

/** Original library-to-canvas pointer gesture. Preview DOM never enters the
 * document model; exactly one revision-checked transaction runs on a valid drop. */
const E=window.YuandaEditor;
const copy=value=>structuredClone(value),round=value=>Math.round(value*100)/100;
const make=(tag,className)=>{const element=document.createElement(tag);element.className=className;return element;};
const contextKey=context=>JSON.stringify([context.projectId,context.targetKind,context.targetId,context.viewId,context.scope]);
let current=null,serial=0,suppressClickUntil=0;

function prepare(item,project){
  let nodes,template,offset={x:0,y:0};
  if(item.libraryItem){
    const own=item.libraryItem.project,page=own.pages[0];
    nodes=resolveContainerView(own,page.id,null).nodes;
    offset={x:Math.min(...page.nodes.map(node=>node.x)),y:Math.min(...page.nodes.map(node=>node.y))};
  }else if(item.componentId){
    if(!project.components.some(component=>component.id===item.componentId))throw new Error('母版已不存在，请重新选择。');
    nodes=resolveContainerView(project,item.componentId,null).nodes;
  }else{
    template=E.makeNode(item.type,{...copy(item.preset||{}),x:0,y:0});
    const node=makeNode(item.type,template);node.style=resolveNodeBaseStyle(project,node);nodes=[node];
  }
  nodes=nodes.map(node=>({...node,x:node.x-offset.x,y:node.y-offset.y}));
  const visible=previewVisibleNodes(nodes),bounds=visible.map(node=>getNodeBounds(node,nodes));
  if(!visible.length)throw new Error('这个条目没有可见元件，不能显示拖入预览。');
  const left=Math.min(...bounds.map(box=>box.left)),top=Math.min(...bounds.map(box=>box.top));
  return {nodes,visible,template,bounds:{left,top,width:Math.max(1,...bounds.map(box=>box.right-left)),height:Math.max(1,...bounds.map(box=>box.bottom-top))}};
}

function live(session){return current===session&&!session.ended;}
function unchanged(session){return E.getState()?.project.id===session.context.projectId&&E.getState()?.revision===session.revision&&contextKey(E.captureContext())===session.contextKey;}
function setStatus(session,reason){session.status.textContent=reason;}
function update(session,event=session.last){
  if(!live(session)||!session.overlay)return;
  if(!unchanged(session)){cancel('画布内容已更新，已取消本次拖入。');return;}
  const viewport=document.querySelector('#canvas-viewport'),rect=viewport?.getBoundingClientRect(),board=document.querySelector('#board');
  const hit=document.elementFromPoint(event.clientX,event.clientY);
  const inside=!!rect&&event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom&&viewport.contains(hit);
  const zoom=E.getZoom(),point=E.point(event),x=round(point.x),y=round(point.y),box=session.preview.bounds;
  const valid=inside&&Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=100000&&Math.abs(y)<=100000&&!!board;
  session.point={x,y};session.valid=valid;session.overlay.dataset.dropValid=String(valid);session.overlay.dataset.zoom=String(zoom);
  const anchor=valid?{x:board.getBoundingClientRect().left+x*zoom,y:board.getBoundingClientRect().top+y*zoom}:{x:event.clientX+14,y:event.clientY+14};
  Object.assign(session.scene.style,{left:`${anchor.x}px`,top:`${anchor.y}px`,transform:`scale(${zoom})`});
  Object.assign(session.bounds.style,{left:`${anchor.x+box.left*zoom}px`,top:`${anchor.y+box.top*zoom}px`,width:`${box.width*zoom}px`,height:`${box.height*zoom}px`});
  const labelX=Math.min(innerWidth-260,Math.max(8,anchor.x+box.left*zoom)),labelY=Math.max(8,Math.min(innerHeight-54,anchor.y+box.top*zoom-48));
  Object.assign(session.label.style,{left:`${labelX}px`,top:`${labelY}px`});
  session.dimensions.textContent=valid?`X ${x}  Y ${y}  ·  ${round(box.width)} × ${round(box.height)}`:`${round(box.width)} × ${round(box.height)} · ${Math.round(zoom*100)}%`;
  setStatus(session,valid?'松开即可放置 · Esc 取消':'拖到画布内放置 · Esc 取消');
}
function activate(session){
  if(!live(session)||!session.ready||session.overlay)return;
  const distance=Math.hypot(session.last.clientX-session.start.x,session.last.clientY-session.start.y);if(distance<5)return;
  if(!unchanged(session)){cancel('画布已变化，请重新拖入。');return;}
  session.preview=prepare(session.item,E.getState().project);
  const overlay=make('div','yuanda-drag-preview');overlay.id='yuanda-drag-preview';overlay.dataset.dragKind=session.item.libraryItem?'library':session.item.componentId?'component':'widget';overlay.dataset.gesture=String(session.id);overlay.setAttribute('aria-hidden','true');
  session.overlay=overlay;session.scene=make('div','yuanda-drag-scene');session.bounds=make('div','yuanda-drag-bounds');session.label=make('div','yuanda-drag-label');
  const name=make('strong','yuanda-drag-name');name.textContent=session.item.label||session.item.libraryItem?.name||'元件';session.dimensions=make('span','yuanda-drag-dimensions');session.status=make('span','yuanda-drag-status');session.label.append(name,session.dimensions,session.status);
  for(const node of session.preview.visible){const element=createPreviewNode(node,session.preview.nodes);element.classList.add('yuanda-drag-node');session.scene.append(element);}
  overlay.append(session.scene,session.bounds,session.label);document.body.append(overlay);document.body.classList.add('yuanda-library-dragging');
  // Capture on a persistent element. A library dialog may close when the user
  // starts dragging; removal of its thumbnail must not lose this gesture.
  document.documentElement.setPointerCapture(session.pointerId);
  session.item.onStart?.();update(session);
}
function cleanup(session){
  session.ended=true;if(current===session)current=null;
  session.overlay?.remove();document.body.classList.remove('yuanda-library-dragging');
  document.removeEventListener('pointermove',session.move,true);document.removeEventListener('pointerup',session.up,true);document.removeEventListener('pointercancel',session.abort,true);document.removeEventListener('lostpointercapture',session.lost,true);
  document.removeEventListener('keydown',session.key,true);document.removeEventListener('yuanda:editorchange',session.change);window.removeEventListener('blur',session.abort);window.removeEventListener('pagehide',session.abort);window.removeEventListener('resize',session.scroll);document.removeEventListener('scroll',session.scroll,true);
  if(document.documentElement.hasPointerCapture(session.pointerId))document.documentElement.releasePointerCapture(session.pointerId);
}
function cancel(message){const session=current;if(!session)return;const moved=!!session.overlay;cleanup(session);if(moved)suppressClickUntil=performance.now()+250;if(message)E.toast(message,'warning');}
async function drop(session,event){
  if(!live(session)||event.pointerId!==session.pointerId)return;
  if(!session.overlay){cleanup(session);return;}
  event.preventDefault();event.stopPropagation();session.last={clientX:event.clientX,clientY:event.clientY};update(session,event);
  if(!live(session))return;const accepted=session.valid&&unchanged(session),point=session.point;suppressClickUntil=performance.now()+250;
  cleanup(session);if(!accepted)return;
  const before=new Set(E.getRawPage().nodes.map(node=>node.id)),target=session.context.targetId;let commands,label;
  if(session.item.libraryItem){commands=[{type:'insertLibraryItem',pageId:target,item:copy(session.item.libraryItem),x:point.x,y:point.y,conflictPolicy:'copy'}];label=`插入库条目：${session.item.libraryItem.name}`;}
  else if(session.item.componentId){commands=[{type:'insertComponent',pageId:target,componentId:session.item.componentId,instanceId:crypto.randomUUID(),x:point.x,y:point.y}];label='插入母版';}
  else{const node={...session.preview.template,x:point.x,y:point.y};commands=[{type:'addNode',pageId:target,node}];label=`添加${session.item.label||'元件'}`;}
  const success=await E.command(commands,label,session.context,{expectedRevision:session.revision});
  if(success&&E.getState().project.id===session.context.projectId&&contextKey(E.captureContext())===session.contextKey){E.select(E.getRawPage().nodes.filter(node=>!before.has(node.id)).map(node=>node.id));document.querySelector('#canvas-viewport')?.focus({preventScroll:true});}
}
function start(event,item){
  if(event.button!==0||!E.getState()||!E.getPage())return false;
  cancel();event.stopPropagation();
  const context=copy(E.captureContext()),session={id:++serial,item:{...item,...(item.libraryItem?{libraryItem:copy(item.libraryItem)}:{})},context,contextKey:contextKey(context),revision:E.getState().revision,pointerId:event.pointerId,start:{x:event.clientX,y:event.clientY},last:{clientX:event.clientX,clientY:event.clientY},ready:false,ended:false};current=session;
  session.move=next=>{if(next.pointerId!==session.pointerId||!live(session))return;session.last={clientX:next.clientX,clientY:next.clientY};try{activate(session);update(session,next);}catch(error){cancel(error.message);}};
  session.up=next=>void drop(session,next).catch(error=>{cancel();E.toast(error.message,'error');});
  session.abort=()=>cancel();session.lost=next=>{if(next.pointerId===session.pointerId)cancel();};
  session.key=next=>{if(next.key==='Escape'){next.preventDefault();next.stopImmediatePropagation();cancel();}};
  session.change=()=>{if(session.ready&&!unchanged(session))cancel('画布内容已更新，已取消本次拖入。');else update(session);};
  session.scroll=()=>update(session);
  document.addEventListener('pointermove',session.move,true);document.addEventListener('pointerup',session.up,true);document.addEventListener('pointercancel',session.abort,true);document.addEventListener('lostpointercapture',session.lost,true);document.addEventListener('keydown',session.key,true);document.addEventListener('yuanda:editorchange',session.change);document.addEventListener('scroll',session.scroll,true);window.addEventListener('blur',session.abort);window.addEventListener('pagehide',session.abort);window.addEventListener('resize',session.scroll);
  void E.flushPendingEdits().then(ok=>{if(!live(session))return;if(!ok||contextKey(E.captureContext())!==session.contextKey){cancel();return;}session.revision=E.getState().revision;session.ready=true;activate(session);update(session);}).catch(error=>{cancel();E.toast(error.message,'error');});
  return true;
}
document.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();suppressClickUntil=0;}},true);
window.YuandaDragPreview=Object.freeze({start,cancel,getState:()=>current?{id:current.id,active:!!current.overlay,ready:current.ready,valid:!!current.valid,point:copy(current.point||null),revision:current.revision,kind:current.item.libraryItem?'library':current.item.componentId?'component':'widget'}:null});
