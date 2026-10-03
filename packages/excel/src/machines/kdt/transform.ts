/**
 * Granete → KDTPanelFormat transform policy (#1005 K2).
 *
 * Turns a neutral ResolvedMachiningJob into per-panel KDT documents under
 * ONE documented, invertible policy:
 *
 * Board-local axes (hardwarePlacement authority): x = width (0..w),
 * y = thickness (0..t), z = length (0..l). Face frames are axis-aligned
 * projections (partDrilling convention): front/back → (x along width,
 * y along length); left/right → (x along thickness, y along length);
 * top/bottom → (x along width, y along thickness).
 *
 * Orientations (proper rotations only — never a mirror):
 * - FRONT-UP: X_kdt = z, Y_kdt = w − x, Z_kdt = −y.
 *   Quadrants: left→3, right→4, bottom→2, top→1.
 * - BACK-UP: X_kdt = z, Y_kdt = x, Z_kdt = +y.
 *   Quadrants: left→4, right→3, bottom→2, top→1.
 *
 * Programs per piece (Promob's own "Face A/B" granularity): vertical holes
 * exist only in the file of their face (front group / back group); edge
 * holes are drilled flat and join the piece's PRIMARY group (front when it
 * exists, else back, else a front-up group for edge-only pieces). A piece
 * with no holes produces no program.
 *
 * AlignmentFace (Granete policy r1): the X=0 edge (Quadrant 2, board
 * 'bottom' face) in BOTH orientations — the deterministic loading reference
 * until K4 field evidence refines it.
 *
 * `invertKdtOperation` is the READER-side inverse used by round-trip tests
 * and future imports; it shares no code with the writer.
 */

import type {
  AdapterBlockReason,
  HoleDefinition,
  PartDrillingPattern,
} from '@granete/domain';
import type {
  KdtPanelDocument,
  KdtPanelOperation,
  KdtQuadrant,
} from './document';

/** Granete provenance stamped into every program's AUTHOR comment. */
export interface KdtProvenance {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly profileId: string;
  readonly profileRevision: string;
}

export interface KdtPieceProgram {
  readonly pieceCode: string;
  /** Which board face points UP on the machine for this program. */
  readonly machiningFace: 'front' | 'back';
  readonly document: KdtPanelDocument;
}

export class JobDataInvalidError extends Error {
  constructor(readonly reasons: readonly AdapterBlockReason[]) {
    super(`kdt: datos de trabajo inválidos — ${reasons.map((r) => r.detail).join('; ')}`);
    this.name = 'JobDataInvalidError';
  }
}

function invalid(detail: string): AdapterBlockReason {
  return { code: 'JOB_DATA_INVALID', detail };
}

function validateHole(hole: HoleDefinition, pattern: PartDrillingPattern): string | undefined {
  const { widthMm: w, lengthMm: l } = pattern;
  // NaN cuando thicknessMm falta: transformPatternToPrograms ya bloqueó ese
  // caso antes de llegar aquí, así que NaN nunca participa de una decisión.
  const t = pattern.thicknessMm ?? Number.NaN;
  const inRange = (value: number, max: number, label: string): string | undefined => {
    if (!Number.isFinite(value) || value < 0 || value > max) {
      return `agujero ${hole.type} en cara ${hole.face}: ${label}=${value} fuera de marco [0, ${max}]`;
    }
    return undefined;
  };
  switch (hole.face) {
    case 'front':
    case 'back':
      return inRange(hole.xMm, w, 'xMm(ancho)') ?? inRange(hole.yMm, l, 'yMm(largo)');
    case 'left':
    case 'right':
      return inRange(hole.xMm, t, 'xMm(espesor)') ?? inRange(hole.yMm, l, 'yMm(largo)');
    case 'top':
    case 'bottom':
      return inRange(hole.xMm, w, 'xMm(ancho)') ?? inRange(hole.yMm, t, 'yMm(espesor)');
    default:
      return `cara desconocida: ${String(hole.face)}`;
  }
}

/**
 * Validates one pattern and returns its KDT programs (0, 1 or 2 — one per
 * machining face). Collects every defect instead of failing on the first,
 * so the workshop sees the full data picture at once.
 */
