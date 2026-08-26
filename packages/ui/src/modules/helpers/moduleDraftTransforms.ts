/**
 * Module draft types and bidirectional domain <-> draft transforms.
 */

import type {
  BoardPart,
  ComponentPlacement,
  EdgeAssignment,
  EdgeSide,
  FurnitureType,
  HardwareLine,
  HardwarePlacement,
  Module,
  ModuleAgregadoInstance,
  ModuleBaseMode,
} from '@granete/domain';
import {
  isModuleBaseMode,
} from '@granete/domain';
import { parseOptionalNumber } from './moduleValidation';

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
   * Board-editor overrides: poses + dimensions edited in the
   * BoardEditor are persisted here so they survive save.
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
    readonly hardwarePlacements?: readonly HardwarePlacement[];
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
  /** Sub-assembly instances placed directly on this module (doors, drawers, …). */
  agregados: ModuleAgregadoInstance[];
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
    agregados: [],
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
    agregados: [...(mod.agregados ?? [])],
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
 * Map editor draft → domain Module (pure).
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
    hardwareLines: (draft.hardwareLines ?? []).map((l) => ({
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
    structureId: (draft.structureId ?? '').trim() || undefined,
    components: (draft.components ?? []).map((c) => ({
      componentId: c.componentId,
      quantity: c.quantity,
      placementOverride: c.placementOverride
        ? (c.placementOverride as ComponentPlacement)
        : undefined,
      overrides: c.overrides,
    })),
    agregados:
      (draft.agregados ?? []).length > 0 ? [...draft.agregados] : undefined,
    presets:
      (draft.presets ?? []).length > 0
        ? (draft.presets ?? []).map((p) => ({
            id: p.id,
            name: p.name.trim() || undefined,
            width: p.width,
            height: p.height,
            depth: p.depth,
          }))
        : undefined,
  };
}
