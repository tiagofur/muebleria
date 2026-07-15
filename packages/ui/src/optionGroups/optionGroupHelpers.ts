/**
 * Pure option-group UI helpers — member filtering + price-preview gate (no cost formulas).
 */

import type {
  EdgeBand,
  Hardware,
  MaterialBoard,
  OptionChoices,
  OptionGroup,
  OptionGroupKind,
} from '@muebles/domain';
import { filterActiveForPicker, normalizeCode } from '../catalogs/catalogHelpers';

export type CatalogMember = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
};

export type PricePreviewGateResult =
  | { readonly ok: true; readonly missingGroups: readonly [] }
  | { readonly ok: false; readonly missingGroups: readonly string[] };

const KIND_LABELS: Record<OptionGroupKind, string> = {
  board: 'Tablero',
  hardware: 'Herraje',
  edge: 'Canto',
};

export function optionGroupKindLabel(kind: OptionGroupKind): string {
  return KIND_LABELS[kind];
}

/**
 * OPT-02: members available for a group kind (active catalog items only by default).
 */
export function membersForKind(
  kind: OptionGroupKind,
  catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  },
  options?: { readonly includeInactive?: boolean },
): CatalogMember[] {
  const source: readonly CatalogMember[] =
    kind === 'board'
      ? catalogs.materials
      : kind === 'hardware'
        ? catalogs.hardware
        : catalogs.edges;
  return filterActiveForPicker(source, options).map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    active: item.active,
  }));
}

/** Keep only optionIds that still exist among candidates of the current kind. */
export function filterOptionIdsByMembers(
  optionIds: readonly string[],
  members: readonly CatalogMember[],
): string[] {
  const allowed = new Set(members.map((m) => m.id));
  return optionIds.filter((id) => allowed.has(id));
}

export function findOptionGroupCodeConflict(
  code: string,
  groups: readonly OptionGroup[],
  excludeId?: string,
): OptionGroup | undefined {
  const normalized = normalizeCode(code);
  if (!normalized) return undefined;
  return groups.find(
    (g) => g.id !== excludeId && normalizeCode(g.code) === normalized,
  );
}

export function validateOptionGroupCode(
  code: string,
  groups: readonly OptionGroup[],
  excludeId?: string,
): string | null {
  const trimmed = code.trim();
  if (!trimmed) {
    return 'El código es obligatorio.';
  }
  const conflict = findOptionGroupCodeConflict(trimmed, groups, excludeId);
  if (conflict) {
    return `Ya existe un grupo con el código "${conflict.code}".`;
  }
  return null;
}

/**
 * OPT-05: required option groups without a non-empty choice block price preview.
 * Pure gate — does not compute costs.
 */
export function canShowPricePreview(
  requiredGroupCodes: readonly string[],
  optionChoices: OptionChoices,
): PricePreviewGateResult {
  const missing = requiredGroupCodes.filter((code) => {
    const choice = optionChoices[code];
    return choice === undefined || choice.trim() === '';
  });
  if (missing.length === 0) {
    return { ok: true, missingGroups: [] };
  }
  return { ok: false, missingGroups: missing };
}

/**
 * Codes of groups that are `required` and appear as optionRole on the module
 * (board parts or hardware lines without fixed hardwareId).
 */
export function requiredGroupCodesForModule(
  module: {
    readonly boardParts: readonly { readonly optionRole: string }[];
    readonly hardwareLines: readonly {
      readonly optionRole: string;
      readonly hardwareId?: string;
    }[];
  },
  optionGroups: readonly OptionGroup[],
): string[] {
  const usedRoles = new Set<string>();
  for (const part of module.boardParts) {
    if (part.optionRole?.trim()) usedRoles.add(part.optionRole.trim());
  }
  for (const line of module.hardwareLines) {
    if (line.hardwareId) continue;
    if (line.optionRole?.trim()) usedRoles.add(line.optionRole.trim());
  }

  const required = optionGroups
    .filter((g) => g.required && usedRoles.has(g.code))
    .map((g) => g.code);

  return [...new Set(required)];
}

export const SEED_OPTION_GROUP_CODES = [
  'INTERIOR',
  'FRENTE',
  'BISAGRA',
  'CORREDERA',
] as const;
