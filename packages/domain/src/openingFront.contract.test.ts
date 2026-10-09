/**
 * #1129 — paridad compartida TS del contrato de opening/front. El MISMO
 * fixture lo consume el engine Go (opening_front_contract_test.go): casos
 * A/B/C/Baseline con la matemática canónica (milímetros enteros, resto a
 * la última zona), bloqueos por evidencia pendiente (OQ-2/OQ-3) y entradas
 * inválidas fallando cerrado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveOpeningFront,
  type OpeningIntent,
  type OpeningProfileData,
} from './openingFront';

interface ZoneCase {
  readonly id: string;
  readonly access: string;
  readonly ratio: number;
}

interface GripCase {
  readonly boundary: 'top' | 'bottom' | 'between';
  readonly aboveZone?: string;
  readonly belowZone?: string;
  readonly profileId: string;
}

interface ExpectedResolution {
  readonly availableFrontHeightMm: number;
  readonly zones: readonly { readonly id: string; readonly heightMm: number; readonly offsetFromStartMm: number }[];
  readonly boundaries: readonly { readonly boundary: string; readonly consumedMm: number }[];
  readonly remainderZoneId: string;
}

interface ResolutionCase {
  readonly name: string;
  readonly cabinetFrontHeightMm: number;
  readonly positioning: 'overlay' | 'inset' | 'partial_overlay' | 'bottom_overhang';
  /** #1138: the backed `opening.bottom-overhang` rule value for this case. */
  readonly overhangMm?: number;
  readonly layout: { readonly direction: 'vertical' | 'horizontal'; readonly zones: readonly ZoneCase[] };
  readonly grips: readonly GripCase[];
  readonly profilesOverride?: readonly OpeningProfileData[];
  readonly expected: ExpectedResolution;
}

interface BlockedCase {
  readonly name: string;
  readonly cabinetFrontHeightMm: number;
  readonly positioning: string;
  readonly layout: { readonly direction: 'vertical' | 'horizontal'; readonly zones: readonly ZoneCase[] };
  readonly grips: readonly GripCase[];
  readonly profilesOverride?: readonly OpeningProfileData[];
  readonly expectedErrorCode: string;
}

interface InvalidCase {
  readonly name: string;
  readonly cabinetFrontHeightMm: number;
  readonly positioning?: 'overlay' | 'inset' | 'partial_overlay' | 'bottom_overhang';
  readonly layout: { readonly direction: 'vertical' | 'horizontal'; readonly zones: readonly ZoneCase[] };
  readonly grips: readonly GripCase[];
  readonly profilesOverride?: readonly OpeningProfileData[];
  readonly expectedErrorCode: string;
}

interface Fixture {
  readonly schema: number;
  readonly contract: string;
  readonly profiles: readonly OpeningProfileData[];
  readonly resolutionCases: readonly ResolutionCase[];
  readonly blockedCases: readonly BlockedCase[];
  readonly invalidCases: readonly InvalidCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/openingFrontResolution.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

const profilesFor = (testCase: {
  readonly profilesOverride?: readonly OpeningProfileData[];
  readonly overhangMm?: number;
}): OpeningProfileLookupShape => ({
  profiles: testCase.profilesOverride ?? fixture.profiles,
  ...(testCase.overhangMm !== undefined ? { overhangMm: testCase.overhangMm } : {}),
});

interface OpeningProfileLookupShape {
  readonly profiles: readonly OpeningProfileData[];
  readonly overhangMm?: number;
}

const intentOf = (
  testCase: {
    readonly positioning?: string;
    readonly layout: { readonly direction: 'vertical' | 'horizontal'; readonly zones: readonly ZoneCase[] };
    readonly grips: readonly GripCase[];
  },
): OpeningIntent => ({
  positioning: (testCase.positioning ?? 'overlay') as OpeningIntent['positioning'],
  layout: {
    direction: testCase.layout.direction,
    zones: testCase.layout.zones.map((z) => ({
      id: z.id,
      access: z.access as OpeningIntent['layout']['zones'][number]['access'],
      ratio: z.ratio,
    })),
  },
  grips: testCase.grips.map((g) => ({ ...g })),
});

describe('contracts/openingFrontResolution.contract.json (#1129)', () => {
  it('is schema 1 of the opening-front contract', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.contract).toBe('granete.opening-front.v1');
  });

  it.each(fixture.resolutionCases.map((c) => [c.name, c] as const))(
    'resolución: %s',
    (_name, testCase) => {
      const result = resolveOpeningFront(
        intentOf(testCase),
        testCase.cabinetFrontHeightMm,
        profilesFor(testCase),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.resolution.availableFrontHeightMm).toBe(
        testCase.expected.availableFrontHeightMm,
      );
      expect(result.resolution.zones).toEqual(testCase.expected.zones);
      expect(result.resolution.boundaries).toEqual(testCase.expected.boundaries);
      expect(result.resolution.remainderZoneId).toBe(testCase.expected.remainderZoneId);
    },
  );

  it.each(fixture.blockedCases.map((c) => [c.name, c] as const))(
    'bloqueado: %s',
    (_name, testCase) => {
      const result = resolveOpeningFront(
        intentOf(testCase),
        testCase.cabinetFrontHeightMm,
        profilesFor(testCase),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorCode).toBe(testCase.expectedErrorCode);
    },
  );

  it.each(fixture.invalidCases.map((c) => [c.name, c] as const))(
    'inválido falla cerrado: %s',
    (_name, testCase) => {
      const result = resolveOpeningFront(
        intentOf(testCase),
        testCase.cabinetFrontHeightMm,
        profilesFor(testCase),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorCode).toBe(testCase.expectedErrorCode);
    },
  );
});
