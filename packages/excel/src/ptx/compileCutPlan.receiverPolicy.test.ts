/**
 * #790 — HPP250 CAD4 receiver-policy compiler wiring.
 *
 * Verifies that the r5 lab receiver profile is projected through the generic
 * PTX compiler without changing the historical/default r4 byte contract.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { optimizeCutPlan } from '@granete/domain';
import { compileCutPlanToPtxDocument, PtxCompilationError } from './compileCutPlan';
import type {
  PtxBoardRecord,
  PtxCutRecord,
  PtxDocument,
  PtxMaterialRecord,
  PtxPatternRecord,
  PtxRecord,
} from './records';
import { parsePtxDocumentBytes } from './parse';
import { serializePtxDocumentBytes } from './serialize';
import { PTX_SPEC_PREFLIGHT_REVISION } from './specPreflight';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import {
  GOLDEN_R4_CONFIG,
  GOLDEN_R4_MATERIALS,
  GOLDEN_R4_OPTIONS,
  GOLDEN_R4_PROJECT_ID,
  GOLDEN_R4_ROWS,
} from './cutPlanPtxGoldenR4';
import {
  HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
  PTX_RECEIVER_FIELD_SOURCE,
  requiredReceiverNumber,
  type PtxReceiverPolicy,
} from './receiverPolicy';

const RECEIVER_CONFIG = {
  ...GOLDEN_R4_CONFIG,
  sawKerfMm: 4.4,
  trim: {
    topMm: 0,
    bottomMm: 10,
    leftMm: 10,
    rightMm: 0,
  },
};

const RECEIVER_MISMATCH_CONFIG = {
  ...GOLDEN_R4_CONFIG,
  sawKerfMm: 4.4,
};

const RECEIVER_OPTIONS = {
  ...GOLDEN_R4_OPTIONS,
  receiverPolicy: HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
};

const SPEC_VALID_RECEIVER_OPTIONS = {
  ...RECEIVER_OPTIONS,
  title: 'HPP250 CAD4',
  strictSpecPreflight: PTX_SPEC_PREFLIGHT_REVISION,
};

function buildGoldenR4Plan(config = RECEIVER_CONFIG) {
  return optimizeCutPlan(
    GOLDEN_R4_PROJECT_ID,
    GOLDEN_R4_ROWS,
    GOLDEN_R4_MATERIALS,
    config,
  );
}

function buildReceiverOrderPlan() {
  const plan = buildGoldenR4Plan();
  const [firstSheet, ...otherSheets] = plan.sheets;
  const cutProgram = firstSheet!.cutProgram!;
  return {
    ...plan,
    sheets: [
      {
        ...firstSheet!,
        cutProgram: {
          ...cutProgram,
          terminals: cutProgram.terminals.map((terminal) =>
            terminal.regionId === 'place-3-1:rest'
              ? { ...terminal, kind: 'remnant' as const }
              : terminal,
          ),
        },
      },
      ...otherSheets,
    ],
  };
}

function captureCompileError(fn: () => unknown): PtxCompilationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PtxCompilationError);
    return error as PtxCompilationError;
  }
  throw new Error('expected compileCutPlanToPtxDocument to throw');
}

function boardRows(records: readonly { type: string }[]): PtxBoardRecord[] {
  return records.filter((record): record is PtxBoardRecord => record.type === 'BOARDS');
}

function materialRows(records: readonly { type: string }[]): PtxMaterialRecord[] {
  return records.filter(
    (record): record is PtxMaterialRecord => record.type === 'MATERIALS',
  );
}

function patternRows(records: readonly { type: string }[]): PtxPatternRecord[] {
  return records.filter(
    (record): record is PtxPatternRecord => record.type === 'PATTERNS',
  );
}

function cutRows(records: readonly { type: string }[]): PtxCutRecord[] {
  return records.filter((record): record is PtxCutRecord => record.type === 'CUTS');
}

function compileParsedReceiverCandidate(plan = buildGoldenR4Plan()) {
  const compiled = compileCutPlanToPtxDocument(plan, RECEIVER_OPTIONS);
  const bytes = serializePtxDocumentBytes(compiled.document, {
    decimalPlaces: RECEIVER_OPTIONS.decimalPlaces,
  });

  return {
    plan,
    compiled,
    parsed: parsePtxDocumentBytes(bytes),
  };
}

describe('#790 HPP250 CAD4 receiver policy compiler wiring', () => {
  it('declares typed receiver field sources and requires BOOK=3', () => {
    const typedSources = new Set(Object.values(PTX_RECEIVER_FIELD_SOURCE));

    expect(requiredReceiverNumber(HPP250_CAD4_R5_LAB_RECEIVER_POLICY, 'BOOK')).toBe(3);
    for (const field of Object.values(
      HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields,
    )) {
      expect(typedSources.has(field.source)).toBe(true);
    }
    expect(HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields.BOOK.source).toBe(
      PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
    );
    expect(HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields.TRIM_FRIP.source).toBe(
      PTX_RECEIVER_FIELD_SOURCE.FROM_CUTPLAN_GEOMETRY,
    );
    expect(HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields.TRIM_HEAD.source).toBe(
      PTX_RECEIVER_FIELD_SOURCE.OMIT_NO_OVERRIDE,
    );
  });

  it(
    'compiles the r4 golden plan with HPP250 material/pattern overrides, no BOARDS cost/stock flag and no CUTS comments',
    () => {
      const plan = buildGoldenR4Plan();
      const compiled = compileCutPlanToPtxDocument(plan, RECEIVER_OPTIONS);
      const boards = boardRows(compiled.document.records);
      const materials = materialRows(compiled.document.records);
      const patterns = patternRows(compiled.document.records);
      const cuts = cutRows(compiled.document.records);

      expect(boards.length).toBeGreaterThan(0);
      expect(
        boards.every((row) => row.cost === undefined && row.stockFlag === undefined),
      ).toBe(true);

      expect(materials).toHaveLength(2);
      expect(materials.map((row) => [row.code, row.thickness])).toEqual([
        ['LAB15', 15],
        ['LAB18', 18],
      ]);
      for (const row of materials) {
        expect(row).toMatchObject({
          bookQuantity: 3,
          kerfRip: 4.4,
          kerfCrosscut: 4.4,
          trimFRip: 10,
          trimFXct: 10,
          trimHead: undefined,
          trimFRct: undefined,
          trimVRct: undefined,
          rule1: 6,
          rule2: 1,
          rule3: 1,
          rule4: 1,
        });
      }

      expect(patterns.length).toBeGreaterThan(0);
      for (const row of patterns) {
        expect(row).toMatchObject({ runQuantity: 1, cyclesQuantity: 1, maxBook: 3 });
      }
      expect(cuts.length).toBeGreaterThan(0);
      expect(cuts.every((row) => row.comment === undefined)).toBe(true);

      const bytes = serializePtxDocumentBytes(compiled.document, {
        decimalPlaces: RECEIVER_OPTIONS.decimalPlaces,
      });
      const parsed = parsePtxDocumentBytes(bytes);
      expect(
        verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, RECEIVER_OPTIONS),
      ).toEqual([]);
    },
  );

  it('compiles the receiver candidate through strict spec preflight', () => {
    const compiled = compileCutPlanToPtxDocument(
      buildGoldenR4Plan(),
      SPEC_VALID_RECEIVER_OPTIONS,
    );

    expect(materialRows(compiled.document.records).length).toBeGreaterThan(0);
  });

  it(
    'blocks receiver compilation when executed r3 trims conflict with HPP250 receiver trim values',
    () => {
      const error = captureCompileError(() =>
        compileCutPlanToPtxDocument(
          buildGoldenR4Plan(RECEIVER_MISMATCH_CONFIG),
          RECEIVER_OPTIONS,
        ),
      );

      expect(error.code).toBe('ptx_compile.trim_geometry_mismatch');
      expect(error.context).toMatchObject({
        materialCode: 'LAB15',
        slot: 'TRIM_VRIP',
        executedValue: 10,
        expectedValue: 0,
        receiverPolicyId: HPP250_CAD4_R5_LAB_RECEIVER_POLICY.id,
      });
    },
  );

  it(
    'blocks receiver compilation when cutPlan sawKerfMm is not the HPP250 4.4 mm kerf',
    () => {
      const error = captureCompileError(() =>
        compileCutPlanToPtxDocument(
          buildGoldenR4Plan({ ...GOLDEN_R4_CONFIG, sawKerfMm: 4.5 }),
          RECEIVER_OPTIONS,
        ),
      );

      expect(error.code).toBe('ptx_compile.kerf_not_uniform');
    },
  );

  it('blocks OMIT_NO_OVERRIDE receiver policy fields that accidentally carry a value', () => {
    const mutatedPolicy = {
      ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
      materialFields: {
        ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields,
        TRIM_HEAD: {
          ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields.TRIM_HEAD,
          value: 20,
        },
      },
    } satisfies PtxReceiverPolicy;

    const error = captureCompileError(() =>
      compileCutPlanToPtxDocument(buildGoldenR4Plan(), {
        ...GOLDEN_R4_OPTIONS,
        receiverPolicy: mutatedPolicy,
      }),
    );

    expect(error.code).toBe('ptx_compile.options_invalid');
  });

  it('blocks an incomplete receiver policy missing a required RULE value', () => {
    const mutatedPolicy = {
      ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
      materialFields: {
        ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields,
        RULE4: {
          source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
        },
      },
    } as unknown as PtxReceiverPolicy;

    const error = captureCompileError(() =>
      compileCutPlanToPtxDocument(buildGoldenR4Plan(), {
        ...GOLDEN_R4_OPTIONS,
        receiverPolicy: mutatedPolicy,
      }),
    );

    expect(error.code).toBe('ptx_compile.options_invalid');
  });


  it('blocks FROM_MATERIAL receiver fields because material resolution is not wired yet', () => {
    const mutatedPolicy = {
      ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
      materialFields: {
        ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields,
        BOOK: {
          source: PTX_RECEIVER_FIELD_SOURCE.FROM_MATERIAL,
          value: 3,
        },
      },
    } as unknown as PtxReceiverPolicy;

    const error = captureCompileError(() =>
      compileCutPlanToPtxDocument(buildGoldenR4Plan(), {
        ...GOLDEN_R4_OPTIONS,
        receiverPolicy: mutatedPolicy,
      }),
    );

    expect(error.code).toBe('ptx_compile.options_invalid');
    expect(error.message).toContain('FROM_MATERIAL');
  });

  it('blocks FROM_MATERIAL receiver fields even when the value is absent', () => {
    const mutatedPolicy = {
      ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
      materialFields: {
        ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields,
        BOOK: {
          source: PTX_RECEIVER_FIELD_SOURCE.FROM_MATERIAL,
        },
      },
    } as unknown as PtxReceiverPolicy;

    const error = captureCompileError(() =>
      compileCutPlanToPtxDocument(buildGoldenR4Plan(), {
        ...GOLDEN_R4_OPTIONS,
        receiverPolicy: mutatedPolicy,
      }),
    );

    expect(error.code).toBe('ptx_compile.options_invalid');
    expect(error.message).toContain('FROM_MATERIAL');
  });

  it('uses a generic same-id receiver policy clone whose BOOK differs from the exported HPP250 policy', () => {
    const mutatedPolicy = {
      ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
      materialFields: {
        ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields,
        BOOK: {
          ...HPP250_CAD4_R5_LAB_RECEIVER_POLICY.materialFields.BOOK,
          value: 5,
        },
      },
    } satisfies PtxReceiverPolicy;

    const compiled = compileCutPlanToPtxDocument(buildGoldenR4Plan(), {
      ...GOLDEN_R4_OPTIONS,
      receiverPolicy: mutatedPolicy,
    });

    expect(materialRows(compiled.document.records).every((row) => row.bookQuantity === 5)).toBe(true);
    expect(patternRows(compiled.document.records).every((row) => row.maxBook === 5)).toBe(true);
  });

  it(
    'serializes present record families in HPP250 order without PARTS_INF/PARTS_UDI when no labels are present',
    () => {
      const compiled = compileCutPlanToPtxDocument(
        buildReceiverOrderPlan(),
        RECEIVER_OPTIONS,
      );
      const bytes = serializePtxDocumentBytes(compiled.document, {
        decimalPlaces: RECEIVER_OPTIONS.decimalPlaces,
      });
      const parsed = parsePtxDocumentBytes(bytes);
      const families = new TextDecoder()
        .decode(bytes)
        .split('\r\n')
        .filter((line) => line !== '' && !line.startsWith('HEADER'))
        .map((line) => line.split(',')[0]);
      const patternIndexes = families
        .map((family, index) => (family === 'PATTERNS' ? index : -1))
        .filter((index) => index >= 0);

      expect(parsed.records.some((record) => record.type === 'PARTS_INF')).toBe(false);
      expect(parsed.records.some((record) => record.type === 'PARTS_UDI')).toBe(false);
      expect(families.slice(0, families.indexOf('PATTERNS'))).toEqual([
        'JOBS',
        ...Array(parsed.records.filter((record) => record.type === 'PARTS_REQ').length).fill('PARTS_REQ'),
        ...Array(parsed.records.filter((record) => record.type === 'BOARDS').length).fill('BOARDS'),
        ...Array(parsed.records.filter((record) => record.type === 'MATERIALS').length).fill('MATERIALS'),
        ...Array(parsed.records.filter((record) => record.type === 'OFFCUTS').length).fill('OFFCUTS'),
      ]);
      expect(patternIndexes.length).toBeGreaterThan(1);
      for (const patternIndex of patternIndexes) {
        expect(families[patternIndex + 1]).toBe('CUTS');
      }
      expect(patternIndexes[1]).toBeGreaterThan(
        families.indexOf('CUTS', patternIndexes[0]),
      );
    },
  );

  it('reports receiver.order when parsed records put MATERIALS before BOARDS', () => {
    const { plan, compiled, parsed } = compileParsedReceiverCandidate();
    const records = [...parsed.records];
    const materialIndex = records.findIndex((record) => record.type === 'MATERIALS');
    const boardIndex = records.findIndex((record) => record.type === 'BOARDS');
    const [material] = records.splice(materialIndex, 1);
    records.splice(boardIndex, 0, material!);
    const mutated: PtxDocument = { ...parsed, records };

    const issues = verifyCutPlanPtxReadback(
      mutated,
      plan,
      compiled.mapping,
      RECEIVER_OPTIONS,
    );

    expect(issues.map((issue) => issue.code)).toContain('receiver.order');
  });

  it('reports receiver.order when PATTERNS are grouped before their CUTS rows', () => {
    const { plan, compiled, parsed } = compileParsedReceiverCandidate();
    const patternAndCutStart = parsed.records.findIndex(
      (record) => record.type === 'PATTERNS' || record.type === 'CUTS',
    );
    const patterns = patternRows(parsed.records);
    const cuts = cutRows(parsed.records);
    const withoutPatternsAndCuts = parsed.records.filter(
      (record) => record.type !== 'PATTERNS' && record.type !== 'CUTS',
    );
    const mutated: PtxDocument = {
      ...parsed,
      records: [
        ...withoutPatternsAndCuts.slice(0, patternAndCutStart),
        ...patterns,
        ...cuts,
        ...withoutPatternsAndCuts.slice(patternAndCutStart),
      ],
    };

    expect(
      verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, RECEIVER_OPTIONS),
    ).toEqual([]);
    expect(
      verifyCutPlanPtxReadback(mutated, plan, compiled.mapping, RECEIVER_OPTIONS)
        .map((issue) => issue.code),
    ).toContain('receiver.order');
  });

  it('keeps HPP250 receiver id/value/order constants out of the generic compiler source', () => {
    const source = readFileSync(new URL('./compileCutPlan.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('HPP250_CAD4_R5_LAB_RECEIVER_POLICY');
    expect(source).not.toContain('HPP250_CAD4_R5_LAB');
    expect(source).not.toContain('HPP250_RECEIVER_FAMILY_ORDER');
  });

  it('reports receiver MATERIALS rule, kerf, BOOK and PATTERNS MAX_BOOK mutations', () => {
    const { plan, compiled, parsed } = compileParsedReceiverCandidate();
    const materialMutations: readonly (readonly [keyof PtxMaterialRecord, number, string])[] = [
      ['rule1', 7, 'materials.receiver_policy'],
      ['rule2', 0, 'materials.receiver_policy'],
      ['rule3', 0, 'materials.receiver_policy'],
      ['rule4', 0, 'materials.receiver_policy'],
      ['kerfRip', 4.3, 'materials.kerf'],
      ['kerfCrosscut', 4.3, 'materials.kerf'],
      ['bookQuantity', 2, 'materials.book'],
    ];

    for (const [field, value, code] of materialMutations) {
      const mutated: PtxDocument = {
        ...parsed,
        records: parsed.records.map((record) =>
          record.type === 'MATERIALS' ? { ...record, [field]: value } : record,
        ),
      };
      expect(
        verifyCutPlanPtxReadback(mutated, plan, compiled.mapping, RECEIVER_OPTIONS)
          .map((issue) => issue.code),
        `${String(field)} mutation`,
      ).toContain(code);
    }

    const maxBookMutated: PtxDocument = {
      ...parsed,
      records: parsed.records.map((record) =>
        record.type === 'PATTERNS' ? { ...record, maxBook: 2 } : record,
      ),
    };
    expect(
      verifyCutPlanPtxReadback(maxBookMutated, plan, compiled.mapping, RECEIVER_OPTIONS)
        .map((issue) => issue.code),
    ).toContain('patterns.max_book');
  });

  it('reports receiver BOARDS authority issues for cost and stock flag values', () => {
    const { plan, compiled, parsed } = compileParsedReceiverCandidate();
    const records: PtxRecord[] = parsed.records.map((record) =>
      record.type === 'BOARDS'
        ? { ...record, cost: 12.34, stockFlag: 1 }
        : record,
    );
    const mutated: PtxDocument = { ...parsed, records };

    const issues = verifyCutPlanPtxReadback(
      mutated,
      plan,
      compiled.mapping,
      RECEIVER_OPTIONS,
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'boards.cost_authority',
        'boards.stock_flag_authority',
      ]),
    );
  });

  it(
    'keeps historical/default r4 compilation on CUTS comments and maxBook/book=1',
    () => {
      const compiled = compileCutPlanToPtxDocument(
        optimizeCutPlan(
          GOLDEN_R4_PROJECT_ID,
          GOLDEN_R4_ROWS,
          GOLDEN_R4_MATERIALS,
          GOLDEN_R4_CONFIG,
        ),
        GOLDEN_R4_OPTIONS,
      );

      expect(
        materialRows(compiled.document.records).every((row) => row.bookQuantity === 1),
      ).toBe(true);
      expect(
        patternRows(compiled.document.records).every((row) => row.maxBook === 1),
      ).toBe(true);
      expect(
        cutRows(compiled.document.records).some((row) => row.comment !== undefined),
      ).toBe(true);
    },
  );
});
