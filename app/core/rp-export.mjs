/** Independent, limited RP11 writer. No Axure runtime, code, template or binary is used.
 * The format observations and compatibility limits are documented in
 * research/yuanda-rp-compatibility.md. This is separate from the native .yuanda format.
 */
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { validateProject, normalizeProject } from './document.mjs';
import { makeRpHtmlPrototypeConfiguration } from './rp-html-config.mjs';
import { newStyleDefaults, styleValueEqual, resolveNodeBaseStyle } from './style-model.mjs';
import { inspectImageDataUrl } from './image-format.mjs';
import { getOrderedPages } from './page-tree-model.mjs';

const ZERO = '00000000-0000-0000-0000-000000000000';
const DEFAULT_STYLE = '627587b6-038d-43cc-a051-c114ac41ad32';
const BASE_VIEW = '19e82109-f102-476f-9335-82835c373474';
const typed = (tag, value) => ({ $rp: tag, value });
const double = value => typed(6, Number(value));
const guid = value => typed(17, value ?? ZERO);
const ref = value => typed(3, value ?? ZERO);
const packageId = (name, id) => typed(19, { name, id });
const dictionary = entries => typed(1, entries);
const version = () => ({ Major: 11, Minor: 0, Build: 0, Revision: 0 });
const fill = color => ({ 'fill-type': 'solid', 'fill-color': color });
const prop = (offset, value) => ({ DOAName: -1073741824 + offset, Value: value });
const point = (x, y) => ({ X: double(x), Y: double(y) });
const size = (width, height) => ({ Width: double(width), Height: double(height) });

