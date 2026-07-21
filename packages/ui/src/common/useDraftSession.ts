/**
 * useDraftSession — persist a draft to sessionStorage so it survives F5 /
 * navigation to other sections and back. Used by Modules/Structures/Components
 * inline editors (Fase 3 follow-up).
 *
 * Contract:
 *   const [draft, setDraft, clearDraft] = useDraftSession(key, initialDraft);
 *
 * - On first mount: if sessionStorage has a value for `key`, return it;
 *   otherwise return `initialDraft` and seed sessionStorage.
 * - setDraft(next): update both React state and sessionStorage.
 * - clearDraft(): remove the key from sessionStorage (called on save or
 *   discard). Leaves the React state alone (caller decides what to do).
 *
 * The hook is intentionally simple — it does NOT parse JSON shape; the caller
 * passes the same T both ways. sessionStorage values are JSON.stringify'd.
 *
 * Keys should be namespaced per entity, e.g.:
 *   'module-draft:new'           for /modules/new/edit
 *   'module-draft:mod-gab-01'    for /modules/mod-gab-01/edit
 *   'structure-draft:struct-1'   for /structures/struct-1/edit
 *
 * Failures (private mode, quota) are caught: the hook silently degrades to
 * in-memory state, same behavior as before this hook existed.
 */

import { useCallback, useRef, useState } from 'react';

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private mode: degrade to in-memory only.
  }
}

function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function useDraftSession<T>(
  key: string,
  initialDraft: T,
): readonly [T, (next: T) => void, () => void] {
  const [state, setState] = useState<T>(() => {
    const persisted = readSession<T>(key);
    if (persisted !== null) return persisted;
    writeSession(key, initialDraft);
    return initialDraft;
  });

  // Keep the key in a ref so the session-stored key stays in sync even if
  // the caller changes the key (e.g. navigating from /new/edit to /:id/edit
  // after first save).
  const keyRef = useRef(key);
  keyRef.current = key;

  const setDraft = useCallback(
    (next: T) => {
      setState(next);
      writeSession(keyRef.current, next);
    },
    [],
  );

  const clearDraft = useCallback(() => {
    removeSession(keyRef.current);
  }, []);

  return [state, setDraft, clearDraft] as const;
}
