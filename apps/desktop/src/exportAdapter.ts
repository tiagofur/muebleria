/**
 * Desktop Optimizer export delivery via Electron save dialog (EXP-06).
 */

import type { ElectronAPI } from './electronApi';

export type DesktopExportStatus = 'saved' | 'cancelled';

export type DesktopExcelApi = Pick<
  ElectronAPI,
  'showSaveDialog' | 'writeExcelFile'
>;

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

/**
 * Show native save dialog and write xlsx bytes. Returns cancelled if user aborts.
 */
export async function exportOptimizerDesktop(
  data: ArrayBuffer | Uint8Array,
  defaultPath: string,
  api: DesktopExcelApi,
): Promise<DesktopExportStatus> {
  const filePath = await api.showSaveDialog({ defaultPath });
  if (!filePath) {
    return 'cancelled';
  }
  await api.writeExcelFile(filePath, toArrayBuffer(data));
  return 'saved';
}
