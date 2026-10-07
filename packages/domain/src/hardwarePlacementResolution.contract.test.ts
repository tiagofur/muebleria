/**
 * #1046 aceptación #6 / #1210 — paridad compartida TS del contrato de
 * resolución de placements de herraje por rol. El MISMO fixture lo consume
 * el engine Go (hardware_placement_contract_test.go): una sola autoridad
 * para la precedencia concreto>rol, los estados de resolución y la regla
 * posiciones-ganan sobre las líneas en cantidad.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HardwarePlacement, HardwareLine, OptionChoices } from './types';
import { resolvePlacementHardwareId } from './hardwarePlacement';
import {
  collectPlacementHardwareCounts,
  moduleHardwareLinesWithoutPositioned,
} from './engine/bom';
import { ResolutionError } from './errors';

interface ResolutionCase {
  readonly name: string;
  readonly groupRequired: boolean;
  readonly placement: HardwarePlacement;
  readonly choices: OptionChoices;
  readonly expectedStatus: 'concrete' | 'resolved' | 'unresolved' | 'invalid';
  readonly expectedHardwareId?: string;
  readonly expectedOptionRole?: string;
}

interface DemandCase {
  readonly name: string;
  readonly componentQuantity: number;
  readonly placements: readonly HardwarePlacement[];
  readonly bulkLines: readonly HardwareLine[];
  readonly choices: OptionChoices;
  readonly expectedPositioned: readonly { readonly hardwareId: string; readonly quantity: number }[];
  readonly expectedBulkKept: readonly string[];
  readonly expectedBulkDropped: readonly string[];
}

interface Fixture {
  readonly schema: number;
  readonly hardware: readonly { readonly id: string }[];
  readonly resolutionCases: readonly ResolutionCase[];
  readonly demandCases: readonly DemandCase[];
}

const fixturePath = resolve(__dirname, '../../../contracts/hardwarePlacementResolution.contract.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('contracts/hardwarePlacementResolution.contract.json (#1046 #6 / #1210)', () => {
  it('is schema 1 with resolvable hardware entities', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.hardware.length).toBeGreaterThan(0);
  });

  it.each(fixture.resolutionCases.map((c) => [c.name, c] as const))(
    'resolution: %s',
    (_name, testCase) => {
      const resolution = resolvePlacementHardwareId(
        testCase.placement,
        testCase.choices,
      );

      expect(resolution.status).toBe(testCase.expectedStatus);
      if (resolution.status === 'invalid') {
        // The invalid case must always surface as a ResolutionError through
        // the BOM demand path (#1147) — never a silent $0.
        expect(() =>
          collectPlacementHardwareCounts(
            [
              {
                componentId: 'comp-contract',
                quantity: 1,
                overrides: { hardwarePlacements: [testCase.placement] },
              },
            ],
            testCase.choices,
            'MOD-CONTRACT',
          ),
        ).toThrow(ResolutionError);
        return;
      }
      if (testCase.expectedHardwareId !== undefined) {
        expect(resolution.hardwareId).toBe(testCase.expectedHardwareId);
      }
      if (testCase.expectedOptionRole !== undefined) {
        expect(
          resolution.status === 'unresolved' ? resolution.optionRole : undefined,
        ).toBe(testCase.expectedOptionRole);
      }
    },
  );

  it.each(fixture.demandCases.map((c) => [c.name, c] as const))(
    'demand: %s',
    (_name, testCase) => {
      const componentInstances = [
        {
          componentId: 'comp-contract',
          quantity: testCase.componentQuantity,
          overrides: { hardwarePlacements: testCase.placements },
        },
      ];

      const counts = collectPlacementHardwareCounts(
        componentInstances,
        testCase.choices,
        'MOD-CONTRACT',
      );
      for (const expected of testCase.expectedPositioned) {
        expect(counts.get(expected.hardwareId)).toBe(expected.quantity);
      }

      const kept = moduleHardwareLinesWithoutPositioned(
        testCase.bulkLines,
        counts,
        testCase.choices,
      );
      expect(kept.map((line) => line.id)).toEqual([...testCase.expectedBulkKept]);
      const keptIds = new Set(kept.map((line) => line.id));
      for (const dropped of testCase.expectedBulkDropped) {
        expect(keptIds.has(dropped)).toBe(false);
      }
    },
  );
});
