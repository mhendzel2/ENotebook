import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('eln', {
  version: appVersion()
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
