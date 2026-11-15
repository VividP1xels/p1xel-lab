const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = ch => cb => {
  const h = (_e, d) => cb(d);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('lab', {
  login: () => invoke('auth:login'),
  restore: () => invoke('auth:restore'),
  logout: () => invoke('auth:logout'),
  getSettings: () => invoke('store:get'),
  setSettings: p => invoke('store:set', p),
  openExternal: url => invoke('open:external', url),
  openFolder: id => invoke('open:folder', id),
  versions: snaps => invoke('versions:list', snaps),
  loaders: v => invoke('loaders:supported', v),
  listInstances: () => invoke('instances:list'),
  createInstance: d => invoke('instances:create', d),
  getInstance: id => invoke('instances:get', id),
  deleteInstance: id => invoke('instances:delete', id),
  searchMods: q => invoke('mods:search', q),
  installMod: d => invoke('mods:install', d),
  removeMod: d => invoke('mods:remove', d),
  isOnline: () => invoke('net:online'),
  prefetchMods: q => invoke('mods:prefetch', q),
  social: {
    me: () => invoke('social:me'),
    prove: id => invoke('social:prove', id),
    verify: d => invoke('social:verify', d),
    lookup: n => invoke('social:lookup', n),
    load: () => invoke('social:load'),
    save: d => invoke('social:save', d),
  },
  launch: id => invoke('game:launch', id),
  stop: id => invoke('game:stop', id),
  onModProgress: on('mods:progress'),
  onLaunchStatus: on('launch:status'),
  onLaunchLog: on('launch:log'),
  onLaunchClosed: on('launch:closed'),
});
