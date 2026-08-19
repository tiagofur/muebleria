import { describe, expect, it } from 'vitest';
import {
  engineeringStatus,
  createEngineeringLog,
  recordGeneration,
  recordSentToProduction,
  computeEngineeringDashboardStats,
  ENGINEERING_STATUS_LABELS_ES,
  type EngineeringLog,
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

describe('computeEngineeringDashboardStats', () => {
  const mockProjects: any[] = [
    {
      id: 'p1',
      name: 'Cocina A',
      status: 'accepted',
      createdAt: '2026-08-10T10:00:00Z',
      items: [{ quantity: 4 }],
    },
    {
      id: 'p2',
      name: 'Placard B',
      status: 'accepted',
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
});

