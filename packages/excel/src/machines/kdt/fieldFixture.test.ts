import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { serializePerPiece } from '../kdtAdapter';
import { KDT_FLEXDRILL_1200_PROFILE } from '../profiles';
import {
  buildKdtFieldFixtureJob,
  KDT_FIELD_EXPECTATIONS,
  KDT_FIELD_PROGRAM_SHA256,
} from './fieldFixture';
import { parseKdtPanelBytes } from './parse';
import { sha256Hex } from '../digest';

/** Program key used by the pinned-hash table and the evidence docs. */
function programKey(pieceCode: string, machiningFace: 'front' | 'back'): string {
  return `${pieceCode}:${machiningFace}`;
}

describe('KDT field fixture (#1005 K4)', () => {
  const job = buildKdtFieldFixtureJob();
  const programs = serializePerPiece(job, KDT_FLEXDRILL_1200_PROFILE);

  it('produce exactamente los 3 programas esperados (Face A/B + edges-only)', () => {
    expect(
      programs.map((program) => programKey(program.pieceCode, program.machiningFace)),
    ).toEqual(['MOD-K4-P01:front', 'MOD-K4-P01:back', 'MOD-K4-P02:front']);
  });

  it('cada operación coincide valor por valor con la tabla esperada (BHX02)', () => {
    for (const program of programs) {
      const expected = KDT_FIELD_EXPECTATIONS.find(
        (entry) =>
          entry.pieceCode === program.pieceCode &&
          entry.machiningFace === program.machiningFace,
      );
      expect(expected, `${program.pieceCode}:${program.machiningFace}`).toBeDefined();
      if (!expected) continue;
      const parsed = parseKdtPanelBytes(program.bytes);
      expect(parsed.panel.name).toBe(expected.panelName);
      expect(parsed.panel.lengthMm).toBe(expected.lengthMm);
      expect(parsed.panel.widthMm).toBe(expected.widthMm);
      expect(parsed.panel.thicknessMm).toBe(expected.thicknessMm);
      expect(parsed.operations).toHaveLength(expected.operations.length);
      expected.operations.forEach((want, index) => {
        const operation = parsed.operations[index]!;
        expect(operation.kind === 'vertical-hole' || operation.kind === 'horizontal-hole').toBe(
          true,
        );
        expect(operation.fields.TypeNo).toBe(want.typeNo);
        if (want.quadrant !== undefined) {
          expect(operation.fields.Quadrant).toBe(want.quadrant);
        }
        expect(operation.fields.X1).toBe(want.x1Mm);
        expect(operation.fields.Y1).toBe(want.y1Mm);
        if (want.z1Mm !== undefined) {
          expect(operation.fields.Z1).toBe(want.z1Mm);
        }
        expect(operation.fields.Diameter).toBe(want.diameterMm);
        expect(operation.fields.Depth).toBe(want.depthMm);
      });
      // AlignmentFace: exactamente uno, en el canto X=0, en ambas caras.
      const alignment = parsed.panel.outline.filter((vertex) => vertex.banding === 2);
      expect(alignment).toHaveLength(1);
      expect(alignment[0]!.x1Mm).toBe(0);
    }
  });

  it('los bytes son deterministas y los hashes coinciden con los pinned (docs↔código)', async () => {
    const rerun = serializePerPiece(buildKdtFieldFixtureJob(), KDT_FLEXDRILL_1200_PROFILE);
    for (const program of programs) {
      const key = programKey(program.pieceCode, program.machiningFace);
      const pinned = KDT_FIELD_PROGRAM_SHA256[key]!;
      expect(pinned, `hash pinned para ${key}`).toMatch(/^[0-9a-f]{64}$/);
      expect(await sha256Hex(program.bytes)).toBe(pinned);
      expect(await sha256Hex(program.bytes)).toBe(
        await sha256Hex(rerun.find((p) => p.pieceCode === program.pieceCode && p.machiningFace === program.machiningFace)!.bytes),
      );
    }
  });

  it('los hashes citados por la documentación de campo coinciden con el código', () => {
    const doc = readFileSync(
      new URL('../../../../../docs/machines/client-b/k4-field-validation/expected-values.md', import.meta.url),
      'utf8',
    );
    for (const [key, pinned] of Object.entries(KDT_FIELD_PROGRAM_SHA256)) {
      expect(doc).toContain(`\`${key}\``);
      expect(doc).toContain(pinned);
    }
    // Cada hash del doc es uno de los pinned (sin entradas sueltas).
    const docHashes = [...doc.matchAll(/`([0-9a-f]{64})`/g)].map((match) => match[1]);
    expect(docHashes.sort()).toEqual(Object.values(KDT_FIELD_PROGRAM_SHA256).slice().sort());
  });
});