export function transformPatternToPrograms(
  pattern: PartDrillingPattern,
  provenance: KdtProvenance,
): { programs: KdtPieceProgram[]; reasons: AdapterBlockReason[] } {
  const reasons: AdapterBlockReason[] = [];
  const t = pattern.thicknessMm;
  if (t === undefined || !Number.isFinite(t) || t <= 0) {
    reasons.push(
      invalid(
        `pieza ${pattern.pieceCode}: thicknessMm ausente o inválido (${String(t)}) — el marco KDT lo requiere`,
      ),
    );
    return { programs: [], reasons };
  }

  const front: HoleDefinition[] = [];
  const back: HoleDefinition[] = [];
  const edges: HoleDefinition[] = [];
  for (const hole of pattern.holes) {
    const defect = validateHole(hole, pattern);
    if (defect !== undefined) {
      reasons.push(invalid(`pieza ${pattern.pieceCode}: ${defect}`));
      continue;
    }
    if (hole.face === 'front') front.push(hole);
    else if (hole.face === 'back') back.push(hole);
    else edges.push(hole);
  }

  const build = (upFace: 'front' | 'back', holes: readonly HoleDefinition[]): KdtPieceProgram => ({
    pieceCode: pattern.pieceCode,
    machiningFace: upFace,
    document: {
      panel: {
        lengthMm: pattern.lengthMm,
        widthMm: pattern.widthMm,
        thicknessMm: t,
        name: pattern.partName,
        alignmentEdge: 'x0',
      },
      operations: holes.map((hole) => holeToOperation(hole, upFace, pattern)),
      provenance,
    },
  });

  const programs: KdtPieceProgram[] = [];
  if (front.length > 0) programs.push(build('front', [...front, ...edges]));
  if (back.length > 0) {
    programs.push(build('back', front.length === 0 ? [...back, ...edges] : back));
  }
  if (programs.length === 0 && edges.length > 0) {
    programs.push(build('front', edges));
  }
  return { programs, reasons };
}

/** Whole-job split. Pieces keep their order; defects surface as one error. */
export function transformJobToPrograms(
  job: { readonly drilling: { readonly patterns: readonly PartDrillingPattern[] } },
  provenance: KdtProvenance,
): KdtPieceProgram[] {
  const programs: KdtPieceProgram[] = [];
  const reasons: AdapterBlockReason[] = [];
  for (const pattern of job.drilling.patterns) {
    const result = transformPatternToPrograms(pattern, provenance);
    programs.push(...result.programs);
    reasons.push(...result.reasons);
  }
  if (reasons.length > 0) throw new JobDataInvalidError(reasons);
  return programs;
}

/**
 * The full mapping table. Pure function of (hole, upFace, panel): both
 * orientations and every face are covered explicitly; no default branch
 * silently maps an unknown face (validation already filtered those).
 */
