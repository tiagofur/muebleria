import { describe, it, expect } from 'vitest';
import qualityContract from '../../../contracts/qualityStatuses.json';
import {
  QUALITY_ISSUE_CATEGORIES,
  QUALITY_ISSUE_STATUSES,
  QUALITY_ISSUE_STATUS_TRANSITIONS,
  REWORK_ACTION_TYPES,
  QC_CHECK_CODES,
  canTransitionQualityIssueStatus,
  reportQualityIssue,
  transitionQualityIssue,
  recordReworkAction,
  recordUnitQc,
  overrideUnitQc,
  evaluateUnitQcGate,
  openIssuesForUnit,
  reworkCostSummary,
  unitQcRecord,
  type QualityJob,
} from './quality';
import type { PartInstance, ModuleUnitExecution } from './partExecution';
import type { Project } from './types';
import { ValidationError } from './errors';

function makePart(overrides: Partial<PartInstance> = {}): PartInstance {
  return {
    id: 'part-1',
    projectId: 'proj-1',
    productionRevision: 'rel-1',
    projectItemId: 'item-1',
    unitIndex: 1,
    partCode: 'P01',
    description: 'Frente',
    materialId: 'board-1',
    lengthMm: 800,
    widthMm: 600,
    thicknessMm: 18,
    grain: 0,
    edges: [],
    requiredOperations: [
      { id: 'op-1', type: 'cut', sequence: 1, status: 'completed', completedAt: '2026-08-21T09:00:00Z' },
      { id: 'op-2', type: 'edge_banding', sequence: 2, status: 'completed', completedAt: '2026-08-21T09:30:00Z' },
    ],
    currentOperationIndex: 1,
    status: 'ready_for_assembly',
    ...overrides,
  };
}

function makeUnit(status: ModuleUnitExecution['status'] = 'module_qc'): ModuleUnitExecution {
  return {
    id: 'unit-1',
    projectId: 'proj-1',
    projectItemId: 'item-1',
    unitIndex: 1,
    productionRevision: 'rel-1',
    status,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Obra Test',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    status: 'produced',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    partInstances: [makePart()],
    moduleUnits: [makeUnit()],
    ...overrides,
  };
}

const fullChecklist = [
  { code: 'square' as const, passed: true },
  { code: 'dimensions' as const, passed: true },
  { code: 'hardware' as const, passed: true },
  { code: 'doors_drawers' as const, passed: true },
  { code: 'finish' as const, passed: true },
  { code: 'identification' as const, passed: true },
];

describe('quality — Domain Contract Parity (OC-060..OC-062)', () => {
  it('matches qualityStatuses contract fixture exactly', () => {
    expect([...QUALITY_ISSUE_CATEGORIES]).toEqual(qualityContract.issueCategories);
    expect([...QUALITY_ISSUE_STATUSES]).toEqual(qualityContract.issueStatuses);
    expect([...REWORK_ACTION_TYPES]).toEqual(qualityContract.reworkActionTypes);
    expect([...QC_CHECK_CODES]).toEqual(qualityContract.qcCheckCodes);
  });

  it('mirrors issue status transitions from the contract', () => {
    for (const [from, targets] of Object.entries(qualityContract.issueStatusTransitions)) {
      expect([
        ...QUALITY_ISSUE_STATUS_TRANSITIONS[from as keyof typeof QUALITY_ISSUE_STATUS_TRANSITIONS],
      ]).toEqual(targets);
    }
    expect(canTransitionQualityIssueStatus('open', 'verified')).toBe(false);
  });
});

describe('reportQualityIssue (OC-060)', () => {
  it('creates a traceable issue linked to piece and unit, audited via quality_issue_reported', () => {
    const { project, job, issue, events } = reportQualityIssue(makeProject(), {
      description: 'Frente rayado',
      category: 'dano',
      projectItemId: 'item-1',
      partInstanceId: 'part-1',
      moduleUnitId: 'unit-1',
      station: 'module_qc',
      reportedBy: 'qc-1',
      at: '2026-08-21T11:00:00Z',
    });
    expect(issue.status).toBe('open');
    expect(job.issues).toHaveLength(1);
    expect(project.quality?.issues[0]?.id).toBe(issue.id);
    expect(events.map((e) => e.type)).toEqual(['quality_issue_reported']);
    expect(events[0]?.payload).toMatchObject({ category: 'dano', partInstanceId: 'part-1' });
  });

  it('validates description and category', () => {
    expect(() =>
      reportQualityIssue(makeProject(), { description: '  ', category: 'dano' }),
    ).toThrow(ValidationError);
    expect(() =>
      reportQualityIssue(makeProject(), { description: 'x', category: 'rotulo' as never }),
    ).toThrow(ValidationError);
  });
});

