/** View authoring uses the same resolved canvas and transaction scope as normal editing. */
const E=window.YuandaEditor,W=window.YuandaTools;
const {node,btn,row,field,note,openModal}=W;
const $=selector=>document.querySelector(selector),uid=()=>crypto.randomUUID();
const project=()=>E.getState()?.project,model=()=>E.getViewModel();
const definitions=canvas=>model().getCanvasViews(project(),canvas);
const clone=value=>structuredClone(value);
const visualPaths=['x','y','width','height','rotation','placed','style.fill','style.stroke','style.strokeWidth','style.radius','style.color','style.fontSize','style.fontWeight','style.align','style.opacity'];
const pathNames={x:'X',y:'Y',width:'宽度',height:'高度',rotation:'旋转',placed:'放置状态','style.fill':'填充','style.stroke':'边框颜色','style.strokeWidth':'边框粗细','style.radius':'圆角','style.color':'文字颜色','style.fontSize':'字号','style.fontWeight':'字重','style.align':'文字对齐','style.opacity':'不透明度'};
const hasPath=(value,path)=>path.split('.').every((part,index,parts)=>{let current=value;for(const key of parts.slice(0,index))current=current?.[key];return current!=null&&Object.hasOwn(current,part);});
function viewLabel(views,id){const labels=[],seen=new Set();while(id){if(seen.has(id))break;seen.add(id);const view=views.find(item=>item.id===id);if(!view)break;labels.unshift(view.name);id=view.parentId;}return labels.join(' / ');}
function parentOptions(views,id){const descendants=new Set([id]);let changed=true;while(changed){changed=false;for(const view of views)if(descendants.has(view.parentId)&&!descendants.has(view.id)){descendants.add(view.id);changed=true;}}return [['','基础视图'],...views.filter(view=>!descendants.has(view.id)).map(view=>[view.id,viewLabel(views,view.id)])];}
async function run(commands,label,context){const ok=await E.command(commands,label,context);if(ok)E.refresh();return ok;}

const controls=node('div','view-edit-controls');
const picker=node('select','adaptive-view-picker');picker.id='adaptive-view-picker';picker.setAttribute('aria-label','正在编辑的自适应视图');
const scope=node('select','view-scope-picker');scope.id='view-scope-picker';scope.setAttribute('aria-label','修改范围');scope.append(new Option('修改当前视图','current'),new Option('修改全部视图','all'));
const manage=btn('管理视图',()=>manageViews(),'管理页面视图集、母版视图和继承关系');manage.id='manage-views';
controls.append(picker,scope,manage);$('.canvas-breadcrumb').insertBefore(controls,$('#page-size'));
const help=node('div','view-edit-help');help.id='view-edit-help';help.textContent='位置、尺寸、旋转、外观和放置状态按修改范围保存；文字、图片、交互和结构设置共享。';$('.canvas-breadcrumb').after(help);
picker.addEventListener('change',async()=>{await E.setEditingView(picker.value||null);draw();});
scope.addEventListener('change',async()=>{await E.setEditingScope(scope.value);draw();});
function draw(){if(!project()||!model()||!E.getRawPage())return;const context=E.getEditingContext(),views=definitions(E.getRawPage());if(document.activeElement!==picker)picker.replaceChildren(new Option('基础视图',''),...views.map(view=>new Option(viewLabel(views,view.id),view.id)));picker.value=context.viewId||'';scope.value=context.scope;help.dataset.scope=context.scope;help.textContent=`${context.scope==='all'?'修改全部视图':'修改当前视图'}：位置、尺寸、旋转、外观与放置。文字、图片、交互、命名及结构设置始终共享。${context.scope==='current'&&context.viewId?' Delete 取消在此视图放置，可在概览重新置入。':''}`;}

