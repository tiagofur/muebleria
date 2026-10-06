/**
 * Detailed projects table for EngineeringDashboard.
 */

import type { ReactNode } from 'react';
import { LayoutGrid, SearchX } from 'lucide-react';
import {
  ENGINEERING_ENTRY_STATUS_LABELS_ES,
  type EngineeringDashboardProjectMetrics,
  type EngineeringEntryStatus,
} from '@granete/domain';
import { EmptyState } from '../../common';

const STATUS_BADGE_MODIFIERS: Readonly<Record<EngineeringEntryStatus, string>> = {
  pending: 'open',
  in_progress: 'progress',
  completed: 'done',
  documented: 'done',
  unverified: 'progress',
};

export interface EngineeringProjectsTableProps {
  readonly projects: readonly EngineeringDashboardProjectMetrics[];
  readonly resolveEngineerName: (id?: string) => string;
  readonly onOpenProject: (projectId: string) => void;
  /** #1183 P3: salida honesta cuando los filtros activos no dejan filas. */
  readonly onClearFilters?: () => void;
}

export function EngineeringProjectsTable({
  projects,
  resolveEngineerName,
  onOpenProject,
  onClearFilters,
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
          variant="no-results"
          title="Sin obras para mostrar"
          description="No hay proyectos que coincidan con los filtros seleccionados."
          actionLabel={onClearFilters ? 'Limpiar filtros' : undefined}
          onAction={onClearFilters}
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table" aria-label="Proyectos de ingeniería">
            <thead>
              <tr>
                <th scope="col">Obra / Cliente</th>
                <th scope="col">Estado</th>
                <th scope="col">Responsable</th>
                <th scope="col">Revisión</th>
                <th scope="col">Espera</th>
                <th scope="col">Ciclo</th>
                <th scope="col">Módulos</th>
                <th scope="col" className="eng-dashboard__th-actions">Acción</th>
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
                        : ENGINEERING_ENTRY_STATUS_LABELS_ES[p.status]}
                    </span>
                  </td>
                  <td>
                    <span className="eng-dashboard__table-engineer">
                      {resolveEngineerName(p.engineerId)}
                    </span>
                  </td>
                  <td>
                    {/* #1183 P1: sin log no hay revisión real que mostrar. */}
                    <span className="meta-chip">
                      {p.revision !== null ? `Rev. ${p.revision}` : 'Rev. —'}
                    </span>
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
                        ? `${p.cycleTimeHours}h${p.isSentToProduction ? '' : ' (en curso)'}`
                        : '—'}
                    </span>
                  </td>
                  <td>
                    <span className="eng-dashboard__table-num">
                      {p.moduleCount}
                    </span>
                  </td>
                  <td className="eng-dashboard__td-actions">
                    <button
                      type="button"
                      className="btn btn--small"
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
