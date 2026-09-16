import { describe, expect, it } from 'vitest';
import {
  engineeringStatus,
  engineeringEntryStatus,
  ENGINEERING_ENTRY_STATUS_LABELS_ES,
  createEngineeringLog,
  recordGeneration,
  recordSentToProduction,
  computeEngineeringDashboardStats,
  ENGINEERING_STATUS_LABELS_ES,
  type EngineeringLog,
  type ReleaseEngineeringState,
} from './engineering';

describe('EngineeringLog', () => {
  it('engineeringStatus returns pending when undefined', () => {
    expect(engineeringStatus(undefined)).toBe('pending');
  });

  it('engineeringStatus returns in_progress when log has no generatedAt', () => {
    const log: EngineeringLog = {
      startedBy: 'u1',
      startedAt: '2026-08-01T10:00:00Z',
      revision: 1,
    };
    expect(engineeringStatus(log)).toBe('in_progress');
  });

  it('engineeringStatus returns documented when log has generatedAt', () => {
    const log: EngineeringLog = {
      startedBy: 'u1',
      startedAt: '2026-08-01T10:00:00Z',
      generatedBy: 'u1',
      generatedAt: '2026-08-02T14:00:00Z',
      revision: 1,
    };
    expect(engineeringStatus(log)).toBe('documented');
  });

  it('createEngineeringLog creates a log with revision 1', () => {
    const log = createEngineeringLog('u1', '2026-08-01T10:00:00Z');
    expect(log.startedBy).toBe('u1');
    expect(log.startedAt).toBe('2026-08-01T10:00:00Z');
    expect(log.revision).toBe(1);
    expect(log.generatedAt).toBeUndefined();
  });

  it('recordGeneration sets generatedBy and generatedAt', () => {
    const log = createEngineeringLog('u1', '2026-08-01T10:00:00Z');
    const updated = recordGeneration(log, 'u2', '2026-08-02T14:00:00Z');
    expect(updated.generatedBy).toBe('u2');
    expect(updated.generatedAt).toBe('2026-08-02T14:00:00Z');
    expect(updated.revision).toBe(1);
    expect(updated.startedBy).toBe('u1');
  });

  it('recordSentToProduction sets fields and increments revision', () => {
    const log = createEngineeringLog('u1', '2026-08-01T10:00:00Z');
    const sent = recordSentToProduction(log, 'u3', '2026-08-03T08:00:00Z');
    expect(sent.sentToProductionBy).toBe('u3');
    expect(sent.sentToProductionAt).toBe('2026-08-03T08:00:00Z');
    expect(sent.revision).toBe(2);

    // Sending again increments again
    const sent2 = recordSentToProduction(sent, 'u3', '2026-08-04T09:00:00Z');
    expect(sent2.revision).toBe(3);
  });

  it('ENGINEERING_STATUS_LABELS_ES has all three labels', () => {
    expect(ENGINEERING_STATUS_LABELS_ES.pending).toBe('Pendiente');
    expect(ENGINEERING_STATUS_LABELS_ES.in_progress).toBe('En proceso');
    expect(ENGINEERING_STATUS_LABELS_ES.documented).toBe('Documentado');
    expect(Object.keys(ENGINEERING_STATUS_LABELS_ES)).toHaveLength(3);
  });
});

/* ── #738 — engineering entry status over the release authority ──────────── */

