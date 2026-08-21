/**
 * KPI stats cards & cycle time analytics for EngineeringDashboard.
 */

import type { ReactNode } from 'react';
import {
  Clock,
  FileCheck,
  FileText,
  Layers,
  Send,
} from 'lucide-react';
import type { EngineeringDashboardStats } from '@muebles/domain';

export interface EngineeringKpiStatsGridProps {
  readonly stats: EngineeringDashboardStats;
}

export function EngineeringKpiStatsGrid({
  stats,
}: EngineeringKpiStatsGridProps): ReactNode {
  return (
    <>
      {/* Row 1: KPI Stat Cards */}
      <div className="eng-dashboard__stats-grid">
        <div
          className="stat-card stat-card--eng"
          data-testid="eng-stat-kpi-pending"
        >
          <span className="stat-card__icon" aria-hidden>
            <Clock size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.pendingCount}</span>
            <span className="stat-card__label">En espera de inicio</span>
          </div>
        </div>

        <div
          className="stat-card stat-card--eng"
          data-testid="eng-stat-kpi-in-progress"
        >
          <span className="stat-card__icon" aria-hidden>
            <FileText size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.inProgressCount}</span>
            <span className="stat-card__label">En modelado / despiece</span>
          </div>
        </div>

        <div
          className="stat-card stat-card--eng stat-card--emphasis"
          data-testid="eng-stat-kpi-documented"
        >
          <span className="stat-card__icon" aria-hidden>
            <FileCheck size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">{stats.documentedCount}</span>
            <span className="stat-card__label">
              Listas para enviar a planta
            </span>
          </div>
        </div>

        <div
          className="stat-card stat-card--eng"
          data-testid="eng-stat-kpi-sent"
        >
          <span className="stat-card__icon" aria-hidden>
            <Send size={18} strokeWidth={1.5} />
          </span>
          <div className="stat-card__body">
            <span className="stat-card__value">
              {stats.sentToProductionCount}
            </span>
            <span className="stat-card__label">Despachadas a planta</span>
          </div>
        </div>
      </div>

      {/* Row 2: Performance & Cycle Times Grid */}
      <div className="eng-dashboard__metrics-grid">
        <div className="eng-dashboard__panel">
          <div className="eng-dashboard__panel-header">
            <Clock
              size={16}
              strokeWidth={1.5}
              className="eng-dashboard__panel-icon"
            />
            <h3 className="eng-dashboard__panel-title">
              Tiempos de Ciclo y Calidad
            </h3>
          </div>
          <div className="eng-dashboard__cycle-grid">
            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.avgWaitTimeHours !== null
                  ? `${stats.avgWaitTimeHours}h`
                  : '—'}
              </span>
              <span className="eng-dashboard__cycle-label">
                Espera en cola promedio
                <span className="eng-dashboard__cycle-sub">
                  {' '}
                  (aceptación → inicio)
                </span>
              </span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.avgCycleTimeHours !== null
                  ? `${stats.avgCycleTimeHours}h`
                  : '—'}
              </span>
              <span className="eng-dashboard__cycle-label">
                Documentación técnica
                <span className="eng-dashboard__cycle-sub">
                  {' '}
                  (inicio → envío a planta)
                </span>
              </span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.avgRevisionCount !== null
                  ? `v${stats.avgRevisionCount}`
                  : 'v1.0'}
              </span>
              <span className="eng-dashboard__cycle-label">
                Revisiones promedio
                <span className="eng-dashboard__cycle-sub">
                  {' '}
                  (packs generados por obra)
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="eng-dashboard__panel">
          <div className="eng-dashboard__panel-header">
            <Layers
              size={16}
              strokeWidth={1.5}
              className="eng-dashboard__panel-icon"
            />
            <h3 className="eng-dashboard__panel-title">
              Volumen Técnico Procesado
            </h3>
          </div>
          <div className="eng-dashboard__cycle-grid">
            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.totalModulesCalculated}
              </span>
              <span className="eng-dashboard__cycle-label">
                Módulos procesados
              </span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.totalCutPiecesCalculated}
              </span>
              <span className="eng-dashboard__cycle-label">
                Piezas estimadas
                {stats.totalCutPiecesOrigin === 'proxy' ? (
                  <span className="eng-dashboard__cycle-sub"> (~8/módulo)</span>
                ) : null}
              </span>
            </div>

            <div className="eng-dashboard__cycle-item">
              <span className="eng-dashboard__cycle-value">
                {stats.totalActiveQueue}
              </span>
              <span className="eng-dashboard__cycle-label">
                Obras en circuito
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
