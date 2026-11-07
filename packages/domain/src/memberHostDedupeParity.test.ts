/**
 * #1557 — paridad TS↔Go del dedupe member-host/manual (#1429 slice B). El
 * MISMO fixture lo consume el engine Go (member_host_dedupe_parity_test.go):
 * exacto, sub-umbral (≤0.1mm Chebyshev por eje), fuera de umbral y cara
 * distinta — la autoría manual del owner manda, no-equivalentes conviven.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { HoleDefinition } from './partDrilling';
import { memberHostHoleIsEquivalent } from './memberHostDrilling';

interface DedupeFixture {
  readonly toleranceMm: number;
  readonly cases: readonly {
    readonly name: string;
    readonly hole: Omit<HoleDefinition, 'type' | 'description'>;
    readonly manual: Omit<HoleDefinition, 'type' | 'description'>;
    readonly equivalent: boolean;
  }[];
}

const fixturePath = resolve(__dirname, '../../../contracts/fixtures/memberHostDedupe.contract.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as DedupeFixture;

describe('memberHostDedupe contract (#1557)', () => {
  it('declara la tolerancia 0.1mm y al menos 3 casos', () => {
    expect(fixture.toleranceMm).toBe(0.1);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(3);
  });

  for (const tc of fixture.cases) {
    it(`${tc.name}: ${tc.equivalent ? 'equivalente (el manual manda)' : 'no equivalente (conviven)'}`, () => {
      const hole = { ...tc.hole, type: 'screw' as const, description: 'member-host' };
      const manual = { ...tc.manual, type: 'screw' as const, description: 'manual' };
      expect(memberHostHoleIsEquivalent(hole, [manual])).toBe(tc.equivalent);
    });
  }
});
