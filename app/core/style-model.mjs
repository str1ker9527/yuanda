/** Original serializable widget styles. Composite values are atomic, never arbitrary CSS. */
const LEGACY_STYLE_KEYS = ['fill','stroke','strokeWidth','radius','color','fontSize','fontWeight','align','opacity'];
export function newStyleDefaults() {
  return {fontFamily:null,italic:false,underline:false,strike:false,textCase:'none',lineHeight:null,letterSpacing:0,verticalAlign:null,padding:null,
    fillPaint:null,strokePaint:null,fillOpacity:1,strokeOpacity:1,borderSides:null,strokeStyle:'solid',radiusCorners:null,
    shadows:[],textShadows:[],blur:0,backdropBlur:0,transition:{duration:0,delay:0,easing:'ease'},transformOrigin:{x:.5,y:.5}};
}
export const STYLE_KEYS = Object.freeze([...LEGACY_STYLE_KEYS,...Object.keys(newStyleDefaults())]);
export const STYLE_STATES = Object.freeze(['hover','pressed','selected','disabled','error','focus','hint']);
export const STYLE_NODE_TYPES = Object.freeze(['rectangle','text','button','input','image','ellipse','line','textarea','checkbox','radio','select','table','dynamicPanel','repeater','path','connector']);

/** Pure built-in defaults, independent of a project and safe to serialize into HTML. */
export function getBuiltinStyle(type) {
  const style={...newStyleDefaults(),fill:type==='text'?'transparent':type==='button'?'#191919':'#FFFFFF',stroke:type==='text'?'transparent':'#D1D5DB',strokeWidth:type==='text'?0:1,radius:type==='text'?0:4,color:type==='button'?'#FFFFFF':'#191919',fontSize:type==='text'?16:14,fontWeight:type==='button'?500:400,align:['text','input','textarea','checkbox','radio','select'].includes(type)?'left':'center',opacity:1};
  if(type==='ellipse')style.radius=50000;
  if(['line','path','connector'].includes(type))Object.assign(style,{fill:'transparent',stroke:'#191919',strokeWidth:2,radius:0});
  if(['textarea','select','table'].includes(type))style.stroke='#D7DCE7';
  if(['checkbox','radio'].includes(type))Object.assign(style,{fill:'transparent',strokeWidth:0,radius:0});
  if(type==='table')style.radius=0;
  if(['dynamicPanel','repeater'].includes(type))style.fill='transparent';
  return style;
}

