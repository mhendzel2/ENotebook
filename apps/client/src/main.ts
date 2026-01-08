import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import * as fs from 'fs/promises';

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'renderer/index.html'));
  }
}

ipcMain.handle('eln:saveFile', async (_event, args: { defaultPath?: string; data: ArrayBuffer }) => {
  const result = await dialog.showSaveDialog({
    title: 'Export database for USB sync',
    defaultPath: args.defaultPath,
    filters: [{ name: 'ELN Sync Bundle', extensions: ['zip'] }],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true } as const;
  }

  const buffer = Buffer.from(args.data);
  await fs.writeFile(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath } as const;
});

ipcMain.handle('eln:openZip', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select USB sync bundle',
    properties: ['openFile'],
    filters: [{ name: 'ELN Sync Bundle', extensions: ['zip'] }],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true } as const;
  }

  const filePath = result.filePaths[0];
  const buffer = await fs.readFile(filePath);
  return { canceled: false, filePath, data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) } as const;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
