import { describe, it, expect } from 'vitest';
import { deriveOpsExceptions, OPS_EXCEPTION_KINDS } from './opsExceptions';
import type { OpsException } from './opsExceptions';
import type { Project } from './types';

const NOW = '2026-08-21T12:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'Cocina López',
    customerId: 'c-1',
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 10,
    status: 'produced',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    ...overrides,
  };
}

function kindsOf(exceptions: readonly OpsException[]): string[] {
  return exceptions.map((e) => e.kind);
}

describe('deriveOpsExceptions (OC-090)', () => {
  it('stays silent for quiet projects — no decorative exceptions', () => {
    const project = makeProject();
    expect(deriveOpsExceptions([project], { now: NOW })).toEqual([]);
  });

  it('ignores projects outside the active production window', () => {
    const draft = makeProject({ id: 'p-draft', status: 'draft' });
    const quoted = makeProject({ id: 'p-quoted', status: 'quoted' });
    expect(deriveOpsExceptions([draft, quoted], { now: NOW })).toEqual([]);
  });

  it('flags an overdue installation as critical with an actionable message', () => {
    const project = makeProject({ installationScheduledDate: '2026-08-19' });
    const [exception] = deriveOpsExceptions([project], { now: NOW });
    expect(exception?.kind).toBe('installation_risk');
    expect(exception?.severity).toBe('critical');
    expect(exception?.message).toContain('vencida');
    expect(exception?.actionHint).toContain('instalación');
    expect(exception?.truth).toBe('actual');
  });

  it('flags an installation within 3 days as critical and within 7 as warning', () => {
    const soon = deriveOpsExceptions([makeProject({ installationScheduledDate: '2026-08-23' })], { now: NOW });
    expect(soon[0]?.severity).toBe('critical');
    const week = deriveOpsExceptions([makeProject({ installationScheduledDate: '2026-08-27' })], { now: NOW });
    expect(week[0]?.severity).toBe('warning');
    const far = deriveOpsExceptions([makeProject({ installationScheduledDate: '2026-09-15' })], { now: NOW });
    expect(far).toEqual([]);
  });

  it('surfaces preliminary measures that would silently reach fabrication (OC-041)', () => {
    const project = makeProject({
      siteSurvey: {
        id: 'svy-1',
        projectId: 'p-1',
        revision: 1,
        createdAt: '2026-08-10T10:00:00Z',
        spaces: [
          { id: 'spc-1', name: 'Cocina', intent: 'preliminary', elements: [], photoIds: [] },
        ],
      },
    });
    const [exception] = deriveOpsExceptions([project], { now: NOW });
    expect(exception?.kind).toBe('survey_preliminary');
    expect(exception?.severity).toBe('critical');
    expect(exception?.message).toContain('Cocina');
  });

  it('flags a produced project whose design changed after the last export', () => {
    const project = makeProject({
      production: { revision: 7, revisionAt: '2026-08-16T10:00:00Z', lastExportRevision: 6, lastExportAt: '2026-08-15T10:00:00Z', lastExportFingerprint: 'fp-old' },
    });
    const [exception] = deriveOpsExceptions([project], { now: NOW });
    expect(exception?.kind).toBe('stale_revision');
    expect(exception?.severity).toBe('critical');
    expect(exception?.message).toContain('rev. 7');
  });

  it('flags an accepted project stalled beyond the window using real events', () => {
    const project = makeProject({
      status: 'accepted',
      events: [{ id: 'e1', projectId: 'p-1', type: 'quote_won', at: '2026-08-01T10:00:00Z', source: 'web' }],
    });
    const [exception] = deriveOpsExceptions([project], { now: NOW, stalledDays: 14 });
    expect(exception?.kind).toBe('stalled_queue');
    expect(exception?.message).toContain('sin avance');
  });

  it('does not flag a recently active accepted project', () => {
    const project = makeProject({
      status: 'accepted',
      events: [{ id: 'e1', projectId: 'p-1', type: 'engineering_documented', at: '2026-08-20T10:00:00Z', source: 'web' }],
    });
    expect(deriveOpsExceptions([project], { now: NOW })).toEqual([]);
  });

  it('flags high WIP from real part counts over the threshold', () => {
    const project = makeProject();
    const wip = new Map([['p-1', 35]]);
    const [exception] = deriveOpsExceptions([project], { now: NOW, wipPartCounts: wip, wipThreshold: 20 });
    expect(exception?.kind).toBe('high_wip');
    expect(exception?.message).toContain('35 piezas');
  });

  it('flags open quality issues as qc_rework', () => {
    const project = makeProject({
      quality: {
        id: 'qj-1',
        projectId: 'p-1',
        issues: [
          {
            id: 'qi-1',
            category: 'dimensional',
            description: 'Frente 3mm corto',
            status: 'open',
            reportedAt: '2026-08-20T10:00:00Z',
          },
        ],
        reworkActions: [],
        unitQc: [],
        createdAt: '2026-08-20T10:00:00Z',
      },
    });
    const [exception] = deriveOpsExceptions([project], { now: NOW });
    expect(exception?.kind).toBe('qc_rework');
    expect(exception?.message).toContain('1 issue');
  });

  it('flags cost overrun only when a baseline + complete actuals exist', () => {
    const baseline = {
      id: 'cb-1',
      projectId: 'p-1',
      capturedAt: '2026-08-10T10:00:00Z',
      source: {
        quoteSnapshotCapturedAt: '2026-08-09T10:00:00Z',
        projectVersion: 2,
        releaseId: 'rel-1',
        bomFingerprint: 'fp-1',
      },
      revenue: 1000,
      materialsCost: 400,
      edgeTotal: 50,
      hardwareTotal: 50,
      laborModular: 100,
      laborFixedCost: 50,
      estimatedDirectCost: 650,
      expectedGrossMargin: 350,
      expectedMarginPercent: 35,
    };
    const costing = {
      id: 'jc-1',
      projectId: 'p-1',
      baseline,
      laborRatePerHour: 60,
      timeEntries: [
        { id: 't-1', category: 'assembly' as const, minutes: 600, at: '2026-08-20T10:00:00Z', ratePerHour: 60 },
      ],
      otherCosts: [],
      createdAt: '2026-08-10T10:00:00Z',
    };
    const materials = new Map([['p-1', 200]]);
    const [exception] = deriveOpsExceptions([makeProject({ costing })], {
      now: NOW,
      materialConsumptions: materials,
      costOverrunPercent: 10,
    });
    // 600min * 60/h = 600 labor + 200 material = 800 actual vs 650 → +23%.
    expect(exception?.kind).toBe('cost_overrun');
    expect(exception?.message).toContain('23%');
    expect(exception?.truth).toBe('proxy');

    // Without material actuals the variance is incomplete → no exception.
    const honest = deriveOpsExceptions([makeProject({ costing })], {
      now: NOW,
      costOverrunPercent: 10,
    });
    expect(honest.filter((e) => e.kind === 'cost_overrun')).toEqual([]);
  });

  it('flags material shortages supplied by the shell from stock', () => {
    const shortages = new Map([['p-1', 4]]);
    const [exception] = deriveOpsExceptions([makeProject()], { now: NOW, shortageLines: shortages });
    expect(exception?.kind).toBe('material_shortage');
    expect(exception?.message).toContain('4 líneas');
    expect(exception?.actionHint).toContain('Almacén');
  });

  it('sorts critical before warning across projects', () => {
    const projects = [
      makeProject({ id: 'p-warning', name: 'Warning first', installationScheduledDate: '2026-08-27' }),
      makeProject({ id: 'p-critical', name: 'Critical second', installationScheduledDate: '2026-08-19' }),
    ];
    const exceptions = deriveOpsExceptions(projects, { now: NOW });
    expect(exceptions[0]?.severity).toBe('critical');
    expect(exceptions[1]?.severity).toBe('warning');
  });

  it('covers the canonical OC-090 vocabulary', () => {
    expect(OPS_EXCEPTION_KINDS).toEqual([
      'installation_risk',
      'survey_preliminary',
      'material_shortage',
      'stale_revision',
      'stalled_queue',
      'high_wip',
      'qc_rework',
      'cost_overrun',
    ]);
    const projects = [
      makeProject({
        id: 'p-all',
        name: 'All signals',
        status: 'accepted',
        installationScheduledDate: '2026-08-19',
        events: [{ id: 'e1', projectId: 'p-all', type: 'quote_won', at: '2026-08-01T10:00:00Z', source: 'web' }],
      }),
      makeProject({
        id: 'p-two',
        siteSurvey: {
          id: 'svy-2',
          projectId: 'p-two',
          revision: 1,
          createdAt: '2026-08-10T10:00:00Z',
          spaces: [{ id: 'spc-1', name: 'Cocina', intent: 'preliminary', elements: [], photoIds: [] }],
        },
      }),
    ];
    const exceptions = deriveOpsExceptions(projects, {
      now: NOW,
      shortageLines: new Map([['p-all', 2], ['p-two', 1]]),
      wipPartCounts: new Map([['p-two', 40]]),
      stalledDays: 14,
    });
    const derived = new Set(kindsOf(exceptions));
    for (const kind of OPS_EXCEPTION_KINDS) {
      if (kind === 'cost_overrun' || kind === 'stale_revision' || kind === 'qc_rework') continue;
      expect(derived.has(kind), `missing ${kind}`).toBe(true);
    }
  });
});
