import { describe, it, expect } from 'vitest';
import jobCostingContract from '../../../contracts/jobCosting.json';
import {
  TIME_ENTRY_CATEGORIES,
  OTHER_COST_KINDS,
  MATERIAL_VALUATION_BASES,
  captureCostBaseline,
  setLaborRate,
  recordTimeEntry,
  voidTimeEntry,
  recordOtherCost,
  voidOtherCost,
  valueMaterialConsumptions,
  computeJobCostSummary,
  timeEntryCost,
  activeTimeEntries,
  activeOtherCosts,
  validateJobCostingShape,
  type JobCosting,
} from './jobCosting';
import type { Project } from './types';
import { ValidationError } from './errors';

const snapshot = {
  capturedAt: '2026-08-20T10:00:00Z',
  breakdown: {
    materialsCost: 100,
    edgeTotal: 20,
    hardwareTotal: 30,
    directCost: 150,
    laborModular: 50,
    laborFixedCost: 10,
    marginFactor: 1.3,
    salePrice: 400,
  },
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Obra Test',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.3,
    laborFixedCost: 10,
    status: 'produced',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    priceSnapshot: snapshot,
    version: 3,
    productionRelease: {
      id: 'rel-1',
      projectId: 'proj-1',
      projectVersion: 3,
      designRevisionId: 'dr-1',
      bomFingerprint: 'fp-aaa',
      releasedBy: 'ing-1',
      releasedAt: '2026-08-20T11:00:00Z',
      checks: [],
    },
    ...overrides,
  } as Project;
}

function seededCosting(): JobCosting {
  const withBaseline = captureCostBaseline(makeProject(), {
    byUserId: 'mgr-1',
    at: '2026-08-21T12:00:00Z',
  });
  const withRate = setLaborRate(withBaseline.project, { ratePerHour: 30 });
  return withRate.costing;
}

describe('jobCosting — Domain Contract Parity (OC-080..OC-084)', () => {
  it('matches jobCosting contract fixture exactly', () => {
    expect([...TIME_ENTRY_CATEGORIES]).toEqual(jobCostingContract.timeEntryCategories);
    expect([...OTHER_COST_KINDS]).toEqual(jobCostingContract.otherCostKinds);
    expect([...MATERIAL_VALUATION_BASES]).toEqual(jobCostingContract.materialValuationBases);
  });

  it('rejects categories and kinds outside the fixture', () => {
    const rejectedCategories = jobCostingContract.rejectedTimeEntryCategories as readonly string[];
    for (const category of rejectedCategories) {
      expect(TIME_ENTRY_CATEGORIES.includes(category as never)).toBe(false);
    }
    for (const kind of jobCostingContract.rejectedOtherCostKinds as readonly string[]) {
      expect(OTHER_COST_KINDS.includes(kind as never)).toBe(false);
    }
  });
});

describe('captureCostBaseline (OC-080)', () => {
  it('freezes revenue, full estimated breakdown and expected margin with traceable source', () => {
    const { project, costing, baseline, events } = captureCostBaseline(makeProject(), {
      byUserId: 'mgr-1',
      at: '2026-08-21T12:00:00Z',
    });

    expect(baseline.revenue).toBe(400);
    expect(baseline.estimatedDirectCost).toBe(210); // 100+20+30+50+10
    expect(baseline.expectedGrossMargin).toBe(190);
    expect(baseline.expectedMarginPercent).toBe(47.5);
    expect(baseline.source).toEqual({
      quoteSnapshotCapturedAt: '2026-08-20T10:00:00Z',
      projectVersion: 3,
      releaseId: 'rel-1',
      bomFingerprint: 'fp-aaa',
    });
    expect(project.costing?.baseline?.id).toBe(baseline.id);
    expect(costing.baseline?.id).toBe(baseline.id);
    expect(events.map((e) => e.type)).toEqual(['cost_baseline_captured']);
    expect(events[0]?.payload).toMatchObject({ revenue: 400, estimatedDirectCost: 210 });
    expect(project.events?.at(-1)?.type).toBe('cost_baseline_captured');
  });

  it('blocks capture explaining what is missing', () => {
    expect(() => captureCostBaseline(makeProject({ priceSnapshot: undefined }))).toThrow(
      /snapshot de cotización/,
    );
    expect(() => captureCostBaseline(makeProject({ productionRelease: undefined }))).toThrow(
      /liberar la revisión/,
    );
  });

  it('does not overwrite a baseline frozen for the same release, but allows recapture after re-release', () => {
    const first = captureCostBaseline(makeProject());
    expect(() => captureCostBaseline(first.project)).toThrow(ValidationError);

    const reReleased = {
      ...first.project,
      productionRelease: {
        ...(first.project.productionRelease as NonNullable<Project['productionRelease']>),
        id: 'rel-2',
        bomFingerprint: 'fp-bbb',
      },
    };
    const second = captureCostBaseline(reReleased, { at: '2026-08-21T13:00:00Z' });
    expect(second.baseline.source.releaseId).toBe('rel-2');
    expect(second.costing.timeEntries).toEqual(first.costing.timeEntries);
  });
});

