import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ClipApi } from './types';

// Масштаб интерфейса панели следует за её размером (main, applyPanelBounds). webFrame меняет масштаб только этого окна.
ipcRenderer.on('panel:zoom', (_e, zoom: number) => webFrame.setZoomFactor(zoom));

function subscribe<T>(channel: string, cb: (data: T) => void) {
  const handler = (_e: Electron.IpcRendererEvent, data: T) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: ClipApi = {
  // история
  getHistory: () => ipcRenderer.invoke('history:get'),
  paste: (id) => ipcRenderer.invoke('item:use', id, true), // скопировать + вставить (история или сниппет)
  copy: (id) => ipcRenderer.invoke('item:use', id, false),
  remove: (id) => ipcRenderer.invoke('item:remove', id),
  move: (id, beforeId) => ipcRenderer.invoke('item:move', id, beforeId),
  clear: () => ipcRenderer.invoke('history:clear'),
  startDrag: (id) => ipcRenderer.send('item:drag', id),
  onUpdate: (cb) => subscribe('history:update', cb),

  // настройки
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettings: (cb) => subscribe('settings:update', cb),
  showSettings: () => ipcRenderer.invoke('settings:show'), // отдельное окно настроек

  // автозапуск при входе в систему
  getLoginItem: () => ipcRenderer.invoke('login:get'),
  setLoginItem: (on) => ipcRenderer.invoke('login:set', on),
  onLoginItem: (cb) => subscribe('login:update', cb),

  // коллекции сниппетов (режим разработчика)
  getCollections: () => ipcRenderer.invoke('collections:get'),
  addCollection: (name, color) => ipcRenderer.invoke('collection:add', name, color),
  removeCollection: (id) => ipcRenderer.invoke('collection:remove', id),
  addSnippet: (collectionId, snippet) => ipcRenderer.invoke('snippet:add', collectionId, snippet),
  updateSnippet: (id, patch) => ipcRenderer.invoke('snippet:update', id, patch),
  removeSnippet: (id) => ipcRenderer.invoke('snippet:remove', id),
  moveSnippet: (id, beforeId) => ipcRenderer.invoke('snippet:move', id, beforeId),
  onCollections: (cb) => subscribe('collections:update', cb),

  // горячая клавиша
  setHotkey: (accel) => ipcRenderer.invoke('hotkey:set', accel), // -> { ok, error? }
  setRecording: (on) => ipcRenderer.invoke('hotkey:recording', on),
  formatHotkey: (accel) => ipcRenderer.invoke('hotkey:format', accel),

  // онбординг
  finishOnboarding: () => ipcRenderer.invoke('onboarding:done'),
  showOnboarding: () => ipcRenderer.invoke('onboarding:show'),

  // панель
  confirm: (message) => ipcRenderer.invoke('dialog:confirm', message),
  hide: () => ipcRenderer.invoke('panel:hide'),
  onShown: (cb) => subscribe('panel:shown', cb),
  resizePanel: (grab) => ipcRenderer.send('panel:resize', grab),
  resetPanelSize: () => ipcRenderer.send('panel:resize-reset'),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('clip', api);
