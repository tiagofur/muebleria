import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agregadoKitHardwareIds, catalogMemberPlacement, memberPlacementAuthority } from './hardwareKit';

// #1625: paridad TS↔Go de «la posición del miembro la manda el catálogo».
// Autoridad única: contracts/fixtures/memberPlacementAuthority.contract.json.
// El espejo Go ejerce el sync real en
// backend-go/internal/domain/engine/member_placement_authority_parity_test.go.

interface Fixture {
  hardware: {
    id: string;
    code: string;
    label?: string;
    pieces?: { anchor: 'left' | 'right' | 'center'; offsetMm?: { x: number; y: number; z: number } }[];
  }[];
  cases: {
    name: string;
    hardwareId: string;
    hand: string;
    expected: 'piece' | 'label' | 'none';
    expectedPlacement?: Record<'x' | 'y' | 'z', { ref: string; offsetMm: number }>;
  }[];
}

const f = JSON.parse(
  readFileSync(resolve(__dirname, '../../../contracts/fixtures/memberPlacementAuthority.contract.json'), 'utf8'),
) as Fixture;

const hardware = f.hardware.map((h) => ({
  id: h.id,
  ...(h.pieces ? { pieces: h.pieces } : {}),
  ...(h.label ? { designParts: [{ label: h.label }] } : {}),
}));

describe('#1625 — posición de miembro mandada por el catálogo (paridad con Go)', () => {
  for (const c of f.cases) {
    it(c.name, () => {
      const got = memberPlacementAuthority(
        { source: { kind: 'fixed', fixed: { hardwareId: c.hardwareId } }, hand: c.hand || undefined },
        hardware,
      );
      expect(got?.kind ?? 'none').toBe(c.expected);
      const placement = catalogMemberPlacement(
        {
          source: { kind: 'fixed', fixed: { hardwareId: c.hardwareId } },
          hand: c.hand || undefined,
          placement: { y: { ref: 'min' }, z: { ref: 'min' } },
        },
        hardware,
      );
      if (c.expected === 'none') {
        expect(placement).toBeNull();
      } else {
        expect(placement).toEqual(c.expectedPlacement);
      }
    });
  }

  it('un miembro de variante (sin herraje fijo) nunca la tiene mandada por el catálogo', () => {
    expect(
      memberPlacementAuthority({ source: { kind: 'variant' }, hand: 'left' }, hardware),
    ).toBeNull();
  });
});

describe('#1625 — juegos que monta un ensamble', () => {
  it('une el juego del ensamble y los de sus variantes sin repetir', () => {
    expect(
      agregadoKitHardwareIds({
        commercialKitHardwareId: 'kit-m',
        variantSets: [
          { variants: [{ commercialKitHardwareId: 'kit-m' }, { commercialKitHardwareId: 'kit-e' }, {}] },
        ],
      }),
    ).toEqual(['kit-m', 'kit-e']);
  });

  it('sin juegos devuelve vacío', () => {
    expect(agregadoKitHardwareIds({})).toEqual([]);
  });
});
