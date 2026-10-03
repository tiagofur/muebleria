import { describe, expect, it } from 'vitest';
import type { PartDrillingPattern } from '@granete/domain';
import {
  JobDataInvalidError,
  invertKdtOperation,
  transformJobToPrograms,
  transformPatternToPrograms,
  type KdtProvenance,
} from './transform';
import { serializeKdtPanelDocument } from './format';
import { parseKdtPanelBytes } from './parse';

const PROVENANCE: KdtProvenance = {
  adapterId: 'granete-kdt',
  adapterVersion: '0.2.0',
  profileId: 'kdt-flexdrill-1200',
  profileRevision: 'r2',
};

/** Reader fields → neutral operation (test-side bridge, never a writer helper). */
function parsedToNeutralOperation(
  operation: ReturnType<typeof parseKdtPanelBytes>['operations'][number],
) {
  if (operation.kind === 'vertical-hole') {
    return {
      kind: 'vertical-hole' as const,
      x1Mm: operation.fields.X1!,
      y1Mm: operation.fields.Y1!,
      diameterMm: operation.fields.Diameter!,
      depthMm: operation.fields.Depth!,
    };
  }
  if (operation.kind === 'horizontal-hole') {
    return {
      kind: 'horizontal-hole' as const,
      quadrant: operation.fields.Quadrant! as 1 | 2 | 3 | 4,
      x1Mm: operation.fields.X1!,
      y1Mm: operation.fields.Y1!,
      z1Mm: operation.fields.Z1!,
      diameterMm: operation.fields.Diameter!,
      depthMm: operation.fields.Depth!,
    };
  }
  return undefined;
}

/** Holes on ALL six faces of one 600×400×18 board (canonical face frames). */
function allFacesPattern(): PartDrillingPattern {
  return {
    pieceCode: 'MOD-1-P01',
    moduleCode: 'MOD-1',
    partName: 'Pieza Seis Caras',
    lengthMm: 600,
    widthMm: 400,
    thicknessMm: 18,
    materialName: 'MDF 18mm',
    holes: [
      { face: 'front', xMm: 120, yMm: 200, diameterMm: 8, depthMm: 12, type: 'dowel' },
      { face: 'back', xMm: 90, yMm: 150, diameterMm: 35, depthMm: 11.5, type: 'hinge' },
      { face: 'left', xMm: 9, yMm: 100, diameterMm: 5, depthMm: 36, type: 'minifix' },
      { face: 'right', xMm: 9, yMm: 480, diameterMm: 5, depthMm: 36, type: 'minifix' },
      { face: 'top', xMm: 300, yMm: 9, diameterMm: 4, depthMm: 12, type: 'screw' },
      { face: 'bottom', xMm: 220, yMm: 9, diameterMm: 4, depthMm: 12, type: 'screw' },
    ],
  };
}