function i32(value) {
  const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes;
}
function u32(value) {
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes;
}
function guidBytes(value) {
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) throw new Error('Invalid GUID');
  const raw = Buffer.from(value.replaceAll('-', ''), 'hex');
  return Buffer.from([raw[3],raw[2],raw[1],raw[0],raw[5],raw[4],raw[7],raw[6],...raw.subarray(8)]);
}
function varint(value) {
  const bytes = [];
  do { const part = value & 127; value = Math.floor(value / 128); bytes.push(part | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}

/** Write a typed object stream using new string and GUID tables for each package. */
export function encodeRpObjectPackage({ rootId, packageId: rootPackageId, objects }) {
  const strings = new Map(); const guids = new Map(); const chunks = [];
  const intern = (map, value) => { if (!map.has(value)) map.set(value, map.size + 1); return map.get(value); };
  const stringIndex = value => i32(value == null ? 0 : intern(strings, String(value)));
  const guidIndex = value => i32(value == null || value === ZERO ? 0 : intern(guids, value));
  const write = value => {
    if (value && typeof value === 'object' && '$rp' in value) {
      const { $rp: tag, value: payload } = value;
      chunks.push(i32(tag));
      if ([3,17,20,21,22].includes(tag)) chunks.push(guidIndex(payload));
      else if (tag === 4) { const bytes = Buffer.from(payload); chunks.push(i32(bytes.length), bytes); }
      else if (tag === 19 || tag === 16) chunks.push(stringIndex(payload.name), guidIndex(payload.id));
      else if (tag === 6) { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(payload); chunks.push(bytes); }
      else if (tag === 1) {
        chunks.push(i32(payload.length)); for (const [key, child] of payload) { write(key); write(child); }
      } else throw new Error(`Unsupported typed value ${tag}`);
    } else if (Array.isArray(value)) {
      chunks.push(i32(2), i32(value.length)); value.forEach(write);
    } else if (typeof value === 'string') chunks.push(i32(8), stringIndex(value));
    else if (typeof value === 'boolean') chunks.push(i32(25), Buffer.from([value ? 1 : 0]));
    else if (typeof value === 'bigint') {
      const bytes = Buffer.alloc(8); bytes.writeBigInt64LE(value); chunks.push(i32(29), bytes);
    } else if (typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) chunks.push(i32(5), i32(value));
    else if (typeof value === 'number') {
      const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); chunks.push(i32(6), bytes);
    } else if (value && typeof value === 'object') write(dictionary(Object.entries(value)));
    else throw new Error('Unsupported RP value');
  };
  chunks.push(i32(26), i32(15), guidIndex(rootId), i32(18), guidIndex(rootPackageId));
  for (const object of objects) {
    chunks.push(i32(9), guidIndex(object.id), stringIndex(object.type)); write(object.properties);
  }
  chunks.push(i32(28));
  const head = [i32(27), i32(11), i32(0), i32(0), i32(0), i32(50001), i32(31), i32(strings.size)];
  for (const text of strings.keys()) { const utf8 = Buffer.from(text, 'utf8'); head.push(i32(utf8.length), utf8); }
  head.push(i32(30), i32(guids.size)); for (const id of guids.keys()) head.push(guidBytes(id));
  return gzipSync(Buffer.concat([...head, ...chunks]), { level: 6 });
}

/** The observed legacy LZ4 framing also admits an uncompressed chunk (flag zero). */
export function encodeRpContainer(parts) {
  const root = { children: {}, parts: {} }; const body = []; let offset = 0;
  for (const part of parts) {
    let group = root;
    for (const segment of part.group ?? []) {
      group.children ??= {};
      group = group.children[segment] ??= { children: {}, parts: {} };
    }
    group.parts[part.name] = offset;
    const payload = Buffer.from(part.bytes);
    body.push(u32(0), u32(payload.length), payload); offset += 8 + payload.length;
  }
  const index = Buffer.from(JSON.stringify({ root }), 'utf8');
  const legacy = Buffer.concat([varint(0), varint(index.length), index]);
  return Buffer.concat([Buffer.from([172,239,11,0]), u32(legacy.length), legacy, ...body]);
}

function color(value, fallback = '#ffffff') {
  const named = { transparent:'#00000000',white:'#ffffff',black:'#000000' };
  let hex = (named[value?.toLowerCase()] ?? value ?? fallback).replace(/^#/, '');
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map(x=>x+x).join('');
  if (!/^[a-f\d]{6}([a-f\d]{2})?$/i.test(hex)) throw new Error('Unsupported RP color');
  const rgb = parseInt(hex.slice(0,6),16), alpha = hex.length===8 ? parseInt(hex.slice(6),16) : 255;
  return ((alpha << 24) | rgb) | 0;
}
function shapeStyle(node, base = false) {
  const s = node?.style ?? {};
  // Native property names 10–14 are vertical alignment and L/T/R/B padding.
  // Preserve our renderer's type-specific defaults rather than giving every
  // text widget the same centered six-pixel inset.
  const pad = node?.type === 'text' ? {left:0,top:0,right:0,bottom:0}
    : node?.type === 'image' ? Object.fromEntries(['left','top','right','bottom'].map(side=>[side,node.image?.text?.padding ?? 8]))
      : {left:8,top:4,right:8,bottom:4};
  const vertical = node?.type === 'text' ? 0 : node?.type === 'image' ? {top:0,middle:1,bottom:2}[node.image?.text?.verticalAlign ?? 'middle'] : 1;
  return {
    LibraryId: guid(ZERO), LibraryName: '', LegacyName: '', 'style-name': base ? 'Default' : 'MyStyle',
    Id: guid(base ? DEFAULT_STYLE : randomUUID()),
    PropList: [
      prop(0,guid(DEFAULT_STYLE)), prop(1,'Arial'), prop(2,double((s.fontSize ?? 16)*0.75)),
      prop(1001,s.fontWeight ?? 400), prop(1002,0), prop(1003,5), prop(5,false),
      prop(6,fill(color(s.color, '#20242c'))), prop(9,{ left:0,center:1,right:2 }[s.align] ?? 0),
      prop(7,fill(color(s.fill))), prop(8,fill(color(s.stroke, '#cbd5e1'))),
      prop(15,double(s.strokeWidth ?? 1)), prop(16,1), prop(70,double(s.opacity ?? 1)),
      prop(50,double(node?.rotation ?? 0)), prop(71,double(s.radius ?? 0)),
      prop(101,point(node?.x ?? 0,node?.y ?? 0)), prop(105,size(node?.width ?? 0,node?.height ?? 0)),
      prop(10,vertical), prop(11,double(pad.left)), prop(12,double(pad.top)), prop(13,double(pad.right)), prop(14,double(pad.bottom)),
      prop(96,guid(BASE_VIEW)), prop(1400,{Duration:double(0),Easing:0}),
    ], Capabilities: -1n, All: base,
  };
}

/** Original inert specification preferences using observed field names/types.
 * RP document saving dereferences the default specification package even when
 * the user only edits a shape. Do not embed the vendor's Word template: the
 * native loader handles an absent template using its own installed resources.
 * These settings do not implement or promise Word specification export.
 */
function specificationOptions() {
  const generator = {};
  const flags = `show-pages-section show-sitemap-list generate-all-pages
    include-masters-section include-master-list only-list-generated-masters
    only-generate-used-masters exclude-custom-widgets generate-all-masters
    collapse-masters-into-page-section include-notes show-note-names
    include-page-interactions include-screenshot show-footnoes-on-screenshot
    show-border-on-screenshot lock-footnote-aspect-ratio check-panel-interactions
    include-annotations include-masters-on-page include-rollovers-on-page
    include-droplist-options-on-page include-listbox-options-on-page
    include-dynamic-panels-on-page include-submenus-on-page separate-dynamic-panel-tables
    include-expanded-trees load-inline-frame-defaults two-column-layout
    include-master-usage-report disable-sketch-options disable-background-styles
    allow-screenshots-break note-names-use-basic-heading include-page-interactions-header
    page-interactions-use-basic-heading first-master-use-in-pages-section
    exclude-master-notes-in-pages-section exclude-footnotes-not-in-tables
    include-pages-section-header include-sitemap-header include-masters-section-header
    include-master-list-header include-master-usage-header include-master-usage-pages-header
    include-master-usage-masters-header include-screenshot-header include-used-masters-header`;
  for (const key of flags.trim().split(/\s+/)) generator[key] = 'False';
  const headings = `pages-section-header sitemap-section-header page-interactions-header
    masters-section-header masters-list-section-header screenshot-section-header
    ObjectIdFieldHeading footnote-heading label-field-heading interaction-field-heading
    text-heading tooltip-heading master-list-header rollover-image-header
    default-image-text rollover-image-text droplist-header listbox-header
    included-list-of-masters-header master-usage-header master-usage-pages-header
    master-usage-masters-header list-options-heading location-and-size-heading`;
  for (const key of headings.trim().split(/\s+/)) generator[key] = '';
  for (const key of ['page-ids-to-generate','master-ids-to-generate','notes-fields-to-generate','annotation-tables','content-list']) generator[key] = [];
  generator['annotation-property-name-id-to-name-text'] = {};
  generator['notes-property-name-id-to-name-text'] = {};
  generator['left-column-width-percent'] = double(0.5);
  generator['max-image-height-percent'] = double(0.9);
  generator['max-image-width-percent'] = double(0.9);
  generator.GenerateAllAdaptiveViews = false;
  const word = {};
  for (const key of ['style-heading1','style-heading2','style-heading3','style-heading4','style-heading-basic','style-table','style-table-header','style-table-normal','style-normal']) word[key] = 'Normal';
  word['allow-rows-to-break'] = 'False';
  word['autosize-columns'] = 'False';
  return {generator,word};
}

/** Build only format facts and user project data; never reads an Axure file. */
function modelPackages(project) {
  const docId = randomUUID(); const docPackageId = randomUUID(); const docObjects = [];
  const add = (list,type,properties,id = randomUUID()) => { list.push({id,type:`Axure:${type}`,properties}); return id; };
  const tree = (list,children=[]) => { const id = randomUUID(); add(list,'Tree',{children:children.map(ref),tree:ref(id)},id); return id; };
  const annotationFields = () => {
    const key = add(docObjects,'PropertyKey',{'propertykey-items':[],'name-index':{}});
    return add(docObjects,'AnnotationFieldSet',{'property-key':ref(key),'annotation-field-views':[]});
  };
  const defaultStyle = add(docObjects,'Style',shapeStyle(null,true));
  const stylesheet = add(docObjects,'StyleSheet',{GuidToDuplicate:{},ArchivedStyles:[],CustomStyles:[],DefaultStyle:ref(defaultStyle),LegacyTableHorz:1,LegacyTableVert:1});
  const pageDefaultStyle = add(docObjects,'PageStyle',{'BaseStyle.Name':'','style-name':'Default',Id:guid(DEFAULT_STYLE),PropList:[prop(0,guid(DEFAULT_STYLE)),prop(7,fill(-1)),prop(26,1),prop(105,size(0,0))],Capabilities:-4194305n,All:true});
  const pageStyles = add(docObjects,'PageStyleSheet',{GuidToDuplicate:{},ArchivedStyles:[],PageStyles:[],DefaultPageStyle:ref(pageDefaultStyle)});
  const globals = add(docObjects,'GlobalVariableSet',{'global-variables':[]});
  const widgetFields = annotationFields(); const pageFields = annotationFields();
  const siteTreeId = randomUUID(); const siteNodes = []; const siteMapEntries = []; const packageInfos = []; const parts = [];
  // Allocate every destination first; forward, backward and self links use the
  // actual package identity, never a filename or user-facing page label.
  const pageIds = new Map(project.pages.map(page => [page.id, randomUUID()]));
  const clickMap = (objects, interaction) => {
    const destination = project.pages.find(page => page.id === interaction.actions[0].pageId);
    const literal = add(objects,'Expr:StringLiteral', {value:`${destination.name}.html`,'variable-identifiers':[],'repeater-scope':ref(ZERO),TargetRepeaterScope:ref(ZERO)});
    const target = add(objects,'InteractionTarget',{'target-type':1,'target-page-id':packageId('Axure:Page',pageIds.get(destination.id)),'target-literal':ref(literal)});
    const action = add(objects,'InteractionLinkWindowAction',{Disabled:false,target:ref(target),'link-type':1});
    const interactionCase = add(objects,'InteractionCase',{Disabled:false,Description:interaction.name || '',Condition:ref(ZERO),IsNewIfGroup:false});
    const event = add(objects,'InteractionEvent',{Disabled:false,'event-type':16,'master-containing-raised-event':typed(16,{name:null,id:ZERO}),'raised-event-id':guid(ZERO),'variable-id':guid(ZERO)});
    const root = randomUUID(), eventNode = randomUUID(), caseNode = randomUUID(), actionNode = randomUUID();
    add(objects,'Node',{children:[ref(actionNode)],'parent-node':ref(eventNode),tree:ref(root)},caseNode);
    add(objects,'Node',{children:[],'parent-node':ref(caseNode),tree:ref(root)},actionNode);
    add(objects,'Node',{children:[ref(caseNode)],'parent-node':ref(root),tree:ref(root)},eventNode);
    add(objects,'Tree',{children:[ref(eventNode)],tree:ref(root)},root);
    return add(objects,'InteractionTreeMap',{'node-table':dictionary([[ref(eventNode),ref(event)],[ref(caseNode),ref(interactionCase)],[ref(actionNode),ref(action)]]),tree:ref(root),PackageMode:false});
  };
  for (const page of project.pages) {
    const pagePackageId = pageIds.get(page.id);
    const objects = []; const pageRootId = randomUUID(); const diagramId = randomUUID(); const nodeIds = [];
    for (const sourceNode of page.nodes) {
      const node = {...sourceNode,style:resolveNodeBaseStyle(project,sourceNode)};
      const id = randomUUID(); nodeIds.push(id);
      const nodeStyle = shapeStyle(node);
      if (node.type === 'image') {
        const bytes = Buffer.from(node.src.slice(node.src.indexOf(',')+1),'base64');
        // The observed image property is a byte stream, extension hint and MD5
        // cache identity. The bytes come only from the user's project image.
        nodeStyle.PropList.push(prop(27,{Stream:typed(4,bytes),Extension:'',Hash:createHash('md5').update(bytes).digest('base64')}));
      }
      const styleId = add(objects,'Style',nodeStyle);
      const align = {left:0,center:1,right:2}[node.style?.align] ?? 0;
      const properties = {
        ControlPoints:[[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>({Path:point(x,y),LowerHandle:point(NaN,NaN),HigherHandle:point(NaN,NaN),HigherSegmentExists:true}))],
        Shape:0, 'reference-page-package-id':packageId('Axure:Page',ZERO),
        'name-block':{'*type':'text-block',text:node.name ?? '', 'property-dictionary':{type:'label','diagram-object-id':guid(id),'parent-diagram-id':guid(diagramId)}},
        tooltip:'',IsContained:false,IsLocked:!!node.locked,SelectedStyleGroup:'',MyStyle:ref(styleId),AdaptiveStyles:[],SubmitButton:ref(ZERO),Disabled:false,Selected:false,Error:false,VisibleFromSettings:node.visible!==false,
        RichTextBlock:{'*type':'rich-text-block','attributed-string':{Version:version(),Paragraphs:[{Wrapping:0,Trimming:0,HorizontalAlignment:align,LineSpacing:double(0),ListInfo:{IndentLevel:0,ListType:0},Inlines:[{Type:'Axure:AttributedString:AxRun',Text:node.text??'',Family:'Arial',Size:double((node.style?.fontSize??16)*0.75),Weight:node.style?.fontWeight??400,Style:0,Stretch:5,Underline:false,Color:color(node.style?.color,'#20242c'),Baseline:0,CharacterSpacing:double(0),Strikethrough:false}]}]},'property-dictionary':{type:'rich-text-object','diagram-object-label':node.name??'','text-object-id':guid(id),'parent-diagram-id':guid(diagramId)}},
        AutoFitHeight:false,AutoFitWidth:false,
      };
      if (node.interactions.length) properties.InteractionMap = ref(clickMap(objects,node.interactions[0]));
      if (node.type === 'image') {
        delete properties.ControlPoints; delete properties.Shape; delete properties['reference-page-package-id']; delete properties.RichTextBlock;
        properties.PreserveCornersRectangle = {X:double(0),Y:double(0),Width:double(0),Height:double(0)};
        properties['fit-to-image'] = node.image.autoFit;
      }
      add(objects,node.type === 'image' ? 'DiagramObject:ImageBox' : 'DiagramObject:VectorShape',properties,id);
    }
    const annotationTree = tree(objects);
    const annotationMap = add(objects,'AnnotationTreeMap',{'node-table':{},tree:ref(annotationTree)});
    const rulers = add(objects,'RulerGuideSet',{'ruler-guides':[]});
    const style = add(objects,'PageStyle',{'BaseStyle.Name':'','style-name':'MyPageStyle',Id:guid(randomUUID()),PropList:[prop(7,fill(color(page.background))),prop(105,size(page.width,page.height))],Capabilities:-4194305n,All:false});
    const annotation = add(objects,'Annotation',{'property-name-id-to-value':{},'property-name-id-to-name-text':{},'annotation-field-set-type':'PageFragment',OwnerId:typed(22,ZERO),StaticFields:0});
    const interactions = add(objects,'InteractionTreeMap',{'node-table':{},tree:ref(tree(objects)),PackageMode:false});
    add(objects,'Diagram',{'diagram-objects':nodeIds.map(ref),AnnLinkList:ref(annotationMap),'ruler-guide-set':ref(rulers),GroupsClean3:true},diagramId);
    // The modern page loader reads the cache dictionary without a null fallback.
    // Start with our own empty collections; do not copy the vendor's default
    // style/font data. This candidate still requires real Axure acceptance.
    add(objects,'Page',{AdaptiveViewSetId:guid(ZERO),AdaptiveViewSet:ref(ZERO),diagram:ref(diagramId),'page-style':ref(style),AdaptiveStyles:[],AdaptiveViewMatchInfos:[],StyleCache:{Styles:[],TypefaceToFullName:[],TypefaceToCssName:[]},annotation:ref(annotation),interactionmap:ref(interactions),HackLegacyContainedObjects2:true},pageRootId);
    // Root first makes the graph easy to audit. Forward references use GUIDs.
    objects.unshift(objects.pop());
    parts.push({group:[pagePackageId.replaceAll('-','')],name:'package',bytes:encodeRpObjectPackage({rootId:pageRootId,packageId:pagePackageId,objects})});
    packageInfos.push(add(docObjects,'PackageInfo',{'package-id':packageId('Axure:Page',pagePackageId),'package-name':page.name,dependencies:[],'diagram-type':0,LoadedRdoPackages:[],LoadedScreenshotPackages:[],PackageSavedVersion:version()}));
    const nodeId = add(docObjects,'Node',{children:[],'parent-node':ref(siteTreeId),tree:ref(siteTreeId)}); siteNodes.push(nodeId);
    siteMapEntries.push([ref(nodeId),packageId('Axure:PackageInfo',pagePackageId)]);
  }
  add(docObjects,'Tree',{children:siteNodes.map(ref),tree:ref(siteTreeId)},siteTreeId);
  const sitemap = add(docObjects,'SiteTreeMap',{'node-table':dictionary(siteMapEntries),tree:ref(siteTreeId)});
  const mastermap = add(docObjects,'MasterTreeMap',{'node-table':{},tree:ref(tree(docObjects))});
  const rulers = add(docObjects,'RulerGuideSet',{'ruler-guides':[]});
  // Candidate03 could open, but native Save dereferenced the missing default
  // specification PackageInfo. Include a real, fully linked original package.
  const specPackageId = randomUUID(); const specObjects = [];
  const {generator,word} = specificationOptions();
  const generatorOptions = add(specObjects,'SpecGen:GeneratorSpecOptions',generator);
  const wordOptions = add(specObjects,'SpecGen:WordSpecOptions',word);
  const specOptions = add(specObjects,'SpecGen:SpecOptions',{'generator-spec-options':ref(generatorOptions),'word-spec-options':ref(wordOptions),'output-docx-file-path':''});
  const specRoot = add(specObjects,'Word2007SpecificationGeneratorConfiguration',{'spec-options':ref(specOptions)});
  specObjects.unshift(specObjects.pop());
  parts.push({group:[specPackageId.replaceAll('-','')],name:'package',bytes:encodeRpObjectPackage({rootId:specRoot,packageId:specPackageId,objects:specObjects})});
  const specType = 'Axure:Word2007SpecificationGeneratorConfiguration';
  const specName = '原搭规格设置';
  packageInfos.push(add(docObjects,'PackageInfo',{'package-id':packageId(specType,specPackageId),'package-name':specName,dependencies:[],'diagram-type':0,LoadedRdoPackages:[],LoadedScreenshotPackages:[],PackageSavedVersion:version()}));
  // Native preview requires a default HTML configuration, independently of the
  // settings needed for saving. It may otherwise fail before reading any action.
  const htmlPackageId = randomUUID(); const htmlObjects = [];
  const htmlRoot = add(htmlObjects,'HtmlPrototypeGeneratorConfiguration',makeRpHtmlPrototypeConfiguration());
  const htmlType = 'Axure:HtmlPrototypeGeneratorConfiguration'; const htmlName = '原搭 HTML';
  parts.push({group:[htmlPackageId.replaceAll('-','')],name:'package',bytes:encodeRpObjectPackage({rootId:htmlRoot,packageId:htmlPackageId,objects:htmlObjects})});
  packageInfos.push(add(docObjects,'PackageInfo',{'package-id':packageId(htmlType,htmlPackageId),'package-name':htmlName,dependencies:[],'diagram-type':0,LoadedRdoPackages:[],LoadedScreenshotPackages:[],PackageSavedVersion:version()}));
  add(docObjects,'DesignDocument',{'document-type':1,SavedEdition:1,StyleSheet:ref(stylesheet),PageStyleSheet:ref(pageStyles),GlobalVariableSet:ref(globals),DiagramObjectAnnotationFieldSet:ref(widgetFields),PageFragmentAnnotationFieldSet:ref(pageFields),PackageInfos:packageInfos.map(ref),AdaptiveViewSets:[],sitemap:ref(sitemap),mastermap:ref(mastermap),'default-prototype-configuration-id':packageId(htmlType,htmlPackageId),'default-specification-configuration-id':packageId(specType,specPackageId),DefaultPrintConfigId:packageId('Axure:PrintConfig',ZERO),'generator-configuration-ids':[packageId(specName,specPackageId),packageId(htmlName,htmlPackageId)],'ruler-guide-set':ref(rulers),UpgradedSVNFrom7Hack:false},docId);
  docObjects.unshift(docObjects.pop());
  parts.push({name:'DesignDocument',bytes:encodeRpObjectPackage({rootId:docId,packageId:docPackageId,objects:docObjects})});
  // The reader has an explicit absent-settings fallback; avoid claiming a partly
  // specified preference object is complete. Axure constructs its own settings.
  return parts;
}

export function getRpExportStatus(project) {
  const unsupported=[];
  if (project?.pageFolders?.length) unsupported.push('项目: 页面文件夹组织（包含空文件夹）');
  if (project?.styles?.length) unsupported.push('项目: 共享样式库及关联');
  if (project?.components?.length) unsupported.push('项目: 母版定义及实例关联');
  if (project?.variables?.length) unsupported.push('项目: 变量');
  if (project?.viewSets?.length) unsupported.push('项目: 共享自适应视图集');
  if (project?.defaultStyleSets?.length || project?.defaultStyleSetId) unsupported.push('项目: 默认样式集及关联');
  for(const page of project?.pages ?? []) {
    const pageLabel = page.name || page.id || '页面';
    if (page.parentId) unsupported.push(`${pageLabel}: 页面父子层级`);
    if (page.groups?.length) unsupported.push(`${pageLabel}: 分组及母版实例`);
    if (page.guides?.horizontal?.length || page.guides?.vertical?.length) unsupported.push(`${pageLabel}: 参考线`);
    if (page.annotation) unsupported.push(`${pageLabel}: 页面注释`);
    if (page.views?.length || page.viewSetId || Object.keys(page.viewOverrides || {}).length) unsupported.push(`${pageLabel}: 自适应视图`);
    if (page.interactions?.length) unsupported.push(`${pageLabel}: 页面交互`);
    for(const node of page.nodes ?? []) {
      const label = `${pageLabel} / ${node.name || node.id || '元件'}`;
      if(!['rectangle','text','button','image'].includes(node.type)) unsupported.push(`${label}: ${node.type}`);
      if(node.interactions?.length) {
        const interaction = node.interactions[0];
        const clickSettings=node.eventSettings?.click;
        if(node.interactions.length !== 1 || interaction.event !== 'click' || interaction.condition != null || (interaction.caseMode ?? 'if') !== 'if' || interaction.enabled === false || clickSettings?.enabled===false || clickSettings?.executionMode==='menu' || interaction.actions?.length !== 1 || interaction.actions[0].enabled===false || interaction.actions[0].type !== 'navigate') unsupported.push(`${label}: 交互动作（仅支持一个启用的无条件单击跳页）`);
      }
      // New authoring features must never disappear merely because the original
      // basic writer predates their model fields.
      let effectiveStyle; try { effectiveStyle = resolveNodeBaseStyle(project,node); } catch { effectiveStyle = node.style; }
      const extraStyles = Object.entries(newStyleDefaults()).filter(([key,value]) => effectiveStyle?.[key] !== undefined && !styleValueEqual(effectiveStyle[key],value)).map(([key]) => key);
      if(extraStyles.length) unsupported.push(`${label}: 高级样式 ${extraStyles.join('、')}`);
      if(node.defaultStyleSetId) unsupported.push(`${label}: 默认样式集关联`);
      if(node.type === 'image') {
        let info; try { info = inspectImageDataUrl(node.src); } catch { /* Validation reports the precise image error when exporting. */ }
        if(!node.src || info?.format !== 'png' || info?.animated) unsupported.push(`${label}: 图片格式（仅支持静态 PNG）`);
        const settings = node.image;
        if(!settings || settings.fit !== 'stretch' || settings.crop || settings.flipX || settings.flipY || settings.filters?.enabled || settings.corners || settings.cuts?.length || settings.text?.enabled || settings.optimization) unsupported.push(`${label}: 图片裁剪、翻转、调色、角部、挖空、文字或优化（仅支持原图拉伸）`);
        if(node.text) unsupported.push(`${label}: 图片文字内容`);
      }
      if(node.annotation) unsupported.push(`${label}: 元件注释`);
      if(node.placed === false) unsupported.push(`${label}: 取消放置状态`);
      if(node.styleId) unsupported.push(`${label}: 共享样式关联`);
      if(node.richText) unsupported.push(`${label}: 富文本分段格式`);
      if(node.checked || node.value || node.options?.length || node.rows?.length || node.radioGroup || node.readOnly || node.maxLength != null || (node.inputType && node.inputType !== 'text')) unsupported.push(`${label}: 表单值、选项或输入属性`);
      if(node.disabled || node.selected || node.error) unsupported.push(`${label}: 禁用、选中或错误状态`);
      if(Object.keys(node.stateStyles || {}).length) unsupported.push(`${label}: 交互状态样式`);
      if(Object.keys(node.bindings || {}).length) unsupported.push(`${label}: 数据绑定`);
      if(node.panel || node.repeater) unsupported.push(`${label}: 容器状态或数据集`);
    }
  }
  return {status:unsupported.length ? 'unsupported-content' : 'limited-compatible',canExport:!unsupported.length,verifiedInAxure:false,artifactNativeVerified:false,basicSubsetUserAccepted:true,
    supportedTypes:['rectangle','text','button','image'],unsupported,
    verification:{basic:'user-accepted-open-edit-save-reopen-preview',imagesAndLinks:'independent-decoder-verified-native-pending',fullProjectRoundtrip:false},
    message:'RP 支持基础图形、文字、多页面、静态 PNG 和单击跳页。基础保存预览已人工验收；新生成的图片与元件点击跳页完成独立解码校验，尚未逐项完成 Axure 实测。复杂内容会阻止导出；完整可继续编辑的项目仍需原搭项目文件。'};
}

export function exportRp(project,options={}) {
  project = normalizeProject(project);
  validateProject(project);
  const status=getRpExportStatus(project);
  // Legacy research options do not override the loss-prevention gate.
  if(status.unsupported.length) throw new Error(`RP 尚不支持以下内容，已停止导出避免丢失：\n${status.unsupported.join('\n')}`);
  project.pages = getOrderedPages(project);
  return {data:encodeRpContainer(modelPackages(project)),warnings:[],status};
}
