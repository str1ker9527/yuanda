/* Original desktop menu shell. Every document action uses the shared command engine. */
import {isHierarchyLocked,isGroupAncestorLocked,structuralNodeIds,groupAncestors} from '../core/hierarchy-model.mjs';
const E=window.YuandaEditor,$=s=>document.querySelector(s);
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
const menuNames=[['file','文件','F'],['edit','编辑','E'],['view','视图','V'],['insert','插入','I'],['arrange','排列','A'],['project','项目','P'],['publish','发布','U'],['help','帮助','H']];
const panelNames={pages:'页面',overview:'大纲',library:'元件库',components:'母版',styles:'样式',interactions:'交互',notes:'注释'};
let menus=[],activeMenu=null,opener=null,stamp=null,menuContext=null;
const selected=()=>E.getNodes(),has=()=>selected().length>0;
const editable=()=>has()&&selected().every(n=>!isHierarchyLocked(E.getPage(),n.id));
const visibilityEditable=()=>editable()&&!E.getPage().groups.some(g=>g.componentId&&g.nodeIds.some(id=>E.getSelection().nodeIds.includes(id)));
const item=(id,label,run,key='',enabled=true)=>({id,label,run,key,enabled});
const sep=()=>({separator:true});
const submenu=(id,label,children,enabled=true)=>({id,label,children,enabled});
const toggle=(key,label)=>({...item(`toggle-${key}`,label,()=>window.YuandaWorkspace.toggle(key)),checked:!!window.YuandaWorkspace?.preferences()[key]});
const signature=()=>JSON.stringify([E.getState()?.project.id,E.getState()?.revision,E.captureContext()]);
function batch(commands,label){return E.command(commands,label,E.captureContext(),{expectedRevision:E.getState().revision});}
function changeLayers(direction){return E.layer(direction>0?'forward':'backward');}
function lockSelectionPlan(page,ids,items,locked){
  const chosen=new Set(ids),commands=[],covered=new Set(structuralNodeIds(page,ids));
  const fail=message=>({commands:[],message});
  if(locked){
    if(ids.some(id=>isHierarchyLocked(page,id)))return fail('请先解除所选元件及所属组、容器的锁定。');
    const groups=items.filter(item=>item.kind==='group').map(item=>page.groups.find(group=>group.id===item.id)).filter(Boolean),members=new Set(groups.flatMap(group=>structuralNodeIds(page,group.nodeIds)));
    if(page.groups.some(group=>group.componentId&&group.nodeIds.some(id=>chosen.has(id))&&!group.nodeIds.every(id=>members.has(id))))return fail('请先选中完整母版实例，再锁定；也可以在大纲中选择该母版。');
    for(const group of groups)commands.push({type:'lockGroup',pageId:page.id,groupId:group.id,locked:true});
    for(const node of page.nodes)if(chosen.has(node.id)&&!members.has(node.id))commands.push({type:'updateNode',pageId:page.id,nodeId:node.id,patch:{locked:true}});
  }else{
    const simulated={...page,nodes:page.nodes.map(node=>({...node})),groups:page.groups.map(group=>({...group}))};
    const pending=[...simulated.groups.filter(group=>group.locked&&group.nodeIds.length&&group.nodeIds.every(id=>covered.has(id))).sort((a,b)=>groupAncestors(page,a.id).length-groupAncestors(page,b.id).length).map(group=>({kind:'group',id:group.id})),...simulated.nodes.filter(node=>node.locked&&chosen.has(node.id)).map(node=>({kind:'node',id:node.id}))];
    // A locked group and a locked container may be ancestors of each other.
    // Unlock only chosen objects, in dependency order, without touching siblings.
    while(pending.length){let progressed=false;for(let i=0;i<pending.length;){const item=pending[i],object=(item.kind==='group'?simulated.groups:simulated.nodes).find(value=>value.id===item.id),blocked=item.kind==='group'?isGroupAncestorLocked(simulated,object):isHierarchyLocked(simulated,item.id,true);if(blocked){i++;continue;}object.locked=false;commands.push(item.kind==='group'?{type:'lockGroup',pageId:page.id,groupId:item.id,locked:false}:{type:'updateNode',pageId:page.id,nodeId:item.id,patch:{locked:false}});pending.splice(i,1);progressed=true;}if(!progressed)return fail('所选内容的外层组或容器仍锁定。请在大纲中先选择并解锁外层对象。');}
    if(ids.some(id=>isHierarchyLocked(simulated,id)))return fail('所选内容的外层组或容器仍锁定。请在大纲中先选择并解锁外层对象。');
  }
  return {commands,message:null};
}
function setLocked(locked){
  const ids=E.getSelection().nodeIds,items=window.YuandaOutline?.selectedItems()||ids.map(id=>({kind:'node',id})),plan=lockSelectionPlan(E.getPage(),ids,items,locked);
  if(plan.message){E.toast(plan.message,'warning');return false;}
  return batch(plan.commands,locked?'锁定元件':'解除锁定');
}
function visibility(visible){return batch(selected().map(n=>({type:'updateNode',pageId:E.getPage().id,nodeId:n.id,patch:{visible}})),visible?'显示元件':'隐藏元件');}
function alignmentItems(){return [['left','左对齐'],['center','水平居中'],['right','右对齐'],['top','顶对齐'],['middle','垂直居中'],['bottom','底对齐']].map(([id,label])=>item(`align-${id}`,label,()=>E.align(id),'',editable()&&E.arrangementCount()>=2));}
function arrangement(){return [
  item('front','置于顶层',()=>E.reorder(true),'',editable()),item('forward','上移一层',()=>changeLayers(1),'',editable()),
  item('backward','下移一层',()=>changeLayers(-1),'',editable()),item('back','置于底层',()=>E.reorder(false),'',editable()),sep(),
  submenu('align','对齐（以第一个选中为准）',alignmentItems(),editable()&&E.arrangementCount()>=2),
  item('distribute-x','水平分布',()=>window.YuandaTools.distribute('x'),'',editable()&&E.arrangementCount()>=3),
  item('distribute-y','垂直分布',()=>window.YuandaTools.distribute('y'),'',editable()&&E.arrangementCount()>=3),sep(),
  item('group','组合',()=>window.YuandaTools.groupSelection(),'Ctrl+G',editable()&&E.arrangementCount()>=2),
  item('ungroup','取消组合 / 解除母版关联',()=>window.YuandaTools.ungroupSelection(),'Ctrl+Shift+G',editable()&&!!window.YuandaOutline?.selectedItems().some(item=>item.kind==='group')),sep(),
  item('lock','锁定',()=>setLocked(true),'',editable()),item('unlock','解除锁定',()=>setLocked(false),'',has()&&!editable())];}