describe('time entries (OC-081)', () => {
  it('records labor time freezing the shop hourly rate', () => {
    const seeded = seededCosting();
    const project = { ...makeProject(), costing: seeded };
    const { project: updated, entry, events } = recordTimeEntry(project, {
      category: 'cut',
      minutes: 60,
      byUserId: 'op-1',
      byName: 'Operario',
      at: '2026-08-21T14:00:00Z',
    });

    expect(entry.ratePerHour).toBe(30);
    expect(timeEntryCost(entry)).toBe(30);
    expect(updated.costing?.timeEntries).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ category: 'cut', minutes: 60, ratePerHour: 30 });
  });

  it('validates category and minutes', () => {
    const project = { ...makeProject(), costing: seededCosting() };
    expect(() =>
      recordTimeEntry(project, { category: 'carpinteria' as never, minutes: 60 }),
    ).toThrow(ValidationError);
    expect(() => recordTimeEntry(project, { category: 'cut', minutes: 0 })).toThrow(ValidationError);
  });

  it('voids softly keeping the audit trail, and refuses double void', () => {
    const project = { ...makeProject(), costing: seededCosting() };
    const recorded = recordTimeEntry(project, {
      category: 'assembly',
      minutes: 45,
      byUserId: 'op-1',
    });
    const voided = voidTimeEntry(recorded.project, recorded.entry.id, {
      byUserId: 'mgr-1',
      reason: 'cargado dos veces',
    });

    expect(voided.costing.timeEntries[0]?.removedAt).toBeTruthy();
    expect(activeTimeEntries(voided.costing)).toHaveLength(0);
    expect(voided.events[0]?.payload).toMatchObject({ entryType: 'time', minutes: 45 });
    expect(() =>
      voidTimeEntry(voided.project, recorded.entry.id, { byUserId: 'mgr-1' }),
    ).toThrow(ValidationError);
  });
});

describe('other actual costs (OC-083)', () => {
  it('records freight/outsource costs and voids softly', () => {
    const project = { ...makeProject(), costing: seededCosting() };
    const recorded = recordOtherCost(project, {
      kind: 'freight',
      amount: 80.5,
      vendor: 'Transporte SRL',
      byUserId: 'alm-1',
    });
    expect(recorded.cost.amount).toBe(80.5);
    expect(recorded.events[0]?.payload).toMatchObject({ kind: 'freight', amount: 80.5 });

    const voided = voidOtherCost(recorded.project, recorded.cost.id, { byUserId: 'mgr-1' });
    expect(activeOtherCosts(voided.costing)).toHaveLength(0);
    expect(voided.costing.otherCosts[0]?.removedAt).toBeTruthy();
  });

  it('validates kind and amount', () => {
    const project = { ...makeProject(), costing: seededCosting() };
    expect(() =>
      recordOtherCost(project, { kind: 'marketing' as never, amount: 10 }),
    ).toThrow(ValidationError);
    expect(() => recordOtherCost(project, { kind: 'freight', amount: 0 })).toThrow(ValidationError);
  });
});

describe('valueMaterialConsumptions (OC-082)', () => {
  it('prefers real PO unit cost, falls back to catalog as proxy and surfaces missing valuations', () => {
    const valuation = valueMaterialConsumptions([
      { materialId: 'mat-po', quantity: 5, poUnitCost: 10 },
      { materialId: 'mat-cat', quantity: 2, catalogUnitCost: 8 },
      { materialId: 'mat-none', quantity: 3 },
      { materialId: 'mat-zero', quantity: 0, poUnitCost: 10 },
    ]);

    expect(valuation.lines).toHaveLength(2);
    expect(valuation.lines[0]).toMatchObject({ basis: 'po_unit_cost', truth: 'actual', amount: 50 });
    expect(valuation.lines[1]).toMatchObject({ basis: 'catalog', truth: 'proxy', amount: 16 });
    expect(valuation.total).toBe(66);
    expect(valuation.truth).toBe('proxy');
    expect(valuation.missingValuationMaterialIds).toEqual(['mat-none']);
  });

  it('reports actual truth only when every line used a real PO price', () => {
    const valuation = valueMaterialConsumptions([{ materialId: 'mat-1', quantity: 2, poUnitCost: 7.5 }]);
    expect(valuation.total).toBe(15);
    expect(valuation.truth).toBe('actual');
  });
});

