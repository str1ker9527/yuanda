/** Renderer-only regressions never touch the user's clipboard. Production IPC is tested separately. */
export function clipboardMarkerMock(getState) {
  let marker=null,sequence=0;
  return {
    markInternalClipboard({projectId}) { if(getState().project.id!==projectId)throw new Error('项目已切换');marker={projectId,token:`isolated-marker-${++sequence}`};return{token:marker.token}; },
    readPasteSource({projectId,expectedRevision,internalToken}) { const state=getState();if(state.project.id!==projectId||state.revision!==expectedRevision)throw new Error('项目版本已变化');return marker?.projectId===projectId&&marker.token===internalToken?{kind:'internal',token:marker.token}:{kind:'empty'}; }
  };
}