describe('engineeringEntryStatus (#738)', () => {
  const canonical = {
    resolvedProductionRelease: { source: 'canonical' as const, releaseId: 'P1', releaseNumber: 1 },
  };

  it('canonical release without a log is honestly pending', () => {
    expect(engineeringEntryStatus({ status: 'draft', ...canonical } as any)).toBe('pending');
  });

  it('a legacy log does not prove completion of the canonical release', () => {
    // Uncorrelated per-project evidence → unverified, never documented.
    const legacyLog: EngineeringLog = {
      startedBy: 'eng1',
      startedAt: '2026-08-11T10:00:00Z',
      generatedBy: 'eng1',
      generatedAt: '2026-08-12T10:00:00Z',
      revision: 1,
    };
    expect(engineeringEntryStatus({ status: 'accepted', ...canonical, engineeringLog: legacyLog } as any)).toBe(
      'unverified',
    );
  });

  it('non-canonical projects keep the log-derived status', () => {
    expect(engineeringEntryStatus({ status: 'accepted' } as any)).toBe('pending');
    expect(
      engineeringEntryStatus({
        status: 'accepted',
        engineeringLog: { startedBy: 'eng1', startedAt: '2026-08-11T10:00:00Z', revision: 1 },
      } as any),
    ).toBe('in_progress');
  });

  it('labels every entry status in Spanish', () => {
    expect(ENGINEERING_ENTRY_STATUS_LABELS_ES.pending).toBe('Pendiente');
    expect(ENGINEERING_ENTRY_STATUS_LABELS_ES.in_progress).toBe('En proceso');
    expect(ENGINEERING_ENTRY_STATUS_LABELS_ES.documented).toBe('Documentado');
    expect(ENGINEERING_ENTRY_STATUS_LABELS_ES.unverified).toBe('Sin verificar');
    expect(ENGINEERING_ENTRY_STATUS_LABELS_ES.completed).toBe('Completa');
  });
});

/* ── #740 — durable per-release engineering state ────────────────────────── */

describe('engineeringEntryStatus (#740 durable release evidence)', () => {
  const canonical = {
    resolvedProductionRelease: { source: 'canonical' as const, releaseId: 'P1', releaseNumber: 1 },
  };
  const durableInProgress: ReleaseEngineeringState = {
    releaseId: 'P1',
    status: 'in_progress',
    startedBy: 'eng1',
    startedAt: '2026-09-16T10:00:00Z',
    version: 1,
  };
  const durableCompleted: ReleaseEngineeringState = {
    ...durableInProgress,
    status: 'completed',
    completedBy: 'eng1',
    completedAt: '2026-09-16T12:00:00Z',
    version: 2,
  };

  it('the durable evidence of the resolved authority decides the entry status', () => {
    expect(
      engineeringEntryStatus({ status: 'draft', ...canonical, releaseEngineering: durableInProgress } as any),
    ).toBe('in_progress');
    expect(
      engineeringEntryStatus({ status: 'draft', ...canonical, releaseEngineering: durableCompleted } as any),
    ).toBe('completed');
  });

  it('a legacy log never overrides durable evidence and never fabricates completion', () => {
    // Durable in_progress wins over a legacy "documented" log: the per-project
    // log cannot prove anything about THIS release (#738 invariant preserved).
    const legacyDocumented: EngineeringLog = {
      startedBy: 'eng0',
      startedAt: '2026-08-01T10:00:00Z',
      generatedBy: 'eng0',
      generatedAt: '2026-08-02T10:00:00Z',
      revision: 1,
    };
    expect(
      engineeringEntryStatus({
        status: 'accepted',
        ...canonical,
        engineeringLog: legacyDocumented,
        releaseEngineering: durableInProgress,
      } as any),
    ).toBe('in_progress');
  });

  it('without durable evidence the #738 honest statuses stand', () => {
    expect(engineeringEntryStatus({ status: 'draft', ...canonical } as any)).toBe('pending');
    expect(
      engineeringEntryStatus({
        status: 'draft',
        ...canonical,
        engineeringLog: { startedBy: 'eng1', startedAt: '2026-08-11T10:00:00Z', revision: 1 },
      } as any),
    ).toBe('unverified');
  });

  it('pre-DT projects are untouched by the durable projection (absent there)', () => {
    expect(
      engineeringEntryStatus({
        status: 'accepted',
        engineeringLog: { startedBy: 'eng1', startedAt: '2026-08-11T10:00:00Z', revision: 1 },
      } as any),
    ).toBe('in_progress');
  });
});

