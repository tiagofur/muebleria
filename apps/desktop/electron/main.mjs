/**
 * Electron main process — thin host (F032 / #38).
 * Loads the shared web UI (Vite dev server or built dist). No domain formulas here.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile as execFileCb } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import util from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const execFile = util.promisify(execFileCb);

const CHANNELS = {
  showSaveDialog: 'excel:showSaveDialog',
  writeExcelFile: 'excel:writeExcelFile',
  printRaw: 'zpl:printRaw',
  getAppVersion: 'app:getVersion',
  checkForUpdates: 'app:checkForUpdates',
};

function isDev() {
  return (
    process.env.ELECTRON_DEV === '1' ||
    process.env.ELECTRON_DEV === 'true' ||
    !app.isPackaged
  );
}

function resolveStaticIndexHtml() {
  const candidates = [
    path.join(app.getAppPath(), 'web/dist/index.html'),
    path.join(__dirname, '../web/dist/index.html'),
    path.join(__dirname, '../../web/dist/index.html'),
    path.join(process.resourcesPath || '', 'app/web/dist/index.html'),
  ];
  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return candidates[0];
}

function setupAutoUpdater() {
  if (isDev()) {
    return;
  }
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info?.version);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('Update downloaded:', info?.version);
    });

    autoUpdater.on('error', (err) => {
      console.warn('AutoUpdater warning:', err?.message || err);
    });

    void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('AutoUpdater check error:', err?.message || err);
    });
  } catch (err) {
    console.warn('AutoUpdater setup bypassed:', err?.message || err);
  }
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
    const indexHtml = resolveStaticIndexHtml();
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

  // Raw ZPL print (Etiquetas tab) — mirrors printHandlers.createPrintRawHandler
  // with real node deps. Platform: CUPS lp (darwin/linux) / copy /b (win32).
  ipcMain.handle(CHANNELS.printRaw, async (_event, printerName, payload) => {
    const printer = String(printerName ?? '').trim();
    const zpl = String(payload ?? '');
    if (!printer) return { ok: false, error: 'Falta el nombre de la impresora' };
    if (!zpl.trim()) return { ok: false, error: 'No hay etiquetas para imprimir' };
    try {
      if (process.platform === 'win32') {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'muebles-zpl-'));
        const file = path.join(dir, 'labels.zpl');
        await fs.writeFile(file, zpl, 'utf8');
        try {
          await execFile('cmd', ['/c', 'copy', '/b', file, printer]);
        } finally {
          await fs.unlink(file).catch(() => undefined);
        }
        return { ok: true };
      }
      const { stderr } = await execFile('lp', ['-d', printer, '-o', 'raw', '-'], {
        input: zpl,
      });
      if (stderr && /error|unable/i.test(stderr)) {
        return { ok: false, error: stderr.trim() };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  setupAutoUpdater();

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
