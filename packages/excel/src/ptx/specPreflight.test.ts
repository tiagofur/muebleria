/**
 * #788 — strict Pattern Exchange spec preflight tests (r5 groundwork).
 *
 * Covers the acceptance matrix of the issue plus the independent-review
 * round: HEADER limits (TITLE <= 25 fail-closed without truncation),
 * documented text/index/DIM/QTY limits (units-aware), index
 * consecutiveness/referential integrity per job, the documented JOBS-optional
 * semantics, the SPEC vs PRODUCT capability taxonomy, bytes-level
 * independence (the validator catches defects introduced AFTER
 * serialization), mutation proofs, and the r2/r3/r4 immutability regression
 * (frozen bytes keep their digests AND are honestly reported as
 * spec-violating — that is the defect this preflight exists to block for r5,
 * not something this PR repairs).
 *
 * History kept precise: earlier candidates were rejected in the field; r4 is
 * the second real candidate documented in the dossier (#787) and was
 * rejected — its TITLE (43 industrial / 33 lab) is the objective defect
 * behind the title regressions below.
 */

import { describe, expect, it } from 'vitest';
import { optimizeCutPlan } from '@granete/domain';
import type { PtxDocument, PtxPartReference, PtxRecord } from './records';
import { PTX_PATTERN_TYPE, PTX_SUPPORTED_CUT_FUNCTION_CODES } from './records';
import { buildLabGuillotineDocument } from './fixtures';
import { serializePtxDocument, serializePtxDocumentBytes } from './serialize';
import { parsePtxDocumentBytes, parsePtxDocumentText, PtxParseError } from './parse';
import { validatePtxDocument } from './validate';
import { compileCutPlanToPtxDocument, PtxCompilationError } from './compileCutPlan';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import {
  PTX_SPEC_LIMITS,
  PTX_SPEC_PREFLIGHT_REVISION,
  PtxSpecPreflightError,
  classifyPtxDocumentedEnumSupport,
  ptxSpecPreflightBytes,
  ptxSpecPreflightDocument,
  serializePtxDocumentBytesSpecChecked,
} from './specPreflight';
import { GOLDEN_OPTIONS, GOLDEN_TEXT, GOLDEN_ROWS, GOLDEN_MATERIALS, GOLDEN_CONFIG, GOLDEN_PROJECT_ID } from './cutPlanPtxGolden';
import {
  GOLDEN_R3_CONFIG,
  GOLDEN_R3_MATERIALS,
  GOLDEN_R3_OPTIONS,
  GOLDEN_R3_PROJECT_ID,
  GOLDEN_R3_ROWS,
  GOLDEN_R3_TEXT,
} from './cutPlanPtxGoldenR3';
import {
  GOLDEN_R4_CONFIG,
  GOLDEN_R4_MATERIALS,
  GOLDEN_R4_OPTIONS,
  GOLDEN_R4_PROJECT_ID,
  GOLDEN_R4_ROWS,
  GOLDEN_R4_TEXT,
} from './cutPlanPtxGoldenR4';
import { PTX_ADAPTER_INDUSTRIAL_CONTRACT, PTX_CANDIDATE_TITLE } from '../machines/ptxAdapter';
import { canonicalJson, sha256Hex } from '../machines/digest';

const LAB_TEXT_OPTIONS = { decimalPlaces: 1 } as const;

function labDoc(): PtxDocument {
  return buildLabGuillotineDocument();
}

function labDocWith(mutate: (doc: PtxDocument) => void): PtxDocument {
  const doc = labDoc();
  mutate(doc);
  return doc;
}

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

function compileError(fn: () => unknown): PtxCompilationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PtxCompilationError) return error;
    throw error;
  }
  throw new Error('se esperaba PtxCompilationError');
}

function captureParseErrorText(fn: () => unknown): PtxParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PtxParseError) return error;
    throw error;
  }
  throw new Error('se esperaba PtxParseError');
}

// ---------------------------------------------------------------------------
// Catálogo: cada límite con clasificación y localizador de fuente primaria
// ---------------------------------------------------------------------------

