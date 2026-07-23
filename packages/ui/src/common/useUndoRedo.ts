/**
 * useUndoRedo — React hook that wraps a CommandManager and wires
 * keyboard shortcuts (Cmd+Z / Cmd+Shift+Z) for undo/redo.
 *
 * F061 (PRD §4.3).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Command, CommandManager } from '@muebles/domain';

export interface UndoRedoApi<T> {
  readonly state: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly execute: (command: Command<T>) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  /** Replace state without recording history (e.g. external load). */
  readonly setState: (next: T) => void;
  /** Clear history (e.g. when switching projects). */
  readonly clear: () => void;
}

export function useUndoRedo<T>(
  initialState: T,
  limit = 50,
  options: { readonly enabled?: boolean } = {},
): UndoRedoApi<T> {
  const enabled = options.enabled ?? true;
  const managerRef = useRef(new CommandManager<T>(limit));
  const [state, setStateInternal] = useState<T>(initialState);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [redoLabel, setRedoLabel] = useState<string | null>(null);

  const syncFlags = useCallback(() => {
    const m = managerRef.current;
    setCanUndo(m.canUndo());
    setCanRedo(m.canRedo());
    setUndoLabel(m.undoLabel());
    setRedoLabel(m.redoLabel());
  }, []);

  const execute = useCallback(
    (command: Command<T>) => {
      setStateInternal((prev) => {
        const next = managerRef.current.execute(prev, command);
        syncFlags();
        return next;
      });
    },
    [syncFlags],
  );

  const undo = useCallback(() => {
    setStateInternal((prev) => {
      const next = managerRef.current.undo(prev);
      syncFlags();
      return next;
    });
  }, [syncFlags]);

  const redo = useCallback(() => {
    setStateInternal((prev) => {
      const next = managerRef.current.redo(prev);
      syncFlags();
      return next;
    });
  }, [syncFlags]);

  const setState = useCallback(
    (next: T) => {
      setStateInternal(next);
      managerRef.current.clear();
      syncFlags();
    },
    [syncFlags],
  );

  const clear = useCallback(() => {
    managerRef.current.clear();
    syncFlags();
  }, [syncFlags]);

  // Keyboard shortcuts: Cmd+Z (undo), Cmd+Shift+Z or Cmd+Y (redo).
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      const isUndo =
        (e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey;
      const isRedo =
        ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) ||
        ((e.metaKey || e.ctrlKey) && e.key === 'y');
      if (isUndo) {
        e.preventDefault();
        undo();
      } else if (isRedo) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, undo, redo]);

  return useMemo(
    () => ({
      state,
      canUndo,
      canRedo,
      undoLabel,
      redoLabel,
      execute,
      undo,
      redo,
      setState,
      clear,
    }),
    [
      state,
      canUndo,
      canRedo,
      undoLabel,
      redoLabel,
      execute,
      undo,
      redo,
      setState,
      clear,
    ],
  );
}
