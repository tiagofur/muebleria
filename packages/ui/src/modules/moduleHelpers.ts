/**
 * Pure module-editor UI helpers — validation, optionRole pickers, edge flags (no cost formulas).
 */

import type {
  BoardFace,
  BoardPart,
  DimensionPreset,
  EdgeAssignment,
  EdgeSide,
  HardwareLine,
  Module,
  ModuleCategory,
  OptionGroup,
  OptionGroupKind,
  PlacementSlot,
} from '@muebles/domain';
import { childrenOf, isBoardFace, isPlacementSlot } from '@muebles/domain';
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
  /** S1 spatial — empty string = unset */
  face: string;
  placement: string;
  originXFormula: string;
  originYFormula: string;
  originZFormula: string;
  designThicknessMm: string;
};

export type ModuleComponentRefDraft = {
  componentId: string;
  quantity: number;
  placement: string;
  originXFormula: string;
  originYFormula: string;
  originZFormula: string;
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
  externalWidth: string;
  externalHeight: string;
  externalDepth: string;
  baseLaborCost: string;
  /** Relative media path (F040). */
  imageUrl: string;
  /** Engineering body for composed furniture (H07/H09). */
  structureId: string;
  /** Commercial measure options for sales (H09 / #104). */
  presets: MeasurePresetDraft[];
  /** Attached reusable components (H07 / #102 + S1 spatial overrides). */
  components: ModuleComponentRefDraft[];
  boardParts: BoardPartDraft[];
  hardwareLines: HardwareLineDraft[];
};

const EDGE_SIDES: readonly EdgeSide[] = ['L1', 'L2', 'W1', 'W2'];

export function emptyModuleDraft(): ModuleDraft {
  return {
    code: '',
    name: '',
    notes: '',
    categoryId: '',
    externalWidth: '',
    externalHeight: '',
    externalDepth: '',
    baseLaborCost: '',
    imageUrl: '',
    structureId: '',
    presets: [],
    components: [],
    boardParts: [],
    hardwareLines: [],
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

export function formatMeasurePresetLabel(preset: {
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}): string {
  const dims = `${preset.width}×${preset.height}×${preset.depth} mm`;
  const name = preset.name?.trim();
  return name ? `${name} (${dims})` : dims;
}

export function presetsToDomain(
  presets: readonly MeasurePresetDraft[],
): DimensionPreset[] | undefined {
  if (presets.length === 0) return undefined;
  return presets.map((p) => ({
    id: p.id,
    name: p.name.trim() || undefined,
    width: p.width,
    height: p.height,
    depth: p.depth,
  }));
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
    face: '',
    placement: '',
    originXFormula: '',
    originYFormula: '',
    originZFormula: '',
    designThicknessMm: '',
  };
}

export function emptyModuleComponentRefDraft(
  componentId = '',
): ModuleComponentRefDraft {
  return {
    componentId,
    quantity: 1,
    placement: '',
    originXFormula: '',
    originYFormula: '',
    originZFormula: '',
  };
}

/** Map draft spatial fields onto a domain BoardPart (omits empties). */
export function spatialFieldsFromDraft(p: BoardPartDraft): {
  face?: BoardFace;
  placement?: PlacementSlot;
  originXFormula?: string;
  originYFormula?: string;
  originZFormula?: string;
  designThicknessMm?: number;
} {
  const face = p.face.trim();
  const placement = p.placement.trim();
  const designT = Number(p.designThicknessMm);
  return {
    face: isBoardFace(face) ? face : undefined,
    placement: isPlacementSlot(placement) ? placement : undefined,
    originXFormula: p.originXFormula.trim() || undefined,
    originYFormula: p.originYFormula.trim() || undefined,
    originZFormula: p.originZFormula.trim() || undefined,
    designThicknessMm:
      Number.isFinite(designT) && designT > 0 ? designT : undefined,
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
    face: part.face ?? '',
    placement: part.placement ?? '',
    originXFormula: part.originXFormula ?? '',
    originYFormula: part.originYFormula ?? '',
    originZFormula: part.originZFormula ?? '',
    designThicknessMm:
      part.designThicknessMm && part.designThicknessMm > 0
        ? String(part.designThicknessMm)
        : '',
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
    externalWidth: mod.externalDims ? String(mod.externalDims.width) : '',
    externalHeight: mod.externalDims ? String(mod.externalDims.height) : '',
    externalDepth: mod.externalDims ? String(mod.externalDims.depth) : '',
    baseLaborCost:
      mod.baseLaborCost !== undefined ? String(mod.baseLaborCost) : '',
    imageUrl: mod.imageUrl ?? '',
    structureId: mod.structureId ?? '',
    presets: (mod.presets ?? []).map((p) => ({
      id: p.id,
      name: p.name ?? '',
      width: p.width,
      height: p.height,
      depth: p.depth,
    })),
    components: (mod.components ?? []).map((c) => ({
      componentId: c.componentId,
      quantity: c.quantity,
      placement: c.placement ?? '',
      originXFormula: c.originXFormula ?? '',
      originYFormula: c.originYFormula ?? '',
      originZFormula: c.originZFormula ?? '',
    })),
    boardParts: mod.boardParts.map(boardPartToDraft),
    hardwareLines: mod.hardwareLines.map(hardwareLineToDraft),
  };
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

/**
 * Default option choices for cost preview: first member of each required group used by the module.
 * Pure selection helper — does not compute prices.
 */
export function defaultOptionChoicesForModule(
  module: {
    readonly boardParts: readonly { readonly optionRole: string }[];
    readonly hardwareLines: readonly {
      readonly optionRole: string;
      readonly hardwareId?: string;
    }[];
  },
  optionGroups: readonly OptionGroup[],
): Record<string, string> {
  const usedRoles = new Set<string>();
  for (const part of module.boardParts) {
    if (part.optionRole?.trim()) usedRoles.add(part.optionRole.trim());
  }
  for (const line of module.hardwareLines) {
    if (line.hardwareId) continue;
    if (line.optionRole?.trim()) usedRoles.add(line.optionRole.trim());
  }

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
