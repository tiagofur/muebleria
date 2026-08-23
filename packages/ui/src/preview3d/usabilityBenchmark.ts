/**
 * F148 / #314 (P3D-8) — telemetría del benchmark de usabilidad de Proyectar.
 *
 * Captura una sesión de benchmark (#314): tareas canónicas versionadas,
 * timeline append-only de eventos (auto del editor + marcas del facilitador),
 * persistencia en localStorage que sobrevive recargas, export JSON y resumen
 * de métricas contra los targets iniciales del issue.
 *
 * Costo de diseño: sin sesión activa todos los track() son early-return y el
 * panel no se monta (flag `muebles_usability_benchmark`), así que el editor
 * normal paga cero (North Star §17-18).
 *
 * Data truth: las sesiones se etiquetan `real` (facilitador + usuario) o
 * `proxy` (automatización, p.ej. tests/smoke). Los tiempos proxy NO son
 * evidencia de usuario.
 */

export const USABILITY_BENCHMARK_FLAG = 'muebles_usability_benchmark';
const SESSION_STORAGE_KEY = 'muebles_usability_session.v1';
const SESSION_VERSION = 1;
export const USABILITY_TASKS_VERSION = 1;

export interface UsabilityTask {
  readonly id: string;
  readonly label: string;
  /** Qué le pide el facilitador al participante (protocolo #314). */
  readonly prompt: string;
}

/** Script canónico de #314 — 11 pasos. No reordenar sin recalibrar targets. */
export const USABILITY_TASKS: readonly UsabilityTask[] = [
  {
    id: 'open-project',
    label: 'Abrir Cocina',
    prompt: 'Abrí el proyecto de la cocina y entrá al diseño 3D',
  },
  {
    id: 'find-module',
    label: 'Encontrar bajo 600',
    prompt: 'Encontrá en la biblioteca un mueble bajo de 600 mm',
  },
  {
    id: 'place-module',
    label: 'Colocarlo en el muro',
    prompt: 'Colocá el mueble en el muro de la cocina',
  },
  {
    id: 'duplicate-align',
    label: 'Duplicar y alinear',
    prompt: 'Duplicá el mueble y alineá la corrida en el muro',
  },
  {
    id: 'edit-dimension',
    label: 'Editar dimensión',
    prompt: 'Cambiá una dimensión del mueble a tu criterio',
  },
  {
    id: 'add-aggregate',
    label: 'Añadir cajonera',
    prompt: 'Sumá una cajonera al ambiente',
  },
  {
    id: 'apply-front-material',
    label: 'Aplicar material a frentes',
    prompt: 'Cambiá el material de los frentes del mueble',
  },
  {
    id: 'apply-floor-material',
    label: 'Cambiar piso',
    prompt: 'Cambiá el material del piso del ambiente',
  },
  {
    id: 'switch-space',
    label: 'Cambiar de ambiente y volver',
    prompt: 'Andá a otro ambiente y volvé a la cocina',
  },
  {
    id: 'present',
    label: 'Presentar',
    prompt: 'Presentale el diseño al cliente',
  },
  {
    id: 'verify-price-bom',
    label: 'Verificar precio y BOM',
    prompt: 'Verificá el precio total y las piezas de un mueble',
  },
];

/**
 * Targets iniciales de #314. Se recalibran con evidencia (regla del issue):
 * `taskIds` compone el tiempo (p.ej. "primer módulo colocado" = encontrar +
 * colocar). `qualitative` describe el check no temporal.
 */
export interface UsabilityTarget {
  readonly id: string;
  readonly label: string;
  readonly taskIds: readonly string[];
  readonly maxSeconds?: number;
  readonly qualitative?: string;
}

