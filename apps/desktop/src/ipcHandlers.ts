/**
 * Main-process handlers for Excel save dialog + write (injectable for tests).
 */

import type { ElectronAPI, ElectronSaveDialogOptions } from './electronApi';

export interface SaveDialogResult {
  readonly canceled: boolean;
  readonly filePath?: string;
}

export interface ExcelIpcDeps {
  readonly showSaveDialog: (options: {
    defaultPath: string;
    filters: readonly { name: string; extensions: string[] }[];
  }) => Promise<SaveDialogResult>;
  readonly writeFile: (filePath: string, data: Uint8Array) => Promise<void>;
}

/**
 * Build ElectronAPI-compatible handlers from dialog + fs deps.
 * Wire real Electron via: dialog.showSaveDialog + fs.promises.writeFile.
 */
export function createExcelIpcHandlers(deps: ExcelIpcDeps): ElectronAPI {
  return {
    async showSaveDialog(
      options: ElectronSaveDialogOptions,
    ): Promise<string | undefined> {
      const result = await deps.showSaveDialog({
        defaultPath: options.defaultPath,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) {
        return undefined;
      }
      return result.filePath;
    },

    async writeExcelFile(
      filePath: string,
      buffer: ArrayBuffer,
    ): Promise<void> {
      await deps.writeFile(filePath, new Uint8Array(buffer));
    },
  };
}
