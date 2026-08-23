/**
 * F147 / #312 (P3D-6) — telemetría de performance de Proyectar (North Star §18).
 *
 * Agrega en un único lugar las métricas del hot path para el smoke de budget
 * (`tests/smoke/proyectar-perf.spec.ts`) y para debugging con el editor real:
 *
 *   - commits React del subtree del studio (count/total/max por fase);
 *   - draw calls / triangles del renderer (probe dentro del Canvas);
 *   - long tasks del main thread (PerformanceObserver);
 *   - latencia de feedback de drag (pointermove → próximo frame);
 *   - re-resoluciones BOM (project3dPreviewStats) y ms de resolveProject3DPreview.
 *
 * Costo de diseño: contadores y marks; el <Profiler> que alimenta
 * `recordProfilerCommit` es no-op en builds de producción (React lo ignora),
 * y el observer de long tasks sólo se instala con `initProyectarPerf()`
 * (useEffect del studio). Sin sampling de per-frame salvo el probe del Canvas
 * (throttled cada N frames).
 */

export type PerfRendererSample = {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly programs: number;
  readonly geometries: number;
};

export type PerfSamples = {
  readonly count: number;
  readonly lastMs: number;
  readonly maxMs: number;
  readonly p95Ms: number;
};

export type PerfTelemetrySnapshot = {
  readonly sceneId: string | null;
  readonly renderer: PerfRendererSample | null;
  readonly rendererMax: PerfRendererSample | null;
  readonly commits: {
    readonly count: number;
    readonly totalMs: number;
    readonly maxMs: number;
    readonly byPhase: Readonly<Record<string, number>>;
  };
  readonly longTasks: PerfSamples;
  readonly dragFeedback: PerfSamples;
  readonly bom: {
    readonly resolveCalls: number;
    readonly resolveSamplesMs: PerfSamples;
    readonly itemResolutions: number;
    readonly itemCacheHits: number;
    readonly missReasons: Readonly<Record<string, number>>;
  };
  readonly capturedAt: string;
};

type MutableSamples = {
  samples: number[];
  lastMs: number;
  maxMs: number;
};

const MAX_SAMPLES = 500;

function emptySamples(): MutableSamples {
  return { samples: [], lastMs: 0, maxMs: 0 };
}

function pushSample(box: MutableSamples, ms: number): void {
  box.lastMs = ms;
  box.maxMs = Math.max(box.maxMs, ms);
  if (box.samples.length >= MAX_SAMPLES) box.samples.shift();
  box.samples.push(ms);
}

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1,
  );
  return sorted[idx]!;
}

