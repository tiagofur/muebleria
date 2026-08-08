import { describe, expect, it } from 'vitest';
import {
  boardPhysicalResponse,
  resolveBoardPhysicalResponse,
  CATALOG_PHOTO_BACKGROUND,
  planSceneLighting,
  type SceneLightingMode,
} from './sceneLighting';

describe('sceneLighting', () => {
  it('plans present mode with multi lights and environment', () => {
    const plan = planSceneLighting('present', 2000);
    expect(plan.key.castShadow).toBe(true);
    expect(plan.fill).toBeTruthy();
    expect(plan.rim).toBeTruthy();
    expect(plan.spot).toBeTruthy();
    expect(plan.useEnvironment).toBe(true);
    expect(plan.key.pos[1]).toBeGreaterThan(2000);
  });

  it('plans workshop without environment HDR', () => {
    const plan = planSceneLighting('workshop', 1000);
    expect(plan.useEnvironment).toBe(false);
    expect(plan.spot).toBeUndefined();
  });

  it('plans catalog product still with light studio background and no floor shadow', () => {
    const plan = planSceneLighting('catalog', 2000);
    expect(plan.background).toBe(CATALOG_PHOTO_BACKGROUND);
    expect(plan.useEnvironment).toBe(true);
    expect(plan.key.castShadow).toBe(false);
    expect(plan.spot).toBeUndefined();
    expect(plan.hemiGround).toBe(CATALOG_PHOTO_BACKGROUND);
    expect(plan.background.toLowerCase()).not.toMatch(/^#1[0-9a-f]/);
  });

  it('documents that ContactShadows are disabled for catalog mode in the scene', () => {
    // FurnitureScene3D gates ContactShadows with lightMode !== 'catalog'.
    // Keep the plan free of castShadow so re-enabling ContactShadows would
    // still not produce hard shadow maps in product stills.
    const plan = planSceneLighting('catalog', 1000);
    expect(plan.key.castShadow).toBe(false);
  });

  it('board physical response is glossier in present mode', () => {
    const solidPresent = boardPhysicalResponse({
      hasMap: false,
      hasGrain: false,
      lightingMode: 'present',
    });
    const solidWorkshop = boardPhysicalResponse({
      hasMap: false,
      hasGrain: false,
      lightingMode: 'workshop',
    });
    expect(solidPresent.clearcoat).toBeGreaterThan(solidWorkshop.clearcoat);
    expect(solidPresent.roughness).toBeLessThan(solidWorkshop.roughness);

    const tex = boardPhysicalResponse({
      hasMap: true,
      hasGrain: false,
      lightingMode: 'present',
    });
    expect(tex.envMapIntensity).toBeGreaterThan(0.3);

    const catalog = boardPhysicalResponse({
      hasMap: true,
      hasGrain: false,
      lightingMode: 'catalog',
    });
    expect(catalog.clearcoat).toBe(tex.clearcoat);
  });
});

const LIGHTING_MODES: readonly SceneLightingMode[] = [
  'workshop',
  'soft',
  'present',
  'catalog',
];

const SURFACE_KINDS: readonly {
  readonly kind: string;
  readonly hasMap: boolean;
  readonly hasGrain: boolean;
}[] = [
  { kind: 'map', hasMap: true, hasGrain: false },
  { kind: 'grain', hasMap: false, hasGrain: true },
  { kind: 'solid', hasMap: false, hasGrain: false },
];

describe('resolveBoardPhysicalResponse', () => {
  // PBR-03 — golden no-regression: undefined materialPbr MUST byte-for-byte equal
  // today's boardPhysicalResponse() across every lighting mode × surface kind.
  it.each(LIGHTING_MODES)(
    'golden no-regression for lighting mode "%s" (map/grain/solid)',
    (mode) => {
      for (const surface of SURFACE_KINDS) {
        const base = boardPhysicalResponse({
          hasMap: surface.hasMap,
          hasGrain: surface.hasGrain,
          lightingMode: mode,
        });
        const resolved = resolveBoardPhysicalResponse({
          hasMap: surface.hasMap,
          hasGrain: surface.hasGrain,
          lightingMode: mode,
          materialPbr: undefined,
        });
        expect(resolved).toEqual(base);
      }
    },
  );

  it('golden no-regression: all 12 mode×surface cells keep all 5 fields (PBR-03)', () => {
    expect.assertions(12 * 5);
    for (const mode of LIGHTING_MODES) {
      for (const surface of SURFACE_KINDS) {
        const base = boardPhysicalResponse({
          hasMap: surface.hasMap,
          hasGrain: surface.hasGrain,
          lightingMode: mode,
        });
        const resolved = resolveBoardPhysicalResponse({
          hasMap: surface.hasMap,
          hasGrain: surface.hasGrain,
          lightingMode: mode,
        });
        expect(resolved.roughness).toBe(base.roughness);
        expect(resolved.metalness).toBe(base.metalness);
        expect(resolved.clearcoat).toBe(base.clearcoat);
        expect(resolved.clearcoatRoughness).toBe(base.clearcoatRoughness);
        expect(resolved.envMapIntensity).toBe(base.envMapIntensity);
      }
    }
  });

  it('partial override (roughness only) keeps the rest from base (PBR-02)', () => {
    const base = boardPhysicalResponse({
      hasMap: true,
      hasGrain: false,
      lightingMode: 'present',
    });
    const resolved = resolveBoardPhysicalResponse({
      hasMap: true,
      hasGrain: false,
      lightingMode: 'present',
      materialPbr: { roughness: 0.6 },
    });
    expect(resolved.roughness).toBe(0.6);
    expect(resolved.metalness).toBe(base.metalness);
    expect(resolved.clearcoat).toBe(base.clearcoat);
    expect(resolved.clearcoatRoughness).toBe(base.clearcoatRoughness);
    expect(resolved.envMapIntensity).toBe(base.envMapIntensity);
  });

  it('full override uses all three material values (clamped)', () => {
    const resolved = resolveBoardPhysicalResponse({
      hasMap: false,
      hasGrain: false,
      lightingMode: 'workshop',
      materialPbr: { roughness: 0.3, metalness: 0.9, clearcoat: 0.6 },
    });
    expect(resolved.roughness).toBe(0.3);
    expect(resolved.metalness).toBe(0.9);
    expect(resolved.clearcoat).toBe(0.6);
  });

  it('clamps out-of-range finite values to [0,1]', () => {
    const resolved = resolveBoardPhysicalResponse({
      hasMap: true,
      hasGrain: false,
      lightingMode: 'present',
      materialPbr: { roughness: 1.5, metalness: -0.2 },
    });
    expect(resolved.roughness).toBe(1.0);
    expect(resolved.metalness).toBe(0.0);
  });

  it('falls back to base for NaN / Infinity, never forced 0 (PBR-04)', () => {
    const base = boardPhysicalResponse({
      hasMap: true,
      hasGrain: false,
      lightingMode: 'present',
    });
    const resolved = resolveBoardPhysicalResponse({
      hasMap: true,
      hasGrain: false,
      lightingMode: 'present',
      materialPbr: {
        metalness: Number.NaN,
        clearcoat: Number.POSITIVE_INFINITY,
      },
    });
    expect(resolved.metalness).toBe(base.metalness);
    expect(resolved.clearcoat).toBe(base.clearcoat);
    // Map+present base metalness is 0.03 — proves the fallback is the base, not 0.
    expect(base.metalness).toBe(0.03);
  });
});
