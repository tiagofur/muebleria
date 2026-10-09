/**
 * #1131 — paridad compartida TS de la capa semántica del contrato de
 * opening/front. El MISMO fixture lo consume el engine Go
 * (opening_front_layout_contract_test.go): fronts por zona con identidad
 * estable (zoneId declarado), caja axis-mapeada (vertical divide altura,
 * horizontal divide ancho), grips como datos resueltos (lados OQ-1) y
 * reglas aplicadas. Los errores de forma fallan cerrado antes de la
 * matemática v1 y los errores v1 se propagan verbatim.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveOpeningFrontLayout,
  type OpeningFrontLayout,
} from './openingFrontLayout';
import type { OpeningIntent, OpeningProfileData } from './openingFront';

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

interface ExpectedFront {
  readonly zoneId: string;
  readonly access: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly offsetMm: number;
  readonly grips: readonly {
    readonly boundary: string;
    readonly side: 'above' | 'below';
    readonly profileId: string;
    readonly consumedMm: number;
  }[];
  readonly rules: {
    readonly direction: 'vertical' | 'horizontal';
    readonly positioning: string;
    readonly ratio: number;
    readonly ratioSum: number;
    readonly remainderTarget: boolean;
  };
  readonly overhangMm?: number;
}

interface ResolutionCase {
  readonly name: string;
  readonly cabinetFrontHeightMm: number;
  readonly cabinetFrontWidthMm: number;
  readonly positioning: 'overlay' | 'inset' | 'partial_overlay' | 'bottom_overhang';
  /** #1138: the backed `opening.bottom-overhang` rule value for this case
   * (absent = no rule: bottom_overhang stays BLOCKED). */
  readonly overhangMm?: number;
  readonly layout: { readonly direction: 'vertical' | 'horizontal'; readonly zones: readonly ZoneCase[] };
  readonly grips: readonly GripCase[];
  readonly profilesOverride?: readonly OpeningProfileData[];
  readonly expected: { readonly fronts: readonly ExpectedFront[] };
}

interface BlockedCase {
  readonly name: string;
  readonly cabinetFrontHeightMm: number;
  readonly cabinetFrontWidthMm: number;
  readonly positioning: string;
  readonly layout: { readonly direction: 'vertical' | 'horizontal'; readonly zones: readonly ZoneCase[] };
  readonly grips: readonly GripCase[];
  readonly profilesOverride?: readonly OpeningProfileData[];
  readonly expectedErrorCode: string;
}

interface LayoutInvalidCase {
  readonly name: string;
  readonly cabinetFrontHeightMm: number;
  readonly cabinetFrontWidthMm: number;
  readonly layout: { readonly direction: string; readonly zones: readonly ZoneCase[] };
  readonly grips: readonly GripCase[];
  readonly expectedErrorCode: string;
}

interface Fixture {
  readonly schema: number;
  readonly contract: string;
  readonly profiles: readonly OpeningProfileData[];
  readonly resolutionCases: readonly ResolutionCase[];
  readonly blockedCases: readonly BlockedCase[];
  readonly layoutInvalidCases: readonly LayoutInvalidCase[];
}

