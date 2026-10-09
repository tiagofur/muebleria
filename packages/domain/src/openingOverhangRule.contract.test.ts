/**
 * #1138 — paridad compartida TS del blob de la regla de rebase inferior. El
 * MISMO fixture lo consume el engine Go (opening_overhang_rule_contract_test
 * .go): version estricta, entero positivo, claves desconocidas = error,
 * ausencia = sin regla (BLOCKED veraz, jamás un default).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPENING_OVERHANG_RULE_BLOB_KEY,
  parseOpeningOverhangRule,
  type OpeningOverhangRule,
} from './openingOverhangRule';

interface FixtureCase {
  readonly name: string;
  readonly overrides: Record<string, unknown> | null;
  readonly expected: OpeningOverhangRule | null;
}

interface Fixture {
  readonly schema: number;
  readonly contract: string;
  readonly cases: readonly FixtureCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/openingOverhangRule.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('contracts/openingOverhangRule.contract.json (#1138)', () => {
  it('is schema 1 of the opening-front contract', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.contract).toBe('granete.opening-front.v1');
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))(
    'lectura: %s',
    (_name, testCase) => {
      const result = parseOpeningOverhangRule(testCase.overrides);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rule).toEqual(testCase.expected);
    },
  );

  it.each([
    ['versión futura no se interpreta', { version: 2, overhangMm: 40 }],
    ['overhangMm cero', { version: 1, overhangMm: 0 }],
    ['overhangMm negativo', { version: 1, overhangMm: -40 }],
    ['overhangMm no entero', { version: 1, overhangMm: 40.5 }],
    ['overhangMm ausente', { version: 1 }],
    ['overhangMm no numérico', { version: 1, overhangMm: '40' }],
    ['clave desconocida', { version: 1, overhangMm: 40, bodyShiftMm: 10 }],
    ['blob no objeto', 'regla'],
  ] as const)('error de forma: %s', (_name, blob) => {
    const result = parseOpeningOverhangRule({ [OPENING_OVERHANG_RULE_BLOB_KEY]: blob });
    expect(result.ok).toBe(false);
  });

  it('el blob no puede ser una lista', () => {
    const result = parseOpeningOverhangRule({ [OPENING_OVERHANG_RULE_BLOB_KEY]: [40] });
    expect(result.ok).toBe(false);
  });
});
