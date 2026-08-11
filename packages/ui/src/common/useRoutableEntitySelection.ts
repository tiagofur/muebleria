/**
 * Sync local selected/expanded entity id with shell URL handoff props.
 * Used by list→detail screens so `/section/:id` opens the same item.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

  const known = useMemo(() => new Set(knownIds), [knownIds]);

  const [selectedId, setSelectedIdState] = useState<string | null>(() => {
    return openEntityId && openEntityId !== '' && known.has(openEntityId)
      ? openEntityId
      : null;
  });

  // Sync state FROM openEntityId prop (URL → State).
  // Does NOT invoke onSelectionChange: the URL is already updated by the shell.
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
      onSelectionChange?.(null);
    }
  }, [selectedId, known, onSelectionChange]);

  const setSelectedId = useCallback(
    (id: string | null) => {
      setSelectedIdState(id);
      onSelectionChange?.(id);
    },
    [onSelectionChange],
  );

  const toggleSelectedId = useCallback(
    (id: string) => {
      setSelectedIdState((prev) => {
        const next = prev === id ? null : id;
        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange],
  );

  return { selectedId, setSelectedId, toggleSelectedId };
}
