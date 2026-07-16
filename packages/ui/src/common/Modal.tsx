/**
 * Reusable modal dialog — design.md §4.3.
 * Overlay backdrop, sticky header/footer, focus trap, Esc/overlay close.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './modal.css';

export type ModalSize = 'sm' | 'md' | 'lg';

export type ModalProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly size?: ModalSize;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Matches `--duration-slow` (350ms) for exit unmount. */
export const MODAL_CLOSE_MS = 350;

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

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  footer,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<'open' | 'closing'>(
    open ? 'open' : 'closing',
  );

  // Mount / unmount with close animation
  useEffect(() => {
    if (open) {
      setRendered(true);
      // Double rAF so CSS transitions run from the closed baseline
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setPhase('open');
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    if (!rendered) return undefined;

    setPhase('closing');
    const timer = window.setTimeout(() => {
      setRendered(false);
    }, MODAL_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  // Body scroll lock while mounted (open or closing)
  useEffect(() => {
    if (!rendered) return;
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, [rendered]);

  // Focus management: store previous, focus panel, restore on unmount
  useEffect(() => {
    if (!open || !rendered) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusInitial = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      const target = focusable[0] ?? panel;
      target.focus();
    };

    const t = window.setTimeout(focusInitial, 0);
    return () => {
      window.clearTimeout(t);
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open, rendered]);

  // Esc closes
  useEffect(() => {
    if (!open || !rendered) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, rendered, onClose]);

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

  if (!rendered || typeof document === 'undefined') {
    return null;
  }

  const rootClass = [
    'ui-modal-root',
    phase === 'open' ? 'is-open' : '',
    phase === 'closing' ? 'is-closing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return createPortal(
    <div className={rootClass} data-modal-size={size}>
      {/*
        Overlay is a button (not aria-hidden) so dismiss-by-click is keyboard-
        and AT-accessible; Esc still closes via the keydown listener (issue #20).
      */}
      <button
        type="button"
        className="ui-modal__overlay"
        data-testid="ui-modal-overlay"
        aria-label="Cerrar diálogo"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`ui-modal ui-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
      >
        <header className="ui-modal__header">
          <h2 id={titleId} className="ui-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="ui-modal__close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </header>
        <div className="ui-modal__body">{children}</div>
        {footer != null ? (
          <footer className="ui-modal__footer">{footer}</footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
