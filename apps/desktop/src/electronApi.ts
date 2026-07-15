/**
 * Electron preload API contract (technical_design.md §4).
 * Renderer talks only through this surface — never require('electron') in UI.
 */

export interface ElectronSaveDialogOptions {
  readonly defaultPath: string;
}

/**
 * Minimal IPC surface for F010 export (EXP-06).
 * Workspace load/save can extend this later without breaking export.
 */
export interface ElectronAPI {
  showSaveDialog: (
    options: ElectronSaveDialogOptions,
  ) => Promise<string | undefined>;
  writeExcelFile: (filePath: string, buffer: ArrayBuffer) => Promise<void>;
}

/** Host object that may carry preload-injected ElectronAPI (renderer window). */
export type ElectronHost = {
  readonly electronAPI?: ElectronAPI;
};

/** Read preload-injected API when running inside Electron renderer. */
export function getElectronAPI(host: ElectronHost = {}): ElectronAPI | undefined {
  return host.electronAPI;
}
