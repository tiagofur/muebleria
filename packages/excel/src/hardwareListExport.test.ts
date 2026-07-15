/**
 * Hardware purchase-list export tests: columns, round-trip, no boards.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  generateHardwareList,
  type Project,
  ValidationError,
} from '@muebles/domain';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaGabOnlyProject,
} from '@muebles/domain/fixtures';
import {
  HARDWARE_LIST_HEADERS,
  hardwareListExport,
  hardwareListExportCsv,
} from './hardwareListExport';

const gabOnlyProject: Project = {
  ...plantillaGabOnlyProject,
  id: 'proj-gab-only',
  name: 'Gab only',
  customerId: 'Test',
  laborFixedCost: 0,
  items: [
    {
      id: 'item-gab',
      moduleId: IDS.modGab,
      quantity: 1,
      optionChoices: plantillaChoices,
    },
  ],
};

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

describe('hardwareListExport', () => {
  it('writes purchase-list headers on row 1', async () => {
    const rows = generateHardwareList(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const buffer = await hardwareListExport(rows);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Herrajes');
    expect(sheet).toBeDefined();

    const headers = HARDWARE_LIST_HEADERS.map(
      (_, i) => sheet!.getRow(1).getCell(i + 1).value,
    );
    expect(headers).toEqual([...HARDWARE_LIST_HEADERS]);
  });

  it('round-trip: row count and key values match domain list', async () => {
    const rows = generateHardwareList(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const buffer = await hardwareListExport(rows);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Herrajes')!;

    let dataCount = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      dataCount += 1;
      const domainRow = rows[rowNumber - 2]!;
      expect(row.getCell(1).value).toBe(domainRow.code);
      expect(row.getCell(2).value).toBe(domainRow.description);
      expect(row.getCell(4).value).toBe(domainRow.quantity);
      expect(Number(row.getCell(5).value)).toBe(domainRow.costPerUnit);
      expect(Number(row.getCell(6).value)).toBe(domainRow.lineCost);
    });
    expect(dataCount).toBe(rows.length);
    expect(dataCount).toBe(5);
  });

  it('contains only hardware codes (no board materials)', async () => {
    const rows = generateHardwareList(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const buffer = await hardwareListExport(rows);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Herrajes')!;
    const codes: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      codes.push(String(row.getCell(1).value));
    });
    expect(codes.every((c) => c.startsWith('HER-'))).toBe(true);
    expect(codes).not.toContain('TAB-ARA-BLA');
  });

  it('rejects empty rows', async () => {
    await expect(hardwareListExport([])).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(hardwareListExport([])).rejects.toThrow(
      /no hay herrajes para exportar/i,
    );
  });
});

describe('hardwareListExportCsv', () => {
  it('emits header + data lines usable for purchases', () => {
    const rows = generateHardwareList(
      gabOnlyProject,
      plantillaCatalogWithModules,
    );
    const csv = hardwareListExportCsv(rows);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(HARDWARE_LIST_HEADERS.join(','));
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines[1]).toContain('HER-BIS-CL');
    expect(lines[1]).toContain('Bisagra Cierre Lento');
    expect(lines[1]).toContain('Pieza');
  });

  it('rejects empty rows', () => {
    expect(() => hardwareListExportCsv([])).toThrow(ValidationError);
  });
});
