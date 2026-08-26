/**
 * Web pipeline: cut-list CSV for production (PROD-2.2 / #224).
 */

import {
  collectExportIssues,
  DomainError,
  domainErrorToExportIssue,
  generateCutRows,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@granete/domain';
import { cutListExportCsv } from '@granete/excel';
import { deliverExcelFile } from './exportOptimizer';

export type ExportCutListCsvResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

export function cutListCsvFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `cutlist-${safe}.csv`;
}

export async function buildCutListCsvExport(
  project: Project,
  catalog: Catalog,
): Promise<ExportCutListCsvResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  try {
    const rows = generateCutRows(project, catalog);
    const csv = cutListExportCsv(rows);
    const bytes = new TextEncoder().encode(csv);
    return {
      ok: true,
      fileName: cutListCsvFileName(project.name),
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
              : 'Error al generar cut-list CSV',
          field: 'export',
        },
      ],
    };
  }
}

export async function downloadCutListCsv(
  project: Project,
  catalog: Catalog,
): Promise<ExportCutListCsvResult & { delivery?: string }> {
  const result = await buildCutListCsvExport(project, catalog);
  if (!result.ok) return result;
  const delivery = await deliverExcelFile(result.bytes, result.fileName);
  return { ...result, delivery };
}
