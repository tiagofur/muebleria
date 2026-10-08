/**
 * #1133 — paridad compartida TS del resolver de BOM de perfiles. El MISMO
 * fixture lo consume el engine Go (opening_bom_contract_test.go): corridas
 * con la regla declarada, soportes por ficha (sin spacing inventado), tapas
 * por condición de extremo resuelta, proveniencia completa y fail-closed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveOpeningBOM,
  type OpeningBOMEndConditions,
  type OpeningProfileBOMData,
  type OpeningResolvedBOMLine,
} from './openingBom';
import type { OpeningFrontLayout } from './openingFrontLayout';

interface FixtureProfile {
  readonly profileId: string;
  readonly version: number;
  readonly bomMembers: OpeningProfileBOMData['bomMembers'];
}

interface FixtureCase {
  readonly name: string;
  readonly cabinetInteriorWidthMm: number;
  readonly ends: OpeningBOMEndConditions;
  readonly layout: OpeningFrontLayout;
  readonly profiles: readonly FixtureProfile[];
  readonly expectedLines?: readonly OpeningResolvedBOMLine[];
  readonly expectedErrorCode?: string;
}

interface Fixture {
  readonly schema: number;
  readonly contract: string;
  readonly resolutionCases: readonly FixtureCase[];
  readonly invalidCases: readonly FixtureCase[];
}

const fixturePath = resolve(__dirname, '../../../contracts/openingBom.contract.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

const profilesOf = (testCase: FixtureCase): OpeningProfileBOMData[] =>
  (testCase.profiles ?? []).map((profile) => ({
    profileId: profile.profileId,
    version: profile.version,
    bomMembers: profile.bomMembers,
  }));

describe('contracts/openingBom.contract.json (#1133)', () => {
  it('is schema 1 of the opening-front contract', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.contract).toBe('granete.opening-front.v1');
  });

  it.each(fixture.resolutionCases.map((c) => [c.name, c] as const))(
    'líneas: %s',
    (_name, testCase) => {
      const result = resolveOpeningBOM(
        testCase.layout,
        testCase.cabinetInteriorWidthMm,
        testCase.ends,
        profilesOf(testCase),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.lines).toEqual(testCase.expectedLines ?? []);
      // Idempotence: resolving again yields the identical list.
      const again = resolveOpeningBOM(
        testCase.layout,
        testCase.cabinetInteriorWidthMm,
        testCase.ends,
        profilesOf(testCase),
      );
      expect(again).toEqual(result);
    },
  );

  it.each(fixture.invalidCases.map((c) => [c.name, c] as const))(
    'inválido falla cerrado: %s',
    (_name, testCase) => {
      const result = resolveOpeningBOM(
        testCase.layout,
        testCase.cabinetInteriorWidthMm,
        testCase.ends,
        profilesOf(testCase),
      );
      expect(result).toMatchObject({ ok: false, errorCode: testCase.expectedErrorCode });
    },
  );
});

describe('openingBom — invariantes fuera del fixture (#1133)', () => {
  const layout: OpeningFrontLayout = {
    contract: 'granete.opening-front.v1',
    resolution: {
      availableFrontHeightMm: 650,
      zones: [{ id: 'z1', heightMm: 650, offsetFromStartMm: 0 }],
      boundaries: [{ boundary: 'top', consumedMm: 70 }],
      remainderZoneId: 'z1',
    },
    fronts: [
      {
        zoneId: 'z1',
        access: 'hinged',
        widthMm: 650,
        heightMm: 720,
        offsetMm: 0,
        grips: [{ boundary: 'top', side: 'above', profileId: 'p', consumedMm: 70 }],
        rules: {
          direction: 'horizontal',
          positioning: 'overlay',
          ratio: 1,
          ratioSum: 1,
          remainderTarget: true,
        },
      },
    ],
  };
  const ends: OpeningBOMEndConditions = { leftEnd: 'exposed', rightEnd: 'exposed' };

  it('la corrida presenta la longitud exacta en metros junto al corte en mm', () => {
    const result = resolveOpeningBOM(
      layout,
      567,
      ends,
      [{ profileId: 'p', version: 1, bomMembers: { profile: { hardwareId: 'x', rule: 'interior_width', unit: 'meter' } } }],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]).toMatchObject({
      lineId: 'top|profile',
      quantity: 0.567,
      unit: 'meter',
      cutLengthMm: 567,
      profileVersion: 1,
    });
  });

  it('el perfil desconocido se propaga verbatim', () => {
    const result = resolveOpeningBOM(layout, 564, ends, []);
    expect(result).toMatchObject({ ok: false, errorCode: 'OPENING_PROFILE_UNKNOWN' });
  });
});
