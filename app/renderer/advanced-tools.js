/* Event, state, data and responsive authoring. Values remain data, never executable code. */
(() => {
  'use strict';
  const E = window.YuandaEditor, W = window.YuandaTools;
  const { node, btn, row, field, check, note, openModal, command } = W;
  const $ = selector => document.querySelector(selector);
  const clone = value => structuredClone(value);
  const uid = () => crypto.randomUUID();
  const eventNames = { click:'单击时', dblclick:'双击时', contextmenu:'鼠标右键', mousemove:'鼠标移动', mouseenter:'鼠标进入', mouseleave:'鼠标离开', mousedown:'鼠标按下', mouseup:'鼠标松开', change:'值改变', input:'输入时', focus:'获得焦点', blur:'失去焦点', keydown:'按下按键', keyup:'松开按键', load:'载入时', stateChange:'状态改变',dragStart:'开始拖动',drag:'拖动中',dragEnd:'结束拖动',scroll:'面板滚动',adaptiveViewChange:'自适应视图改变',windowResize:'窗口尺寸改变',windowScroll:'窗口滚动',variableChange:'项目变量改变' };
  const actionNames = { setText:'修改文字',setVisible:'显示或隐藏',toggleVisible:'切换显示',navigate:'跳转页面',wait:'等待',setVariable:'设置变量',setValue:'设置输入值',setChecked:'设置勾选',setSelected:'设置选中状态',setDisabled:'设置禁用',setError:'设置错误状态',move:'移动元件',resize:'改变大小',setStyle:'改变样式',setPanelState:'切换面板状态',nextPanelState:'下一个状态',previousPanelState:'上一个状态',addRows:'添加数据行',deleteRows:'删除数据行',updateRows:'修改数据行',filterRows:'筛选数据行',sortRows:'排序数据行',setRepeaterPage:'切换数据页',setRepeaterPageSize:'设置每页数量',markRows:'标记或取消标记行' };
  const repeaterProperties = [['currentPage','当前页'],['pageCount','总页数'],['pageSize','每页数量'],['totalCount','全部行数'],['filteredCount','筛选后行数'],['markedCount','已标记行数']];
  const eventPropertyNames = {value:'输入值',key:'按键',checked:'是否勾选',rowId:'触发事件的行编号',x:'鼠标 X',y:'鼠标 Y',deltaX:'本次拖动横向位移',deltaY:'本次拖动纵向位移',scrollX:'横向滚动位置',scrollY:'纵向滚动位置',cancelled:'拖动是否取消',viewId:'当前自适应视图',previousViewId:'此前自适应视图',reason:'视图改变原因',windowWidth:'窗口宽度',windowHeight:'窗口高度',scrollDeltaX:'本次窗口横向滚动量',scrollDeltaY:'本次窗口纵向滚动量',variableName:'变化的变量名',previousValue:'变量变化前的值',ctrlKey:'是否按住 Ctrl',shiftKey:'是否按住 Shift',altKey:'是否按住 Alt',metaKey:'是否按住 Command / Meta'};
  Object.assign(actionNames,{setAdaptiveView:'切换自适应视图',focus:'聚焦输入控件',triggerEvent:'触发目标交互'});
  let interactionModel = null;
  import('../core/interaction-model.mjs').then(model=>{interactionModel=model;schedule();}).catch(error=>E.toast(`交互设置未能载入：${error.message}`,'error'));
  let pending = false, editingViewId = null, lastPageId = null, currentEvent = 'click';
  const editingStates = new Map();
  const sourcePage = () => E.getPage();
  const selection = () => E.getNodes();
  const focused = root => root?.contains(document.activeElement) && document.activeElement.matches('input,select,textarea,[contenteditable]');
  const hasFeature = () => Array.isArray(E.getState()?.project.variables);
  function sameRevision(revision) { if(E.getState().revision===revision)return true;E.toast('项目已被其他操作修改。请关闭此窗口，重新打开后再编辑，避免覆盖新内容。','warning');return false; }
  function getTarget() { return selection().length === 1 ? selection()[0] : selection().length ? null : sourcePage(); }
  function patchTarget(target, patch, label) { const isPage=target.id===sourcePage().id;return command([{ type: isPage ? 'updatePage' : 'updateNode', pageId: sourcePage().id, ...(isPage ? {} : { nodeId: target.id }), patch }], label); }
  function targetOptions(predicate = () => true) { return sourcePage().nodes.filter(predicate).map(item => [item.id,item.name]); }
  function describe(expression) {
    if (expression === null) return '始终成立';
    if (typeof expression !== 'object') return String(expression);
    if (expression.op === 'var') return `变量 · ${expression.name}`;
    if (expression.op === 'node') return `${sourcePage().nodes.find(item=>item.id===expression.nodeId)?.name || '元件'}.${expression.property}`;
    if (expression.op === 'event') return `事件 · ${expression.name}`;
    if (expression.op === 'item') return `当前数据行 · ${expression.column}`;
    if (expression.op === 'row') return `当前行 · ${expression.property==='id'?'稳定编号':'是否标记'}`;
    if (expression.op === 'repeater') return `${sourcePage().nodes.find(item=>item.id===expression.repeaterId)?.name||'数据列表'} · ${repeaterProperties.find(item=>item[0]===expression.property)?.[1]||expression.property}`;
    const operators = {eq:'=',neq:'≠',gt:'>',gte:'≥',lt:'<',lte:'≤',and:'并且',or:'或者',not:'非',add:'+',sub:'−',mul:'×',div:'÷',concat:'连接',contains:'包含',length:'长度'};
    return `(${(expression.args||[]).map(describe).join(` ${operators[expression.op] || expression.op} `)})`;
  }
  function expressionField(label, value, onChange, options = {}) {
    const wrapper = node('div','expression-field'), caption = node('span','',label), display = btn(describe(value), () => expressionDialog(value, onChange, options), '设置一个值、变量或计算式');
    display.classList.add('expression-value'); wrapper.append(caption,display); return wrapper;
  }
  function expressionDialog(value, apply, options = {}) {
    const openedRevision=E.getState().revision;
    // A nested editor uses its own dialog so editing an action doesn't destroy its parent.
    const dialog = node('dialog','workspace-dialog expression-dialog');
    const body = node('div'); let draft = clone(value ?? (options.condition ? {op:'eq',args:['','']} : ''));
    dialog.append(row(node('h2','',options.condition ? '设置条件' : '设置值或计算式'),btn('取消',()=>dialog.close())),body);
    const readLiteral = (input,type) => type === 'number' ? Number(input) : type === 'boolean' ? input === 'true' : input;
    const draw = () => {
      body.replaceChildren(); const kind = draft && typeof draft === 'object' ? draft.op : 'literal';
      const kinds = [['literal','固定值'],['var','项目变量'],['node','读取元件'],['event','事件内容'],['item','当前数据行'],['row','行编号与标记'],['repeater','数据列表统计'],['eq','相等'],['neq','不相等'],['gt','大于'],['gte','大于或等于'],['lt','小于'],['lte','小于或等于'],['and','全部条件成立'],['or','任一条件成立'],['not','条件取反'],['add','加法'],['sub','减法'],['mul','乘法'],['div','除法'],['concat','连接文字'],['contains','包含文字'],['length','文字长度']];
      body.append(field('取值方式',kind,next=>{ draft = next==='literal' ? '' : next==='var' ? {op:next,name:E.getState().project.variables[0]?.name||''} : next==='node' ? {op:next,nodeId:sourcePage().nodes[0]?.id||'',property:'text'} : next==='event' ? {op:next,name:'value'} : next==='item' ? {op:next,column:'name'} : next==='row'?{op:next,property:'marked'} : next==='repeater'?{op:next,repeaterId:sourcePage().nodes.find(item=>item.repeater)?.id||'',property:'currentPage'} : {op:next,args:next==='not'||next==='length'?['']:['','']}; draw(); },{options:kinds}));
      if (kind === 'literal') {
        let type = typeof draft; if (!['number','boolean'].includes(type)) type = 'string';
        body.append(field('数据类型',type,next=>{ draft = next==='number'?0:next==='boolean'?false:''; draw(); },{options:[['string','文字'],['number','数字'],['boolean','是 / 否']]}));
        body.append(field('固定值',String(draft),next=>draft=readLiteral(next,type), type==='boolean'?{options:[['true','是'],['false','否']]}:{number:type==='number',multiline:type==='string'}));
      } else if (kind === 'var') body.append(field('变量',draft.name,name=>draft.name=name,{options:E.getState().project.variables.map(item=>[item.name,item.name])}));
      else if (kind === 'node') body.append(field('元件',draft.nodeId,id=>draft.nodeId=id,{options:targetOptions()}),field('属性',draft.property,property=>draft.property=property,{options:['text','value','checked','visible','selected','disabled','x','y','width','height'].map(value=>[value,value])}));
      else if (kind === 'event') body.append(field('事件字段',draft.name,name=>draft.name=name,{options:interactionModel.INTERACTION_EVENT_PROPERTIES.map(name=>[name,eventPropertyNames[name]||name])}));
      else if (kind === 'item') body.append(field('数据列名',draft.column,column=>draft.column=column));
      else if (kind === 'row') body.append(field('行信息',draft.property,property=>draft.property=property,{options:[['id','稳定行编号'],['marked','是否已标记']]}));
      else if (kind === 'repeater') body.append(field('数据列表',draft.repeaterId,repeaterId=>draft.repeaterId=repeaterId,{options:targetOptions(item=>!!item.repeater)}),field('统计项目',draft.property,property=>draft.property=property,{options:repeaterProperties}));
      else for (let index=0;index<draft.args.length;index++) body.append(expressionField(`第 ${index+1} 个值`,draft.args[index],next=>{draft.args[index]=next;draw();}));
      body.append(note(`含义：${describe(draft)}`),row(btn('使用此设置',()=>{if(!sameRevision(openedRevision))return;apply(clone(draft));dialog.close();})));
    };
    document.body.append(dialog); dialog.addEventListener('close',()=>dialog.remove()); draw(); dialog.showModal();
  }
  function renderInteractions(force = false) {
    const root = $('#interactions-panel-content'); if (!root || (!force && focused(root)) || !hasFeature()) return;
    root.replaceChildren(); root.classList.add('advanced-interactions'); const target = getTarget();
    if (!target) { root.append(note('请选择一个元件设置交互；取消选择可设置页面交互。')); return; }
    const isPage = target.id === sourcePage().id, targetId = target.id;
    const linked=sourcePage().groups?.find(group=>group.componentId&&group.nodeIds.includes(targetId));
    if(linked){root.append(note('当前元件的交互跟随母版。打开母版修改，或在样式面板解除实例关联。'),btn('打开母版画布',()=>E.openComponent(linked.componentId)));return;}
    if(isPage && E.getEditingTarget?.().kind==='component'){root.append(note('选中母版内的元件，为它添加交互。'));return;}
    if (!interactionModel) { root.append(note('正在载入交互设置…')); return; }
    root.append(node('h3','workspace-section-title',`${isPage?'页面':'元件'} · ${target.name}`));
    const validEvents=interactionModel.getInteractionEvents(isPage?'page':target);
    const availableEvents=validEvents.map(name=>[name,eventNames[name]||name]);if(!validEvents.includes(currentEvent))currentEvent=isPage?'load':validEvents[0];
    root.append(field('触发事件',currentEvent,event=>{currentEvent=event;renderInteractions(true);},{options:availableEvents}));
    const interactions = target.interactions || [], matching = interactions.map((item,index)=>({item,index})).filter(entry=>entry.item.event===currentEvent);
    const eventKey=currentEvent,settings=interactionModel.getEventSettings(target,eventKey);
    const setEventSettings=patch=>command(()=>{
      const page=E.getPage(),latest=isPage?page:page.nodes.find(item=>item.id===targetId);if(!latest)return [];
      return [{type:isPage?'updatePage':'updateNode',pageId:page.id,...(isPage?{}:{nodeId:targetId}),patch:{eventSettings:{...clone(latest.eventSettings||{}),[eventKey]:{...interactionModel.getEventSettings(latest,eventKey),...patch}}}}];
    },'修改事件设置');
    const eventControls=node('section','interaction-event-settings');eventControls.dataset.enabled=String(settings.enabled);
    eventControls.append(check('启用此事件',settings.enabled,enabled=>setEventSettings({enabled})),field('触发后',settings.executionMode,executionMode=>setEventSettings({executionMode}),{options:[['automatic','根据条件自动执行'],['menu','显示菜单，让访客选择']]}));
    if(!settings.enabled)eventControls.append(note('此事件已停用；下面分支与动作的设置仍会保留。'));
    if(settings.executionMode==='menu')eventControls.append(note('预览时列出符合条件的分支，选择一项才执行。Esc 可取消。'));
    root.append(eventControls);
    const commit = transform => command(() => {
      const page = E.getPage(), latest = isPage ? page : page.nodes.find(item=>item.id===targetId); if (!latest) return [];
      return [{type:isPage?'updatePage':'updateNode',pageId:page.id,...(isPage?{}:{nodeId:targetId}),patch:{interactions:transform(clone(latest.interactions||[]))}}];
    },'编辑交互');
    const updateCase = (index,patch) => commit(items=>{if(items[index])Object.assign(items[index],patch);return items;});
    const moveCase=(index,step)=>commit(items=>{const indices=items.map((item,i)=>item.event===currentEvent?i:-1).filter(i=>i>=0),position=indices.indexOf(index),next=indices[position+step];if(next!==undefined)[items[index],items[next]]=[items[next],items[index]];return items;});
    for (const {item,index} of matching) {
      const card = node('section','interaction-case');
      card.dataset.enabled=String(item.enabled!==false);
      const position=matching.findIndex(entry=>entry.index===index),up=btn('上移分支',()=>moveCase(index,-1)),down=btn('下移分支',()=>moveCase(index,1));up.disabled=position===0;down.disabled=position===matching.length-1;
      card.append(row(node('strong','',item.name||`情形 ${position+1}`),btn('复制分支',()=>commit(items=>{if(items[index])items.splice(index+1,0,{...clone(items[index]),name:`${items[index].name||'分支'} 副本`});return items;})),btn('删除',()=>commit(items=>items.filter((_,i)=>i!==index)))),row(up,down));
      card.append(field('名称',item.name||'',name=>updateCase(index,{name})),field('判断方式',item.caseMode||'if',caseMode=>updateCase(index,{caseMode,...(caseMode==='else'?{condition:null}:{})}),{options:[['if','如果（独立判断）'],['elseIf','否则如果'],['else','否则']]}),check('启用',item.enabled!==false,enabled=>updateCase(index,{enabled})));
      if (item.caseMode!=='else') card.append(expressionField('满足条件',item.condition??null,condition=>updateCase(index,{condition}),{condition:true}),btn('清除条件',()=>updateCase(index,{condition:null})));
      const actions = item.actions || [];
      actions.forEach((action,actionIndex)=>{
        const actionRow = node('div','advanced-action-row');
        actionRow.dataset.enabled=String(action.enabled!==false);
        actionRow.append(node('span','action-sequence',String(actionIndex+1)),btn(actionNames[action.type]||action.type,()=>editAction(action,updated=>updateCase(index,{actions:actions.map((old,i)=>i===actionIndex?updated:old)}))));
        const up=btn('上移',()=>{const next=clone(actions);[next[actionIndex-1],next[actionIndex]]=[next[actionIndex],next[actionIndex-1]];updateCase(index,{actions:next});}); up.disabled=actionIndex===0;
        const down=btn('下移',()=>{const next=clone(actions);[next[actionIndex+1],next[actionIndex]]=[next[actionIndex],next[actionIndex+1]];updateCase(index,{actions:next});});down.disabled=actionIndex===actions.length-1;
        actionRow.append(up,down,btn('复制',()=>{const next=clone(actions);next.splice(actionIndex+1,0,clone(next[actionIndex]));updateCase(index,{actions:next});}),btn('删除',()=>updateCase(index,{actions:actions.filter((_,i)=>i!==actionIndex)})));
        const enabledControl=check('启用动作',action.enabled!==false,enabled=>updateCase(index,{actions:actions.map((old,i)=>i===actionIndex?{...old,enabled}:old)}));enabledControl.classList.add('action-enabled');actionRow.append(enabledControl);card.append(actionRow);
      });
      card.append(btn('添加动作',()=>editAction({type:'setText',targetId:selection()[0]?.id||sourcePage().nodes[0]?.id||'',value:'新的文字'},action=>updateCase(index,{actions:[...actions,action]}))));root.append(card);
    }
    root.append(btn('添加条件分支',()=>commit(items=>[...items,{event:currentEvent,name:`${eventNames[currentEvent]}处理`,enabled:true,caseMode:'if',condition:null,actions:[]}])));
    if (!matching.length) root.append(note('添加一个分支，再选择动作。可以读取输入框、项目变量和当前数据行作为条件。'));
  }
  function defaultAction(type) {
    const targetId=selection()[0]?.id||sourcePage().nodes[0]?.id||'', panels=sourcePage().nodes.filter(item=>item.type==='dynamicPanel'), repeaters=sourcePage().nodes.filter(item=>item.type==='repeater');
    const defaults={ setText:{targetId,value:'新的文字'},setVisible:{targetId,value:true},toggleVisible:{targetId},navigate:{pageId:E.getState().project.pages[0].id},wait:{ms:500},setVariable:{name:E.getState().project.variables[0]?.name||'',value:''},setValue:{targetId,value:''},setChecked:{targetId,value:true},setSelected:{targetId,value:true},setDisabled:{targetId,value:true},setError:{targetId,value:true},move:{targetId,x:20,y:0,relative:true},resize:{targetId,width:200,height:100},setStyle:{targetId,style:{fill:'#191919'}},setPanelState:{panelId:panels[0]?.id||'',stateId:panels[0]?.panel.states[0]?.id||''},nextPanelState:{panelId:panels[0]?.id||'',wrap:true},previousPanelState:{panelId:panels[0]?.id||'',wrap:true},addRows:{repeaterId:repeaters[0]?.id||'',rows:[{values:{}}]},deleteRows:{repeaterId:repeaters[0]?.id||'',where:null},updateRows:{repeaterId:repeaters[0]?.id||'',where:{op:'eq',args:[1,1]},values:{}},filterRows:{repeaterId:repeaters[0]?.id||'',where:null},sortRows:{repeaterId:repeaters[0]?.id||'',column:repeaters[0]?.repeater.columns[0]?.key||'',descending:false} };
    defaults.setRepeaterPage={repeaterId:repeaters[0]?.id||'',value:1};defaults.setRepeaterPageSize={repeaterId:repeaters[0]?.id||'',value:10};defaults.markRows={repeaterId:repeaters[0]?.id||'',where:{op:'eq',args:[{op:'row',property:'id'},{op:'event',name:'rowId'}]},marked:true};
    defaults.setAdaptiveView={mode:'auto'};defaults.focus={targetId:sourcePage().nodes.find(item=>['input','textarea','select','button','checkbox','radio'].includes(item.type))?.id||targetId};defaults.triggerEvent={targetId,event:'click'};
    return {type,...defaults[type]};
  }
  function editAction(original,apply) {
    let action=clone(original);const openedRevision=E.getState().revision;
    openModal('设置交互动作',(body,dialog)=>{
      const draw=()=>{
        body.replaceChildren();body.append(field('动作',action.type,type=>{action={...defaultAction(type),...(action.enabled===false?{enabled:false}:{})};draw();},{options:Object.entries(actionNames).filter(([name])=>name!=='setAdaptiveView'||E.getEditingTarget?.().kind!=='component')}));
        if ('targetId' in action) body.append(field('目标元件',action.targetId,id=>{action.targetId=id;if(action.type==='triggerEvent'){const events=interactionModel.getInteractionEvents(sourcePage().nodes.find(item=>item.id===id));if(!events.includes(action.event))action.event=events[0];draw();}},{options:targetOptions(item=>action.type!=='focus'||['input','textarea','select','button','checkbox','radio'].includes(item.type))}));
        if (action.type==='triggerEvent') body.append(field('触发事件',action.event,event=>action.event=event,{options:interactionModel.getInteractionEvents(sourcePage().nodes.find(item=>item.id===action.targetId)).map(name=>[name,eventNames[name]||name])}));
        if (action.type==='setAdaptiveView') {
          const views=E.getViewModel().getCanvasViews(E.getState().project,E.getRawPage());
          body.append(field('切换方式',action.mode,mode=>{action={type:'setAdaptiveView',mode,...(action.enabled===false?{enabled:false}:{}),...(mode==='view'?{viewId:views[0]?.id||''}:{})};draw();},{options:[['auto','根据窗口宽度自动切换'],['base','基础视图'],['view','指定视图']]}));
          if(action.mode==='view')body.append(field('目标视图',action.viewId,viewId=>action.viewId=viewId,{options:views.map(view=>[view.id,view.name])}));
          if(!views.length)body.append(note('当前页面还没有自适应视图，可在“管理视图”中添加。'));
        }
        if (action.type==='navigate') body.append(field('目标页面',action.pageId,pageId=>action.pageId=pageId,{options:E.getState().project.pages.map(item=>[item.id,item.name])}));
        if (action.type==='wait') body.append(field('等待毫秒',action.ms,ms=>action.ms=ms,{number:true,min:0,max:60000}));
        if (action.type==='setVariable') body.append(field('变量',action.name,name=>action.name=name,{options:E.getState().project.variables.map(item=>[item.name,item.name])}));
        if ('value' in action) body.append(expressionField('新值',action.value,value=>{action.value=value;draw();}));
        if (action.type==='move') body.append(expressionField('X',action.x,value=>{action.x=value;draw();}),expressionField('Y',action.y,value=>{action.y=value;draw();}),check('在当前位置上移动',action.relative,value=>action.relative=value));
        if (action.type==='resize') body.append(expressionField('宽度',action.width,value=>{action.width=value;draw();}),expressionField('高度',action.height,value=>{action.height=value;draw();}));
        if (action.type==='setStyle') {
          const key=Object.keys(action.style)[0]||'fill', options=[['fill','填充颜色'],['stroke','描边颜色'],['color','文字颜色'],['fontSize','字号'],['radius','圆角'],['opacity','不透明度'],['strokeWidth','描边粗细']];
          body.append(field('样式属性',key,next=>{action.style={[next]:['fill','stroke','color'].includes(next)?'#191919':next==='opacity'?1:16};draw();},{options}),field('值',action.style[key],value=>action.style[key]=value,{number:typeof action.style[key]==='number'}));
        }
        if ('panelId' in action) {
          const panels=sourcePage().nodes.filter(item=>item.type==='dynamicPanel');body.append(field('动态面板',action.panelId,id=>{action.panelId=id;if('stateId'in action)action.stateId=panels.find(item=>item.id===id)?.panel.states[0]?.id||'';draw();},{options:panels.map(item=>[item.id,item.name])}));
          if ('stateId' in action) body.append(field('目标状态',action.stateId,id=>action.stateId=id,{options:(panels.find(item=>item.id===action.panelId)?.panel.states||[]).map(item=>[item.id,item.name])}));
          if ('wrap' in action) body.append(check('到最后一个后循环',action.wrap,value=>action.wrap=value));
        }
        if ('repeaterId' in action) {
          const repeaters=sourcePage().nodes.filter(item=>item.type==='repeater');body.append(field('数据列表',action.repeaterId,id=>{action.repeaterId=id;if('rows'in action)action.rows=[{values:{}}];if('values'in action)action.values={};draw();},{options:repeaters.map(item=>[item.id,item.name])}));
          const columns=repeaters.find(item=>item.id===action.repeaterId)?.repeater.columns||[];
          if ('where' in action) body.append(expressionField('符合条件的数据行',action.where,value=>{action.where=value;draw();},{condition:true}),btn('全部数据行',()=>{action.where=null;draw();}));
          if (action.type==='addRows'||action.type==='updateRows') for (const column of columns) {
            const values=action.type==='addRows'?action.rows[0].values:action.values;
            if (!Object.hasOwn(values,column.key)) values[column.key]=column.type==='number'?0:column.type==='boolean'?false:'';
            body.append(expressionField(`${column.label||column.key} 列`,values[column.key]??(column.type==='number'?0:column.type==='boolean'?false:''),value=>{values[column.key]=value;draw();}));
          }
          if (action.type==='sortRows') body.append(field('排序列',action.column,value=>action.column=value,{options:columns.map(item=>[item.key,item.label||item.key])}),check('降序',action.descending,value=>action.descending=value));
          if (action.type==='markRows') body.append(expressionField('标记（是）或取消（否）',action.marked,value=>{action.marked=value;draw();}),btn('只处理触发事件的当前行',()=>{action.where={op:'eq',args:[{op:'row',property:'id'},{op:'event',name:'rowId'}]};draw();}));
          if (action.type==='setRepeaterPage') body.append(row(btn('上一页',()=>{action.value={op:'sub',args:[{op:'repeater',repeaterId:action.repeaterId,property:'currentPage'},1]};draw();}),btn('下一页',()=>{action.value={op:'add',args:[{op:'repeater',repeaterId:action.repeaterId,property:'currentPage'},1]};draw();})));
          if (action.type==='setRepeaterPageSize') body.append(btn('取消分页（显示全部）',()=>{action.value=null;draw();}));
        }
        body.append(row(btn('取消',()=>dialog.close()),btn('保存动作',()=>{if(!sameRevision(openedRevision))return;apply(clone(action));dialog.close();})));
      };draw();
    });
  }
  function manageVariables() {
    openModal('项目变量',(body)=>{
      const draw=()=>{
        body.replaceChildren(); for (const variable of E.getState().project.variables) {
          const section=node('section','workspace-section');
          const update=patch=>command([{type:'updateVariable',name:variable.name,patch}],'修改变量').then(draw);
          section.append(field('名称',variable.name,name=>update({name})),field('数据类型',variable.type,type=>update({type,value:type==='number'?0:type==='boolean'?false:''}),{options:[['string','文字'],['number','数字'],['boolean','是 / 否']]}),field('初始值',String(variable.value),value=>update({value:variable.type==='number'?Number(value):variable.type==='boolean'?value==='true':value}),variable.type==='boolean'?{options:[['true','是'],['false','否']]}:{number:variable.type==='number'}),btn('删除',()=>command([{type:'removeVariable',name:variable.name}],'删除变量').then(draw))); body.append(section);
        }
        body.append(btn('添加变量',()=>{let index=1;while(E.getState().project.variables.some(item=>item.name===`变量${index}`))index++;command([{type:'addVariable',variable:{name:`变量${index}`,type:'string',value:''}}],'添加变量').then(draw);}));
      };draw();
    });
  }
  function renderDynamicControls(root,item) {
    const panel=item.panel;root.append(node('h3','workspace-section-title','动态面板'));
    const stateId=editingStates.get(item.id)||panel.initialStateId;
    root.append(field('正在编辑的状态',stateId,id=>{editingStates.set(item.id,id);E.refresh();},{options:panel.states.map(state=>[state.id,state.name])}));
    const state=panel.states.find(state=>state.id===stateId)||panel.states[0];
    root.append(field('状态名称',state.name,name=>command([{type:'updatePanelState',pageId:sourcePage().id,panelId:item.id,stateId:state.id,patch:{name}}],'重命名状态')));
    root.append(row(btn('添加状态',()=>command([{type:'addPanelState',pageId:sourcePage().id,panelId:item.id,state:{name:`状态 ${panel.states.length+1}`,nodeIds:[]}}],'添加面板状态')),btn('删除状态',()=>command([{type:'removePanelState',pageId:sourcePage().id,panelId:item.id,stateId:state.id}],'删除面板状态'))));
    const pageId=sourcePage().id,revision=E.getState().revision;
    const copy=btn('复制当前状态',async()=>{const newStateId=uid();if(!sameRevision(revision))return;if(await command(()=>{if(!sameRevision(revision))throw new Error('状态已变化，请重新选择面板');return[{type:'duplicatePanelState',pageId,panelId:item.id,stateId:state.id,newStateId}];},'复制面板状态')){editingStates.set(item.id,newStateId);E.refresh();}});copy.dataset.panelAction='duplicate';root.append(copy);
    const list=node('div','panel-state-order');let dragging=null;
    const reorder=(stateId,index)=>{if(!sameRevision(revision))return;return command(()=>{if(!sameRevision(revision))throw new Error('状态已变化，请重新选择面板');return[{type:'reorderPanelState',pageId,panelId:item.id,stateId,index}];},'调整状态顺序');};
    panel.states.forEach((entry,index)=>{
      const line=node('div','panel-state-order-row');line.dataset.panelState=entry.id;line.append(node('span','',`${index+1}. ${entry.name}`));const up=btn('上移',()=>reorder(entry.id,index-1)),down=btn('下移',()=>reorder(entry.id,index+1));up.disabled=index===0;down.disabled=index===panel.states.length-1;up.dataset.panelAction='up';down.dataset.panelAction='down';line.append(up,down);
      line.addEventListener('pointerdown',event=>{
        if(event.button!==0||event.target.closest('button'))return;event.preventDefault();dragging={id:entry.id,startY:event.clientY,index,pointerId:event.pointerId,moved:false};line.setPointerCapture(event.pointerId);
        const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);line.removeEventListener('lostpointercapture',cancel);list.querySelectorAll('.drop-target').forEach(row=>row.classList.remove('drop-target'));if(line.hasPointerCapture(event.pointerId))line.releasePointerCapture(event.pointerId);dragging=null;};
        const move=event=>{if(!dragging||event.pointerId!==dragging.pointerId)return;if(Math.abs(event.clientY-dragging.startY)<3&&!dragging.moved)return;dragging.moved=true;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-panel-state]');list.querySelectorAll('.drop-target').forEach(row=>row.classList.remove('drop-target'));if(target&&list.contains(target)){dragging.index=panel.states.findIndex(state=>state.id===target.dataset.panelState);target.classList.add('drop-target');}event.preventDefault();};
        const finish=event=>{if(!dragging||event.pointerId!==dragging.pointerId)return;const current=dragging;cleanup();if(current.moved&&current.index!==index)reorder(current.id,current.index);};const cancel=()=>cleanup();
        window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);line.addEventListener('lostpointercapture',cancel);
      });list.append(line);
    });root.append(list);
    root.append(btn('设为预览初始状态',()=>command([{type:'setInitialPanelState',pageId:sourcePage().id,panelId:item.id,stateId:state.id}],'设置初始状态')));
    root.append(btn('选择此状态的元件…',()=>assignContainer(item,state)));
    root.append(check('裁切超出边界的内容',panel.clip,value=>command([{type:'setPanelOptions',pageId,panelId:item.id,patch:{clip:value}}],'修改面板裁切')));
    const options=btn('尺寸、滚动、固定与拖动…',()=>panelOptionsDialog(item.id));options.dataset.panelAction='options';root.append(options);
    root.append(note(`此状态包含 ${state.nodeIds.length} 个元件。切换“正在编辑”只影响编辑器；状态重排不会改变预览初始状态。内容适应在预览中计算，手动修改宽高会恢复固定尺寸。`));
  }
  function panelOptionsDialog(panelId){
    const pageId=sourcePage().id,panel=sourcePage().nodes.find(node=>node.id===panelId)?.panel;if(!panel)return;
    const revision=E.getState().revision,draft=clone({sizeMode:panel.sizeMode,scroll:panel.scroll,pin:panel.pin,drag:panel.drag});
    openModal('面板布局与运行时拖动',(body,dialog)=>{
      dialog.classList.add('panel-options-dialog');const bind=(label,key,value,onChange,options)=>{const control=field(label,value,onChange,options);control.querySelector('input,select').dataset.panelOption=key;body.append(control);};
      bind('尺寸模式','sizeMode',draft.sizeMode,value=>draft.sizeMode=value,{options:[['fixed','使用设计尺寸'],['content','随当前状态内容扩大或缩小']]});
      for(const [axis,label]of [['x','横向滚动'],['y','纵向滚动']])bind(label,'scroll-'+axis,draft.scroll[axis],value=>draft.scroll[axis]=value,{options:[['none','不滚动（由裁切开关决定溢出）'],['auto','内容超出时滚动'],['always','始终显示滚动条']]});
      let pinned=!!draft.pin;const pin=draft.pin||{horizontal:'left',vertical:'top',offsetX:0,offsetY:0};
      const pinSwitch=check('固定到浏览器窗口',pinned,value=>{pinned=value;});pinSwitch.querySelector('input').dataset.panelOption='pinned';body.append(pinSwitch);
      bind('水平对齐','horizontal',pin.horizontal,value=>pin.horizontal=value,{options:[['left','左边'],['center','水平居中'],['right','右边']]});bind('垂直对齐','vertical',pin.vertical,value=>pin.vertical=value,{options:[['top','上边'],['center','垂直居中'],['bottom','下边']]});
      for(const [key,label]of [['offsetX','水平边距 / 居中偏移'],['offsetY','垂直边距 / 居中偏移']])bind(label,key,pin[key],value=>pin[key]=value,{number:true,min:-100000,max:100000});
      const drag=check('允许访客拖动面板',draft.drag.enabled,value=>draft.drag.enabled=value);drag.querySelector('input').dataset.panelOption='draggable';body.append(drag);
      bind('拖动方向','axis',draft.drag.axis,value=>draft.drag.axis=value,{options:[['both','横向和纵向'],['x','仅横向'],['y','仅纵向']]});bind('拖动边界','bounds',draft.drag.bounds,value=>draft.drag.bounds=value,{options:[['none','不限制'],['parent','限制在父容器 / 页面'],['viewport','限制在浏览器窗口']]});
      body.append(note('这些设置在预览和导出网页中生效。固定区域位于预览工具条下方；正边距从所选边向内，居中时为向右/下偏移。内容尺寸保留面板原点，负坐标不搬移；滚动按当前状态各自保留。输入框、按钮及有点击交互的子元件优先操作，拖空白或普通文字可移动面板。'));
      const save=btn('应用面板设置',async()=>{if(!sameRevision(revision))return;draft.pin=pinned?pin:null;const ok=await command(()=>{if(!sameRevision(revision))throw new Error('面板已变化，请重新打开设置');return[{type:'setPanelOptions',pageId,panelId,patch:clone(draft)}];},'设置面板布局');if(ok)dialog.close();});save.dataset.panelAction='apply-options';body.append(row(btn('取消',()=>dialog.close()),save));
    });
  }
  function assignContainer(item,state) {
    const openedRevision=E.getState().revision;
    const selected=new Set(state?state.nodeIds:item.repeater.templateIds);
    openModal(state?'设置面板状态内容':'设置列表行模板',(body,dialog)=>{
      for(const candidate of sourcePage().nodes)if(candidate.id!==item.id)body.append(check(candidate.name,selected.has(candidate.id),value=>value?selected.add(candidate.id):selected.delete(candidate.id)));
      body.append(btn('保存',()=>{if(!sameRevision(openedRevision))return;command([{type:state?'assignPanelNodes':'setRepeaterTemplate',pageId:sourcePage().id,...(state?{panelId:item.id,stateId:state.id}:{nodeId:item.id}),nodeIds:[...selected]}],'修改容器内容');dialog.close();}));
    });
  }
  function renderRepeaterControls(root,item) {
    const data=item.repeater, pageId=sourcePage().id;const patch=value=>patchTarget(item,{repeater:{...data,...value}},'修改数据列表');
    root.append(node('h3','workspace-section-title','数据列表 / 中继器'),btn(`编辑数据（${data.rows.length} 行）`,()=>editDataset(item.id)),btn('选择行模板元件…',()=>assignContainer(item)));
    const importButton=btn('导入 CSV / Tab…',()=>importDataset(item.id));importButton.dataset.repeaterAction='import';root.append(importButton);
    let pagination=clone(data.pagination||{pageSize:null,initialPage:1});
    const changePagination=(patch,key)=>{const expected=pagination[key];return command(()=>{const current=[...E.getState().project.pages,...E.getState().project.components].find(page=>page.id===pageId)?.nodes.find(node=>node.id===item.id)?.repeater?.pagination;if(!current||current[key]!==expected)throw new Error('此分页属性已被其他操作修改，请重新选择数据列表后编辑');return[{type:'setRepeaterPagination',pageId,nodeId:item.id,pagination:{...current,...patch}}];},'设置数据分页').then(ok=>{if(ok)pagination={...pagination,...patch};return ok;});};
    const size=field('每页数量（留空显示全部）',pagination.pageSize??'',value=>changePagination({pageSize:String(value).trim()===''?null:Number(value),initialPage:1},'pageSize'));size.querySelector('input').dataset.repeaterField='pageSize';
    const initial=field('初始页',pagination.initialPage,initialPage=>changePagination({initialPage},'initialPage'),{number:true,min:1,max:10000});initial.querySelector('input').dataset.repeaterField='initialPage';root.append(size,initial,note(`${(data.markedRowIds||[]).length} 行初始标记；分页和标记会在预览中保持各行自己的输入与状态。`));
    root.append(field('排列方式',data.layout,layout=>patch({layout}),{options:[['vertical','竖向列表'],['horizontal','横向列表'],['grid','网格']]}));
    const grid=node('div','workspace-grid');for(const[key,label]of[['itemWidth','行宽'],['itemHeight','行高'],['gap','间距'],['columnsCount','网格列数']])grid.append(field(label,data[key],value=>patch({[key]:value}),{number:true,min:key==='gap'?0:1}));root.append(grid);
    root.append(expressionField('初始筛选',data.filter,filter=>command([{type:'setRepeaterFilter',pageId,nodeId:item.id,filter}],'筛选数据列表'),{condition:true}),btn('清除筛选',()=>command([{type:'setRepeaterFilter',pageId,nodeId:item.id,filter:null}],'清除筛选')));
    root.append(field('初始排序',data.sort?.column||'',column=>command([{type:'setRepeaterSort',pageId,nodeId:item.id,sort:column?{column,descending:false}:null}],'排序数据列表'),{options:[['','无'],...data.columns.map(item=>[item.key,item.label||item.key])]}));
    root.append(note('选择模板内的文字元件，在“数据绑定”中引用当前行的列。预览和 HTML 会按数据逐行生成。'));
  }
  function editDataset(nodeId) {
    const openedRevision=E.getState().revision;
    const item=sourcePage().nodes.find(item=>item.id===nodeId), pageId=sourcePage().id; if(!item)return;
    let columns=clone(item.repeater.columns),rows=clone(item.repeater.rows),marks=new Set(item.repeater.markedRowIds||[]);
    openModal('编辑数据集',(body,dialog)=>{
      const draw=()=>{
        body.replaceChildren();const table=node('table','table-editor'),head=node('tr');head.append(node('th','','标记'));
        for(const column of columns){const th=node('th');th.append(field('列名',column.key,value=>{const old=column.key;if(!value||columns.some(item=>item!==column&&item.key===value))return;column.key=value;column.label=value;for(const row of rows){row.values[value]=row.values[old];delete row.values[old];}}),field('类型',column.type,value=>{column.type=value;for(const row of rows)row.values[column.key]=value==='number'?Number(row.values[column.key])||0:value==='boolean'?Boolean(row.values[column.key]):String(row.values[column.key]??'');draw();},{options:[['string','文字'],['number','数字'],['boolean','是 / 否']]}),btn('删列',()=>{columns=columns.filter(item=>item!==column);rows.forEach(row=>delete row.values[column.key]);draw();}));head.append(th);}table.append(head);
        rows.forEach((item,index)=>{const tr=node('tr'),mark=node('td');mark.append(check('',marks.has(item.id),value=>{if(value)marks.add(item.id);else marks.delete(item.id);}));mark.querySelector('input').setAttribute('aria-label',`标记第 ${index+1} 行`);tr.append(mark);for(const column of columns){const td=node('td');td.append(field('',String(item.values[column.key]??''),value=>item.values[column.key]=column.type==='number'?Number(value):column.type==='boolean'?value==='true':value,column.type==='boolean'?{options:[['true','是'],['false','否']]}:{number:column.type==='number'}));tr.append(td);}const td=node('td');td.append(btn('删行',()=>{marks.delete(item.id);rows.splice(index,1);draw();}));tr.append(td);table.append(tr);});body.append(table);
        body.append(row(btn('添加列',()=>{let index=columns.length+1;while(columns.some(item=>item.key===`column${index}`))index++;const key=`column${index}`;columns.push({key,label:key,type:'string'});rows.forEach(row=>row.values[key]='');draw();}),btn('添加行',()=>{rows.push({id:uid(),values:Object.fromEntries(columns.map(item=>[item.key,item.type==='number'?0:item.type==='boolean'?false:'']))});draw();})));
        body.append(note('批量数据请先保存本窗口，再使用数据列表属性中的“导入 CSV / Tab”，预览列映射后追加或替换。'));
        body.append(row(btn('取消',()=>dialog.close()),btn('保存数据',async()=>{if(!sameRevision(openedRevision))return;const ok=await command(()=>{if(!sameRevision(openedRevision))throw new Error('数据编辑已过期');return[{type:'setRepeaterData',pageId,nodeId,columns,rows},{type:'setRepeaterMarks',pageId,nodeId,rowIds:[...marks]}];},'编辑数据集');if(ok)dialog.close();})));
      };draw();
    });
  }
  async function importDataset(nodeId) {
    const {parseDelimitedRows,prepareRepeaterImport,REPEATER_IMPORT_LIMIT}=await import('../core/repeater-import.mjs');
    const item=sourcePage().nodes.find(item=>item.id===nodeId);if(!item?.repeater)return;
    const pageId=sourcePage().id,openedRevision=E.getState().revision,columns=clone(item.repeater.columns);
    const draft={text:'',delimiter:'comma',hasHeader:true,columnMap:[],mode:'append'};let prepared=null,headerKey='',fileReadId=0;
    openModal('导入数据：先预览，再写入',(body,dialog)=>{
      dialog.classList.add('repeater-import-dialog');
      const status=node('p','workspace-note'),mapping=node('div','repeater-import-mapping'),preview=node('div','repeater-import-preview');status.dataset.importStatus='';
      const apply=btn('确认导入',async()=>{if(!prepared||!sameRevision(openedRevision))return;const payload=clone(draft);const ok=await command(()=>{if(!sameRevision(openedRevision))throw new Error('数据已变化，请关闭导入窗口后重新预览');return[{type:'importRepeaterData',pageId,nodeId,...payload}];},'导入数据');if(ok)dialog.close();});apply.dataset.importAction='apply';apply.disabled=true;
      const invalidate=()=>{prepared=null;apply.disabled=true;preview.replaceChildren();status.textContent='内容已变化，请重新预览。';};
      const refreshPreview=()=>{prepared=null;apply.disabled=true;preview.replaceChildren();mapping.replaceChildren();try{
        const records=parseDelimitedRows(draft.text,draft.delimiter),headers=draft.hasHeader?records[0]:records[0].map((_,index)=>`第 ${index+1} 列`),key=JSON.stringify(headers);
        if(key!==headerKey){draft.columnMap=columns.map((column,index)=>({targetKey:column.key,sourceIndex:Math.max(0,headers.findIndex(value=>value===column.key||value===column.label)>=0?headers.findIndex(value=>value===column.key||value===column.label):index)}));headerKey=key;}
        for(const column of columns){const target=draft.columnMap.find(item=>item.targetKey===column.key);const control=field(`导入到：${column.label||column.key}`,String(target.sourceIndex),value=>{target.sourceIndex=Number(value);refreshPreview();},{options:headers.map((value,index)=>[String(index),`${index+1}. ${value}`])});control.querySelector('select').dataset.importColumn=column.key;mapping.append(control);}
        prepared=prepareRepeaterImport(draft,columns);if(draft.mode==='append'&&prepared.rows.length+item.repeater.rows.length>10000)throw new Error('追加后超过 10000 行');
        const table=node('table','table-editor'),head=node('tr');columns.forEach(column=>head.append(node('th','',column.label||column.key)));table.append(head);
        for(const entry of prepared.rows.slice(0,20)){const tr=node('tr');columns.forEach(column=>tr.append(node('td','',String(entry.values[column.key]))));table.append(tr);}preview.append(table);
        status.textContent=draft.mode==='replace'?`将用 ${prepared.rows.length} 行替换现有 ${item.repeater.rows.length} 行，清空标记并回到第 1 页。可一次撤销。`:`将追加 ${prepared.rows.length} 行；原有 ${item.repeater.rows.length} 行及标记保持。可一次撤销。`;
        apply.textContent=draft.mode==='replace'?'确认替换全部数据':'确认追加数据';apply.disabled=false;
      }catch(error){prepared=null;status.textContent=error.message;}};
      const text=field('粘贴 CSV 或 Tab 数据','',value=>{draft.text=value;invalidate();},{multiline:true});text.querySelector('textarea').dataset.importField='text';text.querySelector('textarea').addEventListener('input',event=>{fileReadId++;draft.text=event.target.value;invalidate();});
      const file=node('input');file.type='file';file.accept='.csv,.tsv,.txt';file.dataset.importField='file';file.setAttribute('aria-label','选择 UTF-8 数据文件');
      file.addEventListener('change',async()=>{const selected=file.files[0],readId=++fileReadId;if(!selected)return;invalidate();try{if(selected.size>REPEATER_IMPORT_LIMIT)throw new Error('数据文件最大 4 MiB');const content=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer());if(!dialog.isConnected||readId!==fileReadId)return;draft.text=content;text.querySelector('textarea').value=content;status.textContent='文件已读取，请预览列映射。';}catch(error){if(readId===fileReadId)status.textContent=`文件未导入：${error.message}。请使用 UTF-8 CSV/Tab 文件。`;}});
      const format=field('分隔方式',draft.delimiter,value=>{draft.delimiter=value;headerKey='';invalidate();},{options:[['comma','CSV（逗号）'],['tab','Tab（制表符）']]});format.querySelector('select').dataset.importField='delimiter';
      const header=check('第一行是表头',draft.hasHeader,value=>{draft.hasHeader=value;headerKey='';invalidate();});header.querySelector('input').dataset.importField='hasHeader';
      const mode=field('写入方式',draft.mode,value=>{draft.mode=value;invalidate();},{options:[['append','追加到现有数据'],['replace','替换全部数据']]});mode.querySelector('select').dataset.importField='mode';
      const inspect=btn('预览导入',refreshPreview);inspect.dataset.importAction='preview';body.append(note('支持 UTF-8 文件；数字/是或否必须有效，不会把错误内容悄悄改成 0。每列都要明确映射，最多 10000 行。'),file,text,row(format,header,mode),inspect,status,mapping,preview,row(btn('取消',()=>dialog.close()),apply));
    });
  }
  function renderBindings(root,item) {
    root.append(node('h3','workspace-section-title','数据绑定'));
    for(const[property,label]of[['text','文字'],['value','输入值'],['visible','可见性'],['checked','勾选']]){
      const binding=item.bindings?.[property];
      root.append(expressionField(label,binding??'未绑定',value=>patchTarget(item,{bindings:{...item.bindings,[property]:value}},'修改数据绑定')));
      if(binding!==undefined)root.append(btn(`清除${label}绑定`,()=>{const bindings=clone(item.bindings);delete bindings[property];patchTarget(item,{bindings},'清除数据绑定');}));
    }
  }
  function renderStateStyles(root,item) {
    if(window.YuandaStyle)return window.YuandaStyle.renderStates(root,item,E.captureContext());
    const details=node('details','advanced-details');details.append(node('summary','','交互状态外观'));
    const states={hover:'鼠标悬停',pressed:'鼠标按下',selected:'选中',disabled:'禁用',error:'错误',focus:'聚焦',hint:'提示'};
    for(const[key,label]of Object.entries(states))details.append(btn(`设置${label}样式`,()=>openModal(`${label}时的外观`,body=>{
      const values=clone(item.stateStyles?.[key]||{});const fields=node('div','workspace-grid');
      for(const[property,name]of[['fill','填充'],['color','文字颜色'],['stroke','边框'],['fontSize','字号'],['opacity','不透明度']])fields.append(field(name,values[property]??'',value=>{if(value==='')delete values[property];else values[property]=['fontSize','opacity'].includes(property)?Number(value):value;}));
      body.append(fields,note('留空的属性继承基础样式。'),btn('保存状态样式',()=>{patchTarget(item,{stateStyles:{...item.stateStyles,[key]:values}},'修改状态样式');$('#workspace-dialog')?.close();}),btn('移除状态样式',()=>{const stateStyles=clone(item.stateStyles||{});delete stateStyles[key];patchTarget(item,{stateStyles},'移除状态样式');$('#workspace-dialog')?.close();}));
    })));
    root.append(details);
  }
  function renderProperties() {
    if(focused($('#inspector')))return;$('#advanced-properties')?.remove();const root=node('section','inspector-section');root.id='advanced-properties';
    const selected=selection(),pageId=sourcePage().id;
    window.YuandaViewTools?.renderInspector(root,selected);
    if(selected.some(item=>sourcePage().groups?.some(group=>group.componentId&&group.nodeIds.includes(item.id)))){root.append(note('实例的布局、交互和数据绑定跟随母版。文字与图片可在上方单独修改。'));$('#inspector').append(root);return;}
    if(selected.length===1){const item=selected[0];if(item.type==='dynamicPanel'&&item.panel)renderDynamicControls(root,item);if(item.type==='repeater'&&item.repeater)renderRepeaterControls(root,item);root.append(check('预览中禁用',item.disabled,disabled=>patchTarget(item,{disabled},'修改禁用状态')));renderStateStyles(root,item);const details=node('details','advanced-details');details.append(node('summary','','数据绑定'));renderBindings(details,item);root.append(details);}
    if(selected.length){root.append(row(btn('转为动态面板',()=>command([{type:'createDynamicPanel',pageId,nodeIds:selected.map(item=>item.id),name:'动态面板'}],'创建动态面板')),btn('转为数据列表',()=>command([{type:'createRepeater',pageId,nodeIds:selected.map(item=>item.id),name:'数据列表'}],'创建数据列表'))));}
    root.append(btn('项目变量…',manageVariables),btn('管理视图与继承…',manageViews));$('#inspector').append(root);
  }
  function manageViews() {
    return window.YuandaViewTools?.manageViews();
  }
  function installToolbar() {
    const library=$('#library-panel-content');const advanced=node('div','advanced-library');advanced.append(node('h3','workspace-section-title','交互容器'));
    for(const[type,label]of[['createDynamicPanel','动态面板'],['createRepeater','数据列表']])advanced.append(btn(label,()=>command([{type,pageId:sourcePage().id,name:label}],'添加交互容器')));library.append(advanced);
  }
  function designPage(page) {
    return page;
  }
  function designNodes(page) {
    const rendered=designPage(page).nodes,hidden=new Set();
    for(const item of rendered)if(item.type==='dynamicPanel'&&item.panel){const active=editingStates.get(item.id)||item.panel.initialStateId;for(const state of item.panel.states)if(state.id!==active)state.nodeIds.forEach(id=>hidden.add(id));}
    let changed=true;while(changed){changed=false;for(const item of rendered)if(hidden.has(item.id)){const children=item.panel?.states.flatMap(state=>state.nodeIds)||item.repeater?.templateIds||[];for(const id of children)if(!hidden.has(id)){hidden.add(id);changed=true;}}}
    return [...rendered].sort((a,b)=>Number(!!(b.panel||b.repeater))-Number(!!(a.panel||a.repeater))).map(item=>hidden.has(item.id)?{...item,editorHidden:true}:item);
  }
  function renderContainer(element,item) {
    if(!['dynamicPanel','repeater'].includes(item.type))return false;
    element.classList.add('design-container');element.append(node('span','container-caption',`${item.type==='dynamicPanel'?'动态面板':'数据列表'} · ${item.name}`));
    if(item.type==='repeater')element.append(node('span','container-count',`${item.repeater?.rows.length||0} 行数据 · 编辑行模板`));return true;
  }
  function descendants(nodeId) {
    const result=new Set(),page=sourcePage();
    const visit=id=>{const item=page.nodes.find(item=>item.id===id);for(const child of item?.panel?.states.flatMap(state=>state.nodeIds)||item?.repeater?.templateIds||[]){if(!result.has(child)){result.add(child);visit(child);}}};visit(nodeId);return [...result];
  }
  function expandMove(items) { const ids=new Set(items.flatMap(item=>[item.id,...descendants(item.id)]));return sourcePage().nodes.filter(item=>ids.has(item.id)); }
  function draw() {
    pending=false;if(!hasFeature())return;editingViewId=E.getEditingContext().viewId;
    renderInteractions();renderProperties();
  }
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(draw);}
  installToolbar();document.addEventListener('yuanda:editorchange',schedule);document.addEventListener('yuanda:panelactivate',schedule);
  document.addEventListener('focusout',event=>{if(event.target.closest('#advanced-properties,#interactions-panel-content'))setTimeout(schedule,100);});
  const getEditingState=panelId=>{const panel=sourcePage()?.nodes.find(node=>node.id===panelId)?.panel;if(!panel)return null;const id=editingStates.get(panelId);return panel.states.some(state=>state.id===id)?id:panel.initialStateId;};
  const setEditingState=(panelId,stateId)=>{const panel=sourcePage()?.nodes.find(node=>node.id===panelId)?.panel;if(!panel?.states.some(state=>state.id===stateId))return false;editingStates.set(panelId,stateId);E.refresh();return true;};
  window.YuandaAdvanced={designPage,designNodes,renderContainer,renderInteractions,manageVariables,manageViews,expressionDialog,expressionField,schedule,descendants,expandMove,getEditingState,setEditingState,getEditingView:()=>E.getEditingContext().viewId};schedule();
})();
