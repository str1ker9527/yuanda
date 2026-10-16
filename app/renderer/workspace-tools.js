/* Original workspace tools. All project edits go through the shared command engine. */
(() => {
  'use strict';
  const E = window.YuandaEditor;
  const $ = selector => document.querySelector(selector);
  const node = (tag, cls = '', text) => { const value = document.createElement(tag); value.className = cls; if (text !== undefined) value.textContent = text; return value; };
  const btn = (label, fn, title = label) => { const value = node('button', 'workspace-button', label); value.type = 'button'; value.title = title; value.addEventListener('click', fn); return value; };
  const row = (...children) => { const value = node('div', 'workspace-row'); value.append(...children); return value; };
  const note = text => node('p', 'workspace-note', text);
  const uid = () => crypto.randomUUID();
  const round = value => Math.round(value * 100) / 100;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const editing = root => root?.contains(document.activeElement) && document.activeElement?.matches('input,select,textarea,[contenteditable]');
  const command = (commands, label, context) => E.command(commands, label, context);
  let renderPending = false, activeComponent = null, masterNodeId = null, rulerDrag = null, selectedGuide = null;
  const defaults = { grid: false, guides: true, lockGuides: false, guideScope:'page', gridSize: 10, gridStyle:'dots', gridColor:'#C8CDD3', guideColor:'#249CA8', snapColor:'#D64040', snapGrid:true, snapGuides:true, snapWidgets:true, snapping:true, rulers:true };
  let guideModel = null;
  import('../core/guide-model.mjs').then(module => { guideModel = module; scheduleRender(); });
  let view = {...defaults};
  function validPreferences(patch) {
    const result={}; if(!patch||typeof patch!=='object')return result;
    for(const [key,fallback]of Object.entries(defaults)){
      const value=patch[key];if(typeof fallback==='boolean'&&typeof value==='boolean')result[key]=value;
      else if(key==='gridSize'&&typeof value==='number'&&Number.isFinite(value))result[key]=clamp(Math.round(value),1,200);
      else if(key==='gridStyle'&&['dots','lines'].includes(value))result[key]=value;
      else if(key==='guideScope'&&['page','project'].includes(value))result[key]=value;
      else if(key.endsWith('Color')&&typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))result[key]=value;
    }return result;
  }
  try { const saved = JSON.parse(localStorage.getItem('yuanda.view') || '{}'); view={...defaults,...validPreferences(saved)};if(!Object.hasOwn(saved,'snapWidgets')&&typeof saved.smartSnap==='boolean')view.snapWidgets=saved.smartSnap; } catch {}
  const preferences = () => ({...view});
  function storeView() {
    try{localStorage.setItem('yuanda.view', JSON.stringify(view));}catch{E.toast('当前窗口不能保存视图偏好，本次设置仍然有效。');}
    renderGuides();drawRulers();syncViewControls();document.dispatchEvent(new CustomEvent('yuanda:workspacechange',{detail:preferences()}));
  }
  function setPreferences(patch){const oldScope=view.guideScope;view={...view,...validPreferences(patch)};if((view.lockGuides||oldScope!==view.guideScope)&&rulerDrag)rulerDrag.cancel?.();storeView();return preferences();}
  function togglePreference(key){if(typeof view[key]!=='boolean')return preferences();return setPreferences({[key]:!view[key]});}
  function field(label, value, onChange, options = {}) {
    const wrapper = node('label', 'workspace-field'); wrapper.append(node('span', '', label));
    let input;
    if (options.options) { input = node('select'); for (const [key, text] of options.options) { const option = node('option', '', text); option.value = key; input.append(option); } }
    else { input = node(options.multiline ? 'textarea' : 'input'); if (!options.multiline) input.type = options.number ? 'number' : 'text'; }
    input.value = value ?? ''; input.setAttribute('aria-label', label);
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    input.addEventListener('change', () => {
      let result = options.number ? Number(input.value) : input.value;
      if (options.number) { if (!Number.isFinite(result) || input.value === '') { input.value = value; return; } if (options.min !== undefined) result = Math.max(options.min, result); if (options.max !== undefined) result = Math.min(options.max, result); }
      onChange(result);
    }); wrapper.append(input); return wrapper;
  }
  function check(label, value, fn) { const wrapper = node('label', 'workspace-check'), input = node('input'); input.type = 'checkbox'; input.checked = value; input.addEventListener('change', () => fn(input.checked)); wrapper.append(input, document.createTextNode(label)); return wrapper; }
  function svgIcon(type) {
    const paths = {
      rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>', ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
      text: '<path d="M4 5h16M12 5v14M8 19h8"/>', button: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 12h10"/>',
      input: '<rect x="2" y="5" width="20" height="14" rx="1"/><path d="M6 8v8m-1-8h2m-2 8h2"/>', textarea: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M7 8h10M7 12h10m-5 4h5"/>',
      line: '<path d="m3 19 18-14"/>', checkbox: '<rect x="3" y="5" width="14" height="14" rx="1"/><path d="m6 12 3 3 6-6"/>', radio: '<circle cx="10" cy="12" r="7"/><circle cx="10" cy="12" r="2"/>',
      select: '<rect x="2" y="6" width="20" height="12" rx="1"/><path d="m15 10 3 3 3-3M5 12h5"/>', table: '<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18M10 3v18"/>', image: '<rect x="3" y="4" width="18" height="16"/><path d="m3 16 6-6 5 5 3-3 4 4"/><circle cx="16" cy="8" r="1"/>'
    };
    const wrapper = node('span', 'library-icon'); wrapper.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${paths[type] || paths.rectangle}</svg>`; return wrapper;
  }
  const widgets = [
    ['rectangle', '矩形', { width: 200, height: 140 }], ['ellipse', '椭圆', { width: 160, height: 120 }], ['text', '文字', { width: 240, height: 40 }], ['line', '线段', { width: 180, height: 1 }],
    ['button', '按钮', { width: 160, height: 44 }], ['input', '输入框', { width: 240, height: 40 }], ['textarea', '多行文本框', { width: 240, height: 100, text: '请输入内容' }],
    ['checkbox', '复选框', { width: 140, height: 32, text: '复选项' }], ['radio', '单选按钮', { width: 140, height: 32, text: '单选项', radioGroup: '选项组' }],
    ['select', '下拉列表', { width: 200, height: 40, options: ['选项一', '选项二', '选项三'], value: '选项一' }], ['table', '表格', { width: 320, height: 160, rows: [['名称', '状态', '备注'], ['项目 A', '进行中', ''], ['项目 B', '已完成', '']] }]
  ];
  function installLibrary() {
    const root = $('#library-panel-content'); if (!root) return;
    const search = node('input', 'workspace-search'); search.type = 'search'; search.placeholder = '搜索元件'; search.setAttribute('aria-label', '搜索元件');
    const grid = node('div', 'library-grid');
    for (const [type, label, preset] of widgets) {
      const item = btn('', () => {}, `拖到画布，或双击添加${label}`); item.className = 'library-widget'; item.dataset.libraryType = type; item.append(svgIcon(type), node('span', '', label));
      item.addEventListener('dblclick', () => E.insert(type, structuredClone(preset)));
      item.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); E.insert(type, structuredClone(preset)); } });
      item.addEventListener('pointerdown', event => startLibraryDrag(event, { type, label, preset })); grid.append(item);
    }
    const image = btn('导入图片…', () => $('#import-image').click()); image.classList.add('full-width');
    search.addEventListener('input', () => { for (const item of grid.children) item.hidden = !item.textContent.includes(search.value.trim()); });
    root.append(search, node('h3', 'workspace-section-title', '基础元件'), grid, image, note('拖入画布后双击即可编辑。Enter 也可添加选中的元件。'));
  }
  function startLibraryDrag(event, item) {
    if(window.YuandaDragPreview)return window.YuandaDragPreview.start(event,item);
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY }, source = event.currentTarget; let ghost;
    const move = next => {
      if (!ghost && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return;
      if (!ghost) { ghost = node('div', 'library-drag-ghost', item.label); document.body.append(ghost); source.setPointerCapture(event.pointerId); }
      ghost.style.left = `${next.clientX + 12}px`; ghost.style.top = `${next.clientY + 12}px`;
    };
    const up = async next => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel);
      if (source.hasPointerCapture(event.pointerId)) source.releasePointerCapture(event.pointerId);
      if (!ghost) return; ghost.remove();
      const bounds = $('#canvas-viewport').getBoundingClientRect();
      if (next.clientX < bounds.left || next.clientX > bounds.right || next.clientY < bounds.top || next.clientY > bounds.bottom) return;
      const point = E.point(next); const x = round(point.x), y = round(point.y);
      if (item.componentId) { const instanceId = uid(); await command([{ type: 'insertComponent', pageId: E.getPage().id, componentId: item.componentId, instanceId, x, y }], '插入母版'); const instance = E.getPage().groups.find(group => group.id === instanceId); if (instance) E.select(instance.nodeIds); }
      else E.insert(item.type, { ...structuredClone(item.preset), x, y });
    };
    const cancel = () => { ghost?.remove(); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel);
  }
  function renderNotes() {
    const root = $('#notes-panel-content'), page = E.getPage(); if (!root || !page || editing(root)) return;
    const selection = E.getNodes(); root.replaceChildren();
    if (selection.length > 1) { root.append(note('请选择一个元件填写注释，或取消选择，为整个页面写说明。')); return; }
    const target = selection[0] || page;
    root.append(node('h3', 'workspace-section-title', target.name));
    root.append(field(selection.length ? '元件注释' : '页面注释', target.annotation || '', value => command([{ type: selection.length ? 'updateNode' : 'updatePage', pageId: page.id, ...(selection.length ? { nodeId: target.id } : {}), patch: { annotation: value } }], '修改注释'), { multiline: true }));
    root.append(note('注释会随项目保存，供你、同事和本地 Agent 查看。'));
  }
  function renderStyles() {
    const host = $('#styles-panel-content'); if (!host) return;
    let root = $('#shared-styles'); if (!root) { root = node('section', 'workspace-section'); root.id = 'shared-styles'; host.prepend(root); }
    if (editing(root)) return; root.replaceChildren();
    if(window.YuandaStyle?.renderShared)return window.YuandaStyle.renderShared(root);
    const state = E.getState(), selection = E.getNodes(), pageId = E.getPage().id;
    root.append(node('h3', 'workspace-section-title', '共享样式'));
    const select = node('select'); select.setAttribute('aria-label', '共享样式');
    const blank = node('option', '', '独立样式'); blank.value = ''; select.append(blank);
    for (const style of state.project.styles || []) { const option = node('option', '', style.name); option.value = style.id; select.append(option); }
    select.value = selection.length && selection.every(item => item.styleId === selection[0].styleId) ? selection[0].styleId || '' : '';
    select.disabled = !selection.length; select.addEventListener('change', () => command([{ type: 'applyStyle', pageId, nodeIds: selection.map(item => item.id), styleId: select.value || null }], '应用共享样式'));
    const create = btn('新建', () => askName('保存共享样式', '样式名称', '新样式', async name => {
      const styleId = uid(); await command([{ type: 'addStyle', style: { id: styleId, name, style: selection[0].style } }, { type: 'applyStyle', pageId, nodeIds: selection.map(item => item.id), styleId }], '创建共享样式');
    })); create.disabled = !selection.length;
    root.append(select, row(create, btn('管理', () => manageStyles())));
    if (select.value) root.append(note('修改共享样式会同步所有引用。直接调整元件外观会解除样式关联。'));
  }
  function openModal(title, build) {
    $('#workspace-dialog')?.remove();
    const dialog = node('dialog', 'workspace-dialog'); dialog.id = 'workspace-dialog';
    const body = node('div', 'workspace-dialog-body');
    dialog.append(row(node('h2', '', title), btn('关闭', () => dialog.close())), body);
    dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); build(body, dialog); dialog.showModal(); return dialog;
  }
  function askName(title, label, value, action) {
    openModal(title, (body, dialog) => {
      const input = field(label, value, () => {}); body.append(input, row(btn('取消', () => dialog.close()), btn('确定', () => { const name = input.querySelector('input').value.trim(); if (!name) return; dialog.close(); action(name); })));
      const commit = event => { if (event.key === 'Enter') { event.preventDefault(); body.querySelectorAll('button')[1].click(); } }; input.addEventListener('keydown', commit); setTimeout(() => input.querySelector('input').select(), 0);
    });
  }
  function manageStyles() {
    if(window.YuandaStyle)return window.YuandaStyle.manageShared();
    openModal('共享样式管理', body => {
      const styles = E.getState().project.styles || [];
      if (!styles.length) { body.append(note('先选中画布元件，在样式面板点击“新建”。')); return; }
      for (const style of styles) {
        const section = node('section', 'workspace-section');
        const patch = value => command([{ type: 'updateStyle', styleId: style.id, patch: value }], '修改共享样式');
        section.append(field('名称', style.name, name => patch({ name })));
        const fields = node('div', 'workspace-grid');
        for (const [key, label] of [['fill','填充'],['stroke','边框'],['color','文字颜色'],['fontSize','字号'],['strokeWidth','描边粗细'],['radius','圆角'],['fontWeight','字重'],['opacity','透明度']]) fields.append(field(label, style.style[key], value => patch({ style: { [key]: value } }), { number: typeof style.style[key] === 'number' }));
        section.append(fields, btn('删除此样式', async () => { await command([{ type: 'removeStyle', styleId: style.id }], '删除共享样式'); section.remove(); })); body.append(section);
      }
    });
  }
  function renderComponents() {
    const root = $('#components-panel-content'); if (!root || editing(root)) return; root.replaceChildren();
    const components = E.getState().project.components || [], selected = E.getNodes(), page = E.getPage();
    const create = btn('从所选元件创建母版', () => askName('创建母版', '母版名称', '新母版', name => command([{ type: 'createComponent', pageId: page.id, nodeIds: selected.map(item => item.id), name }], '创建母版'))); create.disabled = !selected.length || E.getEditingTarget?.().kind==='component'; root.append(create);
    if (!components.length) root.append(note('选中一组可重复使用的内容，把它做成母版。修改母版后，所有实例一起更新。'));
    for (const component of components) {
      const item = node('div', 'component-item'); const name = btn(component.name, () => editComponent(component.id), '编辑母版'); name.classList.add('component-name');
      name.addEventListener('pointerdown', event => startLibraryDrag(event, { componentId: component.id, label: component.name }));
      const insert = btn('插入', async () => { const instanceId = uid(); await command([{ type: 'insertComponent', pageId: page.id, componentId: component.id, instanceId, x: 64, y: 64 }], '插入母版'); const group = E.getPage().groups.find(item => item.id === instanceId); if (group) E.select(group.nodeIds); });
      if(E.getEditingTarget?.().id===component.id)insert.disabled=true;
      item.append(name, row(insert, btn('在画布编辑', () => E.openComponent(component.id)), btn('编辑', () => editComponent(component.id)), btn('删除', () => { if (confirm('删除母版定义？已放到页面上的内容会保留，并解除关联。')) command([{ type: 'removeComponent', componentId: component.id }], '删除母版'); }))); root.append(item);
    }
    const instance = page.groups?.find(group => group.componentId && selected.some(item => group.nodeIds.includes(item.id)));
    if (instance) root.append(note(`当前实例：${instance.name}`), btn('解除母版关联', () => command([{ type: 'detachComponent', pageId: page.id, instanceId: instance.id }], '解除母版关联')));
  }
  function editComponent(componentId) {
    activeComponent = componentId; masterNodeId = null;
    openModal('编辑母版 · 保存后同步所有实例', body => { body.id = 'master-editor'; renderMaster(); });
  }
  function renderMaster() {
    const body = $('#master-editor'), component = E.getState()?.project.components.find(item => item.id === activeComponent); if (!body || !component || editing(body)) return;
    body.replaceChildren(); const update = patch => command([{ type: 'updateComponent', componentId: component.id, patch }], '编辑母版');
    body.append(field('母版名称', component.name, name => update({ name })));
    const preview = node('div', 'master-preview'); const scale = Math.min(1, 480 / Math.max(1, component.width), 260 / Math.max(1, component.height)); preview.style.height = `${Math.max(80, component.height * scale)}px`;
    for (const item of component.nodes) {
      const element = node('button', 'master-preview-node', item.text || item.name); element.type = 'button';
      Object.assign(element.style, { left: `${item.x * scale}px`, top: `${item.y * scale}px`, width: `${item.width * scale}px`, height: `${item.height * scale}px`, background: item.style.fill, color: item.style.color, border: `${item.style.strokeWidth}px solid ${item.style.stroke}`, borderRadius: `${item.style.radius}px`, fontSize: `${item.style.fontSize * scale}px`, transform: `rotate(${item.rotation}deg)` });
      if (item.id === masterNodeId) element.classList.add('chosen'); element.addEventListener('click', () => { masterNodeId = item.id; renderMaster(); }); preview.append(element);
    }
    body.append(preview);
    const options = component.nodes.map(item => [item.id, item.name]); if (!component.nodes.some(item => item.id === masterNodeId)) masterNodeId = component.nodes[0]?.id;
    body.append(field('编辑元件', masterNodeId, id => { masterNodeId = id; renderMaster(); }, { options }));
    const current = component.nodes.find(item => item.id === masterNodeId); if (!current) return;
    const patch = value => command([{ type: 'updateComponentNode', componentId: component.id, nodeId: current.id, patch: value }], '编辑母版元件');
    body.append(field('元件名称', current.name, name => patch({ name })), field('文字', current.text, text => patch({ text }), { multiline: true }));
    const dimensions = node('div', 'workspace-grid'); for (const [key, label] of [['x','X'],['y','Y'],['width','宽度'],['height','高度']]) dimensions.append(field(label, current[key], value => patch({ [key]: value }), { number: true, ...(['width','height'].includes(key) ? { min: 1 } : {}) })); body.append(dimensions);
    const appearance = node('div', 'workspace-grid'); for (const [key,label] of [['fill','填充'],['stroke','边框'],['color','文字颜色'],['fontSize','字号']]) appearance.append(field(label, current.style[key], value => patch({ style: { [key]: value } }), { number: typeof current.style[key] === 'number' })); body.append(appearance);
    body.append(row(btn('添加文字', () => update({ nodes: [...component.nodes, { id: uid(), type: 'text', name: '文字', x: 16, y: 16, width: 160, height: 32, text: '新文字' }] })), btn('添加矩形', () => update({ nodes: [...component.nodes, { id: uid(), type: 'rectangle', name: '矩形', x: 16, y: 64, width: 160, height: 80 }] })), btn('删除元件', () => { if (component.nodes.length < 2) { E.toast('母版至少保留一个元件'); return; } update({ nodes: component.nodes.filter(item => item.id !== current.id) }); })));
    body.append(note('每次修改立即进入撤销记录，关闭窗口即返回画布。'));
  }
  function renderPageTools(force = false) {
    const root = $('#page-tools'); if (!root || (!force && editing(root))) return;
    const navigation = window.YuandaNavigation;
    if (!navigation?.getTreeItems) { root.replaceChildren(note('页面目录正在载入…')); return; }
    const items = navigation.getTreeItems(), selection = navigation.getTreeSelection(), selected = items.find(item => item.id === selection?.id);
    if (!selected) { root.replaceChildren(note('在页面树选择页面或文件夹，再调整它的层级和顺序。')); return; }
    const projectId = E.getState().project.id, expectedRevision = E.getState().revision, context = E.captureContext();
    const focusedControl = root.dataset.projectId === projectId && root.dataset.treeId === selected.id && root.contains(document.activeElement) ? document.activeElement.id : null;
    root.replaceChildren(); root.dataset.projectId = projectId; root.dataset.treeId = selected.id;
    const guarded = action => {
      if (E.getState().project.id !== projectId || E.getState().revision !== expectedRevision || navigation.getTreeSelection()?.id !== selected.id) { E.toast('页面目录已变化，请按最新内容重试。', 'warning'); renderPageTools(true); return; }
      return action();
    };
    const caption = note(`${selected.kind === 'folder' ? '文件夹' : '页面'} · ${selected.name}`); caption.id = 'page-tools-target'; caption.dataset.treeId = selected.id; caption.dataset.treeKind = selected.kind; root.append(caption);
    const excluded = new Set([selected.id, ...navigation.getTreeDescendants(selected.id).map(item => item.id)]);
    const parentOptions = [['', '无（顶层）'], ...items.filter(item => !excluded.has(item.id)).map(item => [item.id, `${'　'.repeat(item.depth)}${item.kind === 'folder' ? '文件夹' : '页面'} · ${item.name}`])];
    const parent = field('上级页面或文件夹', selected.parentId || '', parentId => guarded(() => navigation.reparentTreeItem(selected.id, parentId || null, context, expectedRevision, { restoreTreeFocus: false })), { options: parentOptions });
    parent.querySelector('select').id = 'page-tree-parent'; root.append(parent);
    const siblings = items.filter(item => (item.parentId || null) === (selected.parentId || null)), index = siblings.findIndex(item => item.id === selected.id);
    const up = btn('上移', () => guarded(() => navigation.moveTreeItem(selected.id, siblings[index - 1]?.id, 'before', context, expectedRevision, { restoreTreeFocus: false }))); up.id = 'page-tree-move-up'; up.disabled = index <= 0;
    const down = btn('下移', () => guarded(() => navigation.moveTreeItem(selected.id, siblings[index + 1]?.id, 'after', context, expectedRevision, { restoreTreeFocus: false }))); down.id = 'page-tree-move-down'; down.disabled = index < 0 || index >= siblings.length - 1;
    root.append(row(up, down));
    if (focusedControl) root.querySelector(`#${CSS.escape(focusedControl)}`)?.focus({ preventScroll: true });
  }
  function selectedGroups() { const selected = new Set(E.getSelection().nodeIds); return (E.getPage()?.groups || []).filter(group => group.nodeIds.every(id => selected.has(id))); }
  function groupSelection() { const ids = E.getSelection().nodeIds; if (ids.length < 2) { E.toast('至少选择两个元件才能编组'); return; } command([window.YuandaOutline?{type:'groupItems',pageId:E.getPage().id,items:window.YuandaOutline.selectedItems(),name:'元件组'}:{ type: 'groupNodes', pageId: E.getPage().id, nodeIds: ids, name: '元件组' }], '编组'); }
  function ungroupSelection() { const groups = window.YuandaOutline?window.YuandaOutline.selectedItems().filter(item=>item.kind==='group').map(item=>E.getPage().groups.find(group=>group.id===item.id)):selectedGroups(); command(groups.map(group => ({ type: group.componentId ? 'detachComponent' : 'ungroup', pageId: E.getPage().id, ...(group.componentId ? { instanceId: group.id } : { groupId: group.id }) })), '解除组合'); }
  function moveCommands(moves, targetId = E.getPage().id, context = E.captureContext(targetId)) {
    const page=E.getPage(context);
    return window.YuandaMovement.commands(page,moves).map(command=>{
      const move=moves.find(item=>item.node.id===command.nodeId);
      return {type:'moveNodes',pageId:targetId,nodeIds:command.type==='moveGroup'?page.groups.find(group=>group.id===command.groupId).nodeIds:[command.nodeId],dx:command.dx??move.dx,dy:command.dy??move.dy};
    });
  }
  function distribute(axis) {
    if(E.distribute)return E.distribute(axis);
    const selected = E.getNodes().filter(item => !item.locked), size = axis === 'x' ? 'width' : 'height'; if (selected.length < 3) { E.toast('分布操作至少需要选择三个元件'); return; }
    selected.sort((a,b) => a[axis] - b[axis]); const first = selected[0][axis], end = Math.max(...selected.map(item => item[axis] + item[size])); const gap = (end - first - selected.reduce((sum,item) => sum + item[size], 0)) / (selected.length - 1); let cursor = first;
    const moves = selected.map(item => { const shift = cursor - item[axis]; cursor += item[size] + gap; return { node: item, dx: axis === 'x' ? shift : 0, dy: axis === 'y' ? shift : 0 }; }); command(moveCommands(moves), '等距分布');
  }
  function installOverview() {
    const layerList = $('#layer-list'); const root = node('div', 'workspace-section'); root.id = 'overview-tools';
    const search = node('input', 'workspace-search'); search.type = 'search'; search.placeholder = '搜索元件名称'; search.setAttribute('aria-label', '搜索概览');
    search.addEventListener('input', filterLayers);
    root.append(search, row(btn('编组', groupSelection, 'Ctrl+G 编组'), btn('解组', ungroupSelection, 'Ctrl+Shift+G 解组')), row(btn('水平等距', () => distribute('x')), btn('垂直等距', () => distribute('y'))));
    layerList.before(root);
    const groups = node('div', 'workspace-groups'); groups.id = 'overview-groups'; layerList.before(groups);
  }
  function filterLayers() { const query = $('#overview-tools input')?.value.trim() || ''; if(window.YuandaOutline){window.YuandaOutline.setQuery(query);return;}for (const item of $('#layer-list').children) item.hidden = !item.textContent.includes(query); }
  function renderGroups() {
    const root = $('#overview-groups'); if (!root || editing(root)) return; root.replaceChildren();
    if(window.YuandaOutline){root.hidden=true;filterLayers();return;}
    for (const group of E.getPage().groups || []) {
      const line = row(btn(`${group.componentId ? '母版' : '组'} · ${group.name}`, () => E.select(group.nodeIds)), btn(group.locked ? '解锁' : '锁定', () => command([{ type: 'lockGroup', pageId: E.getPage().id, groupId: group.id, locked: !group.locked }], '切换组锁定'))); root.append(line);
    }
    filterLayers();
  }
  function renderFormProperties() {
    let root = $('#form-properties'); root?.remove(); const item = E.getNodes()[0]; if (E.getNodes().length !== 1 || !item) return;
    if (!['checkbox','radio','select','table','input','textarea'].includes(item.type)) return;
    root = node('section', 'inspector-section'); root.id = 'form-properties'; root.append(node('h3', '', '控件设置'));
    const pageId = E.getPage().id, patch = value => command([{ type: 'updateNode', pageId, nodeId: item.id, patch: value }], '修改控件');
    if (['checkbox','radio'].includes(item.type)) root.append(check('初始选中', item.checked, checked => patch({ checked })));
    if (item.type === 'radio') root.append(field('单选组名称', item.radioGroup, radioGroup => patch({ radioGroup })));
    if (item.type === 'select') root.append(field('选项（每行一项）', item.options.join('\n'), value => patch({ options: value.split('\n') }), { multiline: true }));
    if (item.type === 'input') {
      const setting = field('输入类型', item.inputType, inputType => patch({ inputType, ...(['number','date'].includes(inputType) ? { maxLength: null } : {}) }), { options: [['text','文字'],['password','密码'],['number','数字'],['email','邮箱'],['date','日期'],['tel','电话'],['url','网址'],['search','搜索']] });
      setting.querySelector('select').dataset.formField = 'inputType'; root.append(setting);
    }
    if (['input','textarea'].includes(item.type)) {
      const setting = check('只读（可聚焦和复制，不能输入）', item.readOnly, readOnly => patch({ readOnly })); setting.querySelector('input').dataset.formField = 'readOnly'; root.append(setting);
      if (item.type === 'textarea' || !['number','date'].includes(item.inputType)) {
        const limit = field('最大输入长度（留空表示不限）', item.maxLength ?? '', value => { const text = String(value).trim(); if (!text) patch({ maxLength: null }); else if (/^\d+$/.test(text) && Number(text) <= 50000) patch({ maxLength: Number(text) }); else E.toast('最大长度请输入 0–50000 的整数，或留空。', 'warning'); });
        const input = limit.querySelector('input'); input.inputMode = 'numeric'; input.dataset.formField = 'maxLength'; root.append(limit);
      } else root.append(note('数字和日期使用浏览器原生格式规则，不设置字符长度上限。'));
      root.append(note('长度限制约束用户输入，不截断已保存的初始值或交互设值；只读仍允许交互设值，与禁用不同。'));
    }
    if (['input','textarea','select'].includes(item.type)) root.append(field('初始值', item.value, value => patch({ value })));
    if (item.type === 'table') root.append(btn('编辑表格内容', () => editTable(item.id)));
    $('#inspector').append(root);
  }
  function editTable(nodeId) {
    const item = E.getPage().nodes.find(item => item.id === nodeId); if (!item) return;
    const rows = structuredClone(item.rows), pageId = E.getPage().id;
    openModal('编辑表格', (body, dialog) => {
      const draw = () => {
        body.replaceChildren(); const table = node('table', 'table-editor');
        rows.forEach((values,i) => { const tr = node('tr'); values.forEach((value,j) => { const td = node('td'), input = node('input'); input.value = value; input.setAttribute('aria-label', `第${i+1}行第${j+1}列`); input.addEventListener('input', () => rows[i][j] = input.value); td.append(input); tr.append(td); }); const td = node('td'); td.append(btn('删行', () => { rows.splice(i,1); draw(); })); tr.append(td); table.append(tr); });
        body.append(table, row(btn('添加行', () => { rows.push(Array(Math.max(1, rows[0]?.length || 2)).fill('')); draw(); }), btn('添加列', () => { if (!rows.length) rows.push([]); rows.forEach(row => row.push('')); draw(); }), btn('删除末列', () => { rows.forEach(row => row.pop()); draw(); })), row(btn('取消', () => dialog.close()), btn('保存', () => { command([{ type: 'updateNode', pageId, nodeId, patch: { rows } }], '编辑表格'); dialog.close(); })));
      }; draw();
    });
  }
  function installViewTools() {
    const host = $('.canvas-breadcrumb'); const details = node('details', 'view-menu'); details.append(node('summary', '', '视图设置'));
    const content = node('div', 'view-menu-content');
    for(const[key,label]of [['rulers','显示标尺'],['grid','显示网格'],['guides','显示参考线'],['lockGuides','锁定参考线'],['snapGrid','吸附到网格'],['snapGuides','吸附到参考线'],['snapWidgets','吸附到元件']])content.append(preferenceCheck(key,label));
    content.append(guideScopeField());
    content.append(btn('网格设置…',()=>workspaceDialog('grid')),btn('参考线设置…',()=>workspaceDialog('guides')),btn('吸附设置…',()=>workspaceDialog('snap')));
    details.append(content); host.append(details);
    for (const [selector, axis] of [['#ruler-x','horizontal'],['#ruler-y','vertical']]) { const ruler = $(selector); ruler.title = '拖到画布创建参考线'; ruler.addEventListener('pointerdown', event => beginGuide(event, axis, null)); }
    $('#canvas-viewport').addEventListener('scroll', scheduleRulers, { passive: true });
    new ResizeObserver(scheduleRulers).observe($('.canvas-frame'));
    document.addEventListener('yuanda:layoutchange', scheduleRulers);
    document.addEventListener('pointerdown',event=>{if(!event.target.closest('.canvas-guide,.workspace-dialog,[role="menu"]'))selectedGuide=null;},true);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&rulerDrag){event.preventDefault();event.stopImmediatePropagation();rulerDrag.cancel();return;}
      if(!selectedGuide||event.target.closest('input,textarea,select,[contenteditable]')||document.querySelector('dialog[open]'))return;
      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopImmediatePropagation();deleteGuide(selectedGuide.axis,selectedGuide.position,selectedGuide.scope);}
      else if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();editGuide(selectedGuide.axis,selectedGuide.position,selectedGuide.scope);}
    },true);
    window.addEventListener('blur',()=>rulerDrag?.cancel());
  }
  function preferenceCheck(key,label){const wrapper=check(label,view[key],value=>setPreferences({[key]:value}));wrapper.querySelector('input').dataset.workspacePreference=key;return wrapper;}
  function syncViewControls(){for(const input of document.querySelectorAll('[data-workspace-preference]')){const key=input.dataset.workspacePreference;if(input.type==='checkbox')input.checked=view[key];else if(document.activeElement!==input)input.value=view[key];}}
  function preferenceField(key,label,options={}){const wrapper=field(label,view[key],value=>setPreferences({[key]:value}),options);wrapper.querySelector('input,select').dataset.workspacePreference=key;return wrapper;}
  function colorPreference(key,label){const wrapper=preferenceField(key,label);wrapper.querySelector('input').type='color';return wrapper;}
  const isPageCanvas = () => E.getState()?.project.pages.some(item => item.id === E.getEditingTarget()?.id);
  const activeGuideScope = () => isPageCanvas() ? view.guideScope : 'page';
  const guideScopeLabel = scope => scope === 'project' ? '整个项目' : isPageCanvas() ? '本页' : '本母版';
  const guideSets = () => guideModel?.canvasGuideSets(E.getState().project, E.getEditingTarget().id) || [];
  const guidesFor = scope => guideSets().find(item => item.scope === scope)?.guides;
  function guideScopeField() {
    const fieldNode = field('参考线操作范围', activeGuideScope(), value => setPreferences({ guideScope:value }), { options:[['page','本页 / 本母版'],['project','整个项目（仅页面）']] });
    const select = fieldNode.querySelector('select'); select.dataset.guideScopePicker = '';
    select.querySelector('option[value="project"]').disabled=!isPageCanvas();
    return fieldNode;
  }
  function workspaceDialog(kind='grid'){
    return openModal(kind==='guides'?'参考线设置':kind==='snap'?'吸附设置':'网格设置',(body)=>{
      body.dataset.workspaceDialog=kind;
      if(kind==='grid')body.append(preferenceCheck('grid','显示网格'),preferenceCheck('snapGrid','吸附到网格'),preferenceField('gridSize','网格间距（像素）',{number:true,min:1,max:200}),preferenceField('gridStyle','网格样式',{options:[['dots','点'],['lines','线']]}),colorPreference('gridColor','网格颜色'),note('网格显示与吸附独立。网格属于编辑辅助，不会出现在导出的演示中。'));
      else if(kind==='snap')body.append(preferenceCheck('snapping','启用吸附'),preferenceCheck('snapGrid','吸附到网格'),preferenceCheck('snapGuides','吸附到参考线'),preferenceCheck('snapWidgets','吸附到元件'),colorPreference('snapColor','对齐提示线颜色'),note('元件边缘与中点在屏幕 6 像素内吸附。移动与未旋转的自由缩放支持参考线和元件吸附；等比或旋转缩放优先保持几何关系。'));
      else{
        body.append(preferenceCheck('guides','显示参考线'),preferenceCheck('lockGuides','锁定参考线'),preferenceCheck('snapGuides','吸附到参考线'),colorPreference('guideColor','参考线颜色'),guideScopeField(),note('标尺新建、画布拖动与 Delete 使用所选范围。全局线为虚线，在所有真实页面显示和吸附；母版只使用自己的线。重合时切换操作范围，或在下方明确选择。'));
        const list=node('div','guide-list');
        const drawList = () => { list.replaceChildren(); for(const {scope,guides} of guideSets()) {
          const section=node('section','guide-scope-section'),origin=guideContext(scope); section.dataset.guideScopeSection=scope;
          const guarded=action=>()=>{if(!sameGuideContext(origin)||origin.revision!==E.getState().revision){E.toast('参考线已变化，请按刷新后的列表重新操作。');drawList();return;}return action();};
          section.append(node('h3','',guideScopeLabel(scope)),row(btn(`添加${guideScopeLabel(scope)}参考线…`,guarded(()=>guideDialog({scope}))),btn(`清除${guideScopeLabel(scope)}参考线`,guarded(async()=>{if(await clearGuides(scope))drawList();}))));
          for(const axis of ['horizontal','vertical'])for(const position of guides[axis]) { const entry=row(node('span','',`${axis==='horizontal'?'Y':'X'} = ${position}`),btn('编辑',guarded(()=>guideDialog({axis,position,scope,editing:true,onSaved:()=>workspaceDialog('guides')}))),btn('删除',guarded(async()=>{if(await deleteGuide(axis,position,scope))drawList();})));entry.dataset.guideScope=scope;entry.dataset.guideAxis=axis;entry.dataset.position=position;section.append(entry); }
          list.append(section);
        }};drawList();body.append(list);
      }
    });
  }
  function guideContext(scope=activeGuideScope()){return {scope,projectId:E.getState()?.project.id,targetId:E.getEditingTarget?.().id??E.getPage()?.id,context:E.getEditingContext?.(),revision:E.getState()?.revision};}
  function sameGuideContext(origin){return origin.projectId===E.getState()?.project.id&&origin.targetId===(E.getEditingTarget?.().id??E.getPage()?.id);}
  async function commitGuides(guides,label,origin=guideContext()){
    if(view.lockGuides){E.toast('参考线已锁定，请先解锁。');return false;}
    if(!sameGuideContext(origin)||origin.revision!==E.getState()?.revision){E.toast('页面或项目已变化，请重新操作参考线。');return false;}
    if(!guidesFor(origin.scope)){E.toast('此画布不使用项目全局参考线。');return false;}
    const operation=origin.scope==='project'?{type:'setProjectGuides',guides}:{type:'setPageGuides',pageId:origin.targetId,guides};
    const ok=await E.command([operation],`${guideScopeLabel(origin.scope)} · ${label}`,origin.context,{expectedRevision:origin.revision});if(ok)renderGuides();return ok;
  }
  async function deleteGuide(axis,position,scope=activeGuideScope()){
    if(!['horizontal','vertical'].includes(axis)||!guidesFor(scope)?.[axis]?.includes(position))return false;
    const origin=guideContext(scope),guides=structuredClone(guidesFor(scope));guides[axis]=guides[axis].filter(value=>value!==position);const ok=await commitGuides(guides,'删除参考线',origin);if(ok)selectedGuide=null;return ok;
  }
  async function clearGuides(scope='page'){if(!guidesFor(scope))return false;const ok=await commitGuides({horizontal:[],vertical:[]},'清除参考线',guideContext(scope));if(ok)selectedGuide=null;return ok;}
  function editGuide(axis,position,scope=activeGuideScope()){return guideDialog({axis,position,scope,editing:true});}
  function guideDialog(options={}) {
    if(view.lockGuides){E.toast('参考线已锁定，请先解锁。');return null;}
    const initialScope=options.scope||activeGuideScope(),origin=guideContext(initialScope),oldAxis=options.axis,oldPosition=options.position,editing=!!options.editing;
    if(!guidesFor(initialScope)){E.toast('母版只使用自己的参考线，请在页面画布操作项目全局参考线。');return null;}
    return openModal(`${editing?'编辑':'添加'}${guideScopeLabel(initialScope)}参考线`, (body, dialog) => {
      let axis=['horizontal','vertical'].includes(options.axis)?options.axis:'vertical',position=Number.isFinite(options.position)?options.position:100;
      body.dataset.guideEditorScope=initialScope;
      body.append(note(initialScope==='project'?'范围：整个项目的真实页面；不影响母版。':`范围：仅${guideScopeLabel(initialScope)}；不影响其他页面或全局线。`));
      body.append(field('方向',axis,value=>axis=value,{options:[['vertical','垂直（X）'],['horizontal','水平（Y）']]}),field('位置（像素）',position,value=>position=value,{number:true,min:-100000,max:100000}),btn(editing?'保存位置':'添加',async()=>{
        if(!sameGuideContext(origin)){E.toast('页面已切换，请重新打开参考线设置。');return;}
        const guides=structuredClone(guidesFor(origin.scope));if(editing)guides[oldAxis]=guides[oldAxis].filter(value=>value!==oldPosition);guides[axis]=[...new Set([...guides[axis],round(position)])].sort((a,b)=>a-b);
        if(await commitGuides(guides,editing?'精确调整参考线':'添加参考线',origin)){setPreferences({guideScope:origin.scope});selectedGuide={axis,position:round(position),...guideContext(origin.scope)};dialog.close();options.onSaved?.();}
      }));
    });
  }
  function beginGuide(event, axis, oldPosition, scope=activeGuideScope()) {
    if (event.button !== 0 || !E.getPage()) return;
    event.preventDefault(); event.stopPropagation();if(view.lockGuides){E.toast('参考线已锁定。');return;}
    if(!guidesFor(scope)||scope!==activeGuideScope())return;
    const origin=guideContext(scope);selectedGuide=oldPosition===null?null:{axis,position:oldPosition,...origin};E.select([]);event.currentTarget.focus?.({preventScroll:true});
    rulerDrag = { axis, oldPosition, ...origin, position: oldPosition ?? 0, changed:false };
    const target = event.currentTarget;
    const inside=(event,element)=>{const r=element.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;};
    const move = next => {
      if(!rulerDrag||next.pointerId!==event.pointerId)return;
      if(oldPosition!==null&&!rulerDrag.changed&&Math.abs(next.clientX-event.clientX)+Math.abs(next.clientY-event.clientY)<3)return;
      if(!target.hasPointerCapture(event.pointerId)){try{target.setPointerCapture(event.pointerId);}catch{}}
      target.dataset.dragging='true';const point=E.point(next);rulerDrag.position=round(clamp(axis==='horizontal'?point.y:point.x,-100000,100000));rulerDrag.changed=true;rulerDrag.removing=oldPosition!==null&&inside(next,$(axis==='horizontal'?'#ruler-x':'#ruler-y'));renderGuides();
    };
    const cleanup=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',cancel);if(target.hasPointerCapture(event.pointerId))target.releasePointerCapture(event.pointerId);delete target.dataset.dragging;};
    const finish = async next => {
      if(next.pointerId!==event.pointerId)return;cleanup();
      const drag = rulerDrag; rulerDrag = null; if (!drag) return;
      // Preserve the same DOM target on a simple click so Chromium can deliver dblclick.
      if(oldPosition!==null&&!drag.changed)return;
      if(!sameGuideContext(drag)||E.getState().revision!==drag.revision){E.toast('项目已变化，请重新拖动参考线。');renderGuides();return;}
      const dropping=inside(next,$('#canvas-viewport')),removing=oldPosition!==null&&inside(next,$(axis==='horizontal'?'#ruler-x':'#ruler-y'));
      if(!dropping&&!removing){renderGuides();return;}
      const guides = structuredClone(guidesFor(drag.scope)); if (oldPosition !== null) guides[axis] = guides[axis].filter(value => value !== oldPosition);
      if(dropping)guides[axis].push(drag.position);
      guides[axis]=[...new Set(guides[axis])].sort((a,b)=>a-b);const ok=await commitGuides(guides,removing?'拖回标尺删除参考线':oldPosition===null?'添加参考线':'移动参考线',drag);selectedGuide=!ok||removing?null:{axis,position:drag.position,...guideContext(drag.scope)};renderGuides();
    };
    const cancel = () => { cleanup();rulerDrag=null;renderGuides(); };rulerDrag.cancel=cancel;
    // Document listeners retain the drag if a render/resize releases pointer capture.
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', cancel); move(event);
  }
  function renderGuides() {
    const page = E.getPage(); if (!page) return; let layer = $('#guide-layer'); if (!layer) { layer = node('div'); layer.id = 'guide-layer'; $('#board').append(layer); }
    if(selectedGuide&&(!sameGuideContext(selectedGuide)||selectedGuide.scope!==activeGuideScope()||!guidesFor(selectedGuide.scope)?.[selectedGuide.axis]?.includes(selectedGuide.position)))selectedGuide=null;
    for(const picker of document.querySelectorAll('[data-guide-scope-picker]')){picker.value=activeGuideScope();picker.querySelector('option[value="project"]').disabled=!isPageCanvas();}
    // Keep the captured guide node attached until pointerup.
    if (!rulerDrag || !layer.querySelector('[data-dragging]')) layer.replaceChildren();
    else for (const child of [...layer.children]) if (!child.hasAttribute('data-dragging')) child.remove();
    const board=$('#board'),zoom=E.getZoom();board.classList.toggle('show-grid',view.grid);board.dataset.gridStyle=view.gridStyle;
    for(const[key,value]of Object.entries({'--grid-size':`${view.gridSize}px`,'--grid-color':view.gridColor,'--guide-color':view.guideColor,'--snap-color':view.snapColor,'--guide-hit':`${7/zoom}px`,'--guide-half-hit':`${3/zoom}px`,'--guide-line':`${1/zoom}px`}))board.style.setProperty(key,value);
    $('.canvas-frame')?.classList.toggle('workspace-no-rulers',!view.rulers);
    for (const {scope,guides} of guideSets()) for (const axis of ['horizontal','vertical']) {
      const positions = view.guides ? guides?.[axis] || [] : [];
      for (const position of positions) {
        if (rulerDrag?.scope===scope && rulerDrag.axis === axis && rulerDrag.oldPosition === position) continue;
        const guide = node('div', `canvas-guide ${axis}${scope==='project'?' is-global':''}${scope!==activeGuideScope()?' is-inactive-scope':''}${view.lockGuides ? ' is-locked' : ''}`); guide.style[axis === 'horizontal' ? 'top' : 'left'] = `${position}px`; guide.title = `${guideScopeLabel(scope)} ${axis === 'horizontal' ? 'Y' : 'X'} = ${position} · 双击编辑 · Delete 删除`; guide.dataset.position = position;guide.dataset.guideAxis=axis;guide.dataset.guideScope=scope;guide.tabIndex=scope===activeGuideScope()?0:-1;guide.setAttribute('role','separator');guide.setAttribute('aria-label',`${guideScopeLabel(scope)}${axis==='horizontal'?'水平':'垂直'}参考线 ${position}`);guide.setAttribute('aria-orientation',axis);guide.classList.toggle('is-selected',selectedGuide?.scope===scope&&selectedGuide?.axis===axis&&selectedGuide.position===position);
        guide.addEventListener('pointerdown',event=>beginGuide(event,axis,position,scope));
        guide.addEventListener('dblclick',event=>{event.stopPropagation();editGuide(axis,position,scope);});layer.append(guide);
      }
    }
    if (rulerDrag) { const line = node('div', `canvas-guide preview ${rulerDrag.axis}${rulerDrag.scope==='project'?' is-global':''}${rulerDrag.removing?' will-remove':''}`); line.style[rulerDrag.axis === 'horizontal' ? 'top' : 'left'] = `${rulerDrag.position}px`; line.append(node('span', 'guide-coordinate',`${guideScopeLabel(rulerDrag.scope)} · ${rulerDrag.removing?'松开删除':`${rulerDrag.axis === 'horizontal' ? 'Y' : 'X'} ${rulerDrag.position}`}`)); layer.append(line); }
  }
  let rulerPending = false;
  function scheduleRulers() { if (rulerPending) return; rulerPending = true; requestAnimationFrame(() => { rulerPending = false; drawRulers(); }); }
  function drawRulers() {
    if (!E.getPage()) return; const board = $('#board').getBoundingClientRect(), zoom = E.getZoom();
    for (const [selector, horizontal] of [['#ruler-x',true],['#ruler-y',false]]) {
      const root = $(selector), rect = root.getBoundingClientRect(); let canvas = root.querySelector('canvas'); if (!canvas) { canvas = node('canvas'); root.append(canvas); }
      const width = Math.round(rect.width), height = Math.round(rect.height); if (!width || !height) continue; const ratio = devicePixelRatio || 1;
      canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; const context = canvas.getContext('2d'); context.scale(ratio, ratio); context.clearRect(0,0,width,height); context.fillStyle = '#686868'; context.strokeStyle = '#b7b7b7'; context.font = '10px Segoe UI, sans-serif';
      const offset = horizontal ? board.left - rect.left : board.top - rect.top, length = horizontal ? width : height;
      const major = zoom < .25 ? 500 : zoom < .5 ? 200 : zoom < 1 ? 100 : zoom < 2 ? 50 : 20, minor = major / 5;
      const start = Math.floor(-offset / zoom / minor) * minor;
      for (let position = start; position < (length-offset)/zoom + minor; position += minor) {
        const pixel = Math.round(offset + position * zoom) + .5, big = position % major === 0; context.beginPath();
        if (horizontal) { context.moveTo(pixel,height); context.lineTo(pixel,height-(big ? 9 : 4)); if (big) context.fillText(String(position),pixel+3,10); }
        else { context.moveTo(width,pixel); context.lineTo(width-(big ? 9 : 4),pixel); if (big) { context.save(); context.translate(10,pixel-3); context.rotate(-Math.PI/2); context.fillText(String(position),0,0); context.restore(); } } context.stroke();
      }
    }
  }
  function clearSnap() { $('#smart-snap-layer')?.replaceChildren(); }
  function snapValue(value){return view.snapping&&view.snapGrid?round(Math.round(value/view.gridSize)*view.gridSize):round(value);}
  function snapLayer(){let layer=$('#smart-snap-layer');if(!layer){layer=node('div');layer.id='smart-snap-layer';$('#board').append(layer);}layer.replaceChildren();return layer;}
  function paintedBounds(item){
    const angle=(item.rotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),origin=item.style?.transformOrigin||{x:.5,y:.5};
    const cx=item.x+item.width*origin.x,cy=item.y+item.height*origin.y;
    const corners=[[item.x,item.y],[item.x+item.width,item.y],[item.x,item.y+item.height],[item.x+item.width,item.y+item.height]].map(([x,y])=>({x:cx+(x-cx)*cos-(y-cy)*sin,y:cy+(x-cx)*sin+(y-cy)*cos}));
    return {x:Math.min(...corners.map(p=>p.x)),y:Math.min(...corners.map(p=>p.y)),right:Math.max(...corners.map(p=>p.x)),bottom:Math.max(...corners.map(p=>p.y))};
  }
  function snapTargets(page,ids){
    const targets={x:[],y:[]};
    if(view.snapGuides)for(const {guides} of guideSets()){targets.x.push(...(guides.vertical||[]));targets.y.push(...(guides.horizontal||[]));}
    if(view.snapWidgets){
      targets.x.push(0,page.width/2,page.width);targets.y.push(0,page.height/2,page.height);
      for(const item of window.YuandaAdvanced?.designNodes(page)||page.nodes||[])if(!ids.has(item.id)&&item.visible&&item.effectivePlaced!==false&&!item.editorHidden){const b=paintedBounds(item);targets.x.push(b.x,(b.x+b.right)/2,b.right);targets.y.push(b.y,(b.y+b.bottom)/2,b.bottom);}
    }return targets;
  }
  function nearestSnap(positions,shift,targets,zoom){
    let best=6/Math.max(.1,Number.isFinite(zoom)?zoom:1),result=null;
    for(const target of targets)for(const position of positions){const correction=target-position-shift,distance=Math.abs(correction);if(distance<=best&&(!result||distance<best)){best=distance;result={correction,target};}}
    return result;
  }
  function showSnap(layer,axis,target){const line=node('div',`smart-snap-line ${axis}`);line.style[axis==='x'?'left':'top']=`${target}px`;layer.append(line);}
  function snapMove(original,dx,dy,zoom=E.getZoom()){
    const selected=Array.isArray(original)?original:[...original.values()],layer=snapLayer();if(!selected.length||!view.snapping)return {dx:round(dx),dy:round(dy)};
    const bounds=selected.map(paintedBounds),b={x:Math.min(...bounds.map(p=>p.x)),y:Math.min(...bounds.map(p=>p.y)),right:Math.max(...bounds.map(p=>p.right)),bottom:Math.max(...bounds.map(p=>p.bottom))};
    const targets=snapTargets(E.getPage(),new Set(selected.map(item=>item.id))),shifts={x:dx,y:dy};
    for(const axis of ['x','y']){
      const positions=axis==='x'?[b.x,(b.x+b.right)/2,b.right]:[b.y,(b.y+b.bottom)/2,b.bottom],match=nearestSnap(positions,shifts[axis],targets[axis],zoom);
      if(match){shifts[axis]+=match.correction;showSnap(layer,axis,match.target);}
      else if(view.snapGrid)shifts[axis]=snapValue(positions[0]+shifts[axis])-positions[0];
    }return {dx:round(shifts.x),dy:round(shifts.y)};
  }
  function snapResize(original,candidate,handle,zoom=E.getZoom(),{preserveAspect=false}={}){
    const layer=snapLayer();if(!view.snapping||preserveAspect||Math.abs((original.rotation||0)%360)>.000001)return candidate;
    const result={...candidate},targets=snapTargets(E.getPage(),new Set([original.id]));
    for(const axis of ['x','y']){
      const low=axis==='x'?'w':'n',high=axis==='x'?'e':'s',length=axis==='x'?'width':'height';if(!handle.includes(low)&&!handle.includes(high))continue;
      const movingLow=handle.includes(low),edge=result[axis]+(movingLow?0:result[length]),match=nearestSnap([edge],0,targets[axis],zoom),desired=match?match.target:view.snapGrid?snapValue(edge):edge;
      const fixed=movingLow?result[axis]+result[length]:result[axis],dimension=movingLow?fixed-desired:desired-fixed;if(dimension<16)continue;
      if(movingLow)result[axis]=round(desired);result[length]=round(dimension);if(match)showSnap(layer,axis,match.target);
    }return result;
  }
  function renderExtras() {
    renderPending = false; if (!E.getState() || !E.getPage()) return;
    renderNotes(); renderStyles(); renderComponents(); renderPageTools(); renderGroups(); renderGuides(); renderMaster(); scheduleRulers();
    if (!editing($('#inspector'))) renderFormProperties();
  }
  function scheduleRender() { if (renderPending) return; renderPending = true; requestAnimationFrame(renderExtras); }
  installLibrary(); installOverview(); installViewTools();
  const pageTools = node('div', 'workspace-section'); pageTools.id = 'page-tools'; $('#page-list').after(pageTools);
  document.addEventListener('yuanda:editorchange', scheduleRender);
  document.addEventListener('yuanda:pagetreechange', () => renderPageTools(true));
  document.addEventListener('yuanda:panelactivate', scheduleRender);
  document.addEventListener('focusout', event => { if (event.target.closest('.panel-body,#master-editor')) setTimeout(scheduleRender, 100); });
  document.addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection(); }
  });
  window.YuandaTools = { snapMove, clearSnap, moveCommands, editTable, editComponent, groupSelection, ungroupSelection, distribute, openModal, field, check, row, btn, note, node, command, scheduleRender, getView:()=>({...view,smartSnap:view.snapWidgets}) };
  window.YuandaWorkspace={preferences,setPreferences,toggle:togglePreference,dialog:workspaceDialog,guideDialog,editGuide,deleteGuide,clearGuides,guideSets,activeGuideScope,snapValue,snapMove,snapResize,clearSnap,
    guideAtElement(target){const guide=target?.closest?.('.canvas-guide[data-guide-axis]');return guide?{scope:guide.dataset.guideScope,axis:guide.dataset.guideAxis,position:Number(guide.dataset.position)}:null;},
    math:Object.freeze({paintedBounds,nearestSnap})};
  scheduleRender();
})();
