/**
 * Web pipeline: wall elevations PDF for production (PROD-1.1).
 */

import {
  DomainError,
  domainErrorToExportIssue,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@granete/domain';
import { wallElevationsPdfExport } from '@granete/excel';
import { deliverExcelFile } from './exportOptimizer';

export type ExportWallElevationsResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

export function wallElevationsFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `elevaciones-${safe}.pdf`;
}

export async function buildWallElevationsExport(
  project: Project,
  catalog: Catalog,
  customerName?: string,
): Promise<ExportWallElevationsResult> {
  try {
    const bytes = await wallElevationsPdfExport({
      project,
      modules: catalog.modules ?? [],
      customerName,
    });
    return {
      ok: true,
      fileName: wallElevationsFileName(project.name),
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
              : 'Error al generar elevaciones',
          field: 'elevations',
        },
      ],
    };
  }
}

export async function downloadWallElevations(
  project: Project,
  catalog: Catalog,
  customerName?: string,
): Promise<ExportWallElevationsResult & { delivery?: string }> {
  const result = await buildWallElevationsExport(
    project,
    catalog,
    customerName,
  );
  if (!result.ok) return result;
  const delivery = await deliverExcelFile(result.bytes, result.fileName);
  return { ...result, delivery };
}
