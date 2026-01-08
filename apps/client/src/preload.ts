import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('eln', {
  version: appVersion(),
  saveZip: (defaultPath: string, data: ArrayBuffer) => ipcRenderer.invoke('eln:saveFile', { defaultPath, data }),
  openZip: () => ipcRenderer.invoke('eln:openZip'),
});

function appVersion() {
  try {
    // Defer requiring app to runtime to avoid ESM import issues in preload.
    const { app } = require('electron');
    return app.getVersion();
  } catch {
    return 'dev';
  }
}
