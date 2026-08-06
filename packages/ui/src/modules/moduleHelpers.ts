/**
 * Pure module-editor UI helpers — validation, optionRole pickers, edge flags (no cost formulas).
 */

import type {
  BoardPart,
  Component,
  ComponentPlacement,
  EdgeAssignment,
  EdgeSide,
  FurnitureType,
  HardwareLine,
  Module,
  ModuleBaseMode,
  ModuleCategory,
  OptionGroup,
  OptionGroupKind,
  Structure,
} from '@muebles/domain';
import { childrenOf, isModuleBaseMode } from '@muebles/domain';
import {
  matchesCodeOrName,
  normalizeCode,
} from '../catalogs/catalogHelpers';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';

export type BoardPartDraft = {
  id: string;
  code: string;
  description: string;
  quantity: number;
  lengthMm: number;
  widthMm: number;
  edgeL1: boolean;
  edgeL2: boolean;
  edgeW1: boolean;
  edgeW2: boolean;
  optionRole: string;
  lengthFormula?: string;
  widthFormula?: string;
};

export type HardwareLineDraft = {
  id: string;
  quantity: number;
  descriptionOverride: string;
  /** 'role' uses optionRole only; 'fixed' uses hardwareId (+ optionRole FIXED). */
  mode: 'role' | 'fixed';
  optionRole: string;
  hardwareId: string;
};

export interface ComponentInstanceDraft {
  componentId: string;
  quantity: number;
  placementOverride?: string;
  /**
   * Board-editor overrides (gap #1): poses + dimensions edited in the
   * BoardEditor are persisted here so they survive save. The structure matches
   * ModuleComponentInstance.overrides (formulas are stored as literal strings).
   */
  readonly overrides?: {
    readonly lengthFormula?: string;
    readonly widthFormula?: string;
    readonly xFormula?: string;
    readonly yFormula?: string;
    readonly zFormula?: string;
    readonly rotateX?: number;
    readonly rotateY?: number;
    readonly rotateZ?: number;
  };
}

export type MeasurePresetDraft = {
  id: string;
  name: string;
  width: number;
  height: number;
  depth: number;
};

export type ModuleDraft = {
  code: string;
  name: string;
  notes: string;
  /** Optional module category (any depth). Empty string = uncategorized. */
  categoryId: string;
  /** Fundamental furniture type for project measure defaults (#109). */
  furnitureType: FurnitureType;
  /**
   * Floor base: none | plinth_board | plinth_strip | legs.
   * Empty string treated as none.
   */
  baseMode: ModuleBaseMode | '';
  /** Plinth/legs height B (mm) as string for the form. Empty = domain default. */
  baseClearanceMm: string;
  externalWidth: string;
  externalHeight: string;
  externalDepth: string;
  baseLaborCost: string;
  /** Relative media path (F040). */
  imageUrl: string;
  hardwareLines: HardwareLineDraft[];
  /** Structure reference for composed modules. */
  structureId: string;
  /** Component instances for composed modules. */
  components: ComponentInstanceDraft[];
  /** Commercial measure options for sales (H09 / #104). */
  presets: MeasurePresetDraft[];
};

const EDGE_SIDES: readonly EdgeSide[] = ['L1', 'L2', 'W1', 'W2'];

export function emptyModuleDraft(): ModuleDraft {
  return {
    code: '',
    name: '',
    notes: '',
    categoryId: '',
    furnitureType: 'inferior',
    baseMode: '',
    baseClearanceMm: '',
    externalWidth: '',
    externalHeight: '',
    externalDepth: '',
    baseLaborCost: '',
    imageUrl: '',
    hardwareLines: [],
    structureId: '',
    components: [],
    presets: [],
  };
}

export function emptyMeasurePresetDraft(id: string): MeasurePresetDraft {
  return {
    id,
    name: '',
    width: 0,
    height: 0,
    depth: 0,
  };
}

export function emptyBoardPartDraft(id: string): BoardPartDraft {
  return {
    id,
    code: '',
    description: '',
    quantity: 1,
    lengthMm: 0,
    widthMm: 0,
    edgeL1: false,
    edgeL2: false,
    edgeW1: false,
    edgeW2: false,
    optionRole: '',
    lengthFormula: '',
    widthFormula: '',
  };
}

