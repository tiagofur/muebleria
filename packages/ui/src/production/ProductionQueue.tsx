/**
 * Production home — listos para fabricar (F038).
 * Presentation only; export / mark produced owned by shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { Project } from '@muebles/domain';
import {
  CheckCircle2,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  Tags,
  Wrench,
} from 'lucide-react';
import { EmptyState, InlineLoading } from '../common';
import {
  formatIsoDate,
  projectStatusBadgeClass,
  projectStatusLabel,
} from '../projects/projectHelpers';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import {
  filterProductionQueue,
  type ProductionQueueTab,
} from './productionHelpers';
import './production.css';

export type ProductionQueueItem = {
  readonly project: Project;
  readonly customerLabel: string;
  readonly salePrice: number | null;
};

export type ProductionQueueProps = {
  readonly projects: readonly Project[];
  readonly customerLabelFor: (customerId: string) => string;
  readonly salePriceFor: (projectId: string) => number | null;
  readonly onExportOptimizer: (projectId: string) => void | Promise<void>;
  readonly onExportHardware: (projectId: string) => void | Promise<void>;
  /** Piece labels PDF with edge banding (F046 / #96). */
  readonly onExportPieceLabels?: (projectId: string) => void | Promise<void>;
  readonly onMarkProduced: (projectId: string) => void;
  readonly exportBusy?: boolean;
  readonly loading?: boolean;
};

function StatusBadge({ status }: { readonly status: Project['status'] }): ReactNode {
  return (
    <span className={`status-badge ${projectStatusBadgeClass(status)}`}>
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {projectStatusLabel(status)}
    </span>
  );
}

export function ProductionQueue({
  projects,
  customerLabelFor,
  salePriceFor,
  onExportOptimizer,
  onExportHardware,
  onExportPieceLabels,
  onMarkProduced,
  exportBusy = false,
  loading = false,
}: ProductionQueueProps): ReactNode {
  const [tab, setTab] = useState<ProductionQueueTab>('accepted');

  const rows = useMemo(
    () => filterProductionQueue(projects, tab),
    [projects, tab],
  );

  if (loading) {
    return (
      <section className="prod-queue" aria-label="Cola de producción">
        <InlineLoading label="Cargando cola…" />
      </section>
    );
  }

  return (
    <section className="prod-queue" aria-label="Cola de producción">
      <header className="prod-queue__header">
        <div className="prod-queue__title-row">
          <Factory
            className="prod-queue__title-icon"
            size={28}
            strokeWidth={1.5}
            aria-hidden
          />
          <div>
            <h2 className="prod-queue__title">Listos para fabricar</h2>
            <p className="prod-queue__subtitle">
              Cotizaciones aceptadas: exportá el corte y los herrajes, y marcá
              cuando salga a planta.
            </p>
          </div>
        </div>
      </header>

      <div
        className="prod-queue__tabs"
        role="tablist"
        aria-label="Estado de la cola"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'accepted'}
          className={
            tab === 'accepted'
              ? 'prod-queue__tab prod-queue__tab--active'
              : 'prod-queue__tab'
          }
          onClick={() => setTab('accepted')}
          data-testid="prod-tab-accepted"
        >
          <ClipboardList size={16} strokeWidth={1.5} aria-hidden />
          Para fabricar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'produced'}
          className={
            tab === 'produced'
              ? 'prod-queue__tab prod-queue__tab--active'
              : 'prod-queue__tab'
          }
          onClick={() => setTab('produced')}
          data-testid="prod-tab-produced"
        >
          <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden />
          Ya en planta
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          variant="empty"
          icon={Factory}
          title={
            tab === 'accepted'
              ? 'No hay cotizaciones aceptadas'
              : 'Todavía no hay nada marcado en producción'
          }
          description={
            tab === 'accepted'
              ? 'Cuando ventas acepte un pedido, va a aparecer acá para cortar.'
              : 'Las cotizaciones que marques «En producción» se listan acá.'
          }
        />
      ) : (
        <ul className="prod-queue__list" aria-label="Cola de fabricación">
          {rows.map((project) => {
            const sale = salePriceFor(project.id);
            return (
              <li key={project.id} className="prod-queue-card">
                <div className="prod-queue-card__main">
                  <div className="prod-queue-card__top">
                    <h3 className="prod-queue-card__name">{project.name}</h3>
                    <StatusBadge status={project.status} />
                  </div>
                  <p className="prod-queue-card__client">
                    {customerLabelFor(project.customerId) || '—'}
                  </p>
                  <p className="prod-queue-card__meta">
                    Actualizado {formatIsoDate(project.updatedAt)}
                    <span className="prod-queue-card__dot" aria-hidden>
                      ·
                    </span>
                    {project.items.length}{' '}
                    {project.items.length === 1 ? 'mueble' : 'muebles'}
                    {sale != null ? (
                      <>
                        <span className="prod-queue-card__dot" aria-hidden>
                          ·
                        </span>
                        {formatMoneyDisplay(sale, {
                          currency: project.currency,
                        })}
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="prod-queue-card__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={exportBusy}
                    onClick={() => {
                      void onExportOptimizer(project.id);
                    }}
                    data-testid={`prod-export-opt-${project.id}`}
                  >
                    <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
                    {exportBusy ? 'Exportando…' : 'Exportar corte'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={exportBusy}
                    onClick={() => {
                      void onExportHardware(project.id);
                    }}
                    data-testid={`prod-export-hw-${project.id}`}
                  >
                    <Wrench size={16} strokeWidth={1.5} aria-hidden />
                    Herrajes
                  </button>
                  {onExportPieceLabels ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={exportBusy}
                      title="Etiquetas de pieza con instrucción de encintado"
                      onClick={() => {
                        void onExportPieceLabels(project.id);
                      }}
                      data-testid={`prod-export-labels-${project.id}`}
                    >
                      <Tags size={16} strokeWidth={1.5} aria-hidden />
                      Etiquetas
                    </button>
                  ) : null}
                  {project.status === 'accepted' ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onMarkProduced(project.id)}
                      data-testid={`prod-mark-${project.id}`}
                    >
                      <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden />
                      Marcar en producción
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
