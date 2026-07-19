/**
 * DropdownMenu — accessible contextual menu (popup with role="menu").
 *
 * Use for "Exportar ▾", row action overflow menus, secondary actions grouped
 * behind a single trigger. For command-palette style search use CommandPalette;
 * for listbox-style single-select use CatalogPicker.
 *
 * Features:
 * - Trigger renders as a button (render-prop for full control of label/icon).
 * - Menu items with optional sections (non-clickable headers) + dividers.
 * - Click-outside closes; Esc closes; arrow keys navigate; Enter activates.
 * - Disabled items render but are not focusable/clickable.
 * - aria-haspopup="menu", aria-expanded, role="menu"/"menuitem".
 *
 * docs/design.md §4.x (no formal section yet — documented ad-hoc per consumer).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ChevronsUpDown } from 'lucide-react';
import './dropdownMenu.css';

export type DropdownMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** Optional leading icon. */
  readonly icon?: ReactNode;
  /** Optional helper text below the label. */
  readonly hint?: string;
};

export type DropdownMenuSection = {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly DropdownMenuItem[];
};

export type DropdownMenuProps = {
  /** Accessible label for the menu (aria-label). */
  readonly ariaLabel: string;
  /** Visible text on the trigger button. */
  readonly triggerLabel: string;
  /** Optional leading icon on the trigger (before the label). */
  readonly triggerIcon?: ReactNode;
  /** When false the trigger is disabled (whole menu unavailable). */
  readonly disabled?: boolean;
  /** Trigger className override; defaults to `.btn` (matches chrome styling). */
  readonly triggerClassName?: string;
  /** Sections of the menu. If a single section without label, pass `[{
   * id: 'main', items: [...] }]`. */
  readonly sections: readonly DropdownMenuSection[];
  /** Called when the menu closes (escape / outside click / item select). */
  readonly onClose?: () => void;
};

type FlatItem = DropdownMenuItem & { sectionId: string };

function flattenItems(
  sections: readonly DropdownMenuSection[],
): readonly FlatItem[] {
  return sections.flatMap((section) =>
    section.items.map((item) => ({ ...item, sectionId: section.id })),
  );
}

export function DropdownMenu({
  ariaLabel,
  triggerLabel,
  triggerIcon,
  disabled = false,
  triggerClassName = 'btn',
  sections,
  onClose,
}: DropdownMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const menuId = useId();

  const flat = flattenItems(sections);
  const enabled = flat.filter((item) => !item.disabled);

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
    onClose?.();
  }, [onClose]);

  const openMenu = useCallback(() => {
    setOpen(true);
    setHighlight(enabled.length > 0 ? flat.indexOf(enabled[0]!) : -1);
  }, [enabled, flat]);

  const toggle = useCallback(() => {
    if (open) close();
    else openMenu();
  }, [open, openMenu, close]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      if (target && triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Move focus to highlighted item when menu opens or highlight changes.
  useLayoutEffect(() => {
    if (!open || highlight < 0) return;
    const el = menuRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    el?.focus();
  }, [open, highlight]);

  const onTriggerKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openMenu();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const currentIdx = flat.findIndex((item, idx) => idx === highlight);
      for (let i = currentIdx + 1; i < flat.length; i++) {
        if (!flat[i]!.disabled) {
          setHighlight(i);
          return;
        }
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const currentIdx = flat.findIndex((_, idx) => idx === highlight);
      for (let i = currentIdx - 1; i >= 0; i--) {
        if (!flat[i]!.disabled) {
          setHighlight(i);
          return;
        }
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = flat[highlight];
      if (item && !item.disabled) {
        item.onSelect();
        close();
        triggerRef.current?.focus();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    }
  };

  let runningIndex = -1;

  return (
    <div className="dropdown-menu">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        onKeyDown={onTriggerKeyDown}
      >
        {triggerIcon}
        <span>{triggerLabel}</span>
        <ChevronsUpDown
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="dropdown-menu__chevron"
        />
      </button>

      {open ? (
        <ul
          ref={menuRef}
          id={menuId}
          className="dropdown-menu__list"
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onMenuKeyDown}
        >
          {sections.map((section) => (
            <li key={section.id} className="dropdown-menu__section" role="none">
              {section.label ? (
                <div className="dropdown-menu__section-label" role="presentation">
                  {section.label}
                </div>
              ) : null}
              <ul className="dropdown-menu__section-items" role="none">
                {section.items.map((item) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const isHighlighted = idx === highlight;
                  return (
                    <li
                      key={`${section.id}-${item.id}`}
                      data-index={idx}
                      role="menuitem"
                      tabIndex={item.disabled ? -1 : isHighlighted ? 0 : -1}
                      aria-disabled={item.disabled || undefined}
                      className={[
                        'dropdown-menu__item',
                        item.disabled ? 'dropdown-menu__item--disabled' : '',
                        isHighlighted ? 'dropdown-menu__item--highlighted' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onMouseEnter={() => !item.disabled && setHighlight(idx)}
                      onClick={() => {
                        if (item.disabled) return;
                        item.onSelect();
                        close();
                        triggerRef.current?.focus();
                      }}
                    >
                      {item.icon ? (
                        <span className="dropdown-menu__item-icon">
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="dropdown-menu__item-text">
                        <span className="dropdown-menu__item-label">
                          {item.label}
                        </span>
                        {item.hint ? (
                          <span className="dropdown-menu__item-hint">
                            {item.hint}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
