/**
 * Web commercial quote PDF pipeline (F045 / #90).
 * Reuses the same domain breakdown path as Excel; PDF is sale-price only.
 */

import {
  calcProjectBreakdown,
  domainErrorToExportIssue,
  DomainError,
  effectiveOptionChoices,
  isProjectClosed,
  type Catalog,
  type Customer,
  type ExportIssue,
  type Project,
} from '@muebles/domain';
import {
  commercialQuotePdfExport,
  type CommercialQuotePdfVariant,
} from '@muebles/excel';
import {
  downloadOptimizerXlsx,
  type DownloadDeps,
} from './exportOptimizer';

export type ExportCommercialQuotePdfResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

const STATUS_LABELS: Record<Project['status'], string> = {
  draft: 'Borrador',
  quoted: 'Cotizado',
  accepted: 'Aceptado',
  produced: 'En producción',
};

export function commercialQuotePdfFileName(
  projectName: string,
  variant: CommercialQuotePdfVariant,
): string {
  const trimmed = projectName.trim();
  const safe =
    trimmed
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'cotizacion';
  const suffix = variant === 'summary' ? 'resumen' : 'listado';
  return `cotizacion-${safe}-${suffix}.pdf`;
}

function resolveCustomerName(
  customerId: string,
  customers: readonly Customer[],
): string {
  const hit = customers.find((c) => c.id === customerId);
  return hit?.name ?? (customerId || '—');
}

function optionLabel(optionId: string, catalog: Catalog): string {
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

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/**
 * Build commercial quote PDF.
 * - detailed: furniture list + project header + sale total
 * - summary: project info + sale total (no furniture lines)
 * Client PDF never includes workshop costs.
 */
export async function buildCommercialQuotePdfExport(
  project: Project,
  catalog: Catalog,
  customers: readonly Customer[] = [],
  variant: CommercialQuotePdfVariant = 'detailed',
): Promise<ExportCommercialQuotePdfResult> {
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
      const choices = effectiveOptionChoices(
        item.optionChoices,
        project.projectLevelChoices,
      );
      return {
        moduleCode: mod?.code ?? item.moduleId,
        moduleName: mod?.name ?? 'Mueble desconocido',
        quantity: item.quantity,
        optionsSummary: optionsSummary(choices, catalog),
      };
    });

    const buffer = await commercialQuotePdfExport({
      projectName: project.name,
      customerName: resolveCustomerName(project.customerId, customers),
      currency: project.currency || 'MXN',
      statusLabel: STATUS_LABELS[project.status] ?? project.status,
      dateLabel: formatDateLabel(project.updatedAt),
      items,
      salePrice: breakdown.salePrice,
      pricesFrozen,
      variant,
    });

    return {
      ok: true,
      fileName: commercialQuotePdfFileName(project.name, variant),
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
              : 'Error inesperado al generar el PDF',
          field: 'export',
        },
      ],
    };
  }
}

export function downloadCommercialQuotePdf(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  deps?: DownloadDeps,
): void {
  downloadOptimizerXlsx(data, fileName, deps);
}
