/**
 * ToastViewport — renderer for the uiStore toast queue (design.md §4.4).
 *
 * F064: replaces the old `ToastProvider` from `packages/ui/src/common/Toast.tsx`.
 * Reads items from uiStore and portals them to document.body. No context
 * (consumers call `useUiStore.getState().toast(...)` directly).
 */

import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from 'lucide-react';
import {
  TOAST_DURATION_MS,
  useUiStore,
  type InternalToast,
  type ToastType,
} from '../stores';
import './toast.css';

function ToastIcon({ type }: { readonly type: ToastType }): ReactNode {
  const props = { size: 18, strokeWidth: 1.5, 'aria-hidden': true as const };
  switch (type) {
    case 'success':
      return <CheckCircle2 {...props} />;
    case 'info':
      return <Info {...props} />;
    case 'warning':
      return <AlertTriangle {...props} />;
    case 'error':
      return <AlertCircle {...props} />;
  }
}

function ToastCard({
  item,
  onDismiss,
}: {
  readonly item: InternalToast;
  readonly onDismiss: (id: string) => void;
}): ReactNode {
  const className = [
    'ui-toast',
    `ui-toast--${item.type}`,
    item.phase === 'enter' ? 'is-enter' : '',
    item.phase === 'visible' ? 'is-visible' : '',
    item.phase === 'exit' ? 'is-exit' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      data-testid="ui-toast"
      data-toast-type={item.type}
      data-toast-id={item.id}
      data-toast-phase={item.phase}
    >
      <span className="ui-toast__icon">
        <ToastIcon type={item.type} />
      </span>
      <p className="ui-toast__message">{item.message}</p>
      <button
        type="button"
        className="ui-toast__close"
        aria-label="Cerrar notificación"
        onClick={() => onDismiss(item.id)}
      >
        <X size={14} strokeWidth={1.5} aria-hidden />
      </button>
      {item.phase !== 'exit' ? (
        <span
          className="ui-toast__progress"
          data-testid="ui-toast-progress"
          style={{ animationDuration: `${TOAST_DURATION_MS}ms` }}
        />
      ) : null}
    </div>
  );
}

export function ToastViewport(): ReactNode {
  const items = useUiStore((s) => s.items);
  const dismiss = useUiStore((s) => s.dismiss);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="ui-toast-viewport"
      data-testid="ui-toast-viewport"
      aria-label="Notificaciones"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  );
}
