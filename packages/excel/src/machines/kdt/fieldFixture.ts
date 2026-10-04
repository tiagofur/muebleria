/**
 * K4 field fixture (#1005) — the frozen, hand-verifiable machining job the
 * client-b field session imports into the Flexdrill 1200.
 *
 * Design rules:
 * - Synthetic identity only (no client data); fixed timestamps so the bytes
 *   and manifests are deterministic across machines.
 * - Every value is an integer mm (exact at the writer's 2-decimal preflight)
 *   and hand-checkable by an operator on the machine's program preview.
 * - Covers the full emitted subset: TypeNo 1 from BOTH large faces (the
 *   Promob "Face A/B" split), TypeNo 2 on all four edges (quadrants 1-4),
 *   centered Z1 = thickness/2, and an edges-only piece (single program).
 * - `KDT_FIELD_EXPECTATIONS` is the structured expected-values table: the
 *   tests assert the real transform output matches it value by value, the
 *   docs quote it, and the pinned program hashes bind docs and code.
 */

import type { ResolvedMachiningJob } from '@granete/domain';

export const KDT_FIELD_FIXTURE_ID = 'fixture-kdt-field-001';
export const KDT_FIELD_FIXTURE_GENERATED_AT = '2026-10-03T00:00:00.000Z';
export const KDT_FIELD_FIXTURE_RELEASE_ID = 'fixture-kdt-field-release-001';
export const KDT_FIELD_FIXTURE_BOM_FINGERPRINT = 'fixture-kdt-field-bom-001';

export function buildKdtFieldFixtureJob(): ResolvedMachiningJob {
  return {
    jobId: `${KDT_FIELD_FIXTURE_ID}--kdt`,
    provenance: {
      projectId: KDT_FIELD_FIXTURE_ID,
      generatedAt: KDT_FIELD_FIXTURE_GENERATED_AT,
      productionReleaseId: KDT_FIELD_FIXTURE_RELEASE_ID,
      bomFingerprint: KDT_FIELD_FIXTURE_BOM_FINGERPRINT,
    },
    drilling: {
      schema: 'muebles.drilling-data.v1',
      projectId: KDT_FIELD_FIXTURE_ID,
      projectName: 'Fixture K4 Campo KDT',
      generatedAt: KDT_FIELD_FIXTURE_GENERATED_AT,
      totalPiecesCount: 2,
      totalHolesCount: 12,
      source: 'frozen-release',
      releaseId: KDT_FIELD_FIXTURE_RELEASE_ID,
      manufacturingFingerprint: KDT_FIELD_FIXTURE_BOM_FINGERPRINT,
      patterns: [
        {
          pieceCode: 'MOD-K4-P01',
          moduleCode: 'MOD-K4',
          partName: 'Lateral K4 P01',
          lengthMm: 600,
          widthMm: 400,
          thicknessMm: 18,
          materialName: 'MDP 18mm',
          holes: [
            // Cara vista (front) — pines de entrepaño.
            { face: 'front', xMm: 50, yMm: 100, diameterMm: 5, depthMm: 10, type: 'shelf' },
            { face: 'front', xMm: 350, yMm: 100, diameterMm: 5, depthMm: 10, type: 'shelf' },
            // Cara trasera (back) — tarugos de ensamble.
            { face: 'back', xMm: 50, yMm: 500, diameterMm: 8, depthMm: 12, type: 'dowel' },
            { face: 'back', xMm: 350, yMm: 500, diameterMm: 8, depthMm: 12, type: 'dowel' },
            // Cantos: minifix (canto superior), tarugo (inferior),
            // tornillo de excéntrica (izquierdo), tornillo bisagra (derecho).
            { face: 'top', xMm: 200, yMm: 9, diameterMm: 15, depthMm: 12, type: 'minifix' },
            { face: 'bottom', xMm: 200, yMm: 9, diameterMm: 8, depthMm: 15, type: 'dowel' },
            { face: 'left', xMm: 9, yMm: 300, diameterMm: 5, depthMm: 36, type: 'screw' },
            { face: 'right', xMm: 9, yMm: 200, diameterMm: 4, depthMm: 12, type: 'screw' },
          ],
        },
        {
          pieceCode: 'MOD-K4-P02',
          moduleCode: 'MOD-K4',
          partName: 'Base K4 P02',
          lengthMm: 600,
          widthMm: 400,
          thicknessMm: 18,
          materialName: 'MDP 18mm',
          holes: [
            // Sólo cantos: 4 tornillos Ø5 d36 (2 por canto lateral).
            { face: 'left', xMm: 9, yMm: 150, diameterMm: 5, depthMm: 36, type: 'screw' },
            { face: 'left', xMm: 9, yMm: 450, diameterMm: 5, depthMm: 36, type: 'screw' },
            { face: 'right', xMm: 9, yMm: 150, diameterMm: 5, depthMm: 36, type: 'screw' },
            { face: 'right', xMm: 9, yMm: 450, diameterMm: 5, depthMm: 36, type: 'screw' },
          ],
        },
      ],
    },
  };
}

