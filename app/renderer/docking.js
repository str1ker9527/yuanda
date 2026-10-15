'use strict';

// Workspace preference only: move original panel DOM on drop, never clone its content.
(() => {
  const storageKey='yuanda.workspace.layout.v1';
  const names={pages:'页面',overview:'概览',library:'元件库',components:'母版',styles:'样式',interactions:'交互',notes:'注释'};
  const icons={pages:'page',overview:'layers',library:'library',components:'component',styles:'style',interactions:'interaction',notes:'notes'};
  const ids=Object.keys(names),zoneIds=['left-top','left-bottom','right-top','right-bottom'];
  const workspace=document.querySelector('#workspace'),floatHost=document.querySelector('#floating-panels'),marker=document.querySelector('#dock-drop-marker');
  const panels=new Map([...document.querySelectorAll('[data-panel-id]')].map(p=>[p.dataset.panelId,p]));
  const zones=new Map(zoneIds.map(id=>[id,document.querySelector('[data-dock-zone="'+id+'"]')]));
  const tabElements=new Map(),floatElements=new Map();
  const clamp=(v,min,max)=>Math.min(Math.max(v,min),Math.max(min,max)),clone=v=>JSON.parse(JSON.stringify(v));
  let topLayer=10,drag=null,sizing=null,saveTimer=null,suppressClickUntil=0;
  const makeDefault=()=>({version:1,widths:{left:228,right:280},ratios:{left:.48,right:.70},active:{'left-top':'pages','left-bottom':'library','right-top':'styles','right-bottom':'notes'},floatActive:{},
    panels:Object.fromEntries(ids.map((id,i)=>[id,{mode:'dock',zone:i<2?'left-top':i<4?'left-bottom':i<6?'right-top':'right-bottom',hidden:false,order:i,floatGroup:'float-'+id,x:260+i*18,y:50+i*18,width:290,height:360}]))});
  let layout=loadLayout();
  function overlay(className){const el=document.createElement('div');el.className=className;el.hidden=true;workspace.append(el);return el;}
  const targets=overlay('dock-targets'),ghost=overlay('dock-drag-preview'),insertion=overlay('dock-tab-insertion'),status=overlay('dock-drag-status');
  targets.setAttribute('aria-hidden','true');ghost.setAttribute('aria-hidden','true');status.setAttribute('role','status');
  function svg(name){const el=document.createElementNS('http://www.w3.org/2000/svg','svg');el.classList.add('icon');el.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);el.append(use);return el;}
  window.YuandaIcons=Object.freeze({create:svg});
  function loadLayout(){
    const value=makeDefault();
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey));if(saved?.version!==1||!saved.panels)return value;
      for(const id of ids){const item=saved.panels[id];if(!item||!['dock','float'].includes(item.mode)||!zoneIds.includes(item.zone))continue;
        Object.assign(value.panels[id],{mode:item.mode,zone:item.zone,hidden:item.hidden===true});
        for(const key of ['x','y','width','height','order'])if(Number.isFinite(item[key]))value.panels[id][key]=item[key];
        if(typeof item.floatGroup==='string'&&/^float-[a-z0-9-]{1,80}$/.test(item.floatGroup))value.panels[id].floatGroup=item.floatGroup;
      }
      for(const side of ['left','right']){if(Number.isFinite(saved.widths?.[side]))value.widths[side]=clamp(saved.widths[side],180,460);if(Number.isFinite(saved.ratios?.[side]))value.ratios[side]=clamp(saved.ratios[side],.15,.85);}
      for(const zone of zoneIds)if(names[saved.active?.[zone]])value.active[zone]=saved.active[zone];
      for(const [group,id]of Object.entries(saved.floatActive||{}))if(names[id]&&value.panels[id].floatGroup===group)value.floatActive[group]=id;
    }catch{/* Unavailable/damaged preferences cannot prevent opening. */}
    return value;
  }
  function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(storageKey,JSON.stringify(layout));}catch{}},80);}
  function notify(activeId=null){persist();document.dispatchEvent(new CustomEvent('yuanda:layoutchange',{detail:getLayout()}));if(activeId)document.dispatchEvent(new CustomEvent('yuanda:panelactivate',{detail:{id:activeId}}));}
  function rememberFocus(){
    const element=document.activeElement;let start,end,direction;
    try{start=element?.selectionStart;end=element?.selectionEnd;direction=element?.selectionDirection;}catch{}
    return{element,start,end,direction,scroll:[...panels.values()].flatMap(p=>[...p.querySelectorAll('.panel-body')].map(body=>({body,top:body.scrollTop,left:body.scrollLeft})))};
  }
  function restoreFocus(saved){
    if(!saved)return;for(const {body,top,left}of saved.scroll){body.scrollTop=top;body.scrollLeft=left;}
    if(saved.element?.isConnected&&saved.element!==document.body&&saved.element.getClientRects().length){
      saved.element.focus({preventScroll:true});if(typeof saved.start==='number'&&typeof saved.element.setSelectionRange==='function')try{saved.element.setSelectionRange(saved.start,saved.end,saved.direction);}catch{}
    }
  }
  function fitRect(item){item.width=clamp(item.width,230,workspace.clientWidth-12);item.height=clamp(item.height,150,workspace.clientHeight-12);item.x=clamp(item.x,6,workspace.clientWidth-item.width-6);item.y=clamp(item.y,6,workspace.clientHeight-item.height-6);return item;}
  const sorted=list=>list.sort((a,b)=>layout.panels[a].order-layout.panels[b].order);
  const visibleInZone=zone=>sorted(ids.filter(id=>layout.panels[id].mode==='dock'&&layout.panels[id].zone===zone&&!layout.panels[id].hidden));
  const inFloat=(group,includeHidden=false)=>sorted(ids.filter(id=>layout.panels[id].mode==='float'&&layout.panels[id].floatGroup===group&&(includeHidden||!layout.panels[id].hidden)));
  const floatRect=group=>layout.panels[inFloat(group,true)[0]];
  function setFloatRect(group,rect){for(const id of inFloat(group,true))for(const key of ['x','y','width','height'])layout.panels[id][key]=rect[key];}
  function tabsFor(host){let tabs=host.querySelector(':scope > .dock-tabs');if(!tabs){tabs=document.createElement('div');tabs.className='dock-tabs';tabs.setAttribute('role','tablist');host.prepend(tabs);}return tabs;}
  function renderTabs(host,members,active){
    const tabs=tabsFor(host);tabs.hidden=!members.length;
    for(const child of [...tabs.children])if(!members.includes(child.dataset.panelTab))child.remove();
    members.forEach((id,index)=>{
      let tab=tabElements.get(id);
      if(!tab){
        tab=document.createElement('button');tab.type='button';tab.textContent=names[id];tab.dataset.panelTab=id;tab.setAttribute('role','tab');tab.title='查看'+names[id]+'；拖动标签可排序、移入其他组或浮动';
        tab.addEventListener('click',()=>activate(id));tab.addEventListener('pointerdown',e=>startDrag(e,id,false));
        tab.addEventListener('keydown',e=>{
          if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();
          const siblings=[...tab.parentElement.children],current=siblings.indexOf(tab),next=e.key==='Home'?0:e.key==='End'?siblings.length-1:(current+(e.key==='ArrowRight'?1:-1)+siblings.length)%siblings.length;
          activate(siblings[next].dataset.panelTab);siblings[next].focus();
        });tabElements.set(id,tab);
      }
      tab.classList.toggle('active',active===id);tab.setAttribute('aria-selected',String(active===id));tab.tabIndex=active===id?0:-1;
      if(tabs.children[index]!==tab)tabs.insertBefore(tab,tabs.children[index]||null);
    });
  }
  function applyLayout(activeId=null,shouldNotify=true){
    const focus=rememberFocus(),maxCombined=Math.max(360,workspace.clientWidth-330);
    layout.widths.left=clamp(layout.widths.left,180,Math.min(460,maxCombined-180));layout.widths.right=clamp(layout.widths.right,180,Math.min(460,maxCombined-layout.widths.left));
    for(const side of ['left','right']){workspace.style.setProperty('--'+side+'-width',layout.widths[side]+'px');workspace.style.setProperty('--'+side+'-top',layout.ratios[side]*100+'%');}
    for(const zone of zoneIds){const members=visibleInZone(zone),host=zones.get(zone);if(!members.includes(layout.active[zone]))layout.active[zone]=members[0]||null;host.classList.toggle('is-empty',!members.length);renderTabs(host,members,layout.active[zone]);}
    const groups=new Set(ids.filter(id=>layout.panels[id].mode==='float').map(id=>layout.panels[id].floatGroup));
    for(const group of groups){
      let host=floatElements.get(group);
      if(!host){host=document.createElement('section');host.className='dock-floating-group';host.dataset.floatGroup=group;host.setAttribute('aria-label','浮动面板组（主窗口内）');floatHost.append(host);floatElements.set(group,host);}
      const members=inFloat(group);if(!members.includes(layout.floatActive[group]))layout.floatActive[group]=members[0]||null;
      host.hidden=!members.length;host.classList.toggle('has-tabs',members.length>1);renderTabs(host,members,layout.floatActive[group]);tabsFor(host).hidden=members.length<2;
      const rect=fitRect(floatRect(group));setFloatRect(group,rect);place(host,rect);
    }
    for(const [id,panel]of panels){
      const item=layout.panels[id],floating=item.mode==='float',parent=floating?floatElements.get(item.floatGroup):zones.get(item.zone);
      // Chromium's atomic move preserves focused controls without firing change
      // merely because the panel changes parents. Keep a fallback for older hosts.
      if(panel.parentElement!==parent){if(typeof parent.moveBefore==='function')parent.moveBefore(panel,null);else parent.append(panel);}panel.classList.toggle('is-floating',floating);
      panel.hidden=item.hidden||(floating?layout.floatActive[item.floatGroup]!==id:layout.active[item.zone]!==id);panel.dataset.dockMode=item.mode;
      for(const property of ['left','top','width','height','zIndex'])panel.style[property]='';
      const control=panel.querySelector('[data-panel-float]');if(control){control.title=floating?'停靠到上次位置':'浮动面板（主窗口内）';control.setAttribute('aria-label',control.title);}
      panel.querySelector('[data-panel-handle]').title=floating&&inFloat(item.floatGroup).length>1?'拖动整个浮动组；拖动标签可单独移动面板':'拖动面板；松开停靠，Esc 取消';
    }
    for(const [group,host]of floatElements)if(!groups.has(group)){host.remove();floatElements.delete(group);delete layout.floatActive[group];}
    renderMenu();if(shouldNotify)notify(activeId);restoreFocus(focus);
  }
  function activate(id){if(!panels.has(id))return;const item=layout.panels[id];item.hidden=false;if(item.mode==='dock')layout.active[item.zone]=id;else{layout.floatActive[item.floatGroup]=id;floatElements.get(item.floatGroup)?.style.setProperty('z-index',String(++topLayer));}applyLayout(id);}
  function show(id){activate(id);}
  function hide(id){if(panels.has(id)){layout.panels[id].hidden=true;applyLayout();}}
  function orderMembers(members){members.forEach((id,index)=>{layout.panels[id].order=index;});}
  function dockMembers(members,zone,index=null){const remaining=visibleInZone(zone).filter(id=>!members.includes(id));remaining.splice(index===null?remaining.length:index,0,...members);for(const id of members)Object.assign(layout.panels[id],{mode:'dock',zone,hidden:false});orderMembers(remaining);layout.active[zone]=members[0];}
  function dock(id,zone){if(panels.has(id)&&zoneIds.includes(zone)){dockMembers([id],zone);applyLayout(id);}}
  function floatMembers(members,rect,group=null,index=null){
    group||='float-'+members[0]+'-'+Date.now().toString(36);const remaining=inFloat(group).filter(id=>!members.includes(id));remaining.splice(index===null?remaining.length:index,0,...members);
    for(const id of members)Object.assign(layout.panels[id],{mode:'float',floatGroup:group,hidden:false});orderMembers(remaining);setFloatRect(group,fitRect({...rect}));layout.floatActive[group]=members[0];return group;
  }
  function float(id,rect={}){if(!panels.has(id))return;const next={...layout.panels[id]};for(const key of ['x','y','width','height'])if(Number.isFinite(rect[key]))next[key]=rect[key];const group=floatMembers([id],next);applyLayout(id);floatElements.get(group).style.zIndex=String(++topLayer);}
  function reset(){cancelGesture();layout=makeDefault();applyLayout('styles');}
  function getLayout(){return clone(layout);}
  function renderMenu(){
    const menu=document.querySelector('#panels-menu');if(!menu.childElementCount){
      for(const id of ids){const item=document.createElement('button');item.type='button';item.className='panel-menu-item';item.dataset.panelMenu=id;item.setAttribute('role','menuitemcheckbox');item.append(svg(icons[id]),document.createTextNode(names[id]));const check=document.createElement('i');check.className='panel-check';check.setAttribute('aria-hidden','true');item.append(check);item.addEventListener('click',()=>{show(id);closeMenu();});menu.append(item);}
      const divider=document.createElement('div');divider.className='panel-menu-divider';menu.append(divider);const button=document.createElement('button');button.type='button';button.id='reset-workspace';button.textContent='重置面板布局';button.addEventListener('click',()=>{reset();closeMenu();});menu.append(button);
    }
    for(const id of ids)menu.querySelector('[data-panel-menu="'+id+'"]').setAttribute('aria-checked',String(!layout.panels[id].hidden));
  }
  function closeMenu(){document.querySelector('#panels-menu').hidden=true;document.querySelector('#panels-toggle').setAttribute('aria-expanded','false');}
  const inside=(r,x,y)=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;
  function localRect(r){const outer=workspace.getBoundingClientRect();return{x:r.left-outer.left,y:r.top-outer.top,width:r.width,height:r.height};}
  function place(element,rect){Object.assign(element.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});}
  function showTargets(){
    targets.replaceChildren();targets.hidden=false;
    for(const [zone,host]of zones){const r=localRect(host.getBoundingClientRect()),small=r.height<110;
      for(const kind of small?['merge']:['top','merge','bottom']){const hint=document.createElement('div');hint.className='dock-target';hint.dataset.dockTarget=zone+':'+kind;hint.textContent=kind==='merge'?'合并':kind==='top'?'上方':'下方';
        const y=small?r.y+r.height/2-14:r.y+r.height/2-16+(kind==='top'?-40:kind==='bottom'?40:0);place(hint,{x:r.x+r.width/2-27,y,width:54,height:32});targets.append(hint);}
    }
  }
  function insertionIndex(host,members,x){const siblings=[...host.querySelectorAll(':scope > .dock-tabs > [data-panel-tab]')].filter(tab=>!members.includes(tab.dataset.panelTab));const index=siblings.findIndex(tab=>x<tab.getBoundingClientRect().left+tab.getBoundingClientRect().width/2);return{index:index<0?siblings.length:index,siblings};}
  function targetAt(x,y){
    const moving=drag.members;
    for(const [group,host]of [...floatElements].sort((a,b)=>Number(b[1].style.zIndex)-Number(a[1].style.zIndex))){
      if(host.hidden||inFloat(group).every(id=>moving.includes(id)))continue;
      if(inside(host.getBoundingClientRect(),x,y)){const tabs=tabsFor(host),atTabs=!tabs.hidden&&inside(tabs.getBoundingClientRect(),x,y);return{kind:'float-merge',group,index:atTabs?insertionIndex(host,moving,x).index:null,host,tabs:atTabs};}
    }
    for(const [zone,host]of zones){
      const r=host.getBoundingClientRect();if(!inside(r,x,y))continue;const tabs=tabsFor(host);
      if(!tabs.hidden&&inside(tabs.getBoundingClientRect(),x,y))return{kind:'merge',zone,index:insertionIndex(host,moving,x).index,host,tabs:true};
      for(const hint of targets.children)if(hint.dataset.dockTarget.startsWith(zone+':')&&inside(hint.getBoundingClientRect(),x,y)){const kind=hint.dataset.dockTarget.split(':')[1];return{kind:kind==='merge'?'merge':'split',edge:kind,zone,host};}
      if(r.height>110&&(y<r.top+18||y>r.bottom-18))return{kind:'split',edge:y<r.top+18?'top':'bottom',zone,host};
      return{kind:'merge',zone,host};
    }
    return null;
  }
  function preview(target){
    marker.hidden=!target;insertion.hidden=true;for(const hint of targets.children)hint.classList.toggle('is-active',!!target&&hint.dataset.dockTarget===target.zone+':'+(target.kind==='split'?target.edge:'merge'));
    if(!target){status.textContent='松开：在主窗口内浮动 · Esc 取消';return;}
    let rect=localRect(target.host.getBoundingClientRect()),label=target.kind==='float-merge'?'合并到浮动组':'合并为标签';
    if(target.kind==='split'){const side=target.zone.split('-')[0],rail=localRect(document.querySelector('#dock-'+side).getBoundingClientRect());rect={...rail,height:(rail.height-5)/2,y:rail.y+(target.edge==='bottom'?(rail.height+5)/2:0)};label=target.edge==='top'?'上方独立停靠':'下方独立停靠';}
    place(marker,{...rect,x:rect.x+3,y:rect.y+3,width:rect.width-6,height:rect.height-6});marker.textContent=label;marker.dataset.dropKind=target.kind;
    if(target.tabs){const {siblings}=insertionIndex(target.host,drag.members,-1),next=siblings[target.index],previous=siblings[target.index-1],tabs=localRect(tabsFor(target.host).getBoundingClientRect());
      const x=next?localRect(next.getBoundingClientRect()).x-2:previous?localRect(previous.getBoundingClientRect()).x+previous.getBoundingClientRect().width+2:tabs.x+10;place(insertion,{x,y:tabs.y+4,width:3,height:tabs.height-8});insertion.hidden=false;label='按指示位置插入标签';}
    status.textContent='松开：'+label+' · Esc 取消';
  }
  function startDrag(event,id,wholeGroup){
    if(event.button!==0||event.target.closest('.panel-controls')||drag||sizing)return;
    const item=layout.panels[id],host=item.mode==='float'?floatElements.get(item.floatGroup):zones.get(item.zone),rect=localRect(host.getBoundingClientRect()),outer=workspace.getBoundingClientRect();
    drag={id,members:wholeGroup&&item.mode==='float'?inFloat(item.floatGroup):[id],pointerId:event.pointerId,x:event.clientX,y:event.clientY,started:false,source:event.currentTarget,
      rect:fitRect({...rect,width:Math.max(250,rect.width),height:Math.max(220,rect.height)}),offsetX:event.clientX-outer.left-rect.x,offsetY:event.clientY-outer.top-rect.y,
      snapshot:clone(layout),focus:rememberFocus(),target:null,wasActive:item.mode==='float'?layout.floatActive[item.floatGroup]===id:layout.active[item.zone]===id};
    event.preventDefault();workspace.setPointerCapture(event.pointerId);
  }
  function move(event){
    if(sizing){if(sizing.pointerId===event.pointerId)resize(event);return;}if(!drag||drag.pointerId!==event.pointerId)return;
    if(!drag.started&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;event.preventDefault();
    if(!drag.started){drag.started=true;document.body.classList.add('is-docking');showTargets();ghost.hidden=false;status.hidden=false;ghost.textContent=drag.members.map(id=>names[id]).join(' · ');}
    const outer=workspace.getBoundingClientRect();drag.rect.x=event.clientX-outer.left-drag.offsetX;drag.rect.y=event.clientY-outer.top-drag.offsetY;fitRect(drag.rect);place(ghost,drag.rect);drag.target=targetAt(event.clientX,event.clientY);preview(drag.target);
  }
  function clearGesture(){const pointerId=drag?.pointerId??sizing?.pointerId;drag=null;sizing=null;if(pointerId!==undefined&&workspace.hasPointerCapture(pointerId))workspace.releasePointerCapture(pointerId);for(const el of [marker,targets,ghost,insertion,status])el.hidden=true;document.body.classList.remove('is-docking');document.body.style.cursor='';}
  function cancelGesture(){const ending=drag||sizing;if(!ending)return;if(sizing){layout=ending.snapshot;applyLayout(null,false);}clearGesture();suppressClickUntil=Date.now()+150;restoreFocus(ending.focus);}
  function finish(event){
    if(sizing&&sizing.pointerId===event.pointerId){const focus=sizing.focus;clearGesture();notify();restoreFocus(focus);return;}
    if(!drag||drag.pointerId!==event.pointerId)return;const ending=drag;clearGesture();if(!ending.started){if(ending.source.dataset.panelTab)activate(ending.id);return;}
    suppressClickUntil=Date.now()+150;const target=ending.target;
    if(target?.kind==='split'){const side=target.zone.split('-')[0],destination=side+'-'+target.edge,opposite=side+'-'+(target.edge==='top'?'bottom':'top'),displaced=visibleInZone(destination).filter(id=>!ending.members.includes(id));if(displaced.length)dockMembers(displaced,opposite);dockMembers(ending.members,destination);layout.ratios[side]=.5;}
    else if(target?.kind==='merge')dockMembers(ending.members,target.zone,target.index??null);
    else if(target?.kind==='float-merge')floatMembers(ending.members,floatRect(target.group),target.group,target.index);
    else floatMembers(ending.members,ending.rect);
    // An active pane move must not trigger inspector re-render and erase a draft.
    applyLayout(ending.wasActive?null:ending.id);restoreFocus(ending.focus);if(layout.panels[ending.id].mode==='float')floatElements.get(layout.panels[ending.id].floatGroup).style.zIndex=String(++topLayer);
  }
  function startResize(event,kind,side,id=null){
    if(event.button!==0||drag||sizing)return;event.preventDefault();event.stopPropagation();const group=id?layout.panels[id].floatGroup:null;
    sizing={kind,side,id,group,pointerId:event.pointerId,x:event.clientX,y:event.clientY,snapshot:clone(layout),focus:rememberFocus(),width:id?floatRect(group).width:layout.widths[side],height:id?floatRect(group).height:0,ratio:layout.ratios[side],railHeight:side?document.querySelector('#dock-'+side).clientHeight:0};
    document.body.style.cursor=kind==='float'?'nwse-resize':kind==='rail'?'col-resize':'row-resize';workspace.setPointerCapture(event.pointerId);
  }
  function resize(event){
    const item=sizing;
    if(item.kind==='float'){const rect={...floatRect(item.group)};rect.width=clamp(item.width+event.clientX-item.x,230,workspace.clientWidth-rect.x-6);rect.height=clamp(item.height+event.clientY-item.y,150,workspace.clientHeight-rect.y-6);setFloatRect(item.group,rect);place(floatElements.get(item.group),rect);return;}
    if(item.kind==='rail')layout.widths[item.side]=clamp(item.width+(event.clientX-item.x)*(item.side==='left'?1:-1),180,460);else layout.ratios[item.side]=clamp(item.ratio+(event.clientY-item.y)/item.railHeight,.15,.85);applyLayout(null,false);
  }
  for(const [id,panel]of panels){
    const controls=panel.querySelector('.panel-controls');
    for(const [icon,label,attribute,callback]of [['float','浮动面板（主窗口内）','panelFloat',()=>layout.panels[id].mode==='float'?dock(id,layout.panels[id].zone):float(id)],['close','隐藏面板','panelHide',()=>hide(id)]]){const b=document.createElement('button');b.type='button';b.className='small-icon';b.title=label;b.setAttribute('aria-label',label);b.dataset[attribute]=id;b.append(svg(icon));b.addEventListener('click',callback);controls.append(b);}
    const handle=document.createElement('div');handle.className='panel-resize-handle';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-label','调整'+names[id]+'面板大小');
    handle.addEventListener('pointerdown',e=>{if(layout.panels[id].mode==='float')startResize(e,'float',null,id);});
    handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||layout.panels[id].mode!=='float')return;e.preventDefault();e.stopPropagation();const group=layout.panels[id].floatGroup,rect={...floatRect(group)};rect.width+=e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0;rect.height+=e.key==='ArrowDown'?10:e.key==='ArrowUp'?-10:0;setFloatRect(group,fitRect(rect));applyLayout();});panel.append(handle);
    panel.querySelector('[data-panel-handle]').addEventListener('pointerdown',e=>startDrag(e,id,true));panel.addEventListener('pointerdown',()=>{if(layout.panels[id].mode==='float')floatElements.get(layout.panels[id].floatGroup).style.zIndex=String(++topLayer);});
  }
  for(const handle of document.querySelectorAll('[data-rail-resizer],[data-splitter]')){
    const kind=handle.dataset.railResizer?'rail':'split',side=handle.dataset.railResizer||handle.dataset.splitter;handle.addEventListener('pointerdown',e=>startResize(e,kind,side));
    handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const amount=['ArrowRight','ArrowDown'].includes(e.key)?1:-1;if(kind==='rail')layout.widths[side]=clamp(layout.widths[side]+amount*(side==='right'?-10:10),180,460);else layout.ratios[side]=clamp(layout.ratios[side]+amount*.025,.15,.85);applyLayout();});
  }
  document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',cancelGesture);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(drag||sizing)){e.preventDefault();e.stopImmediatePropagation();cancelGesture();}},true);
  document.addEventListener('click',e=>{if(Date.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  window.addEventListener('blur',cancelGesture);
  document.querySelector('#panels-toggle').addEventListener('click',()=>{const menu=document.querySelector('#panels-menu'),open=menu.hidden;menu.hidden=!open;document.querySelector('#panels-toggle').setAttribute('aria-expanded',String(open));if(open)menu.querySelector('button')?.focus();});
  document.addEventListener('click',e=>{if(!e.target.closest('.panel-menu-wrapper'))closeMenu();});
  document.querySelector('#panels-menu').addEventListener('keydown',e=>{e.stopPropagation();const buttons=[...document.querySelectorAll('#panels-menu button')],index=buttons.indexOf(document.activeElement);if(e.key==='Escape'){closeMenu();document.querySelector('#panels-toggle').focus();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
  window.addEventListener('resize',()=>{cancelGesture();applyLayout(null,false);});window.addEventListener('beforeunload',()=>{try{localStorage.setItem(storageKey,JSON.stringify(sizing?.snapshot||layout));}catch{}});
  window.YuandaDock=Object.freeze({show,hide,activate,dock,float,reset,getLayout});applyLayout(null,false);
})();
