/**
 * F148 / #314 — summarizer del benchmark: agregación por tarea y targets de
 * #314 sobre sesiones armadas a mano (función pura, sin DOM).
 */
import { describe, expect, it } from 'vitest';
import type { UsabilitySession } from './usabilityBenchmark';
import { summarizeUsabilitySessions } from './usabilityBenchmark';

let t = 0;

function tick(ms: number): number {
  t += ms;
  return t;
}

function buildSession(
  participant: string,
  source: 'real' | 'proxy',
  build: (api: {
    start: (id: string) => void;
    complete: (id: string, afterMs: number) => void;
    abandon: (id: string) => void;
    help: (id: string, n: number) => void;
    error: (id: string, n: number) => void;
    event: (type: string, taskId: string, n?: number) => void;
  }) => void,
): UsabilitySession {
  t = 0;
  const startedAt = tick(0);
  const events: UsabilitySession['events'][number][] = [];
  type MutableTaskState = {
    startedAt?: number;
    completedAt?: number;
    abandonedAt?: number;
    helpCount: number;
    errorCount: number;
  };
  const tasks: Record<string, MutableTaskState> = {};
  const touch = (id: string): MutableTaskState =>
    (tasks[id] ??= { helpCount: 0, errorCount: 0 });
  build({
    start: (id) => {
      touch(id).startedAt = tick(100);
      events.push({ t, type: 'task_start', source: 'facilitator', taskId: id });
    },
    complete: (id, afterMs) => {
      touch(id).startedAt ??= tick(0);
      tick(afterMs);
      touch(id).completedAt = t;
      events.push({ t, type: 'task_complete', source: 'facilitator', taskId: id });
    },
    abandon: (id) => {
      touch(id).startedAt ??= tick(0);
      touch(id).abandonedAt = tick(50);
      events.push({ t, type: 'task_abandon', source: 'facilitator', taskId: id });
    },
    help: (id, n) => {
      touch(id).helpCount += n;
    },
    error: (id, n) => {
      touch(id).errorCount += n;
    },
    event: (type, taskId, n = 1) => {
      for (let i = 0; i < n; i += 1) {
        events.push({
          t: tick(1),
          type: type as never,
          source: 'auto',
          taskId,
        });
      }
    },
  });
  return {
    version: 1,
    tasksVersion: 1,
    participant,
    source,
    startedAt,
    endedAt: tick(200),
    events,
    tasks,
  };
}

function summaryOf(id: string, sessions: readonly UsabilitySession[]) {
  const summary = summarizeUsabilitySessions(sessions);
  return summary.tasks.find((task) => task.taskId === id)!;
}

function targetOf(id: string, sessions: readonly UsabilitySession[]) {
  const summary = summarizeUsabilitySessions(sessions);
  return summary.targets.find((target) => target.id === id)!;
}

describe('summarizeUsabilitySessions — tareas', () => {
  it('agrega duraciones completadas y calcula mediana', () => {
    const a = buildSession('P1', 'real', (api) => {
      api.complete('find-module', 20_000);
      api.complete('place-module', 25_000);
    });
    const b = buildSession('P2', 'real', (api) => {
      api.complete('find-module', 40_000);
    });
    const find = summaryOf('find-module', [a, b]);
    expect(find.completedCount).toBe(2);
    expect(find.seconds).toEqual([20, 40]);
    expect(find.medianSeconds).toBe(30);
    expect(find.incompleteCount).toBe(0);
  });

  it('mediana par promedia los dos valores centrales', () => {
    const sessions = [10, 20, 30, 40].map((secs, i) =>
      buildSession(`P${i}`, 'real', (api) => api.complete('find-module', secs * 1000)),
    );
    expect(summaryOf('find-module', sessions).medianSeconds).toBe(25);
  });

  it('cuenta abandonos, incompletas, ayudas y errores', () => {
    const s = buildSession('P1', 'real', (api) => {
      api.complete('find-module', 5_000);
      api.abandon('place-module');
      api.start('duplicate-align');
      api.help('find-module', 2);
      api.error('place-module', 1);
    });
    const place = summaryOf('place-module', [s]);
    expect(place.abandonedCount).toBe(1);
    expect(place.medianSeconds).toBeNull();
    const dup = summaryOf('duplicate-align', [s]);
    expect(dup.incompleteCount).toBe(1);
    expect(summaryOf('find-module', [s]).helpTotal).toBe(2);
    expect(place.errorTotal).toBe(1);
  });

  it('atribuye undo/redo/clicks a la tarea del evento', () => {
    const s = buildSession('P1', 'real', (api) => {
      api.complete('find-module', 5_000);
      api.complete('place-module', 10_000);
      api.event('undo', 'place-module', 3);
      api.event('redo', 'place-module', 1);
      api.event('click', 'find-module', 7);
      api.event('click', 'place-module', 4);
    });
    const place = summaryOf('place-module', [s]);
    expect(place.undoTotal).toBe(3);
    expect(place.redoTotal).toBe(1);
    expect(place.clickTotal).toBe(4);
    expect(summaryOf('find-module', [s]).clickTotal).toBe(7);
  });

  it('reporta las fuentes de las sesiones', () => {
    const real = buildSession('P1', 'real', () => {});
    const proxy = buildSession('proxy-agent', 'proxy', () => {});
    const summary = summarizeUsabilitySessions([real, proxy]);
    expect(summary.sessionCount).toBe(2);
    expect([...summary.sources].sort()).toEqual(['proxy', 'real']);
  });
});

describe('summarizeUsabilitySessions — targets #314', () => {
  it('primer módulo colocado compone encontrar + colocar', () => {
    const fast = buildSession('P1', 'real', (api) => {
      api.complete('find-module', 15_000);
      api.complete('place-module', 30_000);
    });
    const slow = buildSession('P2', 'real', (api) => {
      api.complete('find-module', 40_000);
      api.complete('place-module', 35_000);
    });
    const target = targetOf('first-module-placed', [fast, slow]);
    expect(target.samplesSeconds).toEqual([45, 75]);
    expect(target.medianSeconds).toBe(60);
    expect(target.metRatio).toBe(0.5);
    expect(target.maxSeconds).toBe(60);
  });

  it('excluye sesiones donde falta alguna tarea del target', () => {
    const missing = buildSession('P1', 'real', (api) => {
      api.complete('find-module', 10_000);
      // place-module incompleta
    });
    expect(targetOf('first-module-placed', [missing]).samplesSeconds).toEqual([]);
    expect(targetOf('first-module-placed', [missing]).metRatio).toBeNull();
  });

  it('el target cualitativo no define metRatio temporal', () => {
    const s = buildSession('P1', 'real', (api) => {
      api.complete('verify-price-bom', 20_000);
    });
    const target = targetOf('no-bom-internals', [s]);
    expect(target.maxSeconds).toBeNull();
    expect(target.metRatio).toBeNull();
    expect(target.qualitative).toContain('BOM');
  });
});
