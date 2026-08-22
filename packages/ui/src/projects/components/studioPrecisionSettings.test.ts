import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRECISION_SETTINGS,
  normalizePrecisionSettings,
} from './studioPrecisionSettings';

describe('normalizePrecisionSettings', () => {
  it('defaults completos con entrada vacía', () => {
    expect(normalizePrecisionSettings(null)).toEqual(DEFAULT_PRECISION_SETTINGS);
    expect(normalizePrecisionSettings({})).toEqual(DEFAULT_PRECISION_SETTINGS);
  });

  it('clampa pasos y gaps fuera de rango', () => {
    const s = normalizePrecisionSettings({
      nudgeStepMm: 0,
      wallGapMm: 9999,
      wallSnapThresholdMm: -5,
      islandSnapMm: Number.NaN,
    });
    expect(s.nudgeStepMm).toBe(1);
    expect(s.wallGapMm).toBe(200);
    expect(s.wallSnapThresholdMm).toBe(1);
    expect(s.islandSnapMm).toBe(DEFAULT_PRECISION_SETTINGS.islandSnapMm);
  });

  it('islandSnapMm 0 es válido (sin grilla)', () => {
    expect(normalizePrecisionSettings({ islandSnapMm: 0 }).islandSnapMm).toBe(0);
  });

  it('wallSnap booleano se conserva; basura cae a default', () => {
    expect(normalizePrecisionSettings({ wallSnap: false }).wallSnap).toBe(false);
    expect(normalizePrecisionSettings({ wallSnap: 'x' as unknown as boolean }).wallSnap).toBe(
      DEFAULT_PRECISION_SETTINGS.wallSnap,
    );
  });
});