/** Only authored named fields enter this patch; defaults remain type dependent. */
export function resolveNamedStylePatch(project,styleId) {
  const chain=[],seen=new Set();let id=styleId;
  while(id!=null){if(seen.has(id)||chain.length>=32)throw Object.assign(new Error('命名样式继承不能循环或超过 32 层'),{code:'VALIDATION_ERROR'});seen.add(id);const value=(project.styles||[]).find(item=>item.id===id);if(!value)throw Object.assign(new Error('引用样式不存在：'+id),{code:'VALIDATION_ERROR'});chain.unshift(value);id=value.parentId??null;}
  const result={style:{},stateStyles:{}};
  for(const named of chain){for(const key of named.overrideKeys??Object.keys(named.style))Object.defineProperty(result.style,key,{value:structuredClone(named.style[key]),enumerable:true,writable:true,configurable:true});for(const[state,patch]of Object.entries(named.stateStyles||{}))Object.defineProperty(result.stateStyles,state,{value:{...result.stateStyles[state],...structuredClone(patch)},enumerable:true,writable:true,configurable:true});}
  return result;
}
export function resolveNodeBaseStyle(project,node) {
  const id=node.defaultStyleSetId??project.defaultStyleSetId??null,set=id===null?null:(project.defaultStyleSets||[]).find(item=>item.id===id);
  if(id!==null&&!set)throw Object.assign(new Error('默认样式集不存在：'+id),{code:'VALIDATION_ERROR'});
  const defaults=set&&Object.hasOwn(set.byType,node.type)?set.byType[node.type].style||{}:{};
  const local={};for(const key of node.styleOverrideKeys??Object.keys(node.style||{}))Object.defineProperty(local,key,{value:structuredClone(node.style[key]),enumerable:true,writable:true,configurable:true});
  return {...getBuiltinStyle(node.type),...structuredClone(defaults),...resolveNamedStylePatch(project,node.styleId).style,...local};
}
export function resolveNodeStateStyles(project,node) {
  const id=node.defaultStyleSetId??project.defaultStyleSetId??null,set=id===null?null:(project.defaultStyleSets||[]).find(item=>item.id===id);
  if(id!==null&&!set)throw Object.assign(new Error('默认样式集不存在：'+id),{code:'VALIDATION_ERROR'});
  const result={},defaults=set&&Object.hasOwn(set.byType,node.type)?set.byType[node.type].stateStyles||{}:{};
  for(const layer of [defaults,resolveNamedStylePatch(project,node.styleId).stateStyles,node.stateStyles||{}])for(const[state,patch]of Object.entries(layer))Object.defineProperty(result,state,{value:{...result[state],...structuredClone(patch)},enumerable:true,writable:true,configurable:true});
  return result;
}
export function resolveNodeBaseAppearance(project,node){return {style:resolveNodeBaseStyle(project,node),stateStyles:resolveNodeStateStyles(project,node)};}
export function getNodeStyleInfo(project,node) {
  const id=node.defaultStyleSetId??project.defaultStyleSetId??null,set=(project.defaultStyleSets||[]).find(item=>item.id===id),sources={},stateSources={};
  for(const key of Object.keys(getBuiltinStyle(node.type)))sources[key]={kind:'builtin',id:null};
  const record=(style,states,source)=>{for(const key of Object.keys(style||{}))sources[key]=source;for(const[state,patch]of Object.entries(states||{})){stateSources[state]||={};for(const key of Object.keys(patch))stateSources[state][key]=source;}};
  const defaults=set&&Object.hasOwn(set.byType,node.type)?set.byType[node.type]:{};record(defaults.style,defaults.stateStyles,{kind:'default',id});
  const chain=[],seen=new Set();let next=node.styleId;while(next!=null){if(seen.has(next)||chain.length>=32)throw new Error('命名样式父链无效');seen.add(next);const named=project.styles.find(item=>item.id===next);if(!named)throw new Error('命名样式不存在');chain.unshift(named);next=named.parentId;}
  for(const named of chain)record(Object.fromEntries(named.overrideKeys.map(key=>[key,named.style[key]])),named.stateStyles,{kind:'named',id:named.id});
  const localKeys=[...(node.styleOverrideKeys||[])];record(Object.fromEntries(localKeys.map(key=>[key,node.style[key]])),node.stateStyles,{kind:'local',id:node.id});
  return {...resolveNodeBaseAppearance(project,node),localKeys,styleId:node.styleId,defaultStyleSetId:id,sources,stateSources};
}
export function getStyleInfo(project,target) {
  const type=target.nodeType||target.node?.type||'rectangle',state=target.state;
  if(target.node){const node=target.node,info=getNodeStyleInfo(project,node),base=resolveNodeBaseStyle(project,{...node,styleOverrideKeys:[]});return {effective:state?{...info.style,...info.stateStyles[state]}:info.style,inherited:state?{...info.style,...resolveNodeStateStyles(project,{...node,stateStyles:{}})[state]}:base,ownKeys:state?Object.keys(node.stateStyles?.[state]||{}):info.localKeys,sourceByKey:state?{...info.sources,...info.stateSources[state]}:info.sources};}
  const builtin=getBuiltinStyle(type);
  if(Object.hasOwn(target,'styleId')){const named=project.styles.find(item=>item.id===target.styleId);if(!named)throw new Error('命名样式不存在');const parent=resolveNamedStylePatch(project,named.parentId),patch=resolveNamedStylePatch(project,named.id),inherited={...builtin,...parent.style},effective={...builtin,...patch.style};return {effective:state?{...effective,...patch.stateStyles[state]}:effective,inherited:state?{...effective,...parent.stateStyles[state]}:inherited,ownKeys:state?Object.keys(named.stateStyles[state]||{}):[...named.overrideKeys],sourceByKey:getNodeStyleInfo({...project,defaultStyleSetId:null},{id:'preview',type,styleId:named.id,defaultStyleSetId:null,style:builtin,styleOverrideKeys:[],stateStyles:{}}).sources};}
  const set=project.defaultStyleSets.find(item=>item.id===target.defaultStyleSetId);if(!set)throw new Error('默认样式集不存在');const layer=Object.hasOwn(set.byType,type)?set.byType[type]:{},effective={...builtin,...layer.style};return {effective:state?{...effective,...layer.stateStyles?.[state]}:effective,inherited:state?effective:builtin,ownKeys:Object.keys(state?layer.stateStyles?.[state]||{}:layer.style||{}),sourceByKey:Object.fromEntries(Object.keys(builtin).map(key=>[key,{kind:Object.hasOwn(layer.style||{},key)?'default':'builtin',id:Object.hasOwn(layer.style||{},key)?set.id:null}]))};
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
/** Composite styles compare by content, including dictionaries with different key order. */
export function styleValueEqual(left,right) {
  if(left===right)return true;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>styleValueEqual(value,right[index]));
  if(!plain(left)||!plain(right))return false;
  const keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&styleValueEqual(left[key],right[key]));
}

