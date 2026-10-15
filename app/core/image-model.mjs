/** Original, nondestructive image data and editing commands. No decoding or filesystem access. */
import { inspectImageDataUrl } from './image-format.mjs';
import { rotateNodePoint } from './widget-geometry.mjs';
import { remapNodeReferences } from './interaction-model.mjs';
import { getCanvasViews, getCanvasViewOverrides, resolveContainerView } from './view-model.mjs';

const own = (object, key) => Object.hasOwn(object, key);
const copy = value => structuredClone(value);
const put = (object, key, value) => { Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true}); return value; };
const rectKeys = ['x','y','width','height'];
export const IMAGE_NODE_KEYS = ['image'];
export const IMAGE_COMMANDS = ['setImageOptions','replaceImage','cropImage','fitImage','sliceImage','clearImage'];
export const IMAGE_KEYS = ['naturalWidth','naturalHeight','autoFit','fit','crop','flipX','flipY','filters','corners','cuts','text','optimization'];
export function imageDefaults(legacy = false) {
  return { naturalWidth:null,naturalHeight:null,autoFit:!legacy,fit:legacy?'cover':'stretch',crop:null,flipX:false,flipY:false,
    filters:{enabled:false,hue:0,saturation:1,brightness:1,contrast:1},corners:null,cuts:[],
    text:{enabled:false,verticalAlign:'middle',padding:8},optimization:null };
}
export function nodeImageDefaults(type, legacy = false) { return { image:type==='image'?imageDefaults(legacy):null }; }
export function normalizeImageProject(project) {
  for(const canvas of [...(project.pages||[]),...(project.components||[])]) for(const node of canvas?.nodes||[]) {
    if(node && typeof node==='object' && !own(node,'image')) Object.assign(node,nodeImageDefaults(node.type,true));
  }
  return project;
}
const validatedImages = new Map(); let validatedImageBytes = 0;
export function imageDataBytes(src) {
  if(validatedImages.has(src)){const bytes=validatedImages.get(src);validatedImages.delete(src);validatedImages.set(src,bytes);return bytes;}
  let info;try{info=inspectImageDataUrl(src);}catch(error){error.code='VALIDATION_ERROR';throw error;}
  validatedImages.set(src,info.bytes);validatedImageBytes+=info.bytes;
  while(validatedImages.size>32||validatedImageBytes>8*1024*1024){const first=validatedImages.keys().next().value;validatedImageBytes-=validatedImages.get(first);validatedImages.delete(first);}
  return info.bytes;
}

export function validateImageRect(rect,h,label='图片区域') {
  h.keys(rect,rectKeys,label);for(const key of rectKeys)h.number(rect[key],label+(key==='x'||key==='y'?'位置':'尺寸'),key==='x'||key==='y'?0:0.000001,1);
  if(rect.x+rect.width>1.000000001||rect.y+rect.height>1.000000001)h.fail(`${label}不能超出原图`);
}
export function validateImageOptions(node,h) {
  if(node.type!=='image'){if(node.image!==null)h.fail('只有图片元件可以有图片设置');return;}
  const image=node.image;h.keys(image,IMAGE_KEYS,'图片设置');
  if((image.naturalWidth===null)!==(image.naturalHeight===null))h.fail('原图宽高必须同时提供或同时为 null');
  if(image.naturalWidth!==null){for(const key of ['naturalWidth','naturalHeight']){h.number(image[key],'原图尺寸',1,8192);if(!Number.isInteger(image[key]))h.fail('原图尺寸必须为整数');}if(image.naturalWidth*image.naturalHeight>16*1024*1024)h.fail('原图像素超过限制');}
  for(const key of ['autoFit','flipX','flipY'])h.bool(image[key],'图片设置');
  if(!['cover','stretch'].includes(image.fit))h.fail('图片填充必须为 cover 或 stretch');
  if(image.crop!==null)validateImageRect(image.crop,h,'裁剪区域');
  h.array(image.cuts,'图片挖空区域',100);for(const rect of image.cuts)validateImageRect(rect,h,'挖空区域');
  h.keys(image.filters,['enabled','hue','saturation','brightness','contrast'],'图片调色');h.bool(image.filters.enabled,'开启调色');h.number(image.filters.hue,'色相',-180,180);
  for(const key of ['saturation','brightness','contrast'])h.number(image.filters[key],'图片调色强度',0,4);
  h.keys(image.text,['enabled','verticalAlign','padding'],'图片文字');h.bool(image.text.enabled,'显示图片文字');h.number(image.text.padding,'文字边距',0,1000);if(!['top','middle','bottom'].includes(image.text.verticalAlign))h.fail('图片文字垂直位置无效');
  if(image.corners!==null){h.keys(image.corners,['top','right','bottom','left'],'保留角部');for(const value of Object.values(image.corners))h.number(value,'保留角部像素',0,8192);}
  if(image.optimization!==null){const optimized=image.optimization;h.keys(optimized,['src','width','height','format','quality'],'优化副本');imageDataBytes(optimized.src);if(!['png','jpeg','webp'].includes(optimized.format)||!optimized.src.startsWith(`data:image/${optimized.format};base64,`))h.fail('优化副本格式不一致');for(const key of ['width','height']){h.number(optimized[key],'优化副本尺寸',1,8192);if(!Number.isInteger(optimized[key]))h.fail('优化副本尺寸必须为整数');}if(optimized.width*optimized.height>16*1024*1024)h.fail('优化副本像素超过限制');h.number(optimized.quality,'优化质量',0,1);}
  if(!node.src&&(image.crop!==null||image.corners!==null||image.cuts.length||image.optimization!==null||image.naturalWidth!==null))h.fail('空图片不能包含裁剪、角部、挖空、尺寸或优化副本');
}