export const USABILITY_TARGETS: readonly UsabilityTarget[] = [
  {
    id: 'first-module-placed',
    label: 'Primer módulo colocado',
    taskIds: ['find-module', 'place-module'],
    maxSeconds: 60,
  },
  {
    id: 'common-material',
    label: 'Material común aplicado',
    taskIds: ['apply-front-material'],
    maxSeconds: 15,
  },
  {
    id: 'common-aggregate',
    label: 'Agregado común añadido',
    taskIds: ['add-aggregate'],
    maxSeconds: 30,
  },
  {
    id: 'duplicate-align',
    label: 'Duplicar/alinear 3 unidades',
    taskIds: ['duplicate-align'],
    maxSeconds: 30,
  },
  {
    id: 'no-bom-internals',
    label: 'Cero internals del BOM',
    taskIds: ['verify-price-bom'],
    qualitative:
      'El participante verifica precio/piezas sin que el facilitador explique conceptos internos del BOM',
  },
];

export type UsabilityEventSource = 'auto' | 'facilitator';

export type UsabilityEventType =
  | 'session_start'
  | 'session_end'
  | 'task_start'
  | 'task_complete'
  | 'task_abandon'
  | 'help'
  | 'error_note'
  | 'library_search'
  | 'insert'
  | 'move_commit'
  | 'command'
  | 'dimension_edit'
  | 'option_change'
  | 'material_boards_apply'
  | 'material_ambient_apply'
  | 'space_switch'
  | 'space_add'
  | 'undo'
  | 'redo'
  | 'present_open'
  | 'present_close'
  | 'bom_detail'
  | 'click';

export type UsabilityEventDetail = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface UsabilityEvent {
  /** Epoch ms (Date.now): la sesión puede sobrevivir recargas. */
  readonly t: number;
  readonly type: UsabilityEventType;
  readonly source: UsabilityEventSource;
  /** Tarea vigente cuando ocurrió el evento (null = fuera de tarea). */
  readonly taskId: string | null;
  readonly detail?: UsabilityEventDetail;
}

export interface UsabilityTaskState {
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly abandonedAt?: number;
  readonly helpCount: number;
  readonly errorCount: number;
}

export type UsabilityTaskStates = Readonly<Record<string, UsabilityTaskState>>;

export interface UsabilitySession {
  readonly version: number;
  readonly tasksVersion: number;
  readonly participant: string;
  readonly source: 'real' | 'proxy';
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly events: readonly UsabilityEvent[];
  readonly tasks: UsabilityTaskStates;
}

// ── Estado del singleton ───────────────────────────────────────────────────

let session: UsabilitySession | null = null;
let restored = false;

function readFlag(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(USABILITY_BENCHMARK_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Flag de facilitador (el smoke lo setea con addInitScript; patrón seed perf). */
export function isUsabilityBenchmarkEnabled(): boolean {
  return readFlag();
}

function emptyTaskStates(): Record<string, UsabilityTaskState> {
  const out: Record<string, UsabilityTaskState> = {};
  for (const task of USABILITY_TASKS) {
    out[task.id] = { helpCount: 0, errorCount: 0 };
  }
  return out;
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!session) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage lleno/no disponible: la sesión sigue viva en memoria.
  }
}

function ensureRestored(): void {
  if (restored || typeof localStorage === 'undefined') {
    restored = true;
    return;
  }
  restored = true;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as UsabilitySession;
    if (parsed?.version !== SESSION_VERSION) return;
    session = parsed;
    // La captura de clicks se re-adhiere: la sesión restaurada sigue viva
    // tras una recarga (D4) y debe seguir registrando al participante.
    if (session.endedAt == null) attachClickTracking();
  } catch {
    // JSON corrupto: arrancar de cero.
  }
}

function pushEvent(
  type: UsabilityEventType,
  source: UsabilityEventSource,
  taskId: string | null,
  detail?: UsabilityEventDetail,
): void {
  if (!session) return;
  const event: UsabilityEvent = {
    t: Date.now(),
    type,
    source,
    taskId,
    ...(detail !== undefined ? { detail } : {}),
  };
  session = { ...session, events: [...session.events, event] };
  persist();
}

function taskState(taskId: string): UsabilityTaskState | null {
  return session?.tasks[taskId] ?? null;
}

