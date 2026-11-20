/**
 * #1651 — lectura de la lista de precios del proveedor (XLSX o CSV). Sólo
 * extrae encabezados y celdas; el emparejamiento por código y la clasificación
 * los hace el servidor. Los números aceptan coma decimal y separador de miles
 * («1.234,56», «1,234.56», «$ 1234,5»).
 */
import ExcelJS from 'exceljs';

export interface ParsedPriceList {
  readonly headers: readonly string[];
  /** Data rows (without the header), each with its 1-based file line. */
  readonly rows: readonly { readonly line: number; readonly cells: readonly string[] }[];
}

/** Parses a locale-formatted number; null when it is not a number. */
export function parseLocaleNumber(raw: string): number | null {
  let s = raw.trim().replace(/[\s$€]/g, '').replace(/[A-Za-z]{3}$/, '');
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // The later separator is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    // «1,234» with exactly 3 digits and one comma is ambiguous; a single
    // comma is treated as the decimal separator (es-AR/es-UY usage).
    s = (s.match(/,/g) ?? []).length > 1 && decimals === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, ''); // «1.234.567» thousands with dots
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** CSV with «;», «,» or tab separator (detected from the header line). */
export function parsePriceListCsv(text: string): ParsedPriceList {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerLine = lines[0] ?? '';
  const sep = [';', '\t', ','].reduce((best, cand) =>
    headerLine.split(cand).length > headerLine.split(best).length ? cand : best,
  );
  const headers = splitCsvLine(headerLine, sep);
  const rows: { line: number; cells: string[] }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;
    rows.push({ line: i + 1, cells: splitCsvLine(raw, sep) });
  }
  return { headers, rows };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((t) => t.text).join('').trim();
    if ('text' in value) return String(value.text).trim();
  }
  return String(value).trim();
}

/** First worksheet of an XLSX workbook; the first non-empty row is the header. */
export async function parsePriceListXlsx(data: ArrayBuffer): Promise<ParsedPriceList> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  let headers: string[] | null = null;
  const rows: { line: number; cells: string[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    if (values.every((v) => v === '')) return;
    if (headers === null) {
      headers = values;
      return;
    }
    rows.push({ line: rowNumber, cells: values });
  });
  return { headers: headers ?? [], rows };
}

/** Reads a supplier price list by file name extension. */
export async function parsePriceListFile(fileName: string, data: ArrayBuffer): Promise<ParsedPriceList> {
  if (/\.xlsx$/i.test(fileName)) return parsePriceListXlsx(data);
  if (/\.(csv|txt)$/i.test(fileName)) return parsePriceListCsv(new TextDecoder('utf-8').decode(data));
  throw new Error('Formato no soportado: usá un archivo .xlsx o .csv');
}

/** Index of the column whose header looks like the code / price column. */
export function guessPriceListColumns(headers: readonly string[]): { code: number; price: number } {
  const norm = headers.map((h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  const code = norm.findIndex((h) => /\b(codigo|cod|code|sku|articulo|ref)\b/.test(h));
  const price = norm.findIndex((h) => /\b(precio|price|costo|cost|importe|valor)\b/.test(h));
  return { code, price };
}