/** Only fill missing top-level additions in complete styles. Sparse patches stay sparse. */
export function normalizeStyleProject(project) {
  const complete = [];
  if(Array.isArray(project?.styles)) for(const named of project.styles) complete.push(named?.style);
  for(const key of ['pages','components']) if(Array.isArray(project?.[key])) for(const canvas of project[key]) {
    if(Array.isArray(canvas?.nodes)) for(const node of canvas.nodes) complete.push(node?.style);
  }
  for(const style of complete) if(plain(style)) for(const [key,value] of Object.entries(newStyleDefaults())) {
    if(!Object.hasOwn(style,key)) Object.defineProperty(style,key,{value,writable:true,configurable:true,enumerable:true});
  }
  if(!plain(project))return project;
  for(const [key,value]of Object.entries({styleInheritanceVersion:1,defaultStyleSets:[],defaultStyleSetId:null}))if(!Object.hasOwn(project,key))project[key]=value;
  for(const named of Array.isArray(project.styles)?project.styles:[])if(plain(named)){
    if(!Object.hasOwn(named,'parentId'))named.parentId=null;
    if(!Object.hasOwn(named,'stateStyles'))named.stateStyles={};
    if(!Object.hasOwn(named,'overrideKeys'))named.overrideKeys=plain(named.style)?Object.keys(named.style):[];
  }
  for(const canvas of [...(Array.isArray(project.pages)?project.pages:[]),...(Array.isArray(project.components)?project.components:[])])for(const node of Array.isArray(canvas?.nodes)?canvas.nodes:[])if(plain(node)){
    if(!Object.hasOwn(node,'defaultStyleSetId'))node.defaultStyleSetId=null;
    if(!Object.hasOwn(node,'styleOverrideKeys')){
      let inherited=null;
      if(node.styleId!=null)try{inherited={...getBuiltinStyle(node.type),...resolveNamedStylePatch(project,node.styleId).style};}catch{}
      node.styleOverrideKeys=plain(node.style)?Object.keys(node.style).filter(key=>!inherited||!styleValueEqual(node.style[key],inherited[key])):[];
    }
  }
  return project;
}

