/**
 * Detailed projects table for EngineeringDashboard.
 */

import type { ReactNode } from 'react';
import { LayoutGrid, SearchX } from 'lucide-react';
import {
  ENGINEERING_STATUS_LABELS_ES,
  type EngineeringDashboardProjectMetrics,
  type EngineeringStatus,
} from '@muebles/domain';
import { EmptyState } from '../../common';

const STATUS_BADGE_MODIFIERS: Readonly<Record<EngineeringStatus, string>> = {
  pending: 'open',
  in_progress: 'progress',
  documented: 'done',
};

export interface EngineeringProjectsTableProps {
  readonly projects: readonly EngineeringDashboardProjectMetrics[];
  readonly resolveEngineerName: (id?: string) => string;
  readonly onOpenProject: (projectId: string) => void;
}

export function EngineeringProjectsTable({
  projects,
  resolveEngineerName,
  onOpenProject,
}: EngineeringProjectsTableProps): ReactNode {
  return (
    <div className="eng-dashboard__panel">
      <div className="eng-dashboard__panel-header">
        <LayoutGrid
          size={16}
          strokeWidth={1.5}
          className="eng-dashboard__panel-icon"
        />
        <h3 className="eng-dashboard__panel-title">
          Trazabilidad Técnica de Obras ({projects.length})
        </h3>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Sin obras para mostrar"
          description="No hay proyectos que coincidan con los filtros seleccionados."
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table" aria-label="Proyectos de ingeniería">
            <thead>
              <tr>
                <th>Obra / Cliente</th>
                <th>Estado</th>
                <th>Responsable</th>
                <th>Revisión</th>
                <th>Espera</th>
                <th>Ciclo</th>
                <th>Módulos</th>
                <th style={{ textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.projectId} data-testid={`eng-row-${p.projectId}`}>
                  <td>
                    <div className="eng-dashboard__table-project">
                      <span className="eng-dashboard__table-name">
                        {p.projectName}
                      </span>
                      {p.customerLabel ? (
                        <span className="eng-dashboard__table-sub">
                          {p.customerLabel}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`status-badge status-badge--${
                        p.isSentToProduction
                          ? 'done'
                          : STATUS_BADGE_MODIFIERS[p.status]
                      }`}
                    >
                      <span className="status-badge__dot" aria-hidden>
                        ●
                      </span>
                      {p.isSentToProduction
                        ? 'Enviada a planta'
                        : ENGINEERING_STATUS_LABELS_ES[p.status]}
                    </span>
                  </td>
                  <td>
                    <span className="eng-dashboard__table-engineer">
                      {resolveEngineerName(p.engineerId)}
                    </span>
                  </td>
                  <td>
                    <span className="meta-chip">Rev. {p.revision}</span>
                  </td>
                  <td>
                    <span className="eng-dashboard__table-time">
                      {p.waitTimeHours !== undefined
                        ? `${p.waitTimeHours}h`
                        : '—'}
                    </span>
                  </td>
                  <td>
                    <span className="eng-dashboard__table-time">
                      {p.cycleTimeHours !== undefined
                        ? `${p.cycleTimeHours}h`
                        : '—'}
                    </span>
                  </td>
                  <td>
                    <span className="eng-dashboard__table-num">
                      {p.moduleCount}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn--secondary btn--small"
                      onClick={() => onOpenProject(p.projectId)}
                      aria-label={`Abrir workspace de ${p.projectName}`}
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
