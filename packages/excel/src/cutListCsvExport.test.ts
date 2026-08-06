import { describe, expect, it } from 'vitest';
import type { ProductionCutRow } from '@muebles/domain';
import {
  CUT_LIST_CSV_HEADERS,
  CUT_LIST_CSV_SEPARATOR,
  cutListExportCsv,
} from './cutListCsvExport';

const rows: ProductionCutRow[] = [
  {
    quantity: 2,
    lengthMm: 720,
    widthMm: 560,
    description: 'LAT · Lateral · GAB-01',
    materialName: 'Blanco 18',
    grain: 0,
    L1: 1,
    L2: 1,
    W1: 0,
    W2: 0,
    partCode: 'LAT',
    moduleCode: 'GAB-01',
  },
  {
    quantity: 1,
    lengthMm: 600,
    widthMm: 560,
    description: 'FON · Fondo · GAB-01',
    materialName: 'Blanco 18',
    grain: 1,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    partCode: 'FON',
    moduleCode: 'GAB-01',
  },
];

describe('cutListExportCsv (PROD-2.2)', () => {
  it('exports stable header and semicolon separator', () => {
    const csv = cutListExportCsv(rows);
    const header = csv.split('\n')[0];
    expect(header).toBe(CUT_LIST_CSV_HEADERS.join(CUT_LIST_CSV_SEPARATOR));
    expect(csv).toContain('GAB-01-LAT');
    expect(csv).toContain('720');
    expect(csv).toContain('L1+L2');
    // two data lines + header + trailing newline
    expect(csv.trim().split('\n')).toHaveLength(3);
  });

  it('throws on empty cut list', () => {
    expect(() => cutListExportCsv([])).toThrow(/piezas/);
  });
});
