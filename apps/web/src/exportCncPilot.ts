/**
 * CNC pilot JSON export (PROD-3.3 / #111).
 * Does not replace Optimizer.xlsx.
 */

import {
  buildCncPilotDocument,
  cncPilotDocumentToJson,
  collectExportIssues,
  DomainError,
  domainErrorToExportIssue,
  generateCutRows,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@granete/domain';
import { deliverExcelFile } from './exportOptimizer';

export type ExportCncPilotResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

export function cncPilotFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `cnc-pilot-${safe}.json`;
}

export async function buildCncPilotExport(
  project: Project,
  catalog: Catalog,
): Promise<ExportCncPilotResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  try {
    const cutRows = generateCutRows(project, catalog);
    const doc = buildCncPilotDocument({
      projectId: project.id,
      projectName: project.name,
      cutRows,
      generatedAt: new Date().toISOString(),
      productionRevision: project.production?.revision ?? null,
    });
    const json = cncPilotDocumentToJson(doc);
    return {
      ok: true,
      fileName: cncPilotFileName(project.name),
      bytes: new TextEncoder().encode(json),
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
              : 'Error al generar CNC pilot JSON',
          field: 'export',
        },
      ],
    };
  }
}

export async function downloadCncPilot(
  project: Project,
  catalog: Catalog,
): Promise<ExportCncPilotResult & { delivery?: string }> {
  const result = await buildCncPilotExport(project, catalog);
  if (!result.ok) return result;
  const delivery = await deliverExcelFile(result.bytes, result.fileName);
  return { ...result, delivery };
}
