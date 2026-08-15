/**
 * Web pipeline: validate → piece labels → PDF → download (F046 / #96).
 */

import {
  collectExportIssues,
  domainErrorToExportIssue,
  DomainError,
  generatePieceLabels,
  type Catalog,
  type Customer,
  type ExportIssue,
  type PieceLabel,
  type Project,
} from '@muebles/domain';
import { pieceLabelsPdfExport } from '@muebles/excel';
import {
  downloadOptimizerXlsx,
  type DownloadDeps,
} from './exportOptimizer';

export type ExportPieceLabelsResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

/** Scope + copy mode chosen in the Etiquetas tab (falls back to full set). */
export type PieceLabelsExportOptions = {
  /** Pre-filtered labels from the hub (scope by module/material/search). */
  readonly labels?: readonly PieceLabel[];
  /** One physical label per unit instead of one per piece row. */
  readonly perUnit?: boolean;
  /** Production order revision — header + QR traceability. */
  readonly revision?: string;
};

/** Safe default file name: etiquetas-{projectName}.pdf */
export function pieceLabelsFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `etiquetas-${safe}.pdf`;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

export async function buildPieceLabelsExport(
  project: Project,
  catalog: Catalog,
  customers: readonly Customer[] = [],
  options: PieceLabelsExportOptions = {},
): Promise<ExportPieceLabelsResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  try {
    const labels = options.labels ?? generatePieceLabels(project, catalog);
    if (labels.length === 0) {
      return {
        ok: false,
        issues: [
          {
            message: 'no hay piezas de tablero para etiquetar',
            field: 'labels',
          },
        ],
      };
    }
    const customer = customers.find((c) => c.id === project.customerId);
    const buffer = await pieceLabelsPdfExport({
      projectId: project.id,
      projectName: project.name,
      customerName: customer?.name,
      labels,
      perUnit: options.perUnit ?? false,
      revision: options.revision ?? project.production?.revision?.toString(),
    });
    const bytes = toUint8Array(buffer);
    return {
      ok: true,
      fileName: pieceLabelsFileName(project.name),
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
              : 'Error inesperado al generar etiquetas',
          field: 'export',
        },
      ],
    };
  }
}

/** Trigger browser download of piece labels PDF. */
export function downloadPieceLabelsPdf(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  deps?: DownloadDeps,
): void {
  downloadOptimizerXlsx(data, fileName, deps);
}
