/**
 * Electron main process — thin host (F032 / #38).
 * Loads the shared web UI (Vite dev server or built dist). No domain formulas here.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CHANNELS = {
  showSaveDialog: 'excel:showSaveDialog',
  writeExcelFile: 'excel:writeExcelFile',
};

function isDev() {
  return (
    process.env.ELECTRON_DEV === '1' ||
    process.env.ELECTRON_DEV === 'true' ||
    !app.isPackaged
  );
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 390,
    minHeight: 640,
    title: 'Muebles',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl =
    process.env.VITE_DEV_SERVER_URL?.trim() || 'http://localhost:5173';

  if (isDev()) {
    void win.loadURL(devUrl);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    const indexHtml = path.join(__dirname, '../../web/dist/index.html');
    void win.loadFile(indexHtml);
  }

  return win;
}

function registerIpc() {
  ipcMain.handle(CHANNELS.showSaveDialog, async (_event, options) => {
    const defaultPath =
      typeof options?.defaultPath === 'string' && options.defaultPath
        ? options.defaultPath
        : 'export.xlsx';
    const result = await dialog.showSaveDialog({
      title: 'Guardar Excel',
      defaultPath,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) {
      return undefined;
    }
    return result.filePath;
  });

  ipcMain.handle(CHANNELS.writeExcelFile, async (_event, filePath, buffer) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('filePath required');
    }
    const data = Buffer.from(buffer);
    await fs.writeFile(filePath, data);
  });
}

app.whenReady().then(() => {
  registerIpc();
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