describe('transformJobToPrograms (política Granete→KDT, #1005 K2)', () => {
  it('separa un programa por cara de mecanizado: front-up (front+cantos) y back-up (back)', () => {
    const programs = transformJobToPrograms(
      { drilling: { patterns: [allFacesPattern()] } },
      PROVENANCE,
    );
    expect(programs.map((p) => p.machiningFace)).toEqual(['front', 'back']);
    const frontUp = programs[0]!;
    const backUp = programs[1]!;
    // front-up lleva el agujero frontal + los 4 de canto; back-up sólo el suyo.
    expect(frontUp.document.operations).toHaveLength(5);
    expect(backUp.document.operations).toHaveLength(1);
  });

  it('round-trip invertible en las 6 caras y ambas orientaciones (BHX03)', () => {
    const pattern = allFacesPattern();
    const programs = transformJobToPrograms({ drilling: { patterns: [pattern] } }, PROVENANCE);
    const originalByFace = new Map(pattern.holes.map((hole) => [hole.face, hole]));
    for (const program of programs) {
      const bytes = serializeKdtPanelDocument(program.document);
      const parsed = parseKdtPanelBytes(bytes);
      expect(parsed.panel.name).toBe(pattern.partName);
      for (const operation of parsed.operations) {
        const neutral = parsedToNeutralOperation(operation);
        if (!neutral) continue; // el subconjunto del writer sólo emite TypeNo 1/2
        const inverted = invertKdtOperation(neutral, program.machiningFace, program.document.panel);
        const original = originalByFace.get(inverted.face)!;
        expect(original, `cara ${inverted.face} en ${program.machiningFace}-up`).toBeDefined();
        expect(inverted.xMm).toBeCloseTo(original.xMm, 6);
        expect(inverted.yMm).toBeCloseTo(original.yMm, 6);
        expect(inverted.diameterMm).toBe(original.diameterMm);
        expect(inverted.depthMm).toBe(original.depthMm);
      }
    }
  });

  it('cuadrantes y Z1 por orientación: front-up izquierda=Q3, back-up izquierda=Q4, Z1=t/2 centrado', () => {
    const pattern: PartDrillingPattern = {
      ...allFacesPattern(),
      holes: [{ face: 'left', xMm: 9, yMm: 100, diameterMm: 5, depthMm: 36, type: 'minifix' }],
    };
    const { programs } = transformPatternToPrograms(pattern, PROVENANCE);
    expect(programs).toHaveLength(1);
    const frontUp = programs[0]!.document.operations[0]!;
    expect(frontUp.kind).toBe('horizontal-hole');
    if (frontUp.kind !== 'horizontal-hole') return;
    expect(frontUp.quadrant).toBe(3);
    expect(frontUp.y1Mm).toBe(400); // Y=PanelWidth (canto izquierdo, front-up)
    expect(frontUp.x1Mm).toBe(100); // a lo largo del largo
    expect(frontUp.z1Mm).toBe(9); // 18 − 9 = t/2

    const backUpOnly: PartDrillingPattern = {
      ...pattern,
      holes: [
        { face: 'back', xMm: 50, yMm: 60, diameterMm: 8, depthMm: 12, type: 'dowel' },
        { face: 'left', xMm: 9, yMm: 100, diameterMm: 5, depthMm: 36, type: 'minifix' },
      ],
    };
    const backPrograms = transformPatternToPrograms(backUpOnly, PROVENANCE).programs;
    expect(backPrograms.map((p) => p.machiningFace)).toEqual(['back']);
    const backOps = backPrograms[0]!.document.operations;
    const edge = backOps.find((op) => op.kind === 'horizontal-hole');
    expect(edge && edge.kind === 'horizontal-hole' ? edge.quadrant : undefined).toBe(4);
    const vertical = backOps.find((op) => op.kind === 'vertical-hole');
    // back frame bajo X=z, Y=x: Y1 = xMm SIN espejo.
    expect(vertical && vertical.kind === 'vertical-hole' ? vertical.y1Mm : undefined).toBe(50);
  });

  it('AlignmentFace: exactamente un vértice Banding=2 en el canto X=0 (política r1)', () => {
    const { programs } = transformPatternToPrograms(allFacesPattern(), PROVENANCE);
    for (const program of programs) {
      const parsed = parseKdtPanelBytes(serializeKdtPanelDocument(program.document));
      const alignment = parsed.panel.outline.filter((vertex) => vertex.banding === 2);
      expect(alignment).toHaveLength(1);
      expect(alignment[0]!.x1Mm).toBe(0);
      expect(alignment[0]!.description).toBe('AlignmentFace');
    }
  });

  it('pieza sin agujeros no produce programas; pieza edge-only produce un front-up', () => {
    const empty: PartDrillingPattern = { ...allFacesPattern(), holes: [] };
    expect(transformPatternToPrograms(empty, PROVENANCE).programs).toHaveLength(0);
    const edgeOnly: PartDrillingPattern = {
      ...allFacesPattern(),
      holes: [{ face: 'top', xMm: 100, yMm: 9, diameterMm: 4, depthMm: 12, type: 'screw' }],
    };
    const edgePrograms = transformPatternToPrograms(edgeOnly, PROVENANCE).programs;
    expect(edgePrograms.map((p) => p.machiningFace)).toEqual(['front']);
  });

  it('falla cerrada: thicknessMm ausente y coordenadas fuera del marco de su cara', () => {
    const noThickness: PartDrillingPattern = {
      ...allFacesPattern(),
      thicknessMm: undefined,
    };
    const noThicknessResult = transformPatternToPrograms(noThickness, PROVENANCE);
    expect(noThicknessResult.programs).toHaveLength(0);
    expect(noThicknessResult.reasons[0]?.code).toBe('JOB_DATA_INVALID');

    // Convención de caras violada (left lleva el espesor en xMm): 300 > 18.
    const outOfFrame: PartDrillingPattern = {
      ...allFacesPattern(),
      holes: [{ face: 'left', xMm: 300, yMm: 100, diameterMm: 8, depthMm: 34, type: 'minifix' }],
    };
    expect(() => transformJobToPrograms({ drilling: { patterns: [outOfFrame] } }, PROVENANCE)).toThrow(
      JobDataInvalidError,
    );
  });
});
