import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { SalesAlert } from './salesDashboardHelpers';

export function AlertsSection({
  alerts,
  onOpenProject,
}: {
  readonly alerts: readonly SalesAlert[];
  /** #1142 P1: cada alerta lleva a su obra — el dato ya viajaba, la acción no. */
  readonly onOpenProject?: (projectId: string) => void;
}): ReactNode {
  if (alerts.length === 0) return null;

  return (
    <div className="sales-alerts">
      <h3 className="sales-alerts__title">
        <AlertTriangle size={16} strokeWidth={1.5} />
        Alertas
      </h3>
      <ul className="sales-alerts__list">
        {alerts.map((alert) =>
          onOpenProject ? (
            <li key={`${alert.type}-${alert.projectId}`} className="sales-alerts__item">
              <button
                type="button"
                className="sales-alerts__link"
                onClick={() => onOpenProject(alert.projectId)}
                data-testid={`sales-alert-${alert.projectId}`}
              >
                <span className="sales-alerts__text">{alert.message}</span>
                <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ) : (
            <li key={`${alert.type}-${alert.projectId}`} className="sales-alerts__item">
              <span className="sales-alerts__text">{alert.message}</span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
