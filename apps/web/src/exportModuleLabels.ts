/**
 * Web pipeline: validate → module/package labels → PDF → download (F092).
 */

import {
  collectExportIssues,
  domainErrorToExportIssue,
  DomainError,
  generateModuleLabels,
  type Catalog,
  type Customer,
  type ExportIssue,
  type ModuleLabel,
  type Project,
} from '@muebles/domain';
import { moduleLabelsPdfExport } from '@muebles/excel';
import {
  downloadOptimizerXlsx,
  type DownloadDeps,
} from './exportOptimizer';

export type ExportModuleLabelsResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

export type ModuleLabelsExportOptions = {
  /** Pre-filtered module labels (scope by itemIds or search). */
  readonly labels?: readonly ModuleLabel[];
  /** Production order revision — header + QR traceability. */
  readonly revision?: string;
  readonly qrFormat?: 'json' | 'url';
  readonly qrHost?: string;
};

/** Safe default file name: etiquetas-muebles-{projectName}.pdf */
export function moduleLabelsFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'proyecto';
  return `etiquetas-muebles-${safe}.pdf`;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

export async function buildModuleLabelsExport(
  project: Project,
  catalog: Catalog,
  customers: readonly Customer[] = [],
  options: ModuleLabelsExportOptions = {},
): Promise<ExportModuleLabelsResult> {
  const issues = collectExportIssues(project, catalog);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  try {
    const customer = customers.find((c) => c.id === project.customerId);
    const labels =
      options.labels ??
      generateModuleLabels(project, catalog, {
        customerName: customer?.name,
        revision: options.revision ?? project.production?.revision?.toString(),
      });

    if (labels.length === 0) {
      return {
        ok: false,
        issues: [
          {
            message: 'no hay muebles para etiquetar',
            field: 'labels',
          },
        ],
      };
    }

    const buffer = await moduleLabelsPdfExport({
      projectId: project.id,
      projectName: project.name,
      customerName: customer?.name,
      labels,
      revision: options.revision ?? project.production?.revision?.toString(),
      qrFormat: options.qrFormat,
      qrHost: options.qrHost,
    });
    const bytes = toUint8Array(buffer);
    return {
      ok: true,
      fileName: moduleLabelsFileName(project.name),
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
              : 'Error inesperado al generar etiquetas de muebles',
          field: 'export',
        },
      ],
    };
  }
}

/** Trigger browser download of module labels PDF. */
export function downloadModuleLabelsPdf(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  deps?: DownloadDeps,
): void {
  downloadOptimizerXlsx(data, fileName, deps);
}
