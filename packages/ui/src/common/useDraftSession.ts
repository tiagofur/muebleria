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
 * - setDraft(next | (prev) => next): update both React state and sessionStorage.
 *   Accepts the same shapes as React's setState (value OR updater function).
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

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

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
): readonly [T, Dispatch<SetStateAction<T>>, () => void] {
  const [state, setState] = useState<T>(() => {
    const persisted = readSession<T>(key);
    if (persisted !== null) return persisted;
    writeSession(key, initialDraft);
    return initialDraft;
  });

  // Keep the key in a ref so the wrapped setDraft can resolve updater functions
  // with the latest key even after a re-render with a new key. Updated only
  // inside the key-change effect (NOT on every render, so the effect can
  // detect a real change).
  const keyRef = useRef(key);

  // When the key changes (e.g. navigating from /new/edit to /:id/edit), reload
  // from sessionStorage. This lets the same hook instance back multiple editor
  // entries without forcing a component remount.
  useEffect(() => {
    if (keyRef.current === key) return; // first mount or no change
    keyRef.current = key;
    const persisted = readSession<T>(key);
    if (persisted !== null) {
      setState(persisted);
    } else {
      writeSession(key, initialDraft);
      setState(initialDraft);
    }
    // We intentionally only depend on `key`. initialDraft is captured at the
    // moment the key changes; that's what callers expect (e.g. fresh empty
    // draft for 'new', or moduleToDraft(item) for an existing entity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setDraft = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setState((prev) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: T) => T)(prev)
          : next;
      writeSession(keyRef.current, resolved);
      return resolved;
    });
  }, []);

  const clearDraft = useCallback(() => {
    removeSession(keyRef.current);
  }, []);

  return [state, setDraft, clearDraft] as const;
}
