/**
 * Pure breakdown derivations for the shell (F120 extract from App.tsx):
 * module cost preview (MOD-06), display-breakdown unification and the
 * selected-project quote computation (PRJ-06 / UX-03).
 */

import type {
  Module,
  OptionChoices,
  Project,
  QuoteBreakdown,
  Workspace,
} from '@muebles/domain';
import { calcProjectBreakdown, defaultMeasurePresetId } from '@muebles/domain';
import {
  canShowPricePreview,
  canShowProjectPricePreview,
  defaultOptionChoicesForModule,
  requiredGroupCodesForModule,
  selectableGroupCodesForModule,
} from '@muebles/ui';

/**
 * MOD-06: domain cost preview for a single saved module using default option
 * choices. Pure wiring in the shell — UI only receives QuoteBreakdown props.
 */
export function computeModuleCostPreview(
  module: Module,
  catalog: Workspace['catalog'],
): {
  costPreview: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
  previewError: string | null;
} {
  const required = requiredGroupCodesForModule(module, catalog.optionGroups, catalog.components, catalog.structures);
  const choices = defaultOptionChoicesForModule(
    module,
    catalog.optionGroups,
    catalog.components,
    catalog.structures,
    catalog.agregados,
  ) as OptionChoices;
  const gate = canShowPricePreview(required, choices);
  if (!gate.ok) {
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
      previewError: null,
    };
  }

  const now = new Date().toISOString();
  const project: Project = {
    id: 'module-preview-project',
    name: 'Preview módulo',
    customerId: 'Preview',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'module-preview-item',
        moduleId: module.id,
        quantity: 1,
        optionChoices: choices,
        // Modules with commercial presets demand a selection — preview with
        // the default one (first), like the add-item flow does.
        measurePresetId: defaultMeasurePresetId(module),
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  try {
    const costPreview = calcProjectBreakdown(project, catalog);
    return { costPreview, previewBlocked: false, missingGroups: [], previewError: null };
  } catch (e) {
    // Honest missing list: every used group (required or optional) without a
    // default choice — NOT a blanket dump of all required groups, which
    // pointed users at groups that were fine (F087 follow-up).
    const selectable = selectableGroupCodesForModule(
      module,
      catalog.optionGroups,
      catalog.components,
      catalog.structures,
      catalog.agregados,
    );
    const missing = selectable.filter((code) => !choices[code]?.trim());
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: missing,
      previewError: e instanceof Error ? e.message : null,
    };
  }
}

/**
 * Unify list-card estimate vs detail totals (same project must show the same
 * sale price). List always uses local domain (`projectEstimates` / F022).
 *
 * - With costs visible (admin/guest): prefer local so detail matches the list
 *   and does not "jump" when the backend calculate response arrives.
 * - Cost-redacted roles (vendedor): catalog unit prices are zeroed client-side,
 *   so the server salePrice is authoritative when present.
 * - Fallbacks: local → remote → null.
 */
export function resolveDisplayBreakdown(
  local: QuoteBreakdown | null,
  remote: QuoteBreakdown | null,
  showCosts: boolean,
): QuoteBreakdown | null {
  if (!showCosts && remote) return remote;
  return local ?? remote;
}

/**
 * PRJ-06 / UX-03: domain breakdown for the selected project when option gate
 * is open. Preserves the engine's error message so the user sees *why* the
 * quote is blocked (missing material, invalid dims, …).
 */
export function computeSelectedProjectBreakdown(
  project: Project | undefined,
  catalog: Workspace['catalog'],
): {
  breakdown: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
  /** Human-readable reason when the breakdown threw (missing ref, bad dims, …). */
  breakdownError: string | null;
} {
  if (!project) {
    return { breakdown: null, previewBlocked: false, missingGroups: [], breakdownError: null };
  }
  if (project.items.length === 0) {
    return { breakdown: null, previewBlocked: false, missingGroups: [], breakdownError: null };
  }

  const gate = canShowProjectPricePreview(
    project,
    catalog.modules,
    catalog.optionGroups,
    catalog.components,
    catalog.structures,
  );
  if (!gate.ok) {
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
      breakdownError: null,
    };
  }

  try {
    const breakdown = calcProjectBreakdown(project, catalog);
    return { breakdown, previewBlocked: false, missingGroups: [], breakdownError: null };
  } catch (e) {
    const reason =
      e instanceof Error
        ? e.message
        : 'No se pudo calcular el presupuesto.';
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: [],
      breakdownError: reason,
    };
  }
}
