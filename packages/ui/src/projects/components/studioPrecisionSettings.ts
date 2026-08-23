/**
 * F144 — ajustes de precisión del studio de Proyectar (North Star §10.2:
 * nudge y snap configurables). Persisten por dispositivo (localStorage del
 * taller), no en el proyecto ni en backend. Hook + defaults + normalización.
 */

import { useCallback, useMemo, useState } from 'react';

export type StudioPrecisionSettings = {
  /** Paso del nudge de teclado (mm). */
  readonly nudgeStepMm: number;
  /** Multiplicador del paso con Shift (paso grueso). */
  readonly nudgeCoarseMultiplier: number;
  /** Snap de muro (a vecinos/extremos) durante drag/place. */
  readonly wallSnap: boolean;
  /** Umbral de atracción del snap de muro (mm). */
  readonly wallSnapThresholdMm: number;
  /** Gap preferido entre muebles al snap (mm). */
  readonly wallGapMm: number;
  /** Grilla para islas (mm); 0 = sin grilla. */
  readonly islandSnapMm: number;
};

export const DEFAULT_PRECISION_SETTINGS: StudioPrecisionSettings = {
  nudgeStepMm: 10,
  nudgeCoarseMultiplier: 5,
  wallSnap: true,
  wallSnapThresholdMm: 18,
  wallGapMm: 20,
  islandSnapMm: 50,
};

const STORAGE_KEY = 'proyectar.precision.v1';

const MIN_STEP = 1;
const MAX_STEP = 500;

export function normalizePrecisionSettings(
  raw: Partial<StudioPrecisionSettings> | null | undefined,
): StudioPrecisionSettings {
  const clamp = (v: unknown, def: number, min: number, max: number): number => {
    const n = typeof v === 'number' ? Math.round(v) : NaN;
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  return {
    nudgeStepMm: clamp(raw?.nudgeStepMm, DEFAULT_PRECISION_SETTINGS.nudgeStepMm, MIN_STEP, MAX_STEP),
    nudgeCoarseMultiplier: clamp(
      raw?.nudgeCoarseMultiplier,
      DEFAULT_PRECISION_SETTINGS.nudgeCoarseMultiplier,
      2,
      20,
    ),
    wallSnap: typeof raw?.wallSnap === 'boolean' ? raw.wallSnap : DEFAULT_PRECISION_SETTINGS.wallSnap,
    wallSnapThresholdMm: clamp(
      raw?.wallSnapThresholdMm,
      DEFAULT_PRECISION_SETTINGS.wallSnapThresholdMm,
      1,
      200,
    ),
    wallGapMm: clamp(raw?.wallGapMm, DEFAULT_PRECISION_SETTINGS.wallGapMm, 0, 200),
    islandSnapMm: clamp(raw?.islandSnapMm, DEFAULT_PRECISION_SETTINGS.islandSnapMm, 0, 500),
  };
}

function loadSettings(): StudioPrecisionSettings {
  if (typeof window === 'undefined') return DEFAULT_PRECISION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRECISION_SETTINGS;
    return normalizePrecisionSettings(JSON.parse(raw) as Partial<StudioPrecisionSettings>);
  } catch {
    return DEFAULT_PRECISION_SETTINGS;
  }
}

export type StudioPrecisionSettingsApi = {
  readonly settings: StudioPrecisionSettings;
  readonly update: (patch: Partial<StudioPrecisionSettings>) => void;
  /** Paso efectivo del nudge según modifier (Shift = grueso). */
  readonly nudgeStepFor: (coarse: boolean) => number;
  /** Snapping X/Y de isla según grilla (0 = identidad). */
  readonly snapIsland: (v: number) => number;
};

export function useStudioPrecisionSettings(): StudioPrecisionSettingsApi {
  const [settings, setSettings] = useState<StudioPrecisionSettings>(loadSettings);

  const update = useCallback((patch: Partial<StudioPrecisionSettings>) => {
    setSettings((prev) => {
      const next = normalizePrecisionSettings({ ...prev, ...patch });
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* sin storage → sólo sesión */
      }
      return next;
    });
  }, []);

  const nudgeStepFor = useCallback(
    (coarse: boolean): number =>
      coarse
        ? settings.nudgeStepMm * settings.nudgeCoarseMultiplier
        : settings.nudgeStepMm,
    [settings.nudgeStepMm, settings.nudgeCoarseMultiplier],
  );

  const snapIsland = useCallback(
    (v: number): number =>
      settings.islandSnapMm > 0
        ? Math.round(v / settings.islandSnapMm) * settings.islandSnapMm
        : Math.round(v),
    [settings.islandSnapMm],
  );

  return useMemo(
    () => ({ settings, update, nudgeStepFor, snapIsland }),
    [settings, update, nudgeStepFor, snapIsland],
  );
}
