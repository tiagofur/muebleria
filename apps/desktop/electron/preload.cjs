/**
 * Electron preload — exposes window.electronAPI (EXP-06).
 * CommonJS so Electron can load it reliably with sandbox + contextIsolation.
 */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  showSaveDialog: 'excel:showSaveDialog',
  writeExcelFile: 'excel:writeExcelFile',
};

contextBridge.exposeInMainWorld('electronAPI', {
  showSaveDialog: (options) =>
    ipcRenderer.invoke(CHANNELS.showSaveDialog, options),
  writeExcelFile: (filePath, buffer) =>
    ipcRenderer.invoke(CHANNELS.writeExcelFile, filePath, buffer),
});
