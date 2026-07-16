/**
 * Workshop settings defaults and merge helpers (F031 / issue #37).
 */

import type { WorkshopSettings, Workspace } from './types';

export const DEFAULT_WORKSHOP_SETTINGS: WorkshopSettings = {
  defaultMarginFactor: 1.35,
  defaultLaborFixedCost: 0,
  defaultCurrency: 'MXN',
  vendedorCanViewCosts: false,
};

/** Merge partial/legacy settings with product defaults. */
export function resolveWorkshopSettings(
  settings?: Partial<WorkshopSettings> | WorkshopSettings | null,
): WorkshopSettings {
  if (!settings) return { ...DEFAULT_WORKSHOP_SETTINGS };
  const margin = settings.defaultMarginFactor;
  const labor = settings.defaultLaborFixedCost;
  const currency = settings.defaultCurrency?.trim();
  return {
    defaultMarginFactor:
      typeof margin === 'number' && Number.isFinite(margin) && margin > 0
        ? margin
        : DEFAULT_WORKSHOP_SETTINGS.defaultMarginFactor,
    defaultLaborFixedCost:
      typeof labor === 'number' && Number.isFinite(labor) && labor >= 0
        ? labor
        : DEFAULT_WORKSHOP_SETTINGS.defaultLaborFixedCost,
    defaultCurrency: currency
      ? currency.toUpperCase()
      : DEFAULT_WORKSHOP_SETTINGS.defaultCurrency,
    vendedorCanViewCosts:
      typeof settings.vendedorCanViewCosts === 'boolean'
        ? settings.vendedorCanViewCosts
        : DEFAULT_WORKSHOP_SETTINGS.vendedorCanViewCosts,
  };
}

/** Ensure workspace always has resolved settings (non-destructive). */
export function withWorkshopSettings(workspace: Workspace): Workspace {
  return {
    ...workspace,
    settings: resolveWorkshopSettings(workspace.settings),
  };
}
