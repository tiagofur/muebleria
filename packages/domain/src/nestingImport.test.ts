import { describe, expect, it } from 'vitest';
import { parseNestingImportCsv } from './nestingImport';

describe('parseNestingImportCsv', () => {
  it('parses header + rows', () => {
    const csv = `material_code,sheets_used,area_m2
TAB-ARA-BLA,3,12.5
TAB-MDF,1`;
    const rows = parseNestingImportCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      materialCode: 'TAB-ARA-BLA',
      sheetsUsed: 3,
      areaM2: 12.5,
    });
    expect(rows[1]).toEqual({
      materialCode: 'TAB-MDF',
      sheetsUsed: 1,
      areaM2: undefined,
    });
  });

  it('accepts semicolon and no header', () => {
    const rows = parseNestingImportCsv('MEL-18;2;5');
    expect(rows[0]?.materialCode).toBe('MEL-18');
    expect(rows[0]?.sheetsUsed).toBe(2);
  });
});
