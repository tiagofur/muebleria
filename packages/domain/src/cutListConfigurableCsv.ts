/**
 * Pure configurable cut list CSV generator for third-party optimizers (F073).
 *
 * Placed in domain so both UI and Excel packages can consume it cleanly.
 */

import type { ProductionCutRow } from './types';
import { ValidationError } from './errors';

export type CsvDelimiter = ',' | ';' | '\t';
export type CsvOptimizerPreset = 'standard' | 'lepton' | 'cortecerto' | 'optinest';

export interface CutListCsvExportOptions {
  readonly delimiter?: CsvDelimiter;
  readonly includeHeader?: boolean;
  readonly preset?: CsvOptimizerPreset;
  readonly materialFilter?: string | null;
}

const PRESET_HEADERS: Record<CsvOptimizerPreset, readonly string[]> = {
  standard: [
    'piece_code',
    'module_code',
    'material',
    'length_mm',
    'width_mm',
    'qty',
    'grain',
    'edges',
    'description',
  ],
  lepton: [
    'CODIGO',
    'CANTIDAD',
    'LARGO',
    'ANCHO',
    'MATERIAL',
    'VETA',
    'L1',
    'L2',
    'A1',
    'A2',
  ],
  cortecerto: ['Peca', 'Qtd', 'Compr', 'Larg', 'Material', 'Veta'],
  optinest: ['Name', 'Quantity', 'Length', 'Width', 'Material', 'Grain'],
};

function csvEscapeValue(value: string | number, delimiter: CsvDelimiter): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=@+]/.test(text)) {
    text = `'${text}`;
  }
  const needsEscaping = text.includes(delimiter) || /[";\r\n]/.test(text);
  if (needsEscaping) {
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
  return parts.join('+') || 'NINGUNO';
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

function formatRowValues(
  row: ProductionCutRow,
  index: number,
  preset: CsvOptimizerPreset,
): readonly (string | number)[] {
  const code = pieceCode(row, index);
  const qty = Math.max(1, row.quantity);
  const mat = row.materialName ?? 'Sin material';
  const grain = row.grain ?? 0;

  switch (preset) {
    case 'lepton':
      return [
        code,
        qty,
        row.lengthMm,
        row.widthMm,
        mat,
        grain,
        row.L1 ? 1 : 0,
        row.L2 ? 1 : 0,
        row.W1 ? 1 : 0,
        row.W2 ? 1 : 0,
      ];
    case 'cortecerto':
    case 'optinest':
      return [code, qty, row.lengthMm, row.widthMm, mat, grain];
    case 'standard':
    default:
      return [
        code,
        row.moduleCode ?? '',
        mat,
        row.lengthMm,
        row.widthMm,
        qty,
        grain,
        edgesSummary(row),
        row.description ?? '',
      ];
  }
}

/**
 * Export ProductionCutRow[] to configurable CSV format.
 */
export function cutListConfigurableCsvExport(
  rows: readonly ProductionCutRow[],
  options: CutListCsvExportOptions = {},
): string {
  const {
    delimiter = ';',
    includeHeader = true,
    preset = 'standard',
    materialFilter = null,
  } = options;

  let filtered = rows;
  if (materialFilter && materialFilter.trim()) {
    const filterTerm = materialFilter.trim().toLowerCase();
    filtered = rows.filter(
      (r) => (r.materialName || '').toLowerCase() === filterTerm,
    );
  }

  if (filtered.length === 0) {
    throw new ValidationError(
      'no hay piezas de tablero para exportar con los filtros seleccionados',
      { field: 'rows' },
    );
  }

  const headers = PRESET_HEADERS[preset] ?? PRESET_HEADERS.standard;
  const lines: string[] = [];

  if (includeHeader) {
    lines.push(
      headers.map((h) => csvEscapeValue(h, delimiter)).join(delimiter),
    );
  }

  filtered.forEach((row, index) => {
    const values = formatRowValues(row, index, preset);
    lines.push(
      values.map((v) => csvEscapeValue(v, delimiter)).join(delimiter),
    );
  });

  return `${lines.join('\n')}\n`;
}
