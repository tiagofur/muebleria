/**
 * Search field with Lucide icon — design.md §4.6.
 * Controlled: parent owns value; optional debounced callback (default 150ms).
 */

import { useEffect, useId, type ChangeEvent, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { SEARCH_DEBOUNCE_MS } from './useDebouncedValue';
import './searchInput.css';

export type SearchInputProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Fired after debounce (default 150ms). Prefer this for filtering lists. */
  readonly onDebouncedChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly debounceMs?: number;
  readonly id?: string;
  readonly 'aria-label'?: string;
};

export function SearchInput({
  value,
  onChange,
  onDebouncedChange,
  placeholder = 'Buscar…',
  debounceMs = SEARCH_DEBOUNCE_MS,
  id,
  'aria-label': ariaLabel = 'Buscar',
}: SearchInputProps): ReactNode {
  const autoId = useId();
  const inputId = id ?? autoId;

  useEffect(() => {
    if (!onDebouncedChange) return;
    const timer = window.setTimeout(() => {
      onDebouncedChange(value);
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [value, debounceMs, onDebouncedChange]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const clear = () => {
    onChange('');
  };

  return (
    <div className="ui-search">
      <Search
        className="ui-search__icon"
        size={16}
        strokeWidth={1.5}
        aria-hidden
      />
      <input
        id={inputId}
        type="search"
        className="ui-search__input"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
      />
      {value ? (
        <button
          type="button"
          className="ui-search__clear"
          onClick={clear}
          aria-label="Limpiar búsqueda"
        >
          <X size={14} strokeWidth={1.5} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
