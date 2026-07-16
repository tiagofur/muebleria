/**
 * Global command palette — jump to sections / entities (issue #54).
 * Dense product UI; keyboard-first (↑↓ Enter Esc).
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
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './commandPalette.css';

export type CommandPaletteItem = {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly keywords?: string;
  readonly icon?: LucideIcon;
};

export type CommandPaletteProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly items: readonly CommandPaletteItem[];
  readonly onSelect: (id: string) => void;
};

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es-MX');
}

function matchesQuery(item: CommandPaletteItem, q: string): boolean {
  if (!q) return true;
  const hay = normalize(
    `${item.label} ${item.group} ${item.keywords ?? ''} ${item.id}`,
  );
  return hay.includes(q);
}

export function CommandPalette({
  open,
  onClose,
  items,
  onSelect,
}: CommandPaletteProps): ReactNode {
  const titleId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return items.filter((item) => matchesQuery(item, q));
  }, [items, query]);

  // Reset when opened
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Keep active index in range
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex]);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const selectIndex = useCallback(
    (index: number) => {
      const item = filtered[index];
      if (!item) return;
      onSelect(item.id);
      onClose();
    },
    [filtered, onSelect, onClose],
  );

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) =>
        filtered.length === 0 ? 0 : (i + 1) % filtered.length,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) =>
        filtered.length === 0
          ? 0
          : (i - 1 + filtered.length) % filtered.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectIndex(activeIndex);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  // Group filtered for display labels
  let lastGroup = '';

  return createPortal(
    <div
      className="cmd-palette-root"
      role="presentation"
      data-testid="command-palette"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="cmd-palette__overlay"
        aria-label="Cerrar búsqueda"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className="cmd-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="visually-hidden">
          Buscar y navegar
        </h2>
        <div className="cmd-palette__search">
          <Search
            className="cmd-palette__search-icon"
            size={18}
            strokeWidth={1.5}
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            className="cmd-palette__input"
            placeholder="Ir a sección o buscar cotización / mueble…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              filtered[activeIndex]
                ? `${listboxId}-opt-${filtered[activeIndex]!.id}`
                : undefined
            }
            data-testid="command-palette-input"
          />
          <kbd className="cmd-palette__kbd" aria-hidden>
            esc
          </kbd>
        </div>
        <ul
          id={listboxId}
          className="cmd-palette__list"
          role="listbox"
          aria-label="Resultados"
        >
          {filtered.length === 0 ? (
            <li className="cmd-palette__empty" role="presentation">
              Sin resultados. Probá otro término o limpia la búsqueda.
            </li>
          ) : (
            filtered.map((item, index) => {
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              const Icon = item.icon;
              const active = index === activeIndex;
              return (
                <li key={item.id} role="presentation">
                  {showGroup ? (
                    <div className="cmd-palette__group" aria-hidden>
                      {item.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    id={`${listboxId}-opt-${item.id}`}
                    role="option"
                    aria-selected={active}
                    className={
                      active
                        ? 'cmd-palette__item is-active'
                        : 'cmd-palette__item'
                    }
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectIndex(index)}
                  >
                    {Icon ? (
                      <Icon
                        className="cmd-palette__item-icon"
                        size={16}
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    ) : (
                      <span className="cmd-palette__item-icon" aria-hidden />
                    )}
                    <span className="cmd-palette__item-label">{item.label}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <p className="cmd-palette__hint" aria-hidden>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navegar · <kbd>↵</kbd> abrir · <kbd>esc</kbd> cerrar
        </p>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Global Cmd/Ctrl+K (and optional /) listener when enabled.
 * Skips when focus is in editable fields (except when palette already open).
 */
export function useCommandPaletteHotkey(
  onToggle: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isModK =
        (event.metaKey || event.ctrlKey) &&
        (event.key === 'k' || event.key === 'K');
      if (!isModK) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable;
      // Still allow Cmd+K from inputs to open palette (Linear-style)
      if (isEditable && (event.key as string) === '/' && !event.metaKey && !event.ctrlKey) {
        return;
      }

      event.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle, enabled]);
}
