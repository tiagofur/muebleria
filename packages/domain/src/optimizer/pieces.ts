/**
 * Shared piece unrolling and placement plumbing for cut plan optimizers
 * (guillotine saw + CNC nesting).
 */

import type { ProductionCutRow } from '../types';
import type { CutProgramInput } from './cutProgram';
import type {
  CutInstruction,
  CutPlanConfig,
  CutPlanPlacedPiece,
  CutPlanRemnant,
  CutStrategy,
} from './types';

export interface PieceToPlace {
  originalRow: ProductionCutRow;
  indexInUnrolled: number;
  length: number;
  width: number;
  grain: 0 | 1;
  id: string;
  /**
   * #781 — per-placement workshop label. Same as the row's clean labelRef for
   * single-copy rows; copies 2..N of a row with quantity > 1 get the `-C<n>`
   * suffix so every physical piece keeps a unique manufacturing code (one
   * PARTS_REQ row per piece; CNC files key per piece). Copy 1 stays bare to
   * match what the app displays for the row. Optional: unrollRows always sets
   * it; hand-built candidates fall back to the row's labelRef/id.
   */
  labelRef?: string;
}

export interface PlacementResult {
  pieces: CutPlanPlacedPiece[];
  remnants: CutPlanRemnant[];
  instructions: CutInstruction[];
  sheetIndex: number;
  sheetWidthMm: number;
  sheetLengthMm: number;
  materialCode: string;
  materialName: string;
  thicknessMm?: number;
  strategy?: CutStrategy;
  /**
   * Guillotine cut program registered while packing (saw strategies only,
   * #650 PR 2). Serializable CutProgramInput, validated with
   * executeCutProgram before a candidate is accepted. Absent for cnc-nesting
   * results and legacy placements; absence never means a verified program
   * exists.
   */
  cutProgram?: CutProgramInput;
}

/**
 * Shared useful-remnant (retazo útil) rule for both engines: big enough on
 * both axes (either orientation) and at least 0.24 m² of usable area.
 */
export function isUsefulRemnant(lengthMm: number, widthMm: number, config: CutPlanConfig): boolean {
  return (
    ((lengthMm >= config.minRemnantLengthMm && widthMm >= config.minRemnantWidthMm) ||
      (lengthMm >= config.minRemnantWidthMm && widthMm >= config.minRemnantLengthMm)) &&
    (lengthMm * widthMm) / 1_000_000 >= 0.24
  );
}

export function unrollRows(
  rows: readonly ProductionCutRow[],
  deductEdgeBand = true,
): PieceToPlace[] {
  const result: PieceToPlace[] = [];
  let seq = 0;
  for (const row of rows) {
    const qty = Math.max(1, row.quantity);
    const edgeThick = Math.max(0, row.edgeBandThicknessMm ?? 0);

    // Si deductEdgeBand es true (pegado manual / sin pre-fresado), descontar el espesor
    // de cintilla en cada lado que tenga tapacanto (L1, L2, W1, W2).
    // Si es false (máquina con pre-fresado / tupi), la medida de corte es exactamente la final.
    const l1Deduct = deductEdgeBand && row.L1 ? edgeThick : 0;
    const l2Deduct = deductEdgeBand && row.L2 ? edgeThick : 0;
    const w1Deduct = deductEdgeBand && row.W1 ? edgeThick : 0;
    const w2Deduct = deductEdgeBand && row.W2 ? edgeThick : 0;

    const rawLength = Math.max(1, row.lengthMm - l1Deduct - l2Deduct);
    const rawWidth = Math.max(1, row.widthMm - w1Deduct - w2Deduct);

    for (let i = 0; i < qty; i++) {
      seq++;
      const rowLabel = row.labelRef?.trim() || '';
      result.push({
        originalRow: row,
        indexInUnrolled: seq,
        length: rawLength,
        width: rawWidth,
        grain: row.grain,
        id: `${row.partCode || 'P'}-${seq}`,
        labelRef:
          rowLabel !== '' && qty > 1 && i > 0 ? `${rowLabel}-C${i + 1}` : rowLabel,
      });
    }
  }
  return result;
}
