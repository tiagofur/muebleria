/**
 * Exact commercial quote export model (#642 / Delivery 3).
 *
 * ONE pure projection — `QuoteRevision + commercialSnapshot →
 * ExactCommercialQuoteExportModel` — feeds BOTH client-facing renderers
 * (XLSX and PDF). No mutable source has a representation here: identity,
 * lines, units, quantities and totals are exclusively the frozen commercial
 * truth of the selected revision. Legacy revisions without a snapshot fail
 * closed with an actionable message — the current Project state is never a
 * fallback.
 */

import type { ExportIssue } from '@granete/domain';
import type { ExactCommercialQuoteExportModel } from '@granete/excel';
import {
  buildRevisionLines,
  formatLifecycleStatus,
} from '@granete/ui';
import type {
  QuoteCommercialSnapshot,
  QuoteRevisionDetail,
  QuoteRevisionStatus,
} from '@granete/storage';

export interface ExactCommercialQuoteExportSource {
  readonly revision: QuoteRevisionDetail;
  readonly snapshot: QuoteCommercialSnapshot;
}

const REVISION_STATUS_LABELS: Record<QuoteRevisionStatus, string> = {
  draft: 'Borrador',
  published: 'Publicada',
  accepted: 'Aceptada',
  superseded: 'Reemplazada',
};

function formatCommercialDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Real commercial lifecycle timestamp of the exact revision:
 * acceptedAt → publishedAt → createdAt. Never `Project.updatedAt`.
 */
export function commercialLifecycleTimestamp(
  revision: QuoteRevisionDetail,
): string {
  return revision.acceptedAt ?? revision.publishedAt ?? revision.createdAt;
}

function unitOptionsSummary(
  options: ReadonlyArray<{ groupLabel: string; choiceLabel: string }>,
): string {
  return options.map((o) => `${o.groupLabel}: ${o.choiceLabel}`).join('; ');
}

export interface BuildExactCommercialQuoteExportModelOptions {
  /**
   * Whether line amounts are authorized in the current context (existing
   * COST-01/COST-02 shell policy). When false, line sale prices render as
   * absence — the frozen sale TOTAL always remains (server redaction policy
   * keeps it for every authorized reader).
   */
  readonly amountsVisible?: boolean;
}

/**
 * Projects the exact frozen authority into the shared export model.
 *
 * Joins lines/units/items strictly by `quoteLineId`/`furnitureInstanceId`
 * (delegated to `buildRevisionLines`); distinct lines with identical names
 * stay distinct and per-unit configurations are preserved verbatim.
 */
export function buildExactCommercialQuoteExportModel(
  source: ExactCommercialQuoteExportSource,
  options?: BuildExactCommercialQuoteExportModelOptions,
): ExactCommercialQuoteExportModel {
  const { revision, snapshot } = source;
  const lines = buildRevisionLines(snapshot, revision.items, {
    amountsVisible: options?.amountsVisible ?? true,
  });

  return {
    revisionNumber: revision.revisionNumber,
    statusLabel: REVISION_STATUS_LABELS[revision.status] ?? revision.status,
    dateLabel: formatCommercialDateLabel(commercialLifecycleTimestamp(revision)),
    projectName: snapshot.project.name,
    customerName: snapshot.customer.name,
    currency: snapshot.currency,
    capturedAt: snapshot.capturedAt,
    lines: lines.map((line) => ({
      quoteLineId: line.quoteLineId,
      moduleCode: line.moduleCode,
      moduleName: line.moduleName,
      quantity: line.quantity,
      salePrice: line.salePrice,
      units: line.units.map((unit) => ({
        furnitureInstanceId: unit.furnitureInstanceId,
        lifecycleStatusLabel: formatLifecycleStatus(unit.lifecycleStatus),
        dimensionsLabel: unit.dimensionsFormatted,
        optionsSummary: unitOptionsSummary(unit.options ?? []),
      })),
    })),
    saleTotal: snapshot.breakdown.salePrice,
  };
}

export type ResolveExactCommercialExportResult =
  | { readonly ok: true; readonly source: ExactCommercialQuoteExportSource }
  | { readonly ok: false; readonly issues: readonly ExportIssue[] };

/**
 * Resolves ONE exact revision from the shell's cached revision list by its
 * exact `quoteRevisionId` (#642/3 blocker 1). Every non-exportable state
 * fails closed with an actionable message:
 * - unknown id → the exact revision was not found in the loaded list;
 * - legacy snapshot-less revision → the honest "create a new revision" CTA;
 *   the current Project state is never a fallback;
 * - org-policy withheld retail amounts (manufacturing-only caller) → the
 *   commercial export is not available, never a faked 0 total.
 */
export function resolveExactRevisionExportSource(
  revisions: ReadonlyArray<QuoteRevisionDetail>,
  quoteRevisionId: string,
): ResolveExactCommercialExportResult {
  const revision = revisions.find((candidate) => candidate.id === quoteRevisionId);
  if (!revision) {
    return {
      ok: false,
      issues: [
        {
          message:
            'No se encontró la revisión solicitada. Recargá las revisiones de la obra e intentá de nuevo.',
          field: 'export',
        },
      ],
    };
  }
  if (!revision.commercialSnapshot) {
    return {
      ok: false,
      issues: [
        {
          message:
            'Esta cotización anterior no tiene historial comercial congelado. ' +
            'Creá una nueva revisión actualizada para exportarla con precisión.',
          field: 'export',
        },
      ],
    };
  }
  if (revision.commercialAmountsWithheld === true) {
    return {
      ok: false,
      issues: [
        {
          message:
            'El precio comercial de esta cotización no está disponible para tu organización ' +
            '(sólo fabricación). El export comercial lo maneja la organización que cotizó.',
          field: 'export',
        },
      ],
    };
  }
  return {
    ok: true,
    source: { revision, snapshot: revision.commercialSnapshot },
  };
}