describe('transitionQualityIssue', () => {
  it('walks open → resolved → verified and reopens on failed verification', () => {
    const reported = reportQualityIssue(makeProject(), { description: 'd', category: 'otro' });
    const issueId = reported.issue.id;
    const resolved = transitionQualityIssue(reported.project, issueId, 'resolved', {
      notes: 'Pulido y revisado',
      byUserId: 'op-1',
    });
    expect(resolved.job.issues[0]?.status).toBe('resolved');
    const verified = transitionQualityIssue(resolved.project, issueId, 'verified', {
      byUserId: 'sup-1',
    });
    expect(verified.job.issues[0]?.verifiedAt).toBeDefined();
    const reopened = transitionQualityIssue(verified.project, issueId, 'open', {
      notes: 'Volvió a aparecer',
    });
    expect(reopened.job.issues[0]?.status).toBe('open');
    expect(reopened.job.issues[0]?.resolvedAt).toBeUndefined();
  });

  it('rejects illegal transitions', () => {
    const reported = reportQualityIssue(makeProject(), { description: 'd', category: 'otro' });
    expect(() =>
      transitionQualityIssue(reported.project, reported.issue.id, 'verified', {}),
    ).toThrow(ValidationError);
  });
});

describe('recordReworkAction (OC-061)', () => {
  it('rework reopens the affected operation and audits rework_started with costing', () => {
    const reported = reportQualityIssue(makeProject(), {
      description: 'Canto despegado',
      category: 'acabado_canto',
      partInstanceId: 'part-1',
    });
    const { project, job, action, events } = recordReworkAction(
      reported.project,
      reported.issue.id,
      {
        action: 'rework',
        reason: 'Canto mal pegado',
        materialCost: 25.5,
        laborMinutes: 30,
        partInstanceId: 'part-1',
        targetOperation: 'edge_banding',
        byUserId: 'sup-1',
        at: '2026-08-21T12:00:00Z',
      },
    );
    expect(action.materialCost).toBe(25.5);
    expect(job.reworkActions).toHaveLength(1);
    expect(job.issues[0]?.status).toBe('resolved');
    const part = project.partInstances?.find((p) => p.id === 'part-1')!;
    expect(part.requiredOperations.find((op) => op.type === 'edge_banding')?.status).toBe('rework');
    expect(events.map((e) => e.type)).toEqual(['rework_started']);
    expect(events[0]?.payload).toMatchObject({ materialCost: 25.5, laborMinutes: 30 });
  });

  it('refabricate resets the whole route; scrap marks the piece scrapped', () => {
    const base = reportQualityIssue(makeProject(), {
      description: 'Medida corta',
      category: 'dimensional',
      partInstanceId: 'part-1',
    });
    const refab = recordReworkAction(base.project, base.issue.id, {
      action: 'refabricate',
      partInstanceId: 'part-1',
      materialCost: 120,
      laborMinutes: 90,
    });
    const refabPart = refab.project.partInstances?.find((p) => p.id === 'part-1')!;
    expect(refabPart.status).toBe('pending');
    expect(refabPart.requiredOperations.every((op) => op.status === 'queued')).toBe(true);

    const scrapBase = reportQualityIssue(makeProject(), {
      description: 'Roto',
      category: 'dano',
      partInstanceId: 'part-1',
    });
    const scrapped = recordReworkAction(scrapBase.project, scrapBase.issue.id, {
      action: 'scrap',
      partInstanceId: 'part-1',
      materialCost: 300,
      laborMinutes: 0,
    });
    expect(scrapped.project.partInstances?.find((p) => p.id === 'part-1')?.status).toBe('scrapped');
  });

  it('accept_as_is closes the deviation without rework event but requires a reason', () => {
    const base = reportQualityIssue(makeProject(), { description: 'Veta', category: 'otro' });
    expect(() =>
      recordReworkAction(base.project, base.issue.id, { action: 'accept_as_is' }),
    ).toThrow(ValidationError);
    const accepted = recordReworkAction(base.project, base.issue.id, {
      action: 'accept_as_is',
      reason: 'Aceptado por el cliente en visita',
    });
    expect(accepted.events).toHaveLength(0);
    expect(accepted.job.issues[0]?.status).toBe('resolved');
  });

  it('rework/refabricate/scrap require the affected piece', () => {
    const base = reportQualityIssue(makeProject(), { description: 'd', category: 'otro' });
    expect(() =>
      recordReworkAction(base.project, base.issue.id, { action: 'rework' }),
    ).toThrow(ValidationError);
  });
});

