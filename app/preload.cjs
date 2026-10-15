const { contextBridge, ipcRenderer, webUtils } = require('electron');
const api = {};
async function invoke(name, ...args) {
  const result = await ipcRenderer.invoke(`yuanda:${name}`, ...args);
  if (!result.ok) { const error = new Error(result.error.message); error.code = result.error.code; throw error; }
  return result.value;
}
for (const name of ['getState','getSchema','validateCommands','command','undo','redo','newProject','openProject','saveProject','saveProjectAs','exportHtml','preview','exportRp','importImage','markInternalClipboard','readPasteSource','writeClipboardImage','getAgentInfo','setSelection','openFolder','libraryList','libraryCreate','libraryEdit','libraryRemove','libraryLoad','librarySaveSelection','libraryReveal','libraryExport']) {
  api[name] = (...args) => invoke(name, ...args);
}
api.importDroppedImages = async (files, context) => {
  if (!Array.isArray(files) || !files.length || files.length > 8) throw new Error('每次请拖入 1–8 张图片');
  const paths = files.map(file => { const filePath = webUtils.getPathForFile(file); if (!filePath) throw new Error('请从电脑文件夹拖入真实图片文件'); return filePath; });
  return invoke('importDroppedImages', paths, context);
};
api.onState = callback => { const listener = (_, state) => callback(state); ipcRenderer.on('yuanda:state', listener); return () => ipcRenderer.removeListener('yuanda:state', listener); };
contextBridge.exposeInMainWorld('yuanda', api);
