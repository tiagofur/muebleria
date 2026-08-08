import { describe, expect, it } from 'vitest';
import {
  boardPhysicalResponse,
  CATALOG_PHOTO_BACKGROUND,
  planSceneLighting,
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
