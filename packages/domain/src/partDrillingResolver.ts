/**
 * Pure domain part drilling resolution engine (F128).
 *
 * Resolves per-piece CNC hole definitions from HardwarePlacements and
 * catalog HardwareMachiningProfiles. Coordinates are face-referenced (mm)
 * with the origin at the bottom-left corner of each face when viewed from
 * outside.
 *
 * Includes:
 *  - Face-plane mapping with parametric formula support & 2D rotation
 *  - Entry face selection (anchor vs opposite)
 *  - Coincident hole deduplication
 *  - Structured geometry validation (depth vs material, out-of-bounds, collisions)
 *  - Graceful fallback to F074 heuristics when no machining profiles exist
 */

import { ValidationError } from './errors';
import { evaluatePartFormula } from './engine/shared';
import { inferHolesForPiece, type HoleDefinition, type HoleFace, type HoleType, type PartDrillingPattern } from './partDrilling';
import type {
  AnchorFace,
  Hardware,
  HardwareMachiningPart,
  HardwarePlacement,
  MachiningOperation,
  ProductionCutRow,
  ResolvedBoardPart,
} from './types';

export type DrillingIssueCode =
  | 'DEPTH_EXCEEDS_MATERIAL'
  | 'HOLE_OUT_OF_BOUNDS'
  | 'HOLE_COLLISION';

export interface DrillingIssue {
  readonly code: DrillingIssueCode;
  readonly message: string;
  readonly hole: HoleDefinition;
  readonly conflictingHole?: HoleDefinition;
  readonly context?: Record<string, unknown>;
}

export interface ResolvedPartDrilling extends PartDrillingPattern {
  readonly issues: readonly DrillingIssue[];
  readonly fallbackUsed: boolean;
}

export type HardwareCatalogLookup =
  | readonly Hardware[]
  | ReadonlyMap<string, Hardware>
  | Readonly<Record<string, Hardware>>;

export interface PieceDescriptor {
  readonly id?: string;
  readonly code?: string;
  readonly partCode?: string;
  readonly description?: string;
  readonly partName?: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm?: number;
  readonly materialName?: string;
  readonly moduleCode?: string;
  readonly optionRole?: string;
}

export interface ResolvePartDrillingParams {
  readonly piece: ResolvedBoardPart | ProductionCutRow | PieceDescriptor;
  readonly placements?: readonly HardwarePlacement[];
  readonly hardwareCatalog?: HardwareCatalogLookup;
  readonly partRole?: string;
  readonly strict?: boolean;
}

