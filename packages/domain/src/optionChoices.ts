/**
 * Effective option resolution: project defaults + per-line overrides (F029 / #35).
 */

import type { OptionChoices } from './types';

/**
 * Merge project-level defaults with item overrides.
 * Item keys with empty/whitespace values are ignored (inherit project).
 * Explicit item values win over project defaults.
 */
export function effectiveOptionChoices(
  itemChoices: OptionChoices | undefined | null,
  projectLevelChoices?: OptionChoices | null,
): OptionChoices {
  const result: Record<string, string> = {};
  if (projectLevelChoices) {
    for (const [code, id] of Object.entries(projectLevelChoices)) {
      const v = id?.trim();
      if (v) result[code] = v;
    }
  }
  if (itemChoices) {
    for (const [code, id] of Object.entries(itemChoices)) {
      const v = id?.trim();
      if (v) result[code] = v;
    }
  }
  return result;
}