function clearOverride(context,nodeId,paths){
  if(context.targetKind==='component')return {type:'clearComponentViewOverride',componentId:context.targetId,viewId:context.viewId,nodeId,...(paths?{fields:paths}:{})};
  return paths?{type:'clearViewOverride',pageId:context.targetId,viewId:context.viewId,nodeId,paths}:{type:'setViewOverride',pageId:context.targetId,viewId:context.viewId,nodeId,patch:null};
}
function renderInspector(root,selected){
  if(!model())return;const context=E.getEditingContext(),raw=E.getRawPage(),views=definitions(raw),view=views.find(item=>item.id===context.viewId);
  const section=node('section','view-inspector');section.id='view-inspector';section.append(node('h3','workspace-section-title',view?`${view.name} · ${context.scope==='all'?'全部视图':'当前视图'}`:'基础视图'));
  if(selected.length){
    const selectedGroups=raw.groups?.filter(group=>group.componentId&&selected.some(item=>group.nodeIds.includes(item.id)))||[];
    const clearCommands=paths=>[...selected.map(item=>clearOverride(context,item.id,paths)),...selectedGroups.filter(group=>group.viewOverrides?.[context.viewId]).map(group=>({type:'clearInstanceViewOverride',pageId:context.targetId,instanceId:group.id,viewId:context.viewId,...(paths?{fields:paths.filter(path=>['x','y','placed'].includes(path))}:{})})).filter(command=>!command.fields||command.fields.length)];
    const allPlaced=selected.every(item=>item.effectivePlaced!==false),place=btn(allPlaced?'取消放置':'置入此视图',()=>run([{type:'setNodesPlaced',pageId:context.targetId,nodeIds:selected.map(item=>item.id),placed:!allPlaced}],allPlaced?'取消视图放置':'置入视图',context));place.dataset.viewAction='placement';section.append(place);
    if(view){
      const overrides=model().getCanvasViewOverrides(project(),raw,view.id)||{},ownPaths=new Set([...selected.flatMap(item=>visualPaths.filter(path=>hasPath(overrides[item.id]||{},path))),...selectedGroups.flatMap(group=>Object.keys(group.viewOverrides?.[view.id]||{}))]);
      section.append(note(ownPaths.size?`本视图覆盖：${[...ownPaths].map(path=>pathNames[path]).join('、')}`:'这些外观值继承基础或上级视图。'));
      const clearAll=btn('恢复全部继承',()=>run(clearCommands(),'恢复视图继承',context));clearAll.dataset.viewAction='clear-all';clearAll.disabled=!selected.some(item=>Object.keys(overrides[item.id]||{}).length)&&!selectedGroups.some(group=>Object.keys(group.viewOverrides?.[view.id]||{}).length);section.append(clearAll);
      if(ownPaths.size){let restorePath=[...ownPaths][0];const choose=field('恢复的属性',restorePath,value=>restorePath=value,{options:[...ownPaths].map(path=>[path,pathNames[path]])});const restore=btn('恢复该属性继承',()=>run(clearCommands([restorePath]),'恢复属性继承',context));restore.dataset.viewAction='clear-property';section.append(choose,restore);}
    }
    const group=raw.groups?.find(item=>item.componentId&&selected.every(value=>item.nodeIds.includes(value.id)));
    if(group){const component=project().components.find(item=>item.id===group.componentId),choices=[['mode:auto','自动匹配完整视图名称路径'],['mode:base','固定：基础视图'],...(component?.views||[]).map(view=>[`view:${view.id}`,`固定：${viewLabel(component.views,view.id)}`])];section.append(field('母版实例视图',group.viewMode==='auto'?'mode:auto':group.viewId?`view:${group.viewId}`:'mode:base',value=>run([{type:'setComponentInstanceView',pageId:context.targetId,instanceId:group.id,viewMode:value==='mode:auto'?'auto':'fixed',viewId:value.startsWith('view:')?value.slice(5):null}],'选择实例视图',context),{options:choices}));}
  }else section.append(note('选中元件后，可在常规属性中编辑当前视图；取消放置的元件仍保留在概览中。'));
  root.append(section);
}

