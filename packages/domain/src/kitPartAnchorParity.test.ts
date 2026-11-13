/**
 * #1557 — paridad TS↔Go de la expansión/sync por ancla de partes de kit
 * multi-diseño (#1518 F1). El MISMO fixture lo consume el engine Go
 * (kit_part_anchor_parity_test.go): receta parcial → reparación del ancla
 * faltante + derivation de offsets por pieza idénticos en ambos runtimes,
 * drift 0. #1613 (owner): el miembro GUARDADO se refresca desde SU pieza en
 * cada sync — el registro del catálogo manda sobre la receta persistida
 * (x=10 legacy → 4 del registro, y=136 llega).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { syncAgregadoWithKitParts } from './hardwareKit';

interface AnchorFixture {
  readonly kit: { readonly id: string; readonly code: string; readonly name: string };
  readonly agregado: { readonly code: string };
  readonly parts: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly previewShape: string;
    readonly pieces: readonly {
      readonly anchor: 'left' | 'right' | 'center';
      readonly offsetMm?: { readonly x: number; readonly y: number; readonly z: number };
    }[];
  }[];
  readonly partialRecipe: readonly {
    readonly memberId: string;
    readonly hand: string;
    readonly hardwareId: string;
    readonly x: { readonly ref: string; readonly offsetMm: number };
  }[];
  readonly expectedMembers: readonly {
    readonly memberId: string;
    readonly hand: string;
    readonly xRef: string;
    readonly xOffsetMm: number;
    readonly yOffsetMm: number;
  }[];
}

const fixturePath = resolve(__dirname, '../../../contracts/fixtures/kitPartAnchorParity.contract.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as AnchorFixture;

describe('kitPartAnchorParity contract (#1557)', () => {
  const agregado = {
    id: 'agr-par',
    code: fixture.agregado.code,
    rigidMembers: fixture.partialRecipe.map((m) => ({
      memberId: m.memberId,
      role: 'slide',
      source: { kind: 'fixed' as const, fixed: { hardwareId: m.hardwareId } },
      placement: {
        x: { ref: m.x.ref as 'min' | 'max' | 'center', offsetMm: m.x.offsetMm },
        y: { ref: 'min' as const, offsetMm: 0 },
        z: { ref: 'min' as const, offsetMm: 0 },
      },
      bomRole: 'included_in_kit' as const,
      actorMembership: 'body',
      hand: m.hand as 'left' | 'right' | 'center',
    })),
  };

  const synced = syncAgregadoWithKitParts(
    agregado,
    fixture.parts.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      previewShape: p.previewShape,
      pieces: p.pieces,
    })),
  );

  const byMember = new Map(
    (synced.rigidMembers as any[]).map((m) => [m.memberId, m] as const),
  );

  it('produce el conjunto completo de miembros desde la receta parcial', () => {
    expect(synced.rigidMembers).toHaveLength(fixture.expectedMembers.length);
    for (const want of fixture.expectedMembers) {
      expect(byMember.has(want.memberId), `miembro ${want.memberId}`).toBe(true);
    }
  });

  for (const want of fixture.expectedMembers) {
    it(`${want.memberId}: hand/ancla/offset por pieza (el registro manda)`, () => {
      const got = byMember.get(want.memberId);
      expect(got?.hand).toBe(want.hand);
      expect(got?.placement.x).toEqual({ ref: want.xRef, offsetMm: want.xOffsetMm });
      expect(got?.placement.y).toEqual({ ref: 'min', offsetMm: want.yOffsetMm });
    });
  }
});
