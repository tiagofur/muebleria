/**
 * #788 — external-dialect structural reader tests (r5 groundwork).
 *
 * The sanitized REAL client files R2201/R7301 (docs/machines/ptx-cadmatic4/
 * field/, originals never committed) must be readable within the Granete-
 * modeled subset WITHOUT being forced into the Granete writer's exact shape:
 * spaces after commas, blank lines, extra documented trailing columns and
 * unmodeled-but-documented families (PARTS_INF/PARTS_UDI/NOTES) are part of
 * the observed dialect. The fixtures are read as-is — never modified to make
 * a test pass.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PtxParseError } from './parse';
import {
  hasPtxExternalShape,
  parsePtxExternalText,
  ptxExternalColumnPresence,
  PTX_DOCUMENTED_UNMODELED_FAMILIES,
  type PtxExternalModeledRow,
} from './externalDialect';
import { ptxSpecPreflightDocument } from './specPreflight';
import type { PtxBoardRecord, PtxCutRecord, PtxJobRecord, PtxMaterialRecord } from './records';

const FIELD_DIR = new URL('../../../../docs/machines/ptx-cadmatic4/field/', import.meta.url);

function readSample(name: string): string {
  return readFileSync(new URL(name, FIELD_DIR), 'utf8');
}

function captureParseError(fn: () => unknown): PtxParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PtxParseError) return error;
    throw error;
  }
  throw new Error('se esperaba PtxParseError');
}

describe('#788 parsing estructural de R2201 saneado (subset soportado)', () => {
  const readback = parsePtxExternalText(readSample('01_muestra_a_saneada.ptx.txt'));

  it('lee el HEADER con QUOTED title preservado (espacios internos intactos)', () => {
    expect(readback.header).toMatchObject({
      version: 1,
      title: 'MUESTRA-A - SANEADA - ',
      units: 0,
      origin: 0,
      trimType: 1,
    });
  });

  it('lee las tablas modeladas con sus conteos reales', () => {
    expect(readback.records.filter((r) => r.type === 'PARTS_REQ')).toHaveLength(5);
    expect(readback.records.filter((r) => r.type === 'BOARDS')).toHaveLength(2);
    expect(readback.records.filter((r) => r.type === 'MATERIALS')).toHaveLength(6);
    expect(readback.records.filter((r) => r.type === 'PATTERNS')).toHaveLength(2);
    expect(readback.records.filter((r) => r.type === 'OFFCUTS')).toHaveLength(1);
    const cuts = readback.records.filter((r) => r.type === 'CUTS') as PtxCutRecord[];
    expect(cuts).toHaveLength(12); // 6 por patrón
    expect(new Set(cuts.map((c) => c.patternIndex))).toEqual(new Set([1, 2]));
  });

  it('las familias documentadas no modeladas quedan registradas opacas (no parseadas, no ignoradas)', () => {
    expect(readback.unmodeledFamilyCounts.get('PARTS_INF')).toBe(5);
    expect(readback.unmodeledFamilyCounts.get('PARTS_UDI')).toBe(5);
    expect(readback.unmodeledFamilyCounts.get('NOTES')).toBe(1);
    const unmodeledTotal = [...readback.unmodeledFamilyCounts.values()].reduce((sum, count) => sum + count, 0);
    // Cada fila del row view es exactamente: un registro modelado, una fila
    // opaca no modelada o el HEADER — nada se cae fuera del inventario.
    expect(readback.rows).toHaveLength(readback.records.length + unmodeledTotal + 1);
  });

  it('BOARDS tolera las 2 columnas finales documentadas (COST/STK_FLAG) contándolas', () => {
    const boardRows = readback.rows.filter(hasPtxExternalShape).filter((row) => row.family === 'BOARDS');
    for (const row of boardRows) {
      expect(row.cellsProvided).toBe(10); // 8 modeladas + 2 documentadas
      expect(row.extraTrailingCells).toBe(2);
    }
    const board = readback.records.find((r) => r.type === 'BOARDS') as PtxBoardRecord;
    expect(board).toMatchObject({ boardIndex: 1, materialIndex: 2, length: 2440, width: 1220, usedQuantity: 1 });
  });

  it('PATTERNS tolera el PICTURE trailing y lee MAX_BOOK=3 del subset', () => {
    const patternRows = readback.rows.filter(hasPtxExternalShape).filter((row) => row.family === 'PATTERNS');
    expect(patternRows.every((row) => row.cellsProvided === 8 && row.extraTrailingCells === 1)).toBe(true);
    const pattern = readback.records.find((r) => r.type === 'PATTERNS');
    expect(pattern).toMatchObject({ patternIndex: 1, boardIndex: 1, patternType: 0, maxBook: 3 });
  });

  it('OFFCUTS lee la forma evidenciada: CODE vacío + OFC_QTY=1', () => {
    const offcut = readback.records.find((r) => r.type === 'OFFCUTS');
    expect(offcut).toMatchObject({ offcutIndex: 1, materialIndex: 2, length: 1718.601, width: 862.601, producedQuantity: 1 });
    expect((offcut as { code?: string }).code).toBeUndefined();
  });

  it('JOBS lee las 7 celdas presentes y los CUTS la X1 de la FUNCTION 92', () => {
    const job = readback.records.find((r) => r.type === 'JOBS') as PtxJobRecord;
    expect(job).toMatchObject({ jobIndex: 1, name: 'MUESTRA-A', description: 'MUEBLE MUESTRA A', status: 1 });
    const fn92 = (readback.records.filter((r) => r.type === 'CUTS') as PtxCutRecord[]).find((c) => c.functionCode === 92);
    expect(fn92).toMatchObject({ patternIndex: 1, cutIndex: 6, repeatQuantity: 1 });
    expect(fn92!.partReference).toEqual({ kind: 'offcut', offcutIndex: 1 });
  });

  it('el subset modelado pasa el strict spec preflight (índices y referencias del dialecto real)', () => {
    // Observación sobre el SUBSET leído: las familias no modeladas están
    // fuera del veredicto por construcción — esto no es un claim sobre el
    // archivo completo ni sobre el receptor.
    expect(ptxSpecPreflightDocument({ header: readback.header!, records: readback.records })).toEqual([]);
  });
});

describe('#788 parsing estructural de R7301 saneado (subset soportado)', () => {
  const readback = parsePtxExternalText(readSample('02_muestra_b_saneada.ptx.txt'));

  it('lee las tablas modeladas con sus conteos reales (12 piezas, 2 patrones)', () => {
    expect(readback.records.filter((r) => r.type === 'PARTS_REQ')).toHaveLength(12);
    expect(readback.records.filter((r) => r.type === 'BOARDS')).toHaveLength(1);
    expect(readback.records.filter((r) => r.type === 'MATERIALS')).toHaveLength(4);
    const patterns = readback.records.filter((r) => r.type === 'PATTERNS');
    expect(patterns).toHaveLength(2);
    // TYPE 0 y TYPE 1 (giro inicial) — ambos documentados y modelados.
    expect(patterns.map((p) => (p as { patternType: number }).patternType)).toEqual([0, 1]);
    const cuts = readback.records.filter((r) => r.type === 'CUTS') as PtxCutRecord[];
    expect(cuts).toHaveLength(26); // 14 + 12
    expect(readback.unmodeledFamilyCounts.get('PARTS_INF')).toBe(12);
    expect(readback.unmodeledFamilyCounts.get('PARTS_UDI')).toBe(12);
    expect(readback.unmodeledFamilyCounts.get('NOTES')).toBe(1);
  });

  it('CUSTOMER existe como celda VACÍA (present-empty, no omitted)', () => {
    const jobRow = readback.rows.find((row) => row.family === 'JOBS') as PtxExternalModeledRow;
    expect(jobRow).toBeDefined();
    // JOBS columns: 0 JOB_INDEX, 1 NAME, 2 DESC, 3 ORD_DATE, 4 CUT_DATE,
    // 5 CUSTOMER, 6 STATUS. La muestra lleva la celda 5 vacía y STATUS=1.
    expect(ptxExternalColumnPresence(jobRow, 5)).toBe('empty');
    expect(ptxExternalColumnPresence(jobRow, 6)).toBe('value');
    expect((readback.records.find((r) => r.type === 'JOBS') as PtxJobRecord).customer).toBeUndefined();
  });

  it('MATERIALS.DESC vacío lee como ausente y BOARDS conserva la forma con 2 extra', () => {
    const material = readback.records.find((r) => r.type === 'MATERIALS') as PtxMaterialRecord;
    expect(material).toMatchObject({ materialIndex: 1, code: 'TAGL LINEA-C 16MM 1.22X2.44', thickness: 16.3, bookQuantity: 3 });
    expect(material.description).toBeUndefined();
    const boardRow = readback.rows.find((row) => row.family === 'BOARDS');
    expect((boardRow as { extraTrailingCells: number }).extraTrailingCells).toBe(2);
  });

  it('el subset modelado pasa el strict spec preflight', () => {
    expect(ptxSpecPreflightDocument({ header: readback.header!, records: readback.records })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Shape: prefijo requerido / trailing opcional / vacío vs omitido
// ---------------------------------------------------------------------------

describe('#788 empty field vs omitted trailing field', () => {
  const header = 'HEADER,1,LAB,0,0,1\r\n';

  it('trailing opcional OMITIDO: la fila termina antes de la columna', () => {
    const readback = parsePtxExternalText(`${header}CUTS,1,1,1,1,1,320.0,1,0\r\n`);
    const row = readback.rows.find((r) => r.family === 'CUTS') as PtxExternalModeledRow;
    expect(row.cellsProvided).toBe(8);
    expect(ptxExternalColumnPresence(row, 7)).toBe('value'); // PART_INDEX=0
    expect(ptxExternalColumnPresence(row, 8)).toBe('omitted'); // QTY_PARTS
    expect(ptxExternalColumnPresence(row, 9)).toBe('omitted'); // COMMENT
    const cut = readback.records[0] as PtxCutRecord;
    expect(cut.producedQuantity).toBeUndefined();
    expect(cut.comment).toBeUndefined();
  });

  it('trailing opcional VACÍO: la celda existe (coma final) pero está vacía', () => {
    const readback = parsePtxExternalText(`${header}CUTS,1,1,1,1,1,320.0,1,0,\r\n`);
    const row = readback.rows.find((r) => r.family === 'CUTS') as PtxExternalModeledRow;
    expect(row.cellsProvided).toBe(9);
    expect(ptxExternalColumnPresence(row, 8)).toBe('empty'); // QTY_PARTS presente y vacío
    expect(ptxExternalColumnPresence(row, 9)).toBe('omitted');
    const cut = readback.records[0] as PtxCutRecord;
    // Ambas lecturas llegan al modelo como ausente (S06: vacío ≠ cero), pero
    // la forma de la fila es distinta y queda expuesta en el row shape.
    expect(cut.producedQuantity).toBeUndefined();
    expect(row.emptyModeledColumns).toContain(8);
  });

  it('vacío INTERMEDIO con valor posterior en la misma fila', () => {
    const readback = parsePtxExternalText(`${header}CUTS,1,1,1,1,1,320.0,1,0,,NOTE\r\n`);
    const row = readback.rows.find((r) => r.family === 'CUTS') as PtxExternalModeledRow;
    expect(ptxExternalColumnPresence(row, 8)).toBe('empty');
    expect(ptxExternalColumnPresence(row, 9)).toBe('value');
    const cut = readback.records[0] as PtxCutRecord;
    expect(cut.comment).toBe('NOTE');
  });

  it('espacios tras las comas (dialecto de la propia guía) se toleran en celdas sin comillas', () => {
    const readback = parsePtxExternalText(
      'HEADER, 1, LAB, 0, 0, 1\r\nCUTS,   1,   1,   1,   1,   1,    333.0, 1,    0\r\n',
    );
    expect(readback.header!.version).toBe(1);
    const cut = readback.records[0] as PtxCutRecord;
    expect(cut).toMatchObject({ jobIndex: 1, patternIndex: 1, cutIndex: 1, dimension: 333, repeatQuantity: 1 });
  });

  it('líneas en blanco entre secciones se toleran', () => {
    const readback = parsePtxExternalText('HEADER,1,LAB,0,0,1\r\n\r\nJOBS,1,X\r\n\r\n');
    expect(readback.records).toHaveLength(1);
  });

  it('contenido QUOTED con espacios se preserva verbatim (sin trim)', () => {
    const readback = parsePtxExternalText('HEADER,1,"  PADDED TITLE ",0,0,1\r\n');
    expect(readback.header!.title).toBe('  PADDED TITLE ');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed en lo que NO es tolerancia de shape
// ---------------------------------------------------------------------------

describe('#788 fail-closed del lector externo', () => {
  it('familia NO documentada BLOQUEA (nada se adivina)', () => {
    const error = captureParseError(() => parsePtxExternalText('HEADER,1,LAB,0,0,1\r\nWIDGET,1,2\r\n'));
    expect(error.code).toBe('UNKNOWN_RECORD_FAMILY');
  });

  it('prefijo requerido incompleto BLOQUEA con TOO_FEW_COLUMNS', () => {
    const error = captureParseError(() => parsePtxExternalText('HEADER,1,LAB,0,0,1\r\nCUTS,1,1,1\r\n'));
    expect(error.code).toBe('TOO_FEW_COLUMNS');
  });

  it('valor inválido en columna modelada BLOQUEA (no sólo shape)', () => {
    const error = captureParseError(() => parsePtxExternalText('HEADER,1,LAB,9,0,1\r\n'));
    expect(error.code).toBe('INVALID_ENUM_VALUE');
  });

  it('el catálogo de familias no modeladas es exactamente el documentado', () => {
    expect([...PTX_DOCUMENTED_UNMODELED_FAMILIES]).toEqual(['PARTS_INF', 'PARTS_UDI', 'PARTS_DST', 'PTN_UDI', 'NOTES']);
  });
});
