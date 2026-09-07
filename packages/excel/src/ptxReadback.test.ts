import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExpectedPtxReadback } from './ptxValidationFixture';
import { buildActualReadbackTemplate, type PtxActualReadback } from './ptxReadback';
import { comparePtxReadback } from './ptxReadbackCompare';

function perfectActual(): PtxActualReadback {
  return buildActualReadbackTemplate(buildExpectedPtxReadback());
}

/** Non-mutating patch helper: PtxActualReadback fields are readonly. */
function mutate(base: PtxActualReadback, patch: Partial<PtxActualReadback>): PtxActualReadback {
  return { ...base, ...patch };
}

type PtxActualPart = NonNullable<PtxActualReadback['parts']>[number];

function withParts(base: PtxActualReadback, map: (part: PtxActualPart) => PtxActualPart): PtxActualReadback {
  return mutate(base, { parts: base.parts!.map(map) });
}

function findingMap(actual: PtxActualReadback) {
  const comparison = comparePtxReadback(buildExpectedPtxReadback(), actual);
  return {
    comparison,
    byField: new Map(comparison.findings.map((f) => [f.field, f])),
  };
}

describe('comparePtxReadback', () => {
  it('returns zero blockers/warnings when the readback matches the fixture exactly', () => {
    const expected = buildExpectedPtxReadback();
    const { comparison, byField } = findingMap(perfectActual());
    expect(comparison.blockerCount).toBe(0);
    expect(comparison.warningCount).toBe(0);
    expect(comparison.passCount).toBeGreaterThan(0);
    // The unrepresentable-field ledger is always reported, plus the explicit
    // "no edge band" ambiguity findings for unbanded parts.
    expect(comparison.unsupportedCount).toBeGreaterThanOrEqual(
      expected.notRepresentedByCurrentPtx.length,
    );
    for (const fieldName of expected.notRepresentedByCurrentPtx) {
      expect(byField.get(`notRepresented.${fieldName}`)?.classification).toBe(
        'UNSUPPORTED_CAPABILITY',
      );
    }
    expect(byField.get('parts[fixture-part-003].edgeBandThicknessMm')?.classification).toBe(
      'UNSUPPORTED_CAPABILITY',
    );
  });

  it('is deterministic: identical inputs produce identical findings', () => {
    const expected = buildExpectedPtxReadback();
    const actual = perfectActual();
    expect(JSON.stringify(comparePtxReadback(expected, actual))).toBe(
      JSON.stringify(comparePtxReadback(expected, actual)),
    );
  });

  it('classifies quantity mismatch as BLOCKER (part-004 collapsed from 2 to 1)', () => {
    const actual = withParts(perfectActual(), (p) =>
      p.partCode === 'fixture-part-004' ? { ...p, quantity: 1 } : p,
    );
    const { byField } = findingMap(actual);
    expect(byField.get('parts[fixture-part-004].quantity')?.classification).toBe('BLOCKER');
  });

  it('classifies dimension mismatch as BLOCKER and small deviation as WARNING (rounding)', () => {
    const actual = withParts(perfectActual(), (p) => {
      if (p.partCode === 'fixture-part-001') return { ...p, finishedLengthMm: 720 };
      if (p.partCode === 'fixture-part-003') return { ...p, finishedWidthMm: 578.4 };
      return p;
    });
    const { byField } = findingMap(actual);
    expect(byField.get('parts[fixture-part-001].finishedLengthMm')?.classification).toBe('BLOCKER');
    expect(byField.get('parts[fixture-part-003].finishedWidthMm')?.classification).toBe('WARNING');
  });

  it('classifies unit mismatch as BLOCKER even when every dimension matches', () => {
    const { byField, comparison } = findingMap(mutate(perfectActual(), { units: 'INCH' }));
    expect(byField.get('job.units')?.classification).toBe('BLOCKER');
    expect(comparison.blockerCount).toBeGreaterThan(0);
  });

  it('classifies rotation of a grain-1 piece as BLOCKER and grain-0 rotation drift as WARNING', () => {
    const actual = withParts(perfectActual(), (p) => {
      if (p.partCode === 'fixture-part-005') return { ...p, rotatedCount: 1 };
      if (p.partCode === 'fixture-part-004') return { ...p, rotatedCount: 2 };
      return p;
    });
    const { byField } = findingMap(actual);
    expect(byField.get('parts[fixture-part-005].rotatedCount')?.classification).toBe('BLOCKER');
    expect(byField.get('parts[fixture-part-004].rotatedCount')?.classification).toBe('WARNING');
  });

  it('treats identity loss (no barcodes) with dimensions retained as WARNING to evaluate, never PASS', () => {
    const actual = withParts(perfectActual(), (p) => ({ ...p, barcodes: [] }));
    const { comparison, byField } = findingMap(actual);
    expect(byField.get('parts[fixture-part-001].barcodes')?.classification).toBe('WARNING');
    expect(comparison.warningCount).toBeGreaterThan(0);
  });

  it('treats changed barcodes as WARNING (identity survives but mutated)', () => {
    const actual = withParts(perfectActual(), (p) =>
      p.partCode === 'fixture-part-002' ? { ...p, barcodes: ['receiver-renumbered-42'] } : p,
    );
    const { byField } = findingMap(actual);
    expect(byField.get('parts[fixture-part-002].barcodes')?.classification).toBe('WARNING');
  });

  it('blocks missing and unexpected parts', () => {
    const base = perfectActual();
    const kept = base.parts!.filter((p) => p.partCode !== 'fixture-part-006');
    const actual = mutate(base, {
      parts: [...kept, { ...kept[0]!, partCode: 'receiver-invented' }],
    });
    const { byField } = findingMap(actual);
    expect(byField.get('parts[fixture-part-006].partCode')?.classification).toBe('BLOCKER');
    expect(byField.get('parts[receiver-invented].partCode')?.classification).toBe('BLOCKER');
  });

  it('never auto-blocks cut-order differences and flags ownership dependency', () => {
    const expected = buildExpectedPtxReadback();
    const reordered = [
      'PAT_1:RIP_STRIP_1',
      ...expected.cutOrderExpected.filter((step) => step !== 'PAT_1:RIP_STRIP_1'),
    ];
    const { byField } = findingMap(mutate(perfectActual(), { cutOrderObserved: reordered }));
    const cutOrder = byField.get('cutOrder')!;
    expect(cutOrder.classification).toBe('WARNING');
    expect(cutOrder.note).toContain('ownership');
  });

  it('reports absent fields as NOT_OBSERVABLE instead of inventing values', () => {
    const actual = perfectActual();
    const partial: PtxActualReadback = {
      source: { softwareName: 'receiver-x' },
      units: 'mm',
    };
    const comparison = comparePtxReadback(buildExpectedPtxReadback(), partial);
    expect(comparison.notObservableCount).toBeGreaterThan(0);
    expect(comparison.blockerCount).toBe(0);
    // Missing parts/materials entirely is observable absence, not silence.
    expect(comparison.warningCount).toBe(0);
  });

  it('always reports bomFingerprint and provenance as UNSUPPORTED_CAPABILITY', () => {
    const { comparison, byField } = findingMap(perfectActual());
    expect(byField.get('notRepresented.bomFingerprint')?.classification).toBe(
      'UNSUPPORTED_CAPABILITY',
    );
    expect(byField.get('notRepresented.productionReleaseId')?.classification).toBe(
      'UNSUPPORTED_CAPABILITY',
    );
    // A perfect readback still cannot prove provenance from the file.
    expect(comparison.unsupportedCount).toBeGreaterThan(0);
  });

  it('classifies kerf, trim and material identity mismatches as BLOCKER', () => {
    const base = mutate(perfectActual(), {
      kerfMm: 4,
      trimMm: { ...perfectActual().trimMm!, leftMm: 0 },
    });
    const actual = mutate(base, {
      materials: base.materials!.map((m) =>
        m.materialCode === 'sample-material-b' ? { ...m, thicknessMm: 18 } : m,
      ),
    });
    const actual2 = withParts(actual, (p) =>
      p.partCode === 'fixture-part-005' ? { ...p, materialCode: 'sample-material-a' } : p,
    );
    const { byField } = findingMap(actual2);
    expect(byField.get('job.kerfMm')?.classification).toBe('BLOCKER');
    expect(byField.get('job.trimMm.leftMm')?.classification).toBe('BLOCKER');
    expect(byField.get('materials[sample-material-b].thicknessMm')?.classification).toBe('BLOCKER');
    expect(byField.get('parts[fixture-part-005].materialCode')?.classification).toBe('BLOCKER');
  });
});