export const OPPOSITE_FACE: Readonly<Record<HoleFace, HoleFace>> = {
  front: 'back',
  back: 'front',
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

interface FaceDimensions {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly maxDepthMm: number;
}

export function getFaceDimensions(
  face: HoleFace,
  piece: { readonly lengthMm: number; readonly widthMm: number; readonly thicknessMm: number },
): FaceDimensions {
  const w = Math.max(piece.widthMm, 0);
  const l = Math.max(piece.lengthMm, 0);
  const t = Math.max(piece.thicknessMm, 0);

  switch (face) {
    case 'front':
    case 'back':
      return { widthMm: w, heightMm: l, maxDepthMm: t };
    case 'left':
    case 'right':
      return { widthMm: t, heightMm: l, maxDepthMm: w };
    case 'top':
    case 'bottom':
      return { widthMm: w, heightMm: t, maxDepthMm: l };
  }
}

function findHardwareInCatalog(
  hardwareId: string,
  catalog?: HardwareCatalogLookup,
): Hardware | undefined {
  if (!catalog) return undefined;
  if (catalog instanceof Map) {
    return catalog.get(hardwareId);
  }
  if (Array.isArray(catalog)) {
    return catalog.find((h) => h.id === hardwareId);
  }
  return (catalog as Record<string, Hardware>)[hardwareId];
}

function inferHoleType(
  part?: HardwareMachiningPart,
  op?: MachiningOperation,
  hardware?: Hardware,
): HoleType {
  const role = (part?.role || '').toLowerCase();
  const label = (op?.label || op?.id || '').toLowerCase();
  const hwName = (hardware?.name || hardware?.code || '').toLowerCase();
  const previewShape = hardware?.previewShape;

  if (role.includes('hinge') || role.includes('bisagra') || role.includes('cup') || role.includes('taza') || role.includes('plate') || role.includes('placa') || previewShape === 'hinge' || hwName.includes('bisagra')) {
    return 'hinge';
  }
  if (role.includes('minifix') || role.includes('cam') || role.includes('bolt') || role.includes('perno') || role.includes('cazuela') || hwName.includes('minifix')) {
    return 'minifix';
  }
  if (role.includes('dowel') || role.includes('taquete') || role.includes('tarugo') || hwName.includes('taquete') || hwName.includes('tarugo')) {
    return 'dowel';
  }
  if (role.includes('shelf') || role.includes('estante') || role.includes('soporte') || hwName.includes('soporte') || hwName.includes('entrepaño')) {
    return 'shelf';
  }
  if (role.includes('screw') || role.includes('tornillo') || op?.kind === 'screw_pilot' || hwName.includes('tornillo')) {
    return 'screw';
  }

  if (label.includes('bisagra') || label.includes('taza')) return 'hinge';
  if (label.includes('minifix') || label.includes('cazuela') || label.includes('perno')) return 'minifix';
  if (label.includes('taquete') || label.includes('tarugo') || label.includes('dowel')) return 'dowel';
  if (label.includes('estante') || label.includes('shelf')) return 'shelf';
  if (label.includes('tornillo') || label.includes('piloto') || label.includes('screw')) return 'screw';

  if (op) {
    if (op.diameterMm >= 30) return 'hinge';
    if (op.diameterMm === 15) return 'minifix';
    if (op.diameterMm === 8) return 'dowel';
  }

  return 'screw';
}

function resolvePartForPlacement(
  parts: readonly HardwareMachiningPart[],
  placement: HardwarePlacement,
  pieceContext: string,
  overrideRole?: string,
): HardwareMachiningPart | undefined {
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];

  const targetRole = (overrideRole || placement.partRole || '').trim().toLowerCase();
  if (targetRole) {
    const match = parts.find(
      (p) =>
        p.role.toLowerCase() === targetRole ||
        p.id.toLowerCase() === targetRole,
    );
    if (match) return match;
  }

  for (const part of parts) {
    const r = part.role.toLowerCase();
    if (pieceContext.includes(r)) return part;
  }

  return parts[0];
}

/**
 * Deduplicate identical coincident holes on the same face.
 * Coincident = center distance < 0.1mm, same diameter (<0.1mm) and same depth (<0.1mm).
 */
export function deduplicateHoles(holes: readonly HoleDefinition[]): HoleDefinition[] {
  const result: HoleDefinition[] = [];

  for (const hole of holes) {
    const existingIndex = result.findIndex(
      (h) =>
        h.face === hole.face &&
        Math.hypot(h.xMm - hole.xMm, h.yMm - hole.yMm) < 0.1 &&
        Math.abs(h.diameterMm - hole.diameterMm) < 0.1 &&
        Math.abs(h.depthMm - hole.depthMm) < 0.1,
    );

    if (existingIndex < 0) {
      result.push(hole);
    }
  }

  return result;
}

/**
 * Validates a list of hole definitions against piece dimensions and checks
 * for depth violations, out-of-bounds positioning, and collisions.
 */
