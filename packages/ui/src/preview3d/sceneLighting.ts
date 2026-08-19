/**
 * Workshop 3D lighting presets (presentation quality without full PBR pipeline).
 */

export type SceneLightingMode = 'workshop' | 'soft' | 'present' | 'catalog';

export const DEFAULT_SCENE_LIGHTING_MODE: SceneLightingMode = 'present';

/** Light studio backdrop for catalog product stills (not workshop charcoal). */
export const CATALOG_PHOTO_BACKGROUND = '#dfe3e8';

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
    case 'catalog':
      // Product still: calibrated studio — enough fill to show detail,
      // but restrained so colors stay saturated and contrast is preserved.
      // No spot (spot always cast shadows on the canvas), key without castShadow.
      return {
        ambient: 0.28,
        hemiSky: '#f0f2f4',
        hemiGround: CATALOG_PHOTO_BACKGROUND,
        hemiIntensity: 0.20,
        key: {
          pos: [d * 0.9, d * 1.5, d * 0.55],
          intensity: 0.75,
          castShadow: false,
        },
        fill: {
          pos: [-d * 0.9, d * 0.8, d * 0.3],
          intensity: 0.30,
          color: '#e0e4ec',
        },
        rim: {
          pos: [0, d * 0.6, -d * 1.0],
          intensity: 0.25,
          color: '#fff8ee',
        },
        useEnvironment: true,
        environmentIntensity: 0.20,
        background: CATALOG_PHOTO_BACKGROUND,
      };
    case 'present':
    default:
      return {
        ambient: 0.30,
        hemiSky: '#f7f9fc',
        hemiGround: '#3a3630',
        hemiIntensity: 0.35,
        key: {
          pos: [d * 0.85, d * 1.65, d * 0.45],
          intensity: 0.85,
          castShadow: true,
        },
        fill: {
          pos: [-d * 0.95, d * 0.75, d * 0.25],
          intensity: 0.30,
          color: '#b8c8e8',
        },
        rim: {
          pos: [0, d * 0.55, -d * 1.05],
          intensity: 0.22,
          color: '#fff0d8',
        },
        spot: {
          pos: [d * 0.25, d * 2.1, d * 0.15],
          intensity: 0.35,
          angle: 0.38,
          penumbra: 0.65,
        },
        useEnvironment: true,
        environmentIntensity: 0.16,
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

function isGlossyLightingMode(mode: SceneLightingMode | undefined): boolean {
  const m = mode ?? 'present';
  return m === 'present' || m === 'catalog';
}

export function boardPhysicalResponse(params: {
  readonly hasMap: boolean;
  readonly hasGrain: boolean;
  readonly lightingMode?: SceneLightingMode;
  readonly previewRoughness?: number;
  readonly previewMetalness?: number;
  readonly previewClearcoat?: number;
}): BoardPhysicalResponse {
  const present = isGlossyLightingMode(params.lightingMode);
  let base: BoardPhysicalResponse;
  if (params.hasMap) {
    base = {
      roughness: present ? 0.52 : 0.62,
      metalness: 0.03,
      clearcoat: present ? 0.15 : 0.08,
      clearcoatRoughness: 0.35,
      envMapIntensity: present ? 0.40 : 0.2,
    };
  } else if (params.hasGrain) {
    base = {
      roughness: present ? 0.68 : 0.78,
      metalness: 0.02,
      clearcoat: present ? 0.08 : 0.04,
      clearcoatRoughness: 0.55,
      envMapIntensity: present ? 0.25 : 0.12,
    };
  } else {
    // Solid color lacquer-ish
    base = {
      roughness: present ? 0.44 : 0.52,
      metalness: 0.04,
      clearcoat: present ? 0.28 : 0.15,
      clearcoatRoughness: 0.28,
      envMapIntensity: present ? 0.22 : 0.15,
    };
  }

  const roughness = params.previewRoughness ?? base.roughness;
  return {
    roughness,
    metalness: params.previewMetalness ?? base.metalness,
    clearcoat: params.previewClearcoat ?? base.clearcoat,
    clearcoatRoughness:
      params.previewRoughness !== undefined
        ? Math.min(0.8, roughness * 0.8)
        : base.clearcoatRoughness,
    envMapIntensity: base.envMapIntensity,
  };
}
