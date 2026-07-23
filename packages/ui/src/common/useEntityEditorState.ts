/**
 * useEntityEditorState — shared state + handlers for entity editors
 * (Modules, Structures, Components). F059.
 *
 * Extracts the common pattern: modalOpen, editingId, draft session,
 * initialDraft snapshot, confirmDiscard, editorTab, error, and the
 * forceCloseEditor/closeModal/handleCreateNew/startEdit cycle.
 *
 * Each screen provides:
 * - `emptyDraft()`: factory for a fresh draft
 * - `draftToEntity(id, draft)`: not needed here (screens call their own onSave)
 * - `entityToDraft(entity)`: converter for edit mode
 * - `defaultTab`: starting tab
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useDraftSession } from './useDraftSession';

export interface EntityEditorState<Draft, Tab extends string> {
  // --- State ---
  readonly modalOpen: boolean;
  readonly editingId: string | null;
  readonly draft: Draft;
  readonly setDraft: Dispatch<SetStateAction<Draft>>;
  readonly initialDraft: Draft | null;
  readonly confirmDiscard: boolean;
  readonly editorTab: Tab;
  readonly error: string | null;

  // --- Derived ---
  readonly isDraftDirty: boolean;

  // --- Setters ---
  readonly setEditorTab: Dispatch<SetStateAction<Tab>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setConfirmDiscard: Dispatch<SetStateAction<boolean>>;
  readonly setInitialDraft: Dispatch<SetStateAction<Draft | null>>;

  // --- Handlers ---
  readonly forceCloseEditor: () => void;
  readonly closeModal: () => void;
  readonly openCreateEditor: () => void;
  readonly openEditEditor: (id: string, entityToDraft: (id: string) => Draft) => void;

  // --- Draft session passthrough ---
  readonly clearDraft: () => void;
}

export interface UseEntityEditorStateOptions<
  Draft,
  Tab extends string,
> {
  readonly draftKey: string;
  readonly emptyDraft: () => Draft;
  readonly defaultTab: Tab;
  /**
   * Called when the editor closes and needs to sync the URL selection.
   * Receives the current selection (to restore it after closing the editor).
   */
  readonly onEditorClose?: (restoreSelectionId: string | null) => void;
  /**
   * The current selection (expanded card id). Used to restore after editor close.
   */
  readonly currentSelectionId: string | null;
}

export function useEntityEditorState<Draft, Tab extends string>(
  options: UseEntityEditorStateOptions<Draft, Tab>,
): EntityEditorState<Draft, Tab> {
  const { draftKey, emptyDraft, defaultTab, onEditorClose, currentSelectionId } = options;

  const [draft, setDraft, clearDraft] = useDraftSession<Draft>(
    draftKey,
    emptyDraft(),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialDraft, setInitialDraft] = useState<Draft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editorTab, setEditorTab] = useState<Tab>(defaultTab);
  const [error, setError] = useState<string | null>(null);

  const isDraftDirty =
    initialDraft != null &&
    JSON.stringify(draft) !== JSON.stringify(initialDraft);

  const forceCloseEditor = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setInitialDraft(null);
    setEditorTab(defaultTab);
    setError(null);
    setConfirmDiscard(false);
    clearDraft();
    onEditorClose?.(currentSelectionId);
  }, [emptyDraft, defaultTab, clearDraft, onEditorClose, currentSelectionId, setDraft]);

  const closeModal = useCallback(() => {
    if (isDraftDirty) {
      setConfirmDiscard(true);
      return;
    }
    forceCloseEditor();
  }, [isDraftDirty, forceCloseEditor]);

  const openCreateEditor = useCallback(() => {
    const fresh = emptyDraft();
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditingId(null);
    setEditorTab(defaultTab);
    setError(null);
    setModalOpen(true);
  }, [emptyDraft, defaultTab, setDraft]);

  const openEditEditor = useCallback(
    (id: string, entityToDraft: (id: string) => Draft) => {
      const fresh = entityToDraft(id);
      setDraft(fresh);
      setInitialDraft(fresh);
      setEditingId(id);
      setEditorTab(defaultTab);
      setError(null);
      setModalOpen(true);
    },
    [defaultTab, setDraft],
  );

  return {
    modalOpen,
    editingId,
    draft,
    setDraft,
    initialDraft,
    confirmDiscard,
    editorTab,
    error,
    isDraftDirty,
    setEditorTab,
    setError,
    setConfirmDiscard,
    setInitialDraft,
    forceCloseEditor,
    closeModal,
    openCreateEditor,
    openEditEditor,
    clearDraft,
  };
}
