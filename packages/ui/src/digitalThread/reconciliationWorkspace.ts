/**
 * #502 / WEB-DT-3 — pure presentation model for the reconciliation,
 * approval and exact ProductionRelease workspace.
 *
 * Authority rules (issue #502, tracker #396, #393/#394/#395/#466):
 * - Statuses, differences, impact flags, severity/blockers, requote
 *   eligibility and preflight verdicts come verbatim from the generated
 *   backend contracts. Nothing here compares parameters, materials or
 *   transforms, and nothing infers commercial/manufacturing/spatial impact.
 * - `isIncorporableChange` mirrors the incorporable-selection rule documented
 *   on the generated `requoteProjectQuote` contract (presentation affordance
 *   only): the server recomputes reconciliation before creating anything and
 *   rejects invalid selections fail-closed. This function reads server
 *   classification booleans — it never reclassifies.
 * - `findContextualRelease` filters server-returned exact pins for display;
 *   it never derives, merges or invents release linkage. The "latest" project
 *   release stays an informational projection, never a contextual one.
 * - Label maps and path formatting are copy-only; canonical codes and
 *   statuses are always rendered alongside for audit parity with #466.
 */

import type {
  ChangeImpact,
  ManufacturingPreflightResult,
  ProductionRelease,
  QuoteRevisionStatus,
  QuoteRevisionSourceType,
  ReconciliationItem,
  ReconciliationStatus,
} from '@granete/storage';

export const RECONCILIATION_STATUS_LABELS: Readonly<Record<ReconciliationStatus, string>> = {
  synced: 'Sincronizado',
  quoted_not_modeled: 'Cotizado no modelado',
  modeled_not_quoted: 'Modelado no cotizado',
  modified: 'Modificado',
  removed: 'Retirado',
  conflict: 'Conflicto',
};

export const QUOTE_REVISION_STATUS_LABELS: Readonly<Record<QuoteRevisionStatus, string>> = {
  draft: 'Borrador',
  published: 'Publicada',
  accepted: 'Aceptada',
  superseded: 'Reemplazada',
};

export const QUOTE_SOURCE_TYPE_LABELS: Readonly<Record<QuoteRevisionSourceType, string>> = {
  manual: 'Manual',
  imported: 'Importación',
  requote: 'Re-cotización',
  system: 'Sistema',
};

/**
 * Display copy for the canonical release preflight issue codes (#466/#395
 * parity). Codes are rendered verbatim next to the label — Web never maps to
 * a second taxonomy and never invents severity: `blocked` status IS the
 * server verdict.
 */
export const PREFLIGHT_ISSUE_CODE_LABELS: Readonly<Record<string, string>> = {
  empty_revision: 'La revisión no contiene muebles para fabricar',
  duplicate_instance: 'Una unidad física aparece duplicada',
  missing_definition: 'La definición de catálogo no existe',
  invalid_parameters: 'Parámetros fuera del contrato de fabricación',
  invalid_material_choice: 'Elección de material inválida',
};

export const PREFLIGHT_STATUS_LABELS: Readonly<Record<ManufacturingPreflightResult['status'], string>> = {
  ready: 'Listo para fabricación',
  blocked: 'Bloqueado',
};

/**
 * Copy-only translation of structured difference paths. Falls back to the raw
 * canonical path — never hides it from audit. Impact of each difference comes
 * from the server `StructuredDifference.impact`, never from this map.
 */
const DIFFERENCE_PATH_LABELS: Readonly<Record<string, string>> = {
  furnitureDefinitionId: 'Definición de mueble',
  definitionVersion: 'Versión de definición',
  room: 'Ambiente',
};

export function formatDifferencePath(path: string): string {
  const parametersPrefix = 'parameters.';
  const materialPrefix = 'materialChoices.';
  const transformPrefix = 'transform.';
  if (path.startsWith(parametersPrefix)) {
    return `Parámetro ${path.slice(parametersPrefix.length)}`;
  }
  if (path.startsWith(materialPrefix)) {
    return `Material (${path.slice(materialPrefix.length)})`;
  }
  if (path.startsWith(transformPrefix)) {
    return `Posición (${path.slice(transformPrefix.length)})`;
  }
  return DIFFERENCE_PATH_LABELS[path] ?? path;
}

export function formatDifferenceValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => formatDifferenceValue(v)).join(', ')}]`;
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Human chips for the non-exclusive server impact groups (#394). */
export function impactChips(impact: ChangeImpact): readonly string[] {
  const chips: string[] = [];
  if (impact.commercial) chips.push('Comercial');
  if (impact.manufacturing) chips.push('Fabricación');
  if (impact.spatial) chips.push('Espacial');
  return chips;
}

/**
 * Presentation affordance mirroring the generated requote contract: a unit is
 * offered for explicit incorporation only when the SERVER classification says
 * it is a design-driven commercial change (`modified` with commercial impact)
 * or a `modeled_not_quoted` addition. The command revalidates fail-closed —
 * an invalid selection rejects the whole requote without creating anything.
 */
export function isIncorporableChange(item: ReconciliationItem): boolean {
  if (item.status === 'modeled_not_quoted') return true;
  return item.status === 'modified' && item.impact.commercial;
}

/**
 * Contextual release for display: the newest server-returned release whose
 * EXACT pins match the selected revisions. Pure filter over authoritative
 * pins — no derivation, no latest fallback.
 */
export function findContextualRelease(
  releases: readonly ProductionRelease[],
  quoteRevisionId: string | null,
  designRevisionId: string | null,
): ProductionRelease | null {
  const matches = releases.filter(
    (rel) =>
      rel.design_revision_id === designRevisionId &&
      (quoteRevisionId === null || rel.quote_revision_id === quoteRevisionId),
  );
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => b.release_number - a.release_number)[0] ?? null;
}

export function formatFingerprint(fingerprint: string): string {
  return `${fingerprint.slice(0, 19)}…`;
}

export function formatQuoteRevisionLabel(
  revision: { readonly revisionNumber: number } | null | undefined,
): string {
  return revision ? `Q${revision.revisionNumber}` : '—';
}

export function formatDesignRevisionLabel(
  revision: { readonly revision_number: number } | null | undefined,
): string {
  return revision ? `R${revision.revision_number}` : '—';
}

/**
 * A comparison against superseded revisions is still a valid historical
 * snapshot, but commands built on it must fail per backend rules. Purely
 * informational from server statuses — never blocks anything client-side.
 */
export function isHistoricalComparison(
  quoteStatus: QuoteRevisionStatus | undefined,
  designRevisionStatus: string | undefined,
): boolean {
  return quoteStatus === 'superseded' || designRevisionStatus === 'superseded';
}
