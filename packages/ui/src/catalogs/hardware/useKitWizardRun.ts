/**
 * Máquina de fases compartida por los asistentes de herrajes (#1416 juego,
 * #1546 sistema): form → running → done, con guard de cierre en vuelo y
 * reset al terminar — reabrir muestra el formulario limpio, nunca el
 * resultado de una corrida anterior (#1552). Los asistentes viven montados
 * mientras el catálogo existe (sólo cambia `open`), así que el reset no es
 * opcional. El reset de los campos propios de cada asistente va en
 * `resetForm`; el hook lo invoca junto con el de la máquina.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { HardwareVisualAssetBinding } from '@granete/domain';

export type KitWizardPhase = 'form' | 'running' | 'done';

/** Una subida de diseño pendiente del asistente (clave → archivo). */
export interface KitWizardRunTask {
  /** Clave del binding en el request (slot o bucket del plan). */
  readonly key: string;
  readonly file: File;
  /** Texto para el progreso, ej: «MBOX-N — izq». */
  readonly label: string;
  /** Nombre visible del diseño (displayName del asset). */
  readonly displayName: string;
}

export interface KitWizardRun<T> {
  readonly phase: KitWizardPhase;
  readonly running: boolean;
  readonly progress: string | null;
  readonly error: string | null;
  readonly result: T | null;
  readonly setError: (message: string | null) => void;
  readonly setProgress: (message: string | null) => void;
  /** Guard: ignora el cierre en vuelo; resetea si quedó en done; cierra. */
  readonly handleClose: () => void;
  /** Pasa a running con el error limpio (validaciones previas van antes). */
  readonly begin: () => void;
  readonly complete: (result: T) => void;
  readonly fail: (err: unknown, fallback: string) => void;
}

export function useKitWizardRun<T>(opts: {
  /** Visibilidad del modal: al reabrir, una corrida en «done» se resetea. */
  readonly open: boolean;
  readonly onClose: () => void;
  /** Reset de los campos del formulario (archivos incluidos). */
  readonly resetForm: () => void;
}): KitWizardRun<T> {
  const { open, onClose, resetForm } = opts;
  const [phase, setPhase] = useState<KitWizardPhase>('form');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const reset = useCallback(() => {
    resetForm();
    setPhase('form');
    setProgress(null);
    setError(null);
    setResult(null);
  }, [resetForm]);

  const handleClose = useCallback(() => {
    if (phase === 'running') return; // Sin cancelación en vuelo (#1416 v1).
    if (phase === 'done') reset();
    onClose();
  }, [phase, reset, onClose]);

  // El asistente vive montado mientras el catálogo existe: cualquier camino
  // que abra el modal con una corrida en «done» la resetea (#1552), no sólo
  // el cierre por handleClose.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (open && phaseRef.current === 'done') reset();
  }, [open, reset]);

  const begin = useCallback(() => {
    setError(null);
    setPhase('running');
  }, []);

  const complete = useCallback((created: T) => {
    setResult(created);
    setPhase('done');
    setProgress(null);
  }, []);

  const fail = useCallback((err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback);
    setPhase('form');
    setProgress(null);
  }, []);

  return {
    phase,
    running: phase === 'running',
    progress,
    error,
    result,
    setError,
    setProgress,
    handleClose,
    begin,
    complete,
    fail,
  };
}

/**
 * Ejecuta las subidas del asistente en orden, con progreso por pieza.
 * Con la lista vacía no llama a `upload` nunca.
 */
export async function uploadKitWizardDesigns(
  tasks: readonly KitWizardRunTask[],
  upload: (file: File, displayName: string) => Promise<HardwareVisualAssetBinding>,
  onProgress: (message: string) => void,
): Promise<Record<string, HardwareVisualAssetBinding>> {
  const designs: Record<string, HardwareVisualAssetBinding> = {};
  for (const task of tasks) {
    onProgress(`Subiendo ${task.label}…`);
    designs[task.key] = await upload(task.file, task.displayName);
  }
  return designs;
}
