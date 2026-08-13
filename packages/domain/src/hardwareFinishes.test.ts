import { describe, expect, it } from 'vitest';
import {
  HARDWARE_FINISHES,
  getHardwareFinish,
  matchHardwareFinish,
  type HardwareFinishId,
} from './hardwareFinishes';

describe('HARDWARE_FINISHES', () => {
  it('has at least 5 presets', () => {
    expect(HARDWARE_FINISHES.length).toBeGreaterThanOrEqual(5);
  });

  it('each preset has id, name, color, and PBR values', () => {
    for (const f of HARDWARE_FINISHES) {
      expect(f.id).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(f.metalness).toBeGreaterThanOrEqual(0);
      expect(f.metalness).toBeLessThanOrEqual(1);
      expect(f.roughness).toBeGreaterThanOrEqual(0);
      expect(f.roughness).toBeLessThanOrEqual(1);
      expect(f.clearcoat).toBeGreaterThanOrEqual(0);
      expect(f.clearcoat).toBeLessThanOrEqual(1);
    }
  });

  it('includes chrome, black-matte, bronze, brushed, gold', () => {
    const ids = HARDWARE_FINISHES.map((f) => f.id);
    expect(ids).toContain('chrome');
    expect(ids).toContain('black-matte');
    expect(ids).toContain('bronze');
    expect(ids).toContain('brushed');
    expect(ids).toContain('gold');
  });

  it('chrome has high metalness and low roughness', () => {
    const chrome = getHardwareFinish('chrome')!;
    expect(chrome.metalness).toBeGreaterThan(0.8);
    expect(chrome.roughness).toBeLessThan(0.3);
  });

  it('black-matte has low metalness', () => {
    const black = getHardwareFinish('black-matte')!;
    expect(black.metalness).toBeLessThan(0.2);
  });
});

describe('getHardwareFinish', () => {
  it('finds a finish by id', () => {
    expect(getHardwareFinish('bronze')?.name).toBe('Bronce');
  });

  it('returns undefined for unknown id', () => {
    expect(getHardwareFinish('nonexistent')).toBeUndefined();
  });
});

describe('matchHardwareFinish', () => {
  it('matches preset by exact color and PBR values', () => {
    const chrome = getHardwareFinish('chrome')!;
    expect(
      matchHardwareFinish({
        color: chrome.color,
        metalness: String(chrome.metalness),
        roughness: String(chrome.roughness),
        clearcoat: String(chrome.clearcoat),
      }),
    ).toBe('chrome');

    const bronze = getHardwareFinish('bronze')!;
    expect(
      matchHardwareFinish({
        color: bronze.color,
        metalness: bronze.metalness,
        roughness: bronze.roughness,
        clearcoat: bronze.clearcoat,
      }),
    ).toBe('bronze');
  });

  it('returns empty string for custom color', () => {
    expect(
      matchHardwareFinish({
        color: '#ff0055',
        metalness: '0.9',
        roughness: '0.15',
        clearcoat: '0.8',
      }),
    ).toBe('');
  });

  it('returns empty string when color is missing', () => {
    expect(matchHardwareFinish({})).toBe('');
  });
});

