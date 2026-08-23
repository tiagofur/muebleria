/**
 * UsabilityBenchmarkPanel — panel del facilitador del benchmark de usabilidad
 * de Proyectar (F148 / #314, protocolo en
 * docs/proyectar-3d-usability-benchmark.md).
 *
 * Sólo se monta con el flag `muebles_usability_benchmark=1` (costo cero en
 * uso normal). Vive por encima de las superficies del producto (incluido el
 * studio y la presentación) para que el facilitador marque las tareas del
 * script canónico sin interrumpir al participante.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ClipboardCopy,
  Download,
  X,
} from 'lucide-react';
import {
  USABILITY_TASKS,
  abandonUsabilityTask,
  beginUsabilitySession,
  clearUsabilitySession,
  completeUsabilityTask,
  endUsabilitySession,
  exportUsabilitySessionJson,
  getUsabilitySession,
  isUsabilityBenchmarkEnabled,
  noteUsabilityError,
  noteUsabilityHelp,
  startUsabilityTask,
} from '../preview3d/usabilityBenchmark';
import type { UsabilitySession } from '../preview3d/usabilityBenchmark';
import './usabilityBenchmarkPanel.css';

type TaskStatus = 'pending' | 'active' | 'completed' | 'abandoned';

function statusOf(session: UsabilitySession | null, taskId: string): TaskStatus {
  const state = session?.tasks[taskId];
  if (!state || state.startedAt == null) return 'pending';
  if (state.completedAt != null) return 'completed';
  if (state.abandonedAt != null) return 'abandoned';
  return 'active';
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  active: 'En curso',
  completed: 'Completada',
  abandoned: 'Abandonada',
};

function currentTaskId(session: UsabilitySession | null): string | null {
  if (!session) return null;
  const open: string[] = [];
  for (const event of session.events) {
    if (event.type === 'task_start') {
      if (!open.includes(event.taskId ?? '')) open.push(event.taskId ?? '');
    } else if (event.type === 'task_complete' || event.type === 'task_abandon') {
      const idx = open.indexOf(event.taskId ?? '');
      if (idx >= 0) open.splice(idx, 1);
    }
  }
  return open.at(-1) ?? null;
}

function elapsedLabel(from: number, to: number | null): string {
  const secs = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function completedCount(session: UsabilitySession): number {
  return USABILITY_TASKS.filter((t) => statusOf(session, t.id) === 'completed')
    .length;
}

export function UsabilityBenchmarkPanel() {
  const [enabled] = useState(isUsabilityBenchmarkEnabled);
  const [expanded, setExpanded] = useState(true);
  const [participant, setParticipant] = useState('');
  const [manualTaskId, setManualTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El módulo no emite eventos: refresco liviano del panel (sólo con flag).
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    },
    [],
  );

  if (!enabled) return null;

  const session = getUsabilitySession();
  const refresh = () => setTick((t) => t + 1);
  const flash = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 2500);
  };

  const derivedTaskId =
    currentTaskId(session) ??
    USABILITY_TASKS.find((t) => statusOf(session, t.id) === 'pending')?.id ??
    USABILITY_TASKS.at(-1)!.id;
  const effectiveTaskId =
    manualTaskId && session?.tasks[manualTaskId] ? manualTaskId : derivedTaskId;
  const effectiveTask = USABILITY_TASKS.find((t) => t.id === effectiveTaskId)!;
  const effectiveStatus = statusOf(session, effectiveTaskId);

  const exportJson = () => {
    const json = exportUsabilitySessionJson();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const day = new Date(session?.startedAt ?? Date.now())
      .toISOString()
      .slice(0, 10);
    anchor.href = url;
    anchor.download = `usabilidad-${session?.participant ?? 'sesion'}-${day}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    flash('JSON descargado');
  };

  const copyJson = async () => {
    const json = exportUsabilitySessionJson();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      flash('JSON copiado al portapapeles');
    } catch {
      flash('No se pudo copiar — usá Exportar');
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="btn btn--small usability-panel__toggle"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        title="Mostrar panel del benchmark de usabilidad"
        data-usability-ui
        data-testid="usability-toggle"
      >
        <Activity size={14} strokeWidth={1.5} aria-hidden /> Benchmark
      </button>
    );
  }

  return (
    <aside
      className="usability-panel"
      aria-label="Benchmark de usabilidad — panel del facilitador"
      data-usability-ui
      data-testid="usability-panel"
    >
      <header className="usability-panel__header">
        <span className="usability-panel__title">
          <Activity size={14} strokeWidth={1.5} aria-hidden /> Benchmark de
          usabilidad
        </span>
        {session ? (
          <span
            className="usability-panel__meta"
            data-testid="usability-progress"
          >
            {session.participant} · {completedCount(session)}/11 ·{' '}
            {elapsedLabel(session.startedAt, session.endedAt)}
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setExpanded(false)}
          aria-label="Ocultar panel del benchmark"
          title="Ocultar panel del benchmark"
        >
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      </header>

      {!session ? (
        <div className="usability-panel__body">
          <label className="usability-panel__field">
            <span>Participante</span>
            <input
              type="text"
              value={participant}
              onChange={(e) => setParticipant(e.target.value)}
              placeholder="P1, P2… (anónimo para el reporte)"
              data-testid="usability-participant"
            />
          </label>
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => {
              beginUsabilitySession(participant || 'P?', 'real');
              setManualTaskId(null);
              refresh();
            }}
            data-testid="usability-start-session"
          >
            Iniciar sesión
          </button>
        </div>
      ) : session.endedAt == null ? (
        <div className="usability-panel__body">
          <label className="usability-panel__field">
            <span>Tarea</span>
            <select
              value={effectiveTaskId}
              onChange={(e) => setManualTaskId(e.target.value)}
              data-testid="usability-task-select"
            >
              {USABILITY_TASKS.map((task, index) => {
                const taskStatus = statusOf(session, task.id);
                return (
                  <option key={task.id} value={task.id}>
                    {index + 1}. {task.label} — {STATUS_LABEL[taskStatus]}
                  </option>
                );
              })}
            </select>
          </label>

          <p
            className="usability-panel__prompt"
            data-testid="usability-task-prompt"
          >
            {effectiveTask.prompt}
          </p>

          {effectiveStatus === 'pending' ? (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => {
                startUsabilityTask(effectiveTaskId);
                refresh();
              }}
              data-testid="usability-task-start"
            >
              Iniciar «{effectiveTask.label}»
            </button>
          ) : effectiveStatus === 'active' ? (
            <div className="usability-panel__actions">
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => {
                  completeUsabilityTask(effectiveTaskId);
                  setManualTaskId(null);
                  refresh();
                }}
                data-testid="usability-task-complete"
              >
                <CheckCircle2 size={14} strokeWidth={1.5} aria-hidden />{' '}
                Completada
              </button>
              <button
                type="button"
                className="btn btn--danger btn--small"
                onClick={() => {
                  abandonUsabilityTask(effectiveTaskId, 'abandonada por el facilitador');
                  setManualTaskId(null);
                  refresh();
                }}
                data-testid="usability-task-abandon"
              >
                Abandonada
              </button>
              <div className="usability-panel__counters">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    noteUsabilityHelp(effectiveTaskId);
                    refresh();
                  }}
                  data-testid="usability-help"
                >
                  + Ayuda{' '}
                  {session.tasks[effectiveTaskId]?.helpCount
                    ? `(${session.tasks[effectiveTaskId]!.helpCount})`
                    : ''}
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    noteUsabilityError(effectiveTaskId);
                    refresh();
                  }}
                  data-testid="usability-error"
                >
                  + Error{' '}
                  {session.tasks[effectiveTaskId]?.errorCount
                    ? `(${session.tasks[effectiveTaskId]!.errorCount})`
                    : ''}
                </button>
              </div>
            </div>
          ) : (
            <p className="usability-panel__hint">
              {effectiveTask.label}: {STATUS_LABEL[effectiveStatus].toLowerCase()}{' '}
              en{' '}
              {elapsedLabel(
                session.tasks[effectiveTaskId]?.startedAt ?? session.startedAt,
                session.tasks[effectiveTaskId]?.completedAt ??
                  session.tasks[effectiveTaskId]?.abandonedAt ??
                  null,
              )}
            </p>
          )}

          <div className="usability-panel__footer">
            <button
              type="button"
              className="btn btn--small"
              onClick={exportJson}
              data-testid="usability-export"
            >
              <Download size={14} strokeWidth={1.5} aria-hidden /> Exportar
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={copyJson}
              data-testid="usability-copy"
            >
              <ClipboardCopy size={14} strokeWidth={1.5} aria-hidden /> Copiar
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              onClick={() => {
                endUsabilitySession();
                refresh();
              }}
              data-testid="usability-end-session"
            >
              Terminar sesión
            </button>
          </div>
        </div>
      ) : (
        <div className="usability-panel__body">
          <p className="usability-panel__hint">
            Sesión de {session.participant} cerrada ·{' '}
            {completedCount(session)}/11 tareas completadas ·{' '}
            {elapsedLabel(session.startedAt, session.endedAt)} en total.
          </p>
          <div className="usability-panel__footer">
            <button
              type="button"
              className="btn btn--small"
              onClick={exportJson}
              data-testid="usability-export"
            >
              <Download size={14} strokeWidth={1.5} aria-hidden /> Exportar
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={copyJson}
              data-testid="usability-copy"
            >
              <ClipboardCopy size={14} strokeWidth={1.5} aria-hidden /> Copiar
            </button>
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => {
                clearUsabilitySession();
                setParticipant('');
                setManualTaskId(null);
                refresh();
              }}
              data-testid="usability-new-session"
            >
              Nueva sesión
            </button>
          </div>
        </div>
      )}

      {status ? (
        <p className="usability-panel__status" aria-live="polite" data-testid="usability-status">
          {status}
        </p>
      ) : null}
    </aside>
  );
}