function manageViews(){
  if(!project()||!model())return;const context=E.getEditingContext(),targetId=context.targetId,isComponent=context.targetKind==='component';
  openModal(isComponent?'母版视图与继承':'页面视图与共享视图集',(body,dialog)=>{
    dialog.classList.add('view-manager');dialog.id='view-manager';
    const source=()=>E.getRawPage(targetId);
    const commit=async(commands,label)=>{if(await run(commands,label,context))drawManager();};
    function mapSharedSet(setId){
      const canvas=source(),old=definitions(canvas),next=project().viewSets.find(set=>set.id===setId);if(!next)return;
      if(!old.length)return commit([{type:'setPageViewSet',pageId:targetId,viewSetId:setId}],'引用共享视图集');
      const mapping={};openModal('对应原有视图',(content,mappingDialog)=>{
        content.append(note('逐一选择原有视图对应的新视图，保留已有覆盖。每个目标只能对应一次。'));
        for(const view of old){const matching=next.views.find(candidate=>viewLabel(next.views,candidate.id)===viewLabel(old,view.id));mapping[view.id]=matching?.id||'';content.append(field(viewLabel(old,view.id),mapping[view.id],value=>mapping[view.id]=value,{options:[['','请选择'],...next.views.map(item=>[item.id,viewLabel(next.views,item.id)])]}));}
        content.append(row(btn('取消',()=>mappingDialog.close()),btn('确认对应并引用',async()=>{if(Object.values(mapping).some(value=>!value)||new Set(Object.values(mapping)).size!==old.length){E.toast('请为每个原有视图选择不重复的目标。','warning');return;}if(await run([{type:'setPageViewSet',pageId:targetId,viewSetId:setId,viewMap:mapping}],'引用共享视图集',context)){mappingDialog.close();drawManager();}})));
      });
    }
    function drawManager(){
      const canvas=source();body.replaceChildren();if(!canvas){body.append(note('原画布已删除，请关闭此窗口。'));return;}
      const views=definitions(canvas),set=!isComponent&&canvas.viewSetId?project().viewSets.find(item=>item.id===canvas.viewSetId):null;
      body.append(note(isComponent?'母版视图按名称路径与页面视图自动匹配，也可以让实例固定使用一个视图。母版画板尺寸、文字及交互共享。':set?'这组视图的名称、继承、断点和画板尺寸由引用它的所有页面共享；各页面元件覆盖独立保存。':'本页视图独立保存，可以创建共享视图集供其他页面引用。'));
      if(!isComponent){
        let chosenSet=canvas.viewSetId||'';body.append(field('可用共享视图集',chosenSet,value=>chosenSet=value,{options:[['','请选择'],...(project().viewSets||[]).map(value=>[value.id,value.name])]}),btn('引用所选视图集',()=>{if(chosenSet)mapSharedSet(chosenSet);else E.toast('请先选择一个共享视图集。');}));
        if(set)body.append(field('共享视图集名称',set.name,name=>commit([{type:'updateViewSet',viewSetId:set.id,patch:{name}}],'重命名视图集')),btn('解除共享，保留为本页视图',()=>commit([{type:'detachPageViewSet',pageId:targetId}],'解除共享视图集')));
        body.append(btn('把当前视图建为新共享集',()=>{
          openModal('创建共享视图集',(content,nameDialog)=>{let name=`${canvas.name}视图集`;content.append(field('视图集名称',name,value=>name=value));content.append(btn('创建并引用',async()=>{const id=uid(),mapping=Object.fromEntries(views.map(view=>[view.id,uid()])),copied=views.map(({id:oldId,name,parentId,minWidth,width,height})=>({id:mapping[oldId],name,parentId:parentId?mapping[parentId]:null,minWidth,width,height}));if(await run([{type:'addViewSet',viewSet:{id,name,views:copied}},{type:'setPageViewSet',pageId:targetId,viewSetId:id,...(views.length?{viewMap:mapping}:{})}],'创建共享视图集',context)){nameDialog.close();drawManager();}}));});
        }));
        const unused=(project().viewSets||[]).filter(candidate=>!project().pages.some(page=>page.viewSetId===candidate.id));if(unused.length){const cleanup=node('details','advanced-details');cleanup.append(node('summary','','未引用的视图集'));for(const item of unused)cleanup.append(btn(`删除未引用的「${item.name}」`,()=>commit([{type:'removeViewSet',viewSetId:item.id}],'删除未引用视图集')));body.append(cleanup);}
      }
      const list=node('div','view-manager-list');
      for(const view of views){
        const section=node('section','workspace-section');section.dataset.viewId=view.id;const update=patch=>commit([isComponent?{type:'updateComponentView',componentId:targetId,viewId:view.id,patch}:set?{type:'updateViewSetView',viewSetId:set.id,viewId:view.id,patch}:{type:'updateAdaptiveView',pageId:targetId,viewId:view.id,patch}],'修改视图');
        section.append(field('视图名称',view.name,name=>update({name})));
        if(isComponent||set)section.append(field('继承自',view.parentId||'',parentId=>update({parentId:parentId||null}),{options:parentOptions(views,view.id)}));
        else section.append(note('本页旧版视图直接继承基础视图。建为共享集后可设置多层继承。'));
        if(!isComponent){const grid=node('div','workspace-grid');for(const [key,label]of [['minWidth','浏览器宽度达到'],['width','视图画板宽度'],['height','视图画板高度']])grid.append(field(label,view[key],value=>update({[key]:value}),{number:true,min:key==='minWidth'?0:100}));section.append(grid);}
        const remove=btn('删除视图',()=>commit([isComponent?{type:'removeComponentView',componentId:targetId,viewId:view.id}:set?{type:'removeViewSetView',viewSetId:set.id,viewId:view.id}:{type:'removeAdaptiveView',pageId:targetId,viewId:view.id}],'删除视图'));remove.dataset.viewAction='delete';if(!isComponent&&views.some(item=>item.parentId===view.id)){remove.disabled=true;remove.title='先修改子视图的继承关系，再删除此视图';}section.append(remove);list.append(section);
      }
      body.append(list,btn('添加视图',()=>{
        let index=1;while(views.some(item=>item.name===`视图 ${index}`))index++;const view={id:uid(),name:`视图 ${index}`,parentId:null,...(isComponent?{}:{minWidth:views.length?Math.min(20000,Math.max(...views.map(item=>item.minWidth))+320):768,width:768,height:900})};
        const {parentId,...legacyView}=view;
        commit([isComponent?{type:'addComponentView',componentId:targetId,view}:set?{type:'addViewSetView',viewSetId:set.id,view}:{type:'addAdaptiveView',pageId:targetId,view:{...legacyView,overrides:{}}}],'添加视图');
      }),row(btn('完成',()=>dialog.close())));
    }
    drawManager();
  });
}
window.YuandaViewTools={manageViews,renderInspector,draw};
document.addEventListener('yuanda:editorchange',draw);draw();if(project())E.refresh();