export interface KdtFieldExpectedOperation {
  readonly label: string;
  readonly typeNo: 1 | 2;
  readonly quadrant?: 1 | 2 | 3 | 4;
  readonly x1Mm: number;
  readonly y1Mm: number;
  readonly z1Mm?: number;
  readonly diameterMm: number;
  readonly depthMm: number;
}

export interface KdtFieldExpectedProgram {
  readonly pieceCode: string;
  readonly machiningFace: 'front' | 'back';
  readonly panelName: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly operations: readonly KdtFieldExpectedOperation[];
}

/**
 * Hand-computed expected values (transform policy: front-up {X=z, Y=w−x,
 * Z=−y} / back-up {X=z, Y=x, Z=+y}; edges join the primary group; the X=0
 * edge carries the AlignmentFace in both orientations). The tests assert
 * the real pipeline against this table value by value — the field operator
 * checks the machine against the same numbers.
 */
export const KDT_FIELD_EXPECTATIONS: readonly KdtFieldExpectedProgram[] = [
  {
    pieceCode: 'MOD-K4-P01',
    machiningFace: 'front',
    panelName: 'Lateral K4 P01',
    lengthMm: 600,
    widthMm: 400,
    thicknessMm: 18,
    operations: [
      { label: 'pin entrepaño 1', typeNo: 1, x1Mm: 100, y1Mm: 350, diameterMm: 5, depthMm: 10 },
      { label: 'pin entrepaño 2', typeNo: 1, x1Mm: 100, y1Mm: 50, diameterMm: 5, depthMm: 10 },
      { label: 'minifix canto superior', typeNo: 2, quadrant: 1, x1Mm: 600, y1Mm: 200, z1Mm: 9, diameterMm: 15, depthMm: 12 },
      { label: 'tarugo canto inferior', typeNo: 2, quadrant: 2, x1Mm: 0, y1Mm: 200, z1Mm: 9, diameterMm: 8, depthMm: 15 },
      { label: 'tornillo excéntrica canto izquierdo', typeNo: 2, quadrant: 3, x1Mm: 300, y1Mm: 400, z1Mm: 9, diameterMm: 5, depthMm: 36 },
      { label: 'tornillo bisagra canto derecho', typeNo: 2, quadrant: 4, x1Mm: 200, y1Mm: 0, z1Mm: 9, diameterMm: 4, depthMm: 12 },
    ],
  },
  {
    pieceCode: 'MOD-K4-P01',
    machiningFace: 'back',
    panelName: 'Lateral K4 P01',
    lengthMm: 600,
    widthMm: 400,
    thicknessMm: 18,
    operations: [
      { label: 'tarugo 1', typeNo: 1, x1Mm: 500, y1Mm: 50, diameterMm: 8, depthMm: 12 },
      { label: 'tarugo 2', typeNo: 1, x1Mm: 500, y1Mm: 350, diameterMm: 8, depthMm: 12 },
    ],
  },
  {
    pieceCode: 'MOD-K4-P02',
    machiningFace: 'front',
    panelName: 'Base K4 P02',
    lengthMm: 600,
    widthMm: 400,
    thicknessMm: 18,
    operations: [
      { label: 'tornillo excéntrica izquierdo 1', typeNo: 2, quadrant: 3, x1Mm: 150, y1Mm: 400, z1Mm: 9, diameterMm: 5, depthMm: 36 },
      { label: 'tornillo excéntrica izquierdo 2', typeNo: 2, quadrant: 3, x1Mm: 450, y1Mm: 400, z1Mm: 9, diameterMm: 5, depthMm: 36 },
      { label: 'tornillo excéntrica derecho 1', typeNo: 2, quadrant: 4, x1Mm: 150, y1Mm: 0, z1Mm: 9, diameterMm: 5, depthMm: 36 },
      { label: 'tornillo excéntrica derecho 2', typeNo: 2, quadrant: 4, x1Mm: 450, y1Mm: 0, z1Mm: 9, diameterMm: 5, depthMm: 36 },
    ],
  },
];

/**
 * Pinned sha256 of each program's XML bytes (adapter granete-kdt@0.2.0,
 * profile kdt-flexdrill-1200@r2). The docs quote these; the tests recompute
 * them, so docs and code can never drift apart silently.
 */
export const KDT_FIELD_PROGRAM_SHA256: Readonly<Record<string, string>> = {
  'MOD-K4-P01:front': '89d30b7825890d419c35311a7cbcb51ea58bce8526d97f620532f4d8bbf8c70f',
  'MOD-K4-P01:back': '6c1d884b9e9bdbe84de82e74ba75c570db13eedf061c8a5003785fd647702125',
  'MOD-K4-P02:front': '41987e71c9a5cc01c878e270ebc99ed0ef583151cf8d04f5fcd6c0c755ad170c',
};
