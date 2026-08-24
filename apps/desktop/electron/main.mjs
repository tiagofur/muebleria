/**
 * Electron main process — thin host (F032 / #38).
 * Loads the shared web UI (Vite dev server or built dist). No domain formulas here.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
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

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadSavedWindowState() {
  try {
    const data = fsSync.readFileSync(getWindowStatePath(), 'utf8');
    const state = JSON.parse(data);
    if (
      typeof state.width === 'number' &&
      typeof state.height === 'number' &&
      state.width >= 390 &&
      state.height >= 640
    ) {
      return state;
    }
  } catch {}
  return { width: 1280, height: 800, isMaximized: false };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    };
    fsSync.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf8');
  } catch {}
}

function createAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name || 'Granete',
            submenu: [
              { role: 'about', label: 'Acerca de Granete' },
              { type: 'separator' },
              { role: 'services', label: 'Servicios' },
              { type: 'separator' },
              { role: 'hide', label: 'Ocultar Granete' },
              { role: 'hideOthers', label: 'Ocultar otros' },
              { role: 'unhide', label: 'Mostrar todo' },
              { type: 'separator' },
              { role: 'quit', label: 'Salir de Granete' },
            ],
          },
        ]
      : []),
    {
      label: 'Archivo',
      submenu: [
        isMac
          ? { role: 'close', label: 'Cerrar ventana' }
          : { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'forceReload', label: 'Forzar recarga' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom real (100%)' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Maximizar / Restaurar' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front', label: 'Traer todo al frente' },
            ]
          : []),
      ],
    },
    {
      role: 'help',
      label: 'Ayuda',
      submenu: [
        {
          label: 'Repositorio del Proyecto',
          click: async () => {
            await shell.openExternal('https://github.com/tiagofur/muebleria');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const savedState = loadSavedWindowState();
  const win = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: 390,
    minHeight: 640,
    title: 'Granete',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });

  if (savedState.isMaximized) {
    win.maximize();
  }

  win.on('close', () => {
    saveWindowState(win);
  });

  const devUrl =
    process.env.VITE_DEV_SERVER_URL?.trim() || 'http://localhost:5173';

  // Secure navigation & window opening:
  // 1. Intercept all window.open() or <a target="_blank"> and open in default OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('https:') ||
      url.startsWith('http:') ||
      url.startsWith('mailto:')
    ) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 2. Intercept in-window navigation attempts.
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      const isAllowedDev = isDev() && parsed.origin === new URL(devUrl).origin;
      const isAllowedFile = parsed.protocol === 'file:';
      if (!isAllowedDev && !isAllowedFile) {
        event.preventDefault();
        if (
          navigationUrl.startsWith('https:') ||
          navigationUrl.startsWith('http:') ||
          navigationUrl.startsWith('mailto:')
        ) {
          void shell.openExternal(navigationUrl);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  if (isDev()) {
    void win.loadURL(devUrl);
    if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    const indexHtml = resolveStaticIndexHtml();
    void win.loadFile(indexHtml);
  }

  createAppMenu();
  return win;
}

function registerIpc() {
  ipcMain.handle(CHANNELS.showSaveDialog, async (_event, options) => {
    const defaultPath =
      typeof options?.defaultPath === 'string' && options.defaultPath
        ? options.defaultPath
        : 'export.xlsx';
    const ext = path.extname(defaultPath).replace('.', '').toLowerCase();
    const defaultFilters = ext
      ? [
          { name: ext.toUpperCase(), extensions: [ext] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ]
      : [{ name: 'Excel', extensions: ['xlsx'] }];
    const filters =
      Array.isArray(options?.filters) && options.filters.length > 0
        ? options.filters
        : defaultFilters;
    const title =
      typeof options?.title === 'string' && options.title
        ? options.title
        : 'Guardar archivo';

    const result = await dialog.showSaveDialog({
      title,
      defaultPath,
      filters,
    });
    if (result.canceled || !result.filePath) {
      return undefined;
    }
    return result.filePath;
  });

  ipcMain.handle(CHANNELS.writeExcelFile, async (_event, filePath, buffer) => {
    if (
      typeof filePath !== 'string' ||
      !filePath.trim() ||
      filePath.includes('\0')
    ) {
      throw new Error('filePath required');
    }
    if (
      !buffer ||
      !(buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer))
    ) {
      throw new Error('buffer must be a valid ArrayBuffer or typed array');
    }
    const data = Buffer.from(buffer);
    if (data.length > 100 * 1024 * 1024) {
      throw new Error('buffer exceeds maximum allowed size (100MB)');
    }
    await fs.writeFile(filePath, data);
  });

  // Raw ZPL print (Etiquetas tab) — mirrors printHandlers.createPrintRawHandler
  // with real node deps. Platform: CUPS lp (darwin/linux) / copy /b (win32).
  ipcMain.handle(CHANNELS.printRaw, async (_event, printerName, payload) => {
    const printer = String(printerName ?? '').trim();
    const zpl = String(payload ?? '');
    if (!printer) return { ok: false, error: 'Falta el nombre de la impresora' };
    if (/[&|;<>^%"\r\n\0]/.test(printer) || printer.startsWith('-')) {
      return { ok: false, error: 'Nombre de impresora no válido' };
    }
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
          await fs.rmdir(dir).catch(() => undefined);
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
