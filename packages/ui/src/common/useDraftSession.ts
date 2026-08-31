/**
 * useDraftSession — persist a draft to sessionStorage so it survives F5 /
 * navigation to other sections and back. Used by Modules/Structures/Components
 * inline editors (Fase 3 follow-up).
 *
 * Contract:
 *   const [draft, setDraft, clearDraft, setDraftLocal] =
 *     useDraftSession(key, initialDraft);
 *
 * - On first mount: if sessionStorage has a value for `key`, return it;
 *   otherwise return `initialDraft` (session left empty until setDraft).
 * - setDraft(next | (prev) => next): update both React state and sessionStorage.
 *   Accepts the same shapes as React's setState (value OR updater function).
 * - clearDraft(): remove the key from sessionStorage (called on save or
 *   discard). Leaves the React state alone (caller decides what to do).
 * - setDraftLocal(next | (prev) => next): update React state ONLY — does not
 *   write sessionStorage. Use on close/reset so an empty draft never sticks
 *   under the entity key after clearDraft (JD R4-C1 race).
 *
 * Persisted JSON is validated structurally against the editor baseline before
 * it can enter React state. Editors may provide a stricter typed validator.
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

export type DraftSessionValidator<T> = (value: unknown) => value is T;
export type DraftEntityKind = 'module' | 'structure' | 'component' | 'agregado';

export const DRAFT_SESSION_REGISTRY_KEY = 'granete:entity-drafts:v1';
type DraftRegistryEntry = { readonly key: string; readonly baseline: unknown };
type UntypedDraftValidator = (value: unknown) => boolean;
const draftValidators = new Map<string, UntypedDraftValidator>();
let resolveDraftScope = () => 'unscoped';
export const registerDraftSessionScope = (resolve: () => string): void => { resolveDraftScope = resolve; };
export const draftSessionKey = (kind: DraftEntityKind, id: string): string =>
  `draft:${resolveDraftScope()}:${kind}:${id}`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function structurallyMatches<T>(value: unknown, baseline: T): value is T {
  if (Array.isArray(baseline)) return Array.isArray(value) && (baseline.length === 0
    ? value.length === 0 : value.every((item) => structurallyMatches(item, baseline[0])));
  if (isRecord(baseline)) return isRecord(value) && Object.entries(baseline).every(
    ([key, expected]) => expected === undefined ? !(key in value)
      : key in value && structurallyMatches(value[key], expected));
  return baseline === null ? value === null : typeof value === typeof baseline;
}

function readRegistry(): DraftRegistryEntry[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(DRAFT_SESSION_REGISTRY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.flatMap((entry): DraftRegistryEntry[] =>
      isRecord(entry) && typeof entry.key === 'string' && 'baseline' in entry
        ? [{ key: entry.key, baseline: entry.baseline }] : []) : [];
  } catch { return []; }
}
function writeRegistry(entries: readonly DraftRegistryEntry[]): void {
  try { sessionStorage.setItem(DRAFT_SESSION_REGISTRY_KEY, JSON.stringify(entries)); } catch { /* unavailable */ }
}
export function registerDraftSessionBaseline(key: string, baseline: unknown, validator?: UntypedDraftValidator): void {
  if (validator) draftValidators.set(key, validator);
  writeRegistry([...readRegistry().filter((entry) => entry.key !== key), { key, baseline }]);
}
function unregisterDraftSession(key: string): void {
  draftValidators.delete(key);
  writeRegistry(readRegistry().filter((entry) => entry.key !== key));
}
export function hasDirtyDraftSessions(): boolean {
  return readRegistry().some(({ key, baseline }) => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return false;
      const value: unknown = JSON.parse(raw);
      const validator = draftValidators.get(key);
      return (validator ? validator(value) : structurallyMatches(value, baseline))
        && JSON.stringify(value) !== JSON.stringify(baseline);
    } catch { return false; }
  });
}
export function clearRegisteredDraftSessions(): void {
  try {
    for (const { key } of readRegistry()) sessionStorage.removeItem(key);
    sessionStorage.removeItem(DRAFT_SESSION_REGISTRY_KEY);
    draftValidators.clear();
  } catch { /* unavailable */ }
}

function readSession<T>(
  key: string,
  baseline: T,
  validator?: DraftSessionValidator<T>,
): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (validator) return validator(parsed) ? parsed : null;
    return structurallyMatches(parsed, baseline) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read a draft from sessionStorage without mounting the hook.
 * Used by editor seed effects so F5/remount restore is not wiped by
 * entity→draft reseeding (JD R3-C1).
 */
export function readDraftSession<T>(
  key: string,
  baseline: T,
  validator?: DraftSessionValidator<T>,
): T | null {
  return readSession(key, baseline, validator);
}

/**
 * Seed an editor draft from the entity baseline without overwriting a
 * session-restored draft. Always sets `initialDraft` for dirty comparison;
 * only calls `setDraft` when sessionStorage has no value for `draftKey`.
 */
export function seedEditorDraftFromBaseline<T>(
  draftKey: string,
  baseline: T,
  setDraft: (next: T) => void,
  setInitialDraft: (next: T) => void,
  validator?: DraftSessionValidator<T>,
): void {
  registerDraftSessionBaseline(draftKey, baseline);
  setInitialDraft(baseline);
  if (readSession(draftKey, baseline, validator) === null) {
    setDraft(baseline);
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
    unregisterDraftSession(key);
  } catch {
    // ignore
  }
}

export function useDraftSession<T>(
  key: string,
  initialDraft: T,
  validator?: DraftSessionValidator<T>,
): readonly [
  T,
  Dispatch<SetStateAction<T>>,
  () => void,
  Dispatch<SetStateAction<T>>,
] {
  if (validator) draftValidators.set(key, validator);
  const [state, setState] = useState<T>(() => {
    const persisted = readSession(key, initialDraft, validator);
    if (persisted !== null) return persisted;
    return initialDraft;
  });

  // Keep the key in a ref so the wrapped setDraft can resolve updater functions
  // with the latest key even after a re-render with a new key. Updated only
  // inside the key-change effect (NOT on every render, so the effect can
  // detect a real change).
  const keyRef = useRef(key);

  useEffect(() => {
    registerDraftSessionBaseline(key, initialDraft, validator);
  }, [key]);

  // When the key changes (e.g. navigating from /new/edit to /:id/edit), reload
  // from sessionStorage. This lets the same hook instance back multiple editor
  // entries without forcing a component remount.
  useEffect(() => {
    if (keyRef.current === key) return; // first mount or no change
    keyRef.current = key;
    const persisted = readSession(key, initialDraft, validator);
    if (persisted !== null) {
      setState(persisted);
    } else {
      setState(initialDraft);
    }
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

  /** React-only state update — never touches sessionStorage (JD R4-C1). */
  const setDraftLocal = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setState((prev) =>
      typeof next === 'function' ? (next as (prev: T) => T)(prev) : next,
    );
  }, []);

  return [state, setDraft, clearDraft, setDraftLocal] as const;
}