describe('QC gate + checklist por unidad (OC-062)', () => {
  it('blocks packaging without an approved checklist and explains how to resolve', () => {
    const unit = makeUnit();
    const result = evaluateUnitQcGate(unit, undefined);
    expect(result.ready).toBe(false);
    expect(result.failing.map((c) => c.code)).toEqual(['qc_passed']);
    expect(result.checks[0]?.details).toContain('Registrar el checklist');
  });

  it('passes after the full checklist is approved', () => {
    const { project } = recordUnitQc(makeProject(), 'unit-1', {
      checklist: fullChecklist,
      byUserId: 'qc-1',
    });
    const result = evaluateUnitQcGate(makeUnit(), project.quality);
    expect(result.ready).toBe(true);
    expect(result.overridden).toBe(false);
  });

  it('a failing checklist point keeps the gate closed', () => {
    const { passed } = recordUnitQc(makeProject(), 'unit-1', {
      checklist: fullChecklist.map((c, i) => (i === 4 ? { ...c, passed: false } : c)),
    });
    expect(passed).toBe(false);
    const { project } = recordUnitQc(makeProject(), 'unit-1', {
      checklist: [{ code: 'finish', passed: false }],
    });
    expect(evaluateUnitQcGate(makeUnit(), project.quality).ready).toBe(false);
  });

  it('an open issue on the unit (or its mueble) blocks the gate until resolved', () => {
    const unitIssue = reportQualityIssue(makeProject(), {
      description: 'Cajón trabado',
      category: 'armado',
      moduleUnitId: 'unit-1',
    });
    const blocked = evaluateUnitQcGate(makeUnit(), unitIssue.job);
    expect(blocked.ready).toBe(false);
    expect(blocked.failing.map((c) => c.code)).toEqual(['qc_passed', 'no_open_issues']);

    const itemIssue = reportQualityIssue(makeProject(), {
      description: 'Puerta desalineada',
      category: 'armado',
      projectItemId: 'item-1',
    });
    expect(openIssuesForUnit(itemIssue.job, makeUnit())).toHaveLength(1);

    const resolved = transitionQualityIssue(unitIssue.project, unitIssue.issue.id, 'resolved', {});
    expect(openIssuesForUnit(resolved.job, makeUnit())).toHaveLength(0);
  });

  it('a supervisor override opens the gate auditably', () => {
    const { project } = overrideUnitQc(makeProject(), 'unit-1', {
      reason: 'Despacho urgente acordado con gerencia',
      byUserId: 'sup-1',
    });
    const result = evaluateUnitQcGate(makeUnit(), project.quality);
    expect(result.ready).toBe(true);
    expect(result.overridden).toBe(true);
    expect(unitQcRecord(project.quality, 'unit-1')?.override?.reason).toContain('urgente');
    // Un issue abierto sigue visible aunque el override habilite el avance.
    expect(result.checks[1]?.passed).toBe(true);
  });

  it('validates checklist shape and unit existence', () => {
    expect(() =>
      recordUnitQc(makeProject(), 'unit-1', { checklist: [] }),
    ).toThrow(ValidationError);
    expect(() =>
      recordUnitQc(makeProject(), 'unit-1', {
        checklist: [{ code: 'rotulo' as never, passed: true }],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      recordUnitQc(makeProject(), 'unit-x', { checklist: fullChecklist }),
    ).toThrow(ValidationError);
    expect(() =>
      overrideUnitQc(makeProject(), 'unit-1', { reason: '  ' }),
    ).toThrow(ValidationError);
  });
});

describe('reworkCostSummary', () => {
  it('accumulates material cost and labor minutes for job costing', () => {
    const job: QualityJob = {
      id: 'qjob-1',
      projectId: 'proj-1',
      issues: [],
      unitQc: [],
      createdAt: '2026-08-21T10:00:00Z',
      reworkActions: [
        { id: 'a1', issueId: 'i1', action: 'rework', materialCost: 25.5, laborMinutes: 30, at: '2026-08-21T10:00:00Z' },
        { id: 'a2', issueId: 'i2', action: 'scrap', materialCost: 300, laborMinutes: 45.5, at: '2026-08-21T11:00:00Z' },
      ],
    };
    expect(reworkCostSummary(job)).toEqual({ materialCost: 325.5, laborMinutes: 75.5 });
  });
});
