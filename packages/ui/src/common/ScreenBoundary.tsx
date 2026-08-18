/**
 * Per-screen error boundary (Fase 5.4 roadmap-screens).
 *
 * Wraps the workspace screens (Fábrica, Ingeniería, Ventas, Compras/Almacén,
 * Estado de Planta) so a render throw shows a compact fallback INSIDE the
 * shell — the nav keeps working and the rest of the app survives — instead
 * of falling through to the root boundary that blanks everything.
 */

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import './errorBoundary.css';

export type ScreenBoundaryProps = {
  readonly children: ReactNode;
  /** Screen name for the fallback copy, e.g. "Fábrica". */
  readonly screenLabel: string;
  /** Optional escape hatch (usually "go home") rendered next to Reintentar. */
  readonly onGoHome?: () => void;
};

export function ScreenBoundary({
  children,
  screenLabel,
  onGoHome,
}: ScreenBoundaryProps): ReactNode {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div
          className="error-boundary error-boundary--screen"
          role="alert"
          data-testid="screen-error-fallback"
        >
          <div className="error-boundary__card">
            <AlertTriangle
              className="error-boundary__icon"
              size={32}
              strokeWidth={1.5}
              aria-hidden
            />
            <h2 className="error-boundary__title">
              No pudimos mostrar {screenLabel}
            </h2>
            <p className="error-boundary__message">
              El resto de la aplicación sigue funcionando. Podés reintentar o
              ir al inicio.
            </p>
            <p className="error-boundary__detail">{error.message}</p>
            <div className="error-boundary__actions">
              <button type="button" className="btn btn--primary" onClick={reset}>
                Reintentar
              </button>
              {onGoHome ? (
                <button type="button" className="btn" onClick={onGoHome}>
                  Ir al inicio
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