describe('computeEngineeringDashboardStats', () => {
  const mockProjects: any[] = [
    {
      id: 'p1',
      name: 'Cocina A',
      status: 'accepted',
      hasDigitalThreadContext: false,
      createdAt: '2026-08-10T10:00:00Z',
      items: [{ quantity: 4 }],
    },
    {
      id: 'p2',
      name: 'Placard B',
      status: 'accepted',
      hasDigitalThreadContext: false,
      createdAt: '2026-08-10T10:00:00Z',
      items: [{ quantity: 2 }],
      engineeringLog: {
        startedBy: 'eng1',
        startedAt: '2026-08-11T10:00:00Z',
        revision: 1,
      },
    },
    {
      id: 'p3',
      name: 'Mueble TV C',
      status: 'accepted',
      hasDigitalThreadContext: false,
      createdAt: '2026-08-10T10:00:00Z',
      items: [{ quantity: 1 }],
      engineeringLog: {
        startedBy: 'eng1',
        startedAt: '2026-08-11T10:00:00Z',
        generatedBy: 'eng1',
        generatedAt: '2026-08-12T10:00:00Z',
        revision: 1,
      },
    },
    {
      id: 'p4',
      name: 'Vanitory D',
      status: 'produced',
      hasDigitalThreadContext: false,
      createdAt: '2026-08-10T10:00:00Z',
      items: [{ quantity: 1 }],
      engineeringLog: {
        startedBy: 'eng2',
        startedAt: '2026-08-11T10:00:00Z',
        generatedBy: 'eng2',
        generatedAt: '2026-08-12T10:00:00Z',
        sentToProductionBy: 'eng2',
        sentToProductionAt: '2026-08-13T10:00:00Z',
        revision: 2,
      },
    },
    {
      id: 'p_draft',
      name: 'Borrador E',
      status: 'draft',
      createdAt: '2026-08-10T10:00:00Z',
      items: [{ quantity: 5 }],
    },
  ];

  it('canonical P enters the engineering queue honestly (#738)', () => {
    // Invariant replaced by #738: the old test asserted "canonical P ⇒
    // almacen/produccion stage with isSentToProduction true" — it conflated
    // the manufacturing ACCESS authority (P unlocks the factory, #697, still
    // true) with engineering COMPLETION. P enables engineering preparation;
    // it does not complete it nor fabricate a legacy send. Durable
    // completion evidence per release is #740.
    const canonical = {
      ...mockProjects[0]!,
      status: 'draft',
      resolvedProductionRelease: { source: 'canonical' as const, releaseId: 'P1', releaseNumber: 1 },
    };
    const stats = computeEngineeringDashboardStats([canonical]);
    expect(stats.projects[0]?.stage).toBe('ingenieria');
    expect(stats.projects[0]?.status).toBe('pending');
    expect(stats.projects[0]?.isSentToProduction).toBe(false);
    expect(stats.projects[0]?.sentToProductionAt).toBeUndefined();
    expect(stats.totalActiveQueue).toBe(1);
    expect(stats.pendingCount).toBe(1);
    expect(stats.totalSent).toBe(0);
    // A legacy materials stamp never turns P into production work either.
    const stamped = computeEngineeringDashboardStats([{
      ...canonical,
      status: 'accepted',
      materialsRelease: { releasedBy: 'warehouse', releasedAt: '2026-09-07T20:00:00Z' },
    }]);
    expect(stamped.projects[0]?.stage).toBe('ingenieria');
    expect(stamped.projects[0]?.isSentToProduction).toBe(false);
  });

  it('an uncorrelated legacy log surfaces as unverified, never completed', () => {
    const canonical = {
      ...mockProjects[0]!,
      resolvedProductionRelease: { source: 'canonical' as const, releaseId: 'P1', releaseNumber: 1 },
      engineeringLog: {
        startedBy: 'eng1',
        startedAt: '2026-08-11T10:00:00Z',
        generatedBy: 'eng1',
        generatedAt: '2026-08-12T10:00:00Z',
        revision: 1,
      },
    };
    const stats = computeEngineeringDashboardStats([canonical]);
    expect(stats.projects[0]?.stage).toBe('ingenieria');
    expect(stats.projects[0]?.status).toBe('unverified');
    // Visible in the queue ⇒ present in the counters.
    expect(stats.pendingCount).toBe(1);
    expect(stats.totalActiveQueue).toBe(1);
  });

  it('a cancelled obra with a canonical release is not active engineering work', () => {
    const cancelled = {
      ...mockProjects[0]!,
      cancelledAt: '2026-09-01T10:00:00Z',
      resolvedProductionRelease: { source: 'canonical' as const, releaseId: 'P1', releaseNumber: 1 },
    };
    const stats = computeEngineeringDashboardStats([cancelled]);
    expect(stats.projects).toHaveLength(0);
    expect(stats.totalActiveQueue).toBe(0);
  });

  it('computes correct counts across statuses and excludes drafts', () => {
    const stats = computeEngineeringDashboardStats(mockProjects, '2026-08-14T10:00:00Z');
    expect(stats.pendingCount).toBe(1);
    expect(stats.inProgressCount).toBe(1);
    expect(stats.documentedCount).toBe(1);
    expect(stats.sentToProductionCount).toBe(1);
    expect(stats.totalActiveQueue).toBe(3);
    expect(stats.totalSent).toBe(1);
    expect(stats.totalModulesCalculated).toBe(8); // 4 + 2 + 1 + 1 (excludes draft)
  });

  it('calculates average wait time and cycle time', () => {
    const stats = computeEngineeringDashboardStats(mockProjects, '2026-08-14T10:00:00Z');
    expect(stats.avgWaitTimeHours).toBeGreaterThan(0);
    expect(stats.avgCycleTimeHours).toBeGreaterThan(0);
    expect(stats.avgRevisionCount).toBe(1.3); // (1 + 1 + 2) / 3 = 1.33 -> 1.3
  });

  it('summarizes workload by engineer', () => {
    const stats = computeEngineeringDashboardStats(mockProjects, '2026-08-14T10:00:00Z');
    const eng1 = stats.engineerWorkload.find((e) => e.engineerId === 'eng1');
    const eng2 = stats.engineerWorkload.find((e) => e.engineerId === 'eng2');

    expect(eng1).toBeDefined();
    expect(eng1?.activeCount).toBe(1);
    expect(eng1?.documentedCount).toBe(1);
    expect(eng1?.sentCount).toBe(0);

    expect(eng2).toBeDefined();
    expect(eng2?.sentCount).toBe(1);
    expect(eng2?.avgCycleHours).toBe(48); // 2026-08-11 to 2026-08-13 = 48h
  });

  it('identifies stagnant projects waiting too long', () => {
    const stats = computeEngineeringDashboardStats(mockProjects, '2026-08-18T10:00:00Z'); // 8 days later
    expect(stats.stagnantAlerts.length).toBeGreaterThan(0);
    const pendingAlert = stats.stagnantAlerts.find((a) => a.projectId === 'p1');
    expect(pendingAlert).toBeDefined();
    expect(pendingAlert?.isStagnant).toBe(true);
    expect(pendingAlert?.stagnantReason).toContain('días en cola');
  });

  it('attributes workload to assignedEngineerId on pending projects', () => {
    const projectsWithAssigned: any[] = [
      {
        id: 'p_assigned',
        name: 'Obra Asignada',
        status: 'accepted',
        hasDigitalThreadContext: false,
        createdAt: '2026-08-10T10:00:00Z',
        assignedEngineerId: 'eng_lead',
        items: [{ quantity: 3 }],
      },
    ];
    const stats = computeEngineeringDashboardStats(projectsWithAssigned, '2026-08-14T10:00:00Z');
    const workload = stats.engineerWorkload.find((e) => e.engineerId === 'eng_lead');
    expect(workload).toBeDefined();
    expect(workload?.activeCount).toBe(1);
  });
});

