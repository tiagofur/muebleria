/**
 * Searchable catalog picker (combobox) — CAT-05 + design.md §4.6.
 * Inactive items hidden by default; current value kept if inactive.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { filterActiveForPicker, matchesCodeOrName } from './catalogHelpers';
import './catalogs.css';

export interface CatalogPickerOption {
  readonly id: string;
  /** Business code; may be empty for entities without codes (e.g. customers). */
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  /** Optional secondary line (email, thickness, etc.). */
  readonly subtitle?: string;
}

export interface CatalogPickerProps {
  readonly id?: string;
  readonly label: string;
  readonly items: readonly CatalogPickerOption[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** When true, inactive items appear (default false). */
  readonly includeInactive?: boolean;
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly disabled?: boolean;
  /** Extra class on root (e.g. grow inside inline-actions). */
  readonly className?: string;
  /** data-testid root hook. */
  readonly 'data-testid'?: string;
}

export function formatCatalogPickerLabel(item: CatalogPickerOption): string {
  const base = item.code.trim()
    ? `${item.code} — ${item.name}`
    : item.name;
  return item.active ? base : `${base} (inactivo)`;
}

function optionMatchesQuery(
  item: CatalogPickerOption,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  if (matchesCodeOrName(item, normalizedQuery)) return true;
  if (item.subtitle) {
    return item.subtitle.toLocaleLowerCase('es-UY').includes(normalizedQuery);
  }
  return false;
}

export function CatalogPicker({
  id,
  label,
  items,
  value,
  onChange,
  includeInactive = false,
  placeholder = 'Seleccionar…',
  searchPlaceholder = 'Buscar…',
  disabled = false,
  className,
  'data-testid': dataTestId,
}: CatalogPickerProps): ReactNode {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const listboxId = `${triggerId}-listbox`;
  const searchId = `${triggerId}-search`;

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const baseOptions = useMemo(() => {
    let opts = filterActiveForPicker(items, { includeInactive });
    if (value) {
      const current = items.find((i) => i.id === value);
      if (current && !opts.some((o) => o.id === value)) {
        opts = [current, ...opts];
      }
    }
    return opts;
  }, [items, includeInactive, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es-UY');
    if (!q) return baseOptions;
    return baseOptions.filter((item) => optionMatchesQuery(item, q));
  }, [baseOptions, query]);

  const selected = useMemo(
    () => items.find((i) => i.id === value) ?? null,
    [items, value],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }, []);

  const openList = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    const idx = value
      ? Math.max(
          0,
          baseOptions.findIndex((o) => o.id === value),
        )
      : 0;
    setHighlight(idx >= 0 ? idx : 0);
  }, [disabled, value, baseOptions]);

  const selectId = useCallback(
    (nextId: string) => {
      onChange(nextId);
      close();
    },
    [onChange, close],
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const t = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (highlight >= filtered.length) {
      setHighlight(filtered.length > 0 ? filtered.length - 1 : 0);
    }
  }, [filtered.length, highlight]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight, open, filtered]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openList();
    }
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlight((h) => (h + 1) % filtered.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[highlight];
      if (item) selectId(item.id);
    }
  };

  const rootClass = ['catalog-picker', className].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={rootClass}
      data-testid={dataTestId ?? 'catalog-picker'}
    >
      <label htmlFor={triggerId}>{label}</label>
      <button
        type="button"
        id={triggerId}
        className="catalog-picker__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        <span
          className={
            selected
              ? 'catalog-picker__value'
              : 'catalog-picker__value catalog-picker__value--placeholder'
          }
        >
          {selected ? formatCatalogPickerLabel(selected) : placeholder}
        </span>
        <ChevronsUpDown
          size={16}
          strokeWidth={1.5}
          aria-hidden
          className="catalog-picker__chevron"
        />
      </button>

      {open ? (
        <div className="catalog-picker__popover" role="presentation">
          <div className="catalog-picker__search">
            <Search
              size={14}
              strokeWidth={1.5}
              aria-hidden
              className="catalog-picker__search-icon"
            />
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              className="catalog-picker__search-input"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-activedescendant={
                filtered[highlight]
                  ? `${listboxId}-opt-${filtered[highlight]!.id}`
                  : undefined
              }
              autoComplete="off"
            />
          </div>
          <ul
            ref={listRef}
            id={listboxId}
            className="catalog-picker__list"
            role="listbox"
            aria-label={label}
          >
            {filtered.length === 0 ? (
              <li className="catalog-picker__empty" role="presentation">
                Sin resultados
              </li>
            ) : (
              filtered.map((item, index) => {
                const isSelected = item.id === value;
                const isActive = index === highlight;
                return (
                  <li
                    key={item.id}
                    id={`${listboxId}-opt-${item.id}`}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    className={[
                      'catalog-picker__option',
                      isActive ? 'catalog-picker__option--active' : '',
                      isSelected ? 'catalog-picker__option--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectId(item.id);
                    }}
                  >
                    <span className="catalog-picker__option-text">
                      <span className="catalog-picker__option-name">
                        {formatCatalogPickerLabel(item)}
                      </span>
                      {item.subtitle ? (
                        <span className="catalog-picker__option-sub">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <Check
                        size={14}
                        strokeWidth={1.5}
                        aria-hidden
                        className="catalog-picker__check"
                      />
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          {value ? (
            <button
              type="button"
              className="catalog-picker__clear"
              onMouseDown={(e) => {
                e.preventDefault();
                selectId('');
              }}
            >
              Quitar selección
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
