/**
 * Web commercial quote pipeline (#642 / Delivery 3): exact QuoteRevision +
 * commercialSnapshot → shared export model → xlsx → download.
 *
 * The ONLY commercial authority is the selected exact revision. Mutable
 * Project state, live catalog prices, legacy priceSnapshot and current
 * customer names have no path into this export.
 */

import {
  domainErrorToExportIssue,
  DomainError,
  type ExportIssue,
} from '@granete/domain';
import { commercialQuoteExport } from '@granete/excel';
import {
  downloadOptimizerXlsx,
  type DownloadDeps,
} from './exportOptimizer';
import {
  buildExactCommercialQuoteExportModel,
  type BuildExactCommercialQuoteExportModelOptions,
  type ExactCommercialQuoteExportSource,
} from './exports/exactCommercialQuoteModel';

export type ExportCommercialQuoteResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

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
 * Exact-revision file name: `Cotizacion-{obra}-{cliente}-Q{n}.xlsx`.
 * The revision number is mandatory — an ambiguous `cotizacion.xlsx` is never
 * acceptable once multiple revisions can exist.
 */
export function commercialQuoteFileName(
  projectName: string,
  customerName: string,
  revisionNumber: number,
): string {
  const project = slugifyPart(projectName);
  const customer = slugifyPart(customerName);
  const identity = [project, customer].filter(Boolean).join('-') || 'cotizacion';
  return `Cotizacion-${identity}-Q${revisionNumber}.xlsx`;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/**
 * Build the client-facing commercial workbook for ONE exact QuoteRevision.
 * Line amounts render only when the existing cost-visibility policy
 * authorizes them; the frozen sale total is always shown.
 */
export async function buildCommercialQuoteExport(
  source: ExactCommercialQuoteExportSource,
  options?: BuildExactCommercialQuoteExportModelOptions,
): Promise<ExportCommercialQuoteResult> {
  try {
    const model = buildExactCommercialQuoteExportModel(source, options);
    const buffer = await commercialQuoteExport(model);
    return {
      ok: true,
      fileName: commercialQuoteFileName(
        model.projectName,
        model.customerName,
        model.revisionNumber,
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
