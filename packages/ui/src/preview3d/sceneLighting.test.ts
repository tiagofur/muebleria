import { describe, expect, it } from 'vitest';
import {
  boardPhysicalResponse,
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
  });
});
