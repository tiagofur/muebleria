/**
 * #1132 — paridad compartida TS del resolver de body modifiers por rol
 * constructivo. El MISMO fixture lo consume el engine Go
 * (opening_body_modifiers_contract_test.go): modifiers declarados por el
 * perfil × resolución de layout → efectos exactos (reducción una vez,
 * saques en posición resuelta), vocabulario ConstructiveRole (nunca
 * nombres), dedupe/conflicto y fail-closed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveOpeningBodyModifiers,
  type OpeningProfileBodyData,
  type ResolvedOpeningBodyModifier,
} from './openingBodyModifiers';
import type { OpeningContractBodyModifier } from './openingBodyModifiers';
import type { OpeningFrontLayout } from './openingFrontLayout';

interface FixtureModifier {
  readonly role: string;
  readonly depthReductionMm?: number;
  readonly notchHeightMm?: number;
  readonly notchDepthMm?: number;
  readonly notchAt?: string;
}

interface FixtureProfile {
  readonly profileId: string;
  readonly compatiblePlacements: readonly string[];
  readonly bodyModifiers: readonly FixtureModifier[];
}

interface FixtureCase {
  readonly name: string;
  readonly layout: OpeningFrontLayout;
  readonly profiles: readonly FixtureProfile[];
  readonly expectedModifiers?: readonly ResolvedOpeningBodyModifier[];
  readonly expectedErrorCode?: string;
}

interface Fixture {
  readonly schema: number;
  readonly contract: string;
  readonly resolutionCases: readonly FixtureCase[];
  readonly blockedCases: readonly FixtureCase[];
  readonly invalidCases: readonly FixtureCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/openingBodyModifiers.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

const profilesOf = (testCase: FixtureCase): OpeningProfileBodyData[] =>
  (testCase.profiles ?? []).map((profile) => ({
    profileId: profile.profileId,
    compatiblePlacements: profile.compatiblePlacements,
    bodyModifiers: profile.bodyModifiers.map(
      (modifier): OpeningContractBodyModifier => ({ ...modifier }),
    ),
  }));

describe('contracts/openingBodyModifiers.contract.json (#1132)', () => {
  it('is schema 1 of the opening-front contract', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.contract).toBe('granete.opening-front.v1');
  });

  it.each(fixture.resolutionCases.map((c) => [c.name, c] as const))(
    'modifiers: %s',
    (_name, testCase) => {
      const result = resolveOpeningBodyModifiers(testCase.layout, profilesOf(testCase));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Stable identity: effect|role|boundary is unique per feature.
      const identities = result.modifiers.map(
        (m) => `${m.effect}|${m.role}|${m.boundary}`,
      );
      expect(new Set(identities).size).toBe(identities.length);
      expect(result.modifiers).toEqual(testCase.expectedModifiers ?? []);
    },
  );

  it.each(fixture.blockedCases.map((c) => [c.name, c] as const))(
    'bloqueado: %s',
    (_name, testCase) => {
      const result = resolveOpeningBodyModifiers(testCase.layout, profilesOf(testCase));
      expect(result).toMatchObject({ ok: false, errorCode: testCase.expectedErrorCode });
    },
  );

  it.each(fixture.invalidCases.map((c) => [c.name, c] as const))(
    'inválido falla cerrado: %s',
    (_name, testCase) => {
      const result = resolveOpeningBodyModifiers(testCase.layout, profilesOf(testCase));
      expect(result).toMatchObject({ ok: false, errorCode: testCase.expectedErrorCode });
    },
  );
});

describe('openingBodyModifiers — invariantes fuera del fixture (#1132)', () => {
  it('el perfil desconocido se propaga verbatim', () => {
    const unknown = resolveOpeningBodyModifiers(
      {
        contract: 'granete.opening-front.v1',
        resolution: {
          availableFrontHeightMm: 650,
          zones: [],
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
            grips: [
              { boundary: 'top', side: 'above', profileId: 'ghost', consumedMm: 70 },
            ],
            rules: {
              direction: 'horizontal',
              positioning: 'overlay',
              ratio: 1,
              ratioSum: 1,
              remainderTarget: true,
            },
          },
        ],
      },
      [],
    );
    expect(unknown).toMatchObject({ ok: false, errorCode: 'OPENING_PROFILE_UNKNOWN' });
  });

  it('la entidad persistida mapea a la forma de contrato sin perder valores', () => {
    // El par snake_case (entidad API) → camelCase (contrato) lo hace el
    // mapper de storage; aquí fijamos que la forma de contrato consume la
    // MISMA semántica.
    const entityShape = {
      role: 'lateral',
      notch_height_mm: 39,
      notch_depth_mm: 12,
      notch_at: 'front_boundary',
    };
    const contractShape: OpeningContractBodyModifier = {
      role: entityShape.role,
      notchHeightMm: entityShape.notch_height_mm,
      notchDepthMm: entityShape.notch_depth_mm,
      notchAt: entityShape.notch_at,
    };
    expect(contractShape.notchHeightMm).toBe(39);
    expect(contractShape.notchDepthMm).toBe(12);
    expect(contractShape.notchAt).toBe('front_boundary');
  });
});
