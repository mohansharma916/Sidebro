const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  send: (channel, data) => {
    const validChannels = ['toMain', 'audio-stream', 'session-control'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = [
      'fromMain',
      'system-audio-available',
      'floating-mode-changed',
      'stealth-status-changed',
      'clipboard-copied',
      'screenshot-captured',
      'screenshot-error',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  invoke: (channel, ...args) => {
    const validChannels = [
      'toggle-floating-mode',
      'set-content-protection',
      'get-stealth-status',
      'set-window-opacity',
      'set-overlay-collapsed',
      'capture-screenshot',
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Invalid IPC channel: ${channel}`));
  },
  toggleFloatingMode: (enable) => ipcRenderer.invoke('toggle-floating-mode', enable),
  setContentProtection: (enable) => ipcRenderer.invoke('set-content-protection', enable),
  getStealthStatus: () => ipcRenderer.invoke('get-stealth-status'),
  setWindowOpacity: (opacity) => ipcRenderer.invoke('set-window-opacity', opacity),
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  setOverlayCollapsed: (collapsed) => ipcRenderer.invoke('set-overlay-collapsed', collapsed),
});
