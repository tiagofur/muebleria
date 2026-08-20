import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SalesAlert } from './salesDashboardHelpers';

export function AlertsSection({
  alerts,
}: {
  readonly alerts: readonly SalesAlert[];
}): ReactNode {
  if (alerts.length === 0) return null;

  return (
    <div className="sales-alerts">
      <h3 className="sales-alerts__title">
        <AlertTriangle size={16} strokeWidth={1.5} />
        Alertas
      </h3>
      <ul className="sales-alerts__list">
        {alerts.map((alert) => (
          <li key={`${alert.type}-${alert.projectId}`} className="sales-alerts__item">
            <span className="sales-alerts__text">{alert.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
