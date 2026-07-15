/**
 * Desktop shell public entry (thin Electron host — wiring only).
 */

export {
  createDesktopShell,
  createDesktopExcelApi,
  createExcelIpcHandlers,
  exportOptimizerDesktop,
  getElectronAPI,
  registerElectronApi,
  EXCEL_IPC_CHANNELS,
} from './main';
export type { DesktopShellInfo } from './main';
export type {
  ElectronAPI,
  ElectronSaveDialogOptions,
} from './electronApi';
export type { ExcelIpcDeps, SaveDialogResult } from './ipcHandlers';
export type {
  DesktopExcelApi,
  DesktopExportStatus,
} from './exportAdapter';
export const PACKAGE_NAME = '@muebles/desktop' as const;