describe('#788 catálogo documentado de límites', () => {
  it('cada límite es SPEC_REQUIRED con localizador S03 (nada inventado)', () => {
    expect(PTX_SPEC_LIMITS.length).toBeGreaterThan(0);
    for (const limit of PTX_SPEC_LIMITS) {
      expect(limit.authority.classification).toBe('SPEC_REQUIRED');
      expect(limit.authority.locator).toMatch(/^S03 V11 Interface Guide §/);
      if (limit.kind === 'text-length') expect(limit.maxLength).toBeGreaterThan(0);
      if (limit.kind === 'int-range') expect(limit.min).toBeLessThan(limit.max);
      if (limit.kind === 'int-enum') expect(limit.values.length).toBeGreaterThan(0);
    }
  });

  it('los límites clave del hallazgo r4 están en el catálogo con su localizador', () => {
    const title = PTX_SPEC_LIMITS.find((limit) => limit.field === 'HEADER.TITLE');
    expect(title?.kind).toBe('text-length');
    expect(title?.kind === 'text-length' && title.maxLength).toBe(25);
    expect(title?.authority.locator).toContain('25 chars max');
    const origin = PTX_SPEC_LIMITS.find((limit) => limit.field === 'HEADER.ORIGIN');
    expect(origin?.kind === 'int-enum' && origin.values).toEqual([0, 1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// HEADER (casos 1–6 de la matriz mínima)
// ---------------------------------------------------------------------------

describe('#788 HEADER — TITLE/VERSION/UNITS/ORIGIN/TRIM_TYPE', () => {
  it('TITLE de exactamente 25 caracteres PASA (límite documentado alcanzado, no superado)', () => {
    const doc = labDoc();
    expect(doc.header.title).toBe('GRANETE-LAB-NONPRODUCTION');
    expect(doc.header.title.length).toBe(25);
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
  });

  it('TITLE de 26 caracteres BLOQUEA con ptx_spec.header_title_too_long y contexto accionable', () => {
    const doc = labDocWith((d) => {
      (d.header as { title: string }).title = 'A'.repeat(26);
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.header_title_too_long']);
    expect(issues[0]!.field).toBe('HEADER.TITLE');
    expect(issues[0]!.observed).toBe(26);
    expect(issues[0]!.maximum).toBe(25);
    expect(issues[0]!.locator).toContain('§20 p.167');
    expect(issues[0]!.message).toContain('no se trunca');
  });

  it('REGRESIÓN r4: el HEADER industrial de 43 caracteres BLOQUEA específicamente por TITLE', () => {
    // Fixture equivalente al rechazado en campo: HEADER,1,GRANETE-PTX-CANDIDATE
    // NOT_MACHINE_VALIDATED,0,0,1 (43 chars). El defecto objetivo que ningún
    // candidato r5 puede volver a producir.
    expect(PTX_CANDIDATE_TITLE).toBe('GRANETE-PTX-CANDIDATE NOT_MACHINE_VALIDATED');
    expect(PTX_CANDIDATE_TITLE.length).toBe(43);
    const doc = labDocWith((d) => {
      (d.header as { title: string }).title = PTX_CANDIDATE_TITLE;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.header_title_too_long']);
    expect(issues[0]!.observed).toBe(43);
    expect(issues[0]!.maximum).toBe(25);
    expect(ptxSpecPreflightBytes(serializePtxDocumentBytes(doc, LAB_TEXT_OPTIONS)).map((i) => i.code)).toEqual([
      'ptx_spec.header_title_too_long',
    ]);
  });

  it('VERSION inválida (0 / NaN) BLOQUEA; el valor exacto NO se fija (ambigüedad documentada)', () => {
    for (const version of [0, Number.NaN]) {
      const doc = labDocWith((d) => {
        (d.header as { version: number }).version = version;
      });
      const issues = ptxSpecPreflightDocument(doc);
      expect(issues.some((i) => i.code === 'ptx_spec.header_version_invalid')).toBe(true);
    }
  });

  it('UNITS fuera del diccionario BLOQUEA con ptx_spec.header_units_invalid', () => {
    const doc = labDocWith((d) => {
      (d.header as { units: number }).units = 2;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.header_units_invalid']);
    expect(issues[0]!.observed).toBe(2);
  });

  it('ORIGIN=4 BLOQUEA (rango documentado 0-3, no cualquier entero)', () => {
    const doc = labDocWith((d) => {
      (d.header as { origin: number }).origin = 4;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.header_origin_invalid']);
    expect(issues[0]!.locator).toContain('0-3');
  });

  it('ORIGIN 1..3 PASA (los cuatro cuadrantes documentados son legales)', () => {
    for (const origin of [0, 1, 2, 3]) {
      const doc = labDocWith((d) => {
        (d.header as { origin: number }).origin = origin;
      });
      expect(ptxSpecPreflightDocument(doc)).toEqual([]);
    }
  });

  it('TRIM_TYPE=2 BLOQUEA con ptx_spec.header_trim_type_invalid', () => {
    const doc = labDocWith((d) => {
      (d.header as { trimType: number }).trimType = 2;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toEqual(['ptx_spec.header_trim_type_invalid']);
  });
});

// ---------------------------------------------------------------------------
// Identidades e índices (casos 7–13)
// ---------------------------------------------------------------------------

describe('#788 índices y referencias por job', () => {
  it('PART_INDEX duplicado BLOQUEA con ptx_spec.index_duplicate', () => {
    const doc = labDocWith((d) => {
      const parts = d.records.filter((r) => r.type === 'PARTS_REQ');
      (parts[1] as { partIndex: number }).partIndex = 1;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toContain('ptx_spec.index_duplicate');
  });

  it('salto ilegal de índice BLOQUEA con ptx_spec.index_not_consecutive', () => {
    const doc = labDocWith((d) => {
      const parts = d.records.filter((r) => r.type === 'PARTS_REQ');
      (parts[1] as { partIndex: number }).partIndex = 3;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toContain('ptx_spec.index_not_consecutive');
  });

  it('índice fuera del rango documentado BLOQUEA (PART_INDEX 10000 > 9999)', () => {
    const doc = labDocWith((d) => {
      const parts = d.records.filter((r) => r.type === 'PARTS_REQ');
      (parts[1] as { partIndex: number }).partIndex = 10000;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toContain('ptx_spec.index_out_of_range');
  });

  it('referencia a PART inexistente BLOQUEA', () => {
    const doc = labDocWith((d) => {
      const cut = d.records.find((r) => r.type === 'CUTS' && r.partReference.kind === 'part');
      (cut as { partReference: PtxPartReference }).partReference = { kind: 'part', partIndex: 99 };
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toContain('ptx_spec.reference_unknown');
    expect(issues.some((i) => i.message.includes('PART_INDEX=99'))).toBe(true);
  });

  it('referencia a BOARD inexistente BLOQUEA', () => {
    const doc = labDocWith((d) => {
      const pattern = d.records.find((r) => r.type === 'PATTERNS');
      (pattern as { boardIndex: number }).boardIndex = 7;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toContain('ptx_spec.reference_unknown');
  });

  it('referencia a MATERIAL inexistente BLOQUEA', () => {
    const doc = labDocWith((d) => {
      const part = d.records.find((r) => r.type === 'PARTS_REQ');
      (part as { materialIndex: number }).materialIndex = 9;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toContain('ptx_spec.reference_unknown');
  });

  it('referencia a PATTERN inexistente BLOQUEA', () => {
    const doc = labDocWith((d) => {
      const cut = d.records.find((r) => r.type === 'CUTS');
      (cut as { patternIndex: number }).patternIndex = 5;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toContain('ptx_spec.reference_unknown');
  });

  it('referencia Xn a OFFCUTS inexistente BLOQUEA', () => {
    const doc = labDocWith((d) => {
      const cut = d.records.find((r) => r.type === 'CUTS');
      (cut as { partReference: unknown }).partReference = { kind: 'offcut', offcutIndex: 9 };
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toContain('ptx_spec.reference_unknown');
    expect(issues.some((i) => i.message.includes('X9'))).toBe(true);
  });

  it('JOB_INDEX sin fila JOBS BLOQUEA (toda fila pertenece a un job declarado)', () => {
    const doc = labDocWith((d) => {
      const part = d.records.find((r) => r.type === 'PARTS_REQ');
      (part as { jobIndex: number }).jobIndex = 2;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toContain('ptx_spec.reference_unknown');
  });
});

// ---------------------------------------------------------------------------
// Límites de campos textuales documentados
// ---------------------------------------------------------------------------

describe('#788 límites textuales documentados (códigos/comments/fields)', () => {
  type TextCase = { readonly family: string; readonly apply: (records: readonly PtxRecord[]) => void; readonly field: string };
  const textCases: readonly TextCase[] = [
    {
      family: 'PARTS_REQ',
      field: 'PARTS_REQ.CODE',
      apply: (records) => {
        const part = records.find((r) => r.type === 'PARTS_REQ');
        (part as { code: string }).code = 'X'.repeat(51);
      },
    },
    {
      family: 'BOARDS',
      field: 'BOARDS.CODE',
      apply: (records) => {
        const board = records.find((r) => r.type === 'BOARDS');
        (board as { code: string }).code = 'X'.repeat(51);
      },
    },
    {
      family: 'MATERIALS',
      field: 'MATERIALS.CODE',
      apply: (records) => {
        const material = records.find((r) => r.type === 'MATERIALS');
        (material as { code: string }).code = 'X'.repeat(51);
      },
    },
    {
      family: 'MATERIALS',
      field: 'MATERIALS.DESC',
      apply: (records) => {
        const material = records.find((r) => r.type === 'MATERIALS');
        (material as { description: string }).description = 'X'.repeat(51);
      },
    },
    {
      family: 'OFFCUTS',
      field: 'OFFCUTS.CODE',
      apply: (records) => {
        const offcut = records.find((r) => r.type === 'OFFCUTS');
        (offcut as { code: string }).code = 'X'.repeat(51);
      },
    },
    {
      family: 'JOBS',
      field: 'JOBS.NAME',
      apply: (records) => {
        const job = records.find((r) => r.type === 'JOBS');
        (job as { name: string }).name = 'X'.repeat(51);
      },
    },
    {
      family: 'JOBS',
      field: 'JOBS.CUSTOMER',
      apply: (records) => {
        const job = records.find((r) => r.type === 'JOBS');
        (job as { customer: string }).customer = 'X'.repeat(101);
      },
    },
    {
      family: 'CUTS',
      field: 'CUTS.COMMENT',
      apply: (records) => {
        const cut = records.find((r) => r.type === 'CUTS');
        (cut as { comment: string }).comment = 'X'.repeat(101);
      },
    },
  ];
  for (const textCase of textCases) {
    it(`${textCase.field} sobre el máximo documentado BLOQUEA con ptx_spec.text_too_long`, () => {
      const doc = labDoc();
      textCase.apply(doc.records);
      const issues = ptxSpecPreflightDocument(doc);
      const hit = issues.find((i) => i.code === 'ptx_spec.text_too_long' && i.field === textCase.field);
      expect(hit).toBeDefined();
      expect(hit!.locator).toMatch(/^S03 V11 Interface Guide §20 p\.1(67|68|73|75|78)/);
    });
  }

  it('códigos de exactamente 50 caracteres PASAN (límite alcanzado)', () => {
    const doc = labDoc();
    const part = doc.records.find((r) => r.type === 'PARTS_REQ');
    (part as { code: string }).code = 'X'.repeat(50);
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rangos DIM/QTY del diccionario (§20 p.166) — revisión independiente #788
// ---------------------------------------------------------------------------

describe('#788 rangos DIM del diccionario (units-aware)', () => {
  const boardOf = (length: number, width: number) => (d: PtxDocument) => {
    const board = d.records.find((r) => r.type === 'BOARDS');
    (board as { length: number; width: number }).length = length;
    (board as { length: number; width: number }).width = width;
  };

  it('DIM métrico 9999.9 PASA (frontera superior documentada)', () => {
    const doc = labDocWith(boardOf(9999.9, 9999.9));
    expect(doc.header.units).toBe(0);
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
  });

  it('DIM métrico 10000 BLOQUEA con ptx_spec.dimension_out_of_range', () => {
    const doc = labDocWith(boardOf(10000, 700));
    const issues = ptxSpecPreflightDocument(doc);
    const hits = issues.filter((i) => i.code === 'ptx_spec.dimension_out_of_range');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.field).toBe('BOARDS.LENGTH');
    expect(hits[0]!.observed).toBe(10000);
    expect(hits[0]!.maximum).toBe(9999.9);
    expect(hits[0]!.locator).toContain('0.0 to 9999.9');
  });

  it('DIM en pulgadas decimales 999.9 PASA / 1000 BLOQUEA (según HEADER.UNITS=1)', () => {
    const ok = labDocWith((d) => {
      (d.header as { units: number }).units = 1;
    });
    // El lab usa mm: 1200x700 > 999.9 en modo pulgadas → BLOQUEA primero.
    expect(
      ptxSpecPreflightDocument(ok).some((i) => i.code === 'ptx_spec.dimension_out_of_range'),
    ).toBe(true);

    const boundary = labDocWith((d) => {
      (d.header as { units: number }).units = 1;
      const board = d.records.find((r) => r.type === 'BOARDS');
      (board as { length: number; width: number }).length = 999.9;
      (board as { length: number; width: number }).width = 99.9;
      const material = d.records.find((r) => r.type === 'MATERIALS');
      (material as { thickness: number }).thickness = 0.75;
      (material as { kerfRip: number }).kerfRip = 0.17;
      (material as { kerfCrosscut: number }).kerfCrosscut = 0.17;
      for (const trim of ['trimFRip', 'trimVRip', 'trimFXct', 'trimVXct', 'trimHead', 'trimFRct', 'trimVRct'] as const) {
        (material as unknown as Record<string, number>)[trim] = 0.39;
      }
      const offcut = d.records.find((r) => r.type === 'OFFCUTS');
      if (offcut) {
        (offcut as { length: number; width: number }).length = 999.9;
        (offcut as { length: number; width: number }).width = 99.9;
      }
    });
    expect(ptxSpecPreflightDocument(boundary)).toEqual([]);

    const over = labDocWith((d) => {
      (d.header as { units: number }).units = 1;
      const board = d.records.find((r) => r.type === 'BOARDS');
      (board as { length: number; width: number }).length = 1000;
      (board as { length: number; width: number }).width = 99.9;
      const material = d.records.find((r) => r.type === 'MATERIALS');
      (material as { thickness: number }).thickness = 0.75;
      (material as { kerfRip: number }).kerfRip = 0.17;
      (material as { kerfCrosscut: number }).kerfCrosscut = 0.17;
      for (const trim of ['trimFRip', 'trimVRip', 'trimFXct', 'trimVXct', 'trimHead', 'trimFRct', 'trimVRct'] as const) {
        (material as unknown as Record<string, number>)[trim] = 0.39;
      }
      const offcut = d.records.find((r) => r.type === 'OFFCUTS');
      if (offcut) {
        (offcut as { length: number; width: number }).length = 999.9;
        (offcut as { length: number; width: number }).width = 99.9;
      }
    });
    const hits = ptxSpecPreflightDocument(over).filter((i) => i.code === 'ptx_spec.dimension_out_of_range');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.observed).toBe(1000);
    expect(hits[0]!.maximum).toBe(999.9);
  });

  it('DIM negativo BLOQUEA (el piso documentado del tipo es 0.0; los mínimos semánticos >0 quedan en producto)', () => {
    const doc = labDocWith((d) => {
      const cut = d.records.find((r) => r.type === 'CUTS');
      (cut as { dimension: number }).dimension = -1;
    });
    const hits = ptxSpecPreflightDocument(doc).filter((i) => i.code === 'ptx_spec.dimension_out_of_range');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.field).toBe('CUTS.DIMENSION');
    expect(hits[0]!.minimum).toBe(0);
  });

  it('DIM fuera de rango en BYTES mutados post-serialización es detectado', () => {
    const base = serializePtxDocument(labDoc(), LAB_TEXT_OPTIONS);
    expect(base).toContain('BOARDS,1,1,BOARD_LAB,1,1200,700,1,1');
    const mutated = base.replace('BOARDS,1,1,BOARD_LAB,1,1200,700,1,1', 'BOARDS,1,1,BOARD_LAB,1,10000,700,1,1');
    const issues = ptxSpecPreflightBytes(new TextEncoder().encode(mutated));
    expect(codes(issues)).toContain('ptx_spec.dimension_out_of_range');
    expect(issues.find((i) => i.code === 'ptx_spec.dimension_out_of_range')!.observed).toBe(10000);
  });
});

describe('#788 máximo QTY del diccionario (99999)', () => {
  it('QTY 99999 PASA (frontera superior documentada)', () => {
    const doc = labDocWith((d) => {
      const part = d.records.find((r) => r.type === 'PARTS_REQ');
      (part as { requiredQuantity: number }).requiredQuantity = 99999;
    });
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
  });

  it('QTY 100000 BLOQUEA con ptx_spec.quantity_out_of_range', () => {
    const doc = labDocWith((d) => {
      const part = d.records.find((r) => r.type === 'PARTS_REQ');
      (part as { requiredQuantity: number }).requiredQuantity = 100000;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.quantity_out_of_range']);
    expect(issues[0]!.field).toBe('PARTS_REQ.QTY_REQ');
    expect(issues[0]!.observed).toBe(100000);
    expect(issues[0]!.maximum).toBe(99999);
    expect(issues[0]!.locator).toContain('No quantity can be greater than 99999');
  });

  it('QTY decimal BLOQUEA como spec: ptx_spec.quantity_not_integer (LONG INTEGER documentado)', () => {
    const doc = labDocWith((d) => {
      const part = d.records.find((r) => r.type === 'PARTS_REQ');
      (part as { requiredQuantity: number }).requiredQuantity = 1.5;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.quantity_not_integer']);
    expect(issues[0]!.field).toBe('PARTS_REQ.QTY_REQ');
    expect(issues[0]!.locator).toContain('long integer');
    // En bytes el lector ya lo rechaza (INVALID_INTEGER → parse_error).
    const bytes = serializePtxDocument(labDoc(), LAB_TEXT_OPTIONS).replace(
      'PARTS_REQ,1,1,PART_A,1,450,320,1,0,0,0,1',
      'PARTS_REQ,1,1,PART_A,1,450,320,1.5,0,0,0,1',
    );
    expect(codes(ptxSpecPreflightBytes(new TextEncoder().encode(bytes)))).toEqual(['ptx_spec.parse_error']);
  });

  it('campos QTY modelados cubiertos: BOOK / OFC_QTY / QTY_RUN / QTY_CYCLES / MAX_BOOK / QTY_RPT / QTY_PARTS / QTY_STOCK', () => {
    const doc = labDocWith((d) => {
      const material = d.records.find((r) => r.type === 'MATERIALS');
      (material as { bookQuantity: number }).bookQuantity = 100000;
      const offcut = d.records.find((r) => r.type === 'OFFCUTS');
      (offcut as { producedQuantity?: number }).producedQuantity = 100000;
      const pattern = d.records.find((r) => r.type === 'PATTERNS');
      (pattern as { runQuantity?: number }).runQuantity = 100000;
      (pattern as { cyclesQuantity?: number }).cyclesQuantity = 100000;
      (pattern as { maxBook?: number }).maxBook = 100000;
      const cut = d.records.find((r) => r.type === 'CUTS');
      (cut as { repeatQuantity: number }).repeatQuantity = 100000;
      const board = d.records.find((r) => r.type === 'BOARDS');
      (board as { stockQuantity?: number }).stockQuantity = 100000;
    });
    const fields = ptxSpecPreflightDocument(doc)
      .filter((i) => i.code === 'ptx_spec.quantity_out_of_range')
      .map((i) => i.field);
    expect(new Set(fields)).toEqual(
      new Set([
        'MATERIALS.BOOK',
        'OFFCUTS.OFC_QTY',
        'PATTERNS.QTY_RUN',
        'PATTERNS.QTY_CYCLES',
        'PATTERNS.MAX_BOOK',
        'CUTS.QTY_RPT',
        'BOARDS.QTY_STOCK',
      ]),
    );
  });

  it('QTY fuera de rango en BYTES mutados post-serialización es detectado', () => {
    const base = serializePtxDocument(labDoc(), LAB_TEXT_OPTIONS);
    const mutated = base.replace(
      /PARTS_REQ,1,1,PART_A,1,450,320,1,0,0,0,1/,
      'PARTS_REQ,1,1,PART_A,1,450,320,100000,0,0,0,1',
    );
    expect(mutated).not.toBe(base);
    const issues = ptxSpecPreflightBytes(new TextEncoder().encode(mutated));
    expect(codes(issues)).toContain('ptx_spec.quantity_out_of_range');
  });
});

// ---------------------------------------------------------------------------
// Enums/ranges documentados de campos ya modelados (revisión #788)
// ---------------------------------------------------------------------------

describe('#788 enums y rangos documentados de campos modelados', () => {
  it('MATERIALS.RULE1=10 BLOQUEA (documentado INT 1-9)', () => {
    const doc = labDocWith((d) => {
      const material = d.records.find((r) => r.type === 'MATERIALS');
      (material as { rule1?: number }).rule1 = 10;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.index_out_of_range']);
    expect(issues[0]!.field).toBe('MATERIALS.RULE1');
    expect(issues[0]!.locator).toContain('INT 1-9');
  });

  it('MATERIALS.RULE2=2 BLOQUEA (documentado INT 0,1)', () => {
    const doc = labDocWith((d) => {
      const material = d.records.find((r) => r.type === 'MATERIALS');
      (material as { rule2?: number }).rule2 = 2;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toEqual(['ptx_spec.enum_value_invalid']);
  });

  it('PARTS_REQ.GRAIN=3 BLOQUEA como spec (documentado INT 0,1,2)', () => {
    const doc = labDocWith((d) => {
      const part = d.records.find((r) => r.type === 'PARTS_REQ');
      (part as { grain: number }).grain = 3;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.enum_value_invalid']);
    expect(issues[0]!.field).toBe('PARTS_REQ.GRAIN');
  });

  it('JOBS.STATUS: 0/1/2 válidos; OTRO entero NO es spec-invalid (conocidos, no exhaustivos)', () => {
    // §5 p.120: "0 - not optimised 1 - optimised 2 - optimise failed Note:
    // there may be a range of other error codes" — la capa SPEC sólo exige
    // la forma INT; restringir otros enteros es política PRODUCT/RECEIVER.
    for (const status of [0, 1, 2, 4, 17]) {
      const doc = labDocWith((d) => {
        const job = d.records.find((r) => r.type === 'JOBS');
        (job as { status?: number }).status = status;
      });
      expect(ptxSpecPreflightDocument(doc), `status=${status}`).toEqual([]);
    }
  });

  it('JOBS.STATUS decimal BLOQUEA como spec (INT form): ptx_spec.int_not_integer', () => {
    const doc = labDocWith((d) => {
      const job = d.records.find((r) => r.type === 'JOBS');
      (job as { status?: number }).status = 1.5;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.int_not_integer']);
    expect(issues[0]!.field).toBe('JOBS.STATUS');
    expect(issues[0]!.locator).toContain('there may be a range of other error codes');
    // En bytes, el lector ya rechaza el decimal (INVALID_INTEGER → parse_error).
    const bytes = serializePtxDocument(labDoc(), LAB_TEXT_OPTIONS).replace(
      'JOBS,1,C4D001,EXAMPLE ONLY,10/09/2026,,LAB,1,',
      'JOBS,1,C4D001,EXAMPLE ONLY,10/09/2026,,LAB,1.5,',
    );
    expect(bytes).toContain('LAB,1.5,');
    expect(codes(ptxSpecPreflightBytes(new TextEncoder().encode(bytes)))).toEqual(['ptx_spec.parse_error']);
  });

  it('JOBS.CUT_TIME entero PASA; decimal BLOQUEA como spec (INT, segundos)', () => {
    const ok = labDocWith((d) => {
      const job = d.records.find((r) => r.type === 'JOBS');
      (job as { cutTime?: number }).cutTime = 821;
    });
    expect(ptxSpecPreflightDocument(ok)).toEqual([]);

    const doc = labDocWith((d) => {
      const job = d.records.find((r) => r.type === 'JOBS');
      (job as { cutTime?: number }).cutTime = 1.5;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.int_not_integer']);
    expect(issues[0]!.field).toBe('JOBS.CUT_TIME');
    // Contrato de REPRESENTACIÓN entero end-to-end: el parser rechaza el
    // decimal en bytes y el serializer no puede emitirlo (fail closed).
    const parseError = captureParseErrorText(() =>
      parsePtxDocumentText('HEADER,1,LAB,0,0,1\r\nJOBS,1,X,,,,,,,,1.5\r\n'),
    );
    expect(parseError.code).toBe('INVALID_INTEGER');
    expect(parseError.message).toContain('CUT_TIME');
    let serialized: string | undefined;
    try {
      serialized = serializePtxDocument(doc, LAB_TEXT_OPTIONS);
    } catch (error) {
      expect((error as Error).name).toBe('PtxFormatError');
    }
    expect(serialized).toBeUndefined();
  });

  it('CUTS.SEQUENCE decimal BLOQUEA en el spec preflight SIN depender de validate.ts', () => {
    const doc = labDocWith((d) => {
      const cut = d.records.find((r) => r.type === 'CUTS');
      (cut as { sequence: number }).sequence = 1.5;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.int_not_integer']);
    expect(issues[0]!.field).toBe('CUTS.SEQUENCE');
    expect(issues[0]!.locator).toContain('Cut sequence INT');
  });

  it('CUTS.FUNCTION=81 BLOQUEA como spec (diccionario 0-9 / 90-99)', () => {
    const doc = labDocWith((d) => {
      const cut = d.records.find((r) => r.type === 'CUTS');
      (cut as { functionCode: number }).functionCode = 81;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.function_code_invalid']);
    expect(issues[0]!.locator).toContain('0-9, 90-99');
  });

  it('CUTS.FUNCTION=4 NO es issue del spec preflight (SPEC_VALID_BUT_PRODUCT_UNSUPPORTED — dueño: validate.ts)', () => {
    const doc = labDocWith((d) => {
      const cut = d.records.find((r) => r.type === 'CUTS');
      (cut as { functionCode: number }).functionCode = 4;
    });
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
    // El lado producto sí lo rechaza (clasificación separada, sin confluencia):
    expect(validatePtxDocument(doc).some((i) => i.code === 'UNSUPPORTED_FUNCTION_CODE')).toBe(true);
  });

  it('PATTERNS.TYPE=9 BLOQUEA como spec (documentado INT 0-8)', () => {
    const doc = labDocWith((d) => {
      const pattern = d.records.find((r) => r.type === 'PATTERNS');
      (pattern as { patternType: number }).patternType = 9;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.index_out_of_range']);
    expect(issues[0]!.field).toBe('PATTERNS.TYPE');
    expect(issues[0]!.locator).toContain('INT 0-8');
  });

  it('PATTERNS.TYPE=6 NO es issue del spec preflight (template 5..8 = Pattern Exchange válido, no soportado por producto)', () => {
    const doc = labDocWith((d) => {
      const pattern = d.records.find((r) => r.type === 'PATTERNS');
      (pattern as { patternType: number }).patternType = 6;
    });
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
    expect(validatePtxDocument(doc).some((i) => i.code === 'INVALID_ENUM_VALUE')).toBe(true);
  });

  it('el lector representa el dominio documentado 0..8: TYPE=6 se lee; TYPE=9 es lo único inválido', () => {
    // El READING model lleva 0..8 (§20 p.175): el parser ya NO rechaza 5..8 —
    // la separación SPEC/PRODUCT también vale en bytes (ver bloque siguiente).
    const parsed = parsePtxDocumentText('HEADER,1,LAB,0,0,1\r\nPATTERNS,1,1,1,6\r\n');
    expect(parsed.records[0]).toMatchObject({ type: 'PATTERNS', patternType: 6 });
    const specInvalid = captureParseErrorText(() =>
      parsePtxDocumentText('HEADER,1,LAB,0,0,1\r\nPATTERNS,1,1,1,9\r\n'),
    );
    expect(specInvalid.message).toContain('outside the documented Pattern Exchange range 0-8');
  });
});

// ---------------------------------------------------------------------------
// SPEC vs PRODUCT en BYTES (revisión r3: la frontera de bytes debe poder
// observar valores documentados no soportados sin clasificarlos spec-error)
// ---------------------------------------------------------------------------

describe('#788 SPEC vs PRODUCT también en bytes (PATTERNS.TYPE)', () => {
  const bytesWithType = (type: number): Uint8Array =>
    new TextEncoder().encode(
      serializePtxDocument(labDoc(), LAB_TEXT_OPTIONS).replace(
        'PATTERNS,1,1,1,0,1,1,1',
        `PATTERNS,1,1,1,${type},1,1,1`,
      ),
    );

  it('bytes con TYPE=6: SIN spec issue y clasificación SPEC_VALID_BUT_PRODUCT_UNSUPPORTED', () => {
    const bytes = bytesWithType(6);
    expect(new TextDecoder().decode(bytes)).toContain('PATTERNS,1,1,1,6,1,1,1');
    expect(ptxSpecPreflightBytes(bytes)).toEqual([]);
    const parsed = parsePtxDocumentBytes(bytes);
    const pattern = parsed.records.find((r): r is Extract<typeof r, { type: 'PATTERNS' }> => r.type === 'PATTERNS');
    expect(pattern).toMatchObject({ patternType: 6 });
    expect(classifyPtxDocumentedEnumSupport('PATTERNS.TYPE', pattern!.patternType)).toBe(
      'SPEC_VALID_BUT_PRODUCT_UNSUPPORTED',
    );
  });

  it('bytes con TYPE=6: el PRODUCTO sigue fail-closed (validate rechaza; serialize no entrega bytes)', () => {
    const parsed = parsePtxDocumentBytes(bytesWithType(6));
    expect(validatePtxDocument(parsed).some((i) => i.code === 'INVALID_ENUM_VALUE')).toBe(true);
    let serialized: unknown;
    try {
      serialized = serializePtxDocument(parsed, LAB_TEXT_OPTIONS);
    } catch (error) {
      expect((error as Error).name).toBe('PtxDocumentInvalidError');
    }
    expect(serialized).toBeUndefined();
    // El compiler productivo no gana capacidad: el subset histórico intacto.
    expect(Object.values(PTX_PATTERN_TYPE)).toEqual([0, 1, 2, 3, 4]);
  });

  it('bytes con TYPE=9: SPEC_INVALID (parse_error con el rango documentado 0-8)', () => {
    const issues = ptxSpecPreflightBytes(bytesWithType(9));
    expect(codes(issues)).toEqual(['ptx_spec.parse_error']);
    expect(issues[0]!.message).toContain('outside the documented Pattern Exchange range 0-8');
    expect(issues[0]!.classification).toBe('SPEC_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// Taxonomía SPEC vs PRODUCT (revisión #788 — sin habilitar capacidades)
// ---------------------------------------------------------------------------

describe('#788 taxonomía SPEC_INVALID / SPEC_VALID_BUT_PRODUCT_UNSUPPORTED / PRODUCT_SUPPORTED', () => {
  it('CUTS.FUNCTION: 81 SPEC_INVALID · 4/90/93 SPEC_VALID_BUT_PRODUCT_UNSUPPORTED · 0/1/2/3/92 PRODUCT_SUPPORTED', () => {
    expect(classifyPtxDocumentedEnumSupport('CUTS.FUNCTION', 81)).toBe('SPEC_INVALID');
    expect(classifyPtxDocumentedEnumSupport('CUTS.FUNCTION', -1)).toBe('SPEC_INVALID');
    for (const code of [4, 5, 9, 90, 91, 93, 99]) {
      expect(classifyPtxDocumentedEnumSupport('CUTS.FUNCTION', code)).toBe('SPEC_VALID_BUT_PRODUCT_UNSUPPORTED');
    }
    for (const code of [0, 1, 2, 3, 92]) {
      expect(classifyPtxDocumentedEnumSupport('CUTS.FUNCTION', code)).toBe('PRODUCT_SUPPORTED');
    }
  });

  it('PATTERNS.TYPE: 9 SPEC_INVALID · 5..8 SPEC_VALID_BUT_PRODUCT_UNSUPPORTED · 0..4 PRODUCT_SUPPORTED', () => {
    expect(classifyPtxDocumentedEnumSupport('PATTERNS.TYPE', 9)).toBe('SPEC_INVALID');
    expect(classifyPtxDocumentedEnumSupport('PATTERNS.TYPE', -1)).toBe('SPEC_INVALID');
    for (const code of [5, 6, 7, 8]) {
      expect(classifyPtxDocumentedEnumSupport('PATTERNS.TYPE', code)).toBe('SPEC_VALID_BUT_PRODUCT_UNSUPPORTED');
    }
    for (const code of [0, 1, 2, 3, 4]) {
      expect(classifyPtxDocumentedEnumSupport('PATTERNS.TYPE', code)).toBe('PRODUCT_SUPPORTED');
    }
  });

  it('la clasificación no habilita producción: el compiler sigue sin emitir 5..8 ni 4..9', () => {
    // El subset productivo sigue siendo el const histórico de records.ts.
    expect(Object.values(PTX_PATTERN_TYPE)).toEqual([0, 1, 2, 3, 4]);
    expect([...PTX_SUPPORTED_CUT_FUNCTION_CODES]).toEqual([0, 1, 2, 3, 92]);
  });
});

// ---------------------------------------------------------------------------
// JOBS opcional bajo la especificación (§5 p.120) — revisión #788
// ---------------------------------------------------------------------------

describe('#788 JOBS es opcional bajo la especificación (no bajo la política Granete)', () => {
  const noJobsText = [
    'HEADER,1,LAB,0,0,1',
    'MATERIALS,1,1,MDF18,Desc,18,1,4,4',
    'BOARDS,1,1,B1,1,1200,700',
    'PATTERNS,1,1,1,0',
    'CUTS,1,1,1,1,1,320.0,1,0',
  ].join('\r\n') + '\r\n';

  it('sin filas JOBS y UN único job implícito: SPEC-válido (semántica documentada §5 p.120)', () => {
    const doc = parsePtxDocumentText(noJobsText);
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
  });

  it('sin filas JOBS y DOS JOB_INDEX distintos: fail closed (job_scope_ambiguous, no inventado)', () => {
    const two = noJobsText.replace('BOARDS,1,1,B1,1,1200,700', 'BOARDS,2,1,B1,1,1200,700');
    const doc = parsePtxDocumentText(two);
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toContain('ptx_spec.job_scope_ambiguous');
    expect(issues.find((i) => i.code === 'ptx_spec.job_scope_ambiguous')!.locator).toContain('§5 p.120');
  });

  it('CON filas JOBS la referencia sigue siendo obligatoria (comportamiento anterior conservado)', () => {
    const doc = labDocWith((d) => {
      const part = d.records.find((r) => r.type === 'PARTS_REQ');
      (part as { jobIndex: number }).jobIndex = 2;
    });
    expect(codes(ptxSpecPreflightDocument(doc))).toContain('ptx_spec.reference_unknown');
  });

  it('la política de PRODUCTO no se debilita: el compiler de Granete sigue emitiendo su fila JOBS explícita', () => {
    const planR4 = optimizeCutPlan(GOLDEN_R4_PROJECT_ID, GOLDEN_R4_ROWS, GOLDEN_R4_MATERIALS, GOLDEN_R4_CONFIG);
    const compiled = compileCutPlanToPtxDocument(planR4, GOLDEN_R4_OPTIONS);
    expect(compiled.document.records.filter((r) => r.type === 'JOBS')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// VERSION: forma comprobable, valor exacto UNKNOWN (revisión #788)
// ---------------------------------------------------------------------------

describe('#788 VERSION — sólo la forma es spec; el valor exacto es UNKNOWN hasta receiver profile', () => {
  it('las formas documentadas 1 / 1.06 / 1.08 PASAN (ningún pin arbitrario)', () => {
    for (const version of [1, 1.06, 1.08]) {
      const doc = labDocWith((d) => {
        (d.header as { version: number }).version = version;
      });
      expect(ptxSpecPreflightDocument(doc), `version=${version}`).toEqual([]);
    }
  });

  it('el issue de VERSION describe la forma y la ambigüedad documentada, no un valor "verificado"', () => {
    const doc = labDocWith((d) => {
      (d.header as { version: number }).version = 0;
    });
    const issues = ptxSpecPreflightDocument(doc);
    expect(codes(issues)).toEqual(['ptx_spec.header_version_invalid']);
    expect(issues[0]!.message).toContain('ambiguo');
    expect(issues[0]!.message).not.toContain('verificado');
  });
});

// ---------------------------------------------------------------------------
// Shapes: prefijo requerido / trailing opcional omitido (casos 14–15)
// ---------------------------------------------------------------------------

describe('#788 shape de registros — prefijo requerido y trailing opcional', () => {
  it('required prefix incompleto BLOQUEA en la frontera de bytes con ptx_spec.parse_error', () => {
    const broken = 'HEADER,1,LAB,0,0,1\r\nCUTS,1,1,1\r\n';
    const issues = ptxSpecPreflightBytes(new TextEncoder().encode(broken));
    expect(codes(issues)).toEqual(['ptx_spec.parse_error']);
    expect(issues[0]!.message).toContain('needs at least 8 column(s)');
  });

  it('trailing optional fields omitidos válidamente PASAN (CUTS con prefijo de 8 celdas)', () => {
    const doc = parsePtxDocumentBytes(
      new TextEncoder().encode(
        [
          'HEADER,1,LAB,0,0,1',
          'JOBS,1,LABJOB',
          'MATERIALS,1,1,MDF18,Desc,18,1,4,4',
          'BOARDS,1,1,B1,1,1200,700',
          'PATTERNS,1,1,1,0',
          'CUTS,1,1,1,1,1,320.0,1,0',
        ].join('\r\n') + '\r\n',
      ),
    );
    expect(ptxSpecPreflightDocument(doc)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frontera writer/validator: bytes + mutaciones (caso 19)
// ---------------------------------------------------------------------------

describe('#788 independencia writer/validator — detección sobre los bytes', () => {
  it('bytes válidos del lab document PASAN el preflight de bytes', () => {
    const bytes = serializePtxDocumentBytes(labDoc(), LAB_TEXT_OPTIONS);
    expect(ptxSpecPreflightBytes(bytes)).toEqual([]);
  });

  it('serializePtxDocumentBytesSpecChecked entrega los mismos bytes cuando el preflight PASA', () => {
    const bytes = serializePtxDocumentBytesSpecChecked(labDoc(), LAB_TEXT_OPTIONS);
    expect(bytes).toEqual(serializePtxDocumentBytes(labDoc(), LAB_TEXT_OPTIONS));
  });

  it('serializePtxDocumentBytesSpecChecked BLOQUEA (sin bytes) un TITLE de 26', () => {
    const doc = labDocWith((d) => {
      (d.header as { title: string }).title = 'GRANETE-LAB-NONPRODUCTION-26';
    });
    let threw: PtxSpecPreflightError | undefined;
    try {
      serializePtxDocumentBytesSpecChecked(doc, LAB_TEXT_OPTIONS);
    } catch (error) {
      if (error instanceof PtxSpecPreflightError) threw = error;
      else throw error;
    }
    expect(threw).toBeDefined();
    expect(threw!.issues.map((i) => i.code)).toEqual(['ptx_spec.header_title_too_long']);
  });

  it('mutación de bytes post-serialization es detectada (un serializer que escribe otro TITLE)', () => {
    // Independencia real: el document modelo es válido; los BYTES fueron
    // alterados después (equivalente a un bug del serializer). El preflight
    // lee los bytes con el parser independiente y BLOQUEA.
    const text = serializePtxDocument(labDoc(), LAB_TEXT_OPTIONS);
    expect(text).toContain('GRANETE-LAB-NONPRODUCTION');
    const mutated = text.replace('GRANETE-LAB-NONPRODUCTION', PTX_CANDIDATE_TITLE);
    expect(mutated).not.toBe(text);
    const issues = ptxSpecPreflightBytes(new TextEncoder().encode(mutated));
    expect(codes(issues)).toEqual(['ptx_spec.header_title_too_long']);
    expect(issues[0]!.observed).toBe(43);
  });

  it('mutaciones de bytes sobre enums/índices/referencias son detectadas', () => {
    const base = serializePtxDocument(labDoc(), LAB_TEXT_OPTIONS);
    const headerLine = (line: string): string => line; // readability anchor
    const mutations: readonly { readonly name: string; readonly mutate: (text: string) => string; readonly expectCode: string }[] = [
      {
        // UNITS/TRIM_TYPE fuera de {0,1} los bloquea el LECTOR en parse
        // (enum documentada en el propio parser): el preflight lo reporta
        // como parse_error — el fallo sigue siendo fail-closed en bytes.
        name: 'UNITS=9',
        mutate: (text) => text.replace('GRANETE-LAB-NONPRODUCTION,0,0,1', 'GRANETE-LAB-NONPRODUCTION,9,0,1'),
        expectCode: 'ptx_spec.parse_error',
      },
      {
        name: 'ORIGIN=4', // el parser acepta cualquier entero ≥ 0: lo bloquea el límite 0-3 del spec
        mutate: (text) => text.replace('GRANETE-LAB-NONPRODUCTION,0,0,1', 'GRANETE-LAB-NONPRODUCTION,0,4,1'),
        expectCode: 'ptx_spec.header_origin_invalid',
      },
      {
        name: 'TRIM_TYPE=7',
        mutate: (text) => text.replace('GRANETE-LAB-NONPRODUCTION,0,0,1', 'GRANETE-LAB-NONPRODUCTION,0,0,7'),
        expectCode: 'ptx_spec.parse_error',
      },
      {
        name: 'VERSION=0',
        mutate: (text) => text.replace('HEADER,1,', 'HEADER,0,'),
        expectCode: 'ptx_spec.header_version_invalid',
      },
      {
        // El lab doc tiene 2 piezas: eliminar la fila 2 deja {1} (todavía
        // consecutivo) pero su referencia CUTS queda colgando — la fila
        // borrada se detecta por la referencia, no por un hueco.
        name: 'fila PARTS_REQ eliminada',
        mutate: (text) => text.replace(/PARTS_REQ,1,2,[^\r\n]*\r\n/, ''),
        expectCode: 'ptx_spec.reference_unknown',
      },
      {
        name: 'salto de índice (part 2 → 3)',
        mutate: (text) => text.replace('PARTS_REQ,1,2,PART_B,', 'PARTS_REQ,1,3,PART_B,'),
        expectCode: 'ptx_spec.index_not_consecutive',
      },
      {
        name: 'referencia a pieza inexistente',
        mutate: (text) => text.replace('CUTS,1,1,2,2,2,450,1,1,1,CUT_B', 'CUTS,1,1,2,2,2,450,1,9,1,CUT_B'),
        expectCode: 'ptx_spec.reference_unknown',
      },
      {
        name: 'código de pieza de 60 chars',
        mutate: (text) => text.replace('PARTS_REQ,1,1,PART_A,', `PARTS_REQ,1,1,${'X'.repeat(60)},`),
        expectCode: 'ptx_spec.text_too_long',
      },
      {
        name: 'HEADER corrupto (prefijo corto)',
        mutate: (text) => text.replace('HEADER,1,GRANETE-LAB-NONPRODUCTION,0,0,1', 'HEADER,1,GRANETE-LAB-NONPRODUCTION,0'),
        expectCode: 'ptx_spec.parse_error',
      },
    ];
    for (const mutation of mutations) {
      const mutated = headerLine(mutation.mutate(base));
      expect(mutated, mutation.name).not.toBe(base);
      const issues = ptxSpecPreflightBytes(new TextEncoder().encode(mutated));
      expect(codes(issues), mutation.name).toContain(mutation.expectCode);
    }
  });
});

// ---------------------------------------------------------------------------
// Inmutabilidad histórica r2/r3/r4 (caso 20)
// ---------------------------------------------------------------------------

describe('#788 inmutabilidad histórica r2/r3/r4', () => {
  it('los bytes goldens r2/r3/r4 conservan sus sha256 exactos', async () => {
    expect(await sha256Hex(GOLDEN_TEXT)).toBe(PTX_ADAPTER_INDUSTRIAL_CONTRACT.profiles.r2.goldenBytesSha256);
    expect(await sha256Hex(GOLDEN_R3_TEXT)).toBe(PTX_ADAPTER_INDUSTRIAL_CONTRACT.profiles.r3.goldenBytesSha256);
    expect(await sha256Hex(GOLDEN_R4_TEXT)).toBe(PTX_ADAPTER_INDUSTRIAL_CONTRACT.profiles.r4.goldenBytesSha256);
  });

  it('el descriptor del adapter no cambió (digest canónico intacto)', async () => {
    // @granete/excel re-export guard: el contrato industrial sigue bindado.
    const { PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR, PTX_POSTPROCESSOR_ADAPTER } = await import('../machines/ptxAdapter');
    expect(await sha256Hex(canonicalJson(PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR))).toBe(
      PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
    );
    expect(PTX_ADAPTER_INDUSTRIAL_CONTRACT.implementationDigest).toBe(PTX_POSTPROCESSOR_ADAPTER.implementationDigest);
  });

  it('r2/r3/r4 recompilan sin la opción spec y producen sus bytes exactos', () => {
    const planR2 = optimizeCutPlan(GOLDEN_PROJECT_ID, GOLDEN_ROWS, GOLDEN_MATERIALS, GOLDEN_CONFIG);
    const bytesR2 = serializePtxDocumentBytes(
      compileCutPlanToPtxDocument(planR2, GOLDEN_OPTIONS).document,
      { decimalPlaces: GOLDEN_OPTIONS.decimalPlaces },
    );
    expect(new TextDecoder().decode(bytesR2)).toBe(GOLDEN_TEXT);

    // r3 REAL recompile (#788 review): same pipeline as r2/r4, byte-exact.
    const planR3 = optimizeCutPlan(GOLDEN_R3_PROJECT_ID, GOLDEN_R3_ROWS, GOLDEN_R3_MATERIALS, GOLDEN_R3_CONFIG);
    const bytesR3 = serializePtxDocumentBytes(
      compileCutPlanToPtxDocument(planR3, GOLDEN_R3_OPTIONS).document,
      { decimalPlaces: GOLDEN_R3_OPTIONS.decimalPlaces },
    );
    expect(new TextDecoder().decode(bytesR3)).toBe(GOLDEN_R3_TEXT);

    const planR4 = optimizeCutPlan(GOLDEN_R4_PROJECT_ID, GOLDEN_R4_ROWS, GOLDEN_R4_MATERIALS, GOLDEN_R4_CONFIG);
    const bytesR4 = serializePtxDocumentBytes(
      compileCutPlanToPtxDocument(planR4, GOLDEN_R4_OPTIONS).document,
      { decimalPlaces: GOLDEN_R4_OPTIONS.decimalPlaces },
    );
    expect(new TextDecoder().decode(bytesR4)).toBe(GOLDEN_R4_TEXT);
  });

  it('honestidad: los bytes históricos r2/r3/r4 VIOLAN el límite TITLE y el preflight lo reporta', () => {
    // r4 fue rechazado y queda congelado como evidencia: sus bytes siguen
    // siendo reproducibles (arriba) y el preflight nuevo documenta que ya no
    // son aceptables para un candidato r5. Sin truncados, sin reparación.
    for (const [name, text] of [
      ['r2', GOLDEN_TEXT],
      ['r3', GOLDEN_R3_TEXT],
      ['r4', GOLDEN_R4_TEXT],
    ] as const) {
      const issues = ptxSpecPreflightBytes(new TextEncoder().encode(text));
      expect(codes(issues), name).toEqual(['ptx_spec.header_title_too_long']);
      expect(issues[0]!.observed, name).toBe(33); // 'LAB_FIXTURE NOT_MACHINE_VALIDATED'
    }
    // El título industrial del adapter (el que llegó a campo) también:
    const industrial = GOLDEN_R4_TEXT.replace('LAB_FIXTURE NOT_MACHINE_VALIDATED', PTX_CANDIDATE_TITLE);
    const issues = ptxSpecPreflightBytes(new TextEncoder().encode(industrial));
    expect(codes(issues)).toEqual(['ptx_spec.header_title_too_long']);
    expect(issues[0]!.observed).toBe(43);
  });
});

// ---------------------------------------------------------------------------
// Writer gating: el compilador con strictSpecPreflight no produce documento
// ---------------------------------------------------------------------------

describe('#788 writer gating — compileCutPlanToPtxDocument strictSpecPreflight', () => {
  function r4Plan() {
    return optimizeCutPlan(GOLDEN_R4_PROJECT_ID, GOLDEN_R4_ROWS, GOLDEN_R4_MATERIALS, GOLDEN_R4_CONFIG);
  }

  it('rechaza el valor de revisión desconocido (fail closed en la opción)', () => {
    const error = compileError(() =>
      compileCutPlanToPtxDocument(r4Plan(), {
        ...GOLDEN_R4_OPTIONS,
        strictSpecPreflight: 'pattern-exchange-v0' as never,
      }),
    );
    expect(error.code).toBe('ptx_compile.options_invalid');
  });

  it('REGRESIÓN r4: con el título industrial de 43 chars el gate BLOQUEA sin truncar', () => {
    const error = compileError(() =>
      compileCutPlanToPtxDocument(r4Plan(), {
        ...GOLDEN_R4_OPTIONS,
        title: PTX_CANDIDATE_TITLE,
        strictSpecPreflight: PTX_SPEC_PREFLIGHT_REVISION,
      }),
    );
    expect(error.code).toBe('ptx_compile.spec_preflight_failed');
    const specIssues = error.context.specIssues as readonly { code: string; observed?: number; maximum?: number }[];
    expect(specIssues.map((i) => i.code)).toEqual(['ptx_spec.header_title_too_long']);
    expect(specIssues[0]!.observed).toBe(43);
    expect(specIssues[0]!.maximum).toBe(25);
  });

  it('el golden r4 SIN la opción compila idéntico (r4 congelado, gate inerte para historia)', () => {
    const compiled = compileCutPlanToPtxDocument(r4Plan(), GOLDEN_R4_OPTIONS);
    const bytes = serializePtxDocumentBytes(compiled.document, { decimalPlaces: GOLDEN_R4_OPTIONS.decimalPlaces });
    expect(new TextDecoder().decode(bytes)).toBe(GOLDEN_R4_TEXT);
  });

  it('un candidato con TITLE de 24 chars PASA el gate completo: compile → serialize spec-checked → readback === []', () => {
    const R5_LIKE_TITLE = 'GRANETE-PTX-R5-CANDIDATE'; // 24 chars <= 25
    expect(R5_LIKE_TITLE.length).toBe(24);
    expect(R5_LIKE_TITLE.length).toBeLessThanOrEqual(25);
    const options = {
      ...GOLDEN_R4_OPTIONS,
      title: R5_LIKE_TITLE,
      strictSpecPreflight: PTX_SPEC_PREFLIGHT_REVISION,
    } as const;
    const compiled = compileCutPlanToPtxDocument(r4Plan(), options);
    const bytes = serializePtxDocumentBytesSpecChecked(compiled.document, {
      decimalPlaces: options.decimalPlaces,
    });
    expect(ptxSpecPreflightBytes(bytes)).toEqual([]);
    const parsed = parsePtxDocumentBytes(bytes);
    expect(parsed.header.title).toBe(R5_LIKE_TITLE);
    expect(verifyCutPlanPtxReadback(parsed, r4Plan(), compiled.mapping, options)).toEqual([]);
  });
});
