/**
 * Preload bridge — expose ElectronAPI on window (run in Electron preload context).
 * Requires electron at runtime; unit tests do not load this module.
 */

import type { ElectronAPI } from './electronApi';

type IpcRendererLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

type ContextBridgeLike = {
  exposeInMainWorld: (key: string, api: ElectronAPI) => void;
};

/**
 * Register contextBridge API. Call from Electron preload entry with real modules:
 * `registerElectronApi(contextBridge, ipcRenderer)`.
 */
export function registerElectronApi(
  contextBridge: ContextBridgeLike,
  ipcRenderer: IpcRendererLike,
): void {
  const api: ElectronAPI = {
    showSaveDialog: (options) =>
      ipcRenderer.invoke('excel:showSaveDialog', options) as Promise<
        string | undefined
      >,
    writeExcelFile: (filePath, buffer) =>
      ipcRenderer.invoke('excel:writeExcelFile', filePath, buffer) as Promise<void>,
  };
  contextBridge.exposeInMainWorld('electronAPI', api);
}

export const EXCEL_IPC_CHANNELS = {
  showSaveDialog: 'excel:showSaveDialog',
  writeExcelFile: 'excel:writeExcelFile',
} as const;