/** Source replacement must never accidentally retain a derived copy of the old picture. */
export function resetImageSource(image, {naturalWidth=null,naturalHeight=null}={}) {
  return {...copy(image||imageDefaults()),naturalWidth,naturalHeight,crop:null,corners:null,cuts:[],optimization:null};
}
/** Both page and legacy component patch routes use this rule on their own cloned patch. */
export function prepareImageNodePatch(node,patch) {
  if(node.type!=='image'||own(patch,'image'))return patch;
  if(own(patch,'src')&&patch.src!==node.src)patch.image=resetImageSource(node.image);
  if(own(patch,'width')||own(patch,'height'))patch.image={...(patch.image||node.image),autoFit:false};
  return patch;
}
export function mergeImagePatch(image,patch,h) {
  h.keys(patch,IMAGE_KEYS,'图片属性修改',false);
  const next={...copy(image),...copy(patch)};
  for(const key of ['filters','text'])if(own(patch,key)){h.keys(patch[key],Object.keys(image[key]),'图片属性修改',false);next[key]={...image[key],...copy(patch[key])};}
  return next;
}
function sourceCrop(node) {
  const image=node.image,rect=copy(image.crop||{x:0,y:0,width:1,height:1});
  if(image.fit!=='cover'||image.corners||!image.naturalWidth||!image.naturalHeight)return rect;
  const sourceRatio=image.naturalWidth*rect.width/(image.naturalHeight*rect.height),targetRatio=node.width/node.height;
  if(sourceRatio>targetRatio){const width=rect.width*targetRatio/sourceRatio;rect.x+=(rect.width-width)/2;rect.width=width;}
  else if(sourceRatio<targetRatio){const height=rect.height*sourceRatio/targetRatio;rect.y+=(rect.height-height)/2;rect.height=height;}
  return rect;
}
function sliceBounds(node,part) {
  const w=node.width*part.width,h=node.height*part.height,a=(node.rotation||0)*Math.PI/180,o=node.style.transformOrigin||{x:.5,y:.5};
  const corner=rotateNodePoint(node,node.x+node.width*part.x,node.y+node.height*part.y),ox=w*o.x,oy=h*o.y;
  return {x:corner.x-ox+ox*Math.cos(a)-oy*Math.sin(a),y:corner.y-oy+ox*Math.sin(a)+oy*Math.cos(a),width:w,height:h};
}
function sliceSource(node,part) {
  const crop=sourceCrop(node),x=node.image.flipX?1-part.x-part.width:part.x,y=node.image.flipY?1-part.y-part.height:part.y;
  return {x:crop.x+crop.width*x,y:crop.y+crop.height*y,width:crop.width*part.width,height:crop.height*part.height};
}
function setCanvasPatch(project,canvas,viewId,nodeId,patch) {
  const legacy=!canvas.viewSetId&&canvas.views.find(view=>view.id===viewId&&own(view,'overrides'));
  const map=legacy?legacy.overrides:own(canvas.viewOverrides,viewId)?canvas.viewOverrides[viewId]:put(canvas.viewOverrides,viewId,{});
  put(map,nodeId,{...(own(map,nodeId)?map[nodeId]:{}),...patch});
}
export function applyImageCommand(project,command,h) {
  if(!IMAGE_COMMANDS.includes(command.type))return false;
  const signatures={setImageOptions:['patch'],replaceImage:['src','naturalWidth','naturalHeight'],cropImage:['crop'],fitImage:['width','height'],sliceImage:['axis'],clearImage:[]};
  h.keys(command,['type','pageId','nodeId',...signatures[command.type],...(command.type==='sliceImage'?['atX','atY','ids']:[])],'图片命令',false);
  for(const key of ['pageId','nodeId',...signatures[command.type]])if(!own(command,key))h.fail(`图片命令缺少 ${key}`,'COMMAND_ERROR');
  const canvas=h.pageFor(project,command.pageId),node=h.nodeFor(canvas,command.nodeId);if(node.type!=='image')h.fail('请先选择图片元件','COMMAND_ERROR');h.assertEditable(canvas,node);
  if(command.type==='setImageOptions')node.image=mergeImagePatch(node.image,command.patch,h);
  if(command.type==='replaceImage'){
    imageDataBytes(command.src);for(const key of ['naturalWidth','naturalHeight']){h.number(command[key],'原图尺寸',1,8192);if(!Number.isInteger(command[key]))h.fail('原图尺寸必须为整数');}
    node.src=command.src;node.image=resetImageSource(node.image,command);
    if(node.image.autoFit){node.width=command.naturalWidth;node.height=command.naturalHeight;}
  }
  if(command.type==='cropImage'){
    if(!node.src)h.fail('请先导入图片','COMMAND_ERROR');if(command.crop!==null)validateImageRect(command.crop,h,'裁剪区域');
    node.image={...node.image,crop:copy(command.crop),fit:'stretch',corners:null};
  }
  if(command.type==='fitImage'){
    if(!node.src)h.fail('请先导入图片','COMMAND_ERROR');for(const key of ['width','height'])h.number(command[key],'图片适应尺寸',1,8192);
    node.width=command.width;node.height=command.height;node.image={...node.image,autoFit:true};
  }
  if(command.type==='clearImage'){node.src='';node.image={...imageDefaults(),autoFit:node.image.autoFit,fit:node.image.fit,text:copy(node.image.text)};}
  if(command.type==='sliceImage'){
    if(!node.src)h.fail('请先导入图片','COMMAND_ERROR');if(!['horizontal','vertical','cross'].includes(command.axis))h.fail('切片方向无效','COMMAND_ERROR');
    const x=command.atX??.5,y=command.atY??.5;h.number(x,'横向切点',.000001,.999999);h.number(y,'纵向切点',.000001,.999999);
    if(node.image.corners)h.fail('请先关闭保留角部再切片，避免改变角部图像','COMMAND_ERROR');
    if(node.image.fit==='cover'&&(!node.image.naturalWidth||!node.image.naturalHeight))h.fail('请先读取原图尺寸再切片','COMMAND_ERROR');
    const xs=command.axis==='horizontal'?[0,1]:[0,x,1],ys=command.axis==='vertical'?[0,1]:[0,y,1],parts=[];
    for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++)parts.push({x:xs[i],y:ys[j],width:xs[i+1]-xs[i],height:ys[j+1]-ys[j]});
    const ids=command.ids??parts.slice(1).map(()=>h.uuid());h.array(ids,'切片新编号',3);if(ids.length!==parts.length-1)h.fail('切片新编号数量不符','COMMAND_ERROR');for(const id of ids)h.id(id,'切片新编号');
    const original=copy(node),viewNodes=new Map(getCanvasViews(project,canvas).map(view=>[view.id,resolveContainerView(project,canvas.id,view.id).nodes.find(item=>item.id===node.id)]));
    const styles=[node,...viewNodes.values()].flatMap(item=>[item.style,...Object.values(item.stateStyles||{}).map(state=>({...item.style,...state}))]);
    if(styles.some(style=>Object.values(style.borderSides||{all:style.strokeWidth}).some(value=>value>0)||Object.values(style.radiusCorners||{all:style.radius}).some(value=>value>0)))h.fail('请先将全部视图和状态的图片边框宽度和圆角设为 0 再切片','COMMAND_ERROR');
    if(styles.some(style=>style.fillPaint||style.shadows?.length||style.blur>0||style.backdropBlur>0))h.fail('请先关闭全部视图和状态的渐变或图片填充、阴影和模糊后再切片，避免分片产生新的边缘效果','COMMAND_ERROR');
    if(node.image.text.enabled&&node.text)h.fail('请先关闭图片文字再切片，避免多份文字重叠','COMMAND_ERROR');
    if(node.image.fit==='cover'&&[...viewNodes.values()].some(item=>JSON.stringify(sourceCrop(item))!==JSON.stringify(sourceCrop(original))))h.fail('此图片在不同视图显示的区域不同，请先改为拉伸后再切片','COMMAND_ERROR');
    const slices=parts.map((part,index)=>{
      const id=index?ids[index-1]:node.id,clone=index?remapNodeReferences(original,new Map([[original.id,id]])):copy(original);clone.id=id;clone.name=index?`${original.name} · 切片 ${index+1}`.slice(0,200):original.name;
      Object.assign(clone,sliceBounds(original,part));clone.image={...clone.image,crop:sliceSource(original,part),fit:'stretch',autoFit:false};return clone;
    });
    const position=canvas.nodes.indexOf(node);canvas.nodes.splice(position,1,...slices);
    for(const owner of canvas.nodes){for(const state of owner.panel?.states||[])if(state.nodeIds.includes(node.id))state.nodeIds.splice(state.nodeIds.indexOf(node.id)+1,0,...ids);if(owner.repeater?.templateIds.includes(node.id))owner.repeater.templateIds.splice(owner.repeater.templateIds.indexOf(node.id)+1,0,...ids);}
    for(const group of canvas.groups)if(group.nodeIds.includes(node.id))group.nodeIds.push(...ids);
    for(const [viewId,projected]of viewNodes)for(let index=0;index<slices.length;index++){
      const before=getCanvasViewOverrides(project,canvas,viewId)?.[node.id]||{};
      if(index&&Object.keys(before).length)setCanvasPatch(project,canvas,viewId,slices[index].id,copy(before));
      setCanvasPatch(project,canvas,viewId,slices[index].id,sliceBounds(projected,parts[index]));
    }
  }
  return true;
}
