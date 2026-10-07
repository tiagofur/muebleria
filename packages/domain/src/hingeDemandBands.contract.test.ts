/**
 * #1078 — paridad compartida TS del contrato de demanda de bisagras por
 * banda de altura. El MISMO fixture lo consume el engine Go
 * (hinge_demand_contract_test.go): una sola autoridad para la escalera
 * ≤900→2 / 901–1600→3 / 1601–2000→4 / 2001–2400→5 (clamp), el recargo Blum
 * por ancho y las bandas custom de fábrica.
 *
 * Aceptación #3: la perforación de cazoletas cuenta lo mismo que la demanda
 * — hingePositions deriva su conteo de la MISMA política.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HINGE_DEMAND_POLICY,
  HINGE_DEMAND_ROLE,
  hingeDemandRole,
  hingesForDoor,
  type HingeDemandPolicy,
} from './hingeDemand';
import { hingePositions } from './jointDrillingRules';

interface DemandCase {
  readonly name: string;
  readonly heightMm: number;
  readonly widthMm?: number;
  readonly expectedHinges: number;
}

interface OverrideCase {
  readonly name: string;
  readonly policy: HingeDemandPolicy;
  readonly cases: readonly DemandCase[];
}

interface Fixture {
  readonly schema: number;
  readonly defaultPolicy: HingeDemandPolicy & { readonly optionRole: string };
  readonly demandCases: readonly DemandCase[];
  readonly overrideCases: readonly OverrideCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/hingeDemandBands.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('contracts/hingeDemandBands.contract.json (#1078)', () => {
  it('is schema 1 and the fixture default policy matches the library default', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.defaultPolicy.bands).toEqual(DEFAULT_HINGE_DEMAND_POLICY.bands);
    expect(fixture.defaultPolicy.widthSurgeOverMm).toBe(
      DEFAULT_HINGE_DEMAND_POLICY.widthSurgeOverMm,
    );
    expect(fixture.defaultPolicy.optionRole).toBe(HINGE_DEMAND_ROLE);
  });

  it.each(fixture.demandCases.map((c) => [c.name, c] as const))(
    'demand: %s',
    (_name, testCase) => {
      expect(
        hingesForDoor(testCase.heightMm, testCase.widthMm, fixture.defaultPolicy),
      ).toBe(testCase.expectedHinges);
      // Library default == fixture policy: both entry points agree.
      expect(hingesForDoor(testCase.heightMm, testCase.widthMm)).toBe(
        testCase.expectedHinges,
      );
    },
  );

  it.each(
    fixture.overrideCases.flatMap((oc) =>
      oc.cases.map((c) => [`${oc.name}: ${c.heightMm}mm`, oc.policy, c] as const),
    ),
  )('override: %s', (_name, policy, testCase) => {
    expect(hingesForDoor(testCase.heightMm, testCase.widthMm, policy)).toBe(
      testCase.expectedHinges,
    );
  });

  it('drilling positions count exactly what demand buys (aceptación #3)', () => {
    for (const testCase of fixture.demandCases) {
      const expected = testCase.expectedHinges;
      if (expected === 0) {
        expect(hingePositions(testCase.heightMm, 100, 32, testCase.widthMm)).toEqual(
          [],
        );
        continue;
      }
      const positions = hingePositions(
        testCase.heightMm,
        100,
        32,
        testCase.widthMm,
      );
      expect(positions).toHaveLength(expected);
    }
  });

  it('hingeDemandRole falls back to BISAGRA and honors the policy role', () => {
    expect(hingeDemandRole(undefined)).toBe(HINGE_DEMAND_ROLE);
    expect(hingeDemandRole({ bands: [] })).toBe(HINGE_DEMAND_ROLE);
    expect(hingeDemandRole(fixture.overrideCases[1]!.policy)).toBe('BISAGRA_PREMIUM');
  });
});