export function emptyHardwareLineDraft(id: string): HardwareLineDraft {
  return {
    id,
    quantity: 1,
    descriptionOverride: '',
    mode: 'role',
    optionRole: '',
    hardwareId: '',
  };
}

export function edgesFromFlags(
  edgeL1: boolean,
  edgeL2: boolean,
  edgeW1: boolean,
  edgeW2: boolean,
): EdgeAssignment[] {
  const flags: Record<EdgeSide, boolean> = {
    L1: edgeL1,
    L2: edgeL2,
    W1: edgeW1,
    W2: edgeW2,
  };
  return EDGE_SIDES.map((side) => ({ side, enabled: flags[side] }));
}

export function flagsFromEdges(edges: readonly EdgeAssignment[]): {
  edgeL1: boolean;
  edgeL2: boolean;
  edgeW1: boolean;
  edgeW2: boolean;
} {
  const map = new Map(edges.map((e) => [e.side, e.enabled]));
  return {
    edgeL1: map.get('L1') ?? false,
    edgeL2: map.get('L2') ?? false,
    edgeW1: map.get('W1') ?? false,
    edgeW2: map.get('W2') ?? false,
  };
}

export function boardPartToDraft(part: BoardPart): BoardPartDraft {
  const flags = flagsFromEdges(part.edges);
  return {
    id: part.id,
    code: part.code ?? '',
    description: part.description,
    quantity: part.quantity,
    lengthMm: part.lengthMm,
    widthMm: part.widthMm,
    ...flags,
    optionRole: part.optionRole,
    lengthFormula: part.lengthFormula ?? '',
    widthFormula: part.widthFormula ?? '',
  };
}

export function hardwareLineToDraft(line: HardwareLine): HardwareLineDraft {
  const hasFixed = Boolean(line.hardwareId?.trim());
  return {
    id: line.id,
    quantity: line.quantity,
    descriptionOverride: line.descriptionOverride ?? '',
    mode: hasFixed ? 'fixed' : 'role',
    optionRole: line.optionRole,
    hardwareId: line.hardwareId ?? '',
  };
}

export function moduleToDraft(mod: Module): ModuleDraft {
  return {
    code: mod.code,
    name: mod.name,
    notes: mod.notes ?? '',
    categoryId: mod.categoryId ?? '',
    furnitureType: mod.furnitureType ?? 'inferior',
    baseMode: mod.baseMode && isModuleBaseMode(mod.baseMode) ? mod.baseMode : '',
    baseClearanceMm:
      mod.baseClearanceMm !== undefined ? String(mod.baseClearanceMm) : '',
    externalWidth: mod.externalDims ? String(mod.externalDims.width) : '',
    externalHeight: mod.externalDims ? String(mod.externalDims.height) : '',
    externalDepth: mod.externalDims ? String(mod.externalDims.depth) : '',
    baseLaborCost:
      mod.baseLaborCost !== undefined ? String(mod.baseLaborCost) : '',
    imageUrl: mod.imageUrl ?? '',
    hardwareLines: mod.hardwareLines.map(hardwareLineToDraft),
    structureId: mod.structureId ?? '',
    components: (mod.components ?? []).map((c) => ({
      componentId: c.componentId,
      quantity: c.quantity,
      placementOverride: c.placementOverride,
      overrides: c.overrides,
    })),
    presets: (mod.presets ?? []).map((p) => ({
      id: p.id,
      name: p.name ?? '',
      width: p.width,
      height: p.height,
      depth: p.depth,
    })),
  };
}

