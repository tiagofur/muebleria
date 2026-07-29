/**
 * Web export pipeline for Production Pack ZIP (#134).
 * Bundles Optimizer XLSX, Hardware XLSX, Labels PDF, and Material Summary PDF.
 */

import JSZip from 'jszip';
import {
  collectExportIssues,
  generateCutRows,
  generateHardwareList,
  generatePieceLabels,
  DomainError,
  domainErrorToExportIssue,
  type Catalog,
  type ExportIssue,
  type Project,
} from '@muebles/domain';
import {
  optimizerExport,
  hardwareListExport,
  pieceLabelsPdfExport,
  materialSummaryPdfExport,
} from '@muebles/excel';

export type ExportProductionPackResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

/** Safe default file name: pack-produccion-{projectName}.zip */
export function productionPackFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `pack-produccion-${safe}.zip`;
}

function sanitizeBaseName(name: string): string {
  return name.trim().replace(/[^\p{L}\p{N}\-_]+/gu, '_') || 'proyecto';
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/**
 * Build Production Pack ZIP workbook/pdf bytes when the project is valid.
 */
export async function buildProductionPackExport(
  project: Project,
  catalog: Catalog,
  customerName?: string,
): Promise<ExportProductionPackResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  try {
    const baseName = sanitizeBaseName(project.name);

    // 1. Optimizer Cut List XLSX
    const cutRows = generateCutRows(project, catalog);
    const optimizerBuffer = await optimizerExport(cutRows);

    // 2. Hardware List XLSX
    const hwRows = generateHardwareList(project, catalog);
    const hardwareBuffer = await hardwareListExport(hwRows);

    // 3. Piece Labels PDF
    const labels = generatePieceLabels(project, catalog);
    const labelsBuffer = await pieceLabelsPdfExport({
      projectId: project.id,
      projectName: project.name,
      customerName,
      labels,
    });

    // 4. Material Summary & Board Sheet Estimate PDF
    const summaryBuffer = await materialSummaryPdfExport({
      project,
      catalog,
      customerName,
    });

    const zip = new JSZip();
    zip.file(`optimizer_${baseName}.xlsx`, toUint8Array(optimizerBuffer));
    zip.file(`herrajes_${baseName}.xlsx`, toUint8Array(hardwareBuffer));
    zip.file(`etiquetas_${baseName}.pdf`, toUint8Array(labelsBuffer));
    zip.file(`resumen_materiales_${baseName}.pdf`, toUint8Array(summaryBuffer));

    const zipContent = await zip.generateAsync({ type: 'uint8array' });

    return {
      ok: true,
      fileName: productionPackFileName(project.name),
      bytes: zipContent,
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
              : 'Error inesperado al generar el pack de producción',
          field: 'export',
        },
      ],
    };
  }
}
