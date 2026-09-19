import { describe, expect, it } from 'vitest';
import { buildLabGuillotineDocument } from './fixtures';
import { ptxDocumentDifference, ptxDocumentsEqual } from './equivalence';
import { parsePtxDocumentBytes, parsePtxDocumentText } from './parse';
import { serializePtxDocument, serializePtxDocumentBytes } from './serialize';
import { validatePtxDocument } from './validate';

describe('PTX core roundtrip: records → serialize → bytes → parse → model', () => {
  it('rebuilds an equivalent model from its own bytes', () => {
    const original = buildLabGuillotineDocument();
    const bytes = serializePtxDocumentBytes(original);
    const parsed = parsePtxDocumentBytes(bytes);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentDifference(parsed, original)).toBeNull();
    expect(ptxDocumentsEqual(parsed, original)).toBe(true);
    expect(parsed).toEqual(original);
  });

  it('roundtrips through the text form as well', () => {
    const original = buildLabGuillotineDocument();
    const parsed = parsePtxDocumentText(serializePtxDocument(original));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(parsed).toEqual(original);
  });

  it('roundtrips with LF line endings and higher decimal resolution', () => {
    const original = {
      ...buildLabGuillotineDocument(),
      records: buildLabGuillotineDocument().records.map((record) => {
        if (record.type === 'CUTS' && record.cutIndex === 1) {
          return { ...record, dimension: 462.46 };
        }
        if (record.type === 'MATERIALS') {
          return { ...record, kerfRip: 4.4, kerfCrosscut: 4.4 };
        }
        return record;
      }),
    };
    const parsed = parsePtxDocumentBytes(
      serializePtxDocumentBytes(original, { decimalPlaces: 2, lineEnding: '\n' }),
    );
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(parsed).toEqual(original);
  });

  it('roundtrips quoted text containing commas and quotes', () => {
    const original = {
      ...buildLabGuillotineDocument(),
      header: { ...buildLabGuillotineDocument().header, title: 'GRANETE, "LAB"' },
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(original));
    expect(parsed.header.title).toBe('GRANETE, "LAB"');
    expect(parsed).toEqual(original);
  });
});

