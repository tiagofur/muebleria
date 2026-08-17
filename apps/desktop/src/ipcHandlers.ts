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
    title?: string;
    filters: readonly { name: string; extensions: readonly string[] }[];
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
      const filters =
        options.filters && options.filters.length > 0
          ? options.filters
          : [{ name: 'Excel', extensions: ['xlsx'] }];
      const result = await deps.showSaveDialog({
        defaultPath: options.defaultPath,
        title: options.title,
        filters,
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
      if (!filePath || typeof filePath !== 'string' || filePath.includes('\0')) {
        throw new Error('filePath required');
      }
      await deps.writeFile(filePath, new Uint8Array(buffer));
    },
  };
}
