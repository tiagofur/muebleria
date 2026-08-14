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
  Component,
  FurnitureType,
  HardwareLine,
  Module,
  ModuleComponentInstance,
  ModuleBaseMode,
  Project,
  ProjectItem,
} from './types';
import { DEFAULT_BASE_CLEARANCE_MM, resolveBaseClearanceMm } from './kitchenLayout';
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
 * - PATAS: only in legs; quantity uses suggestLegCount when line.quantity is 0/placeholder
 */
export function applyBaseModeToHardwareLines(
  lines: readonly HardwareLine[],
  mode: ModuleBaseMode,
  widthMm: number,
): HardwareLine[] {
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
      if (mode !== 'legs') continue;
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
 * ZOCLO_PERFIL/PATAS lines are left untouched (no double count).
 */
export function applyBaseTreatment(
  moduleCode: string,
  parts: readonly BoardPart[],
  hardwareLines: readonly HardwareLine[],
  mode: ModuleBaseMode,
  baseClearanceMm: number,
  widthMm: number,
): { parts: BoardPart[]; hardwareLines: HardwareLine[] } {
  let partsOut = [...parts];
  let hardwareOut = [...hardwareLines];

  if (
    mode === 'plinth_board' &&
    baseClearanceMm > 0 &&
    widthMm > 0 &&
    !partsOut.some((p) => isZocloBoardRole(p.optionRole))
  ) {
    partsOut.push(synthesizeBaseBoardPart(moduleCode, widthMm, baseClearanceMm));
  }
  if (
    mode === 'plinth_strip' &&
    !hardwareOut.some((l) => isZocloStripRole(l.optionRole ?? ''))
  ) {
    hardwareOut.push(synthesizeBaseHardwareLine(moduleCode, ZOCLO_STRIP_ROLE));
  }
  if (
    mode === 'legs' &&
    !hardwareOut.some((l) => isPatasRole(l.optionRole ?? ''))
  ) {
    hardwareOut.push(synthesizeBaseHardwareLine(moduleCode, PATAS_ROLE));
  }

  return {
    parts: partsOut,
    hardwareLines: applyBaseModeToHardwareLines(hardwareOut, mode, widthMm),
  };
}

/**
 * Engine context for a quote line: the item's base-mode override plus the
 * plinth height B resolved from the kitchen plan (placement → layout).
 * Undefined fields fall back to the module catalog defaults.
 */
export function baseContextForItem(
  project: Pick<Project, 'kitchenLayout'>,
  item: Pick<ProjectItem, 'id' | 'baseMode'>,
): BaseResolutionContext {
  const layout = project.kitchenLayout;
  const planB = layout
    ? resolveBaseClearanceMm(
        layout,
        layout.placements.find((p) => p.itemId === item.id),
      )
    : undefined;
  return {
    ...(item.baseMode ? { baseMode: item.baseMode } : {}),
    ...(planB !== undefined ? { baseClearanceMm: planB } : {}),
  };
}