function optionalNotes(notes: string): string | undefined {
  const trimmed = notes.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Map editor draft → domain Module (pure). Used by catalogStore on save and by
 * the live BoardEditor so the canvas follows unsaved structure/components.
 */
export function draftToModule(id: string, draft: ModuleDraft): Module {
  const width = parseOptionalNumber(draft.externalWidth);
  const height = parseOptionalNumber(draft.externalHeight);
  const depth = parseOptionalNumber(draft.externalDepth);
  const hasDims =
    width !== undefined || height !== undefined || depth !== undefined;

  const baseMode =
    draft.baseMode && isModuleBaseMode(draft.baseMode)
      ? draft.baseMode
      : undefined;
  const baseClearanceMm = parseOptionalNumber(draft.baseClearanceMm);

  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    notes: optionalNotes(draft.notes),
    categoryId: draft.categoryId.trim() || undefined,
    furnitureType: draft.furnitureType,
    baseMode,
    ...(baseClearanceMm === undefined ? {} : { baseClearanceMm }),
    baseLaborCost: parseOptionalNumber(draft.baseLaborCost),
    imageUrl: draft.imageUrl.trim() || undefined,
    externalDims: hasDims
      ? {
          width: width ?? 0,
          height: height ?? 0,
          depth: depth ?? 0,
        }
      : undefined,
    hardwareLines: draft.hardwareLines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      descriptionOverride: optionalNotes(l.descriptionOverride),
      optionRole:
        l.mode === 'fixed'
          ? l.optionRole.trim() || 'FIXED'
          : l.optionRole.trim(),
      hardwareId:
        l.mode === 'fixed' && l.hardwareId.trim()
          ? l.hardwareId.trim()
          : undefined,
    })),
    structureId: draft.structureId.trim() || undefined,
    components: draft.components.map((c) => ({
      componentId: c.componentId,
      quantity: c.quantity,
      placementOverride: c.placementOverride
        ? (c.placementOverride as ComponentPlacement)
        : undefined,
      overrides: c.overrides,
    })),
    presets:
      draft.presets.length > 0
        ? draft.presets.map((p) => ({
            id: p.id,
            name: p.name.trim() || undefined,
            width: p.width,
            height: p.height,
            depth: p.depth,
          }))
        : undefined,
  };
}

/**
 * Merge BoardEditor pose/dim overrides into draft components (by componentId).
 * Used on save and when building the live preview Module.
 */
export function mergeBoardOverridesIntoDraft(
  draft: ModuleDraft,
  boardOverrides: Readonly<Record<string, unknown>> | undefined,
): ModuleDraft {
  if (!boardOverrides || Object.keys(boardOverrides).length === 0) {
    return draft;
  }
  return {
    ...draft,
    components: draft.components.map((c) =>
      boardOverrides[c.componentId]
        ? {
            ...c,
            overrides: boardOverrides[
              c.componentId
            ] as ComponentInstanceDraft['overrides'],
          }
        : c,
    ),
  };
}

/**
 * Fingerprint of one instance's formula/rotation overrides (stable string).
 * Used by {@link moduleCompositionKey} so list-editor formula edits re-resolve
 * BOM. Callers should compute the key from the **draft** module (without
 * transient BoardEditor `boardOverrides`) so drag-induced pose overrides do
 * not force a full re-resolve.
 */
export function instanceOverridesKey(
  ov: ComponentInstanceDraft['overrides'] | undefined,
): string {
  if (!ov) return '';
  return [
    ov.lengthFormula ?? '',
    ov.widthFormula ?? '',
    ov.xFormula ?? '',
    ov.yFormula ?? '',
    ov.zFormula ?? '',
    ov.rotateX ?? '',
    ov.rotateY ?? '',
    ov.rotateZ ?? '',
  ].join('~');
}

/**
 * Fingerprint of module fields that affect BOM / 3D composition.
 * Includes per-instance formula/rotation overrides (list editor).
 * Prefer computing this from the draft Module **without** transient
 * boardOverrides so BoardEditor drags do not remount the scratch space.
 */
export function moduleCompositionKey(mod: Module): string {
  const comps = (mod.components ?? [])
    .map(
      (c) =>
        `${c.componentId}:${c.quantity}:${c.placementOverride ?? ''}:${instanceOverridesKey(c.overrides)}`,
    )
    .join(',');
  const d = mod.externalDims;
  const dims = d ? `${d.width}x${d.height}x${d.depth}` : '';
  return `${mod.structureId ?? ''}|${comps}|${dims}`;
}

