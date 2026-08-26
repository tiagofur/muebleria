/**
 * Stagnant projects alerts section for EngineeringDashboard.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { EngineeringDashboardProjectMetrics } from '@granete/domain';

export interface EngineeringStagnantAlertsProps {
  readonly stagnantAlerts: readonly EngineeringDashboardProjectMetrics[];
  readonly onOpenProject: (projectId: string) => void;
}

export function EngineeringStagnantAlerts({
  stagnantAlerts,
  onOpenProject,
}: EngineeringStagnantAlertsProps): ReactNode {
  if (stagnantAlerts.length === 0) return null;

  return (
    <div
      className="eng-dashboard__alerts-section"
      data-testid="eng-stagnant-alerts"
    >
      <div className="eng-dashboard__alerts-header">
        <AlertTriangle
          size={18}
          strokeWidth={1.5}
          className="eng-dashboard__alert-icon"
        />
        <h3 className="eng-dashboard__alerts-title">
          Alertas de Obras Demoradas ({stagnantAlerts.length})
        </h3>
      </div>
      <ul className="eng-dashboard__alerts-list">
        {stagnantAlerts.map((alert) => (
          <li key={alert.projectId} className="eng-dashboard__alert-item">
            <div className="eng-dashboard__alert-info">
              <span className="eng-dashboard__alert-name">
                {alert.projectName}
              </span>
              {alert.customerLabel ? (
                <span className="eng-dashboard__alert-customer">
                  · {alert.customerLabel}
                </span>
              ) : null}
              <span className="eng-dashboard__alert-reason">
                {alert.stagnantReason}
              </span>
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => onOpenProject(alert.projectId)}
            >
              Abrir obra <ArrowRight size={12} strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