/** Validate stored values BEFORE any inherited cache is refreshed. */
export function validateStyleInheritance(project,h) {
  if(project.styleInheritanceVersion!==1)h.fail('不支持的样式继承版本');
  h.array(project.defaultStyleSets,'默认样式集',100);
  const mask=(value,label)=>{h.array(value,label,STYLE_KEYS.length);if(new Set(value).size!==value.length||value.some(key=>!STYLE_KEYS.includes(key)))h.fail(label+' 含重复或不支持的字段');};
  const partial=(value,label)=>{h.keys(value,STYLE_KEYS,label,false);h.validateStyle({...getBuiltinStyle('rectangle'),...value});};
  const states=value=>{h.keys(value,STYLE_STATES,'状态样式',false);for(const patch of Object.values(value))partial(patch,'状态属性');};
  const setIds=new Set();
  for(const set of project.defaultStyleSets){h.keys(set,['id','name','byType'],'默认样式集');h.id(set.id,'默认样式集 ID');if(setIds.has(set.id))h.fail('默认样式集 ID 重复');setIds.add(set.id);h.string(set.name,'默认样式集名称',200,1);h.keys(set.byType,STYLE_NODE_TYPES,'按类型默认样式',false);for(const layer of Object.values(set.byType)){h.keys(layer,['style','stateStyles'],'默认样式层',false);if(Object.hasOwn(layer,'style'))partial(layer.style,'默认样式');if(Object.hasOwn(layer,'stateStyles'))states(layer.stateStyles);}}
  const setRef=id=>{if(id!==null){h.id(id,'默认样式集引用');if(!setIds.has(id))h.fail('默认样式集不存在：'+id);}};setRef(project.defaultStyleSetId);
  const namedIds=new Set();
  for(const named of project.styles){h.keys(named,['id','name','style','parentId','overrideKeys','stateStyles'],'命名样式');h.id(named.id,'命名样式 ID');if(namedIds.has(named.id))h.fail('命名样式 ID 重复');namedIds.add(named.id);h.string(named.name,'命名样式名称',200,1);h.validateStyle(named.style);mask(named.overrideKeys,'命名样式覆盖字段');states(named.stateStyles);if(named.parentId!==null)h.id(named.parentId,'父样式 ID');}
  for(const named of project.styles){if(named.parentId!==null&&!namedIds.has(named.parentId))h.fail('父样式不存在');resolveNamedStylePatch(project,named.id);}
  for(const canvas of [...project.pages,...project.components])for(const node of canvas.nodes){h.validateStyle(node.style);mask(node.styleOverrideKeys,'元件局部样式字段');setRef(node.defaultStyleSetId);states(node.stateStyles);if(node.styleId!==null&&!namedIds.has(node.styleId))h.fail('引用样式不存在：'+node.styleId);}
}

