/**
 * PTX (Pattern Exchange v1.14) Export for Automatic Beam Saws / Seccionadoras.
 *
 * Universal CNC panel saw exchange format supported by:
 * - SCM Group (Gabbiani, Sigma, Alpha via Maestro Converter Cut / WinCut / Maestro Active Cut)
 * - HOMAG / Holzma (SAWTEQ, HPP via CADmatic / CADlink / HolzLink / Cut Rite)
 * - Biesse (Selco via OSI / OptiPlanning / Biesse Link)
 * - Schelling (via HPO)
 * - Giben, Mayer, Holz-Her
 *
 * Exports pre-optimized 2D guillotine cutting patterns ([PATTERNS] and [CUTS])
 * with full piece identification, grain constraints, edge banding, and barcode metadata.
 */

import type {
  CutPlan,
  CutPlanPlacedPiece,
  CutPlanRemnant,
  CutPlanSheet,
} from '@muebles/domain';
import { ValidationError } from '@muebles/domain';

export interface PtxCutPlanExportInput {
  readonly cutPlan: CutPlan;
  readonly projectName?: string;
  readonly customerName?: string;
  readonly projectCode?: string;
  /** Optional override for saw kerf in mm (defaults to cutPlan.config.sawKerfMm) */
  readonly sawKerfMm?: number;
}

const ASCII_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
  '×': 'x', '·': '-', '°': 'deg', '±': '+-', '≤': '<=', '≥': '>=',
};

/**
 * Sanitizes text to safe ASCII for CNC controllers, stripping quotes and control chars.
 */
function ptxText(value: string | undefined | null): string {
  if (!value) return '';
  let out = '';
  for (const ch of value) {
    const mapped = ASCII_MAP[ch] ?? ch;
    // Keep printable ASCII 32..126 except double-quotes and semicolons which delimit fields
    if (mapped === '"' || mapped === ';') {
      out += ' ';
    } else {
      const code = mapped.charCodeAt(0);
      out += code >= 32 && code <= 126 ? mapped : '';
    }
  }
  return out.trim().slice(0, 120);
}

function fmtNum(val: number): string {
  return Number.isFinite(val) ? val.toFixed(1) : '0.0';
}