function clipboardItems(){return [item('cut','剪切',()=>E.cut(),'Ctrl+X',editable()),item('copy','复制',()=>E.copy(),'Ctrl+C',has()),item('paste','粘贴',()=>E.paste(),'Ctrl+V'),item('duplicate','复制副本',()=>E.duplicate(),'Ctrl+D',has()),item('delete','删除',()=>E.remove(),'Delete',editable())];}
function guideItems(){const W=window.YuandaWorkspace,realPage=E.getEditingTarget().kind==='page',local=realPage?'本页':'本母版',unlocked=!W?.preferences().lockGuides;return [toggle('guides','显示参考线'),toggle('lockGuides','锁定参考线'),{...item('guide-scope-page',`操作${local}参考线`,()=>W.setPreferences({guideScope:'page'})),checked:W.activeGuideScope()==='page'},{...item('guide-scope-project','操作整个项目参考线',()=>W.setPreferences({guideScope:'project'}),'',realPage),checked:W.activeGuideScope()==='project'},item('new-guide',`添加${local}参考线…`,()=>W.guideDialog({scope:'page'}),'',unlocked),item('new-project-guide','添加整个项目参考线…',()=>W.guideDialog({scope:'project'}),'',realPage&&unlocked),item('guide-settings','参考线设置…',()=>W.dialog('guides')),item('clear-guides',`清除${local}参考线`,()=>W.clearGuides('page'),'',unlocked),item('clear-project-guides','清除整个项目参考线',()=>W.clearGuides('project'),'',realPage&&unlocked)];}
function gridItems(){return [toggle('grid','显示网格'),toggle('snapGrid','吸附到网格'),item('grid-settings','网格设置…',()=>window.YuandaWorkspace.dialog('grid'))];}
function insertItems(){return [['rectangle','矩形'],['ellipse','椭圆'],['text','文字'],['button','按钮'],['input','输入框'],['textarea','多行文本框'],['checkbox','复选框'],['radio','单选按钮'],['select','下拉列表'],['line','线段'],['table','表格'],['dynamicPanel','动态面板'],['repeater','数据列表']].map(([type,name])=>item(`insert-${type}`,name,()=>E.insert(type,menuContext?.point||{})));}
function menuItems(name){
  switch(name){
    case 'file':return [item('new','新建项目',()=>E.invoke('newProject'),'Ctrl+N'),item('open','打开原搭工程…',()=>E.invoke('openProject'),'Ctrl+O'),sep(),item('save','保存',()=>E.invoke('saveProject'),'Ctrl+S'),item('save-as','另存为…',()=>E.invoke('saveProjectAs'),'Ctrl+Shift+S'),sep(),item('export-rp','导出 Axure .rp…',()=>E.exportFile('exportRp')),item('export-html','导出可交互 HTML…',()=>E.exportFile('exportHtml'))];
    case 'edit':return [item('undo','撤销',()=>E.invoke('undo'),'Ctrl+Z',E.getState()?.canUndo),item('redo','重做',()=>E.invoke('redo'),'Ctrl+Shift+Z',E.getState()?.canRedo),sep(),...clipboardItems(),sep(),item('select-all','全选',()=>E.select(E.getPage().nodes.map(n=>n.id)),'Ctrl+A'),item('deselect','取消选择',()=>E.select([]),'Esc',has())];
    case 'view':return [toggle('rulers','显示标尺'),submenu('grid','网格',gridItems()),submenu('guides','参考线',guideItems()),submenu('snapping','吸附',[toggle('snapping','启用吸附'),toggle('snapGrid','吸附到网格'),toggle('snapGuides','吸附到参考线'),toggle('snapWidgets','吸附到元件'),item('snap-settings','吸附设置…',()=>window.YuandaWorkspace.dialog('snap'))]),sep(),
      item('zoom-100','实际大小 · 100%',()=>E.setZoom(1)),item('zoom-fit','适应窗口',()=>E.fitPage()),item('zoom-in','放大',()=>E.setZoom(E.getZoom()+.1),'Ctrl++'),item('zoom-out','缩小',()=>E.setZoom(E.getZoom()-.1),'Ctrl+-'),sep(),
      submenu('panels','功能面板',Object.entries(panelNames).map(([id,label])=>{const shown=!window.YuandaDock.getLayout().panels[id]?.hidden;return {...item(`panel-${id}`,label,()=>shown?window.YuandaDock.hide(id):window.YuandaDock.show(id)),checked:shown};})),
      item('toolbar-settings','工具栏与工作区设置…',()=>window.YuandaNavigation.settings()),item('reset-panels','恢复默认面板布局',()=>window.YuandaDock.reset())];
    case 'insert':return [...insertItems(),sep(),item('insert-image','导入图片…',()=>E.importImage()),item('local-library','管理本地元件库…',()=>window.YuandaLibrary.open())];
    case 'arrange':return arrangement();
    case 'project':return [item('add-page','添加页面',()=>$('#add-page').click()),item('add-folder','添加文件夹',()=>window.YuandaNavigation.addFolder()),item('gallery','页面与母版总览',()=>window.YuandaNavigation.showGallery()),sep(),item('variables','全局变量…',()=>window.YuandaAdvanced.manageVariables()),item('views','自适应视图…',()=>window.YuandaAdvanced.manageViews()),item('shared-styles','共享样式…',()=>window.YuandaStyle.manageShared()),item('default-styles','默认元件样式…',()=>window.YuandaStyle.manageDefaults()),sep(),item('agent','Agent 工作台',()=>$('#agent-toggle').click())];
    case 'publish':return [item('preview','预览当前项目',()=>E.exportFile('preview'),'F5'),item('export-html','导出可交互 HTML…',()=>E.exportFile('exportHtml')),item('export-rp','导出 Axure .rp…',()=>E.exportFile('exportRp'))];
    case 'help':return [item('quick-help','快速上手',()=>$('#help-button').click()),item('workspace-help','工作区操作说明',()=>E.showDialog('工作区操作','从元件库按住拖到画布，可看到实际元件轮廓。\n右键画布或元件，可复制、组合、排列、锁定。\n从标尺拖出参考线，双击参考线可精确设置位置。\n拖动面板标签，在蓝色停靠预览上松手。拖动时按 Esc 取消。\n菜单“视图”中可以设置网格、吸附及恢复默认面板布局。')),item('about','关于原搭',()=>E.showDialog('原搭',`版本 ${E.getState()?.appVersion||'开发版'}\n原创桌面原型编辑器 · 本地文件与 Agent 共用编辑能力。\nAxure 兼容功能仍在逐项扩充。`))];
    default:return [];
  }
}
function closeMenus(restore=false){for(const m of menus)m.remove();menus=[];activeMenu=null;stamp=null;for(const b of bar.children)b.setAttribute('aria-expanded','false');if(restore)opener?.focus();}
function focusFirst(menu,last=false){const all=[...menu.querySelectorAll(':scope > button:not(:disabled)')];(last?all.at(-1):all[0])?.focus();}
function renderMenu(items,x,y,depth=0,anchor=null){
  while(menus.length>depth)menus.pop().remove();
  const menu=el('div','desktop-menu');menu.setAttribute('role','menu');menu.dataset.depth=depth;menu.style.visibility='hidden';document.body.append(menu);menus.push(menu);
  for(const entry of items){if(entry.separator){const line=el('div','desktop-menu-separator');line.setAttribute('role','separator');menu.append(line);continue;}
    const row=el('button','desktop-menu-item');row.type='button';row.dataset.menuAction=entry.id;row.disabled=entry.enabled===false;row.setAttribute('role',entry.checked===undefined?'menuitem':'menuitemcheckbox');
    if(entry.checked!==undefined)row.setAttribute('aria-checked',String(entry.checked));row.append(el('span','desktop-menu-check',entry.checked?'✓':''),el('span','desktop-menu-label',entry.label),el('span','desktop-menu-key',entry.children?'›':entry.key||''));
    const expand=()=>{const r=row.getBoundingClientRect();renderMenu(entry.children,r.right-3,r.top,depth+1,row);row.setAttribute('aria-expanded','true');};
    if(entry.children){row.setAttribute('aria-haspopup','menu');row.setAttribute('aria-expanded','false');row.addEventListener('click',()=>{expand();focusFirst(menus.at(-1));});}
    else row.addEventListener('click',()=>{if(signature()!==stamp){closeMenus();return;}const point=menuContext?.point;closeMenus();menuContext=point?{point}:null;Promise.resolve().then(entry.run).catch(error=>E.toast(error.message,'error'));});
    row.addEventListener('pointerenter',()=>{while(menus.length>depth+1)menus.pop().remove();for(const sibling of menu.children)sibling.setAttribute?.('aria-expanded','false');if(entry.children&&!row.disabled)expand();});
    menu.append(row);
  }
  const r=menu.getBoundingClientRect();let left=x;if(x+r.width>innerWidth-6)left=anchor?anchor.getBoundingClientRect().left-r.width+3:innerWidth-r.width-6;
  menu.style.left=`${Math.max(6,left)}px`;menu.style.top=`${Math.max(6,Math.min(y,innerHeight-r.height-6))}px`;menu.style.visibility='visible';return menu;
}
function openTop(name,focus=false){const button=$(`[data-desktop-menu="${name}"]`);closeMenus();opener=button;activeMenu=name;stamp=signature();menuContext=null;button.setAttribute('aria-expanded','true');const r=button.getBoundingClientRect();renderMenu(menuItems(name),r.left,r.bottom);if(focus)focusFirst(menus[0]);}
const bar=el('nav','desktop-menubar');bar.id='desktop-menubar';bar.setAttribute('aria-label','主菜单');bar.setAttribute('role','menubar');
for(const [id,label,access] of menuNames){const b=el('button','desktop-menubar-button',`${label}(${access})`);b.dataset.desktopMenu=id;b.setAttribute('role','menuitem');b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');b.addEventListener('click',()=>activeMenu===id?closeMenus():openTop(id,true));b.addEventListener('pointerenter',()=>{if(activeMenu&&activeMenu!==id)openTop(id);});bar.append(b);}
$('.topbar').after(bar);
const quick=el('div','desktop-quick-actions');quick.setAttribute('aria-label','快速访问');
for(const id of ['new-project','open-project','save-project','undo','redo'])quick.append($(`#${id}`));$('.brand').after(quick);
const oldGroup=$('.toolbar > .toolgroup');if(oldGroup&&!oldGroup.children.length){oldGroup.nextElementSibling?.classList.contains('toolbar-divider')&&oldGroup.nextElementSibling.remove();oldGroup.remove();}
for(const [id,label,paths]of [['new-project','新建项目 Ctrl+N','M5 3h9l5 5v13H5zM14 3v5h5M9 14h6M12 11v6'],['open-project','打开工程 Ctrl+O','M3 7V4h6l3 3h9v3M3 7h18l-3 13H3z'],['save-project','保存 Ctrl+S','M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8']]){
  const b=$(`#${id}`);b.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths);svg.append(p);b.append(svg);b.title=label;b.setAttribute('aria-label',label);
}
function contextMenu(event){
  if(!E.getState()||event.target.closest('input,textarea,select,[contenteditable="true"],dialog'))return;
  const guide=window.YuandaWorkspace?.guideAtElement(event.target),node=event.target.closest('.design-node[data-node-id]'),canvas=event.target.closest('#canvas-viewport'),toolbar=event.target.closest('.toolbar');
  if(!guide&&!canvas&&!toolbar)return;
  event.preventDefault();closeMenus();let entries;
  if(guide){const locked=window.YuandaWorkspace.preferences().lockGuides,label=guide.scope==='project'?'项目全局':'本画布';entries=[item('edit-guide',`设置${label}参考线位置…`,()=>window.YuandaWorkspace.editGuide(guide.axis,guide.position,guide.scope),'',!locked),item('delete-guide',`删除${label}参考线`,()=>window.YuandaWorkspace.deleteGuide(guide.axis,guide.position,guide.scope),'Delete',!locked),sep(),...guideItems()];}
  else if(toolbar)entries=[item('toolbar-settings','工具栏与工作区设置…',()=>window.YuandaNavigation.settings()),item('reset-panels','恢复默认面板布局',()=>window.YuandaDock.reset())];
  else if(node){if(!E.getSelection().nodeIds.includes(node.dataset.nodeId)){const group=!event.altKey&&window.YuandaOutline?.groupForCanvasNode(node.dataset.nodeId);E.select(group?.nodeIds||[node.dataset.nodeId]);}entries=[item('edit-text','编辑文字',()=>E.editText(node.dataset.nodeId),'Enter',editable()&&selected().length===1&&selected()[0].type!=='image'),sep(),...clipboardItems(),sep(),...arrangement(),sep(),item('hide','隐藏元件',()=>visibility(false),'',visibilityEditable()),item('show','显示元件',()=>visibility(true),'',visibilityEditable()),item('styles','样式面板',()=>window.YuandaDock.show('styles')),item('interactions','交互面板',()=>window.YuandaDock.show('interactions'))];}
  else{E.select([]);entries=[item('paste','粘贴',()=>E.paste(),'Ctrl+V'),item('select-all','全选',()=>E.select(E.getPage().nodes.map(n=>n.id)),'Ctrl+A'),submenu('insert','插入元件',insertItems()),sep(),submenu('grid','网格',gridItems()),submenu('guides','参考线',guideItems()),toggle('snapping','启用吸附'),sep(),item('zoom-100','实际大小 · 100%',()=>E.setZoom(1)),item('zoom-fit','适应窗口',()=>E.fitPage())];}
  opener=$('#canvas-viewport');stamp=signature();menuContext=canvas?{point:E.point(event)}:null;renderMenu(entries,event.clientX,event.clientY);
}
document.addEventListener('contextmenu',contextMenu);
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.desktop-menu,.desktop-menubar'))closeMenus();},true);
window.addEventListener('blur',()=>closeMenus());window.addEventListener('resize',()=>closeMenus());
document.addEventListener('yuanda:editorchange',()=>{if(menus.length&&signature()!==stamp)closeMenus();});
document.addEventListener('keydown',event=>{
  if(!E.getState()||document.querySelector('dialog[open]'))return;
  if(menus.length){
    event.stopImmediatePropagation();const menu=document.activeElement?.closest('.desktop-menu')||menus.at(-1),rows=[...menu.querySelectorAll(':scope > button:not(:disabled)')],index=rows.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();if(menus.length>1){const parent=menus[menus.length-2],expanded=parent.querySelector('[aria-expanded="true"]');menus.pop().remove();expanded?.setAttribute('aria-expanded','false');expanded?.focus();}else closeMenus(true);}
    else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();rows[(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();}
    else if(event.key==='Home'||event.key==='End'){event.preventDefault();focusFirst(menu,event.key==='End');}
    else if(event.key==='ArrowRight'&&document.activeElement?.getAttribute('aria-haspopup')==='menu'){event.preventDefault();document.activeElement.click();}
    else if(event.key==='ArrowLeft'&&menus.length>1){event.preventDefault();menus.pop().remove();menus.at(-1).querySelector('[aria-expanded="true"]')?.focus();}
    else if(['ArrowRight','ArrowLeft'].includes(event.key)&&activeMenu){event.preventDefault();const index=menuNames.findIndex(([id])=>id===activeMenu);openTop(menuNames[(index+(event.key==='ArrowRight'?1:-1)+menuNames.length)%menuNames.length][0],true);}
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();document.activeElement?.click();}
    else if(event.key==='Tab')closeMenus();
    return;
  }
  if(event.altKey&&!event.ctrlKey){const found=menuNames.find(([, ,key])=>key.toLowerCase()===event.key.toLowerCase());if(found){event.preventDefault();event.stopImmediatePropagation();openTop(found[0],true);return;}}
  if(event.key==='F5'){event.preventDefault();event.stopImmediatePropagation();void E.exportFile('preview');return;}
  if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(event.target.closest('#page-list')&&event.key.toLowerCase()==='x')return;
  if((event.ctrlKey||event.metaKey)&&['n','x'].includes(event.key.toLowerCase())){event.preventDefault();event.stopImmediatePropagation();void(event.key.toLowerCase()==='n'?E.invoke('newProject'):editable()?E.cut():null);}
},true);
window.YuandaShell=Object.freeze({close:closeMenus,open:openTop});
