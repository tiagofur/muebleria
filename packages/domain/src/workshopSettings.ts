/**
 * Workshop settings defaults and merge helpers (F031 / issue #37).
 */

import type { WorkshopSettings, Workspace } from './types';

/** #1648 — matches Go domain.DefaultQuoteValidityDays. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 15;
export const QUOTE_VALIDITY_DAYS_MAX = 365;
/** #1648 — matches Go domain.DefaultWorkshopTimeZone. */
export const DEFAULT_WORKSHOP_TIME_ZONE = 'America/Mexico_City';

/** True when the runtime knows this IANA zone (mirrors Go time.LoadLocation). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_WORKSHOP_SETTINGS: WorkshopSettings = {
  defaultMarginFactor: 1.35,
  defaultLaborFixedCost: 0,
  defaultCurrency: 'MXN',
  vendedorCanViewCosts: false,
  defaultSawKerfMm: 4.4,
  defaultTrimMargins: {
    topMm: 10,
    bottomMm: 10,
    leftMm: 10,
    rightMm: 10,
  },
  defaultDeductEdgeBand: true,
  defaultCutStrategy: 'saw-guillotine',
  navMode: 'departmental',
  quoteValidityDays: DEFAULT_QUOTE_VALIDITY_DAYS,
  timeZone: DEFAULT_WORKSHOP_TIME_ZONE,
};

/** Merge partial/legacy settings with product defaults. */
export function resolveWorkshopSettings(
  settings?: Partial<WorkshopSettings> | WorkshopSettings | null,
): WorkshopSettings {
  if (!settings) return { ...DEFAULT_WORKSHOP_SETTINGS };
  const margin = settings.defaultMarginFactor;
  const labor = settings.defaultLaborFixedCost;
  const currency = settings.defaultCurrency?.trim();
  const name = settings.workshopName?.trim();

  const kerf = settings.defaultSawKerfMm;
  const trim = settings.defaultTrimMargins;
  const deductEdge = settings.defaultDeductEdgeBand;

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
    workshopName: name || undefined,
    defaultSawKerfMm:
      typeof kerf === 'number' && Number.isFinite(kerf) && kerf >= 0
        ? kerf
        : DEFAULT_WORKSHOP_SETTINGS.defaultSawKerfMm,
    defaultTrimMargins: {
      topMm:
        typeof trim?.topMm === 'number' && Number.isFinite(trim.topMm) && trim.topMm >= 0
          ? trim.topMm
          : DEFAULT_WORKSHOP_SETTINGS.defaultTrimMargins!.topMm,
      bottomMm:
        typeof trim?.bottomMm === 'number' && Number.isFinite(trim.bottomMm) && trim.bottomMm >= 0
          ? trim.bottomMm
          : DEFAULT_WORKSHOP_SETTINGS.defaultTrimMargins!.bottomMm,
      leftMm:
        typeof trim?.leftMm === 'number' && Number.isFinite(trim.leftMm) && trim.leftMm >= 0
          ? trim.leftMm
          : DEFAULT_WORKSHOP_SETTINGS.defaultTrimMargins!.leftMm,
      rightMm:
        typeof trim?.rightMm === 'number' && Number.isFinite(trim.rightMm) && trim.rightMm >= 0
          ? trim.rightMm
          : DEFAULT_WORKSHOP_SETTINGS.defaultTrimMargins!.rightMm,
    },
    defaultDeductEdgeBand:
      typeof deductEdge === 'boolean'
        ? deductEdge
        : DEFAULT_WORKSHOP_SETTINGS.defaultDeductEdgeBand,
    defaultCutStrategy:
      settings.defaultCutStrategy === 'cnc-nesting' ||
      settings.defaultCutStrategy === 'saw-guillotine'
        ? settings.defaultCutStrategy
        : DEFAULT_WORKSHOP_SETTINGS.defaultCutStrategy,
    navMode:
      settings.navMode === 'simplified'
        ? 'simplified'
        : DEFAULT_WORKSHOP_SETTINGS.navMode,
    // #1648: out-of-range falls back to the default (Go normalize + DB CHECK).
    quoteValidityDays:
      typeof settings.quoteValidityDays === 'number' &&
      Number.isInteger(settings.quoteValidityDays) &&
      settings.quoteValidityDays >= 1 &&
      settings.quoteValidityDays <= QUOTE_VALIDITY_DAYS_MAX
        ? settings.quoteValidityDays
        : DEFAULT_QUOTE_VALIDITY_DAYS,
    timeZone:
      typeof settings.timeZone === 'string' &&
      settings.timeZone.trim() !== '' &&
      isValidTimeZone(settings.timeZone.trim())
        ? settings.timeZone.trim()
        : DEFAULT_WORKSHOP_TIME_ZONE,
  };
}

/** Ensure workspace always has resolved settings (non-destructive). */
export function withWorkshopSettings(workspace: Workspace): Workspace {
  return {
    ...workspace,
    settings: resolveWorkshopSettings(workspace.settings),
  };
}