describe('PTX core mutation detection (independent readback)', () => {
  // Every mutation below keeps the CSV syntactically parseable: detection
  // must come from validation or equivalence, never from a byte fluke.
  it('detects a modified dimension', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: original.records.map((r) =>
        r.type === 'CUTS' && r.cutIndex === 2 ? { ...r, dimension: 460 } : r,
      ),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
    expect(ptxDocumentDifference(parsed, original)).toContain('dimension');
  });

  it('detects a crossed PART_INDEX (both targets exist)', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: original.records.map((r) => {
        if (r.type !== 'CUTS') return r;
        if (r.cutIndex === 2) return { ...r, partReference: { kind: 'part' as const, partIndex: 2 } };
        if (r.cutIndex === 4) return { ...r, partReference: { kind: 'part' as const, partIndex: 1 } };
        return r;
      }),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects rows physically reordered by SEQUENCE (order encodes the tree)', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: [...original.records].sort((a, b) => {
        const seq = (r: typeof a) => (r.type === 'CUTS' ? r.sequence : Number.MAX_SAFE_INTEGER);
        return seq(a) - seq(b);
      }),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects a changed pattern TYPE and HEADER units', () => {
    const original = buildLabGuillotineDocument();
    const typeMutated = {
      ...original,
      records: original.records.map((r) => (r.type === 'PATTERNS' ? { ...r, patternType: 1 as const } : r)),
    };
    expect(ptxDocumentsEqual(parsePtxDocumentBytes(serializePtxDocumentBytes(typeMutated)), original)).toBe(false);

    const unitsMutated = { ...original, header: { ...original.header, units: 1 as const } };
    expect(ptxDocumentsEqual(parsePtxDocumentBytes(serializePtxDocumentBytes(unitsMutated)), original)).toBe(false);
  });

  it('detects an extra kerf on the material', () => {
    const original = buildLabGuillotineDocument();
    const mutated = {
      ...original,
      records: original.records.map((r) => (r.type === 'MATERIALS' ? { ...r, kerfRip: 5 } : r)),
    };
    const parsed = parsePtxDocumentBytes(serializePtxDocumentBytes(mutated));
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects an empty cell turned into an explicit zero', () => {
    const original = buildLabGuillotineDocument();
    const text = serializePtxDocument(original);
    // JOBS line ends with the empty WASTE_PCNT (and CUT_TIME) optional cells.
    const mutatedText = text
      .split('\r\n')
      .map((line) => (line.startsWith('JOBS,') ? line.replace(/,$/, '0') : line))
      .join('\r\n');
    expect(mutatedText).not.toBe(text);
    const parsed = parsePtxDocumentText(mutatedText);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });

  it('detects a deleted cut row through validation (index gap)', () => {
    const original = buildLabGuillotineDocument();
    const text = serializePtxDocument(original);
    const mutatedText = text
      .split('\r\n')
      .filter((line) => !line.startsWith('CUTS,1,1,3,'))
      .join('\r\n');
    const parsed = parsePtxDocumentText(mutatedText);
    const issues = validatePtxDocument(parsed);
    expect(issues.map((i) => i.code)).toContain('INDEX_NOT_CONTIGUOUS');
    expect(ptxDocumentsEqual(parsed, original)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #789 — PARTS_INF / PARTS_UDI roundtrip y forma serializada
// ---------------------------------------------------------------------------

describe('#789 PARTS_INF/PARTS_UDI roundtrip y forma', () => {
  const partsInfRow = {
    type: 'PARTS_INF' as const,
    jobIndex: 1,
    partIndex: 1,
    description: 'COSTADO',
    labelQuantity: '1',
    finishedLength: '450',
    finishedWidth: '320',
    order: 'R3',
    edge1: 'C-ABS',
    edge2: 'C-ABS',
    drawing: 'D0123456789AB',
    product: 'MOD-X',
    productInfo: 'Modulo X',
    productWidth: '600',
    productHeight: '2000',
    productDepth: '500',
    productNumber: '1',
    room: 'COCINA',
    barcode1: '*D0123456789AB*',
    barcode2: 'MOD-X-P01',
  };

  it('PARTS_INF serializa el ancho documentado completo (32 celdas) y roundtrip exacto', () => {
    const original = { ...buildLabGuillotineDocument(), records: [...buildLabGuillotineDocument().records, partsInfRow] };
    const text = serializePtxDocument(original);
    const line = text.split('\r\n').find((l) => l.startsWith('PARTS_INF'))!;
    expect(line.split(',')).toHaveLength(33); // familia + 32 columnas
    // Las columnas finales documentadas sin valor van como celdas VACÍAS
    // (trailing empties, la misma filosofía del writer para JOBS).
    expect(line.endsWith(',,')).toBe(true);
    const parsed = parsePtxDocumentText(text);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(parsed).toEqual(original);
  });

  it('PARTS_UDI serializa sólo el prefijo INFO definido (trailing omitted, disciplina r4)', () => {
    const original = {
      ...buildLabGuillotineDocument(),
      records: [
        ...buildLabGuillotineDocument().records,
        { type: 'PARTS_UDI' as const, jobIndex: 1, partIndex: 1, info: ['pic.png', undefined, 'LINEA-A', 'LINEA-A'] },
        { type: 'PARTS_UDI' as const, jobIndex: 1, partIndex: 2, info: [] },
      ],
    };
    const text = serializePtxDocument(original);
    const lines = text.split('\r\n').filter((l) => l.startsWith('PARTS_UDI'));
    // familia + JOB + PART + 4 INFO: el INFO2 vacío intermedio conserva su
    // posición como celda vacía; el trailing no definido NO se escribe.
    expect(lines[0]!.split(',')).toHaveLength(7);
    expect(lines[0]).toBe('PARTS_UDI,1,1,pic.png,,LINEA-A,LINEA-A');
    expect(lines[1]).toBe('PARTS_UDI,1,2'); // sin INFO definido: fila corta
    const parsed = parsePtxDocumentText(text);
    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(parsed).toEqual(original);
  });

  it('más de 32 columnas PARTS_INF / 62 PARTS_UDI BLOQUEA en el lector (TOO_MANY_COLUMNS)', () => {
    const original = buildLabGuillotineDocument();
    const base = serializePtxDocument(original);
    const capture = (fn: () => unknown): { code: string } => {
      try {
        fn();
      } catch (error) {
        return error as { code: string };
      }
      throw new Error('se esperaba PtxParseError');
    };
    const infError = capture(() => parsePtxDocumentText(`${base}PARTS_INF,1,1${',X'.repeat(32)}\r\n`));
    expect(infError.code).toBe('TOO_MANY_COLUMNS');
    const udiError = capture(() => parsePtxDocumentText(`${base}PARTS_UDI,1,1${',X'.repeat(61)}\r\n`));
    expect(udiError.code).toBe('TOO_MANY_COLUMNS');
  });

  it('fila PARTS_UDI corta estilo muestra (4 INFO) parsea con la posición exacta', () => {
    const original = buildLabGuillotineDocument();
    // Sin espacios tras comas: la tolerancia al dialecto con espacios vive en
    // el lector externo (#788 externalDialect, probado allí con las muestras).
    const text = `${serializePtxDocument(original)}PARTS_UDI,1,1,ETQ-A1.png,2WD2LD,LINEA-A,LINEA-A\r\n`;
    const parsed = parsePtxDocumentText(text);
    const udi = parsed.records.at(-1) as { type: 'PARTS_UDI'; info: readonly (string | undefined)[] };
    expect(udi.info).toEqual(['ETQ-A1.png', '2WD2LD', 'LINEA-A', 'LINEA-A']);
  });
});
