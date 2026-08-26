/**
 * Assembly sheets PDF export (PROD-4.1 / #239).
 */

import {
  DomainError,
  domainErrorToExportIssue,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@granete/domain';
import { assemblySheetsPdfExport } from '@granete/excel';
import { deliverExcelFile } from './exportOptimizer';

export type ExportAssemblySheetsResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

export function assemblySheetsFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `armado-${safe}.pdf`;
}

export async function buildAssemblySheetsExport(
  project: Project,
  catalog: Catalog,
  customerName?: string,
): Promise<ExportAssemblySheetsResult> {
  try {
    const bytes = await assemblySheetsPdfExport({
      project,
      catalog,
      customerName,
    });
    return {
      ok: true,
      fileName: assemblySheetsFileName(project.name),
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
              : 'Error al generar hojas de armado',
          field: 'export',
        },
      ],
    };
  }
}

export async function downloadAssemblySheets(
  project: Project,
  catalog: Catalog,
  customerName?: string,
): Promise<ExportAssemblySheetsResult & { delivery?: string }> {
  const result = await buildAssemblySheetsExport(
    project,
    catalog,
    customerName,
  );
  if (!result.ok) return result;
  const delivery = await deliverExcelFile(result.bytes, result.fileName);
  return { ...result, delivery };
}
