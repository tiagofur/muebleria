/**
 * Toast notifications — design.md §4.4.
 * Provider + useToast: top-right stack, max 3, 4s auto-dismiss with progress bar.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from 'lucide-react';
import './toast.css';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export type ToastInput = {
  readonly type: ToastType;
  readonly message: string;
};

export type ToastItem = ToastInput & {
  readonly id: string;
};

/** Auto-dismiss duration (design.md §4.4). */
export const TOAST_DURATION_MS = 4000;

/** Exit animation length — matches `--duration-normal` (250ms). */
export const TOAST_EXIT_MS = 250;

/** Maximum simultaneous visible toasts (oldest exits). */
export const TOAST_MAX = 3;

type ToastPhase = 'enter' | 'visible' | 'exit';

type InternalToast = ToastItem & {
  readonly phase: ToastPhase;
};

type ToastContextValue = {
  readonly toast: (input: ToastInput) => void;
  readonly dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function nextToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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

export function ToastProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [items, setItems] = useState<readonly InternalToast[]>([]);
  const dismissTimers = useRef<Map<string, number>>(new Map());
  const exitTimers = useRef<Map<string, number>>(new Map());
  const enterTimers = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback(
    (map: MutableRefObject<Map<string, number>>, id: string) => {
      const handle = map.current.get(id);
      if (handle !== undefined) {
        window.clearTimeout(handle);
        map.current.delete(id);
      }
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    clearTimer(dismissTimers, id);
    clearTimer(exitTimers, id);
    clearTimer(enterTimers, id);
  }, [clearTimer]);

  const beginExit = useCallback(
    (id: string) => {
      clearTimer(dismissTimers, id);
      clearTimer(enterTimers, id);

      setItems((prev) => {
        const target = prev.find((t) => t.id === id);
        if (!target || target.phase === 'exit') return prev;
        return prev.map((t) =>
          t.id === id ? { ...t, phase: 'exit' as const } : t,
        );
      });

      if (exitTimers.current.has(id)) return;
      const handle = window.setTimeout(() => {
        exitTimers.current.delete(id);
        removeToast(id);
      }, TOAST_EXIT_MS);
      exitTimers.current.set(id, handle);
    },
    [clearTimer, removeToast],
  );

  const scheduleAutoDismiss = useCallback(
    (id: string) => {
      clearTimer(dismissTimers, id);
      const handle = window.setTimeout(() => {
        dismissTimers.current.delete(id);
        beginExit(id);
      }, TOAST_DURATION_MS);
      dismissTimers.current.set(id, handle);
    },
    [beginExit, clearTimer],
  );

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextToastId();
      const message = input.message.trim();
      if (!message) return;

      setItems((prev) => {
        const overflow = prev.filter((t) => t.phase !== 'exit');
        // Cap at TOAST_MAX: mark oldest for exit (outside setState effect via timers)
        if (overflow.length >= TOAST_MAX) {
          const oldest = overflow[0]!;
          // Schedule exit after commit
          window.setTimeout(() => beginExit(oldest.id), 0);
        }
        return [
          ...prev,
          {
            id,
            type: input.type,
            message,
            phase: 'enter' as const,
          },
        ];
      });

      // Enter → visible on next frames so CSS transition runs
      const enterHandle = window.setTimeout(() => {
        enterTimers.current.delete(id);
        setItems((prev) =>
          prev.map((t) =>
            t.id === id && t.phase === 'enter'
              ? { ...t, phase: 'visible' as const }
              : t,
          ),
        );
      }, 16);
      enterTimers.current.set(id, enterHandle);

      scheduleAutoDismiss(id);
    },
    [beginExit, scheduleAutoDismiss],
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const handle of dismissTimers.current.values()) {
        window.clearTimeout(handle);
      }
      for (const handle of exitTimers.current.values()) {
        window.clearTimeout(handle);
      }
      for (const handle of enterTimers.current.values()) {
        window.clearTimeout(handle);
      }
      dismissTimers.current.clear();
      exitTimers.current.clear();
      enterTimers.current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss: beginExit }),
    [toast, beginExit],
  );

  const portal =
    typeof document !== 'undefined'
      ? createPortal(
          <div
            className="ui-toast-viewport"
            data-testid="ui-toast-viewport"
            aria-label="Notificaciones"
          >
            {items.map((item) => (
              <ToastCard key={item.id} item={item} onDismiss={beginExit} />
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {portal}
    </ToastContext.Provider>
  );
}

/**
 * Imperative toast API. Must be used under `ToastProvider`.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
