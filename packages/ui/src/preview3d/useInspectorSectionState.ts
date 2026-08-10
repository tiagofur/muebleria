/**
 * useInspectorSectionState — estado de colapso de las secciones del
 * PartInspector (preview 3D). Persiste el estado abierto/cerrado de cada
 * sección en localStorage para que la preferencia del usuario sobreviva
 * desmontajes y recargas.
 *
 * Es SSR-safe: si localStorage no existe (jsdom sin polyfill, SSR), cae al
 * default sin tirar. Self-contained en packages/ui (no depende de apps/web)
 * porque apps/desktop también consume el inspector.
 */

import { useCallback, useState } from 'react';

/** IDs estables de las secciones colapsables del inspector. */
export type InspectorSectionId =
  | 'dimensions'
  | 'material'
  | 'hardware'
  | 'finish'
  | 'advanced';

export const INSPECTOR_SECTION_IDS: readonly InspectorSectionId[] = [
  'dimensions',
  'material',
  'hardware',
  'finish',
  'advanced',
] as const;

/**
 * Estado por defecto: todas abiertas excepto "advanced" (datos técnicos que
 * no se usan en la mayoría de las cotizaciones).
 */
export const DEFAULT_SECTION_OPEN: Record<InspectorSectionId, boolean> = {
  dimensions: true,
  material: true,
  hardware: true,
  finish: true,
  advanced: false,
};

const STORAGE_KEY = 'muebles.part-inspector.sections.v1';

function readFromStorage(): Record<InspectorSectionId, boolean> | null {
  if (
    typeof globalThis === 'undefined' ||
    !('localStorage' in globalThis) ||
    typeof globalThis.localStorage?.getItem !== 'function'
  ) {
    return null;
  }
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Record<InspectorSectionId, boolean>>;
    // Merge con defaults para tolerar secciones nuevas que no estaban guardadas.
    return { ...DEFAULT_SECTION_OPEN, ...parsed };
  } catch {
    return null;
  }
}

function writeToStorage(state: Record<InspectorSectionId, boolean>): void {
  if (
    typeof globalThis === 'undefined' ||
    !('localStorage' in globalThis) ||
    typeof globalThis.localStorage?.setItem !== 'function'
  ) {
    return;
  }
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage lleno o bloqueado: no rompe la UX, solo no persiste.
  }
}

export type InspectorSectionState = {
  readonly isOpen: (id: InspectorSectionId) => boolean;
  readonly toggle: (id: InspectorSectionId) => void;
  readonly setOpen: (id: InspectorSectionId, open: boolean) => void;
};

/**
 * Hook de estado de colapso de secciones del inspector.
 *
 * Inicializa desde localStorage (si hay) y persiste en cada cambio. La
 * hidratación es lazy: el primer render usa el default y el estado
 * persistido se aplica via useState initializer (que corre una sola vez).
 */
export function useInspectorSectionState(): InspectorSectionState {
  const [state, setState] = useState<Record<InspectorSectionId, boolean>>(
    () => readFromStorage() ?? DEFAULT_SECTION_OPEN,
  );

  const setOpen = useCallback(
    (id: InspectorSectionId, open: boolean): void => {
      setState((prev) => {
        if (prev[id] === open) return prev;
        const next = { ...prev, [id]: open };
        writeToStorage(next);
        return next;
      });
    },
    [],
  );

  const toggle = useCallback(
    (id: InspectorSectionId): void => {
      setState((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        writeToStorage(next);
        return next;
      });
    },
    [],
  );

  const isOpen = useCallback((id: InspectorSectionId): boolean => state[id], [state]);

  return { isOpen, toggle, setOpen };
}
