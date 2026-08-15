/**
 * Electron preload — exposes window.electronAPI (EXP-06).
 * CommonJS so Electron can load it reliably with sandbox + contextIsolation.
 */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  showSaveDialog: 'excel:showSaveDialog',
  writeExcelFile: 'excel:writeExcelFile',
  printRaw: 'zpl:printRaw',
};

contextBridge.exposeInMainWorld('electronAPI', {
  showSaveDialog: (options) =>
    ipcRenderer.invoke(CHANNELS.showSaveDialog, options),
  writeExcelFile: (filePath, buffer) =>
    ipcRenderer.invoke(CHANNELS.writeExcelFile, filePath, buffer),
  printRaw: (printerName, payload) =>
    ipcRenderer.invoke(CHANNELS.printRaw, printerName, payload),
});