/** Commands mutate only the transaction draft. Runtime resolvers never author metadata. */
export function applyStyleInheritanceCommand(project,c,h) {
  const known=['addDefaultStyleSet','updateDefaultStyleSet','setProjectDefaultStyleSet','removeDefaultStyleSet','setNodeDefaultStyleSet','clearDefaultStyleOverrides','addStyle','updateStyle','removeStyle','applyStyle','setStyleParent','clearNamedStyleOverrides','clearStyleOverrides','applyStyleSnapshot','updateStyleFromNode'];
  if(!known.includes(c.type))return false;
  const own=(value,key)=>Object.hasOwn(value,key),clone=value=>structuredClone(value),fail=message=>h.fail(message,'COMMAND_ERROR');
  const check=(required,optional=[])=>{h.keys(c,['type',...required,...optional],'样式命令',false);for(const key of required)if(!own(c,key))fail('样式命令缺少 '+key);};
  const style=id=>{const value=project.styles.find(value=>value.id===id);if(!value)fail('命名样式不存在');return value;};
  const set=id=>{const value=project.defaultStyleSets.find(value=>value.id===id);if(!value)fail('默认样式集不存在');return value;};
  const selected=()=>{const canvas=h.pageFor(project,c.pageId);h.array(c.nodeIds,'元件 ID',5000);if(!c.nodeIds.length||new Set(c.nodeIds).size!==c.nodeIds.length)fail('请选择不同的元件');return c.nodeIds.map(id=>{const node=h.nodeFor(canvas,id);h.assertEditable(canvas,node,null);return node;});};
  const selectedKeys=(value,fallback)=>{const list=value??fallback;h.array(list,'样式字段',STYLE_KEYS.length);if(new Set(list).size!==list.length||list.some(key=>!STYLE_KEYS.includes(key)))fail('样式字段无效或重复');return list;};
  const stateName=()=>{if(own(c,'state')&&!STYLE_STATES.includes(c.state))fail('状态名称无效');return c.state;};
  const clear=(target,maskKey)=>{const state=stateName();if(state){const patch=target.stateStyles[state]||{};for(const key of selectedKeys(c.keys,Object.keys(patch)))delete patch[key];if(Object.keys(patch).length)target.stateStyles[state]=patch;else delete target.stateStyles[state];}else{const fields=new Set(selectedKeys(c.keys,target[maskKey]));target[maskKey]=target[maskKey].filter(key=>!fields.has(key));}};
  const pin=node=>{node.style=resolveNodeBaseStyle(project,node);node.stateStyles=resolveNodeStateStyles(project,node);node.styleId=null;node.styleOverrideKeys=[...STYLE_KEYS];};
  switch(c.type){
    case 'addDefaultStyleSet':check(['defaultStyleSet']);h.keys(c.defaultStyleSet,['id','name','byType'],'默认样式集设置',false);project.defaultStyleSets.push({id:h.uuid(),name:'默认样式集',byType:{},...clone(c.defaultStyleSet)});break;
    case 'updateDefaultStyleSet':check(['defaultStyleSetId','patch']);h.keys(c.patch,['name','byType'],'默认样式集修改',false);Object.assign(set(c.defaultStyleSetId),clone(c.patch));break;
    case 'setProjectDefaultStyleSet':check(['defaultStyleSetId']);if(c.defaultStyleSetId!==null)set(c.defaultStyleSetId);project.defaultStyleSetId=c.defaultStyleSetId;break;
    case 'removeDefaultStyleSet':check(['defaultStyleSetId']);set(c.defaultStyleSetId);if(project.defaultStyleSetId===c.defaultStyleSetId||[...project.pages,...project.components].some(canvas=>canvas.nodes.some(node=>node.defaultStyleSetId===c.defaultStyleSetId)))fail('默认样式集仍被项目或元件引用，不能删除');project.defaultStyleSets=project.defaultStyleSets.filter(value=>value.id!==c.defaultStyleSetId);break;
    case 'setNodeDefaultStyleSet':check(['pageId','nodeIds','defaultStyleSetId']);if(c.defaultStyleSetId!==null)set(c.defaultStyleSetId);for(const node of selected())node.defaultStyleSetId=c.defaultStyleSetId;break;
    case 'clearDefaultStyleOverrides':{check(['defaultStyleSetId','nodeType'],['keys','state']);if(!STYLE_NODE_TYPES.includes(c.nodeType))fail('元件类型无效');const value=set(c.defaultStyleSetId),layer=own(value.byType,c.nodeType)?value.byType[c.nodeType]:{},state=stateName(),patch=state?layer.stateStyles?.[state]||{}:layer.style||{};for(const key of selectedKeys(c.keys,Object.keys(patch)))delete patch[key];break;}
    case 'addStyle':{check(['style']);h.keys(c.style,['id','name','style','parentId','overrideKeys','stateStyles'],'命名样式设置',false);if(own(c.style,'style'))h.keys(c.style.style,STYLE_KEYS,'命名样式属性',false);project.styles.push({id:h.uuid(),name:'新样式',parentId:null,stateStyles:{},...clone(c.style),style:{...getBuiltinStyle('rectangle'),...clone(c.style.style||{})},overrideKeys:own(c.style,'overrideKeys')?clone(c.style.overrideKeys):Object.keys(c.style.style||{})});break;}
    case 'updateStyle':{check(['styleId','patch']);h.keys(c.patch,['name','style','stateStyles'],'命名样式修改',false);const named=style(c.styleId);if(own(c.patch,'name'))named.name=c.patch.name;if(own(c.patch,'stateStyles'))named.stateStyles=clone(c.patch.stateStyles);if(own(c.patch,'style')){h.keys(c.patch.style,STYLE_KEYS,'命名样式属性',false);named.style={...named.style,...clone(c.patch.style)};named.overrideKeys=[...new Set([...named.overrideKeys,...Object.keys(c.patch.style)])];}break;}
    case 'setStyleParent':check(['styleId','parentId']);style(c.styleId).parentId=c.parentId;break;
    case 'clearNamedStyleOverrides':check(['styleId'],['keys','state']);clear(style(c.styleId),'overrideKeys');break;
    case 'clearStyleOverrides':check(['pageId','nodeIds'],['keys','state']);for(const node of selected())clear(node,'styleOverrideKeys');break;
    case 'removeStyle':{
      check(['styleId']);const removed=style(c.styleId);
      for(const canvas of [...project.pages,...project.components])for(const node of canvas.nodes)if(node.styleId===removed.id)pin(node);
      // Splice only the deleted layer into each child. Resolving the full chain
      // here would pin grandparent values and silently stop future inheritance.
      const inherited=Object.fromEntries(removed.overrideKeys.map(key=>[key,clone(removed.style[key])]));
      for(const named of project.styles.filter(value=>value.parentId===removed.id)){
        const local=Object.fromEntries(named.overrideKeys.map(key=>[key,clone(named.style[key])]));
        named.parentId=removed.parentId;named.style={...named.style,...inherited,...local};
        named.overrideKeys=[...new Set([...removed.overrideKeys,...named.overrideKeys])];
        const states=clone(removed.stateStyles);
        for(const[state,patch]of Object.entries(named.stateStyles))states[state]={...states[state],...clone(patch)};
        named.stateStyles=states;
      }
      project.styles=project.styles.filter(named=>named.id!==removed.id);break;
    }
    case 'applyStyle':check(['pageId','nodeIds','styleId'],['localPolicy']);if(c.styleId!==null)style(c.styleId);if(!['clear','keep'].includes(c.localPolicy??'clear'))fail('局部样式策略必须为 clear 或 keep');for(const node of selected()){if(c.styleId===null)pin(node);else{node.styleId=c.styleId;if((c.localPolicy??'clear')==='clear')node.styleOverrideKeys=[];}}break;
    case 'applyStyleSnapshot':{check(['pageId','nodeIds','snapshot']);h.keys(c.snapshot,['style','stateStyles'],'样式快照',false);if(!own(c.snapshot,'style'))fail('样式快照缺少 style');h.keys(c.snapshot.style,STYLE_KEYS,'快照属性',false);if(own(c.snapshot,'stateStyles')){h.keys(c.snapshot.stateStyles,STYLE_STATES,'快照状态',false);for(const patch of Object.values(c.snapshot.stateStyles))h.keys(patch,STYLE_KEYS,'快照状态属性',false);}for(const node of selected()){node.style={...node.style,...clone(c.snapshot.style)};node.styleOverrideKeys=[...new Set([...node.styleOverrideKeys,...Object.keys(c.snapshot.style)])];for(const[state,patch]of Object.entries(c.snapshot.stateStyles||{}))node.stateStyles[state]={...node.stateStyles[state],...clone(patch)};}break;}
    case 'updateStyleFromNode':{check(['pageId','nodeId','styleId'],['keys','states','clearSourceOverrides']);const canvas=h.pageFor(project,c.pageId),node=h.nodeFor(canvas,c.nodeId),named=style(c.styleId);h.assertEditable(canvas,node,null);if(node.styleId!==named.id)fail('回写目标必须是该元件关联的命名样式');const fields=selectedKeys(c.keys,node.styleOverrideKeys),states=c.states??[];h.array(states,'回写状态',STYLE_STATES.length);if(new Set(states).size!==states.length||states.some(state=>!STYLE_STATES.includes(state)))fail('回写状态无效');if(own(c,'clearSourceOverrides'))h.bool(c.clearSourceOverrides,'清除来源覆盖');const appearance=resolveNodeBaseAppearance(project,node);for(const key of fields)named.style[key]=clone(appearance.style[key]);named.overrideKeys=[...new Set([...named.overrideKeys,...fields])];for(const state of states)named.stateStyles[state]={...named.stateStyles[state],...clone(appearance.stateStyles[state]||{})};if(c.clearSourceOverrides){node.styleOverrideKeys=node.styleOverrideKeys.filter(key=>!fields.includes(key));for(const state of states)delete node.stateStyles[state];}break;}
  }
  return true;
}