function pttxSafe(val: string): string {
  return ptxText(val).replace(/"/g, '');
}

/**
 * Generates the complete PTX file content as a string.
 */
export function generatePtxString(input: PtxCutPlanExportInput): string {
  const { cutPlan } = input;

  if (!cutPlan.sheets || cutPlan.sheets.length === 0) {
    throw new ValidationError('El plan de corte no tiene tableros para exportar a PTX', {
      projectId: cutPlan.projectId,
    });
  }

  const totalPieces = cutPlan.sheets.reduce((sum, s) => sum + s.pieces.length, 0);
  if (totalPieces === 0) {
    throw new ValidationError('El plan de corte no tiene piezas para exportar a PTX', {
      projectId: cutPlan.projectId,
    });
  }

  const projectName = ptxText(input.projectName || cutPlan.projectName || cutPlan.projectId);
  const projectCode = ptxText(input.projectCode || cutPlan.projectId);
  const customerName = ptxText(input.customerName || 'Cliente');
  const dateStr = (cutPlan.generatedAt ? new Date(cutPlan.generatedAt) : new Date())
    .toISOString()
    .slice(0, 10);

  const kerf = input.sawKerfMm ?? cutPlan.config.sawKerfMm;
  const trim = cutPlan.config.trim;

  const lines: string[] = [];

  // ==========================================
  // 1. [HEADER] Block
  // ==========================================
  lines.push('[HEADER]');
  lines.push('VERSION=1.14');
  lines.push('SYSTEM=MUEBLES_APP');
  lines.push(`JOB_NAME=${projectName || projectCode}`);
  lines.push(`PROJECT_CODE=${projectCode}`);
  lines.push(`CUSTOMER=${customerName}`);
  lines.push(`DATE=${dateStr}`);
  lines.push('UNIT=MM');
  lines.push('METRIC=1');
  lines.push(`KERF=${fmtNum(kerf)}`);
  lines.push(`TRIM_TOP=${fmtNum(trim.topMm)}`);
  lines.push(`TRIM_BOTTOM=${fmtNum(trim.bottomMm)}`);
  lines.push(`TRIM_LEFT=${fmtNum(trim.leftMm)}`);
  lines.push(`TRIM_RIGHT=${fmtNum(trim.rightMm)}`);
  lines.push(`DEDUCT_EDGEBAND=${cutPlan.config.deductEdgeBand ? '1' : '0'}`);
  lines.push(`TOTAL_SHEETS=${cutPlan.sheets.length}`);
  lines.push(`TOTAL_PIECES=${totalPieces}`);
  lines.push('');

  // ==========================================
  // 2. [MATERIALS] Block
  // ==========================================
  lines.push('[MATERIALS]');
  lines.push('; MAT_ID, DESCRIPTION, LENGTH, WIDTH, THICKNESS, TRIM_TOP, TRIM_BOTTOM, TRIM_LEFT, TRIM_RIGHT, KERF, BOOK_HEIGHT');

  // Collect unique materials
  const materialMap = new Map<string, {
    code: string;
    name: string;
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
  }>();

  for (const sheet of cutPlan.sheets) {
    const matKey = sheet.materialCode || sheet.materialName;
    if (!materialMap.has(matKey)) {
      materialMap.set(matKey, {
        code: sheet.materialCode || matKey,
        name: sheet.materialName || matKey,
        lengthMm: sheet.sheetLengthMm,
        widthMm: sheet.sheetWidthMm,
        thicknessMm: sheet.thicknessMm ?? 18,
      });
    }
  }

  for (const mat of materialMap.values()) {
    lines.push(
      [
        `"${pttxSafe(mat.code)}"`,
        `"${pttxSafe(mat.name)}"`,
        fmtNum(mat.lengthMm),
        fmtNum(mat.widthMm),
        fmtNum(mat.thicknessMm),
        fmtNum(trim.topMm),
        fmtNum(trim.bottomMm),
        fmtNum(trim.leftMm),
        fmtNum(trim.rightMm),
        fmtNum(kerf),
        '1', // Single sheet or stack
      ].join(', '),
    );
  }
  lines.push('');

  // ==========================================
  // 3. [PARTS] Block
  // ==========================================
  lines.push('[PARTS]');
  lines.push(
    '; PART_ID, PART_CODE, PART_NAME, MATERIAL_ID, FINISHED_L, FINISHED_W, CUT_L, CUT_W, QTY, GRAIN, ROTATED, EDGE_L1, EDGE_L2, EDGE_W1, EDGE_W2, BARCODE, CNC_PROG, MODULE_CODE, MODULE_NAME, PROJECT_CODE',
  );

  let partSeq = 1;
  for (const sheet of cutPlan.sheets) {
    for (const piece of sheet.pieces) {
      const edgeL1 = piece.L1 ? fmtNum(piece.edgeBandThicknessMm ?? 0.45) : '0.0';
      const edgeL2 = piece.L2 ? fmtNum(piece.edgeBandThicknessMm ?? 0.45) : '0.0';
      const edgeW1 = piece.W1 ? fmtNum(piece.edgeBandThicknessMm ?? 0.45) : '0.0';
      const edgeW2 = piece.W2 ? fmtNum(piece.edgeBandThicknessMm ?? 0.45) : '0.0';

      const barcode = ptxText(piece.labelRef || piece.id || `BAR-${partSeq}`);
      const partCode = ptxText(piece.partCode || `P${partSeq}`);
      const partName = ptxText(piece.partName || 'Pieza');
      const moduleCode = ptxText(piece.moduleCode || '');
      const moduleName = ptxText(piece.labelRef || piece.moduleCode || '');
      const matCode = ptxText(piece.materialCode || sheet.materialCode);

      lines.push(
        [
          `"P_${partSeq}"`,
          `"${partCode}"`,
          `"${partName}"`,
          `"${matCode}"`,
          fmtNum(piece.originalLengthMm),
          fmtNum(piece.originalWidthMm),
          fmtNum(piece.lengthMm),
          fmtNum(piece.widthMm),
          '1', // Individual placed instance
          piece.grain.toString(),
          piece.rotated ? '1' : '0',
          `"${edgeL1}"`,
          `"${edgeL2}"`,
          `"${edgeW1}"`,
          `"${edgeW2}"`,
          `"${barcode}"`,
          '""', // CNC program placeholder
          `"${moduleCode}"`,
          `"${moduleName}"`,
          `"${projectCode}"`,
        ].join(', '),
      );
      partSeq++;
    }
  }
  lines.push('');

  // ==========================================
  // 4. [PATTERNS] Block
  // ==========================================
  lines.push('[PATTERNS]');
  lines.push('; PATTERN_ID, SHEET_INDEX, MATERIAL_ID, LENGTH, WIDTH, RUN_QTY, EFFICIENCY_PCT, PIECES_COUNT, WASTE_PCT');

  for (let sIdx = 0; sIdx < cutPlan.sheets.length; sIdx++) {
    const sheet = cutPlan.sheets[sIdx]!;
    const patId = `"PAT_${sIdx + 1}"`;
    const matCode = `"${pttxSafe(sheet.materialCode)}"`;
    lines.push(
      [
        patId,
        (sIdx + 1).toString(),
        matCode,
        fmtNum(sheet.sheetLengthMm),
        fmtNum(sheet.sheetWidthMm),
        '1', // 1 board run
        fmtNum(sheet.yieldPercent),
        sheet.pieces.length.toString(),
        fmtNum(sheet.wastePercent),
      ].join(', '),
    );
  }
  lines.push('');

  // ==========================================
  // 5. [CUTS] Block (Guillotine Tree Execution)
  // ==========================================
  lines.push('[CUTS]');
  lines.push('; PATTERN_ID, STEP, PHASE, TYPE, POSITION_MM, LENGTH_MM, PIECE_REF');

  for (let sIdx = 0; sIdx < cutPlan.sheets.length; sIdx++) {
    const sheet = cutPlan.sheets[sIdx]!;
    const patId = `"PAT_${sIdx + 1}"`;

    let stepNum = 1;

    // Phase 0: Perimetral trims if configured
    if (trim.bottomMm > 0) {
      lines.push(
        [
          patId,
          (stepNum++).toString(),
          '0',
          '"TRIM_BOTTOM"',
          fmtNum(trim.bottomMm),
          fmtNum(sheet.sheetLengthMm),
          '""',
        ].join(', '),
      );
    }
    if (trim.leftMm > 0) {
      lines.push(
        [
          patId,
          (stepNum++).toString(),
          '0',
          '"TRIM_LEFT"',
          fmtNum(trim.leftMm),
          fmtNum(sheet.sheetWidthMm),
          '""',
        ].join(', '),
      );
    }
    if (trim.topMm > 0) {
      lines.push(
        [
          patId,
          (stepNum++).toString(),
          '0',
          '"TRIM_TOP"',
          fmtNum(sheet.sheetWidthMm - trim.topMm),
          fmtNum(sheet.sheetLengthMm),
          '""',
        ].join(', '),
      );
    }
    if (trim.rightMm > 0) {
      lines.push(
        [
          patId,
          (stepNum++).toString(),
          '0',
          '"TRIM_RIGHT"',
          fmtNum(sheet.sheetLengthMm - trim.rightMm),
          fmtNum(sheet.sheetWidthMm),
          '""',
        ].join(', '),
      );
    }

    // Phase 1 (Rip strips along Y) and Phase 2 (Cross cuts along X)
    const ySet = [...new Set(sheet.pieces.map((p) => p.yMm))].sort((a, b) => a - b);
    for (let rIdx = 0; rIdx < ySet.length; rIdx++) {
      const y = ySet[rIdx]!;
      const stripPieces = sheet.pieces
        .filter((p) => p.yMm === y)
        .sort((a, b) => a.xMm - b.xMm);
      const maxW = Math.max(...stripPieces.map((p) => p.widthMm));

      // Rip cut separating this strip
      lines.push(
        [
          patId,
          (stepNum++).toString(),
          '1',
          `"RIP_STRIP_${rIdx + 1}"`,
          fmtNum(y + maxW),
          fmtNum(sheet.sheetLengthMm),
          `"STRIP_${rIdx + 1}"`,
        ].join(', '),
      );

      // Cross cuts on this strip
      for (const p of stripPieces) {
        lines.push(
          [
            patId,
            (stepNum++).toString(),
            '2',
            '"CROSS_CUT"',
            fmtNum(p.xMm + p.lengthMm),
            fmtNum(p.widthMm),
            `"${pttxSafe(p.partCode || p.id)}"`,
          ].join(', '),
        );
      }
    }

    // Add remnants if useful
    for (const rem of sheet.remnants) {
      if (rem.isUseful) {
        lines.push(
          [
            patId,
            (stepNum++).toString(),
            '2',
            '"REMNANT_USEFUL"',
            fmtNum(rem.xMm + rem.lengthMm),
            fmtNum(rem.widthMm),
            `"REM_${fmtNum(rem.lengthMm)}x${fmtNum(rem.widthMm)}"`,
          ].join(', '),
        );
      }
    }
  }
  lines.push('');

  // ==========================================
  // 6. [REMNANTS] Block
  // ==========================================
  lines.push('[REMNANTS]');
  lines.push('; REMNANT_ID, PATTERN_ID, X_MM, Y_MM, LENGTH, WIDTH, AREA_M2, IS_USEFUL');

  let remSeq = 1;
  for (let sIdx = 0; sIdx < cutPlan.sheets.length; sIdx++) {
    const sheet = cutPlan.sheets[sIdx]!;
    for (const rem of sheet.remnants) {
      lines.push(
        [
          `"REM_${remSeq++}"`,
          `"PAT_${sIdx + 1}"`,
          fmtNum(rem.xMm),
          fmtNum(rem.yMm),
          fmtNum(rem.lengthMm),
          fmtNum(rem.widthMm),
          fmtNum(rem.areaM2),
          rem.isUseful ? '1' : '0',
        ].join(', '),
      );
    }
  }
  lines.push('');

  return lines.join('\r\n');
}

/**
 * Main export function returning Uint8Array binary buffer ready for file download or saving.
 */
export function ptxCutPlanExport(input: PtxCutPlanExportInput): Uint8Array {
  const content = generatePtxString(input);
  return new TextEncoder().encode(content);
}