/** Tarea vigente: la última iniciada que no se completó ni abandonó. */
export function currentUsabilityTaskId(): string | null {
  if (!session) return null;
  const open: string[] = [];
  for (const event of session.events) {
    if (event.type === 'task_start') {
      if (!open.includes(event.taskId ?? '')) open.push(event.taskId ?? '');
    } else if (
      event.type === 'task_complete' ||
      event.type === 'task_abandon'
    ) {
      const idx = open.indexOf(event.taskId ?? '');
      if (idx >= 0) open.splice(idx, 1);
    }
  }
  return open.at(-1) ?? null;
}

// ── API del facilitador ────────────────────────────────────────────────────

export function beginUsabilitySession(
  participant: string,
  source: 'real' | 'proxy',
): UsabilitySession {
  ensureRestored();
  const startedAt = Date.now();
  session = {
    version: SESSION_VERSION,
    tasksVersion: USABILITY_TASKS_VERSION,
    participant: participant.trim() || 'anónimo',
    source,
    startedAt,
    endedAt: null,
    events: [],
    tasks: emptyTaskStates(),
  };
  restored = true;
  attachClickTracking();
  pushEvent('session_start', 'facilitator', null, { participant, source });
  return session;
}

export function endUsabilitySession(): UsabilitySession | null {
  ensureRestored();
  if (!session || session.endedAt != null) return session;
  session = { ...session, endedAt: Date.now() };
  detachClickTracking();
  pushEvent('session_end', 'facilitator', null);
  return session;
}

export function startUsabilityTask(taskId: string): boolean {
  ensureRestored();
  if (!session || session.endedAt != null) return false;
  const state = taskState(taskId);
  if (!state || state.startedAt != null) return false;
  session = {
    ...session,
    tasks: { ...session.tasks, [taskId]: { ...state, startedAt: Date.now() } },
  };
  pushEvent('task_start', 'facilitator', taskId);
  return true;
}

export function completeUsabilityTask(taskId: string): boolean {
  ensureRestored();
  if (!session || session.endedAt != null) return false;
  const state = taskState(taskId);
  if (!state || state.startedAt == null || isTaskFinished(state)) return false;
  session = {
    ...session,
    tasks: {
      ...session.tasks,
      [taskId]: { ...state, completedAt: Date.now() },
    },
  };
  pushEvent('task_complete', 'facilitator', taskId);
  return true;
}

export function abandonUsabilityTask(
  taskId: string,
  reason?: string,
): boolean {
  ensureRestored();
  if (!session || session.endedAt != null) return false;
  const state = taskState(taskId);
  if (!state || state.startedAt == null || isTaskFinished(state)) return false;
  session = {
    ...session,
    tasks: {
      ...session.tasks,
      [taskId]: { ...state, abandonedAt: Date.now() },
    },
  };
  pushEvent('task_abandon', 'facilitator', taskId, reason ? { reason } : undefined);
  return true;
}

/** Ayuda solicitada por el participante (defaults: tarea vigente). */
export function noteUsabilityHelp(taskId?: string): boolean {
  ensureRestored();
  if (!session || session.endedAt != null) return false;
  const target = taskId ?? currentUsabilityTaskId();
  if (!target) return false;
  const state = taskState(target);
  if (!state) return false;
  session = {
    ...session,
    tasks: {
      ...session.tasks,
      [target]: { ...state, helpCount: state.helpCount + 1 },
    },
  };
  pushEvent('help', 'facilitator', target);
  return true;
}

/** Error observado por el facilitador (defaults: tarea vigente). */
export function noteUsabilityError(taskId?: string, note?: string): boolean {
  ensureRestored();
  if (!session || session.endedAt != null) return false;
  const target = taskId ?? currentUsabilityTaskId();
  if (!target) return false;
  const state = taskState(target);
  if (!state) return false;
  session = {
    ...session,
    tasks: {
      ...session.tasks,
      [target]: { ...state, errorCount: state.errorCount + 1 },
    },
  };
  pushEvent('error_note', 'facilitator', target, note ? { note } : undefined);
  return true;
}

function isTaskFinished(state: UsabilityTaskState): boolean {
  return state.completedAt != null || state.abandonedAt != null;
}

