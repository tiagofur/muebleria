/**
 * Debounce a value — used by SearchInput / catalog filters (design.md §4.6: 150ms).
 */

import { useEffect, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 150;

export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
