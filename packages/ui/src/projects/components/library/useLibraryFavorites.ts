/**
 * useLibraryFavorites — favoritos, recientes y pins de taller para la
 * biblioteca lateral de Proyectar (F141 / #309). v1 persiste en localStorage
 * (patrón useInspectorSectionState); sync per-user es deuda v2 documentada
 * en el issue. SSR-safe: sin localStorage cae a estado en memoria.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'muebles.proyectar.library.v1';
const RECENT_LIMIT = 8;

export type LibraryCollectionsState = {
  readonly favorites: readonly string[];
  readonly workshop: readonly string[];
  readonly recent: readonly string[];
};

export type LibraryCollections = LibraryCollectionsState & {
  readonly isFavorite: (moduleId: string) => boolean;
  readonly isWorkshopPinned: (moduleId: string) => boolean;
  readonly toggleFavorite: (moduleId: string) => void;
  readonly toggleWorkshopPin: (moduleId: string) => void;
  /** Registra una inserción (llama el studio al crear el ítem). */
  readonly trackInsert: (moduleId: string) => void;
};

const DEFAULT_STATE: LibraryCollectionsState = {
  favorites: [],
  workshop: [],
  recent: [],
};

function sanitizeIds(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function readFromStorage(): LibraryCollectionsState | null {
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
    const parsed = JSON.parse(raw) as Partial<LibraryCollectionsState>;
    return {
      favorites: sanitizeIds(parsed.favorites),
      workshop: sanitizeIds(parsed.workshop),
      recent: sanitizeIds(parsed.recent).slice(0, RECENT_LIMIT),
    };
  } catch {
    return null;
  }
}

function writeToStorage(state: LibraryCollectionsState): void {
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

function toggleIn(list: readonly string[], id: string): readonly string[] {
  return list.includes(id)
    ? list.filter((x) => x !== id)
    : [...list, id];
}

export function useLibraryCollections(): LibraryCollections {
  const [state, setState] = useState<LibraryCollectionsState>(
    () => readFromStorage() ?? DEFAULT_STATE,
  );

  // Persist outside the setState updater: StrictMode invokes updaters twice,
  // and side effects there are fragile. The effect writes the settled state.
  useEffect(() => {
    writeToStorage(state);
  }, [state]);

  const update = useCallback(
    (fn: (prev: LibraryCollectionsState) => LibraryCollectionsState): void => {
      setState(fn);
    },
    [],
  );

  const toggleFavorite = useCallback(
    (moduleId: string): void => {
      update((prev) => ({ ...prev, favorites: toggleIn(prev.favorites, moduleId) }));
    },
    [update],
  );

  const toggleWorkshopPin = useCallback(
    (moduleId: string): void => {
      update((prev) => ({ ...prev, workshop: toggleIn(prev.workshop, moduleId) }));
    },
    [update],
  );

  const trackInsert = useCallback(
    (moduleId: string): void => {
      update((prev) => ({
        ...prev,
        recent: [moduleId, ...prev.recent.filter((x) => x !== moduleId)].slice(
          0,
          RECENT_LIMIT,
        ),
      }));
    },
    [update],
  );

  const isFavorite = useCallback(
    (moduleId: string): boolean => state.favorites.includes(moduleId),
    [state.favorites],
  );

  const isWorkshopPinned = useCallback(
    (moduleId: string): boolean => state.workshop.includes(moduleId),
    [state.workshop],
  );

  return {
    ...state,
    isFavorite,
    isWorkshopPinned,
    toggleFavorite,
    toggleWorkshopPin,
    trackInsert,
  };
}
