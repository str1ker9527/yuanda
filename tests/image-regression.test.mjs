import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createBlankProject,makeNode,DocumentEngine} from '../app/core/document.mjs';
import {imageDefaults} from '../app/core/image-model.mjs';
import {inspectImageBytes,inspectImageDataUrl} from '../app/core/image-format.mjs';

// Original model fixtures: decoding/pixel identity is covered by desktop tests.
const oldImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGPgEpH7D8IACDMCd0kivAIAAAAASUVORK5CYII=',replacement='data:image/gif;base64,R0lGODlhAgABAIAAAP8AAAAA/yH5BAAKAAAALAAAAAACAAEAAAICBAoAIfkEAAoAAAAsAAAAAAIAAQAAAgJMCgA7';
function fixture(){
  const project=createBlankProject('图片独立审查');project.pages[0].id='page';
  const engine=new DocumentEngine(project);
  engine.apply([{type:'addComponent',component:{id:'master',name:'图片母版',nodes:[makeNode('image',{
    id:'photo',src:oldImage,width:400,height:200,
    image:{...imageDefaults(),naturalWidth:400,naturalHeight:200,crop:{x:.1,y:0,width:.5,height:1},
      corners:{top:1,right:1,bottom:1,left:1},cuts:[{x:0,y:0,width:.1,height:.1}],
      optimization:{src:oldImage,width:40,height:20,format:'png',quality:1}}
  })]}},{type:'insertComponent',pageId:'page',componentId:'master',instanceId:'instance',x:500,y:100}]);
  return engine;
}
test('Agent直接更换母版src清除旧图派生数据，同步实例且可保存撤销',()=>{
  const engine=fixture(),before=engine.getSnapshot();
  engine.apply([{type:'updateComponentNode',componentId:'master',nodeId:'photo',patch:{src:replacement}}]);
  const after=engine.getSnapshot();
  for(const node of [after.components[0].nodes[0],after.pages[0].nodes[0]]){
    assert.equal(node.src,replacement);assert.equal(node.image.optimization,null);
    assert.equal(node.image.crop,null);assert.equal(node.image.corners,null);assert.deepEqual(node.image.cuts,[]);
    assert.equal(node.image.naturalWidth,null);assert.equal(node.image.naturalHeight,null);
  }
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(after))).getSnapshot(),after);
  engine.undo();assert.deepEqual(engine.getSnapshot(),before);engine.redo();assert.deepEqual(engine.getSnapshot(),after);
});
test('Agent直接改母版尺寸退出自动适应，后来替图不覆盖手动外框',()=>{
  const engine=fixture();
  engine.apply([{type:'updateComponentNode',componentId:'master',nodeId:'photo',patch:{width:333,height:111}}]);
  assert.equal(engine.getSnapshot().components[0].nodes[0].image.autoFit,false);
  engine.apply([{type:'componentCommands',componentId:'master',commands:[{type:'replaceImage',nodeId:'photo',src:replacement,naturalWidth:80,naturalHeight:40}]}]);
  for(const node of [engine.getSnapshot().components[0].nodes[0],engine.getSnapshot().pages[0].nodes[0]])assert.deepEqual([node.width,node.height],[333,111]);
});
function pngBytes(width,height){
  const chunk=(type,data)=>{const name=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);let crc=0xffffffff;for(const byte of Buffer.concat([name,data])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,name,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
test('Agent与项目读取按实际PNG头拒绝9000x1，不依赖可伪造的尺寸提示并原子回滚',()=>{
  const bytes=pngBytes(9000,1),src='data:image/png;base64,'+bytes.toString('base64');assert(bytes.length<200);
  const project=createBlankProject();project.pages[0].id='page';const engine=new DocumentEngine(project),before=engine.getSnapshot(),revision=engine.revision;
  for(const hint of [null,1]){
    const node=makeNode('image',{id:'oversize',src,image:{...imageDefaults(),naturalWidth:hint,naturalHeight:hint}});
    assert.throws(()=>engine.apply([{type:'renameProject',name:'不应写入'},{type:'addNode',pageId:'page',node}]),error=>error.code==='VALIDATION_ERROR'&&/8192/.test(error.message));
    assert.deepEqual(engine.getSnapshot(),before);assert.equal(engine.revision,revision);assert.equal(engine.canUndo,false);
    const file=structuredClone(before);file.pages[0].nodes.push(node);assert.throws(()=>new DocumentEngine(file),{code:'VALIDATION_ERROR'});
  }
});
test('MIME伪装、PNG头部CRC损坏和错误优化副本均拒绝，正常小图仍可保存',()=>{
  const bytes=pngBytes(2,1),broken=Buffer.from(bytes);broken[16]^=1;
  const invalid=[replacement.replace('image/gif','image/png'),'data:image/png;base64,'+broken.toString('base64')];
  const engine=fixture(),before=engine.getSnapshot();
  for(const src of invalid){assert.throws(()=>engine.apply([{type:'updateComponentNode',componentId:'master',nodeId:'photo',patch:{src}}]),{code:'VALIDATION_ERROR'});assert.deepEqual(engine.getSnapshot(),before);}
  assert.throws(()=>engine.apply([{type:'componentCommands',componentId:'master',commands:[{type:'setImageOptions',nodeId:'photo',patch:{optimization:{src:invalid[0],width:2,height:1,format:'png',quality:1}}}]}]),{code:'VALIDATION_ERROR'});assert.deepEqual(engine.getSnapshot(),before);
  assert.deepEqual(new DocumentEngine(JSON.parse(JSON.stringify(before))).getSnapshot(),before);
});
test('预检函数可独立序列化到浏览器，不依赖Node Buffer或外部模块常量',()=>{
  const isolatedBytes=Function(`return (${inspectImageBytes.toString()})`)();
  const isolatedUrl=Function('inspectImageBytes',`return (${inspectImageDataUrl.toString()})`)(isolatedBytes);
  const info=isolatedUrl(oldImage);assert.equal(info.format,'png');assert.equal(info.width,2);assert.equal(info.height,1);assert(info.bytes>0);
  assert.throws(()=>isolatedBytes(new Uint8Array(pngBytes(9000,1))),error=>error.code==='IMAGE_ERROR'&&/8192/.test(error.message));
});
