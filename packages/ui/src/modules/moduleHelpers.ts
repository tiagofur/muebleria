/**
 * Pure module-editor UI helpers — validation, optionRole pickers, edge flags (no cost formulas).
 */

import type {
  BoardPart,
  EdgeAssignment,
  EdgeSide,
  HardwareLine,
  Module,
  ModuleCategory,
  OptionGroup,
  OptionGroupKind,
} from '@muebles/domain';
import { childrenOf } from '@muebles/domain';
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
    boardParts: [],
    hardwareLines: [],
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
