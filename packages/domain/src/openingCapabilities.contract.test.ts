/**
 * #1134 — paridad compartida TS del blob de capacidades de apertura. El
 * MISMO fixture lo consume el engine Go (opening_capabilities_contract_test
 * .go): version estricta, vocabulario cerrado, claves desconocidas = error
 * (las dimensiones viven en el OpeningProfile), available ≠ valid.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  availableOpeningSystems,
  parseOpeningCapabilities,
  type OpeningCapabilities,
} from './openingCapabilities';

interface FixtureCase {
  readonly name: string;
  readonly overrides: Record<string, unknown>;
  readonly expected: OpeningCapabilities | null;
}

interface Fixture {
  readonly schema: number;
  readonly contract: string;
  readonly cases: readonly FixtureCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/openingCapabilities.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('contracts/openingCapabilities.contract.json (#1134)', () => {
  it('is schema 1 of the opening-front contract', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.contract).toBe('granete.opening-front.v1');
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))(
    'lectura: %s',
    (_name, testCase) => {
      const result = parseOpeningCapabilities(testCase.overrides);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.capabilities).toEqual(testCase.expected);
    },
  );

  it('undefined y null son ausencia de decisión, no error', () => {
    for (const absent of [undefined, null, {}]) {
      const result = parseOpeningCapabilities(absent);
      expect(result).toEqual({ ok: true, capabilities: null });
    }
  });
});

describe('openingCapabilities — fail-closed y available ≠ valid (#1134)', () => {
  const base = {
    version: 1,
    grips: { handle: { enabled: true, default: true } },
  };

  it('versión futura falla cerrado (sin fallback)', () => {
    const result = parseOpeningCapabilities({
      'opening.capabilities': { ...base, version: 2 },
    });
    expect(result.ok).toBe(false);
  });

  it('sistema desconocido y claves dimensionales fallan cerrado', () => {
    expect(parseOpeningCapabilities({
      'opening.capabilities': {
        version: 1,
        grips: { integrated_profile: { enabled: true } },
      },
    })).toMatchObject({ ok: false });
    expect(parseOpeningCapabilities({
      'opening.capabilities': { ...base, maxReductionMm: 5 },
    })).toMatchObject({ ok: false });
  });

  it('dos defaults y profiles fuera de gola fallan cerrado', () => {
    expect(parseOpeningCapabilities({
      'opening.capabilities': {
        version: 1,
        grips: {
          handle: { enabled: true, default: true },
          bottom_overhang: { enabled: true, default: true },
        },
      },
    }).ok).toBe(false);
    expect(parseOpeningCapabilities({
      'opening.capabilities': {
        version: 1,
        grips: { handle: { enabled: true, profiles: ['profile.x'] } },
      },
    }).ok).toBe(false);
  });

  it('tipo de mueble y placement desconocidos fallan cerrado', () => {
    expect(parseOpeningCapabilities({
      'opening.capabilities': {
        ...base,
        byFurnitureType: { medio: { grips: {} } },
      },
    }).ok).toBe(false);
    expect(parseOpeningCapabilities({
      'opening.capabilities': {
        ...base,
        byFurnitureType: { superior: { grips: { gola: { placements: ['left'] } } } },
      },
    }).ok).toBe(false);
  });

  it('available ≠ valid: deshabilitar no muta al resolver ni a los diseños', () => {
    // La oferta ("available") viene de las capacidades…
    const capabilities: OpeningCapabilities = {
      version: 1,
      grips: { handle: { enabled: true, default: true }, gola: { enabled: false } },
    };
    expect(availableOpeningSystems(capabilities)).toEqual(['handle']);
    expect(availableOpeningSystems(null)).toEqual(['handle', 'gola', 'bottom_overhang']);
  });
});
