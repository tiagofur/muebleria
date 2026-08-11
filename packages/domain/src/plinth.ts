/**
 * Plinth / toe-kick (zoclo) and legs — base of floor cabinets.
 *
 * Modes:
 * - none: no base parts
 * - plinth_board: melamine strip component(s), option role ZOCLO (fallback FRENTE)
 * - plinth_strip: purchased profile (plastic/aluminium), hardware per linear meter
 * - legs: hardware feet / levelers
 */

import type {
  Component,
  HardwareLine,
  Module,
  ModuleComponentInstance,
  ModuleBaseMode,
} from './types';
import { DEFAULT_BASE_CLEARANCE_MM } from './kitchenLayout';
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
