import { describe, expect, it } from 'vitest';
import {
  buildKdtFieldFixtureJob,
  KDT_FIELD_EXPECTATIONS,
} from '../kdt/fieldFixture';
import { transformJobToPrograms } from '../kdt/transform';
import { serializeMprCandidateDocument } from './candidateFormat';
import { parseMprCandidateBytes } from './candidateParse';
import {
  transformPatternToMprCandidatePrograms,
  type MprCandidateProvenance,
} from './candidateTransform';
import { sha256Hex } from '../digest';

const PROVENANCE: Omit<MprCandidateProvenance, 'pieceCode' | 'machiningFace'> = {
  generator: 'granete-mpr-candidate',
  dialect: 'woodwop-mpr-4.x-public-reference',
};

/** KDT quadrant → MPR travel direction (the documented edge correspondence). */
const QUADRANT_TO_DIRECTION: Record<number, 'XP' | 'XM' | 'YP' | 'YM'> = {
  1: 'XM', // X=PanelLength edge, drill travels −X
  2: 'XP', // X=0 edge, drill travels +X
  3: 'YM', // Y=PanelWidth edge, drill travels −Y
  4: 'YP', // Y=0 edge, drill travels +Y
};

describe('MPR candidate dialect (#879 B2-prep)', () => {
  const job = buildKdtFieldFixtureJob();
  const mprPrograms = job.drilling.patterns.flatMap((pattern) =>
    transformPatternToMprCandidatePrograms(pattern, PROVENANCE),
  );

  it('produce los mismos 3 programas que el camino KDT (mismo fixture, dos receptores)', () => {
    const kdtPrograms = transformJobToPrograms(job, {
      adapterId: 'granete-kdt',
      adapterVersion: '0.2.0',
      profileId: 'kdt-flexdrill-1200',
      profileRevision: 'r2',
    });
    expect(mprPrograms.map((p) => `${p.pieceCode}:${p.machiningFace}`)).toEqual(
      kdtPrograms.map((p) => `${p.pieceCode}:${p.machiningFace}`),
    );
  });

  it('cada operación MPR corresponde 1:1 con la expectativa del fixture (coordenadas y cuadrante→BM)', () => {
    expect(mprPrograms).toHaveLength(KDT_FIELD_EXPECTATIONS.length);
    for (const program of mprPrograms) {
      const expected = KDT_FIELD_EXPECTATIONS.find(
        (entry) =>
          entry.pieceCode === program.pieceCode &&
          entry.machiningFace === program.machiningFace,
      );
      expect(expected).toBeDefined();
      if (!expected) continue;
      const parsed = parseMprCandidateBytes(serializeMprCandidateDocument(program.document));
      expect(parsed.piece.lengthMm).toBe(expected.lengthMm);
      expect(parsed.piece.widthMm).toBe(expected.widthMm);
      expect(parsed.piece.thicknessMm).toBe(expected.thicknessMm);
      expect(parsed.operations).toHaveLength(expected.operations.length);
      expected.operations.forEach((want, index) => {
        const operation = parsed.operations[index]!;
        expect(operation.macro === 'bohr-vert' ? 1 : 2).toBe(want.typeNo);
        if (want.quadrant !== undefined) {
          expect(operation.fields.BM).toBe(QUADRANT_TO_DIRECTION[want.quadrant]);
        }
        expect(Number(operation.fields.XA)).toBe(want.x1Mm);
        expect(Number(operation.fields.YA)).toBe(want.y1Mm);
        if (want.z1Mm !== undefined) {
          expect(Number(operation.fields.ZA)).toBe(want.z1Mm);
        }
        expect(Number(operation.fields.DU)).toBe(want.diameterMm);
        expect(Number(operation.fields.TI)).toBe(want.depthMm);
        expect(operation.fields.AN).toBe('1');
      });
    }
  });

  it('round-trip: writer → lector independiente → mismos valores (BHX02)', () => {
    for (const program of mprPrograms) {
      const bytes = serializeMprCandidateDocument(program.document);
      const parsed = parseMprCandidateBytes(bytes);
      parsed.operations.forEach((operation, index) => {
        const original = program.document.operations[index]!;
        expect(Number(operation.fields.XA)).toBe(original.xaMm);
        expect(Number(operation.fields.YA)).toBe(original.yaMm);
        if (original.kind === 'bohr-horiz') {
          expect(operation.fields.BM).toBe(original.direction);
          expect(Number(operation.fields.ZA)).toBe(original.zaMm);
        }
        expect(Number(operation.fields.DU)).toBe(original.diameterMm);
        expect(Number(operation.fields.TI)).toBe(original.depthMm);
      });
      expect(parsed.comments.some((comment) => comment.includes(program.pieceCode))).toBe(true);
    }
  });

  it('bytes deterministas y golden estable del candidato', async () => {
    const first = mprPrograms[0]!;
    const bytes = serializeMprCandidateDocument(first.document);
    expect(await sha256Hex(bytes)).toBe(
      '16a7d2027b40d143992a908cc3dd809eed61b35b76c4ff004ec05f7a166d0ee6',
    );
    // Forma: CRLF, [H primero, ! al final, sin expresiones.
    const xml = new TextDecoder().decode(bytes);
    expect(xml.startsWith('[H\r\n')).toBe(true);
    expect(xml.endsWith('!\r\n')).toBe(true);
    expect(xml).toContain('<100 \\Werkstck\\');
    expect(xml).toContain('<102 \\BohrVert\\');
    expect(xml).toContain('<103 \\BohrHoriz\\');
    expect(xml).not.toMatch(/"[\d.]+\/[\d.]+"/); // sin expresiones del parser
  });

  it('rechaza lo fuera del subconjunto: BM=C, macro desconocida y LF', () => {
    const program = mprPrograms[0]!;
    const bytes = serializeMprCandidateDocument(program.document);
    const text = new TextDecoder().decode(bytes);
    // BM="C" (taladro con ángulo libre) existe en el doc pero no en el
    // subconjunto candidato — el lector lo rechaza en horizontales.
    expect(() =>
      parseMprCandidateBytes(new TextEncoder().encode(text.replace('BM="XM"', 'BM="C"'))),
    ).toThrow(/BM=/);
    expect(() =>
      parseMprCandidateBytes(new TextEncoder().encode(text.replace('<101 \\Comment\\', '<110 \\Raro\\'))),
    ).toThrow(/subconjunto/);
    expect(() =>
      parseMprCandidateBytes(new TextEncoder().encode(text.replace(/\r\n/g, '\n'))),
    ).toThrow(/CRLF/);
  });
});
