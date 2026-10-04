/**
 * Granete → woodWOP MPR CANDIDATE transform (#879 B2-prep).
 *
 * Same orientation policy as the KDT transform (machines/kdt/transform.ts —
 * front-up {X=z, Y=w−x, Z=−y} / back-up {X=z, Y=x, Z=+y}, per-face file
 * split, edges on the primary group), expressed in the MPR vocabulary:
 * <102 \BohrVert\ for the up-face holes, <103 \BohrHoriz\ with an explicit
 * travel direction (BM) for the edge holes. The direction↔edge table IS
 * the KDT quadrant correspondence:
 *   front-up: left→YM (Y=w) · right→YP (Y=0) · bottom→XP (X=0) · top→XM (X=l)
 *   back-up:  left→YP (Y=0) · right→YM (Y=w) · bottom→XP · top→XM
 * (same edges the KDT quadrants 3/4/2/1 — front-up — denote).
 *
 * Implemented independently from the KDT transform on purpose: the two
 * dialects must be provable against each other, not coupled.
 */

import type { HoleDefinition, PartDrillingPattern } from '@granete/domain';
import type {
  MprCandidateDocument,
  MprCandidateDrillDirection,
  MprCandidateOperation,
} from './mprDocument';
import { MprCandidateParseError } from './mprParse';

export interface MprCandidateProvenance {
  readonly generator: string;
  readonly dialect: string;
  readonly pieceCode: string;
  readonly machiningFace: 'front' | 'back';
}

export interface MprCandidatePieceProgram {
  readonly pieceCode: string;
  readonly machiningFace: 'front' | 'back';
  readonly document: MprCandidateDocument;
}

const DIRECTIONS: ReadonlySet<string> = new Set(['XP', 'XM', 'YP', 'YM']);

function horizontalDirection(
  face: Exclude<HoleDefinition['face'], 'front' | 'back'>,
  upFace: 'front' | 'back',
): MprCandidateDrillDirection {
  if (upFace === 'front') {
    // left→YM · right→YP · bottom→XP · top→XM
    switch (face) {
      case 'left':
        return 'YM';
      case 'right':
        return 'YP';
      case 'bottom':
        return 'XP';
      case 'top':
        return 'XM';
    }
  }
  // back-up: left→YP · right→YM · bottom→XP · top→XM
  switch (face) {
    case 'left':
      return 'YP';
    case 'right':
      return 'YM';
    case 'bottom':
      return 'XP';
    case 'top':
      return 'XM';
  }
}

export function holeToMprCandidateOperation(
  hole: HoleDefinition,
  upFace: 'front' | 'back',
  pattern: Pick<PartDrillingPattern, 'lengthMm' | 'widthMm' | 'thicknessMm' | 'pieceCode'>,
): MprCandidateOperation {
  const w = pattern.widthMm;
  const t = pattern.thicknessMm ?? 0;
  const l = pattern.lengthMm;

  if (hole.face === upFace) {
    if (upFace === 'front') {
      return {
        kind: 'bohr-vert',
        xaMm: hole.yMm,
        yaMm: w - hole.xMm,
        diameterMm: hole.diameterMm,
        depthMm: hole.depthMm,
      };
    }
    return {
      kind: 'bohr-vert',
      xaMm: hole.yMm,
      yaMm: hole.xMm,
      diameterMm: hole.diameterMm,
      depthMm: hole.depthMm,
    };
  }
  if (hole.face === 'front' || hole.face === 'back') {
    throw new MprCandidateParseError(
      `agujero en cara ${hole.face} no alcanzable con la cara ${upFace} arriba (pieza ${pattern.pieceCode})`,
    );
  }

  const thicknessCoord = hole.face === 'left' || hole.face === 'right' ? hole.xMm : hole.yMm;
  const za = upFace === 'front' ? t - thicknessCoord : thicknessCoord;
  if (!(za > 0 && za < t)) {
    throw new MprCandidateParseError(
      `agujero ${hole.type} en cara ${hole.face} con eje fuera del espesor (ZA=${za}, pieza ${pattern.pieceCode})`,
    );
  }
  const direction = horizontalDirection(hole.face, upFace);
  if (!DIRECTIONS.has(direction)) throw new Error(`dirección no mapeada ${direction}`);
  if (hole.face === 'left' || hole.face === 'right') {
    return {
      kind: 'bohr-horiz',
      xaMm: hole.yMm,
      // BM=YM entra desde el canto Y=w; YP desde Y=0 — la posición del
      // canto se deriva de la dirección del taladro.
      yaMm: direction === 'YM' ? w : 0,
      zaMm: za,
      direction,
      diameterMm: hole.diameterMm,
      depthMm: hole.depthMm,
    };
  }
  // top/bottom: XA at the panel ends, YA along width.
  const alongWidth = hole.xMm;
  return {
    kind: 'bohr-horiz',
    xaMm: hole.face === 'top' ? l : 0,
    yaMm: upFace === 'front' ? w - alongWidth : alongWidth,
    zaMm: za,
    direction,
    diameterMm: hole.diameterMm,
    depthMm: hole.depthMm,
  };
}

/**
 * One MPR candidate program per piece/machining-face — same grouping rules
 * as the KDT transform (front group + edges / back group / edges-only).
 * Pieces without holes produce no program; defects throw (never dropped).
 */
export function transformPatternToMprCandidatePrograms(
  pattern: PartDrillingPattern,
  baseProvenance: Omit<MprCandidateProvenance, 'pieceCode' | 'machiningFace'>,
): MprCandidatePieceProgram[] {
  const t = pattern.thicknessMm;
  if (t === undefined || !Number.isFinite(t) || t <= 0) {
    throw new MprCandidateParseError(
      `pieza ${pattern.pieceCode}: thicknessMm ausente o inválido (${String(t)})`,
    );
  }
  const front: HoleDefinition[] = [];
  const back: HoleDefinition[] = [];
  const edges: HoleDefinition[] = [];
  for (const hole of pattern.holes) {
    if (hole.face === 'front') front.push(hole);
    else if (hole.face === 'back') back.push(hole);
    else edges.push(hole);
  }
  const build = (upFace: 'front' | 'back', holes: readonly HoleDefinition[]): MprCandidatePieceProgram => ({
    pieceCode: pattern.pieceCode,
    machiningFace: upFace,
    document: {
      piece: {
        lengthMm: pattern.lengthMm,
        widthMm: pattern.widthMm,
        thicknessMm: t,
        name: pattern.partName,
      },
      operations: holes.map((hole) => holeToMprCandidateOperation(hole, upFace, pattern)),
      provenance: {
        ...baseProvenance,
        pieceCode: pattern.pieceCode,
        machiningFace: upFace,
      },
    },
  });

  const programs: MprCandidatePieceProgram[] = [];
  if (front.length > 0) programs.push(build('front', [...front, ...edges]));
  if (back.length > 0) {
    programs.push(build('back', front.length === 0 ? [...back, ...edges] : back));
  }
  if (programs.length === 0 && edges.length > 0) {
    programs.push(build('front', edges));
  }
  return programs;
}

/** Whole-job split into candidate programs; pieces keep their order. */
export function transformJobToMprCandidatePrograms(
  job: { readonly drilling: { readonly patterns: readonly PartDrillingPattern[] } },
  baseProvenance: Omit<MprCandidateProvenance, 'pieceCode' | 'machiningFace'>,
): MprCandidatePieceProgram[] {
  return job.drilling.patterns.flatMap((pattern) =>
    transformPatternToMprCandidatePrograms(pattern, baseProvenance),
  );
}
