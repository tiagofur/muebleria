/**
 * CNC pilot metadata (PROD-3.3 / #111) — documentation + JSON export model.
 *
 * Does NOT replace Optimizer.xlsx. Optional rectangle outline per cut piece
 * for future DXF/post-processors. No brand-specific G-code.
 */

import type { ProductionCutRow } from './types';

export type CncPilotOutline = {
  readonly kind: 'rect';
  readonly lengthMm: number;
  readonly widthMm: number;
};

export type CncPilotPiece = {
  readonly pieceCode: string;
  readonly moduleCode: string;
  readonly materialName: string;
  readonly quantity: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly grain: 0 | 1;
  readonly edges: {
    readonly L1: 0 | 1;
    readonly L2: 0 | 1;
    readonly W1: 0 | 1;
    readonly W2: 0 | 1;
  };
  readonly outline: CncPilotOutline;
  readonly description: string;
};

export type CncPilotDocument = {
  /** Schema id for integrators. */
  readonly schema: 'muebles.cnc-pilot.v1';
  readonly projectId: string;
  readonly projectName: string;
  readonly generatedAt: string;
  readonly productionRevision: number | null;
  readonly note: string;
  readonly pieces: readonly CncPilotPiece[];
};

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
 * Build CNC pilot piece list from the same cut rows as Optimizer (board only).
 */
export function buildCncPilotDocument(input: {
  readonly projectId: string;
  readonly projectName: string;
  readonly cutRows: readonly ProductionCutRow[];
  readonly generatedAt: string;
  readonly productionRevision?: number | null;
}): CncPilotDocument {
  const pieces: CncPilotPiece[] = input.cutRows.map((row, index) => ({
    pieceCode: pieceCode(row, index),
    moduleCode: row.moduleCode ?? '',
    materialName: row.materialName ?? '',
    quantity: row.quantity,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    grain: row.grain === 1 ? 1 : 0,
    edges: {
      L1: row.L1,
      L2: row.L2,
      W1: row.W1,
      W2: row.W2,
    },
    outline: {
      kind: 'rect',
      lengthMm: row.lengthMm,
      widthMm: row.widthMm,
    },
    description: row.description ?? '',
  }));

  return {
    schema: 'muebles.cnc-pilot.v1',
    projectId: input.projectId,
    projectName: input.projectName,
    generatedAt: input.generatedAt,
    productionRevision: input.productionRevision ?? null,
    note:
      'Pilot JSON for CNC integrators. Rectangular outline only. Official cut plan remains Plantilla_Optimizer.xlsx. DXF/post-processors are future work under demand.',
    pieces,
  };
}

/** UTF-8 JSON string (pretty-printed). */
export function cncPilotDocumentToJson(doc: CncPilotDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
