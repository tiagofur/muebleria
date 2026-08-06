/**
 * Generic cut-list CSV for saw/CNC/third parties (PROD-2.2 / #224).
 *
 * Encoding: UTF-8
 * Separator: semicolon (`;`) — workshop-friendly for ES locale spreadsheets
 * Columns (stable contract):
 *   piece_code; module_code; material; length_mm; width_mm; qty; grain; edges; description
 *
 * Same board-part population as Optimizer export (no hardware).
 */

import type { ProductionCutRow } from '@muebles/domain';
import { ValidationError } from '@muebles/domain';

/** Documented header row — keep in sync with tests and issue #224. */
export const CUT_LIST_CSV_HEADERS = [
  'piece_code',
  'module_code',
  'material',
  'length_mm',
  'width_mm',
  'qty',
  'grain',
  'edges',
  'description',
] as const;

export const CUT_LIST_CSV_SEPARATOR = ';' as const;

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function edgesSummary(row: ProductionCutRow): string {
  const parts: string[] = [];
  if (row.L1) parts.push('L1');
  if (row.L2) parts.push('L2');
  if (row.W1) parts.push('W1');
  if (row.W2) parts.push('W2');
  return parts.join('+');
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
 * Serialize ProductionCutRow[] to UTF-8 CSV (semicolon-separated).
 */
export function cutListExportCsv(rows: readonly ProductionCutRow[]): string {
  if (rows.length === 0) {
    throw new ValidationError('no hay piezas de tablero para exportar', {
      field: 'rows',
    });
  }

  const lines: string[] = [CUT_LIST_CSV_HEADERS.join(CUT_LIST_CSV_SEPARATOR)];
  rows.forEach((row, index) => {
    lines.push(
      [
        csvEscape(pieceCode(row, index)),
        csvEscape(row.moduleCode ?? ''),
        csvEscape(row.materialName ?? ''),
        csvEscape(row.lengthMm),
        csvEscape(row.widthMm),
        csvEscape(row.quantity),
        csvEscape(row.grain),
        csvEscape(edgesSummary(row)),
        csvEscape(row.description ?? ''),
      ].join(CUT_LIST_CSV_SEPARATOR),
    );
  });
  return `${lines.join('\n')}\n`;
}
