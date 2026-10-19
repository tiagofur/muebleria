/**
 * #1209 PR2 — shared TS↔Go parity contract: the closed commercial finish
 * preset vocabulary. This suite pins the TS renderer presets
 * byte-identically to `contracts/hardwareFinishPresets.contract.json`; the Go
 * side (`catalog_finishes_contract_test.go`) pins its vocabulary + snapshot
 * labels to the same file. Any runtime drifting from the fixture fails here.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../../../contracts/hardwareFinishPresets.contract.json';
import { HARDWARE_FINISHES, isHardwareFinishId } from './hardwareFinishes';

describe('hardware finish presets parity contract', () => {
  it('pins the renderer preset set to the fixture, in order', () => {
    expect(HARDWARE_FINISHES.map((f) => f.id)).toEqual(
      fixture.presets.map((p) => p.id),
    );
  });

  it('accepts exactly the fixture ids and nothing else', () => {
    for (const p of fixture.presets) {
      expect(isHardwareFinishId(p.id)).toBe(true);
    }
    expect(isHardwareFinishId('rose-gold')).toBe(false);
    expect(isHardwareFinishId('')).toBe(false);
    expect(isHardwareFinishId(undefined)).toBe(false);
  });
});
