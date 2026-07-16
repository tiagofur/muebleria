/**
 * Electron main-process shell — identity + Excel IPC factory (F010 EXP-06).
 * Runtime BrowserWindow host lives in `electron/main.mjs` (F032 / #38).
 */

import { PACKAGE_NAME as domainName } from '@muebles/domain';
import { PACKAGE_NAME as storageName } from '@muebles/storage';
import { createExcelIpcHandlers, type ExcelIpcDeps } from './ipcHandlers';
import type { ElectronAPI } from './electronApi';

export interface DesktopShellInfo {
  readonly name: '@muebles/desktop';
  readonly domain: typeof domainName;
  readonly storage: typeof storageName;
}

/** Factory for the desktop shell identity (no window required for unit tests). */
export function createDesktopShell(): DesktopShellInfo {
  return {
    name: '@muebles/desktop',
    domain: domainName,
    storage: storageName,
  };
}

/**
 * Build Excel export IPC handlers for main process.
 * Example wiring (when electron is installed):
 *
 * ```ts
 * import { dialog } from 'electron';
 * import { promises as fs } from 'node:fs';
 * const api = createDesktopExcelApi({
 *   showSaveDialog: (opts) => dialog.showSaveDialog(opts),
 *   writeFile: (path, data) => fs.writeFile(path, data),
 * });
 * ```
 */
export function createDesktopExcelApi(deps: ExcelIpcDeps): ElectronAPI {
  return createExcelIpcHandlers(deps);
}

export type { ElectronAPI, ExcelIpcDeps };
export { exportOptimizerDesktop } from './exportAdapter';
export { createExcelIpcHandlers } from './ipcHandlers';
export { getElectronAPI } from './electronApi';
export { registerElectronApi, EXCEL_IPC_CHANNELS } from './preload';