// ── Track automático (costuras del editor) ─────────────────────────────────

/**
 * Evento automático del editor. No-op sin sesión activa: el hot path normal
 * sólo paga un null-check.
 */
export function trackUsability(
  type: UsabilityEventType,
  detail?: UsabilityEventDetail,
): void {
  if (!session || session.endedAt != null) return;
  pushEvent(type, 'auto', currentUsabilityTaskId(), detail);
}

// ── Clicks del workspace ───────────────────────────────────────────────────

let clickListener: ((e: Event) => void) | null = null;

function attachClickTracking(): void {
  if (clickListener || typeof document === 'undefined') return;
  clickListener = (e: Event) => {
    const target = e.target as HTMLElement | null;
    // Los clicks del facilitador en el panel no cuentan como acciones del
    // participante.
    if (target?.closest('[data-usability-ui]')) return;
    trackUsability('click');
  };
  document.addEventListener('click', clickListener, { capture: true });
}

function detachClickTracking(): void {
  if (!clickListener || typeof document === 'undefined') return;
  document.removeEventListener('click', clickListener, { capture: true });
  clickListener = null;
}

// ── Lectura / export ───────────────────────────────────────────────────────

export function getUsabilitySession(): UsabilitySession | null {
  ensureRestored();
  return session;
}

export function exportUsabilitySessionJson(): string | null {
  ensureRestored();
  if (!session) return null;
  return JSON.stringify(session, null, 2);
}

/** Borra la sesión (persistida incluida). No borra el flag del facilitador. */
export function clearUsabilitySession(): void {
  session = null;
  restored = true;
  detachClickTracking();
  persist();
}

