/** Independent read-only inspector for original-writer RP output.
 * No imports from the exporter; no native application or vendor code executes.
 * Supports the uncompressed index framing emitted by this project, not every RP.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveNodeBaseStyle } from '../app/core/style-model.mjs';
import { resolveNodeVisual } from '../app/core/style-renderer.mjs';

const ZERO='00000000-0000-0000-0000-000000000000';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function must(condition,message){if(!condition)throw new Error(`RP audit: ${message}`);}
export function inspectGeneratedRp(data) {
  must(data.subarray(0,4).toString('hex')==='acef0b00','container magic');
  const indexSize=data.readUInt32LE(4), base=8+indexSize;
  must(base<=data.length,'index bounds');const packed=data.subarray(8,base);let at=0;
  const vint=()=>{let value=0,shift=0;for(;;){must(at<packed.length&&shift<35,'index integer');const byte=packed[at++];value+=(byte&127)*2**shift;if(!(byte&128))return value;shift+=7;}};
  must(vint()===0,'only original-writer uncompressed index is supported');const length=vint();must(at+length===packed.length,'index length');
  const index=JSON.parse(packed.subarray(at).toString('utf8')),members=[];
  const walk=(group,path='')=>{for(const [name,child]of Object.entries(group.children||{}))walk(child,`${path}/${name}`);for(const [name,offset]of Object.entries(group.parts||{}))members.push({path,name,offset});};walk(index.root);
  let end=base;const packages=[];
  for(const member of members){const begin=base+member.offset;must(begin===end&&begin+8<=data.length,'contiguous records');const storedCrc=data.readUInt32LE(begin),count=data.readUInt32LE(begin+4);end=begin+8+count;must(end<=data.length,'member bounds');const bytes=gunzipSync(data.subarray(begin+8,end));packages.push({...member,storedCrc,sha256:sha(bytes),...readObjectStream(bytes)});}
  must(end===data.length,'no trailing bytes');
  const packageIds=new Set(packages.map(p=>p.packageId));must(packageIds.size===packages.length,'unique packages');
  for(const pkg of packages){const ids=new Set(pkg.objects.map(o=>o.id));must(ids.size===pkg.objects.length&&ids.has(pkg.rootId),'unique objects and valid root');
    const visit=value=>{if(value instanceof Map){for(const [k,v]of value){visit(k);visit(v);}}else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object'&&!Buffer.isBuffer(value)){if(value.tag===3&&value.guid!==ZERO)must(ids.has(value.guid),`missing local ref ${value.guid}`);if(value.tag===19&&value.guid!==ZERO)must(packageIds.has(value.guid),`missing package ref ${value.guid}`);}};
    pkg.objects.forEach(o=>visit(o.properties));
  }
  return {bytes:data.length,sha256:sha(data),packages};
}
function readObjectStream(data){let at=0,strings=[null],guids=[ZERO];
  const take=n=>{must(n>=0&&at+n<=data.length,'object stream bounds');const out=data.subarray(at,at+n);at+=n;return out;};
  const integer=()=>take(4).readInt32LE();
  const expect=n=>must(integer()===n,`expected token ${n}`);
  const s=()=>{const n=integer();must(n>=0&&n<strings.length,'string index');return strings[n];};
  const g=()=>{const n=integer();must(n>=0&&n<guids.length,'guid index');return guids[n];};
  let values=0;const value=(depth=0)=>{must(depth<100&&++values<1000000,'value budget');const tag=integer();
    if(tag===1){const count=integer();must(count>=0&&count<100000,'dictionary size');const map=new Map();for(let i=0;i<count;i++)map.set(value(depth+1),value(depth+1));return map;}
    if(tag===2){const count=integer();must(count>=0&&count<100000,'list size');return Array.from({length:count},()=>value(depth+1));}
    if([3,17,20,21,22].includes(tag))return {tag,guid:g()};
    if([16,19].includes(tag))return {tag,name:s(),guid:g()};
    if(tag===4)return Buffer.from(take(integer()));
    if(tag===5)return integer();if(tag===6)return take(8).readDoubleLE();if(tag===7)return take(4).readFloatLE();if(tag===8)return s();if(tag===25)return !!take(1)[0];if(tag===29)return take(8).readBigInt64LE();
    throw new Error(`RP audit: unsupported value token ${tag}`);
  };
  expect(27);const version=Array.from({length:4},integer);expect(50001);expect(31);let count=integer();must(count>=0&&count<100000,'string table');for(let i=0;i<count;i++)strings.push(take(integer()).toString('utf8'));
  expect(30);count=integer();must(count>=0&&count<100000,'guid table');for(let i=0;i<count;i++){const b=take(16);guids.push(`${b.readUInt32LE().toString(16).padStart(8,'0')}-${b.readUInt16LE(4).toString(16).padStart(4,'0')}-${b.readUInt16LE(6).toString(16).padStart(4,'0')}-${b.subarray(8,10).toString('hex')}-${b.subarray(10).toString('hex')}`);}
  expect(26);expect(15);const rootId=g();expect(18);const packageId=g(),objects=[];
  for(;;){const tag=integer();if(tag===28)break;must(tag===9,'object token');objects.push({id:g(),type:s(),properties:value()});}
  must(at===data.length,'object stream fully consumed');return {version,rootId,packageId,objects};
}
export const rpField=(object,key)=>object.properties.get(key);
const styleProperties=object=>new Map(rpField(object,'PropList').map(property=>[property.get('DOAName')+1073741824,property.get('Value')]));
function expectedArgb(value){let hex=({white:'#ffffff',black:'#000000',transparent:'#00000000'}[String(value).toLowerCase()]||value).slice(1);if(hex.length<5)hex=[...hex].map(x=>x+x).join('');return (parseInt(hex.slice(0,6),16)+(hex.length===8?parseInt(hex.slice(6),16):255)*16777216)|0;}
function checkFill(actual,expected,label){must(actual instanceof Map&&actual.get('fill-type')==='solid'&&actual.get('fill-color')===expectedArgb(expected),label);}
export function auditGeneratedProject(data,project){const result=inspectGeneratedRp(data),doc=result.packages.flatMap(p=>p.objects).find(o=>o.type==='Axure:DesignDocument');must(doc,'document');
  const pages=result.packages.filter(p=>p.objects.find(o=>o.id===p.rootId)?.type==='Axure:Page');must(pages.length===project.pages.length,'page count');
  const info=new Map(result.packages.flatMap(p=>p.objects).filter(o=>o.type==='Axure:PackageInfo').map(o=>[rpField(o,'package-id').guid,rpField(o,'package-name')]));
  let nodes=0,images=0,links=0;
  for(let pi=0;pi<pages.length;pi++){const pkg=pages[pi],page=project.pages[pi],byId=new Map(pkg.objects.map(o=>[o.id,o]));must(info.get(pkg.packageId)===page.name,'page identity');
    const root=byId.get(pkg.rootId),pageStyle=styleProperties(byId.get(rpField(root,'page-style').guid));
    must(pageStyle.get(105).get('Width')===page.width&&pageStyle.get(105).get('Height')===page.height,'page dimensions');checkFill(pageStyle.get(7),page.background,'page background');
    const diagram=byId.get(rpField(root,'diagram').guid),objects=rpField(diagram,'diagram-objects').map(r=>byId.get(r.guid));must(objects.length===page.nodes.length,'node count and stacking order');
    for(let ni=0;ni<objects.length;ni++){const object=objects[ni],node=page.nodes[ni];nodes++;must(rpField(object,'name-block').get('text')===node.name,'node label');
      const style=byId.get(rpField(object,'MyStyle').guid),props=styleProperties(style),expected=resolveNodeBaseStyle(project,node),metrics=resolveNodeVisual(node,{style:expected});
      must(props.get(50)===node.rotation,'rotation');must(props.get(101).get('X')===node.x&&props.get(101).get('Y')===node.y,'location');must(props.get(105).get('Width')===node.width&&props.get(105).get('Height')===node.height,'size');
      must(rpField(object,'VisibleFromSettings')===(node.visible!==false),'visibility');must(rpField(object,'IsLocked')===!!node.locked,'locked state');
      must(props.get(2)===expected.fontSize*.75,'font size');must(props.get(1001)===expected.fontWeight,'font weight');must(props.get(9)==={left:0,center:1,right:2}[expected.align],'horizontal alignment');
      must(props.get(10)==={top:0,middle:1,bottom:2}[metrics.text.verticalAlign],'vertical alignment');
      for(const [offset,side]of [[11,'left'],[12,'top'],[13,'right'],[14,'bottom']])must(props.get(offset)===metrics.padding[side],`text padding ${side}`);
      checkFill(props.get(6),expected.color,'text color');checkFill(props.get(7),expected.fill,'fill color');checkFill(props.get(8),expected.stroke,'border color');
      must(props.get(15)===expected.strokeWidth,'border width');must(props.get(70)===expected.opacity,'opacity');must(props.get(71)===expected.radius,'corner radius');
      if(node.type==='image'){images++;must(object.type==='Axure:DiagramObject:ImageBox','image native type');const image=props.get(27),actual=image.get('Stream'),source=Buffer.from(node.src.split(',')[1],'base64');must(actual.equals(source),'image bytes exactly preserved');must(image.get('Hash')===createHash('md5').update(source).digest('base64'),'image cache hash');}
      else{const paragraphs=rpField(object,'RichTextBlock').get('attributed-string').get('Paragraphs');must(paragraphs.map(p=>p.get('Inlines').map(i=>i.get('Text')).join('')).join('\n')===node.text,'plain text');for(const paragraph of paragraphs){must(paragraph.get('HorizontalAlignment')==={left:0,center:1,right:2}[expected.align],'paragraph alignment');for(const run of paragraph.get('Inlines'))must(run.get('Size')===expected.fontSize*.75&&run.get('Weight')===expected.fontWeight&&run.get('Color')===expectedArgb(expected.color),'text run style');}}
      if(node.interactions.length){links++;const map=byId.get(rpField(object,'InteractionMap').guid),table=rpField(map,'node-table'),tree=byId.get(rpField(map,'tree').guid),lookup=id=>{const pair=[...table].find(([key])=>key.guid===id);must(pair,'interaction tree node mapping');return byId.get(pair[1].guid);};
        const en=byId.get(rpField(tree,'children')[0].guid),event=lookup(en.id);must(rpField(event,'event-type')===16,'click event');const cn=byId.get(rpField(en,'children')[0].guid),c=lookup(cn.id);must(c.type==='Axure:InteractionCase'&&rpField(c,'Condition').guid===ZERO,'unconditional case');const an=byId.get(rpField(cn,'children')[0].guid),action=lookup(an.id);must(action.type==='Axure:InteractionLinkWindowAction'&&rpField(action,'link-type')===1,'same-window navigation');const target=byId.get(rpField(action,'target').guid),index=project.pages.findIndex(p=>p.id===node.interactions[0].actions[0].pageId);must(index>=0&&rpField(target,'target-page-id').guid===pages[index].packageId,'destination is actual page package');
      }
    }
  }
  const html=rpField(doc,'default-prototype-configuration-id');must(result.packages.some(p=>p.packageId===html.guid&&p.objects.find(o=>o.id===p.rootId)?.type==='Axure:HtmlPrototypeGeneratorConfiguration'),'default HTML configuration');
  return {passed:true,sha256:result.sha256,bytes:result.bytes,packages:result.packages.length,pages:pages.length,nodes,images,links,
    checkedFields:['page dimensions/background','node position/size/rotation/order','visibility/lock','font size/weight/alignment/color','vertical text alignment and padding','fill/border/radius/opacity','text','PNG bytes','page destinations','object/package references','default HTML configuration'],
    limitations:['Independent decode and selected-field comparison only; this does not execute Axure or certify full visual fidelity.','Font substitution, text wrapping, pixel rendering and native interaction execution are not verified.','New image and whole-widget click generation has not received native GUI acceptance.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [rp,json,out]=process.argv.slice(2);if(!rp||!json)throw new Error('Usage: node scripts/inspect-generated-rp.mjs file.rp source-project.json [new-report.json]');const report=auditGeneratedProject(await readFile(rp),JSON.parse(await readFile(json,'utf8')));if(out)await writeFile(out,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));}