const fixturePath = resolve(
  __dirname,
  '../../../contracts/openingFrontResolution.contract.json',
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

const profilesFor = (testCase: {
  readonly profilesOverride?: readonly OpeningProfileData[];
  readonly overhangMm?: number;
}): {
  readonly profiles: readonly OpeningProfileData[];
  readonly overhangMm?: number;
} => ({
  profiles: testCase.profilesOverride ?? fixture.profiles,
  ...(testCase.overhangMm !== undefined ? { overhangMm: testCase.overhangMm } : {}),
});

const intentOf = (testCase: {
  readonly positioning?: string;
  readonly layout: { readonly direction: string; readonly zones: readonly ZoneCase[] };
  readonly grips: readonly GripCase[];
}): OpeningIntent => ({
  positioning: (testCase.positioning ?? 'overlay') as OpeningIntent['positioning'],
  layout: {
    direction: testCase.layout.direction as OpeningIntent['layout']['direction'],
    zones: testCase.layout.zones.map((z) => ({
      id: z.id,
      access: z.access as OpeningIntent['layout']['zones'][number]['access'],
      ratio: z.ratio,
    })),
  },
  grips: testCase.grips.map((g) => ({ ...g })),
});

describe('contracts/openingFrontResolution.contract.json — capa semántica (#1131)', () => {
  it('is schema 1 of the opening-front contract', () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.contract).toBe('granete.opening-front.v1');
  });

  it.each(fixture.resolutionCases.map((c) => [c.name, c] as const))(
    'fronts: %s',
    (_name, testCase) => {
      const result = resolveOpeningFrontLayout(
        intentOf(testCase),
        testCase.cabinetFrontWidthMm,
        testCase.cabinetFrontHeightMm,
        profilesFor(testCase),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const layout: OpeningFrontLayout = result.layout;
      expect(layout.contract).toBe('granete.opening-front.v1');
      // Identity is stable and declared: one front per zone, in zone order.
      expect(layout.fronts.map((f) => f.zoneId)).toEqual(
        testCase.layout.zones.map((z) => z.id),
      );
      expect(layout.fronts).toEqual(testCase.expected.fronts);
      // The v1 ledger stays in sync with the semantic layer.
      expect(layout.resolution.zones.map((z) => z.id)).toEqual(
        layout.fronts.map((f) => f.zoneId),
      );
    },
  );

  it.each(fixture.blockedCases.map((c) => [c.name, c] as const))(
    'bloqueado se propaga verbatim: %s',
    (_name, testCase) => {
      const result = resolveOpeningFrontLayout(
        intentOf(testCase),
        testCase.cabinetFrontWidthMm,
        testCase.cabinetFrontHeightMm,
        profilesFor(testCase),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorCode).toBe(testCase.expectedErrorCode);
    },
  );

  it.each(fixture.layoutInvalidCases.map((c) => [c.name, c] as const))(
    'forma inválida falla cerrado: %s',
    (_name, testCase) => {
      const result = resolveOpeningFrontLayout(
        intentOf(testCase),
        testCase.cabinetFrontWidthMm,
        testCase.cabinetFrontHeightMm,
        { profiles: fixture.profiles },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorCode).toBe(testCase.expectedErrorCode);
    },
  );
});

describe('openingFrontLayout — invariantes fuera del fixture (#1131)', () => {
  const verified = (profileId: string): OpeningProfileData => ({
    profileId,
    datasheetStatus: 'verified',
    frontReductionMm: 10,
    gripClearanceMm: 5,
  });

  it('horizontal + bottom: el borde inferior agarra TODAS las zonas desde abajo', () => {
    const result = resolveOpeningFrontLayout(
      {
        positioning: 'overlay',
        layout: {
          direction: 'horizontal',
          zones: [
            { id: 'z1', access: 'hinged', ratio: 1 },
            { id: 'z2', access: 'hinged', ratio: 1 },
          ],
        },
        grips: [{ boundary: 'bottom', profileId: 'p' }],
      },
      600,
      720,
      { profiles: [verified('p')] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const front of result.layout.fronts) {
      expect(front.grips).toEqual([
        { boundary: 'bottom', side: 'below', profileId: 'p', consumedMm: 15 },
      ]);
    }
    // Axis mapping: horizontal divide el ancho (585 → 292/293), la altura
    // cruza intacta.
    expect(result.layout.fronts[0]?.widthMm).toBe(292);
    expect(result.layout.fronts[0]?.heightMm).toBe(720);
    expect(result.layout.fronts[1]?.widthMm).toBe(293);
  });

  it('forma incompatible gana sobre el bloqueo de evidencia (falla cerrado antes)', () => {
    const result = resolveOpeningFrontLayout(
      {
        positioning: 'bottom_overhang',
        layout: { direction: 'diagonal' as 'vertical', zones: [{ id: 'z1', access: 'hinged', ratio: 1 }] },
        grips: [],
      },
      600,
      720,
      { profiles: [] },
    );
    expect(result).toMatchObject({ ok: false, errorCode: 'OPENING_LAYOUT_INVALID' });
  });

  it('bloqueo v1 (OQ-3) se propaga sin máscara con forma válida', () => {
    const result = resolveOpeningFrontLayout(
      {
        positioning: 'bottom_overhang',
        layout: { direction: 'vertical', zones: [{ id: 'z1', access: 'hinged', ratio: 1 }] },
        grips: [],
      },
      600,
      720,
      { profiles: [] },
    );
    expect(result).toMatchObject({ ok: false, errorCode: 'OPENING_OVERHANG_EVIDENCE_PENDING' });
  });

  it('dimensiones no enteras o no positivas fallan cerrado', () => {
    const intent: OpeningIntent = {
      positioning: 'overlay',
      layout: { direction: 'vertical', zones: [{ id: 'z1', access: 'drawer', ratio: 1 }] },
      grips: [],
    };
    for (const [w, h] of [
      [0, 720],
      [600, 0],
      [600.5, 720],
      [600, -1],
    ] as [number, number][]) {
      const result = resolveOpeningFrontLayout(intent, w, h, { profiles: [] });
      expect(result).toMatchObject({ ok: false, errorCode: 'OPENING_LAYOUT_INVALID' });
    }
  });
});
