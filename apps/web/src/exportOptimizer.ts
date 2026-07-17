/**
 * Web export pipeline: validate → cut rows → xlsx → browser download (EXP-07).
 */

import {
  collectExportIssues,
  domainErrorToExportIssue,
  DomainError,
  generateCutRows,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@muebles/domain';
import { optimizerExport } from '@muebles/excel';

export type ExportOptimizerResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

/** Safe default file name: optimizer-{projectName}.xlsx */
export function optimizerFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `optimizer-${safe}.xlsx`;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

/**
 * Build Optimizer workbook bytes when the project is valid for export.
 */
export async function buildOptimizerExport(
  project: Project,
  catalog: Catalog,
): Promise<ExportOptimizerResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  try {
    const rows = generateCutRows(project, catalog);
    const buffer = await optimizerExport(rows);
    const bytes = toUint8Array(buffer);
    return {
      ok: true,
      fileName: optimizerFileName(project.name),
      bytes,
    };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, issues: [domainErrorToExportIssue(error)] };
    }
    return {
      ok: false,
      issues: [
        {
          message:
            error instanceof Error
              ? error.message
              : 'Error inesperado al generar el export',
          field: 'export',
        },
      ],
    };
  }
}

export interface DownloadDeps {
  readonly createObjectURL: (obj: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly createElement: (tag: 'a') => HTMLAnchorElement;
  readonly appendChild: (node: HTMLAnchorElement) => void;
  readonly removeChild: (node: HTMLAnchorElement) => void;
}

function defaultDownloadDeps(): DownloadDeps {
  return {
    createObjectURL: (obj) => URL.createObjectURL(obj),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createElement: (tag) => document.createElement(tag),
    appendChild: (node) => {
      document.body.appendChild(node);
    },
    removeChild: (node) => {
      node.remove();
    },
  };
}

/**
 * Optional Electron preload surface (EXP-06). Present only in the desktop host.
 * Kept local to the web shell so `@muebles/ui` never imports Electron.
 */
export type ElectronSaveApi = {
  readonly showSaveDialog: (options: {
    defaultPath: string;
  }) => Promise<string | undefined>;
  readonly writeExcelFile: (
    filePath: string,
    buffer: ArrayBuffer,
  ) => Promise<void>;
};

function readElectronApi(
  host: { electronAPI?: ElectronSaveApi } | undefined = typeof globalThis !==
  'undefined'
    ? (globalThis as { electronAPI?: ElectronSaveApi })
    : undefined,
): ElectronSaveApi | undefined {
  return host?.electronAPI;
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

export type DeliverExcelResult = 'saved' | 'cancelled' | 'downloaded';

/**
 * Desktop: native save dialog + write (EXP-06).
 * Browser: anchor download (EXP-07).
 */
export async function deliverExcelFile(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  deps: DownloadDeps = defaultDownloadDeps(),
  electronApi: ElectronSaveApi | undefined = readElectronApi(),
): Promise<DeliverExcelResult> {
  if (electronApi?.showSaveDialog && electronApi?.writeExcelFile) {
    const filePath = await electronApi.showSaveDialog({
      defaultPath: fileName,
    });
    if (!filePath) return 'cancelled';
    await electronApi.writeExcelFile(filePath, toArrayBuffer(toUint8Array(data)));
    return 'saved';
  }
  downloadOptimizerXlsx(data, fileName, deps);
  return 'downloaded';
}

/**
 * Trigger browser download of an .xlsx buffer (EXP-07).
 * Injectable deps for unit tests without jsdom file dance.
 */
export function downloadOptimizerXlsx(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  deps: DownloadDeps = defaultDownloadDeps(),
): void {
  const bytes = toUint8Array(data);
  // Copy into a fresh ArrayBuffer so BlobPart typing accepts it under strict DOM libs.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const lower = fileName.toLowerCase();
  const mime = lower.endsWith('.pdf')
    ? 'application/pdf'
    : lower.endsWith('.zip')
      ? 'application/zip'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = new Blob([copy.buffer], {
    type: mime,
  });
  const url = deps.createObjectURL(blob);
  const anchor = deps.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  deps.appendChild(anchor);
  anchor.click();
  deps.removeChild(anchor);
  deps.revokeObjectURL(url);
}