/** h supplies the common document validators and the bounded image-header validator. */
export function validateStyle(style,h) {
  h.keys(style,STYLE_KEYS,'样式');
  for(const field of ['fill','stroke','color']) h.color(style[field],`样式 ${field}`);
  h.number(style.strokeWidth,'边框宽度',0,100);h.number(style.radius,'圆角',0,50000);h.number(style.fontSize,'字号',1,500);
  h.number(style.fontWeight,'字重',100,900);h.number(style.opacity,'不透明度',0,1);
  const oneOf=(value,allowed,label)=>{if(!allowed.includes(value))h.fail(`${label} 必须是 ${allowed.join('、')}`);};
  oneOf(style.align,['left','center','right'],'文字对齐');
  if(style.fontFamily!==null) {
    h.string(style.fontFamily,'字体名称',100,1);
    if(!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(style.fontFamily)||style.fontFamily.trim()!==style.fontFamily)h.fail('字体必须是单个字体名称，只能包含文字、数字、空格、短横线或下划线');
  }
  for(const field of ['italic','underline','strike'])h.bool(style[field],`文字 ${field}`);
  oneOf(style.textCase,['none','uppercase','lowercase','capitalize'],'大小写转换');
  if(style.lineHeight!==null)h.number(style.lineHeight,'行高（像素）',1,5000);
  h.number(style.letterSpacing,'字间距（像素）',-100,1000);
  oneOf(style.verticalAlign,[null,'top','middle','bottom'],'垂直对齐');
  const sides=(value,keys,label,max)=>{if(value===null)return;h.keys(value,keys,label);for(const key of keys)h.number(value[key],`${label} ${key}`,0,max);};
  sides(style.padding,['top','right','bottom','left'],'内边距',1000);
  sides(style.borderSides,['top','right','bottom','left'],'独立边框宽度',100);
  sides(style.radiusCorners,['topLeft','topRight','bottomRight','bottomLeft'],'独立圆角',50000);
  oneOf(style.strokeStyle,['solid','dashed','dotted'],'边框线型');
  for(const field of ['fillOpacity','strokeOpacity'])h.number(style[field],`样式 ${field}`,0,1);
  function paint(value,allowImage,label) {
    if(value===null)return;
    if(!plain(value))h.fail(`${label} 必须是普通对象或 null`);
    if(value.type==='image'&&allowImage) {
      h.keys(value,['type','src','fit','positionX','positionY'],label);h.imageDataBytes(value.src);
      oneOf(value.fit,['cover','contain','stretch','tile'],'图片填充方式');
      h.number(value.positionX,'图片填充横向位置',0,1);h.number(value.positionY,'图片填充纵向位置',0,1);return;
    }
    if(value.type==='linear') {h.keys(value,['type','angle','stops'],label);h.number(value.angle,'渐变角度',-360,360);}
    else if(value.type==='radial') {h.keys(value,['type','cx','cy','radius','stops'],label);h.number(value.cx,'径向渐变横向中心',0,1);h.number(value.cy,'径向渐变纵向中心',0,1);h.number(value.radius,'径向渐变半径',0,2);if(value.radius===0)h.fail('径向渐变半径必须大于 0');}
    else h.fail(`${label} 类型必须是 linear、radial${allowImage?' 或 image':''}`);
    h.array(value.stops,'渐变色标',16);if(value.stops.length<2)h.fail('渐变至少需要 2 个色标');
    let previous=-1;
    for(const stop of value.stops) {h.keys(stop,['offset','color','opacity'],'渐变色标');h.number(stop.offset,'色标位置',0,1);h.color(stop.color,'色标颜色');h.number(stop.opacity,'色标不透明度',0,1);if(stop.offset<previous)h.fail('渐变色标须按位置从小到大排列');previous=stop.offset;}
  }
  paint(style.fillPaint,true,'填充绘制');paint(style.strokePaint,false,'边框绘制');
  function shadows(list,text) {
    h.array(list,text?'文字阴影':'内外阴影',8);
    for(const shadow of list) {
      h.keys(shadow,text?['x','y','blur','color','opacity']:['inset','x','y','blur','spread','color','opacity'],'阴影');
      if(!text){h.bool(shadow.inset,'内阴影');h.number(shadow.spread,'阴影扩展',-1000,1000);}
      h.number(shadow.x,'阴影横向偏移',-10000,10000);h.number(shadow.y,'阴影纵向偏移',-10000,10000);h.number(shadow.blur,'阴影模糊',0,1000);h.color(shadow.color,'阴影颜色');h.number(shadow.opacity,'阴影不透明度',0,1);
    }
  }
  shadows(style.shadows,false);shadows(style.textShadows,true);
  h.number(style.blur,'元件模糊',0,100);h.number(style.backdropBlur,'背景模糊',0,100);
  h.keys(style.transition,['duration','delay','easing'],'样式过渡');
  h.number(style.transition.duration,'过渡时长（毫秒）',0,60000);h.number(style.transition.delay,'过渡延迟（毫秒）',0,60000);
  oneOf(style.transition.easing,['linear','ease','ease-in','ease-out','ease-in-out'],'过渡曲线');
  h.keys(style.transformOrigin,['x','y'],'旋转原点');h.number(style.transformOrigin.x,'旋转原点横向位置',0,1);h.number(style.transformOrigin.y,'旋转原点纵向位置',0,1);
}

/** Traverse only validated, recognized style containers; count stored occurrences, not resolved inheritance. */
export function collectStyleImageSources(project) {
  const sources=[];
  const style=value=>{if(value?.fillPaint?.type==='image')sources.push(value.fillPaint.src);};
  const events=list=>{for(const event of list||[])for(const action of event.actions||[])if(action.type==='setStyle')style(action.style);};
  const overrides=map=>{for(const nodes of Object.values(map||{}))for(const patch of Object.values(nodes))style(patch.style);};
  for(const named of project.styles){style(named.style);for(const patch of Object.values(named.stateStyles||{}))style(patch);}
  for(const set of project.defaultStyleSets||[])for(const layer of Object.values(set.byType)){style(layer.style);for(const patch of Object.values(layer.stateStyles||{}))style(patch);}
  for(const canvas of [...project.pages,...project.components]) {
    for(const node of canvas.nodes){style(node.style);for(const patch of Object.values(node.stateStyles))style(patch);events(node.interactions);}
    events(canvas.interactions);overrides(canvas.viewOverrides);
    for(const view of canvas.views||[])if(view.overrides)for(const patch of Object.values(view.overrides))style(patch.style);
  }
  return sources;
}
