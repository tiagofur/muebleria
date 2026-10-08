/**
 * #1135 — paridad compartida TS del validador de configuraciones de
 * apertura. El MISMO fixture lo consume el engine Go
 * (opening_configuration_validation_test.go): tres estados, gate de
 * capacidades sólo para autoría nueva, vocabulario cerrado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openingSelectionReasonMessage,
  OPENING_REASON,
  validateOpeningConfiguration,
  type OpeningConfigurationSelection,
  type OpeningConfigurationValidation,
  type OpeningProfileSelectionData,
} from './openingConfigurationValidation';
import type { OpeningCapabilities } from './openingCapabilities';

interface FixtureCase {
  readonly name: string;
  readonly selection: OpeningConfigurationSelection;
  readonly capabilities: OpeningCapabilities | null;
  readonly profiles: readonly OpeningProfileSelectionData[];
  readonly expected: OpeningConfigurationValidation;
}

interface Fixture {
  readonly schema: number;
  readonly contract: string;
  readonly cases: readonly FixtureCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/openingConfigurationValidation.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('contracts/openingConfigurationValidation.contract.json (#1135)', () => {
  it('is schema 1 of the opening-front contract', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.contract).toBe('granete.opening-front.v1');
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))(
    'validación: %s',
    (_name, testCase) => {
      const got = validateOpeningConfiguration(
        testCase.selection,
        testCase.capabilities,
        testCase.profiles,
      );
      expect(got).toEqual(testCase.expected);
    },
  );
});

describe('openingConfigurationValidation — invariantes fuera del fixture (#1135)', () => {
  it('el mensaje de cada razón es total: la UI nunca imprime el código solo', () => {
    for (const reason of Object.values(OPENING_REASON)) {
      expect(openingSelectionReasonMessage(reason)).not.toBe(reason);
    }
  });

  it('cambiar la capacidad de hoy no cambia una resolución histórica (el validador no la toca)', () => {
    // La semántica histórica vive en el resolver con los datos pineados que
    // el llamador pasa; el validador sólo gobierna AUTORÍA NUEVA.
    const disabled: OpeningCapabilities = {
      version: 1,
      grips: { handle: { enabled: true, default: true }, gola: { enabled: false } },
    };
    const selection: OpeningConfigurationSelection = { system: 'gola', profileId: 'p' };
    const profiles = [{ profileId: 'p', compatiblePlacements: ['top'], datasheetStatus: 'verified' }];
    // Hoy: la selección nueva se rechaza…
    expect(validateOpeningConfiguration(selection, disabled, profiles)).toMatchObject({
      state: 'invalid',
      reason: OPENING_REASON.systemUnavailable,
    });
    // …y el mismo diseño persistido resuelve igual con los datos pineados:
    // el resolver no consume capacidades (fijado por el fixture #1129/#1131).
    expect(validateOpeningConfiguration(selection, null, profiles)).toMatchObject({ state: 'valid' });
  });
});
