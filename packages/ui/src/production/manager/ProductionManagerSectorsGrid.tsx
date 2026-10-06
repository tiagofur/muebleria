/**
 * Sector status buttons and collapsible metrics panel for ProductionManagerDashboard.
 */

import type { ReactNode } from 'react';
import {
  Armchair,
  House,
  LayoutGrid,
  Package,
  Scissors,
  Settings2,
  Truck,
  Wand2,
} from 'lucide-react';
import {
  PRODUCTION_SECTOR_LABELS_ES,
  type PipelineSector,
  type ProductionSector,
} from '@granete/domain';
import type { SectorDashboard } from './useProductionDashboardState';

export function SectorIcon({
  sector,
  size = 16,
}: {
  readonly sector: string;
  readonly size?: number;
}): ReactNode {
  const Icon =
    {
      cutting: Scissors,
      edge_banding: Wand2,
      assembly: Armchair,
      packaging: Package,
      shipping: Truck,
      installation: House,
    }[sector] ?? Settings2;
  return <Icon size={size} strokeWidth={1.5} aria-hidden />;
}

export interface ProductionManagerSectorsGridProps {
  readonly sectorStatuses: readonly SectorDashboard[];
  readonly selectedSector: PipelineSector | 'all';
  readonly onSelectSector: (sector: PipelineSector | 'all') => void;
  readonly showMetrics: boolean;
  /** Piezas dañadas hoy; null = sin registro del servidor (se muestra «—»). */
  readonly todayDamages: number | null;
}

export function ProductionManagerSectorsGrid({
  sectorStatuses,
  selectedSector,
  onSelectSector,
  showMetrics,
  todayDamages,
}: ProductionManagerSectorsGridProps): ReactNode {
  return (
    <>
      {/* Sector Status Bar */}
      <div className="pm-dashboard__sectors">
        <h3 className="pm-dashboard__section-title">Estado por Sector</h3>
        <div className="pm-dashboard__sector-grid">
          {/* #1173 P1: salida a «Todas» — volver a la vista completa. */}
          <button
            type="button"
            className={`pm-dashboard__sector-btn ${
              selectedSector === 'all' ? 'pm-dashboard__sector-btn--active' : ''
            }`}
            onClick={() => onSelectSector('all')}
            aria-pressed={selectedSector === 'all'}
            data-testid="pm-sector-all"
          >
            <span className="pm-dashboard__sector-icon">
              <LayoutGrid size={20} strokeWidth={1.5} aria-hidden />
            </span>
            <span className="pm-dashboard__sector-name">Todas</span>
            <span className="pm-dashboard__sector-count">
              {sectorStatuses.reduce((acc, s) => acc + s.queueLength, 0)} en cola
            </span>
          </button>
          {sectorStatuses.map((status) => (
            <button
              key={status.sector}
              type="button"
              className={`pm-dashboard__sector-btn ${
                selectedSector === status.sector
                  ? 'pm-dashboard__sector-btn--active'
                  : ''
              }`}
              onClick={() => onSelectSector(status.sector as PipelineSector)}
              aria-pressed={selectedSector === status.sector}
            >
              <span className="pm-dashboard__sector-icon">
                <SectorIcon sector={status.sector} size={20} />
              </span>
              <span className="pm-dashboard__sector-name">
                {PRODUCTION_SECTOR_LABELS_ES[
                  status.sector as ProductionSector
                ] ?? status.label}
              </span>
              <span className="pm-dashboard__sector-count">
                {status.activeOperators} activos
              </span>
              <span className="pm-dashboard__sector-count">
                {status.queueLength} en cola
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Metrics Panel (collapsible) */}
      {showMetrics && (
        <div className="pm-dashboard__metrics">
          <h3 className="pm-dashboard__section-title">Métricas de Producción</h3>
          <div className="pm-dashboard__metrics-grid">
            {/* «Completadas hoy» vive en las stat cards (sin duplicar). */}
            <div className="pm-dashboard__metric">
              <span className="pm-dashboard__metric-label">
                Piezas Dañadas Hoy
              </span>
              <span className="pm-dashboard__metric-value">
                {todayDamages ?? '—'}
              </span>
            </div>
            {sectorStatuses.map((sector) => (
              <div key={sector.sector} className="pm-dashboard__metric">
                <span className="pm-dashboard__metric-label">
                  {sector.label}
                </span>
                <span className="pm-dashboard__metric-value">
                  {sector.itemsCompletedToday} completados
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
