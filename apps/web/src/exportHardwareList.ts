/**
 * Web hardware purchase-list pipeline: validate → aggregate → xlsx → download (EXP-08).
 */

import {
  collectExportIssues,
  domainErrorToExportIssue,
  DomainError,
  generateHardwareList,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@muebles/domain';
import { hardwareListExport } from '@muebles/excel';
import {
  downloadOptimizerXlsx,
  type DownloadDeps,
} from './exportOptimizer';

export type ExportHardwareListResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

/** Safe default file name: herrajes-{projectName}.xlsx */
export function hardwareListFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `herrajes-${safe}.xlsx`;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

/**
 * Build hardware purchase-list workbook when the project is valid for export.
 */
export async function buildHardwareListExport(
  project: Project,
  catalog: Catalog,
): Promise<ExportHardwareListResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  try {
    const rows = generateHardwareList(project, catalog);
    const buffer = await hardwareListExport(rows);
    const bytes = toUint8Array(buffer);
    return {
      ok: true,
      fileName: hardwareListFileName(project.name),
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
              : 'Error inesperado al generar lista de herrajes',
          field: 'export',
        },
      ],
    };
  }
}

/** Trigger browser download of the hardware purchase list (.xlsx). */
export function downloadHardwareListXlsx(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  deps?: DownloadDeps,
): void {
  downloadOptimizerXlsx(data, fileName, deps);
}
