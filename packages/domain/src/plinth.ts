/**
 * Plinth / toe-kick (zoclo) and legs — base of floor cabinets.
 *
 * Modes:
 * - none: no base parts
 * - plinth_board: melamine strip component(s), option role ZOCLO (fallback FRENTE);
 *   when the module carries no ZOCLO component, the engine synthesizes the
 *   part (F087) so choosing the mode is enough
 * - plinth_strip: purchased profile (plastic/aluminium), hardware per linear
 *   meter — the profile is the user's catalog choice for role ZOCLO_PERFIL
 *   (aluminio / bronce / negro / …), also synthesized when missing
 * - legs: hardware feet / levelers, quantity suggested from the width
 */

import type {
  BoardPart,
  Catalog,
  Component,
  FurnitureType,
  HardwareLine,
  Module,
  ModuleComponentInstance,
  ModuleBaseMode,
  Project,
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from './types';
import {
  DEFAULT_BASE_CLEARANCE_MM,
  isFreePlacement,
  resolveBaseClearanceMm,
} from './kitchenLayout';
import { resolveModuleMeasurePreset } from './measurePresets';
import { suggestLegCount } from './workshopRules';

/** Board option role for melamine plinth parts. Fallback material: FRENTE. */
export const ZOCLO_BOARD_ROLE = 'ZOCLO';

/** Hardware option role for purchased plinth profiles (ml). */
export const ZOCLO_STRIP_ROLE = 'ZOCLO_PERFIL';

/** Hardware option role for legs / levelers. */
export const PATAS_ROLE = 'PATAS';

/** Front finish role used when ZOCLO board choice is missing. */
export const ZOCLO_BOARD_FALLBACK_ROLE = 'FRENTE';

const BASE_MODES = new Set<ModuleBaseMode>([
  'none',
  'plinth_board',
  'plinth_strip',
  'legs',
]);

export function isModuleBaseMode(value: unknown): value is ModuleBaseMode {
  return typeof value === 'string' && BASE_MODES.has(value as ModuleBaseMode);
}

/**
 * Resolve base mode. Explicit module.baseMode wins.
 * Unset → none (existing modules stay BOM-stable).
 */
export function resolveModuleBaseMode(
  module: Pick<Module, 'baseMode' | 'furnitureType'>,
): ModuleBaseMode {
  if (module.baseMode && isModuleBaseMode(module.baseMode)) {
    return module.baseMode;
  }
  return 'none';
}

/**
 * Plinth / legs height B (mm) for formulas and 3D clearance.
 * Only meaningful when mode is not `none`.
 */
export function resolveModuleBaseClearanceMm(
  module: Pick<Module, 'baseMode' | 'baseClearanceMm' | 'furnitureType'>,
  overrideMm?: number,
): number {
  if (overrideMm !== undefined && Number.isFinite(overrideMm)) {
    return Math.max(0, Math.round(overrideMm));
  }
  const mode = resolveModuleBaseMode(module);
  if (mode === 'none') return 0;
  if (
    module.baseClearanceMm !== undefined &&
    Number.isFinite(module.baseClearanceMm)
  ) {
    return Math.max(0, Math.round(module.baseClearanceMm));
  }
  return DEFAULT_BASE_CLEARANCE_MM;
}

/** Material choice for a board part role; ZOCLO inherits FRENTE when empty. */
export function resolveBoardOptionChoiceId(
  optionRole: string,
  optionChoices: { readonly [code: string]: string | undefined },
): string | undefined {
  const direct = optionChoices[optionRole]?.trim();
  if (direct) return direct;
  if (optionRole === ZOCLO_BOARD_ROLE) {
    const front = optionChoices[ZOCLO_BOARD_FALLBACK_ROLE]?.trim();
    if (front) return front;
  }
  const roleUpper = optionRole.trim().toUpperCase();
  if (
    roleUpper === 'PUERTA' ||
    roleUpper.startsWith('PUERTA_') ||
    roleUpper === 'FRENTE_CAJON'
  ) {
    const front = optionChoices['FRENTE']?.trim();
    if (front) return front;
  }
  return undefined;
}

export function isZocloBoardRole(optionRole: string): boolean {
  return optionRole.trim() === ZOCLO_BOARD_ROLE;
}

export function isZocloStripRole(optionRole: string): boolean {
  return optionRole.trim() === ZOCLO_STRIP_ROLE;
}

export function isPatasRole(optionRole: string): boolean {
  return optionRole.trim() === PATAS_ROLE;
}

/**
 * Frontal plinth length in meters (W mm → ml).
 * lineFactor multiplies (e.g. 1 = front only; 1.2 ≈ front + returns).
 */
export function plinthStripMeters(
  widthMm: number,
  lineFactor = 1,
): number {
  const w = Math.max(0, widthMm);
  const factor = Number.isFinite(lineFactor) && lineFactor > 0 ? lineFactor : 1;
  // Keep 3 decimals for ml pricing without flooding floats.
  return Math.round((w / 1000) * factor * 1000) / 1000;
}

export function filterComponentInstancesForBaseMode(
  instances: readonly ModuleComponentInstance[],
  components: readonly Component[] | undefined,
  mode: ModuleBaseMode,
): ModuleComponentInstance[] {
  const byId = new Map((components ?? []).map((c) => [c.id, c]));
  return instances.filter((inst) => {
    const c = byId.get(inst.componentId);
    const role = c?.optionRoles[0]?.trim() ?? '';
    if (isZocloBoardRole(role)) return mode === 'plinth_board';
    return true;
  });
}

/**
 * Filter + rewrite hardware lines for the active base mode.
 * - ZOCLO_PERFIL: only in plinth_strip; quantity becomes ml from width
 * - PATAS: in legs, plinth_board and plinth_strip (legs always support
 *   floor cabinets; the plinth/strip just covers them); quantity uses
 *   suggestLegCount when line.quantity is 0/placeholder
 */
export function applyBaseModeToHardwareLines(
  lines: readonly HardwareLine[],
  mode: ModuleBaseMode,
  widthMm: number,
): HardwareLine[] {
  /** Modes where adjustable legs are present under the cabinet. */
  const legsActive = mode === 'legs' || mode === 'plinth_board' || mode === 'plinth_strip';
  const out: HardwareLine[] = [];
  for (const line of lines) {
    const role = line.optionRole?.trim() ?? '';
    if (isZocloStripRole(role)) {
      if (mode !== 'plinth_strip') continue;
      const factor = line.quantity > 0 ? line.quantity : 1;
      out.push({
        ...line,
        quantity: plinthStripMeters(widthMm, factor),
        descriptionOverride:
          line.descriptionOverride?.trim() ||
          'Zoclo perfil (ml)',
      });
      continue;
    }
    if (isPatasRole(role)) {
      if (!legsActive) continue;
      const qty =
        line.quantity > 0 ? line.quantity : suggestLegCount(widthMm);
      out.push({ ...line, quantity: qty });
      continue;
    }
    out.push(line);
  }
  return out;
}

// ─── F087 — Zócalo como terminación automática ─────────────────────────────

/**
 * Base treatment a new project line gets when it is added (F087).
 * Floor units (inferior / despensa-alto) get a melamine plinth inheriting the
 * front finish; wall units get none. The user can change it per item later.
 */
export function defaultBaseModeForFurnitureType(
  furnitureType?: FurnitureType,
): ModuleBaseMode {
  return furnitureType === 'superior' ? 'none' : 'plinth_board';
}

/** Base-mode + height context an engine receives for a quote line (F087). */
export interface BaseResolutionContext {
  /** Item-level override of the catalog module's baseMode. */
  readonly baseMode?: ModuleBaseMode;
  /** Effective plinth height B (mm), normally resolved from the plan. */
  readonly baseClearanceMm?: number;
  /**
   * Exposed plinth sides for the line's plan placement (F088). Omitted when
   * the item is unplaced — engines then add no side returns.
   */
  readonly plinthSides?: PlinthSides;
  /**
   * Wall-run context for front plinth merging (F089).
   * - `isRunAnchor: true`  → this item generates the merged front plinth for the whole run.
   * - `isRunAnchor: false` → another item in the same run is the anchor; skip the front piece.
   * - Absent                → no run context available; each cabinet generates its own plinth.
   */
  readonly plinthRun?: PlinthRunInfo;
}

/**
 * Per-item run information for wall-run front plinth merging (F089).
 * The first (leftmost) item in a contiguous run of floor cabinets is the
 * "anchor": it generates ONE front plinth piece that covers the entire run.
 * All other items in the same run skip the front piece.
 */
export interface PlinthRunInfo {
  /** True only for the first item in the contiguous run. */
  readonly isRunAnchor: boolean;
  /**
   * Total combined width of all cabinets in this run (mm).
   * Only meaningful (and set) when `isRunAnchor` is true.
   */
  readonly runFrontWidthMm?: number;
}

/** Which zócalo sides are visible (need a return). Back = islands / free. */
export interface PlinthSides {
  readonly left: boolean;
  readonly right: boolean;
  readonly back: boolean;
}

/** Gap under which a neighbor / wall end counts as covering a side (mm). */
export const PLINTH_SIDE_GAP_MM = 30;

/** Front recess of the toe-kick: the return wraps this much less than D. */
export function plinthReturnDepthMm(cabinetDepthMm: number): number {
  const recess = Math.min(50, Math.max(20, cabinetDepthMm * 0.1));
  return Math.max(50, Math.round(cabinetDepthMm - recess));
}

/**
 * F088 — exposed plinth sides for a placement. A side needs a return when
 * nothing covers it: no neighboring cabinet on the same wall within the gap
 * tolerance, and not against a wall end. Free placements (islands) expose
 * left, right and back.
 */
export function plinthSidesForPlacement(
  layout: Pick<ProjectKitchenLayout, 'walls' | 'placements'>,
  placement: ProjectItemPlacement,
  /** Plan width (mm) per item id — used for neighbor footprints. */
  widthOf: (itemId: string) => number | undefined,
): PlinthSides {
  if (isFreePlacement(placement)) {
    return { left: true, right: true, back: true };
  }
  const wall = layout.walls.find((w) => w.id === placement.wallId);
  const onWall = layout.placements
    .filter(
      (p) =>
        p.wallId === placement.wallId &&
        p.itemId !== placement.itemId &&
        !isFreePlacement(p),
    )
    .map((p) => {
      const w = widthOf(p.itemId) ?? 600;
      return { start: p.offsetMm, end: p.offsetMm + w };
    });

  const width = widthOf(placement.itemId) ?? 600;
  const start = placement.offsetMm;
  const end = start + width;
  const tol = PLINTH_SIDE_GAP_MM;

  const coveredByNeighbor = (from: number, to: number) =>
    onWall.some((f) => f.start < to && f.end > from);
  const wallLength = wall?.lengthMm ?? Number.POSITIVE_INFINITY;

  return {
    left: !coveredByNeighbor(start - tol, start) && start > tol,
    right:
      !coveredByNeighbor(end, end + tol) && end < wallLength - tol,
    back: false,
  };
}

/**
 * F089 — Compute per-item run context for front plinth merging.
 *
 * Groups floor-cabinet placements on the same wall into contiguous runs
 * (gap ≤ PLINTH_SIDE_GAP_MM). The leftmost item in each run is the
 * "anchor" and generates the merged front plinth; all others skip it.
 *
 * Returns a Map from itemId → PlinthRunInfo. Items without a wall
 * placement (or free placements / islands) are absent from the map and
 * each generates their own individual plinth as before.
 *
 * @param layout  Kitchen plan layout (walls + placements).
 * @param items   All quote items with their ids.
 * @param widthOf Resolves the plan footprint width (mm) for a given itemId.
 */
export function computeWallRunPlinthMap(
  layout: Pick<ProjectKitchenLayout, 'walls' | 'placements'>,
  items: readonly { readonly id: string }[],
  widthOf: (itemId: string) => number | undefined,
): Map<string, PlinthRunInfo> {
  const result = new Map<string, PlinthRunInfo>();

  // Group wall placements by wallId. Skip free placements — islands generate
  // their own individual plinth (left + right + back returns already handled).
  const byWall = new Map<string, ProjectItemPlacement[]>();
  for (const p of layout.placements) {
    if (isFreePlacement(p)) continue;
    // Only include items present in the quote.
    if (!items.some((i) => i.id === p.itemId)) continue;
    const group = byWall.get(p.wallId) ?? [];
    group.push(p);
    byWall.set(p.wallId, group);
  }

  for (const wallPlacements of byWall.values()) {
    // Sort left-to-right by offset.
    const sorted = [...wallPlacements].sort((a, b) => a.offsetMm - b.offsetMm);

    // Greedy run grouping: a new run starts when the gap between the end of
    // the previous item and the start of the next exceeds PLINTH_SIDE_GAP_MM.
    const runs: ProjectItemPlacement[][] = [];
    let current: ProjectItemPlacement[] = [];
    let currentEnd = -Infinity;

    for (const p of sorted) {
      const w = widthOf(p.itemId) ?? 0;
      if (current.length === 0 || p.offsetMm - currentEnd <= PLINTH_SIDE_GAP_MM) {
        current.push(p);
        currentEnd = p.offsetMm + w;
      } else {
        runs.push(current);
        current = [p];
        currentEnd = p.offsetMm + w;
      }
    }
    if (current.length > 0) runs.push(current);

    // Annotate each run: anchor (idx=0) generates the merged front plinth,
    // the rest suppress their own front piece.
    for (const run of runs) {
      const totalWidth = run.reduce(
        (sum, p) => sum + (widthOf(p.itemId) ?? 0),
        0,
      );
      run.forEach((p, idx) => {
        if (idx === 0) {
          result.set(p.itemId, { isRunAnchor: true, runFrontWidthMm: totalWidth });
        } else {
          result.set(p.itemId, { isRunAnchor: false });
        }
      });
    }
  }

  return result;
}

export function resolveBaseModeWithContext(
  module: Pick<Module, 'baseMode' | 'furnitureType'>,
  context?: BaseResolutionContext,
): ModuleBaseMode {
  if (
    context?.baseMode !== undefined &&
    isModuleBaseMode(context.baseMode)
  ) {
    return context.baseMode;
  }
  return resolveModuleBaseMode(module);
}

export function resolveBaseClearanceWithContext(
  module: Pick<Module, 'baseMode' | 'baseClearanceMm' | 'furnitureType'>,
  context?: BaseResolutionContext,
): number {
  // The effective mode (item override included) decides whether a height
  // exists at all — a module without its own baseMode must still honor the
  // context mode's default height.
  const mode = resolveBaseModeWithContext(module, context);
  if (mode === 'none') return 0;
  if (context?.baseClearanceMm !== undefined) {
    return resolveModuleBaseClearanceMm(module, context.baseClearanceMm);
  }
  if (
    module.baseClearanceMm !== undefined &&
    Number.isFinite(module.baseClearanceMm)
  ) {
    return Math.max(0, Math.round(module.baseClearanceMm));
  }
  return DEFAULT_BASE_CLEARANCE_MM;
}

/** id / code of the synthesized melamine plinth part (skip-if-present key). */
export const SYNTHETIC_ZOCLO_PART_ID_SUFFIX = '-zoclo-auto';
export const SYNTHETIC_ZOCLO_PART_CODE = 'ZOCLO-AUTO';
export const SYNTHETIC_ZOCLO_SIDE_CODE = 'ZOCLO-LADO-AUTO';

/**
 * Melamine plinth part synthesized by the engine when the base mode asks for
 * a board zoclo and the module carries no component with role ZOCLO (F087).
 * L = cabinet width, W = base height B, visible front edge banded.
 */
export function synthesizeBaseBoardPart(
  moduleCode: string,
  widthMm: number,
  baseClearanceMm: number,
): BoardPart {
  return {
    id: `${moduleCode}${SYNTHETIC_ZOCLO_PART_ID_SUFFIX}`,
    code: SYNTHETIC_ZOCLO_PART_CODE,
    description: 'Zócalo (melamina)',
    quantity: 1,
    lengthMm: Math.max(0, Math.round(widthMm)),
    widthMm: Math.max(0, Math.round(baseClearanceMm)),
    edges: [
      { side: 'L1', enabled: true },
      { side: 'L2', enabled: false },
      { side: 'W1', enabled: false },
      { side: 'W2', enabled: false },
    ],
    optionRole: ZOCLO_BOARD_ROLE,
  };
}

/**
 * Placeholder hardware line for a purchased plinth profile / legs (quantity 0
 * → converted to ml or suggested leg count by applyBaseModeToHardwareLines).
 * The hardware itself comes from the user's catalog choice for the role.
 */
export function synthesizeBaseHardwareLine(
  moduleCode: string,
  role: typeof ZOCLO_STRIP_ROLE | typeof PATAS_ROLE,
): HardwareLine {
  const suffix = role === ZOCLO_STRIP_ROLE ? '-zoclo-perfil-auto' : '-patas-auto';
  return {
    id: `${moduleCode}${suffix}`,
    quantity: 0,
    optionRole: role,
  };
}

/**
 * Append the synthesized base parts/lines a base mode needs and apply the
 * mode's quantity rules. Modules that already carry their own ZOCLO part or
 * ZOCLO_PERFIL/PATAS lines are left untouched (no double count — and no
 * synthesized side returns either: modeled fronts own their sides).
 * F088: exposed sides add melamine return parts / strip ml.
 * F089: plinthRun controls wall-run front plinth merging.
 */
export function applyBaseTreatment(
  moduleCode: string,
  parts: readonly BoardPart[],
  hardwareLines: readonly HardwareLine[],
  mode: ModuleBaseMode,
  baseClearanceMm: number,
  widthMm: number,
  depthMm: number,
  plinthSides?: PlinthSides,
  /**
   * Option choices for the quote line. When provided, legs are only synthesized
   * if a PATAS hardware choice exists — avoiding ResolutionErrors for projects
   * that haven't configured adjustable legs in their catalog.
   */
  optionChoices?: Readonly<Record<string, string | undefined>>,
  /**
   * Wall-run merging context (F089). When provided:
   * - isRunAnchor=true  → this item generates the front plinth for the whole run
   *   (length = runFrontWidthMm); side returns are still per this item's exposure.
   * - isRunAnchor=false → this item is inside a run; skip the front plinth piece
   *   (the anchor item already covers it); side returns are still generated.
   */
  plinthRun?: PlinthRunInfo,
): { parts: BoardPart[]; hardwareLines: HardwareLine[] } {
  let partsOut = [...parts];
  let hardwareOut = [...hardwareLines];

  const exposedSides: ('left' | 'right' | 'back')[] = plinthSides
    ? (['left', 'right', 'back'] as const).filter((s) => plinthSides[s])
    : [];
  const returnDepth = plinthReturnDepthMm(depthMm);

  // Non-anchor items in a merged run skip the front plinth piece but still
  // generate their own side returns at the wall extremes.
  const skipFront = plinthRun?.isRunAnchor === false;
  // Anchor items use the full run width for the merged piece.
  const frontWidthMm = plinthRun?.isRunAnchor
    ? (plinthRun.runFrontWidthMm ?? widthMm)
    : widthMm;

  if (
    mode === 'plinth_board' &&
    baseClearanceMm > 0 &&
    frontWidthMm > 0 &&
    !partsOut.some((p) => isZocloBoardRole(p.optionRole))
  ) {
    if (!skipFront) {
      partsOut.push(synthesizeBaseBoardPart(moduleCode, frontWidthMm, baseClearanceMm));
    }
    for (const side of exposedSides) {
      partsOut.push({
        id: `${moduleCode}${SYNTHETIC_ZOCLO_PART_ID_SUFFIX}-lado-${side}`,
        code: SYNTHETIC_ZOCLO_SIDE_CODE,
        description: 'Zócalo lateral (vuelta)',
        quantity: 1,
        lengthMm: returnDepth,
        widthMm: baseClearanceMm,
        edges: [
          { side: 'L1', enabled: true },
          { side: 'L2', enabled: false },
          { side: 'W1', enabled: false },
          { side: 'W2', enabled: false },
        ],
        optionRole: ZOCLO_BOARD_ROLE,
      });
    }
  }
  if (mode === 'plinth_strip' && !hardwareOut.some((l) => isZocloStripRole(l.optionRole ?? ''))) {
    // Placeholder quantity doubles as the ml factor (front + returns).
    // For a merged run anchor: use runFrontWidthMm for the front ml.
    const returnsMm = exposedSides.length * returnDepth;
    const baseForQuantity = skipFront ? 0 : frontWidthMm;
    const ratio = widthMm > 0 ? (baseForQuantity + returnsMm) / widthMm : 0;
    hardwareOut.push({
      ...synthesizeBaseHardwareLine(moduleCode, ZOCLO_STRIP_ROLE),
      ...(ratio > 0 ? { quantity: ratio } : {}),
    });
  }
  // Adjustable legs always support floor cabinets regardless of plinth mode.
  // In plinth_board / plinth_strip the plinth covers the legs; in legs mode
  // they remain visible.  Only `none` omits them entirely.
  // Guard: only synthesize when a PATAS choice exists (backwards-compatible —
  // projects without PATAS configured in their catalog are unaffected).
  const patasChoice = optionChoices?.[PATAS_ROLE];
  if (
    mode !== 'none' &&
    !hardwareOut.some((l) => isPatasRole(l.optionRole ?? '')) &&
    patasChoice
  ) {
    hardwareOut.push(synthesizeBaseHardwareLine(moduleCode, PATAS_ROLE));
  }

  return {
    parts: partsOut,
    hardwareLines: applyBaseModeToHardwareLines(hardwareOut, mode, widthMm),
  };
}


/** Engine context for a quote line: the item's base-mode override plus the
 * plinth state resolved from the kitchen plan (placement → layout).
 * Undefined fields fall back to the module catalog defaults.
 *
 * @param plinthRunMap  Optional pre-computed run map from computeWallRunPlinthMap.
 *   Provide this when rendering a full project BOM so adjacent front plinths are
 *   merged into one piece per wall run (F089).  Omit for single-item previews.
 */
export function baseContextForItem(
  project: Pick<Project, 'items' | 'kitchenLayout'>,
  item: Pick<ProjectItem, 'id' | 'baseMode'>,
  /** With a catalog the plan side exposure is resolved from module widths. */
  catalog?: Pick<Catalog, 'modules' | 'structures'>,
  /** Pre-computed wall-run map for front plinth merging (F089). */
  plinthRunMap?: ReadonlyMap<string, PlinthRunInfo>,
): BaseResolutionContext {
  const layout = project.kitchenLayout;
  const planB = layout
    ? resolveBaseClearanceMm(
        layout,
        layout.placements.find((p) => p.itemId === item.id),
      )
    : undefined;
  let plinthSides: PlinthSides | undefined;
  if (layout && catalog) {
    const placement = layout.placements.find((p) => p.itemId === item.id);
    if (placement) {
      const widthOf = (itemId: string): number | undefined => {
        const other = project.items.find((i) => i.id === itemId);
        if (!other) return undefined;
        return modulePlanWidthMm(
          catalog.modules.find((m) => m.id === other.moduleId),
          catalog,
          other.measurePresetId,
        );
      };
      plinthSides = plinthSidesForPlacement(layout, placement, widthOf);
    }
  }
  const plinthRun = plinthRunMap?.get(item.id);
  return {
    ...(item.baseMode ? { baseMode: item.baseMode } : {}),
    ...(planB !== undefined ? { baseClearanceMm: planB } : {}),
    ...(plinthSides ? { plinthSides } : {}),
    ...(plinthRun ? { plinthRun } : {}),
  };
}

/** Plan footprint width of a module (default preset → external dims → structure). */
function modulePlanWidthMm(
  module: Module | undefined,
  catalog: Pick<Catalog, 'modules' | 'structures'>,
  measurePresetId?: string,
): number | undefined {
  if (!module) return undefined;
  try {
    const preset = resolveModuleMeasurePreset(module, measurePresetId);
    if (preset) return preset.width;
  } catch {
    /* invalid pin/preset — fall through */
  }
  if (module.externalDims) return module.externalDims.width;
  const structure = catalog.structures?.find((s) => s.id === module.structureId);
  return structure?.externalDims?.width;
}
