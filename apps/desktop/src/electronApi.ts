/**
 * Electron preload API contract (technical_design.md §4).
 * Renderer talks only through this surface — never require('electron') in UI.
 */

export interface ElectronFileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

export interface ElectronSaveDialogOptions {
  readonly defaultPath: string;
  readonly title?: string;
  readonly filters?: readonly ElectronFileFilter[];
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
  /**
   * Raw ZPL print to a thermal printer (Etiquetas tab). Only present when
   * the desktop shell wired it — the web app never shows the print button.
   */
  printRaw?: (
    printerName: string,
    payload: string,
  ) => Promise<ElectronPrintRawResult>;
}

export interface ElectronPrintRawResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** Host object that may carry preload-injected ElectronAPI (renderer window). */
export type ElectronHost = {
  readonly electronAPI?: ElectronAPI;
};

/** Read preload-injected API when running inside Electron renderer. */
export function getElectronAPI(host: ElectronHost = {}): ElectronAPI | undefined {
  return host.electronAPI;
}
