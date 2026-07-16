/**
 * Sync local selected/expanded entity id with shell URL handoff props.
 * Used by list→detail screens so `/section/:id` opens the same item.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type UseRoutableEntitySelectionOptions = {
  /** Id from URL / shell (`null` or `''` = list). */
  readonly openEntityId?: string | null;
  /** Notify shell when selection changes (for navigate). */
  readonly onSelectionChange?: (id: string | null) => void;
  /** Known entity ids currently in the list data. */
  readonly knownIds: readonly string[];
};

export type UseRoutableEntitySelectionResult = {
  readonly selectedId: string | null;
  readonly setSelectedId: (id: string | null) => void;
  /** Toggle expand-style selection (click same row again → clear). */
  readonly toggleSelectedId: (id: string) => void;
};

export function useRoutableEntitySelection(
  options: UseRoutableEntitySelectionOptions,
): UseRoutableEntitySelectionResult {
  const { openEntityId = null, onSelectionChange, knownIds } = options;
  const [selectedId, setSelectedIdState] = useState<string | null>(null);

  const known = useMemo(() => new Set(knownIds), [knownIds]);

  useEffect(() => {
    onSelectionChange?.(selectedId);
  }, [selectedId, onSelectionChange]);

  useEffect(() => {
    if (openEntityId == null || openEntityId === '') {
      setSelectedIdState(null);
      return;
    }
    if (!known.has(openEntityId)) return;
    setSelectedIdState(openEntityId);
  }, [openEntityId, known]);

  // Drop selection if entity disappears (delete / filter-out of existence).
  useEffect(() => {
    if (selectedId && !known.has(selectedId)) {
      setSelectedIdState(null);
    }
  }, [selectedId, known]);

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
  }, []);

  const toggleSelectedId = useCallback((id: string) => {
    setSelectedIdState((prev) => (prev === id ? null : id));
  }, []);

  return { selectedId, setSelectedId, toggleSelectedId };
}
