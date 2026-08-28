/**
 * Pure option-group UI helpers — member filtering + price-preview gate (no cost formulas).
 */

import type {
  Agregado,
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  ModuleBaseMode,
  OptionChoices,
  OptionGroup,
  OptionGroupKind,
  Structure,
} from '@granete/domain';
import {
  PATAS_ROLE,
  ZOCLO_BOARD_ROLE,
  ZOCLO_STRIP_ROLE,
} from '@granete/domain';
import { filterActiveForPicker, normalizeCode } from '../catalogs/catalogHelpers';

/**
 * Collect optionRoles from a module's component instances AND the component
 * instances of its referenced structure (when both catalogs are provided).
 * Modules no longer carry board parts, so roles come from components.
 */
function collectComponentRoles(
  componentInstances: readonly { componentId: string }[] | undefined,
  catalogComponents: readonly Component[] | undefined,
  out: Set<string>,
): void {
  if (!componentInstances || !catalogComponents) return;
  for (const inst of componentInstances) {
    const comp = catalogComponents.find((c) => c.id === inst.componentId);
    if (comp) {
      for (const role of comp.optionRoles) {
        if (role.trim()) out.add(role.trim());
      }
    }
  }
}

/**
 * Collect optionRoles from hardwareLines and component instances of Agregados.
 */
function collectAgregadoRoles(
  agregadoInstances: readonly { readonly agregadoId: string }[] | undefined,
  catalogAgregados: readonly Agregado[] | undefined,
  catalogComponents: readonly Component[] | undefined,
  out: Set<string>,
): void {
  if (!agregadoInstances || !catalogAgregados) return;
  for (const inst of agregadoInstances) {
    const agregado = catalogAgregados.find((a) => a.id === inst.agregadoId);
    if (agregado) {
      if (agregado.hardwareLines) {
        for (const line of agregado.hardwareLines) {
          if (line.hardwareId) continue;
          if (line.optionRole?.trim()) out.add(line.optionRole.trim());
        }
      }
      collectComponentRoles(agregado.components, catalogComponents, out);
    }
  }
}

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

/** Module shape the role collectors read (hardware, components, base mode). */
export type ModuleLikeForRoles = {
  readonly hardwareLines: readonly {
    readonly optionRole: string;
    readonly hardwareId?: string;
  }[];
  readonly components?: readonly { readonly componentId: string }[];
  readonly structureId?: string;
  readonly agregados?: readonly { readonly agregadoId: string }[];
  readonly baseMode?: ModuleBaseMode;
};

/**
 * Codes of groups that are `required` and appear as an optionRole used by the
 * module — via hardware lines without a fixed hardwareId, or via the optionRoles
 * of the module's component instances and its referenced structure's components.
 * Modules no longer carry board parts directly.
 */
export function requiredGroupCodesForModule(
  module: ModuleLikeForRoles,
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): string[] {
  const usedRoles = collectUsedOptionRoles(
    module,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );

  const required = optionGroups
    .filter((g) => g.required && usedRoles.has(g.code))
    .map((g) => g.code);

  return [...new Set(required)];
}

/**
 * F087 / pre-demo audit P0-2b: a plinth_board module consumes a ZOCLO board
 * choice even when no component declares the role — the engine synthesizes
 * the ZOCLO-AUTO part. The engine falls back to the FRENTE choice when ZOCLO
 * is unset, so the line resolves with either; without both the quote accepts
 * (and exports) explode with ResolutionError. This tells the UI when the
 * zoclo still needs a choice the same way the engine sees it.
 */
export function plinthZocloNeedsChoice(
  module: Pick<ModuleLikeForRoles, 'baseMode'>,
  effectiveChoices: Readonly<Record<string, string | undefined>>,
): boolean {
  if (module.baseMode !== 'plinth_board') return false;
  return (
    !effectiveChoices[ZOCLO_BOARD_ROLE]?.trim() &&
    !effectiveChoices['FRENTE']?.trim()
  );
}

function collectUsedOptionRoles(
  module: ModuleLikeForRoles,
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): Set<string> {
  const usedRoles = new Set<string>();
  for (const line of module.hardwareLines) {
    if (line.hardwareId) continue;
    if (line.optionRole?.trim()) usedRoles.add(line.optionRole.trim());
  }
  collectComponentRoles(module.components, catalogComponents, usedRoles);
  collectAgregadoRoles(module.agregados, catalogAgregados, catalogComponents, usedRoles);
  if (module.structureId && catalogStructures && catalogComponents) {
    const structure = catalogStructures.find((s) => s.id === module.structureId);
    collectComponentRoles(structure?.components, catalogComponents, usedRoles);
    collectAgregadoRoles(
      (structure as any)?.agregados,
      catalogAgregados,
      catalogComponents,
      usedRoles,
    );
  }
  // F087 — the base treatment consumes a role even when its part/line is
  // synthesized by the engine (no manual component / hardware line).
  if (module.baseMode === 'plinth_board') usedRoles.add(ZOCLO_BOARD_ROLE);
  if (module.baseMode === 'plinth_strip') usedRoles.add(ZOCLO_STRIP_ROLE);
  if (module.baseMode === 'legs') usedRoles.add(PATAS_ROLE);
  return usedRoles;
}

/**
 * F087 — groups the item picker offers for a module: every group whose code is
 * a used role, required OR optional. Optional groups (ZOCLO material, purchased
 * profile finishes, legs) render with an inherit/default empty option; the
 * price gate still only demands the required ones.
 */
export function selectableGroupCodesForModule(
  module: Parameters<typeof requiredGroupCodesForModule>[0],
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): string[] {
  const usedRoles = collectUsedOptionRoles(
    module,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );
  return optionGroups
    .filter((g) => usedRoles.has(g.code))
    .map((g) => g.code);
}

export const SEED_OPTION_GROUP_CODES = [
  'INTERIOR',
  'FRENTE',
  'BISAGRA',
  'CORREDERA',
] as const;
