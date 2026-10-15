import * as S from '../core/style-model.mjs';
import {resolveNodeVisual} from '../core/style-renderer.mjs';

/** Original style authoring. Drafts are local; saved changes remain sparse commands. */
const E=window.YuandaEditor, api=window.yuanda, W=window.YuandaTools;
const {node,btn,row,note}=W, clone=value=>structuredClone(value);
const defaults=S.newStyleDefaults(), same=S.styleValueEqual;
const states={hover:'鼠标悬停',pressed:'鼠标按下',selected:'选中',disabled:'禁用',error:'错误',focus:'聚焦',hint:'提示'};
const sides=['top','right','bottom','left'], cornerNames=['topLeft','topRight','bottomRight','bottomLeft'];
const sideLabels=['上','右','下','左'], cornerLabels=['左上','右上','右下','左下'];
let activeSession=null, inlineDraft=null, pendingCommit=Promise.resolve(true),appearanceClip=null,brush=null;
const typeNames={rectangle:'矩形',ellipse:'椭圆',text:'文字',line:'线段',button:'按钮',input:'输入框',textarea:'多行文本框',checkbox:'复选框',radio:'单选按钮',select:'下拉列表',table:'表格',image:'图片',dynamicPanel:'动态面板',repeater:'中继器',path:'路径',connector:'连线'};
const labels={fill:'纯色填充',stroke:'纯色边框',strokeWidth:'边框宽度',radius:'圆角',color:'文字颜色',fontSize:'字号',fontWeight:'字重',align:'水平对齐',opacity:'整体透明度',fontFamily:'字体',italic:'斜体',underline:'下划线',strike:'删除线',textCase:'字母大小写',lineHeight:'行高',letterSpacing:'字距',verticalAlign:'垂直对齐',padding:'内边距',fillPaint:'填充画笔',strokePaint:'边框画笔',fillOpacity:'填充透明度',strokeOpacity:'边框透明度',borderSides:'独立边框',strokeStyle:'边框线型',radiusCorners:'独立圆角',shadows:'内外阴影',textShadows:'文字阴影',blur:'元件模糊',backdropBlur:'背景模糊',transition:'状态过渡',transformOrigin:'旋转中心'};
const expanded=new Set(['text','fill','border']);
function safely(action){return Promise.resolve().then(action).catch(error=>{E.toast(error.message,'error');return false;});}
function currentNode(session,raw=false){
  if(E.getState()?.project.id!==session.context.projectId)throw Error('项目已切换，样式草稿仍保留，未写入其他项目。');
  const canvas=E.getRawPage(session.context.targetId);
  if(!canvas)throw Error('原画布已不存在，样式草稿仍保留。');
  if(session.context.viewId&&!E.getViewModel().getCanvasViews(E.getState().project,canvas).some(view=>view.id===session.context.viewId))throw Error('原视图已不存在，样式草稿仍保留。');
  const value=(raw?canvas:E.getPage(session.context)).nodes.find(value=>value.id===session.nodeId);
  if(!value)throw Error('原元件已不存在，样式草稿仍保留。');
  return value;
}
function sessionInfo(session){
  if(E.getState()?.project.id!==session.context.projectId)throw Error('项目已切换，样式草稿仍保留。');
  const project=E.getState().project,state=session.state?{state:session.state}:{};
  if(session.kind==='shared')return S.getStyleInfo(project,{styleId:session.styleId,nodeType:session.nodeType||'rectangle',...state});
  if(session.kind==='default')return S.getStyleInfo(project,{defaultStyleSetId:session.defaultStyleSetId,nodeType:session.nodeType,...state});
  const raw=currentNode(session,true),info=S.getStyleInfo(project,{node:raw,...state});
  if(session.state||!session.context.viewId)return info;
  const canvas=E.getRawPage(session.context.targetId),V=E.getViewModel(),views=V.getCanvasViews(project,canvas),chain=V.resolveViewChain(views,session.context.viewId),sources={...info.sourceByKey};
  for(const view of chain){const patch=V.getCanvasViewOverrides(project,canvas,view.id)?.[raw.id]?.style;for(const key of Object.keys(patch||{}))sources[key]={kind:'view',id:view.id};}
  const own=V.getCanvasViewOverrides(project,canvas,session.context.viewId)?.[raw.id]?.style||{},parentId=chain.length>1?chain[chain.length-2].id:null;
  return{effective:currentNode(session).style,inherited:V.resolveContainerView(project,canvas.id,parentId).nodes.find(value=>value.id===raw.id).style,ownKeys:Object.keys(own),sourceByKey:sources};
}
function targetStyle(session){return sessionInfo(session).effective;}
function inheritedStyle(session){return sessionInfo(session).inherited;}
function sourceLabel(source){if(!source)return'内置默认';const p=E.getState().project;if(source.kind==='local')return'单独设定';if(source.kind==='view')return'当前 / 上级视图';if(source.kind==='named')return'样式 · '+(p.styles.find(item=>item.id===source.id)?.name||'已删除');if(source.kind==='default')return'项目 / 来源库默认';return'内置默认';}
function fingerprint(session,key){
  const info=sessionInfo(session),p=E.getState().project;let styleId=session.kind==='shared'?session.styleId:session.kind==='default'?null:currentNode(session,true).styleId;
  const chain=[];for(let i=0;styleId&&i<64;i++){const value=p.styles.find(item=>item.id===styleId);if(!value)break;chain.push([value.id,value.parentId??null]);styleId=value.parentId;}
  return{value:info.effective[key],own:info.ownKeys.includes(key),source:info.sourceByKey[key]??null,chain};
}
function fieldVersion(session,key){
  if(session.kind==='node'&&session.context.scope==='all'){
    const p=E.getState().project,canvas=E.getRawPage(session.context.targetId);
    currentNode(session);
    return [null,...E.getViewModel().getCanvasViews(p,canvas).map(view=>view.id)].map(viewId=>[viewId,fingerprint({...session,context:{...session.context,viewId,scope:'current'}},key)]);
  }
  return fingerprint(session,key);
}
function createSession(kind,value,context,extra={}){
  const session={kind,context:clone(context),nodeId:value.id,originalNode:clone(value),changes:new Map(),baseline:new Map(),...extra};
  session.base={...defaults,...clone(value.style),...clone(inheritedStyle(session))};session.ownKeys=new Set(sessionInfo(session).ownKeys);
  session.original=clone(targetStyle(session));
  for(const key of Object.keys({...session.base,...session.original}))session.baseline.set(key,clone(fieldVersion(session,key)));
  return session;
}
function valueOf(session,key){
  if(!session.dialog){if(session.pendingValues?.has(key))return session.pendingValues.get(key);try{return targetStyle(session)[key]??defaults[key];}catch{}}
  if(session.changes.has(key)){const change=session.changes.get(key);return change.remove?inheritedStyle(session)[key]:change.value;}
  return Object.hasOwn(session.original,key)?session.original[key]:Object.hasOwn(session.base,key)?session.base[key]:defaults[key];
}
function owned(session,key){return session.changes.has(key)?!session.changes.get(key).remove:sessionInfo(session).ownKeys.includes(key);}
function enabled(session,key){return !session.state||owned(session,key);}
function draftStyle(session){
  let current=session.original,base=session.base;try{current=targetStyle(session);base=inheritedStyle(session);}catch{}
  const style={...base,...current};
  for(const[key,change]of session.changes)if(change.remove){if(Object.hasOwn(base,key))style[key]=base[key];else delete style[key];}else style[key]=clone(change.value);
  return style;
}
function mark(session,key,value,remove=false){
  if(remove&&!session.ownKeys.has(key))session.changes.delete(key);
  else if(!remove&&session.ownKeys.has(key)&&same(value,session.original[key]))session.changes.delete(key);
  else session.changes.set(key,remove?{remove:true}:{value:clone(value)});
  session.previewVersion=(session.previewVersion||0)+1;if(session.dialog){session.dialog.dataset.dirty=String(session.changes.size>0);session.status.textContent='';E.refresh();}
}
function changedKeys(session){return [...session.changes.keys()];}
async function retainFailedDraft(session){
  if(session.dialog)return session;
  const existing=activeSession;
  if(existing?.dialog?.open){
    if(existing.kind===session.kind&&existing.nodeId===session.nodeId&&existing.state===session.state&&existing.styleId===session.styleId&&same(existing.context,session.context)){
      for(const[key,change]of session.changes){existing.changes.set(key,clone(change));existing.baseline.set(key,clone(session.baseline.get(key)));}
      existing.conflicts=[...(existing.conflicts||[]),...(session.conflicts||[])];existing.previewVersion=(existing.previewVersion||0)+1;existing.dialog.dataset.dirty='true';const body=existing.dialog.querySelector('.style-dialog-body');body.replaceChildren();build(body,existing);E.refresh();return existing;
    }
    await new Promise(resolve=>existing.dialog.addEventListener('close',resolve,{once:true}));
  }
  openEditor(session,'保留样式草稿');return session;
}
async function save(session,force=false){
  let conflict=false,canOverwrite=false,reason='';
  const context=clone(session.context),patch=Object.fromEntries([...session.changes].filter(([,value])=>!value.remove).map(([key,value])=>[key,clone(value.value)]));
  if(!session.changes.size){session.dialog?.close();return true;}
  const ok=await E.command(()=>{
    try{
      const current=targetStyle(session);
      const changed=changedKeys(session).filter(key=>!same(session.baseline.get(key),fieldVersion(session,key)));
      if(changed.length&&!force){conflict=true;canOverwrite=true;session.conflicts=changed.map(key=>({key,expected:session.baseline.get(key),actual:fieldVersion(session,key)}));reason='这些属性已被另一处修改。你的草稿保留；确认后才会覆盖这些属性。';return[];}
      const removed=[...session.changes].filter(([,change])=>change.remove).map(([key])=>key),commands=[];
      if(session.kind==='default'){
        const item=E.getState().project.defaultStyleSets.find(value=>value.id===session.defaultStyleSetId);if(!item)throw Error('默认设置已删除，草稿仍保留。');
        const byType=clone(item.byType),entry=byType[session.nodeType]||{style:{},stateStyles:{}};byType[session.nodeType]=entry;
        if(session.state){entry.stateStyles||={};entry.stateStyles[session.state]={...entry.stateStyles[session.state],...patch};}else entry.style={...entry.style,...patch};
        if(Object.keys(patch).length)commands.push({type:'updateDefaultStyleSet',defaultStyleSetId:item.id,patch:{byType}});
        if(removed.length)commands.push({type:'clearDefaultStyleOverrides',defaultStyleSetId:item.id,nodeType:session.nodeType,keys:removed,...(session.state?{state:session.state}:{})});
        return commands;
      }
      if(session.kind==='shared'){
        const item=E.getState().project.styles.find(value=>value.id===session.styleId);if(!item)throw Error('共享样式已删除，草稿仍保留。');
        if(Object.keys(patch).length)commands.push({type:'updateStyle',styleId:session.styleId,patch:session.state?{stateStyles:{...item.stateStyles,[session.state]:{...item.stateStyles?.[session.state],...patch}}}:{style:patch}});
        if(removed.length)commands.push({type:'clearNamedStyleOverrides',styleId:session.styleId,keys:removed,...(session.state?{state:session.state}:{})});
        return commands;
      }
      if(session.state){const raw=currentNode(session,true),stateStyles=clone(raw.stateStyles||{});if(Object.keys(patch).length)commands.push({type:'updateNode',pageId:context.targetId,nodeId:session.nodeId,patch:{stateStyles:{...stateStyles,[session.state]:{...stateStyles[session.state],...patch}}}});}
      else if(Object.keys(patch).length)commands.push({type:'updateNode',pageId:context.targetId,nodeId:session.nodeId,patch:{style:patch}});
      if(removed.length)commands.push({type:'clearStyleOverrides',pageId:context.targetId,nodeIds:[session.nodeId],keys:removed,...(session.state?{state:session.state}:{})});
      return commands;
    }catch(error){conflict=true;reason=error.message;return[];}
  },session.kind==='state'?'修改交互状态样式':session.kind==='shared'?'修改共享样式':'修改元件样式',context);
  if(conflict||!ok){
    session=await retainFailedDraft(session);
    session.status.textContent=reason||'此次修改未保存。草稿仍保留，请检查输入后重试。';session.status.classList.add('conflict');
    session.status.dataset.conflictFields=JSON.stringify(session.conflicts||[]);session.overwrite.hidden=!canOverwrite;return false;
  }
  session.changes.clear();if(session.dialog){session.dialog.dataset.dirty='false';session.dialog.close();}return true;
}
function inlineChange(session,key,value,remove=false){
  const focused=inlineDraft?.session===session?inlineDraft:null;
  const baseline=new Map(session.baseline);if(focused?.baseline.has(key))baseline.set(key,clone(focused.baseline.get(key)));
  session.inflight||=new Map();session.pendingValues||=new Map();const predecessor=session.inflight.get(key),record={pending:true,success:false};session.inflight.set(key,record);session.pendingValues.set(key,clone(value));
  const submission={...session,dialog:null,baseline,changes:new Map([[key,remove?{remove:true}:{value:clone(value)}]])};
  if(focused)inlineDraft=null;
  pendingCommit=pendingCommit.then(async()=>{
    if(predecessor?.success)submission.baseline.set(key,clone(predecessor.version));
    const ok=await save(submission);record.pending=false;record.success=ok;
    if(ok){record.version=clone(fieldVersion(submission,key));session.baseline.set(key,record.version);session.original[key]=clone(targetStyle(session)[key]);}
    if(session.inflight.get(key)===record){session.inflight.delete(key);session.pendingValues.delete(key);}
    E.refresh();return ok;
  });return pendingCommit;
}
function set(session,key,value,remove=false){return session.dialog?(mark(session,key,value,remove),true):inlineChange(session,key,value,remove);}
function rememberInput(input,session,key){
  input.addEventListener('focus',()=>{if(session.dialog)return;try{inlineDraft={element:input,session,baseline:new Map([[key,clone(fieldVersion(session,key))]]),dirty:false};}catch{inlineDraft={element:input,session,baseline:session.baseline,dirty:false};}});
  input.addEventListener('input',()=>{if(inlineDraft?.element===input)inlineDraft.dirty=true;});
  input.addEventListener('blur',()=>{if(inlineDraft?.element===input&&!inlineDraft.dirty)inlineDraft=null;setTimeout(()=>{if(!document.querySelector('.style-dialog[open]')&&!inlineDraft?.dirty)E.refresh();},0);});
}
function inputControl(label,value,change,{number=false,min,max,step,options,nullable=false,key='',session,ownerKey=key}={}){
  const wrapper=node('label','style-field'),caption=node('span','',label);wrapper.append(caption);let input;
  if(options){input=node('select');for(const[item,text]of options){const option=node('option','',text);option.value=item;input.append(option);}}
  else{input=node('input');input.type=number?'number':'text';}
  input.value=value??'';input.setAttribute('aria-label',label);if(key)input.dataset.styleField=key;
  if(nullable)input.placeholder='默认';if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;
  input.addEventListener('change',()=>{let next=input.value;if(nullable&&next==='')next=null;else if(number){next=Number(next);if(!Number.isFinite(next)||input.value===''){input.value=value??'';return;}if(min!==undefined)next=Math.max(min,next);if(max!==undefined)next=Math.min(max,next);input.value=next;}if(options&&session&&!session.dialog){try{session.baseline.set(ownerKey,clone(fieldVersion(session,ownerKey)));if(inlineDraft?.session===session)inlineDraft.baseline.set(ownerKey,clone(fieldVersion(session,ownerKey)));}catch{}}change(next);});
  if(session){rememberInput(input,session,ownerKey);input.addEventListener('input',()=>{if(session.dialog)session.dialog.dataset.dirty='true';});}
  if(!number&&!options&&(['fill','stroke','color'].includes(key)||key.endsWith('.color'))){
    const palette=node('input'),colorRow=node('div','style-color-row');palette.type='color';palette.value=/^#[\da-f]{6}/i.test(String(value))?String(value).slice(0,7):'#191919';palette.setAttribute('aria-label',label+'选择颜色');
    palette.addEventListener('input',()=>{input.value=palette.value;if(session.dialog)session.dialog.dataset.dirty='true';});palette.addEventListener('change',()=>change(palette.value));if(session)rememberInput(palette,session,ownerKey);colorRow.append(palette,input);wrapper.append(colorRow);
  }else wrapper.append(input);return wrapper;
}
function checkControl(label,value,change){const wrapper=node('label','style-check'),input=node('input');input.type='checkbox';input.checked=!!value;input.addEventListener('change',()=>change(input.checked));wrapper.append(input,document.createTextNode(label));return wrapper;}
function keyBox(parent,session,key,label,build){
  const box=node('div','style-property');box.dataset.styleProperty=key;const content=node('div','style-property-content');
  if(session.state){
    const toggle=checkControl('覆盖'+label,enabled(session,key),checked=>{set(session,key,checked?valueOf(session,key):null,!checked);refresh();});toggle.querySelector('input').dataset.styleOverride=key;box.append(toggle);
  }
  const source=node('div','style-source');source.dataset.styleSource=key;const info=sessionInfo(session);
  source.append(node('span','',sourceLabel(info.sourceByKey[key])));
  const reset=btn(owned(session,key)?'恢复跟随':'固定此值',()=>safely(async()=>{await set(session,key,valueOf(session,key),owned(session,key));refresh();}));reset.dataset.styleReset=key;source.append(reset);box.append(source);
  const refresh=()=>{content.replaceChildren();build(content);if(!enabled(session,key))for(const control of content.querySelectorAll('input,select,button'))control.disabled=true;};refresh();box.append(content);parent.append(box);return box;
}
function scalar(parent,session,key,label,options={}){return keyBox(parent,session,key,label,content=>content.append(inputControl(label,valueOf(session,key),value=>set(session,key,value),{...options,key,session})));}
function flag(parent,session,key,label){return keyBox(parent,session,key,label,content=>{const control=checkControl(label,valueOf(session,key),value=>set(session,key,value));control.querySelector('input').dataset.styleField=key;content.append(control);});}
function group(root,id,label,session){const details=node('details','style-group');details.dataset.styleGroup=id;details.open=!!session.dialog||expanded.has(id);details.append(node('summary','',label));details.addEventListener('toggle',()=>{if(session.dialog)return;if(details.open)expanded.add(id);else expanded.delete(id);});const body=node('div','style-group-body');details.append(body);root.append(details);return body;}
function tuple(parent,session,key,label,names,labels,fallback,limit){
  keyBox(parent,session,key,label,content=>{
    const value=valueOf(session,key),mode=checkControl('分别设置'+label,value!==null,checked=>{set(session,key,checked?Object.fromEntries(names.map(name=>[name,fallback])):null);render();});content.append(mode);
    mode.querySelector('input').dataset.styleEnable=key;
    const grid=node('div','style-grid');content.append(grid);
    function render(){grid.replaceChildren();const values=valueOf(session,key);if(values===null)return;names.forEach((name,index)=>grid.append(inputControl(labels[index],values?.[name]??fallback,next=>set(session,key,{...valueOf(session,key),[name]:next}),{number:true,min:0,max:limit,key:key+'.'+name,ownerKey:key,session})));}render();
  });
}
const defaultStops=()=>[{offset:0,color:'#191919',opacity:1},{offset:1,color:'#eeeeee',opacity:1}];
function paintEditor(parent,session,key,label,imageAllowed){
  keyBox(parent,session,key,label,content=>{
    const controls=node('div','style-paint-controls');
    content.append(inputControl(label,valueOf(session,key)?.type||'solid',type=>safely(async()=>{const old=valueOf(session,key);if(type==='image'&&!old?.src){await chooseImage();return;}set(session,key,type==='solid'?null:type==='linear'?{type,angle:90,stops:old?.stops||defaultStops()}:type==='radial'?{type,cx:.5,cy:.5,radius:.5,stops:old?.stops||defaultStops()}:{type,src:old.src,fit:'cover',positionX:.5,positionY:.5});draw();}),{key:key+'.type',session,ownerKey:key,options:[['solid','纯色'],['linear','线性渐变'],['radial','径向渐变'],...(imageAllowed?[['image','图片']]:[])]}),controls);
    function update(patch){set(session,key,{...valueOf(session,key),...patch});}
    async function chooseImage(){await E.flush();const revision=E.getState().revision,asset=await api.importImage({...session.context,expectedRevision:revision});if(!asset){if(session.dialog)draw();else E.refresh();return;}
      if(E.getState().project.id!==session.context.projectId)throw Error('项目已切换，图片未写入其他项目.');
      set(session,key,{type:'image',src:asset.src,fit:valueOf(session,key)?.fit||'cover',positionX:valueOf(session,key)?.positionX??.5,positionY:valueOf(session,key)?.positionY??.5});draw();for(const warning of asset.warnings||[])E.toast(warning,'warning');}
    function draw(){
      controls.replaceChildren();const value=valueOf(session,key);if(!value)return;
      if(value.type==='image'){
        const select=btn(value.src?'替换填充图片…':'选择填充图片…',()=>safely(chooseImage));select.dataset.styleAction='fill-image';controls.append(select);
        if(value.src){const thumb=node('img','style-fill-preview');thumb.src=value.src;thumb.alt='填充图片';controls.append(thumb);}
        controls.append(inputControl('填充方式',value.fit,fit=>update({fit}),{options:[['cover','等比铺满'],['contain','完整显示'],['stretch','拉伸'],['tile','平铺']],key:key+'.fit',ownerKey:key,session}));
        for(const[axis,text]of[['X','水平位置 %'],['Y','垂直位置 %']])controls.append(inputControl(text,(value['position'+axis]??.5)*100,next=>update({['position'+axis]:next/100}),{number:true,min:0,max:100,key:key+'.position'+axis,ownerKey:key,session}));
        return;
      }
      if(value.type==='linear')controls.append(inputControl('角度 °',value.angle,angle=>update({angle}),{number:true,min:-360,max:360,key:key+'.angle',ownerKey:key,session}));
      else{const grid=node('div','style-grid');for(const[property,text,max]of[['cx','中心 X %',100],['cy','中心 Y %',100],['radius','半径 %',200]])grid.append(inputControl(text,value[property]*100,next=>update({[property]:next/100}),{number:true,min:property==='radius'?.1:0,max,key:key+'.'+property,ownerKey:key,session}));controls.append(grid);}
      const bar=node('div','style-gradient-preview');bar.style.background=`linear-gradient(90deg,${value.stops.map(stop=>`${stop.color} ${stop.offset*100}%`).join(',')})`;controls.append(bar);
      const stops=node('div','style-stops');controls.append(stops);
      value.stops.forEach((stop,index)=>{
        const entry=node('div','style-stop');entry.dataset.styleStop=index;
        const change=(property,next)=>{const nextStops=clone(valueOf(session,key).stops);nextStops[index][property]=next;if(property==='offset')nextStops.sort((a,b)=>a.offset-b.offset);update({stops:nextStops});if(property==='offset')draw();};
        entry.append(inputControl('颜色',stop.color,color=>change('color',color),{key:key+'.stops.'+index+'.color',ownerKey:key,session}),inputControl('位置 %',stop.offset*100,next=>change('offset',next/100),{number:true,min:0,max:100,key:key+'.stops.'+index+'.offset',ownerKey:key,session}),inputControl('色标透明度 %',stop.opacity*100,next=>change('opacity',next/100),{number:true,min:0,max:100,key:key+'.stops.'+index+'.opacity',ownerKey:key,session}));
        const remove=btn('移除',()=>{update({stops:valueOf(session,key).stops.filter((_,i)=>i!==index)});draw();});remove.disabled=value.stops.length<=2;entry.append(remove);stops.append(entry);
      });
      const add=btn('添加色标',()=>{const values=clone(valueOf(session,key).stops);values.push({offset:.5,color:'#888888',opacity:1});values.sort((a,b)=>a.offset-b.offset);update({stops:values});draw();});add.disabled=value.stops.length>=16;add.dataset.styleAction=key+'-add-stop';controls.append(add);
    }draw();
  });
}
function shadowsEditor(parent,session,key,label,textOnly=false){
  keyBox(parent,session,key,label,content=>{
    const list=node('div','style-shadow-list');content.append(list);
    function update(index,patch){const shadows=clone(valueOf(session,key));shadows[index]={...shadows[index],...patch};set(session,key,shadows);}
    function draw(){list.replaceChildren();const values=valueOf(session,key)||[];values.forEach((shadow,index)=>{
      const entry=node('div','style-shadow');entry.dataset.styleShadow=index;entry.append(node('strong','',label+' '+(index+1)));
      if(!textOnly)entry.append(checkControl('内阴影',shadow.inset,value=>update(index,{inset:value})));
      const grid=node('div','style-grid');for(const[property,title,min,max]of[['x','横向偏移',-10000,10000],['y','纵向偏移',-10000,10000],['blur','模糊',0,1000],...(!textOnly?[['spread','扩散',-1000,1000]]:[])])grid.append(inputControl(title,shadow[property],value=>update(index,{[property]:value}),{number:true,min,max,key:key+'.'+index+'.'+property,ownerKey:key,session}));
      grid.append(inputControl('颜色',shadow.color,value=>update(index,{color:value}),{key:key+'.'+index+'.color',ownerKey:key,session}),inputControl('透明度 %',shadow.opacity*100,value=>update(index,{opacity:value/100}),{number:true,min:0,max:100,key:key+'.'+index+'.opacity',ownerKey:key,session}));entry.append(grid,btn('移除此阴影',()=>{set(session,key,valueOf(session,key).filter((_,i)=>i!==index));draw();}));list.append(entry);
    });}
    draw();const add=btn('添加'+label,()=>{if((valueOf(session,key)||[]).length>=8)return;set(session,key,[...(valueOf(session,key)||[]),{...(!textOnly?{inset:false,spread:0}:{}),x:0,y:3,blur:8,color:'#000000',opacity:.2}]);draw();});add.dataset.styleAction=key+'-add';add.disabled=(valueOf(session,key)||[]).length>=8;content.append(add);
  });
}
function build(root,session){
  root.classList.add('style-controls');
  const text=group(root,'text','文字',session),typography=node('div','style-grid');text.append(typography);
  scalar(typography,session,'fontFamily','字体',{nullable:true});scalar(typography,session,'fontSize','字号',{number:true,min:1,max:500});
  scalar(typography,session,'fontWeight','字重',{number:true,min:100,max:900,step:100});scalar(typography,session,'color','文字颜色');
  scalar(typography,session,'align','水平对齐',{options:[['left','左'],['center','居中'],['right','右']]});scalar(typography,session,'verticalAlign','垂直对齐',{nullable:true,options:[['','类型默认'],['top','顶部'],['middle','居中'],['bottom','底部']]});
  scalar(typography,session,'lineHeight','行高 px',{number:true,min:1,max:5000,nullable:true});scalar(typography,session,'letterSpacing','字距 px',{number:true,min:-100,max:1000,step:.1});
  const flags=node('div','style-flags');text.append(flags);for(const[key,label]of[['italic','斜体'],['underline','下划线'],['strike','删除线']])flag(flags,session,key,label);
  scalar(text,session,'textCase','字母大小写',{options:[['none','保持原文'],['uppercase','全部大写'],['lowercase','全部小写'],['capitalize','单词首字母大写']]});text.append(note('字体使用本机已安装字体；未安装时由系统回退，不下载字体。'));
  const fill=group(root,'fill','填充',session);scalar(fill,session,'fill','纯色填充');paintEditor(fill,session,'fillPaint','填充类型',true);scalar(fill,session,'fillOpacity','填充透明度',{number:true,min:0,max:1,step:.05});
  const border=group(root,'border','边框',session),borderGrid=node('div','style-grid');border.append(borderGrid);scalar(borderGrid,session,'stroke','纯色边框');scalar(borderGrid,session,'strokeWidth','统一宽度',{number:true,min:0,max:100});scalar(border,session,'strokeStyle','线型',{options:[['solid','实线'],['dashed','虚线'],['dotted','点线']]});tuple(border,session,'borderSides','各边宽度',sides,sideLabels,valueOf(session,'strokeWidth')||0,100);paintEditor(border,session,'strokePaint','边框类型',false);scalar(border,session,'strokeOpacity','边框透明度',{number:true,min:0,max:1,step:.05});
  const shape=group(root,'shape','圆角与内边距',session);scalar(shape,session,'radius','统一圆角',{number:true,min:0,max:50000});tuple(shape,session,'radiusCorners','各角圆角',cornerNames,cornerLabels,valueOf(session,'radius')||0,50000);tuple(shape,session,'padding','内边距',sides,sideLabels,0,1000);
  const effects=group(root,'effects','效果',session),effectsGrid=node('div','style-grid');effects.append(effectsGrid);scalar(effectsGrid,session,'opacity','整体不透明度',{number:true,min:0,max:1,step:.05});scalar(effectsGrid,session,'blur','元件模糊',{number:true,min:0,max:100});scalar(effectsGrid,session,'backdropBlur','背景模糊',{number:true,min:0,max:100});shadowsEditor(effects,session,'shadows','内外阴影');shadowsEditor(effects,session,'textShadows','文字阴影',true);
  const motion=group(root,'motion','状态过渡与旋转中心',session);
  keyBox(motion,session,'transition','状态过渡',content=>{const transition=valueOf(session,'transition');content.append(inputControl('时长 ms',transition.duration,duration=>set(session,'transition',{...valueOf(session,'transition'),duration}),{number:true,min:0,max:60000,key:'transition.duration',ownerKey:'transition',session}),inputControl('延迟 ms',transition.delay,delay=>set(session,'transition',{...valueOf(session,'transition'),delay}),{number:true,min:0,max:60000,key:'transition.delay',ownerKey:'transition',session}),inputControl('缓动',transition.easing,easing=>set(session,'transition',{...valueOf(session,'transition'),easing}),{options:[['linear','匀速'],['ease','自然'],['ease-in','渐入'],['ease-out','渐出'],['ease-in-out','渐入渐出']],key:'transition.easing',ownerKey:'transition',session}));});
  keyBox(motion,session,'transformOrigin','旋转中心',content=>{const origin=valueOf(session,'transformOrigin'),grid=node('div','style-grid');for(const[key,label]of[['x','横向 %'],['y','纵向 %']])grid.append(inputControl(label,origin[key]*100,value=>set(session,'transformOrigin',{...valueOf(session,'transformOrigin'),[key]:value/100}),{number:true,min:0,max:100,key:'transformOrigin.'+key,ownerKey:'transformOrigin',session}));content.append(grid,note('0% 是左侧或顶部，50% 是中心，100% 是右侧或底部。'));});
}
function openEditor(session,title){
  if(activeSession?.dialog?.open&&activeSession!==session){E.toast('请先保存或取消正在编辑的样式。','warning');return;}
  const dialog=node('dialog','style-dialog');dialog.id='style-editor-dialog';dialog.dataset.dirty=String(session.changes.size>0);session.dialog=dialog;activeSession=session;
  const header=node('div','style-dialog-header');header.append(node('h2','',title),btn('取消',()=>dialog.close()));dialog.append(header);
  if(session.state)dialog.append(note('勾选的属性覆盖继承外观；取消勾选恢复跟随。这里只临时预览，保存后才写入项目。状态样式在各视图共享。'));
  else dialog.append(note('这里只临时预览，保存时仅提交修改过的属性。'));
  const body=node('div','style-dialog-body');build(body,session);dialog.append(body);session.status=node('p','style-status');session.status.setAttribute('role','status');
  session.overwrite=btn('确认用草稿覆盖这些属性',()=>safely(()=>save(session,true)));session.overwrite.hidden=true;
  const saveButton=btn(session.state?'保存状态样式':session.kind==='shared'?'保存共享样式':session.kind==='default'?'保存项目默认':'保存这些修改',()=>safely(()=>save(session)));saveButton.dataset.styleAction='save';saveButton.classList.add('primary-button');
  dialog.append(session.status,row(session.overwrite,saveButton));dialog.addEventListener('close',()=>{if(activeSession===session)activeSession=null;dialog.remove();E.refresh();});document.body.append(dialog);dialog.showModal();E.refresh();
}
async function editState(id,state,context=E.captureContext()){
  if(!await E.flushPendingEdits())return;
  const value=E.getPage(context)?.nodes.find(value=>value.id===id);if(!value)return;
  openEditor(createSession('state',value,{...context,viewId:null,scope:'current'},{state}),states[state]+'时的外观');
}
function renderStates(root,value,context=E.captureContext()){
  const details=node('details','advanced-details');details.append(node('summary','','交互状态外观'));
  for(const[key,label]of Object.entries(states))details.append(btn('设置'+label+'样式',()=>editState(value.id,key,context)));root.append(details);
}
async function manageShared(){
  const context=E.captureContext();if(!await E.flushPendingEdits())return;
  const dialog=node('dialog','style-manager');dialog.id='style-manager';dialog.append(node('h2','','共享样式管理'));
  const list=node('div','style-shared-list');dialog.append(list);
  function draw(){list.replaceChildren();const styles=E.getState().project.styles;if(!styles.length)list.append(note('先选择元件，在共享样式中点击“新建”。'));
    for(const item of styles){const entry=node('section','style-shared-entry');entry.dataset.styleId=item.id;
      const edit=state=>{dialog.close();const value={id:item.id,type:'rectangle',style:clone(item.style)};openEditor(createSession('shared',value,context,{styleId:item.id,nodeType:'rectangle',...(state?{state}:{})}),(state?states[state]+' · ':'编辑共享样式 · ')+item.name);};
      entry.append(node('strong','',item.name),btn('编辑样式…',()=>edit()),inputControl('名称',item.name,async name=>{const ok=await E.command(()=>{const latest=E.getState().project.styles.find(value=>value.id===item.id);if(latest?.name!==item.name){E.toast('名称已被另一处修改，请关闭后重新打开管理窗口。','warning');return[];}return[{type:'updateStyle',styleId:item.id,patch:{name}}];},'重命名共享样式',context);if(ok)draw();}));
      const descendants=new Set([item.id]);let previous=-1;while(previous!==descendants.size){previous=descendants.size;for(const value of styles)if(descendants.has(value.parentId))descendants.add(value.id);}
      entry.append(inputControl('继承自',item.parentId||'',async parentId=>{const ok=await E.command(()=>{const latest=E.getState().project.styles.find(value=>value.id===item.id);if((latest?.parentId??null)!==(item.parentId??null)){E.toast('继承关系已被另一处修改，所选内容保留，请重新核对。','warning');return[];}return[{type:'setStyleParent',styleId:item.id,parentId:parentId||null}];},'修改样式继承',context);if(ok)draw();},{key:'styleParent',options:[['','项目默认'],...styles.filter(value=>!descendants.has(value.id)).map(value=>[value.id,value.name])]}));
      const stateList=node('details','style-state-list');stateList.append(node('summary','','悬停、选中等外观'));for(const[key,label]of Object.entries(states))stateList.append(btn(label,()=>edit(key)));entry.append(stateList);
      entry.append(row(btn('从此样式创建',()=>{dialog.close();W.openModal('新建子样式',(body,d)=>{const input=node('input');input.value=item.name+' · 子样式';input.setAttribute('aria-label','样式名称');body.append(input,btn('创建',()=>safely(async()=>{if(await E.command([{type:'addStyle',style:{id:crypto.randomUUID(),name:input.value.trim(),parentId:item.id,style:{}}}],'新建子样式',context)){d.close();manageShared();}})));});}),btn('删除样式',async()=>{if(await E.command([{type:'removeStyle',styleId:item.id}],'删除共享样式',context))draw();})));list.append(entry);}}
  draw();dialog.append(btn('关闭',()=>dialog.close()));dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
function renderInspector(root,value,{context=E.captureContext()}={}){const session=createSession('node',value,context),info=sessionInfo(session);const heading=node('div','style-inheritance-summary');heading.append(node('strong','','单独修改 '+info.ownKeys.length+' 项'),note(context.viewId?'当前视图的覆盖优先于基础样式。':'修改一个属性会保留共享样式关联。'));const reset=btn('恢复这些属性的跟随',()=>safely(async()=>{if(!await E.flushPendingEdits())return;await E.command([{type:'clearStyleOverrides',pageId:context.targetId,nodeIds:[value.id],keys:info.ownKeys}],'恢复样式跟随',context);}));reset.disabled=!info.ownKeys.length;heading.append(reset);root.append(heading);build(root,session);}
function simpleDialog(id,title){const dialog=node('dialog','style-manager');dialog.id=id;dialog.append(node('h2','',title));dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return dialog;}
function keyPicker(host,keys,checked=keys){const selected=new Set(checked),grid=node('div','style-key-picker');for(const key of keys){const control=checkControl(labels[key]||key,selected.has(key),value=>value?selected.add(key):selected.delete(key));control.querySelector('input').dataset.stylePick=key;grid.append(control);}host.append(grid);return selected;}
async function manageDefaults(){
  const context=E.captureContext();if(!await E.flushPendingEdits())return;const dialog=simpleDialog('style-defaults-dialog','项目默认外观'),body=node('div','style-default-list');dialog.append(note('新元件和仍跟随默认的属性会更新；单独修改过的属性、来源库的默认设置会保留。'),body);
  let selectedType=E.getNodes()[0]?.type||'rectangle';
  function draw(){body.replaceChildren();const p=E.getState().project,current=p.defaultStyleSetId,sets=p.defaultStyleSets||[];body.append(inputControl('使用默认设置',current||'',async id=>{if(await E.command([{type:'setProjectDefaultStyleSet',defaultStyleSetId:id||null}],'切换项目默认',context))draw();},{key:'defaultStyleSet',options:[['','内置默认'],...sets.map(item=>[item.id,item.name])]}));
    const create=btn('建立项目默认',()=>safely(async()=>{const id=crypto.randomUUID();if(await E.command([{type:'addDefaultStyleSet',defaultStyleSet:{id,name:'项目默认',byType:{}}},{type:'setProjectDefaultStyleSet',defaultStyleSetId:id}],'建立项目默认',context))draw();}));create.disabled=!!current;body.append(create,inputControl('元件类型',selectedType,value=>{selectedType=value;draw();},{key:'defaultNodeType',options:Object.entries(typeNames)}));
    const edit=state=>{const value={id:current,type:selectedType,style:S.getStyleInfo(E.getState().project,{defaultStyleSetId:current,nodeType:selectedType}).effective};dialog.close();openEditor(createSession('default',value,context,{defaultStyleSetId:current,nodeType:selectedType,...(state?{state}:{})}),'项目默认 · '+typeNames[selectedType]+(state?' · '+states[state]:''));};
    const base=btn('编辑此类型默认…',()=>edit());base.disabled=!current;body.append(base);
    if(current){const details=node('details','style-state-list');details.append(node('summary','','悬停、选中等默认外观'));for(const[key,label]of Object.entries(states))details.append(btn(label,()=>edit(key)));body.append(details);}
  }draw();dialog.append(btn('关闭',()=>dialog.close()));
}
function renderShared(root){
  const context=E.captureContext(),p=E.getState().project,selection=E.getNodes(),single=selection.length===1?selection[0]:null,currentOnly=!!context.viewId&&context.scope==='current',linked=selection.some(value=>E.getRawPage().groups?.some(group=>group.componentId&&group.nodeIds.includes(value.id)));
  root.append(node('h3','workspace-section-title',currentOnly?'当前视图 · 套用样式外观':'共享样式'));
  const select=node('select');select.setAttribute('aria-label','共享样式');select.dataset.styleLink='';const blank=node('option','',currentOnly?'选择要套用的外观':'未关联 / 保留当前外观');blank.value='';select.append(blank);for(const style of p.styles){const option=node('option','',style.name);option.value=style.id;select.append(option);}
  select.value=currentOnly?'':selection.length&&selection.every(value=>value.styleId===selection[0].styleId)?selection[0].styleId||'':'';select.disabled=!selection.length||linked;
  const keep=checkControl('保留单独修改',false,()=>{});keep.hidden=currentOnly;keep.querySelector('input').dataset.styleKeepLocal='';
  select.addEventListener('change',()=>safely(async()=>{const styleId=select.value;if(currentOnly&&!styleId)return;if(!await E.flushPendingEdits())return;await E.command([{type:'applyStyle',pageId:context.targetId,nodeIds:selection.map(value=>value.id),styleId:styleId||null,localPolicy:keep.querySelector('input').checked?'keep':'clear'}],currentOnly?'套用当前视图外观':'关联共享样式',context);}));
  root.append(select,keep);if(currentOnly)root.append(note('只复制到当前视图，不建立持续关联。基础关联：'+(p.styles.find(value=>value.id===single?.styleId)?.name||'无')));else if(single?.styleId)root.append(note('跟随：'+p.styles.find(value=>value.id===single.styleId)?.name+'；单独修改的字段仍保留。'));
  const create=btn('新建',()=>safely(async()=>{if(!await E.flushPendingEdits())return;const value=E.getPage(context)?.nodes.find(value=>value.id===single?.id);if(!value)return;W.openModal('保存共享样式',(body,d)=>{const input=node('input');input.value='新样式';input.setAttribute('aria-label','样式名称');body.append(input,row(btn('取消',()=>d.close()),btn('确定',()=>safely(async()=>{const id=crypto.randomUUID();if(await E.command([{type:'addStyle',style:{id,name:input.value.trim(),style:clone(value.style)}},{type:'applyStyle',pageId:context.targetId,nodeIds:selection.map(value=>value.id),styleId:id}],'创建共享样式',context))d.close();}))));});}));create.disabled=!single||linked;
  const write=btn('用此元件更新共享样式…',()=>safely(()=>writeBack()));write.disabled=!single?.styleId||!!context.viewId||linked;write.title=context.viewId?'请切到基础视图后回写':'选择要同步到共享样式的属性';
  const copy=btn('复制外观…',()=>safely(captureAppearance)),paste=btn('应用已复制外观',()=>safely(()=>applyAppearance(selection.map(value=>value.id),context)));copy.disabled=!single;paste.disabled=!appearanceClip||appearanceClip.projectId!==p.id||!selection.length||linked;
  root.append(row(create,btn('管理',()=>safely(manageShared))),btn('项目默认…',()=>safely(manageDefaults)),write,row(copy,paste));if(linked)root.append(note('此元件属于母版实例，请进入母版或先解除关联。'));
}
async function writeBack(){
  const context=E.captureContext(),selected=E.getNodes();if(context.viewId||selected.length!==1){E.toast('请在基础视图选择一个元件再回写。','warning');return;}if(!await E.flushPendingEdits())return;
  const item=E.getPage(context).nodes.find(value=>value.id===selected[0].id),p=E.getState().project,style=p.styles.find(value=>value.id===item.styleId);if(!style){E.toast('请先关联一个共享样式。','warning');return;}
  const session=createSession('node',item,context),styleSession=createSession('shared',{id:style.id,type:item.type,style:style.style},context,{styleId:style.id,nodeType:item.type}),targetVersions=new Map(S.STYLE_KEYS.map(key=>[key,fieldVersion(styleSession,key)]));
  const dialog=simpleDialog('style-writeback-dialog','更新共享样式 · '+style.name);dialog.append(note('把勾选属性写入共享样式，其他引用也会跟随更新；来源元件这些属性的单独修改会一并清除。文字、位置和交互不会回写。'));const keys=keyPicker(dialog,S.STYLE_KEYS,sessionInfo(session).ownKeys),selectedStates=new Set();const stateBox=node('details','style-state-list');stateBox.append(node('summary','','同时回写状态外观（可选）'));for(const[key,label]of Object.entries(states)){const input=checkControl(label,false,value=>value?selectedStates.add(key):selectedStates.delete(key));input.querySelector('input').dataset.stylePickState=key;stateBox.append(input);}dialog.append(stateBox);
  const stateBaseline=clone(item.stateStyles),namedStateBaseline=clone(style.stateStyles),status=node('p','style-status');dialog.append(status,row(btn('取消',()=>dialog.close()),btn('更新共享样式',()=>safely(async()=>{let blocked=false;const ok=await E.command(()=>{const latest=currentNode(session,true),target=E.getState().project.styles.find(value=>value.id===style.id);if(latest.styleId!==style.id||!keys.size&&!selectedStates.size||[...keys].some(key=>!same(session.baseline.get(key),fieldVersion(session,key))||!same(targetVersions.get(key),fieldVersion(styleSession,key)))||[...selectedStates].some(key=>!same(stateBaseline?.[key],latest.stateStyles?.[key])||!same(namedStateBaseline?.[key],target?.stateStyles?.[key]))){blocked=true;return[];}return[{type:'updateStyleFromNode',pageId:context.targetId,nodeId:item.id,styleId:style.id,keys:[...keys],states:[...selectedStates],clearSourceOverrides:true}];},'从元件回写共享样式',context);if(ok&&!blocked)dialog.close();else status.textContent='来源或共享样式已改变，选择已保留；请取消并重新核对后回写。';}))));
}
function appearanceOf(value){
  const style=clone(value.style),metrics=resolveNodeVisual(value);if(style.padding===null)style.padding=clone(metrics.padding);if(style.verticalAlign===null)style.verticalAlign=metrics.text.verticalAlign;if(style.lineHeight===null)style.lineHeight=metrics.text.lineHeight;if(style.fontFamily===null&&value.richText?.fontFamily)style.fontFamily=value.richText.fontFamily;return style;
}
async function captureAppearance(){
  const context=E.captureContext(),selection=E.getNodes();if(selection.length!==1){E.toast('先选择一个元件作为外观来源。','warning');return;}if(!await E.flushPendingEdits())return;
  const value=E.getPage(context)?.nodes.find(item=>item.id===selection[0].id);if(!value)return;const snapshot={style:appearanceOf(value)},capturedStates=S.resolveNodeStateStyles(E.getState().project,E.getRawPage(context.targetId).nodes.find(item=>item.id===value.id));
  const dialog=simpleDialog('style-copy-dialog','复制外观 · '+value.name);dialog.append(note('仅复制勾选的外观。包括填充图片；不包含文字、位置、图片元件的原图 / 裁剪、结构、交互或样式关联。'));const keys=keyPicker(dialog,S.STYLE_KEYS);let includeStates=false;const stateChoice=checkControl('同时复制悬停、选中等状态外观',false,value=>includeStates=value);stateChoice.querySelector('input').dataset.styleCopyStates='';dialog.append(stateChoice,row(btn('取消',()=>dialog.close()),btn('复制选中外观',()=>{if(!keys.size&&!includeStates){E.toast('至少选择一项外观。','warning');return;}appearanceClip={projectId:context.projectId,name:value.name,snapshot:{style:Object.fromEntries([...keys].map(key=>[key,clone(snapshot.style[key])])),...(includeStates?{stateStyles:clone(capturedStates)}:{})}};dialog.close();E.refresh();E.toast('外观已复制，可以选择目标后应用，或打开格式刷。');})));
}
async function applyAppearance(ids,context=E.captureContext()){
  if(!appearanceClip||appearanceClip.projectId!==context.projectId){E.toast('请先复制一个元件的外观。','warning');return false;}if(!ids.length)return false;if(!await E.flushPendingEdits())return false;const snapshot=clone(appearanceClip.snapshot);return E.command([{type:'applyStyleSnapshot',pageId:context.targetId,nodeIds:[...ids],snapshot}],'应用外观快照',context);
}
function stopBrush(){brush=null;document.body.classList.remove('style-brush-mode');document.querySelector('#style-brush-banner')?.remove();document.querySelector('#style-painter')?.setAttribute('aria-pressed','false');}
async function showFormatTools(){
  if(!await E.flushPendingEdits())return;stopBrush();const dialog=simpleDialog('style-format-dialog','格式刷'),selection=E.getNodes(),context=E.captureContext();dialog.append(note(appearanceClip?'已复制：'+appearanceClip.name:'先选择一个元件，复制它的外观。'));const capture=btn('从所选元件复制外观…',()=>{dialog.close();safely(captureAppearance);});capture.disabled=selection.length!==1;dialog.append(capture);
  const apply=btn('应用到所选元件',()=>safely(async()=>{if(await applyAppearance(selection.map(item=>item.id),context))dialog.close();}));apply.disabled=!appearanceClip||!selection.length;dialog.append(apply);let continuous=false;const mode=checkControl('连续应用，按 Esc 结束',false,value=>continuous=value);mode.querySelector('input').dataset.styleContinuous='';dialog.append(mode);
  const start=btn('开始格式刷',()=>{if(!appearanceClip)return;brush={projectId:context.projectId,continuous};dialog.close();document.body.classList.add('style-brush-mode');document.querySelector('#style-painter')?.setAttribute('aria-pressed','true');const banner=node('div','style-brush-banner');banner.id='style-brush-banner';banner.append(node('span','','格式刷 · 点击目标元件应用；Esc 结束'),btn('结束',stopBrush));document.querySelector('.canvas-column').prepend(banner);});start.disabled=!appearanceClip;dialog.append(start,btn('关闭',()=>dialog.close()));
}
document.addEventListener('pointerdown',event=>{if(!brush||event.button!==0||document.querySelector('dialog[open]'))return;const target=event.target.closest('#nodes [data-node-id]');if(!target)return;event.preventDefault();event.stopImmediatePropagation();const mode=brush,context=E.captureContext();safely(async()=>{const ok=await applyAppearance([target.dataset.nodeId],context);if(ok&&!mode.continuous)stopBrush();});},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&brush){event.preventDefault();event.stopImmediatePropagation();stopBrush();}},true);
document.addEventListener('yuanda:editorchange',()=>{if(appearanceClip&&appearanceClip.projectId!==E.getState()?.project.id){appearanceClip=null;stopBrush();}});
document.querySelector('#style-painter')?.addEventListener('click',()=>safely(showFormatTools));
function previewNode(value){
  const session=activeSession;if(!session?.dialog?.open||E.getState()?.project.id!==session.context.projectId)return value;
  const context=E.getEditingContext();if(['shared','default'].includes(session.kind)){
    if(!session.previewCache||session.previewCache.revision!==E.getState().revision||session.previewCache.version!==session.previewVersion){
      const p=clone(E.getState().project),set=session.kind==='default'?p.defaultStyleSets.find(item=>item.id===session.defaultStyleSetId):null,target=session.kind==='shared'?p.styles.find(item=>item.id===session.styleId):set?(set.byType[session.nodeType]||={style:{},stateStyles:{}}):null;if(!target)return value;
      if(session.state){target.stateStyles||={};const patch=target.stateStyles[session.state]||={};for(const[key,change]of session.changes)if(change.remove)delete patch[key];else patch[key]=clone(change.value);}
      else{target.style||={};for(const[key,change]of session.changes){if(session.kind==='shared'){target.overrideKeys||=[];target.overrideKeys=target.overrideKeys.filter(value=>value!==key);if(!change.remove)target.overrideKeys.push(key);}if(change.remove){if(session.kind==='default')delete target.style[key];}else target.style[key]=clone(change.value);}}
      session.previewCache={revision:E.getState().revision,version:session.previewVersion,project:p};
    }
    const p=session.previewCache.project,canvas=[...p.pages,...p.components].find(item=>item.id===context.targetId),raw=canvas?.nodes.find(item=>item.id===value.id);if(!raw)return value;
    if(session.state)return{...value,style:{...value.style,...S.resolveNodeStateStyles(p,raw)[session.state]}};
    const after=S.getStyleInfo(p,{node:raw,...(session.state?{state:session.state}:{})}),before=S.getStyleInfo(E.getState().project,{node:E.getRawPage(context.targetId).nodes.find(item=>item.id===value.id),...(session.state?{state:session.state}:{})});
    const style={...value.style};for(const key of S.STYLE_KEYS)if(!same(before.effective[key],after.effective[key])){const source=sessionInfo({...session,kind:'node',state:null,nodeId:value.id,context}).sourceByKey[key];if(source?.kind!=='view')style[key]=clone(after.effective[key]);}return{...value,style};
  }
  if(context.targetId!==session.context.targetId||(!session.state&&context.viewId!==session.context.viewId)||value.id!==session.nodeId)return value;
  if(!session.state)return{...value,style:draftStyle(session)};
  const raw=clone(currentNode(session,true));raw.stateStyles||={};raw.stateStyles[session.state]||={};for(const[key,change]of session.changes)if(change.remove)delete raw.stateStyles[session.state][key];else raw.stateStyles[session.state][key]=clone(change.value);return{...value,style:{...value.style,...S.resolveNodeStateStyles(E.getState().project,raw)[session.state]}};
}
window.YuandaStyle={renderInspector,renderStates,editState,manageShared,manageDefaults,renderShared,previewNode,
  preserveInspector:()=>!!document.activeElement?.matches('#inspector .style-controls input,#inspector .style-controls select'),
  hasPendingDraft:()=>!!(activeSession?.changes.size||activeSession?.dialog?.dataset.dirty==='true'),
  flush:async()=>{await pendingCommit;return!activeSession?.changes.size;}
};
if(E.getState())E.refresh();
