/**
 * Workshop 3D lighting presets (presentation quality without full PBR pipeline).
 */

export type SceneLightingMode = 'workshop' | 'soft' | 'present';

export const DEFAULT_SCENE_LIGHTING_MODE: SceneLightingMode = 'present';

export type SceneLightPlan = {
  readonly ambient: number;
  readonly hemiSky: string;
  readonly hemiGround: string;
  readonly hemiIntensity: number;
  readonly key: {
    readonly pos: readonly [number, number, number];
    readonly intensity: number;
    readonly color?: string;
    readonly castShadow: boolean;
  };
  readonly fill?: {
    readonly pos: readonly [number, number, number];
    readonly intensity: number;
    readonly color?: string;
  };
  readonly rim?: {
    readonly pos: readonly [number, number, number];
    readonly intensity: number;
    readonly color?: string;
  };
  readonly spot?: {
    readonly pos: readonly [number, number, number];
    readonly intensity: number;
    readonly angle: number;
    readonly penumbra: number;
  };
  /** Use drei Environment HDR when true (present mode). */
  readonly useEnvironment: boolean;
  readonly environmentIntensity: number;
  readonly background: string;
};

/**
 * Scale light positions by scene max dimension (mm).
 * Pure — unit tested.
 */
export function planSceneLighting(
  mode: SceneLightingMode,
  maxDim: number,
): SceneLightPlan {
  const d = Math.max(maxDim, 1);
  switch (mode) {
    case 'soft':
      return {
        ambient: 0.72,
        hemiSky: '#eef2f7',
        hemiGround: '#4a453f',
        hemiIntensity: 0.42,
        key: {
          pos: [d * 0.9, d * 1.3, d * 0.55],
          intensity: 0.75,
          castShadow: true,
        },
        fill: {
          pos: [-d * 0.7, d * 0.85, -d * 0.35],
          intensity: 0.4,
          color: '#d0d8e8',
        },
        useEnvironment: false,
        environmentIntensity: 0,
        background: '#1c1e22',
      };
    case 'workshop':
      return {
        ambient: 0.55,
        hemiSky: '#f0f4f8',
        hemiGround: '#3d3a35',
        hemiIntensity: 0.35,
        key: {
          pos: [d, d * 1.4, d * 0.6],
          intensity: 1.05,
          castShadow: true,
        },
        useEnvironment: false,
        environmentIntensity: 0,
        background: '#1a1c1e',
      };
    case 'present':
    default:
      return {
        ambient: 0.38,
        hemiSky: '#f7f9fc',
        hemiGround: '#3a3630',
        hemiIntensity: 0.48,
        key: {
          pos: [d * 0.85, d * 1.65, d * 0.45],
          intensity: 1.25,
          castShadow: true,
        },
        fill: {
          pos: [-d * 0.95, d * 0.75, d * 0.25],
          intensity: 0.42,
          color: '#b8c8e8',
        },
        rim: {
          pos: [0, d * 0.55, -d * 1.05],
          intensity: 0.32,
          color: '#fff0d8',
        },
        spot: {
          pos: [d * 0.25, d * 2.1, d * 0.15],
          intensity: 0.5,
          angle: 0.38,
          penumbra: 0.65,
        },
        useEnvironment: true,
        environmentIntensity: 0.32,
        background: '#141618',
      };
  }
}

/** Melamine / board material response (standard physical defaults). */
export type BoardPhysicalResponse = {
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly envMapIntensity: number;
};

export function boardPhysicalResponse(params: {
  readonly hasMap: boolean;
  readonly hasGrain: boolean;
  readonly lightingMode?: SceneLightingMode;
}): BoardPhysicalResponse {
  const present = (params.lightingMode ?? 'present') === 'present';
  if (params.hasMap) {
    return {
      roughness: present ? 0.48 : 0.62,
      metalness: 0.03,
      clearcoat: present ? 0.22 : 0.08,
      clearcoatRoughness: 0.35,
      envMapIntensity: present ? 0.55 : 0.2,
    };
  }
  if (params.hasGrain) {
    return {
      roughness: present ? 0.62 : 0.78,
      metalness: 0.02,
      clearcoat: present ? 0.12 : 0.04,
      clearcoatRoughness: 0.55,
      envMapIntensity: present ? 0.35 : 0.12,
    };
  }
  // Solid color lacquer-ish
  return {
    roughness: present ? 0.38 : 0.52,
    metalness: 0.04,
    clearcoat: present ? 0.4 : 0.15,
    clearcoatRoughness: 0.28,
    envMapIntensity: present ? 0.65 : 0.25,
  };
}
