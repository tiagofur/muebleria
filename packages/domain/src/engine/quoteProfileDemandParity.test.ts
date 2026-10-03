/**
 * Quote profile demand pricing parity (#986) — same file the Go engine test
 * consumes: contracts/quoteProfileDemandParity.contract.json. The governed
 * resolve's demand prices exactly like a manual hardware line in both
 * runtimes, and invalid demand hardware fails closed in both.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { calcHardwareLineCost, calcProfileDemandHardwareTotal } from './pricing';
import type { Catalog, ResolvedHardwareLine } from '../types';

const CONTRACTS = join(dirname(fileURLToPath(import.meta.url)), '../../../..', 'contracts');

interface ParityCase {
  readonly name: string;
  readonly quantityMultiplier: number;
  readonly manualHardwareLines: readonly ResolvedHardwareLine[];
  readonly profileDemandLines: ReadonlyArray<{ readonly hardwareId: string; readonly quantity: number }>;
  readonly expectedHardwareTotal: number;
}

interface FailClosedCase {
  readonly name: string;
  readonly quantityMultiplier: number;
  readonly profileDemandLines: ReadonlyArray<{ readonly hardwareId: string; readonly quantity: number }>;
}

const fixture = JSON.parse(
  readFileSync(join(CONTRACTS, 'quoteProfileDemandParity.contract.json'), 'utf8'),
) as {
  readonly catalog: Catalog;
  readonly cases: readonly ParityCase[];
  readonly failClosed: readonly FailClosedCase[];
};

describe('quote profile demand parity contract', () => {
  for (const parityCase of fixture.cases) {
    test(parityCase.name, () => {
      let manual = 0;
      for (const line of parityCase.manualHardwareLines) {
        manual += calcHardwareLineCost(line, fixture.catalog, parityCase.quantityMultiplier).hardwareCost;
      }
      const demand = calcProfileDemandHardwareTotal(
        parityCase.profileDemandLines,
        fixture.catalog,
        parityCase.quantityMultiplier,
      );
      expect(manual + demand).toBeCloseTo(parityCase.expectedHardwareTotal, 9);
    });
  }

  for (const failCase of fixture.failClosed) {
    test(`fail closed: ${failCase.name}`, () => {
      expect(() =>
        calcProfileDemandHardwareTotal(failCase.profileDemandLines, fixture.catalog, failCase.quantityMultiplier),
      ).toThrow();
    });
  }
});
