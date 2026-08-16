/**
 * Web export pipeline for Production Pack ZIP (#134).
 * Bundles Optimizer XLSX, Hardware XLSX, Labels PDF, and Material Summary PDF.
 */

import JSZip from 'jszip';
import {
  buildProductionElevations,
  collectExportIssues,
  generateCutRows,
  generateHardwareList,
  generatePieceLabels,
  generateModuleLabels,
  pieceBatchToZpl,
  moduleBatchToZpl,
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
  moduleLabelsPdfExport,
  materialSummaryPdfExport,
  wallElevationsPdfExport,
  productionDespiecePdfExport,
  productionCoverPdfExport,
  assemblySheetsPdfExport,
  cutPreviewPdfExport,
} from '@muebles/excel';

export type ExportProductionPackResult =
  | {
      readonly ok: true;
      readonly fileName: string;
      readonly bytes: Uint8Array;
      /** Optional annexes that failed to generate — surfaced, never silent. */
      readonly omissions: readonly string[];
    }
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

    // 5. Cover PDF (PROD-1.2)
    const moduleUnitCount = project.items.reduce(
      (s, it) => s + (it.quantity > 0 ? it.quantity : 0),
      0,
    );
    const coverBuffer = await productionCoverPdfExport({
      projectName: project.name,
      customerName,
      status: project.status,
      moduleUnitCount,
      cutRowCount: cutRows.length,
      readyToCut: cutRows.length > 0,
      notes: project.production?.revision
        ? `OP rev. ${project.production.revision}${project.notes ? ` — ${project.notes}` : ''}`
        : project.notes,
    });

    // 6. Despiece PDF
    const despieceBuffer = await productionDespiecePdfExport({
      projectName: project.name,
      customerName,
      rows: cutRows,
    });

    // 7. Elevations PDF when layout has walls (best-effort)
    const omissions: string[] = [];
    let elevationsBuffer: Uint8Array | null = null;
    const elevations = buildProductionElevations(
      project,
      catalog.modules ?? [],
    );
    if (elevations.walls.length > 0) {
      try {
        elevationsBuffer = await wallElevationsPdfExport({
          project,
          modules: catalog.modules ?? [],
          customerName,
        });
      } catch {
        elevationsBuffer = null;
        omissions.push('elevaciones');
      }
    }

    const zip = new JSZip();
    zip.file(`caratula_${baseName}.pdf`, toUint8Array(coverBuffer));
    zip.file(`optimizer_${baseName}.xlsx`, toUint8Array(optimizerBuffer));
    zip.file(`herrajes_${baseName}.xlsx`, toUint8Array(hardwareBuffer));
    zip.file(`etiquetas_${baseName}.pdf`, toUint8Array(labelsBuffer));
    zip.file(`resumen_materiales_${baseName}.pdf`, toUint8Array(summaryBuffer));
    zip.file(`despiece_${baseName}.pdf`, toUint8Array(despieceBuffer));
    if (elevationsBuffer) {
      zip.file(
        `elevaciones_${baseName}.pdf`,
        toUint8Array(elevationsBuffer),
      );
    }

    // 8. Visual Cut Layout PDF for manual cutting (PROD-4.2 / F072)
    try {
      const cutPreviewBuffer = await cutPreviewPdfExport({
        projectId: project.id,
        projectName: project.name,
        customerName,
        cutRows,
      });
      zip.file(`preview_corte_visual_${baseName}.pdf`, toUint8Array(cutPreviewBuffer));
    } catch {
      omissions.push('preview de corte');
    }

    // 9. Assembly sheets (PROD-4.1) best-effort
    try {
      const assemblyBuffer = await assemblySheetsPdfExport({
        project,
        catalog,
        customerName,
      });
      zip.file(`armado_${baseName}.pdf`, toUint8Array(assemblyBuffer));
    } catch {
      omissions.push('hojas de armado');
    }

    // 10. Thermal labels ZPL (default preset) for Zebra printers (F071).
    // The Etiquetas tab lets the shop customize preset/DPI for direct
    // downloads; the pack always carries the standard 100x50 @ 203 dpi.
    try {
      const zplContent = pieceBatchToZpl(labels, '100x50', {
        dpi: 203,
        includeBorder: true,
        projectId: project.id,
        revision: project.production?.revision?.toString(),
      });
      zip.file(`etiquetas_zpl_${baseName}.zpl`, zplContent);
    } catch {
      omissions.push('etiquetas ZPL');
    }

    // 11. Module / Package Labels PDF & ZPL (F092)
    try {
      const modLabels = generateModuleLabels(project, catalog, {
        customerName,
        revision: project.production?.revision?.toString(),
      });
      if (modLabels.length > 0) {
        const modLabelsBuffer = await moduleLabelsPdfExport({
          projectId: project.id,
          projectName: project.name,
          customerName,
          labels: modLabels,
          revision: project.production?.revision?.toString(),
        });
        zip.file(`etiquetas_muebles_${baseName}.pdf`, toUint8Array(modLabelsBuffer));

        try {
          const modZpl = moduleBatchToZpl(modLabels, '100x150', {
            dpi: 203,
            includeBorder: true,
            projectId: project.id,
            revision: project.production?.revision?.toString(),
          });
          zip.file(`etiquetas_muebles_zpl_${baseName}.zpl`, modZpl);
        } catch {
          // best effort
        }
      }
    } catch {
      omissions.push('etiquetas de muebles');
    }

    const zipContent = await zip.generateAsync({ type: 'uint8array' });

    return {
      ok: true,
      fileName: productionPackFileName(project.name),
      bytes: zipContent,
      omissions,
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
