/**
 * Pure project/quotation option pickers, choices and price preview gates (no cost formulas).
 */

import type {
  Agregado,
  Catalog,
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  ModuleBaseMode,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  Structure,
} from '@muebles/domain';
import {
  calcProjectBreakdown,
  effectiveOptionChoices,
} from '@muebles/domain';
import {
  canShowPricePreview,
  membersForKind,
  requiredGroupCodesForModule,
  selectableGroupCodesForModule,
  type CatalogMember,
  type PricePreviewGateResult,
} from '../../optionGroups/optionGroupHelpers';

/**
 * OPT-04 / PRJ-03: option picker values for a group — only group members (by kind + optionIds).
 * Empty optionIds → no catalog-wide dump (strict group membership).
 */
export function optionsForGroup(
  group: OptionGroup,
  catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  },
): CatalogMember[] {
  const members = membersForKind(group.kind, catalogs);
  if (group.optionIds.length === 0) {
    return [];
  }
  const allowed = new Set(group.optionIds);
  return members.filter((m) => allowed.has(m.id));
}

/**
 * PRJ-03 + F087: option groups offered for this module — required groups for
 * used roles plus optional ones (ZOCLO material, purchased profile, legs)
 * whose role the module (or the item's base-mode override) consumes.
 */
export function groupsForModuleItem(
  module: Module | undefined,
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
  /** Item-level base-mode override (F087) — synthesized roles count as used. */
  baseModeOverride?: ModuleBaseMode,
): OptionGroup[] {
  if (!module) return [];
  const effectiveModule =
    baseModeOverride !== undefined
      ? { ...module, baseMode: baseModeOverride }
      : module;
  const codes = selectableGroupCodesForModule(
    effectiveModule,
    optionGroups,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );
  const byCode = new Map(optionGroups.map((g) => [g.code, g]));
  return codes
    .map((code) => byCode.get(code))
    .filter((g): g is OptionGroup => g !== undefined);
}

/**
 * Gate for whole-project price preview: every item must satisfy required choices.
 * Uses effective resolution (project defaults + line overrides) — F029 / #35.
 */
export function canShowProjectPricePreview(
  project: Project,
  modules: readonly Module[],
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): PricePreviewGateResult {
  const missing = new Set<string>();
  const byId = new Map(modules.map((m) => [m.id, m]));

  for (const item of project.items) {
    const mod = byId.get(item.moduleId);
    if (!mod) {
      missing.add(`módulo:${item.moduleId}`);
      continue;
    }
    const required = requiredGroupCodesForModule(
      mod,
      optionGroups,
      catalogComponents,
      catalogStructures,
      catalogAgregados,
    );
    const effective = effectiveOptionChoices(
      item.optionChoices,
      project.projectLevelChoices,
    );
    const gate = canShowPricePreview(required, effective);
    if (!gate.ok) {
      for (const code of gate.missingGroups) {
        missing.add(code);
      }
    }
  }

  if (missing.size === 0) {
    return { ok: true, missingGroups: [] };
  }
  return { ok: false, missingGroups: [...missing] };
}

/**
 * Label for a catalog option id within a group (UI display).
 */
export function optionLabelForId(
  optionId: string,
  group: OptionGroup,
  catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  },
): string {
  const opt = optionsForGroup(group, catalogs).find((o) => o.id === optionId);
  return opt ? `${opt.name} — ${opt.code}` : optionId;
}

/** Visual chip swatch for presentation options (board finishes). */
export type OptionSwatch =
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'edge' }
  | { readonly kind: 'hardware' }
  | null;

/**
 * Resolve a presentation swatch for a chosen option id.
 * Boards: previewColor or imageUrl; edges/hardware: typed marker.
 */
export function optionSwatchForId(
  optionId: string,
  group: OptionGroup,
  catalogs: {
    readonly materials: readonly MaterialBoard[];
    readonly edges: readonly EdgeBand[];
    readonly hardware: readonly Hardware[];
  },
  resolveMediaUrl?: (url: string | undefined) => string | undefined,
): OptionSwatch {
  if (group.kind === 'board') {
    const mat = catalogs.materials.find((m) => m.id === optionId);
    if (!mat) return null;
    const color = mat.previewColor?.trim();
    if (color) return { kind: 'color', color };
    const img = resolveMediaUrl
      ? resolveMediaUrl(mat.imageUrl)
      : mat.imageUrl?.trim() || undefined;
    if (img) return { kind: 'image', src: img };
    return null;
  }
  if (group.kind === 'edge') {
    return catalogs.edges.some((e) => e.id === optionId) ? { kind: 'edge' } : null;
  }
  if (group.kind === 'hardware') {
    return catalogs.hardware.some((h) => h.id === optionId)
      ? { kind: 'hardware' }
      : null;
  }
  return null;
}

/**
 * Approximate sale price for a single quote line (item × qty).
 * Uses domain calc with laborFixedCost=0 so the line is comparable in the
 * spatial studio inspector — not a formal invoice split of MO fija.
 */
export function estimateLineSalePrice(
  project: Project,
  itemId: string,
  catalog: Catalog,
): number | null {
  const item = project.items.find((i) => i.id === itemId);
  if (!item) return null;
  try {
    const lineProject: Project = {
      ...project,
      items: [item],
      laborFixedCost: 0,
      priceSnapshot: undefined,
    };
    return calcProjectBreakdown(lineProject, catalog).salePrice;
  } catch {
    return null;
  }
}

/**
 * Empty string key means inherit project default (F029).
 * Returns a new OptionChoices without empty keys.
 */
export function setItemOptionChoice(
  current: OptionChoices,
  groupCode: string,
  optionId: string,
): OptionChoices {
  const next: Record<string, string> = { ...current };
  if (!optionId.trim()) {
    delete next[groupCode];
  } else {
    next[groupCode] = optionId;
  }
  return next;
}

/**
 * Patch project-level defaults; empty optionId removes the key.
 */
export function setProjectLevelChoice(
  current: OptionChoices | undefined,
  groupCode: string,
  optionId: string,
): OptionChoices {
  const next: Record<string, string> = { ...(current ?? {}) };
  if (!optionId.trim()) {
    delete next[groupCode];
  } else {
    next[groupCode] = optionId;
  }
  return next;
}

/** Find module by id (UI label helper). */
export function findModuleById(
  modules: readonly Module[],
  moduleId: string,
): Module | undefined {
  return modules.find((m) => m.id === moduleId);
}

/**
 * Build default choices for a new line item from module required groups (first option each).
 * Pure selection — does not compute prices. Does not mutate Module (PRJ-09).
 */
export function defaultChoicesForNewItem(
  module: Module,
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): OptionChoices {
  const required = requiredGroupCodesForModule(
    module,
    optionGroups,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );
  const byCode = new Map(optionGroups.map((g) => [g.code, g]));
  const choices: Record<string, string> = {};
  for (const code of required) {
    const group = byCode.get(code);
    const first = group?.optionIds[0];
    if (first) {
      choices[code] = first;
    }
  }
  return choices;
}

/** PRJ-10: two ProjectItems may share the same moduleId with different optionChoices. */
export function countItemsWithModule(
  items: readonly ProjectItem[],
  moduleId: string,
): number {
  return items.filter((i) => i.moduleId === moduleId).length;
}
