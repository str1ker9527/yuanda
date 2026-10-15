/* Shared movement planner. A container and its descendants must move exactly once. */
(() => {
  const round=value=>Math.round(value*100)/100;
  function commands(page,moves){
    if(!page)return [];
    const byId=new Map(page.nodes.map(node=>[node.id,node])),requested=new Map(moves.map(move=>[move.node.id,move]));
    const descendants=id=>{const found=new Set(),visit=key=>{const node=byId.get(key);for(const child of [...(node?.panel?.states.flatMap(state=>state.nodeIds)||[]),...(node?.repeater?.templateIds||[])])if(!found.has(child)){found.add(child);visit(child);}};visit(id);return [...found];};
    const candidates=[];
    for(const group of page.groups||[]){
      const members=group.nodeIds.map(id=>requested.get(id));
      if(!members.length||members.some(item=>!item)||!members.every(item=>round(item.dx)===round(members[0].dx)&&round(item.dy)===round(members[0].dy)))continue;
      candidates.push({priority:1,coverage:new Set(group.nodeIds.flatMap(id=>[id,...descendants(id)])),locked:group.locked||members.some(item=>item.node.locked),command:{type:'moveGroup',pageId:page.id,groupId:group.id,dx:round(members[0].dx),dy:round(members[0].dy)}});
    }
    for(const {node,dx,dy} of moves)if(node.panel||node.repeater)candidates.push({priority:0,coverage:new Set([node.id,...descendants(node.id)]),locked:node.locked,command:{type:'moveContainer',pageId:page.id,nodeId:node.id,dx:round(dx),dy:round(dy)}});
    candidates.sort((a,b)=>b.coverage.size-a.coverage.size||b.priority-a.priority);
    const handled=new Set(),result=[];
    for(const item of candidates){
      if([...item.coverage].some(id=>handled.has(id)))continue;
      for(const id of item.coverage)handled.add(id);
      if(!item.locked)result.push(item.command);
    }
    for(const {node,dx,dy}of moves)if(!handled.has(node.id)&&!node.locked)result.push({type:'updateNode',pageId:page.id,nodeId:node.id,patch:{x:round(node.x+dx),y:round(node.y+dy)}});
    return result;
  }
  globalThis.YuandaMovement=Object.freeze({commands});
})();
