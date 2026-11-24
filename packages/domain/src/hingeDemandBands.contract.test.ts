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
  hingeDemandNotice,
  hingeDemandRole,
  hingesForDoor,
  resolveHingeCount,
  validateHingeDemandTable,
  type HingeDemandPolicy,
} from './hingeDemand';
import { hingePolicyForDoor } from './engine/hingeBandDemand';
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

/** #1579: one hinge's table checked against one door. */
interface HingeTableCase extends DemandCase {
  /** The count the `against` table buys for the SAME door. */
  readonly expectedHingesAgainst?: number;
}

interface HingeTableGroup {
  readonly name: string;
  readonly table: string;
  readonly against?: string;
  readonly cases: readonly HingeTableCase[];
}

interface LadderCase {
  readonly name: string;
  readonly factory: boolean;
  readonly table: string | null;
  readonly exception: boolean;
  readonly heightMm: number;
  readonly widthMm?: number;
  readonly expectedHinges: number;
}

interface OverflowCase extends DemandCase {
  readonly table: string;
  readonly expectedAboveLastBand: boolean;
  readonly expectedLastBandHeightMm: number;
  readonly expectedNotice: string | null;
}

/** #1579: a hinge table and the reason it is (or is not) writable. */
interface TableValidationCase {
  readonly name: string;
  readonly table: string | null;
  readonly expectedError: string | null;
}

interface Fixture {
  readonly schema: number;
  readonly defaultPolicy: HingeDemandPolicy & { readonly optionRole: string };
  readonly demandCases: readonly DemandCase[];
  readonly overrideCases: readonly OverrideCase[];
  readonly hingeTables: Readonly<Record<string, HingeDemandPolicy>>;
  readonly hingeTableCases: readonly HingeTableGroup[];
  readonly ladder: {
    readonly componentId: string;
    readonly factoryPolicy: HingeDemandPolicy;
    readonly exception: HingeDemandPolicy;
    readonly cases: readonly LadderCase[];
  };
  readonly overflowCases: readonly OverflowCase[];
  readonly tableValidationCases: readonly TableValidationCase[];
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

  // --- #1579: the table a hinge declares for itself ---

  it.each(
    fixture.hingeTableCases.flatMap((group) =>
      group.cases.map((c) => [group.name, c] as const),
    ),
  )('hinge table: %s → %s', (groupName, testCase) => {
    const group = fixture.hingeTableCases.find((g) => g.name === groupName)!;
    const table = fixture.hingeTables[group.table]!;
    expect(hingesForDoor(testCase.heightMm, testCase.widthMm, table)).toBe(
      testCase.expectedHinges,
    );
    // Same door, other hinge: the count follows the hinge effectively chosen.
    if (group.against && testCase.expectedHingesAgainst !== undefined) {
      expect(
        hingesForDoor(
          testCase.heightMm,
          testCase.widthMm,
          fixture.hingeTables[group.against]!,
        ),
      ).toBe(testCase.expectedHingesAgainst);
    }
  });

  it.each(fixture.ladder.cases.map((c) => [c.name, c] as const))(
    'ladder: %s',
    (_name, testCase) => {
      const { componentId, factoryPolicy, exception } = fixture.ladder;
      const policySource = {
        ...(testCase.factory ? { doorHingeDemand: factoryPolicy } : {}),
        ...(testCase.exception
          ? { componentOverrides: { [componentId]: { hingeDemand: exception } } }
          : {}),
      };
      const hinge = testCase.table
        ? { hingeDemand: fixture.hingeTables[testCase.table]! }
        : {};
      const count = resolveHingeCount(
        testCase.heightMm,
        testCase.widthMm,
        hingePolicyForDoor(policySource, componentId, hinge),
      );
      expect(count.hinges).toBe(testCase.expectedHinges);
    },
  );

  it.each(fixture.overflowCases.map((c) => [c.name, c] as const))(
    'overflow: %s',
    (_name, testCase) => {
      const count = resolveHingeCount(
        testCase.heightMm,
        testCase.widthMm,
        fixture.hingeTables[testCase.table]!,
      );
      expect(count.hinges).toBe(testCase.expectedHinges);
      expect(count.aboveLastBand).toBe(testCase.expectedAboveLastBand);
      expect(count.lastBandHeightMm).toBe(testCase.expectedLastBandHeightMm);
      expect(hingeDemandNotice(testCase.heightMm, count) ?? null).toBe(
        testCase.expectedNotice,
      );
    },
  );

  it.each(fixture.tableValidationCases.map((c) => [c.name, c] as const))(
    'table validation: %s',
    (_name, testCase) => {
      const table = testCase.table ? fixture.hingeTables[testCase.table] : null;
      expect(validateHingeDemandTable(table)).toBe(testCase.expectedError);
    },
  );
});
