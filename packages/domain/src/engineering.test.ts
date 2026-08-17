import { describe, expect, it } from 'vitest';
import {
  engineeringStatus,
  createEngineeringLog,
  recordGeneration,
  recordSentToProduction,
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
