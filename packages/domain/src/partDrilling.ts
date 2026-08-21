/**
 * Structured part drilling and machining data model (F074).
 *
 * Defines hole faces, diameters, depths, 2D coordinates, and hole types for CAM/CNC integration.
 */

import type { ProductionCutRow, Project } from './types';

export type HoleFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';

/**
 * Emergency thickness for degenerate descriptors that reach the drilling
 * pipeline WITHOUT a resolved material thickness (the normal BOM flow always
 * carries the real material T — this default never applies in production).
 * Single source for both the heuristic and the resolver (F128 review debt).
 */
export const DEFAULT_BOARD_THICKNESS_MM = 18;
export type HoleType = 'dowel' | 'minifix' | 'hinge' | 'shelf' | 'screw';

export interface HoleDefinition {
  readonly face: HoleFace;
  readonly xMm: number;
  readonly yMm: number;
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly type: HoleType;
  readonly description?: string;
}

export interface PartDrillingPattern {
  readonly pieceCode: string;
  readonly moduleCode: string;
  readonly partName: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly materialName: string;
  readonly holes: readonly HoleDefinition[];
}

export interface ProjectDrillingData {
  readonly schema: 'muebles.drilling-data.v1';
  readonly projectId: string;
  readonly projectName: string;
  readonly generatedAt: string;
  readonly totalPiecesCount: number;
  readonly totalHolesCount: number;
  readonly patterns: readonly PartDrillingPattern[];
}

function pieceCode(row: ProductionCutRow, index: number): string {
  if (row.partCode?.trim()) {
    return row.moduleCode
      ? `${row.moduleCode}-${row.partCode}`
      : row.partCode.trim();
  }
  if (row.labelRef?.trim()) return row.labelRef.trim();
  return `P${index + 1}`;
}

/**
 * F074 name-based heuristic drilling. Coordinates follow the canonical
 * face-plane convention (see partDrillingResolver / hardwarePlacement):
 * front/back → x along width, y along length; left/right → x along thickness,
 * y along length; top/bottom → x along width, y along thickness.
 */
export function inferHolesForPiece(row: ProductionCutRow): readonly HoleDefinition[] {
  const name = (row.partName || row.description || '').toLowerCase();
  const holes: HoleDefinition[] = [];
  const L = row.lengthMm;
  const W = row.widthMm;
  const T = row.thicknessMm ?? DEFAULT_BOARD_THICKNESS_MM;

  if (name.includes('puerta') || name.includes('door')) {
    // Hinge cup holes 35mm on the inner face, C-distance from the hinge edge.
    const marginY = Math.min(96, Math.floor(L / 4));
    holes.push(
      {
        face: 'back',
        xMm: 22.5,
        yMm: marginY,
        diameterMm: 35,
        depthMm: 12.5,
        type: 'hinge',
        description: 'Cazuela de bisagra superior 35mm',
      },
      {
        face: 'back',
        xMm: 22.5,
        yMm: Math.max(marginY, L - marginY),
        diameterMm: 35,
        depthMm: 12.5,
        type: 'hinge',
        description: 'Cazuela de bisagra inferior 35mm',
      },
    );
  } else if (name.includes('estante') || name.includes('shelf')) {
    // Shelf pin holes 5mm, centered on both board edges.
    const pinY = Math.floor(L / 2);
    const pinX = Math.floor(T / 2);
    holes.push(
      {
        face: 'left',
        xMm: pinX,
        yMm: pinY,
        diameterMm: 5,
        depthMm: 10,
        type: 'shelf',
        description: 'Soporte estante lateral izquierdo 5mm',
      },
      {
        face: 'right',
        xMm: pinX,
        yMm: pinY,
        diameterMm: 5,
        depthMm: 10,
        type: 'shelf',
        description: 'Soporte estante lateral derecho 5mm',
      },
    );
  } else if (name.includes('lateral') || name.includes('side')) {
    // Minifix (15mm) & dowels (8mm) drilled from the board edge, centered on
    // the thickness axis.
    const marginX = Math.min(32, Math.floor(W / 4));
    const edgeY = Math.floor(T / 2);
    holes.push(
      {
        face: 'top',
        xMm: marginX,
        yMm: edgeY,
        diameterMm: 15,
        depthMm: 12,
        type: 'minifix',
        description: 'Caja minifix 15mm frontal',
      },
      {
        face: 'top',
        xMm: marginX + 32,
        yMm: edgeY,
        diameterMm: 8,
        depthMm: 15,
        type: 'dowel',
        description: 'Perforación tarugo 8mm frontal',
      },
      {
        face: 'top',
        xMm: W - marginX,
        yMm: edgeY,
        diameterMm: 15,
        depthMm: 12,
        type: 'minifix',
        description: 'Caja minifix 15mm posterior',
      },
      {
        face: 'top',
        xMm: W - marginX - 32,
        yMm: edgeY,
        diameterMm: 8,
        depthMm: 15,
        type: 'dowel',
        description: 'Perforación tarugo 8mm posterior',
      },
    );
  } else if (name.includes('fondo') || name.includes('back')) {
    // Screw pilot holes 3mm inset from each corner of the inner face.
    const insetX = Math.min(16, Math.floor(W / 4));
    const insetY = Math.min(16, Math.floor(L / 4));
    const corners: ReadonlyArray<readonly [number, number]> = [
      [insetX, insetY],
      [W - insetX, insetY],
      [W - insetX, L - insetY],
      [insetX, L - insetY],
    ];
    corners.forEach(([cx, cy], i) => {
      holes.push({
        face: 'front',
        xMm: cx,
        yMm: cy,
        diameterMm: 3,
        depthMm: 10,
        type: 'screw',
        description: `Pase de tornillo fondo esquina ${i + 1}`,
      });
    });
  }

  return holes;
}

/**
 * Generate structured drilling dataset for a project.
 */
export function generatePartDrillingData(input: {
  readonly project: Project;
  readonly cutRows: readonly ProductionCutRow[];
  readonly generatedAt?: string;
}): ProjectDrillingData {
  const patterns: PartDrillingPattern[] = [];
  let totalHolesCount = 0;

  input.cutRows.forEach((row, index) => {
    const holes = inferHolesForPiece(row);
    totalHolesCount += holes.length;

    patterns.push({
      pieceCode: pieceCode(row, index),
      moduleCode: row.moduleCode ?? '',
      partName: row.partName || row.description || `Pieza ${index + 1}`,
      lengthMm: row.lengthMm,
      widthMm: row.widthMm,
      materialName: row.materialName ?? 'Sin material',
      holes,
    });
  });

  return {
    schema: 'muebles.drilling-data.v1',
    projectId: input.project.id,
    projectName: input.project.name,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totalPiecesCount: patterns.length,
    totalHolesCount,
    patterns,
  };
}
