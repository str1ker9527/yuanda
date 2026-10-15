import {getVectorGeometry,richRunStyle} from '../core/vector-model.mjs';
import {paintImageContent} from '../core/image-renderer.mjs';
import {applyNodeVisual,applyVectorVisual} from '../core/style-renderer.mjs';

/** Static local previews use typed DOM and the same style painter as the canvas. */
let serial=0;
export function previewVisibleNodes(nodes){
  const hidden=new Set(nodes.filter(node=>!node.visible||node.effectivePlaced===false).map(node=>node.id));
  for(const node of nodes)for(const state of node.panel?.states||[])if(state.id!==node.panel.initialStateId)for(const id of state.nodeIds)hidden.add(id);
  let changed=true;while(changed){changed=false;for(const node of nodes)if(hidden.has(node.id))for(const id of node.panel?.states.flatMap(state=>state.nodeIds)||node.repeater?.templateIds||[])if(!hidden.has(id)){hidden.add(id);changed=true;}}
  return nodes.filter(node=>!hidden.has(node.id));
}
export function createPreviewNode(node,nodes=[],doc=document){
  const uid=`preview-${++serial}`,element=doc.createElement('div'),make=(tag,text)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const svg=(tag,attrs={})=>{const el=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const[key,value]of Object.entries(attrs))el.setAttribute(key,String(value));return el;};
  element.dataset.previewNodeId=node.id;Object.assign(element.style,{position:'absolute',left:`${node.x}px`,top:`${node.y}px`,width:`${node.width}px`,height:`${node.height}px`,transform:`rotate(${node.rotation||0}deg)`,pointerEvents:'none',overflow:'visible'});
  const geometry=getVectorGeometry(node,nodes)||(node.type==='line'?{width:node.width,height:node.height,d:`M 0 ${node.style.strokeWidth/2} L ${node.width} ${node.style.strokeWidth/2}`,closed:false,arrow:'none'}:null);
  let content,control;
  if(geometry){
    const drawing=svg('svg',{width:'100%',height:'100%',viewBox:`0 0 ${geometry.width} ${geometry.height}`}),path=svg('path',{d:geometry.d}),markers=[];Object.assign(drawing.style,{display:'block',height:'100%',width:'100%',background:'transparent'});
    if(geometry.arrow!=='none'){
      const defs=svg('defs'),marker=svg('marker',{id:`${uid}-arrow`,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'}),arrow=svg('path',{d:'M 0 0 L 10 5 L 0 10 Z'});marker.append(arrow);defs.append(marker);drawing.append(defs);markers.push(arrow);path.setAttribute('marker-end',`url(#${uid}-arrow)`);if(geometry.arrow==='both')path.setAttribute('marker-start',`url(#${uid}-arrow)`);
    }
    drawing.append(path);element.append(drawing);applyVectorVisual(drawing,path,node,{geometry,uid,markers});
  }else if(node.type==='image'){
    paintImageContent(element,node);
  }else if(['input','textarea','select'].includes(node.type)){
    control=make(node.type==='input'?'input':node.type);control.tabIndex=-1;
    if(node.type==='select')for(const option of node.options||[])control.append(make('option',option));
    if(node.type==='input')control.type=node.inputType||'text';control.value=node.value||(node.type==='select'?node.options?.[0]:'')||'';control.placeholder=node.text||'';element.append(control);
  }else{
    content=make('div');content.style.overflow='hidden';
    if(node.richText){
      let count=0;for(const paragraph of node.richText.paragraphs){const block=make('div');block.style.textAlign=paragraph.align;block.style.minHeight='1em';const prefix=paragraph.list==='number'?`${++count}. `:paragraph.list==='bullet'?(count=0,'• '):(count=0,'');if(prefix)block.append(doc.createTextNode(prefix));for(const run of paragraph.runs){const span=make('span',run.text);Object.assign(span.style,richRunStyle(run));block.append(span);}content.append(block);}
    }else if(node.type==='table'){
      const table=make('table');Object.assign(table.style,{borderCollapse:'collapse',width:'100%',height:'100%',tableLayout:'fixed'});for(const row of node.rows||[]){const tr=make('tr');for(const value of row){const td=make('td',value);Object.assign(td.style,{border:'1px solid #d8dfe6',padding:'8px'});tr.append(td);}table.append(tr);}content.append(table);
    }else if(['checkbox','radio'].includes(node.type)){
      const input=make('input');input.type=node.type;input.checked=!!node.checked;input.tabIndex=-1;content.append(input,make('span',node.text));
    }else content.textContent=node.text||(['dynamicPanel','repeater'].includes(node.type)?node.name:'');
    element.append(content);
  }
  applyNodeVisual(element,node,{contentElement:content,controlElement:control,uid,transitions:false});return element;
}
