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


// --- F080: per-part finishes -------------------------------------------------

import type { Hardware } from './types';
import {
  HARDWARE_PART_ROLES,
  hardwarePartRolesForShape,
  normalizeHardwarePartFinishes,
  resolveHardwarePartFinish,
} from './hardwareFinishes';

function hw(over: Partial<Hardware> = {}): Hardware {
  return {
    id: 'h1',
    code: 'HER-01',
    name: 'Tirador',
    unit: 'piece',
    costPerUnit: 10,
    active: true,
    previewColor: '#123456',
    previewMetalness: 0.2,
    previewRoughness: 0.4,
    previewClearcoat: 0.1,
    ...over,
  };
}

describe('hardwarePartRolesForShape (F080)', () => {
  it('bar-pull exposes grip + base (tube vs supports)', () => {
    expect(hardwarePartRolesForShape('bar-pull')).toEqual(['grip', 'base']);
  });

  it('two-part shapes expose body + base', () => {
    for (const shape of ['knob', 'hinge', 'slide', 'leg'] as const) {
      expect(hardwarePartRolesForShape(shape)).toEqual(['body', 'base']);
    }
  });

  it('single-piece shapes expose body only', () => {
    expect(hardwarePartRolesForShape('cup-pull')).toEqual(['body']);
    expect(hardwarePartRolesForShape('rail')).toEqual(['body']);
  });

  it('every shape/role combination stays inside the role union', () => {
    for (const shape of [
      'knob',
      'bar-pull',
      'cup-pull',
      'hinge',
      'slide',
      'rail',
      'leg',
    ] as const) {
      for (const role of hardwarePartRolesForShape(shape)) {
        expect(HARDWARE_PART_ROLES).toContain(role);
      }
    }
  });
});

describe('resolveHardwarePartFinish (F080)', () => {
  it('returns the preset assigned to the part', () => {
    const h = hw({
      previewShape: 'bar-pull',
      partFinishes: { grip: 'gold', base: 'black-matte' },
    });
    expect(resolveHardwarePartFinish(h, 'grip')?.id).toBe('gold');
    expect(resolveHardwarePartFinish(h, 'base')?.id).toBe('black-matte');
  });

  it('falls back to undefined for unconfigured parts (global finish wins)', () => {
    const h = hw({ partFinishes: { base: 'bronze' } });
    expect(resolveHardwarePartFinish(h, 'body')).toBeUndefined();
  });

  it('ignores unknown preset ids (defensive against stale catalogs)', () => {
    const h = hw({
      partFinishes: { body: 'no-existe' as never },
    });
    expect(resolveHardwarePartFinish(h, 'body')).toBeUndefined();
  });
});

describe('normalizeHardwarePartFinishes (F080)', () => {
  it('keeps valid role→preset pairs and drops garbage', () => {
    expect(
      normalizeHardwarePartFinishes({
        body: 'chrome',
        grip: 'gold',
        base: 'no-existe',
        rotor: 'bronze',
      }),
    ).toEqual({ body: 'chrome', grip: 'gold' });
  });

  it('returns undefined for non-object or empty input', () => {
    expect(normalizeHardwarePartFinishes(null)).toBeUndefined();
    expect(normalizeHardwarePartFinishes('chrome')).toBeUndefined();
    expect(normalizeHardwarePartFinishes([1, 2])).toBeUndefined();
    expect(normalizeHardwarePartFinishes({})).toBeUndefined();
    expect(
      normalizeHardwarePartFinishes({ rotor: 'chrome' }),
    ).toBeUndefined();
  });

  it('round-trips through JSON (persistence path)', () => {
    const clean = normalizeHardwarePartFinishes({
      body: 'bronze',
      base: 'black-matte',
    });
    expect(
      normalizeHardwarePartFinishes(JSON.parse(JSON.stringify(clean))),
    ).toEqual(clean);
  });
});