export function holeToOperation(
  hole: HoleDefinition,
  upFace: 'front' | 'back',
  pattern: Pick<PartDrillingPattern, 'lengthMm' | 'widthMm' | 'thicknessMm' | 'pieceCode'>,
): KdtPanelOperation {
  const w = pattern.widthMm;
  const t = pattern.thicknessMm ?? 0;
  const l = pattern.lengthMm;

  if (hole.face === upFace) {
    if (upFace === 'front') {
      // front frame (x=width, y=length) under X=z, Y=w−x.
      return {
        kind: 'vertical-hole',
        x1Mm: hole.yMm,
        y1Mm: w - hole.xMm,
        diameterMm: hole.diameterMm,
        depthMm: hole.depthMm,
      };
    }
    // back frame under X=z, Y=x.
    return {
      kind: 'vertical-hole',
      x1Mm: hole.yMm,
      y1Mm: hole.xMm,
      diameterMm: hole.diameterMm,
      depthMm: hole.depthMm,
    };
  }
  if (hole.face === 'front' || hole.face === 'back') {
    // Unreachable through transformPatternToPrograms (holes are grouped by
    // their own face); a hard guard instead of a silent wrong mapping.
    throw new Error(
      `kdt: agujero en cara ${hole.face} no alcanzable con la cara ${upFace} hacia arriba (pieza ${pattern.pieceCode})`,
    );
  }

  // Edge faces: the thickness coordinate drives Z1 (height from the UP face);
  // left/right carry it on xMm, top/bottom on yMm.
  const thicknessCoord = hole.face === 'left' || hole.face === 'right' ? hole.xMm : hole.yMm;
  const z1 = upFace === 'front' ? t - thicknessCoord : thicknessCoord;
  if (!(z1 > 0 && z1 < t)) {
    throw new Error(
      `kdt: agujero ${hole.type} en cara ${hole.face} con eje fuera del espesor (Z1=${z1}, pieza ${pattern.pieceCode})`,
    );
  }
  const horizontal = (
    quadrant: KdtQuadrant,
    x1Mm: number,
    y1Mm: number,
  ): KdtPanelOperation => ({
    kind: 'horizontal-hole',
    quadrant,
    x1Mm,
    y1Mm,
    z1Mm: z1,
    diameterMm: hole.diameterMm,
    depthMm: hole.depthMm,
  });

  if (upFace === 'front') {
    // Quadrants: left→3(Y=w), right→4(Y=0), bottom→2(X=0), top→1(X=l).
    switch (hole.face) {
      case 'left':
        return horizontal(3, hole.yMm, w);
      case 'right':
        return horizontal(4, hole.yMm, 0);
      case 'bottom':
        return horizontal(2, 0, w - hole.xMm);
      case 'top':
        return horizontal(1, l, w - hole.xMm);
    }
  }
  // BACK-UP: left→4(Y=0), right→3(Y=w), bottom→2(X=0), top→1(X=l).
  switch (hole.face) {
    case 'left':
      return horizontal(4, hole.yMm, 0);
    case 'right':
      return horizontal(3, hole.yMm, w);
    case 'bottom':
      return horizontal(2, 0, hole.xMm);
    case 'top':
      return horizontal(1, l, hole.xMm);
  }
  throw new Error(`kdt: cara no mapeada ${String(hole.face)}`);
}

/**
 * READER-side inverse: recover the neutral face-frame coordinates of one
 * operation. Round-trip tests assert doc → invert → original hole for all
 * six faces and both orientations (BHX03-style invertibility).
 */
export function invertKdtOperation(
  operation: KdtPanelOperation,
  upFace: 'front' | 'back',
  panel: Pick<KdtPanelDocument['panel'], 'lengthMm' | 'widthMm' | 'thicknessMm'>,
): Pick<HoleDefinition, 'face' | 'xMm' | 'yMm' | 'diameterMm' | 'depthMm'> {
  const w = panel.widthMm;
  const t = panel.thicknessMm;
  if (operation.kind === 'vertical-hole') {
    if (upFace === 'front') {
      return { face: 'front', xMm: w - operation.y1Mm, yMm: operation.x1Mm, diameterMm: operation.diameterMm, depthMm: operation.depthMm };
    }
    return { face: 'back', xMm: operation.y1Mm, yMm: operation.x1Mm, diameterMm: operation.diameterMm, depthMm: operation.depthMm };
  }
  const thicknessCoord = upFace === 'front' ? t - operation.z1Mm : operation.z1Mm;
  switch (operation.quadrant) {
    case 1:
    case 2:
      // top (Q1) / bottom (Q2): x along width from Y1, y along thickness.
      return {
        face: operation.quadrant === 1 ? 'top' : 'bottom',
        xMm: upFace === 'front' ? w - operation.y1Mm : operation.y1Mm,
        yMm: thicknessCoord,
        diameterMm: operation.diameterMm,
        depthMm: operation.depthMm,
      };
    case 3:
    case 4:
      // left (front-up Q3 / back-up Q4) / right (the others):
      // x along thickness, y along length (X1).
      return {
        face: (operation.quadrant === 3) === (upFace === 'front') ? 'left' : 'right',
        xMm: thicknessCoord,
        yMm: operation.x1Mm,
        diameterMm: operation.diameterMm,
        depthMm: operation.depthMm,
      };
  }
}
