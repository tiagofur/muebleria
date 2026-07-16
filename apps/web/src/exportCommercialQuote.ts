/**
 * Web commercial quote pipeline: domain breakdown → xlsx → download (F030 / #36).
 */

import {
  calcProjectBreakdown,
  domainErrorToExportIssue,
  DomainError,
  isProjectClosed,
  type Catalog,
  type Customer,
  type ExportIssue,
  type Project,
} from '@muebles/domain';
import { commercialQuoteExport } from '@muebles/excel';
import {
  downloadOptimizerXlsx,
  type DownloadDeps,
} from './exportOptimizer';

export type ExportCommercialQuoteResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

const STATUS_LABELS: Record<Project['status'], string> = {
  draft: 'Borrador',
  quoted: 'Cotizado',
  accepted: 'Aceptado',
};

/** Safe file name: cotizacion-{projectName}.xlsx */
export function commercialQuoteFileName(projectName: string): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'cotizacion';
  return `cotizacion-${safe}.xlsx`;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function resolveCustomerName(
  customerId: string,
  customers: readonly Customer[],
): string {
  const hit = customers.find((c) => c.id === customerId);
  return hit?.name ?? (customerId || '—');
}

function optionLabel(
  optionId: string,
  catalog: Catalog,
): string {
  const mat = catalog.materials.find((m) => m.id === optionId);
  if (mat) return mat.name;
  const edge = catalog.edges.find((e) => e.id === optionId);
  if (edge) return edge.name;
  const hw = catalog.hardware.find((h) => h.id === optionId);
  if (hw) return hw.name;
  return optionId;
}

function optionsSummary(
  choices: Project['items'][number]['optionChoices'],
  catalog: Catalog,
): string {
  const parts: string[] = [];
  for (const [code, optionId] of Object.entries(choices)) {
    const group = catalog.optionGroups.find((g) => g.code === code);
    const label = group?.name ?? code;
    parts.push(`${label}: ${optionLabel(optionId, catalog)}`);
  }
  return parts.join('; ');
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Build commercial quote workbook for the client.
 * Closed projects use priceSnapshot; drafts use live calcProjectBreakdown.
 */
export async function buildCommercialQuoteExport(
  project: Project,
  catalog: Catalog,
  customers: readonly Customer[] = [],
): Promise<ExportCommercialQuoteResult> {
  if (project.items.length === 0) {
    return {
      ok: false,
      issues: [
        {
          message: 'Agregá al menos un mueble antes de exportar la cotización.',
          field: 'items',
        },
      ],
    };
  }

  try {
    const pricesFrozen =
      isProjectClosed(project.status) && Boolean(project.priceSnapshot);
    const breakdown =
      pricesFrozen && project.priceSnapshot
        ? project.priceSnapshot.breakdown
        : calcProjectBreakdown(project, catalog);

    const items = project.items.map((item) => {
      const mod = catalog.modules.find((m) => m.id === item.moduleId);
      return {
        moduleCode: mod?.code ?? item.moduleId,
        moduleName: mod?.name ?? 'Mueble desconocido',
        quantity: item.quantity,
        optionsSummary: optionsSummary(item.optionChoices, catalog),
      };
    });

    const buffer = await commercialQuoteExport({
      projectName: project.name,
      customerName: resolveCustomerName(project.customerId, customers),
      currency: project.currency || 'MXN',
      statusLabel: STATUS_LABELS[project.status] ?? project.status,
      dateLabel: formatDateLabel(project.updatedAt),
      items,
      totals: {
        materialsCost: breakdown.materialsCost,
        edgeTotal: breakdown.edgeTotal,
        hardwareTotal: breakdown.hardwareTotal,
        laborModular: breakdown.laborModular,
        laborFixedCost: breakdown.laborFixedCost,
        directCost: breakdown.directCost,
        marginFactor: breakdown.marginFactor,
        salePrice: breakdown.salePrice,
      },
      pricesFrozen,
    });

    return {
      ok: true,
      fileName: commercialQuoteFileName(project.name),
      bytes: toUint8Array(buffer),
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
              : 'Error inesperado al generar la cotización',
          field: 'export',
        },
      ],
    };
  }
}

export function downloadCommercialQuoteXlsx(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  deps?: DownloadDeps,
): void {
  downloadOptimizerXlsx(data, fileName, deps);
}
