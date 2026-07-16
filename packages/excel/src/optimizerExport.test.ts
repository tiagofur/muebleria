/**
 * Optimizer export tests: columns A–J, fixture MOD-GAB-01, exceljs round-trip.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  generateCutRows,
  type ProductionCutRow,
  type Project,
  ValidationError,
} from '@muebles/domain';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaGabOnlyProject,
} from '@muebles/domain/fixtures';
import { OPTIMIZER_DATA_HEADERS, optimizerExport } from './optimizerExport';

const __dirname = dirname(fileURLToPath(import.meta.url));

const expectedGabRows = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__/modGab01CutRows.json'),
    'utf8',
  ),
) as ProductionCutRow[];

/** Same BOM as seed demo; laborFixed differs from seed but cut rows ignore labor. */
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

async function loadWorkbook(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs Buffer typing expects ArrayBuffer-like in some versions
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

function readDataRows(sheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 3) return;
    const values: unknown[] = [];
    for (let col = 1; col <= 10; col++) {
      values.push(row.getCell(col).value);
    }
    // skip fully empty trailing rows
    if (values.every((v) => v === null || v === undefined || v === '')) {
      return;
    }
    rows.push(values);
  });
  return rows;
}

describe('optimizerExport', () => {
  it('writes columns A–J headers on row 2 in plantilla order', async () => {
    const buffer = await optimizerExport(expectedGabRows);
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Plantilla');
    expect(sheet).toBeDefined();

    const headers = OPTIMIZER_DATA_HEADERS.map(
      (_, i) => sheet!.getRow(2).getCell(i + 1).value,
    );
    expect(headers).toEqual([...OPTIMIZER_DATA_HEADERS]);

    expect(sheet!.getRow(1).getCell(1).value).toBe('Material');
    expect(sheet!.getRow(1).getCell(6).value).toBe('Cubrecanto');
    expect(sheet!.model.merges).toEqual(
      expect.arrayContaining(['A1:E1', 'F1:J1']),
    );
  });

  it('fixture: MOD-GAB-01 × 1 cut rows match expected JSON', () => {
    const rows = generateCutRows(gabOnlyProject, plantillaCatalogWithModules);
    expect(rows).toEqual(expectedGabRows);
    // EXP-05: board parts only (8), no hardware
    expect(rows).toHaveLength(8);
  });

  it('F011: plantillaGabOnlyProject (seed demo shape) matches Optimizer fixture rows', () => {
    const rows = generateCutRows(
      plantillaGabOnlyProject,
      plantillaCatalogWithModules,
    );
    expect(rows).toEqual(expectedGabRows);
  });

  it('fixture: export MOD-GAB-01 × 1 serializes expected A–J values', async () => {
    const rows = generateCutRows(gabOnlyProject, plantillaCatalogWithModules);
    const buffer = await optimizerExport(rows);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.byteLength).toBeGreaterThan(1000);

    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet('Plantilla')!;
    const data = readDataRows(sheet);

    expect(data).toHaveLength(expectedGabRows.length);
    expectedGabRows.forEach((expected, index) => {
      const row = data[index]!;
      expect(row).toEqual([
        expected.quantity,
        expected.lengthMm,
        expected.widthMm,
        expected.description,
        expected.materialName,
        expected.grain,
        expected.L1,
        expected.L2,
        expected.W1,
        expected.W2,
      ]);
    });
  });

  it('EXP-02: exported quantities reflect project item multiplier', async () => {
    const project: Project = {
      ...gabOnlyProject,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 2,
          optionChoices: plantillaChoices,
        },
      ],
    };
    const rows = generateCutRows(project, plantillaCatalogWithModules);
    const buffer = await optimizerExport(rows);
    const sheet = (await loadWorkbook(buffer)).getWorksheet('Plantilla')!;
    const data = readDataRows(sheet);
    for (const row of data) {
      expect(row[0]).toBe(2);
    }
  });

  it('VAL-05: empty rows throw clear error', async () => {
    await expect(optimizerExport([])).rejects.toBeInstanceOf(ValidationError);
    await expect(optimizerExport([])).rejects.toThrow(
      /no hay piezas de tablero para exportar/i,
    );
  });

  it('workbook reloads with exceljs without structural error', async () => {
    const rows = generateCutRows(gabOnlyProject, plantillaCatalogWithModules);
    const buffer = await optimizerExport(rows);
    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0]?.name).toBe('Plantilla');
    expect(workbook.worksheets[0]?.rowCount).toBeGreaterThanOrEqual(
      2 + rows.length,
    );
  });
});
