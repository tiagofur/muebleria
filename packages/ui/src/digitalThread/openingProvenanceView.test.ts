/**
 * #1330 — openingProvenanceView: the drawer's read-only opening procedencia
 * derived ONLY from the durable selection and its frozen pin. Every absence
 * is truthful — nothing invented, nothing joined from the live catalog.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import type { DesignAuthoringDefaults } from '@granete/storage';
import { openingProvenanceView } from './ProjectFurnitureScreen';

const defaultsWith = (opening: unknown): DesignAuthoringDefaults =>
  ({ materialChoices: {}, opening }) as unknown as DesignAuthoringDefaults;

const golaPin = {
  system: 'gola',
  profileId: 'profile.gola-l.8006',
  profilePin: {
    profileCode: 'GOLA-L-8006',
    frontReductionMm: 38,
    gripClearanceMm: 2,
    doorReductionMm: 40,
    datasheetStatus: 'verified',
    profileHeightMm: 56.5,
    profileDepthMm: 27.2,
    compatiblePlacements: ['top'],
    bodyModifiers: [
      { role: 'lateral', notch_height_mm: 56.5, notch_depth_mm: 27.2, notch_at: 'top_front' },
    ],
    bom: { profileVersion: 8, members: {} },
  },
};

describe('openingProvenanceView (#1330)', () => {
  it('loading y sin apertura son ausencias veraces', () => {
    expect(openingProvenanceView(undefined, true)).toEqual({ state: 'loading' });
    expect(openingProvenanceView(null, false)).toEqual({ state: 'none' });
    expect(openingProvenanceDefaultsEmpty()).toEqual({ state: 'none' });
  });

  it('el pin congelado nombra código, versión, descuento y muesca — una sola verdad con la web', () => {
    expect(openingProvenanceView(defaultsWith(golaPin), false)).toEqual({
      state: 'pinned',
      label: 'GOLA-L-8006 v8 · puertas H−40 · muesca 56.5 × 27.2 mm',
    });
  });

  it('pin sin BOM (pre-#1263) muestra el código sin versión inventada', () => {
    const { bom: _bom, ...legacyPin } = golaPin.profilePin as Record<string, unknown>;
    expect(
      openingProvenanceView(defaultsWith({ ...golaPin, profilePin: legacyPin }), false),
    ).toEqual({
      state: 'pinned',
      label: 'GOLA-L-8006 · puertas H−40 · muesca 56.5 × 27.2 mm',
    });
  });

  it('gola sin pin (pre-pin) exige re-aplicar; jaladera no lleva pin', () => {
    expect(
      openingProvenanceView(defaultsWith({ system: 'gola', profileId: 'profile.x' }), false),
    ).toEqual({ state: 'unpinned', systemLabel: 'Gola (perfil integrado)' });
    expect(openingProvenanceView(defaultsWith({ system: 'handle' }), false)).toEqual({
      state: 'system',
      systemLabel: 'Jaladera',
    });
  });

  it('pin sin descuento declarado cae al par de ficha congelado', () => {
    const pin = { ...golaPin.profilePin } as Record<string, unknown>;
    delete pin.doorReductionMm;
    expect(openingProvenanceView(defaultsWith({ ...golaPin, profilePin: pin }), false)).toEqual({
      state: 'pinned',
      label: 'GOLA-L-8006 v8 · puertas H−40 · muesca 56.5 × 27.2 mm',
    });
  });
});

function openingProvenanceDefaultsEmpty(): unknown {
  return openingProvenanceView(defaultsWith(null), false);
}