function freezeSamples(box: MutableSamples): PerfSamples {
  return {
    count: box.samples.length,
    lastMs: round(box.lastMs),
    maxMs: round(box.maxMs),
    p95Ms: round(p95(box.samples)),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const state = {
  sceneId: null as string | null,
  renderer: null as PerfRendererSample | null,
  rendererMax: null as PerfRendererSample | null,
  commits: {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    byPhase: {} as Record<string, number>,
  },
  longTasks: emptySamples(),
  dragFeedback: emptySamples(),
  bom: {
    resolveCalls: 0,
    resolveSamplesMs: emptySamples(),
    /** Último valor leído de project3dPreviewStats (delta computado por el lector). */
    itemResolutions: 0,
    itemCacheHits: 0,
    missReasons: {} as Record<string, number>,
  },
};

/** Fija qué escena se está midiendo (id de proyecto; null = sin escena). */
export function setPerfSceneId(id: string | null): void {
  state.sceneId = id;
}

/** Hook del React <Profiler> del studio (no-op en producción). */
export function recordProfilerCommit(
  phase: 'mount' | 'update' | 'nested-update',
  durationMs: number,
): void {
  state.commits.count += 1;
  state.commits.totalMs += durationMs;
  state.commits.maxMs = Math.max(state.commits.maxMs, durationMs);
  state.commits.byPhase[phase] = (state.commits.byPhase[phase] ?? 0) + 1;
}

/** Muestra del renderer.info (ScenePerfProbe dentro del Canvas). */
export function recordRendererSample(info: PerfRendererSample): void {
  state.renderer = info;
  const prev = state.rendererMax;
  state.rendererMax = {
    drawCalls: Math.max(prev?.drawCalls ?? 0, info.drawCalls),
    triangles: Math.max(prev?.triangles ?? 0, info.triangles),
    programs: Math.max(prev?.programs ?? 0, info.programs),
    geometries: Math.max(prev?.geometries ?? 0, info.geometries),
  };
}

/** Duración de una llamada a resolveProject3DPreview. */
export function recordBomResolve(
  ms: number,
  itemResolutions: number,
  itemCacheHits: number,
  missReasons?: Readonly<Record<string, number>>,
): void {
  state.bom.resolveCalls += 1;
  pushSample(state.bom.resolveSamplesMs, ms);
  state.bom.itemResolutions = itemResolutions;
  state.bom.itemCacheHits = itemCacheHits;
  if (missReasons) state.bom.missReasons = { ...missReasons };
}

let dragMarkPending = false;

/**
 * Marca el inicio de un move de drag (pointermove del canvas). El fin lo mide
 * `endDragFeedbackSample` en el próximo frame — la latencia percibida es
 * evento → frame pintado con el ghost movido.
 */
export function beginDragFeedbackSample(): void {
  if (dragMarkPending) return;
  dragMarkPending = true;
  performance.mark('__proyectar_drag_move');
}

export function endDragFeedbackSample(): void {
  if (!dragMarkPending) return;
  dragMarkPending = false;
  const entry = performance.getEntriesByName('__proyectar_drag_move').at(-1);
  if (!entry) return;
  const ms = performance.now() - entry.startTime;
  performance.clearMarks('__proyectar_drag_move');
  pushSample(state.dragFeedback, ms);
}

let longTaskObserver: PerformanceObserver | null = null;

/** Instala el observer de long tasks (idempotente; lo llama el studio). */
export function initProyectarPerf(): void {
  if (longTaskObserver) return;
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        pushSample(state.longTasks, entry.duration);
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    // Navegadores sin soporte de longtask: la métrica queda en 0 samples.
  }
}

export function snapshotProyectarPerf(): PerfTelemetrySnapshot {
  return {
    sceneId: state.sceneId,
    renderer: state.renderer,
    rendererMax: state.rendererMax,
    commits: {
      count: state.commits.count,
      totalMs: round(state.commits.totalMs),
      maxMs: round(state.commits.maxMs),
      byPhase: { ...state.commits.byPhase },
    },
    longTasks: freezeSamples(state.longTasks),
    dragFeedback: freezeSamples(state.dragFeedback),
    bom: {
      resolveCalls: state.bom.resolveCalls,
      resolveSamplesMs: freezeSamples(state.bom.resolveSamplesMs),
      itemResolutions: state.bom.itemResolutions,
      itemCacheHits: state.bom.itemCacheHits,
      missReasons: { ...state.bom.missReasons },
    },
    capturedAt: new Date().toISOString(),
  };
}

/** Resetea métricas de interacción entre fases del smoke (renderer/commits se conservan). */
export function resetInteractionSamples(): void {
  state.longTasks = emptySamples();
  state.dragFeedback = emptySamples();
}

declare global {
  interface Window {
    /** F147 — leído por tests/smoke/proyectar-perf.spec.ts. */
    __proyectarPerfSnapshot?: () => PerfTelemetrySnapshot;
    __proyectarPerfResetInteractions?: () => void;
  }
}

if (typeof window !== 'undefined') {
  window.__proyectarPerfSnapshot = snapshotProyectarPerf;
  window.__proyectarPerfResetInteractions = resetInteractionSamples;
}
