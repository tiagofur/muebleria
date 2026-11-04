import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveAgregadoAssembly,
  validateAgregadoAssemblyDefinition,
  type AgregadoAssemblyInput,
  type AgregadoRigidMember,
} from './agregadoAssembly';

// #1493: alturas Blum MERIVOBOX N/M/K/E — paridad con el contrato canónico.
// Autoridad numérica única: la sección `heights` de
// contracts/fixtures/merivobox-pilot-canonical.json (misma que consume el test
// Go backend-go/internal/domain/engine/merivobox_heights_test.go). Ningún
// número de altura vive duplicado acá.

interface HeightsNominal {
  code: string;
  khMinMm: number;
  hardwareId: string;
  kitHardwareId: string;
  backMm: number;
}

interface HeightsContract {
  variantSetId: string;
  clearanceMm: number;
  backOffsetMm: number;
  nominals: HeightsNominal[];
  boundaries: { spaceMm: number; expected: string }[];
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/merivobox-pilot-canonical.json');

function loadHeights(): HeightsContract {
  const full = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { heights: HeightsContract };
  expect(full.heights.nominals).toHaveLength(4);
  return full.heights;
}

function buildHeightsAgregado(c: HeightsContract): AgregadoAssemblyInput {
  const member = (memberId: string, role: string, xRef: 'min' | 'max'): AgregadoRigidMember => ({
    memberId,
    role,
    source: { kind: 'variant', variant: { variantSetId: c.variantSetId } },
    placement: {
      x: { ref: xRef, offsetMm: 0 },
      y: { ref: 'min', offsetMm: 0 },
      z: { ref: 'min', offsetMm: 0 },
    },
    bomRole: 'included_in_kit',
  });

  return {
    id: 'agr-merivobox-alturas',
    variantSets: [
      {
        id: c.variantSetId,
        dimension: 'height',
        variants: c.nominals.map((n) => ({
          nominalDimensionMm: n.khMinMm,
          hardwareId: n.hardwareId,
          commercialKitHardwareId: n.kitHardwareId,
        })),
      },
    ],
    compatibilityRules: [
      { variantSetId: c.variantSetId, clearanceMm: c.clearanceMm, selectionStrategy: 'max_fitting' },
    ],
    rigidMembers: [
      member('side-left', 'drawer_side_left', 'min'),
      member('side-right', 'drawer_side_right', 'max'),
    ],
    components: [
      {
        componentId: 'comp-back',
        quantity: 1,
        overrides: {
          widthRule: { source: 'assembly_width', offsetMm: -58 },
          lengthRule: { source: 'selected_variant', variantSetId: c.variantSetId, offsetMm: c.backOffsetMm },
        },
      },
    ],
  };
}

describe('#1493 alturas MERIVOBOX N/M/K/E (contrato canónico compartido)', () => {
  const c = loadHeights();
  const agg = buildHeightsAgregado(c);

  it('la definición construida desde el JSON valida', () => {
    expect(() => validateAgregadoAssemblyDefinition(agg)).not.toThrow();
  });

  it('boundaries: máxima que cabe, fail-closed bajo N, kit de variante y trasera KH−25', () => {
    for (const b of c.boundaries) {
      if (b.expected === 'rejected') {
        expect(() =>
          resolveAgregadoAssembly(agg, { widthMm: 570, depthMm: 530, heightMm: b.spaceMm }),
        ).toThrow(/cannot accommodate available nominals/);
        continue;
      }
      const nominal = c.nominals.find((n) => n.code === b.expected)!;
      const res = resolveAgregadoAssembly(agg, { widthMm: 570, depthMm: 530, heightMm: b.spaceMm });
      expect(res.selectedVariants[0]!.nominalDimensionMm).toBe(nominal.khMinMm);
      // Kit efectivo = kit de la variante seleccionada.
      expect(res.commercialKitHardwareId).toBe(nominal.kitHardwareId);
      const kitRows = res.bomItems.filter((i) => i.role === 'commercial_kit');
      expect(kitRows).toHaveLength(1);
      expect(kitRows[0]!.hardwareId).toBe(nominal.kitHardwareId);
      // Trasera Blum real: KH mín − 25, contra el backMm del contrato.
      const back = res.fabricatedComponents.find((fc) => fc.componentId === 'comp-back')!;
      expect(back.lengthMm).toBeCloseTo(nominal.backMm, 6);
    }
  });

  it('cada nominal declara su hardware y kit sin colisiones', () => {
    const hws = new Set(c.nominals.map((n) => n.hardwareId));
    const kits = new Set(c.nominals.map((n) => n.kitHardwareId));
    expect(hws.size).toBe(4);
    expect(kits.size).toBe(4);
    // La fórmula uniforme reproduce las alturas de trasera Blum exactas.
    for (const n of c.nominals) {
      expect(n.khMinMm + c.backOffsetMm).toBeCloseTo(n.backMm, 6);
    }
  });
});
