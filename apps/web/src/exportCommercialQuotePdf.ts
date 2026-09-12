/**
 * Web commercial quote PDF pipeline (#642 / Delivery 3).
 *
 * Reuses the SAME exact-revision export model as the XLSX path: the PDF
 * reproduces exactly the same QN, frozen identity, lines and authorized
 * amounts. Sale total only — the workshop cost stack never reaches the
 * client document.
 */

import {
  domainErrorToExportIssue,
  DomainError,
  type ExportIssue,
} from '@granete/domain';
import {
  commercialQuotePdfExport,
  type CommercialQuotePdfVariant,
} from '@granete/excel';
import {
  downloadOptimizerXlsx,
  type DownloadDeps,
} from './exportOptimizer';
import {
  buildExactCommercialQuoteExportModel,
  type BuildExactCommercialQuoteExportModelOptions,
  type ExactCommercialQuoteExportSource,
} from './exports/exactCommercialQuoteModel';

export type ExportCommercialQuotePdfResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

const VARIANT_SUFFIX: Record<CommercialQuotePdfVariant, string> = {
  detailed: 'listado',
  summary: 'resumen',
};

function slugifyPart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') ?? ''
  );
}

/**
 * Exact-revision file name: `Cotizacion-{obra}-{cliente}-Q{n}-{variant}.pdf`.
 */
export function commercialQuotePdfFileName(
  projectName: string,
  customerName: string,
  revisionNumber: number,
  variant: CommercialQuotePdfVariant,
): string {
  const project = slugifyPart(projectName);
  const customer = slugifyPart(customerName);
  const identity = [project, customer].filter(Boolean).join('-') || 'cotizacion';
  return `Cotizacion-${identity}-Q${revisionNumber}-${VARIANT_SUFFIX[variant]}.pdf`;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/**
 * Build the client-facing commercial PDF for ONE exact QuoteRevision.
 * - detailed: furniture list + revision header + sale total
 * - summary: revision header + sale total (no furniture lines)
 */
export async function buildCommercialQuotePdfExport(
  source: ExactCommercialQuoteExportSource,
  options?: {
    variant?: CommercialQuotePdfVariant;
    workshopName?: string;
  } & BuildExactCommercialQuoteExportModelOptions,
): Promise<ExportCommercialQuotePdfResult> {
  try {
    const model = buildExactCommercialQuoteExportModel(source, options);
    const buffer = await commercialQuotePdfExport({
      model,
      variant: options?.variant ?? 'detailed',
      workshopName: options?.workshopName,
    });
    return {
      ok: true,
      fileName: commercialQuotePdfFileName(
        model.projectName,
        model.customerName,
        model.revisionNumber,
        options?.variant ?? 'detailed',
      ),
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