/** Drop empty override fields; return undefined when nothing remains. */
export function cleanInstanceOverrides(
  ov: ComponentInstanceDraft['overrides'] | undefined,
): ComponentInstanceDraft['overrides'] | undefined {
  if (!ov) return undefined;
  const next: NonNullable<ComponentInstanceDraft['overrides']> = {
    ...(ov.lengthFormula?.trim()
      ? { lengthFormula: ov.lengthFormula.trim() }
      : {}),
    ...(ov.widthFormula?.trim()
      ? { widthFormula: ov.widthFormula.trim() }
      : {}),
    ...(ov.xFormula?.trim() ? { xFormula: ov.xFormula.trim() } : {}),
    ...(ov.yFormula?.trim() ? { yFormula: ov.yFormula.trim() } : {}),
    ...(ov.zFormula?.trim() ? { zFormula: ov.zFormula.trim() } : {}),
    ...(ov.rotateX !== undefined && Number.isFinite(ov.rotateX)
      ? { rotateX: ov.rotateX }
      : {}),
    ...(ov.rotateY !== undefined && Number.isFinite(ov.rotateY)
      ? { rotateY: ov.rotateY }
      : {}),
    ...(ov.rotateZ !== undefined && Number.isFinite(ov.rotateZ)
      ? { rotateZ: ov.rotateZ }
      : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Merge a partial patch into instance overrides (empty strings clear fields). */
export function patchInstanceOverrides(
  current: ComponentInstanceDraft['overrides'] | undefined,
  patch: {
    readonly lengthFormula?: string;
    readonly widthFormula?: string;
    readonly xFormula?: string;
    readonly yFormula?: string;
    readonly zFormula?: string;
    readonly rotateX?: number | null;
    readonly rotateY?: number | null;
    readonly rotateZ?: number | null;
  },
): ComponentInstanceDraft['overrides'] | undefined {
  const base: {
    lengthFormula?: string;
    widthFormula?: string;
    xFormula?: string;
    yFormula?: string;
    zFormula?: string;
    rotateX?: number;
    rotateY?: number;
    rotateZ?: number;
  } = { ...(current ?? {}) };

  if ('lengthFormula' in patch) {
    const v = patch.lengthFormula?.trim() ?? '';
    if (v) base.lengthFormula = v;
    else delete base.lengthFormula;
  }
  if ('widthFormula' in patch) {
    const v = patch.widthFormula?.trim() ?? '';
    if (v) base.widthFormula = v;
    else delete base.widthFormula;
  }
  if ('xFormula' in patch) {
    const v = patch.xFormula?.trim() ?? '';
    if (v) base.xFormula = v;
    else delete base.xFormula;
  }
  if ('yFormula' in patch) {
    const v = patch.yFormula?.trim() ?? '';
    if (v) base.yFormula = v;
    else delete base.yFormula;
  }
  if ('zFormula' in patch) {
    const v = patch.zFormula?.trim() ?? '';
    if (v) base.zFormula = v;
    else delete base.zFormula;
  }
  if ('rotateX' in patch) {
    if (patch.rotateX === null || patch.rotateX === undefined) {
      delete base.rotateX;
    } else {
      base.rotateX = patch.rotateX;
    }
  }
  if ('rotateY' in patch) {
    if (patch.rotateY === null || patch.rotateY === undefined) {
      delete base.rotateY;
    } else {
      base.rotateY = patch.rotateY;
    }
  }
  if ('rotateZ' in patch) {
    if (patch.rotateZ === null || patch.rotateZ === undefined) {
      delete base.rotateZ;
    } else {
      base.rotateZ = patch.rotateZ;
    }
  }

  return cleanInstanceOverrides(base);
}

/** One-line summary for the advanced disclosure header. */
export function instanceOverridesSummary(
  ov: ComponentInstanceDraft['overrides'] | undefined,
): string {
  if (!ov) return 'automático';
  const parts: string[] = [];
  if (ov.lengthFormula) parts.push(`L=${ov.lengthFormula}`);
  if (ov.widthFormula) parts.push(`W=${ov.widthFormula}`);
  if (ov.xFormula) parts.push(`X=${ov.xFormula}`);
  if (ov.yFormula) parts.push(`Y=${ov.yFormula}`);
  if (ov.zFormula) parts.push(`Z=${ov.zFormula}`);
  if (ov.rotateX !== undefined) parts.push(`rX=${ov.rotateX}°`);
  if (ov.rotateY !== undefined) parts.push(`rY=${ov.rotateY}°`);
  if (ov.rotateZ !== undefined) parts.push(`rZ=${ov.rotateZ}°`);
  return parts.length > 0 ? parts.join(' · ') : 'automático';
}

/**
 * Picker for board-part optionRole: prefer kind=board groups; include edge groups if present.
 */
export function optionGroupsForBoardParts(
  groups: readonly OptionGroup[],
): OptionGroup[] {
  return groups.filter((g) => g.kind === 'board' || g.kind === 'edge');
}

/** Picker for hardware-line optionRole: only hardware groups. */
export function optionGroupsForHardware(
  groups: readonly OptionGroup[],
): OptionGroup[] {
  return groups.filter((g) => g.kind === 'hardware');
}

export function optionGroupsByKind(
  groups: readonly OptionGroup[],
  kind: OptionGroupKind,
): OptionGroup[] {
  return groups.filter((g) => g.kind === kind);
}

export function findModuleCodeConflict(
  code: string,
  modules: readonly Module[],
  excludeId?: string,
): Module | undefined {
  const normalized = normalizeCode(code);
  if (!normalized) return undefined;
  return modules.find(
    (m) => m.id !== excludeId && normalizeCode(m.code) === normalized,
  );
}

export function validateModuleCode(
  code: string,
  modules: readonly Module[],
  excludeId?: string,
): string | null {
  const trimmed = code.trim();
  if (!trimmed) {
    return 'El código es obligatorio.';
  }
  const conflict = findModuleCodeConflict(trimmed, modules, excludeId);
  if (conflict) {
    return `Ya existe un mueble con el código "${conflict.code}".`;
  }
  return null;
}

export function suggestPartCode(moduleCode: string, index1Based: number): string {
  const base = moduleCode.trim() || 'MOD';
  return `${base}-P${String(index1Based).padStart(2, '0')}`;
}

export function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/** Module shape needed to discover which option-group roles it uses. */
export type ModuleRolesSource = {
  readonly components?: readonly { readonly componentId: string }[];
  readonly structureId?: string;
  readonly hardwareLines?: readonly {
    readonly optionRole: string;
    readonly hardwareId?: string;
  }[];
};

/**
 * Option-group codes referenced by the module (component optionRoles +
 * variable hardware lines). Pure — no pricing.
 */
export function usedOptionRolesForModule(
  module: ModuleRolesSource,
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
): Set<string> {
  const usedRoles = new Set<string>();
  for (const line of module.hardwareLines ?? []) {
    if (line.hardwareId) continue;
    if (line.optionRole?.trim()) usedRoles.add(line.optionRole.trim());
  }
  if (module.components && catalogComponents) {
    for (const inst of module.components) {
      const comp = catalogComponents.find((c) => c.id === inst.componentId);
      if (comp) {
        for (const role of comp.optionRoles) {
          if (role.trim()) usedRoles.add(role.trim());
        }
      }
    }
  }
  if (module.structureId && catalogStructures && catalogComponents) {
    const structure = catalogStructures.find((s) => s.id === module.structureId);
    if (structure) {
      for (const inst of structure.components ?? []) {
        const comp = catalogComponents.find((c) => c.id === inst.componentId);
        if (comp) {
          for (const role of comp.optionRoles) {
            if (role.trim()) usedRoles.add(role.trim());
          }
        }
      }
    }
  }
  return usedRoles;
}

/**
 * Default option choices for cost/3D preview: first member of each group used
 * by the module. Pure selection helper — does not compute prices.
 */
export function defaultOptionChoicesForModule(
  module: ModuleRolesSource,
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
): Record<string, string> {
  const usedRoles = usedOptionRolesForModule(
    module,
    catalogComponents,
    catalogStructures,
  );

  const choices: Record<string, string> = {};
  for (const group of optionGroups) {
    if (!usedRoles.has(group.code)) continue;
    const first = group.optionIds[0];
    if (first) {
      choices[group.code] = first;
    }
  }
  return choices;
}

/** One selectable material/finish for a board option group in 3D preview. */
export type BoardFinishPickerOption = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly previewColor?: string;
  readonly grainDefault: boolean;
};

/** Board option group (INTERIOR, FRENTE, …) with its catalog members. */
export type BoardFinishPickerGroup = {
  readonly code: string;
  readonly name: string;
  readonly options: readonly BoardFinishPickerOption[];
};

/**
 * Board finish groups used by the module, for 3D preview material pickers.
 * Only `kind === 'board'` groups with at least one known material.
 */
export function boardFinishPickerGroupsForModule(
  module: ModuleRolesSource,
  optionGroups: readonly OptionGroup[],
  materials: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly previewColor?: string;
    readonly grainDefault: boolean;
    readonly active?: boolean;
  }[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
): BoardFinishPickerGroup[] {
  const usedRoles = usedOptionRolesForModule(
    module,
    catalogComponents,
    catalogStructures,
  );
  const byId = new Map(materials.map((m) => [m.id, m]));
  const result: BoardFinishPickerGroup[] = [];

  for (const group of optionGroups) {
    if (group.kind !== 'board') continue;
    if (!usedRoles.has(group.code)) continue;
    const options: BoardFinishPickerOption[] = [];
    for (const id of group.optionIds) {
      const mat = byId.get(id);
      if (!mat) continue;
      if (mat.active === false) continue;
      options.push({
        id: mat.id,
        code: mat.code,
        name: mat.name,
        previewColor: mat.previewColor,
        grainDefault: mat.grainDefault,
      });
    }
    if (options.length === 0) continue;
    result.push({
      code: group.code,
      name: group.name,
      options,
    });
  }
  return result;
}

export const SEED_MODULE_CODES = ['MOD-GAB-01', 'MOD-CAJ-01'] as const;

/**
 * Client-side search for module cards (code + name, case-insensitive).
 * Pure — no domain cost logic.
 */
export function filterModulesByQuery(
  modules: readonly Module[],
  query: string,
): Module[] {
  const q = query.trim().toLocaleLowerCase('es-UY');
  if (!q) return [...modules];
  return modules.filter((m) =>
    matchesCodeOrName({ code: m.code, name: m.name }, q),
  );
}

export type CategoryDraft = {
  name: string;
  parentId: string;
  sortOrder: string;
};

export function emptyCategoryDraft(): CategoryDraft {
  return { name: '', parentId: '', sortOrder: '0' };
}

/** Flat indented labels for parent picker / admin lists (DFS by sortOrder). */
export function flattenCategoriesForSelect(
  categories: readonly ModuleCategory[],
): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const c of childrenOf(categories, parentId)) {
      const indent = depth > 0 ? `${'—'.repeat(depth)} ` : '';
      out.push({ id: c.id, label: `${indent}${c.name}`, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** Format module money for display — shared formatMoneyDisplay (#51). */
export function formatModuleMoney(n: number | null | undefined): string {
  return formatMoneyDisplay(n);
}

/** Field keys for piece numeric capture path (qty → L → A). */
export const MODULE_PART_GRID_FIELDS = ['qty', 'length', 'width'] as const;
export type ModulePartGridField = (typeof MODULE_PART_GRID_FIELDS)[number];

/**
 * Resolve next focus target for Enter in a modular grid (issue #39 / F033).
 * Enter on a field moves to the same field on the next row.
 * On the last row, signals `addRow` so the UI can append a row.
 */
export function nextGridEnterTarget(input: {
  readonly rowIds: readonly string[];
  readonly currentRowId: string;
  readonly field: string;
}):
  | { readonly kind: 'focus'; readonly rowId: string; readonly field: string }
  | { readonly kind: 'addRow'; readonly field: string }
  | null {
  const { rowIds, currentRowId, field } = input;
  if (rowIds.length === 0 || !field) return null;
  const index = rowIds.indexOf(currentRowId);
  if (index < 0) return null;
  if (index < rowIds.length - 1) {
    return { kind: 'focus', rowId: rowIds[index + 1]!, field };
  }
  return { kind: 'addRow', field };
}

/** DOM id for a part grid input (shared by editor + keyboard nav). */
export function modulePartGridInputId(
  partId: string,
  field: ModulePartGridField | 'code' | 'desc' | 'role',
): string {
  switch (field) {
    case 'code':
      return `part-code-${partId}`;
    case 'desc':
      return `part-desc-${partId}`;
    case 'qty':
      return `part-qty-${partId}`;
    case 'length':
      return `part-l-${partId}`;
    case 'width':
      return `part-w-${partId}`;
    case 'role':
      return `part-role-${partId}`;
    default:
      return `part-${field}-${partId}`;
  }
}

export function moduleHardwareGridInputId(
  lineId: string,
  field: 'qty' | 'mode' | 'role' | 'desc',
): string {
  switch (field) {
    case 'qty':
      return `hw-qty-${lineId}`;
    case 'mode':
      return `hw-mode-${lineId}`;
    case 'role':
      return `hw-role-${lineId}`;
    case 'desc':
      return `hw-desc-${lineId}`;
    default:
      return `hw-${field}-${lineId}`;
  }
}
