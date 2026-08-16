/**
 * Hardware finish presets (F069). Each preset is a named combination of PBR
 * values that get loaded into the existing Hardware preview* fields when
 * selected — no new table, no migration. The 3D renderer (HardwareMesh) already
 * consumes these fields via boardPhysicalResponse.
 *
 * F080 extends this with per-part finishes: a hardware piece is composed of
 * structural parts (body / base / grip) and each part can override the
 * global finish with one of these same presets.
 */

import type { Hardware, HardwarePartRole } from './types';

export type HardwareFinishId =
  | 'chrome'
  | 'black-matte'
  | 'bronze'
  | 'brushed'
  | 'gold';

export type HardwareFinish = {
  readonly id: HardwareFinishId;
  readonly name: string;
  readonly color: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly clearcoat: number;
};

export const HARDWARE_FINISHES: readonly HardwareFinish[] = [
  {
    id: 'chrome',
    name: 'Cromado',
    color: '#c0c0c0',
    metalness: 0.9,
    roughness: 0.15,
    clearcoat: 0.8,
  },
  {
    id: 'black-matte',
    name: 'Negro mate',
    color: '#1a1a1a',
    metalness: 0.1,
    roughness: 0.7,
    clearcoat: 0.0,
  },
  {
    id: 'bronze',
    name: 'Bronce',
    color: '#8c6a3e',
    metalness: 0.8,
    roughness: 0.3,
    clearcoat: 0.3,
  },
  {
    id: 'brushed',
    name: 'Cepillado',
    color: '#b8b8b0',
    metalness: 0.85,
    roughness: 0.35,
    clearcoat: 0.2,
  },
  {
    id: 'gold',
    name: 'Oro',
    color: '#d4a838',
    metalness: 0.9,
    roughness: 0.2,
    clearcoat: 0.5,
  },
];

/** Lookup a finish by id, or undefined if not found. */
export function getHardwareFinish(
  id: string,
): HardwareFinish | undefined {
  return HARDWARE_FINISHES.find((f) => f.id === id);
}

/** Normalize hex color to 6-digit lowercase format. */
function normalizeHex(hex: string): string {
  const h = hex.trim().toLowerCase();
  if (h.length === 4 && h.startsWith('#')) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h;
}

/** Match current PBR values against preset finish options. Returns preset id or '' if custom/no match. */
export function matchHardwareFinish(pbr: {
  readonly color?: string;
  readonly metalness?: number | string;
  readonly roughness?: number | string;
  readonly clearcoat?: number | string;
}): HardwareFinishId | '' {
  if (!pbr.color) return '';
  const c = normalizeHex(pbr.color);
  const parseVal = (v: number | string | undefined) => {
    if (v === undefined || v === '') return undefined;
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? undefined : n;
  };

  const m = parseVal(pbr.metalness);
  const r = parseVal(pbr.roughness);
  const cl = parseVal(pbr.clearcoat);

  for (const finish of HARDWARE_FINISHES) {
    const finishColor = normalizeHex(finish.color);
    const colorMatch = finishColor === c;
    const metalnessMatch =
      m === undefined || Math.abs(finish.metalness - m) < 0.02;
    const roughnessMatch =
      r === undefined || Math.abs(finish.roughness - r) < 0.02;
    const clearcoatMatch =
      cl === undefined || Math.abs(finish.clearcoat - cl) < 0.02;

    if (colorMatch && metalnessMatch && roughnessMatch && clearcoatMatch) {
      return finish.id;
    }
  }
  return '';
}


// --- F080: per-part finishes -------------------------------------------------

export const HARDWARE_PART_ROLES: readonly HardwarePartRole[] = [
  'body',
  'base',
  'grip',
];

export const HARDWARE_PART_ROLE_LABELS_ES: Readonly<
  Record<HardwarePartRole, string>
> = {
  body: 'Cuerpo',
  base: 'Base',
  grip: 'Empuñadura',
};

/**
 * Part roles each preview shape actually renders (F080):
 * - knob: head (body) + post (base)
 * - bar-pull: grip tube (grip) + supports (base)
 * - cup-pull / rail: single body piece
 * - hinge: cup + arm (body) + mounting plate (base)
 * - slide: outer rail (body) + inner track (base)
 * - leg: shaft (body) + leveling foot (base)
 */
export function hardwarePartRolesForShape(
  shape: NonNullable<Hardware['previewShape']>,
): readonly HardwarePartRole[] {
  switch (shape) {
    case 'bar-pull':
      return ['grip', 'base'];
    case 'cup-pull':
    case 'rail':
      return ['body'];
    case 'knob':
    case 'hinge':
    case 'slide':
    case 'leg':
      return ['body', 'base'];
  }
}

/**
 * Finish preset for one part, or undefined when the part should use the
 * hardware's global preview* finish (legacy behavior / unconfigured part /
 * unknown preset id). Pure.
 */
export function resolveHardwarePartFinish(
  hardware: Hardware,
  role: HardwarePartRole,
): HardwareFinish | undefined {
  const id = hardware.partFinishes?.[role];
  if (!id) return undefined;
  return getHardwareFinish(id);
}

/**
 * Drop entries with an unknown role or preset id and return a clean
 * partFinishes map, or undefined when nothing survives. Used by mappers and
 * stores so garbage never round-trips into the catalog.
 */
export function normalizeHardwarePartFinishes(
  raw: unknown,
): Readonly<Partial<Record<HardwarePartRole, HardwareFinishId>>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  let out: Partial<Record<HardwarePartRole, HardwareFinishId>> | undefined;
  for (const role of HARDWARE_PART_ROLES) {
    const value = (raw as Record<string, unknown>)[role];
    if (
      typeof value === 'string' &&
      HARDWARE_FINISHES.some((f) => f.id === value)
    ) {
      out = out ?? {};
      out[role] = value as HardwareFinishId;
    }
  }
  return out;
}
