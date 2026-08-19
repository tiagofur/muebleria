/**
 * FullscreenDialog — design.md §4.3 / F110.
 * Same contract as Modal (portal, role=dialog + aria-labelledby, focus trap,
 * Esc, focus restored to trigger) for edge-to-edge surfaces: presentation
 * mode and lightboxes. Elevation L4, tokens only. The caller renders all
 * chrome; the primitive only guarantees the accessible dialog contract.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './fullscreenDialog.css';

export type FullscreenDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Accessible name (aria-labelledby). Hidden visually when hideTitle. */
  readonly title: string;
  readonly children: ReactNode;
  /** Render the title visually (default: visually hidden reference only). */
  readonly showTitle?: boolean;
  /** Disable Esc handling when the caller layers Esc (e.g. nested overlays). */
  readonly escapeEnabled?: boolean;
  readonly dataTestId?: string;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.hasAttribute('disabled')) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });
}

export function FullscreenDialog({
  open,
  onClose,
  title,
  children,
  showTitle = false,
  escapeEnabled = true,
  dataTestId,
}: FullscreenDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, [open]);

  // Focus management: store previous, focus panel, restore on close
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusInitial = () => {
      const panel = panelRef.current;
      if (!panel) return;
      (getFocusable(panel)[0] ?? panel).focus();
    };
    const t = window.setTimeout(focusInitial, 0);
    return () => {
      window.clearTimeout(t);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open || !escapeEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, escapeEnabled, onClose]);

  const onPanelKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === panel) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [],
  );

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className="fullscreen-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      data-testid={dataTestId}
    >
      <h2 id={titleId} className={showTitle ? 'fullscreen-dialog__title' : 'sr-only'}>
        {title}
      </h2>
      {children}
    </div>,
    document.body,
  );
}