export function validateDrillingHoles(
  piece: {
    readonly id?: string;
    readonly code?: string;
    readonly description?: string;
    readonly lengthMm: number;
    readonly widthMm: number;
    readonly thicknessMm: number;
  },
  holes: readonly HoleDefinition[],
): DrillingIssue[] {
  const issues: DrillingIssue[] = [];
  const pieceName = piece.description || piece.code || piece.id || 'Pieza';

  // 1. Individual hole checks: depth & face bounds
  for (const hole of holes) {
    const faceDims = getFaceDimensions(hole.face, piece);

    // Depth check
    if (hole.depthMm > faceDims.maxDepthMm + 1e-6) {
      issues.push({
        code: 'DEPTH_EXCEEDS_MATERIAL',
        message: `La perforación "${hole.description || hole.type}" en cara "${hole.face}" tiene una profundidad de ${hole.depthMm} mm, que supera el límite de ${faceDims.maxDepthMm} mm de la pieza "${pieceName}".`,
        hole,
        context: {
          pieceId: piece.id,
          pieceCode: piece.code,
          face: hole.face,
          depthMm: hole.depthMm,
          maxDepthMm: faceDims.maxDepthMm,
          diameterMm: hole.diameterMm,
        },
      });
    }

    // Bounds check
    const radius = hole.diameterMm / 2;
    const isCenterOut =
      hole.xMm < 0 ||
      hole.xMm > faceDims.widthMm ||
      hole.yMm < 0 ||
      hole.yMm > faceDims.heightMm;
    const isPerimeterOut =
      hole.xMm - radius < -1e-6 ||
      hole.xMm + radius > faceDims.widthMm + 1e-6 ||
      hole.yMm - radius < -1e-6 ||
      hole.yMm + radius > faceDims.heightMm + 1e-6;

    if (isCenterOut || isPerimeterOut) {
      issues.push({
        code: 'HOLE_OUT_OF_BOUNDS',
        message: `La perforación "${hole.description || hole.type}" (Ø${hole.diameterMm} mm en x=${hole.xMm}, y=${hole.yMm}) queda fuera de los límites de la cara "${hole.face}" (${faceDims.widthMm} × ${faceDims.heightMm} mm) en la pieza "${pieceName}".`,
        hole,
        context: {
          pieceId: piece.id,
          pieceCode: piece.code,
          face: hole.face,
          xMm: hole.xMm,
          yMm: hole.yMm,
          diameterMm: hole.diameterMm,
          faceWidthMm: faceDims.widthMm,
          faceHeightMm: faceDims.heightMm,
        },
      });
    }
  }

  // 2. Collision checks between pairs of holes
  for (let i = 0; i < holes.length; i++) {
    const h1 = holes[i]!;
    for (let j = i + 1; j < holes.length; j++) {
      const h2 = holes[j]!;

      // Case A: Same face collision
      if (h1.face === h2.face) {
        const dist = Math.hypot(h1.xMm - h2.xMm, h1.yMm - h2.yMm);
        const minDist = (h1.diameterMm + h2.diameterMm) / 2;
        if (dist < minDist - 0.1) {
          issues.push({
            code: 'HOLE_COLLISION',
            message: `Colisión de perforaciones en la cara "${h1.face}" de la pieza "${pieceName}": "${h1.description || h1.type}" (Ø${h1.diameterMm}) y "${h2.description || h2.type}" (Ø${h2.diameterMm}) se solapan (distancia ${Math.round(dist * 10) / 10} mm < ${minDist} mm).`,
            hole: h1,
            conflictingHole: h2,
            context: {
              pieceId: piece.id,
              face: h1.face,
              hole1: h1,
              hole2: h2,
              distanceMm: Math.round(dist * 100) / 100,
              minDistanceMm: minDist,
            },
          });
        }
      }

      // Case B: Opposite face internal penetration collision
      if (OPPOSITE_FACE[h1.face] === h2.face) {
        // Face coords are identical in plane (mirroring handled at CAM export)
        const dist = Math.hypot(h1.xMm - h2.xMm, h1.yMm - h2.yMm);
        const minDist = (h1.diameterMm + h2.diameterMm) / 2;
        const totalDepth = h1.depthMm + h2.depthMm;
        const thickness = piece.thicknessMm;

        if (dist < minDist - 0.1 && totalDepth > thickness + 1e-6) {
          issues.push({
            code: 'HOLE_COLLISION',
            message: `Colisión interna de perforaciones en caras opuestas (${h1.face}/${h2.face}) de la pieza "${pieceName}": "${h1.description || h1.type}" (prof. ${h1.depthMm} mm) y "${h2.description || h2.type}" (prof. ${h2.depthMm} mm) suman ${totalDepth} mm, superando el espesor de ${thickness} mm.`,
            hole: h1,
            conflictingHole: h2,
            context: {
              pieceId: piece.id,
              face1: h1.face,
              face2: h2.face,
              hole1: h1,
              hole2: h2,
              totalDepthMm: totalDepth,
              thicknessMm: thickness,
            },
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Asserts that resolved drilling data has no geometry or depth issues.
 * Throws a ValidationError with structured context on the first issue.
 */
export function assertDrillingValid(drilling: ResolvedPartDrilling): void {
  if (drilling.issues.length > 0) {
    const first = drilling.issues[0]!;
    throw new ValidationError(first.message, first.context);
  }
}

function extractPieceMetadata(piece: ResolvedBoardPart | ProductionCutRow | PieceDescriptor): {
  id?: string;
  pieceCode: string;
  moduleCode: string;
  partName: string;
  materialName: string;
  pieceContext: string;
} {
  const r = piece as unknown as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : undefined;
  const partCode = typeof r.partCode === 'string' ? r.partCode : undefined;
  const code = typeof r.code === 'string' ? r.code : undefined;
  const pieceCode = partCode || code || id || 'PIEZA';
  const moduleCode = typeof r.moduleCode === 'string' ? r.moduleCode : '';
  const description = typeof r.description === 'string' ? r.description : undefined;
  const partNameCandidate = typeof r.partName === 'string' ? r.partName : undefined;
  const partName = description || partNameCandidate || 'Pieza';
  const materialName = typeof r.materialName === 'string' ? r.materialName : 'Sin material';
  const optionRole = typeof r.optionRole === 'string' ? r.optionRole : '';

  const pieceContext = `${optionRole} ${partName} ${pieceCode}`.toLowerCase();

  return { id, pieceCode, moduleCode, partName, materialName, pieceContext };
}

/**
 * Pure domain drilling resolver. Resolves per-piece CNC holes from
 * HardwarePlacements and catalog machining profiles with deduplication
 * and structured geometric validations.
 */
export function resolvePartDrilling(
  paramsOrPiece: ResolvePartDrillingParams | (ResolvedBoardPart | ProductionCutRow | PieceDescriptor),
  maybePlacements?: readonly HardwarePlacement[],
  maybeCatalog?: HardwareCatalogLookup,
): ResolvedPartDrilling {
  let params: ResolvePartDrillingParams;
  if ('piece' in paramsOrPiece && !('lengthMm' in paramsOrPiece && 'widthMm' in paramsOrPiece)) {
    params = paramsOrPiece as ResolvePartDrillingParams;
  } else {
    params = {
      piece: paramsOrPiece as PieceDescriptor,
      placements: maybePlacements,
      hardwareCatalog: maybeCatalog,
    };
  }

  const { piece, placements = [], hardwareCatalog, partRole, strict = false } = params;

  const lengthMm = piece.lengthMm;
  const widthMm = piece.widthMm;
  const thicknessMm = piece.thicknessMm ?? 15;
  const { id, pieceCode, moduleCode, partName, materialName, pieceContext } = extractPieceMetadata(piece);

  const resolvedHoles: HoleDefinition[] = [];
  let foundAnyMachiningProfile = false;

  const boardEnv = {
    W: widthMm,
    L: lengthMm,
    H: lengthMm,
    D: lengthMm,
    T: thicknessMm,
    PW: widthMm,
    PL: lengthMm,
    PH: lengthMm,
    PD: lengthMm,
    PT: thicknessMm,
    HW: 96,
  };

  for (const placement of placements) {
    const hardware = findHardwareInCatalog(placement.hardwareId, hardwareCatalog);
    const profile = hardware?.machining;
    if (!profile || profile.parts.length === 0) continue;

    foundAnyMachiningProfile = true;
    const part = resolvePartForPlacement(profile.parts, placement, pieceContext, partRole);
    if (!part || part.operations.length === 0) continue;

    // Evaluate placement anchor position on anchorFace
    let anchorX = placement.relativePosition.xMm;
    if (placement.relativePosition.xFormula?.trim()) {
      try {
        anchorX = evaluatePartFormula(placement.relativePosition.xFormula, boardEnv);
      } catch {
        anchorX = placement.relativePosition.xMm;
      }
    }

    let anchorY = placement.relativePosition.yMm;
    if (placement.relativePosition.yFormula?.trim()) {
      try {
        anchorY = evaluatePartFormula(placement.relativePosition.yFormula, boardEnv);
      } catch {
        anchorY = placement.relativePosition.yMm;
      }
    }

    const rotDegZ = Number.isFinite(placement.rotationDeg?.z) ? placement.rotationDeg!.z! : 0;
    const thetaRad = (rotDegZ * Math.PI) / 180;
    const cosTheta = Math.cos(thetaRad);
    const sinTheta = Math.sin(thetaRad);

    for (const op of part.operations) {
      // Rotate offset (op.xMm, op.yMm) by thetaRad
      const dx = op.xMm * cosTheta - op.yMm * sinTheta;
      const dy = op.xMm * sinTheta + op.yMm * cosTheta;

      const holeX = Math.round((anchorX + dx) * 100) / 100;
      const holeY = Math.round((anchorY + dy) * 100) / 100;

      const targetFace: HoleFace =
        op.face === 'opposite' ? OPPOSITE_FACE[placement.anchorFace] : placement.anchorFace;

      const faceDims = getFaceDimensions(targetFace, { lengthMm, widthMm, thicknessMm });

      let depthMm = op.depthMm ?? 0;
      if (op.kind === 'through_hole') {
        depthMm = faceDims.maxDepthMm;
      }

      const holeType = inferHoleType(part, op, hardware);
      const description = op.label || (hardware ? `${hardware.name} (${op.id})` : op.id);

      resolvedHoles.push({
        face: targetFace,
        xMm: holeX,
        yMm: holeY,
        diameterMm: op.diameterMm,
        depthMm,
        type: holeType,
        description,
      });
    }
  }

  let finalHoles: HoleDefinition[];
  let fallbackUsed = false;

  if (foundAnyMachiningProfile && resolvedHoles.length > 0) {
    finalHoles = deduplicateHoles(resolvedHoles);
  } else {
    // F074 Heuristic Fallback
    finalHoles = inferHolesForPiece({
      id: id || 'p-1',
      partCode: pieceCode,
      moduleCode,
      partName,
      description: partName,
      lengthMm,
      widthMm,
      thicknessMm,
      materialName,
      grain: 0,
      edges: [],
      quantity: 1,
    } as unknown as ProductionCutRow) as HoleDefinition[];
    fallbackUsed = true;
  }

  const issues = validateDrillingHoles(
    {
      id,
      code: pieceCode,
      description: partName,
      lengthMm,
      widthMm,
      thicknessMm,
    },
    finalHoles,
  );

  const result: ResolvedPartDrilling = {
    pieceCode,
    moduleCode,
    partName,
    lengthMm,
    widthMm,
    materialName,
    holes: finalHoles,
    issues,
    fallbackUsed,
  };

  if (strict) {
    assertDrillingValid(result);
  }

  return result;
}
