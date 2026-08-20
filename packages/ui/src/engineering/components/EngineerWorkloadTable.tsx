/**
 * Engineer team workload cards for EngineeringDashboard.
 */

import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import type { EngineerWorkloadSummary } from '@muebles/domain';

export interface EngineerWorkloadTableProps {
  readonly engineerWorkload: readonly EngineerWorkloadSummary[];
  readonly resolveEngineerName: (id?: string) => string;
}

export function EngineerWorkloadTable({
  engineerWorkload,
  resolveEngineerName,
}: EngineerWorkloadTableProps): ReactNode {
  if (engineerWorkload.length === 0) return null;

  return (
    <div className="eng-dashboard__panel" data-testid="eng-workload-panel">
      <div className="eng-dashboard__panel-header">
        <Users
          size={16}
          strokeWidth={1.5}
          className="eng-dashboard__panel-icon"
        />
        <h3 className="eng-dashboard__panel-title">
          Carga por Ingeniero Responsable
        </h3>
      </div>
      <div className="eng-dashboard__workload-grid">
        {engineerWorkload.map((eng) => (
          <div key={eng.engineerId} className="eng-dashboard__workload-card">
            <div className="eng-dashboard__workload-header">
              <span className="eng-dashboard__workload-name">
                {resolveEngineerName(eng.engineerId)}
              </span>
              <span className="meta-chip">{eng.totalAssigned} obras</span>
            </div>
            <div className="eng-dashboard__workload-metrics">
              <div className="eng-dashboard__workload-stat">
                <span className="eng-dashboard__workload-num">
                  {eng.activeCount}
                </span>
                <span className="eng-dashboard__workload-lbl">En proceso</span>
              </div>
              <div className="eng-dashboard__workload-stat">
                <span className="eng-dashboard__workload-num">
                  {eng.documentedCount}
                </span>
                <span className="eng-dashboard__workload-lbl">
                  Documentadas
                </span>
              </div>
              <div className="eng-dashboard__workload-stat">
                <span className="eng-dashboard__workload-num">
                  {eng.sentCount}
                </span>
                <span className="eng-dashboard__workload-lbl">Enviadas</span>
              </div>
              <div className="eng-dashboard__workload-stat">
                <span className="eng-dashboard__workload-num">
                  {eng.avgCycleHours !== null ? `${eng.avgCycleHours}h` : '—'}
                </span>
                <span className="eng-dashboard__workload-lbl">
                  Ciclo prom.
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
