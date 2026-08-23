/**
 * @vitest-environment jsdom
 *
 * F148 / #314 — sesión de benchmark de usabilidad: ciclo de vida, reglas de
 * tareas, persistencia que sobrevive recargas, clicks y API window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  USABILITY_BENCHMARK_FLAG,
  USABILITY_TASKS,
  USABILITY_TASKS_VERSION,
  abandonUsabilityTask,
  beginUsabilitySession,
  clearUsabilitySession,
  completeUsabilityTask,
  currentUsabilityTaskId,
  endUsabilitySession,
  exportUsabilitySessionJson,
  getUsabilitySession,
  isUsabilityBenchmarkEnabled,
  noteUsabilityError,
  noteUsabilityHelp,
  resetUsabilityModuleForTests,
  simulateUsabilityReloadForTests,
  startUsabilityTask,
  trackUsability,
} from './usabilityBenchmark';

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(key) ?? null,
    key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorageMock();
  resetUsabilityModuleForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-23T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isUsabilityBenchmarkEnabled', () => {
  it('está apagado por defecto y se enciende con el flag del facilitador', () => {
    expect(isUsabilityBenchmarkEnabled()).toBe(false);
    localStorage.setItem(USABILITY_BENCHMARK_FLAG, '1');
    expect(isUsabilityBenchmarkEnabled()).toBe(true);
  });
});

describe('beginUsabilitySession', () => {
  it('registra session_start con participante y fuente', () => {
    const session = beginUsabilitySession('P1', 'real');
    expect(session.participant).toBe('P1');
    expect(session.source).toBe('real');
    expect(session.tasksVersion).toBe(USABILITY_TASKS_VERSION);
    expect(session.endedAt).toBeNull();
    expect(session.events).toHaveLength(1);
    expect(session.events[0]).toMatchObject({
      type: 'session_start',
      source: 'facilitator',
      taskId: null,
    });
  });

  it('normaliza participante vacío a anónimo', () => {
    const session = beginUsabilitySession('   ', 'proxy');
    expect(session.participant).toBe('anónimo');
  });

  it('expone la API en window (patrón perfTelemetry)', () => {
    expect(typeof window.__proyectarUsability?.begin).toBe('function');
    expect(typeof window.__proyectarUsability?.snapshot).toBe('function');
  });
});

describe('marcas de tarea del facilitador', () => {
  it('start → track con contexto → complete registra duración', () => {
    beginUsabilitySession('P1', 'real');
    expect(startUsabilityTask('find-module')).toBe(true);
    expect(currentUsabilityTaskId()).toBe('find-module');
    vi.advanceTimersByTime(12_000);
    trackUsability('library_search', { query: 'bajo' });
    vi.advanceTimersByTime(3_000);
    expect(completeUsabilityTask('find-module')).toBe(true);

    const session = getUsabilitySession()!;
    const state = session.tasks['find-module']!;
    expect(state.startedAt).toBe(Date.now() - 15_000);
    expect(state.completedAt).toBe(Date.now());
    const search = session.events.find((e) => e.type === 'library_search');
    expect(search?.taskId).toBe('find-module');
    expect(search?.detail).toEqual({ query: 'bajo' });
    expect(currentUsabilityTaskId()).toBeNull();
  });

  it('rechaza doble start, complete sin start y complete tras abandono', () => {
    beginUsabilitySession('P1', 'real');
    expect(startUsabilityTask('open-project')).toBe(true);
    expect(startUsabilityTask('open-project')).toBe(false);
    expect(completeUsabilityTask('place-module')).toBe(false);
    expect(abandonUsabilityTask('open-project', 'no encontró el botón')).toBe(
      true,
    );
    expect(completeUsabilityTask('open-project')).toBe(false);
    const session = getUsabilitySession()!;
    expect(session.tasks['open-project']!.abandonedAt).not.toBeNull();
    const abandon = session.events.find((e) => e.type === 'task_abandon');
    expect(abandon?.detail).toEqual({ reason: 'no encontró el botón' });
  });

  it('la tarea vigente vuelve a la anterior al completar la anidada', () => {
    beginUsabilitySession('P1', 'real');
    startUsabilityTask('find-module');
    startUsabilityTask('place-module');
    expect(currentUsabilityTaskId()).toBe('place-module');
    completeUsabilityTask('place-module');
    expect(currentUsabilityTaskId()).toBe('find-module');
  });

  it('help y error acumulan sobre la tarea vigente por defecto', () => {
    beginUsabilitySession('P1', 'real');
    startUsabilityTask('apply-front-material');
    noteUsabilityHelp();
    noteUsabilityHelp();
    noteUsabilityError(undefined, 'aplicó al interior');
    const state = getUsabilitySession()!.tasks['apply-front-material']!;
    expect(state.helpCount).toBe(2);
    expect(state.errorCount).toBe(1);
    expect(noteUsabilityHelp('tarea-inexistente')).toBe(false);
  });
});

describe('trackUsability', () => {
  it('es no-op sin sesión activa (costo cero en uso normal)', () => {
    expect(() => trackUsability('insert', { moduleId: 'm1' })).not.toThrow();
    expect(getUsabilitySession()).toBeNull();
  });

  it('no acepta eventos tras cerrar la sesión', () => {
    beginUsabilitySession('P1', 'real');
    endUsabilitySession();
    trackUsability('insert');
    const session = getUsabilitySession()!;
    expect(session.endedAt).not.toBeNull();
    expect(session.events.filter((e) => e.type === 'insert')).toHaveLength(0);
  });
});

describe('clicks del participante', () => {
  it('cuentan como eventos click con la tarea vigente', () => {
    beginUsabilitySession('P1', 'real');
    startUsabilityTask('place-module');
    document.body.click();
    const session = getUsabilitySession()!;
    const clicks = session.events.filter((e) => e.type === 'click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.taskId).toBe('place-module');
  });

  it('ignoran los clicks del facilitador dentro del panel', () => {
    beginUsabilitySession('P1', 'real');
    const panel = document.createElement('div');
    panel.setAttribute('data-usability-ui', '');
    document.body.appendChild(panel);
    panel.click();
    expect(
      getUsabilitySession()!.events.filter((e) => e.type === 'click'),
    ).toHaveLength(0);
  });

  it('dejan de contar al cerrar la sesión', () => {
    beginUsabilitySession('P1', 'real');
    endUsabilitySession();
    document.body.click();
    expect(
      getUsabilitySession()!.events.filter((e) => e.type === 'click'),
    ).toHaveLength(0);
  });
});

describe('persistencia', () => {
  it('sobrevive una recarga y sigue registrando', () => {
    beginUsabilitySession('P1', 'real');
    startUsabilityTask('find-module');
    noteUsabilityHelp();
    const persistedAt = getUsabilitySession()!;

    simulateUsabilityReloadForTests();
    const restored = getUsabilitySession()!;
    expect(restored).toEqual(persistedAt);

    trackUsability('insert', { moduleId: 'mod-bajo-600' });
    expect(getUsabilitySession()!.events.at(-1)!.type).toBe('insert');
    expect(currentUsabilityTaskId()).toBe('find-module');
  });

  it('export devuelve JSON válido y clear borra estado y storage', () => {
    beginUsabilitySession('P1', 'proxy');
    const json = exportUsabilitySessionJson()!;
    expect(JSON.parse(json).participant).toBe('P1');
    clearUsabilitySession();
    expect(getUsabilitySession()).toBeNull();
    expect(exportUsabilitySessionJson()).toBeNull();
    expect(localStorage.getItem('muebles_usability_session.v1')).toBeNull();
  });
});

describe('USABILITY_TASKS', () => {
  it('contiene los 11 pasos del script canónico de #314 sin ids duplicados', () => {
    expect(USABILITY_TASKS).toHaveLength(11);
    expect(new Set(USABILITY_TASKS.map((t) => t.id)).size).toBe(11);
    expect(USABILITY_TASKS.map((t) => t.id)).toEqual([
      'open-project',
      'find-module',
      'place-module',
      'duplicate-align',
      'edit-dimension',
      'add-aggregate',
      'apply-front-material',
      'apply-floor-material',
      'switch-space',
      'present',
      'verify-price-bom',
    ]);
    for (const task of USABILITY_TASKS) {
      expect(task.prompt.trim().length).toBeGreaterThan(0);
    }
  });
});