describe('computeJobCostSummary (OC-084)', () => {
  it('aggregates estimate vs actual with variance and both gross margins', () => {
    const costing = seededCosting();
    const withTime = recordTimeEntry({ ...makeProject(), costing }, { category: 'cut', minutes: 60 });
    const withTime2 = recordTimeEntry(withTime.project, { category: 'assembly', minutes: 90 });
    const withOther = recordOtherCost(withTime2.project, { kind: 'freight', amount: 80 });
    const withOther2 = recordOtherCost(withOther.project, { kind: 'outsource', amount: 25 });

    const summary = computeJobCostSummary({
      baseline: withOther2.project.costing?.baseline,
      timeEntries: withOther2.project.costing?.timeEntries ?? [],
      laborRatePerHour: 30,
      rework: { materialCost: 12, laborMinutes: 30 },
      material: valueMaterialConsumptions([
        { materialId: 'mat-po', quantity: 5, poUnitCost: 10 },
        { materialId: 'mat-cat', quantity: 2, catalogUnitCost: 8 },
      ]),
      otherCosts: withOther2.project.costing?.otherCosts ?? [],
    });

    expect(summary.revenue).toBe(400);
    expect(summary.estimatedDirectCost).toBe(210);
    expect(summary.actualMaterialCost).toBe(78); // 66 consumo + 12 rework
    expect(summary.actualMaterialTruth).toBe('proxy');
    expect(summary.actualLaborMinutes).toBe(180); // 60 + 90 + 30 rework
    expect(summary.actualLaborCost).toBe(90); // 150 min + 30 rework @ 30/h
    expect(summary.actualOtherCost).toBe(105);
    expect(summary.actualDirectCost).toBe(273);
    expect(summary.variance).toBe(63);
    expect(summary.actualGrossMargin).toBe(127);
    expect(summary.actualMarginPercent).toBe(31.75);
    expect(summary.minutesByCategory.cut).toBe(60);
    expect(summary.minutesByCategory.assembly).toBe(90);
    expect(summary.otherCostByKind.freight).toBe(80);
  });

  it('stays honest without baseline: revenue/estimated/variance are null', () => {
    const summary = computeJobCostSummary({
      timeEntries: [],
      laborRatePerHour: 30,
      otherCosts: [],
    });
    expect(summary.revenue).toBeNull();
    expect(summary.estimatedDirectCost).toBeNull();
    expect(summary.variance).toBeNull();
    expect(summary.expectedGrossMargin).toBeNull();
    expect(summary.actualDirectCost).toBe(0);
    expect(summary.actualMaterialTruth).toBe('missing');
  });

  it('refuses to price labor while no hourly rate is configured (Data Truth)', () => {
    const noRate = captureCostBaseline(makeProject());
    const withTime = recordTimeEntry(noRate.project, { category: 'cnc', minutes: 60 });
    const summary = computeJobCostSummary({
      baseline: withTime.project.costing?.baseline,
      timeEntries: withTime.project.costing?.timeEntries ?? [],
      laborRatePerHour: 0,
      otherCosts: [],
    });
    expect(summary.actualLaborCost).toBeNull();
    expect(summary.actualDirectCost).toBeNull();
    expect(summary.variance).toBeNull();
    expect(summary.actualGrossMargin).toBeNull();
    expect(summary.actualLaborMinutes).toBe(60);
  });

  it('excludes voided entries and costs from every aggregate', () => {
    const costing = seededCosting();
    const withTime = recordTimeEntry({ ...makeProject(), costing }, { category: 'cut', minutes: 60 });
    const voided = voidTimeEntry(withTime.project, withTime.entry.id, { byUserId: 'mgr-1' });
    const summary = computeJobCostSummary({
      timeEntries: voided.project.costing?.timeEntries ?? [],
      laborRatePerHour: 30,
      otherCosts: [],
    });
    expect(summary.actualLaborMinutes).toBe(0);
    expect(summary.actualLaborCost).toBe(0);
  });
});

describe('validateJobCostingShape', () => {
  it('accepts a well-formed costing and rejects structural violations', () => {
    const costing = seededCosting();
    expect(validateJobCostingShape(costing)).toEqual([]);

    const broken: JobCosting = {
      ...costing,
      timeEntries: [
        { id: 't1', category: 'painting' as never, minutes: -5, at: '2026-08-21T10:00:00Z', ratePerHour: 0, removedAt: '2026-08-21T11:00:00Z' },
      ],
      otherCosts: [{ id: 'o1', kind: 'taxes' as never, amount: -1, at: '2026-08-21T10:00:00Z' }],
    };
    const errors = validateJobCostingShape(broken);
    expect(errors.some((e) => e.includes('categoría inválida'))).toBe(true);
    expect(errors.some((e) => e.includes('minutos'))).toBe(true);
    expect(errors.some((e) => e.includes('anulación sin autor'))).toBe(true);
    expect(errors.some((e) => e.includes('tipo inválido'))).toBe(true);
    expect(errors.some((e) => e.includes('monto'))).toBe(true);
  });
});
