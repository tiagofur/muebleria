/**
 * Web pipeline: despiece (cut-list) PDF for A4 office print.
 */

import {
  collectExportIssues,
  DomainError,
  domainErrorToExportIssue,
  generateCutRows,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@muebles/domain';
import { productionDespiecePdfExport } from '@muebles/excel';
import { deliverExcelFile } from './exportOptimizer';

export type ExportDespiecePdfResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

function despiecePdfFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `despiece-${safe}.pdf`;
}

export async function buildDespiecePdfExport(
  project: Project,
  catalog: Catalog,
  customerName?: string,
): Promise<ExportDespiecePdfResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  try {
    const rows = generateCutRows(project, catalog);
    const bytes = await productionDespiecePdfExport({
      projectName: project.name,
      customerName,
      rows,
    });
    return {
      ok: true,
      fileName: despiecePdfFileName(project.name),
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
              : 'Error al generar despiece PDF',
          field: 'export',
        },
      ],
    };
  }
}

export async function downloadDespiecePdf(
  project: Project,
  catalog: Catalog,
  customerName?: string,
): Promise<ExportDespiecePdfResult & { delivery?: string }> {
  const result = await buildDespiecePdfExport(project, catalog, customerName);
  if (!result.ok) return result;
  const delivery = await deliverExcelFile(result.bytes, result.fileName);
  return { ...result, delivery };
}
