/**
 * Production home — listos para fabricar (F038).
 * Presentation only; factory file exports live in the OP hub (not the queue).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { Project } from '@muebles/domain';
import {
  CheckCircle2,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  LayoutGrid,
} from 'lucide-react';
import { EmptyState, InlineLoading } from '../common';
import { ProductionBoardView } from './ProductionBoardView';
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
  /** Open production order hub (PROD-0.1). Primary path into the OP. */
  readonly onOpenOrder?: (projectId: string) => void;
  /**
   * Legacy: Optimizer from the queue when hub is not wired.
   * With `onOpenOrder`, cut/herrajes/etiquetas live only in the OP hub.
   */
  readonly onExportOptimizer?: (projectId: string) => void | Promise<void>;
  /** ZIP pack shortcut from the queue (optional). */
  readonly onExportProductionPack?: (projectId: string) => void | Promise<void>;
  readonly onMarkProduced: (projectId: string) => void;
  readonly exportBusy?: boolean;
  readonly loading?: boolean;
  /**
   * Optional cut-board preview on the card.
   * Prefer OP hub → Optimización when `onOpenOrder` is available.
   */
  readonly cutRowsFor?: (
    projectId: string,
  ) => readonly import('@muebles/domain').ProductionCutRow[] | undefined;
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
  onOpenOrder,
  onExportOptimizer,
  onExportProductionPack,
  onMarkProduced,
  exportBusy = false,
  loading = false,
  cutRowsFor,
}: ProductionQueueProps): ReactNode {
  const [tab, setTab] = useState<ProductionQueueTab>('accepted');
  const [expandedBoard, setExpandedBoard] = useState<string | null>(null);
  /** Hub is the primary workspace: queue cards stay triage-only. */
  const hubWired = Boolean(onOpenOrder);
  /** Board preview on cards only when no hub (legacy) or explicit cutRows. */
  const showBoardToggle = Boolean(cutRowsFor) && !hubWired;

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

  const title =
    tab === 'accepted' ? 'Para fabricar' : 'Ya en producción';
  const subtitle =
    tab === 'accepted'
      ? 'Pedidos aceptados. Abrí la orden para pack, despiece y piso — acá solo elegís la obra.'
      : 'Ya marcadas en producción. Reabrí la orden para reexportar o ver el avance.';

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
            <h2 className="prod-queue__title" data-testid="prod-queue-title">
              {title}
            </h2>
            <p className="prod-queue__subtitle">{subtitle}</p>
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
          Ya en producción
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          variant="empty"
          icon={Factory}
          title={
            tab === 'accepted'
              ? 'No hay cotizaciones aceptadas'
              : 'Todavía no hay nada en producción'
          }
          description={
            tab === 'accepted'
              ? 'Cuando ventas acepte un pedido, aparece acá para abrir la orden de fábrica.'
              : 'Las obras que marques «En producción» se listan en esta pestaña.'
          }
        />
      ) : (
        <ul className="prod-queue__list" aria-label="Cola de fabricación">
          {rows.map((project) => {
            const sale = salePriceFor(project.id);
            return (
              <li key={project.id} className="prod-queue-card">
                <div className="prod-queue-card__row">
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
                    {onOpenOrder ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => onOpenOrder(project.id)}
                        data-testid={`prod-open-order-${project.id}`}
                      >
                        <Factory size={16} strokeWidth={1.5} aria-hidden />
                        Abrir orden
                      </button>
                    ) : null}
                    {onExportProductionPack ? (
                      <button
                        type="button"
                        className={onOpenOrder ? 'btn' : 'btn btn--primary'}
                        disabled={exportBusy}
                        title="ZIP con Optimizer, herrajes, etiquetas y docs de taller"
                        onClick={() => {
                          void onExportProductionPack(project.id);
                        }}
                        data-testid={`prod-export-pack-${project.id}`}
                      >
                        <FileSpreadsheet
                          size={16}
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        Pack
                      </button>
                    ) : null}
                    {/* Legacy path: no hub — keep Optimizer as primary plant action. */}
                    {!hubWired && onExportOptimizer ? (
                      <button
                        type="button"
                        className={
                          onExportProductionPack ? 'btn' : 'btn btn--primary'
                        }
                        disabled={exportBusy}
                        onClick={() => {
                          void onExportOptimizer(project.id);
                        }}
                        data-testid={`prod-export-opt-${project.id}`}
                      >
                        <FileSpreadsheet
                          size={16}
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        {exportBusy ? 'Exportando…' : 'Exportar corte'}
                      </button>
                    ) : null}
                    {project.status === 'accepted' ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => onMarkProduced(project.id)}
                        data-testid={`prod-mark-${project.id}`}
                      >
                        <CheckCircle2
                          size={16}
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        Marcar en producción
                      </button>
                    ) : null}
                  </div>
                </div>
                {showBoardToggle ? (
                  <div className="prod-queue-card__board-toggle">
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() =>
                        setExpandedBoard(
                          expandedBoard === project.id ? null : project.id,
                        )
                      }
                      data-testid={`prod-board-toggle-${project.id}`}
                    >
                      <LayoutGrid size={14} strokeWidth={1.5} aria-hidden />
                      {expandedBoard === project.id
                        ? 'Ocultar tablero'
                        : 'Ver tablero'}
                    </button>
                  </div>
                ) : null}
                {showBoardToggle &&
                expandedBoard === project.id &&
                cutRowsFor ? (
                  <div className="prod-queue-card__board">
                    <ProductionBoardView rows={cutRowsFor(project.id) ?? []} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
