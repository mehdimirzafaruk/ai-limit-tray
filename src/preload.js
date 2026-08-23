const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('limits', {
  state: () => ipcRenderer.invoke('get-state'),
  add: (provider, name) => ipcRenderer.invoke('add-profile', { provider, name }),
  login: (provider, id) => ipcRenderer.invoke('login', { provider, id }),
  remove: (provider, id) => ipcRenderer.invoke('remove-profile', { provider, id }),
  refresh: () => ipcRenderer.invoke('refresh'),
  setRefresh: minutes => ipcRenderer.invoke('set-refresh', minutes),
  toggleSticky: () => ipcRenderer.invoke('toggle-sticky'),
  onSnapshot: fn => ipcRenderer.on('snapshot', (_e, data) => fn(data)),
  onContext: fn => ipcRenderer.on('context-snapshot', (_e, data) => fn(data))
});
