/**
 * Root / section error boundary — prevents a render throw from blanking the app.
 * design.md reliability: friendly fallback + reload recovery.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import './errorBoundary.css';

export type ErrorBoundaryProps = {
  readonly children: ReactNode;
  /** Optional custom fallback; receives error + reset. */
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Optional callback when an error is caught (logging / telemetry). */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        className="error-boundary"
        role="alert"
        data-testid="error-boundary-fallback"
      >
        <div className="error-boundary__card">
          <AlertTriangle
            className="error-boundary__icon"
            size={32}
            strokeWidth={1.5}
            aria-hidden
          />
          <h1 className="error-boundary__title">Algo salió mal</h1>
          <p className="error-boundary__message">
            La aplicación encontró un error inesperado. Podés recargar la página
            para continuar.
          </p>
          <p className="error-boundary__detail">{error.message}</p>
          <div className="error-boundary__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Recargar
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={this.reset}
            >
              Intentar de nuevo
            </button>
          </div>
        </div>
      </div>
    );
  }
}
