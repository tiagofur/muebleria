/**
 * Structured part drilling and machining data model (F074).
 *
 * Defines hole faces, diameters, depths, 2D coordinates, and hole types for CAM/CNC integration.
 */

import type { ProductionCutRow, Project } from './types';

export type HoleFace = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
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

function inferHolesForPiece(row: ProductionCutRow): readonly HoleDefinition[] {
  const name = (row.partName || row.description || '').toLowerCase();
  const holes: HoleDefinition[] = [];
  const L = row.lengthMm;
  const W = row.widthMm;

  if (name.includes('puerta') || name.includes('door')) {
    // Hinge cup holes 35mm
    const marginY = Math.min(96, Math.floor(W / 4));
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
        yMm: Math.max(marginY, W - marginY),
        diameterMm: 35,
        depthMm: 12.5,
        type: 'hinge',
        description: 'Cazuela de bisagra inferior 35mm',
      },
    );
  } else if (name.includes('estante') || name.includes('shelf')) {
    // Shelf pin holes 5mm on 32mm grid
    const marginX = Math.min(37, Math.floor(L / 4));
    holes.push(
      {
        face: 'left',
        xMm: marginX,
        yMm: Math.floor(W / 2),
        diameterMm: 5,
        depthMm: 10,
        type: 'shelf',
        description: 'Soporte estante lateral izquierdo 5mm',
      },
      {
        face: 'right',
        xMm: L - marginX,
        yMm: Math.floor(W / 2),
        diameterMm: 5,
        depthMm: 10,
        type: 'shelf',
        description: 'Soporte estante lateral derecho 5mm',
      },
    );
  } else if (name.includes('lateral') || name.includes('side')) {
    // Minifix (15mm) & Dowels (8mm)
    const marginX = Math.min(32, Math.floor(L / 4));
    const marginY = Math.min(32, Math.floor(W / 4));
    holes.push(
      {
        face: 'top',
        xMm: marginX,
        yMm: marginY,
        diameterMm: 15,
        depthMm: 12,
        type: 'minifix',
        description: 'Caja minifix 15mm frontal',
      },
      {
        face: 'top',
        xMm: marginX + 32,
        yMm: marginY,
        diameterMm: 8,
        depthMm: 28,
        type: 'dowel',
        description: 'Perforación tarugo 8mm frontal',
      },
      {
        face: 'top',
        xMm: L - marginX,
        yMm: marginY,
        diameterMm: 15,
        depthMm: 12,
        type: 'minifix',
        description: 'Caja minifix 15mm posterior',
      },
      {
        face: 'top',
        xMm: L - marginX - 32,
        yMm: marginY,
        diameterMm: 8,
        depthMm: 28,
        type: 'dowel',
        description: 'Perforación tarugo 8mm posterior',
      },
    );
  } else if (name.includes('fondo') || name.includes('back')) {
    // Screw pilot holes 3mm along perimeter
    holes.push(
      {
        face: 'front',
        xMm: 16,
        yMm: 16,
        diameterMm: 3,
        depthMm: 10,
        type: 'screw',
        description: 'Pase de tornillo fondo esquina 1',
      },
      {
        face: 'front',
        xMm: L - 16,
        yMm: 16,
        diameterMm: 3,
        depthMm: 10,
        type: 'screw',
        description: 'Pase de tornillo fondo esquina 2',
      },
      {
        face: 'front',
        xMm: L - 16,
        yMm: W - 16,
        diameterMm: 3,
        depthMm: 10,
        type: 'screw',
        description: 'Pase de tornillo fondo esquina 3',
      },
      {
        face: 'front',
        xMm: 16,
        yMm: W - 16,
        diameterMm: 3,
        depthMm: 10,
        type: 'screw',
        description: 'Pase de tornillo fondo esquina 4',
      },
    );
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
