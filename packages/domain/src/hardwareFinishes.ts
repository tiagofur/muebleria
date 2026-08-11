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