/** Test hook: resetea el singleton (no usar en código de producto). */
export function resetUsabilityModuleForTests(): void {
  session = null;
  restored = true;
  detachClickTracking();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * Test hook: simula una recarga — descarta el estado en memoria conservando
 * el storage, de modo que el próximo acceso restaura la sesión persistida.
 */
export function simulateUsabilityReloadForTests(): void {
  session = null;
  restored = false;
  detachClickTracking();
}

// ── Resumen / análisis ─────────────────────────────────────────────────────

export interface UsabilityTaskSummary {
  readonly taskId: string;
  readonly label: string;
  readonly completedCount: number;
  readonly abandonedCount: number;
  readonly incompleteCount: number;
  /** Duraciones de las tareas completadas, en segundos. */
  readonly seconds: readonly number[];
  readonly medianSeconds: number | null;
  readonly helpTotal: number;
  readonly errorTotal: number;
  readonly undoTotal: number;
  readonly redoTotal: number;
  readonly clickTotal: number;
}

export interface UsabilityTargetResult {
  readonly id: string;
  readonly label: string;
  readonly maxSeconds: number | null;
  readonly qualitative: string | null;
  /** Segundos por sesión (sólo sesiones con todas las tareas del target completadas). */
  readonly samplesSeconds: readonly number[];
  readonly medianSeconds: number | null;
  /** Fracción de muestras que cumple el target (null si no es temporal). */
  readonly metRatio: number | null;
}

export interface UsabilitySummary {
  readonly sessionCount: number;
  readonly sources: readonly ('real' | 'proxy')[];
  readonly tasks: readonly UsabilityTaskSummary[];
  readonly targets: readonly UsabilityTargetResult[];
}

function taskDurationSeconds(
  session: UsabilitySession,
  taskId: string,
): number | null {
  const state = session.tasks[taskId];
  if (state?.startedAt == null || state.completedAt == null) return null;
  return (state.completedAt - state.startedAt) / 1000;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(value * 100) / 100;
}

function countTaskEvents(
  session: UsabilitySession,
  taskId: string,
): { undo: number; redo: number; click: number } {
  let undo = 0;
  let redo = 0;
  let click = 0;
  for (const event of session.events) {
    if (event.taskId !== taskId) continue;
    if (event.type === 'undo') undo += 1;
    else if (event.type === 'redo') redo += 1;
    else if (event.type === 'click') click += 1;
  }
  return { undo, redo, click };
}

/**
 * Agrega sesiones (reales y/o proxy) en un resumen por tarea y por target.
 * Los tiempos de sesiones `proxy` no son evidencia de usuario: el llamador
 * decide cómo reportarlos (docs/proyectar-3d-usability-benchmark.md).
 */
export function summarizeUsabilitySessions(
  sessions: readonly UsabilitySession[],
): UsabilitySummary {
  const sources = [
    ...new Set(sessions.map((s) => s.source)),
  ] as ('real' | 'proxy')[];
  const tasks = USABILITY_TASKS.map((task) => {
    const seconds: number[] = [];
    let completed = 0;
    let abandoned = 0;
    let incomplete = 0;
    let helpTotal = 0;
    let errorTotal = 0;
    let undoTotal = 0;
    let redoTotal = 0;
    let clickTotal = 0;
    for (const s of sessions) {
      const state = s.tasks[task.id];
      if (state?.startedAt == null) continue;
      const duration = taskDurationSeconds(s, task.id);
      if (duration != null) {
        completed += 1;
        seconds.push(duration);
      } else if (state.abandonedAt != null) {
        abandoned += 1;
      } else {
        incomplete += 1;
      }
      helpTotal += state.helpCount;
      errorTotal += state.errorCount;
      const counts = countTaskEvents(s, task.id);
      undoTotal += counts.undo;
      redoTotal += counts.redo;
      clickTotal += counts.click;
    }
    return {
      taskId: task.id,
      label: task.label,
      completedCount: completed,
      abandonedCount: abandoned,
      incompleteCount: incomplete,
      seconds,
      medianSeconds: median(seconds),
      helpTotal,
      errorTotal,
      undoTotal,
      redoTotal,
      clickTotal,
    } satisfies UsabilityTaskSummary;
  });
  const targets = USABILITY_TARGETS.map((target) => {
    const samples: number[] = [];
    for (const s of sessions) {
      const parts = target.taskIds.map((id) => taskDurationSeconds(s, id));
      if (parts.some((p) => p == null)) continue;
      samples.push(parts.reduce<number>((acc, p) => acc + (p ?? 0), 0));
    }
    const med = median(samples);
    return {
      id: target.id,
      label: target.label,
      maxSeconds: target.maxSeconds ?? null,
      qualitative: target.qualitative ?? null,
      samplesSeconds: samples,
      medianSeconds: med,
      metRatio:
        target.maxSeconds == null || samples.length === 0
          ? null
          : samples.filter((s) => s <= target.maxSeconds!).length / samples.length,
    } satisfies UsabilityTargetResult;
  });
  return { sessionCount: sessions.length, sources, tasks, targets };
}

// ── Globales para smoke/facilitador (patrón perfTelemetry F147) ─────────────

declare global {
  interface Window {
    /** F148 — leído por tests/smoke/proyectar-usability.spec.ts y el facilitador. */
    __proyectarUsability?: {
      enabled: () => boolean;
      begin: typeof beginUsabilitySession;
      end: typeof endUsabilitySession;
      startTask: typeof startUsabilityTask;
      completeTask: typeof completeUsabilityTask;
      abandonTask: typeof abandonUsabilityTask;
      noteHelp: typeof noteUsabilityHelp;
      noteError: typeof noteUsabilityError;
      snapshot: typeof getUsabilitySession;
      exportJson: typeof exportUsabilitySessionJson;
      clear: typeof clearUsabilitySession;
      track: typeof trackUsability;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__proyectarUsability = {
    enabled: isUsabilityBenchmarkEnabled,
    begin: beginUsabilitySession,
    end: endUsabilitySession,
    startTask: startUsabilityTask,
    completeTask: completeUsabilityTask,
    abandonTask: abandonUsabilityTask,
    noteHelp: noteUsabilityHelp,
    noteError: noteUsabilityError,
    snapshot: getUsabilitySession,
    exportJson: exportUsabilitySessionJson,
    clear: clearUsabilitySession,
    track: trackUsability,
  };
}