const RUN_MODE = Boolean(process.env.PTX_COMPARE_ACTUAL_JSON);

describe.runIf(RUN_MODE)('comparePtxReadback (field run)', () => {
  it('compares the operator-captured readback and writes the classified report', () => {
    const expected = buildExpectedPtxReadback();
    const actualPath = resolve(process.env.PTX_COMPARE_ACTUAL_JSON!);
    const actual = JSON.parse(readFileSync(actualPath, 'utf8')) as PtxActualReadback;
    const comparison = comparePtxReadback(expected, actual);

    const outDir = process.env.PTX_EMIT_FIXTURE_DIR ?? dirname(actualPath);
    mkdirSync(outDir, { recursive: true });
    const reportPath = resolve(outDir, 'ptx-readback-comparison.json');
    writeFileSync(reportPath, `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');

    console.log(`[ptx-readback] Reporte: ${reportPath}`);
    console.log(
      `[ptx-readback] blockers=${comparison.blockerCount} warnings=${comparison.warningCount} ` +
        `unsupported=${comparison.unsupportedCount} notObservable=${comparison.notObservableCount} ` +
        `pass=${comparison.passCount}`,
    );
    for (const f of comparison.findings) {
      if (f.classification !== 'PASS') {
        console.log(`[ptx-readback] ${f.classification} ${f.field} expected=${f.expected} actual=${f.actual} ${f.note ?? ''}`);
      }
    }
  });
});
