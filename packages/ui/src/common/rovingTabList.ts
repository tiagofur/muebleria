/**
 * Keyboard support for ARIA tab lists (Fase 5.2 roadmap-screens).
 *
 * Arrows/Home/End move selection WITH focus (roving tabindex), wrapping
 * around the ends — the same interaction the editor forms implement
 * locally (ComponentEditorForm et al). Shared so the tabbed workspaces
 * (Fábrica, Ingeniería, Compras) stay consistent without copying the
 * handler per screen.
 */

import { useCallback, useRef, type KeyboardEvent } from 'react';

export type RovingTabList<TTabId extends string> = {
  /** Spread on the role="tablist" element. */
  readonly tabListProps: {
    readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  /** Spread on each role="tab" button (roving tabindex + ref). */
  readonly tabPropsAt: (index: number) => {
    readonly tabIndex: number;
    readonly ref: (el: HTMLButtonElement | null) => void;
  };
};

export function useRovingTabList<TTabId extends string>(params: {
  readonly tabIds: readonly TTabId[];
  readonly selectedId: TTabId;
  readonly onSelect: (tabId: TTabId) => void;
}): RovingTabList<TTabId> {
  const { tabIds, selectedId, onSelect } = params;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = useCallback(
    (index: number) => {
      const tabId = tabIds[index];
      if (tabId === undefined) return;
      onSelect(tabId);
      tabRefs.current[index]?.focus();
    },
    [tabIds, onSelect],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const n = tabIds.length;
    const current = tabIds.indexOf(selectedId);
    if (n === 0 || current < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusTab((current + 1) % n);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusTab((current - 1 + n) % n);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(n - 1);
    }
  };

  const tabPropsAt = (index: number) => ({
    tabIndex: tabIds[index] === selectedId ? 0 : -1,
    ref: (el: HTMLButtonElement | null) => {
      tabRefs.current[index] = el;
    },
  });

  return { tabListProps: { onKeyDown }, tabPropsAt };
}
