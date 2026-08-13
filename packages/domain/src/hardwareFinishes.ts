/**
 * Hardware finish presets (F069). Each preset is a named combination of PBR
 * values that get loaded into the existing Hardware preview* fields when
 * selected — no new table, no migration. The 3D renderer (HardwareMesh) already
 * consumes these fields via boardPhysicalResponse.
 */

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

