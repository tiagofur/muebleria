/**
 * Smoke: write /tmp/optimizer_smoke.xlsx from MOD-GAB-01 × 1 fixture JSON.
 * Run: node packages/excel/src/__fixtures__/smokeExport.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve exceljs from package root
const ExcelJS = require('exceljs');

const rows = JSON.parse(
  readFileSync(join(__dirname, 'modGab01CutRows.json'), 'utf8'),
);

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Plantilla');
const headers = [
  'Cantidad',
  'Largo',
  'Ancho',
  'Descripcion',
  'Materia Prima',
  'veta',
  'Largo 1',
  'Largo 2',
  'Ancho 1',
  'Ancho 2',
];

sheet.mergeCells('A1:E1');
sheet.mergeCells('F1:J1');
sheet.getCell('A1').value = 'Material';
sheet.getCell('F1').value = 'Cubrecanto';
headers.forEach((h, i) => {
  sheet.getCell(2, i + 1).value = h;
});

rows.forEach((row, index) => {
  const r = index + 3;
  sheet.getCell(r, 1).value = row.quantity;
  sheet.getCell(r, 2).value = row.lengthMm;
  sheet.getCell(r, 3).value = row.widthMm;
  sheet.getCell(r, 4).value = row.description;
  sheet.getCell(r, 5).value = row.materialName;
  sheet.getCell(r, 6).value = row.grain;
  sheet.getCell(r, 7).value = row.L1;
  sheet.getCell(r, 8).value = row.L2;
  sheet.getCell(r, 9).value = row.W1;
  sheet.getCell(r, 10).value = row.W2;
});

const out = '/tmp/optimizer_smoke.xlsx';
const buffer = await workbook.xlsx.writeBuffer();
writeFileSync(out, Buffer.from(buffer));
console.log(`Wrote ${out} (${rows.length} data rows)`);
