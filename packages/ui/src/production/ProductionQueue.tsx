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
import { WorkspaceTabs } from '../common/Tabs';
import { ProductionBoardView } from './ProductionBoardView';
import { ProjectFloorStageChip } from './ProjectFloorProgressStrip';
import {
  formatIsoDate,
  projectStatusBadgeClass,
  projectStatusLabel,
} from '../projects/projectHelpers';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import type { FabricActiveClaim } from './fabricProjectCards';
import { isProductionQueueStatus } from './productionHelpers';
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
  /** Active claims — projects with at least one go to "Ya en producción". */
  readonly activeClaims?: readonly FabricActiveClaim[];
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
  activeClaims = [],
}: ProductionQueueProps): ReactNode {
  const [tab, setTab] = useState<'accepted' | 'produced'>('accepted');
  const [expandedBoard, setExpandedBoard] = useState<string | null>(null);
  /** Hub is the primary workspace: queue cards stay triage-only. */
  const hubWired = Boolean(onOpenOrder);
  /** Board preview on cards only when no hub (legacy) or explicit cutRows. */
  const showBoardToggle = Boolean(cutRowsFor) && !hubWired;

  /** IDs of projects that have at least one active claim. */
  const claimedIds = useMemo(
    () => new Set(activeClaims.map((c) => c.projectId)),
    [activeClaims],
  );

  const rows = useMemo(() => {
    return projects
      .filter((p) => isProductionQueueStatus(p.status))
      .filter((p) =>
        tab === 'accepted' ? !claimedIds.has(p.id) : claimedIds.has(p.id),
      )
      .sort((a, b) => {
        if (a.updatedAt < b.updatedAt) return 1;
        if (a.updatedAt > b.updatedAt) return -1;
        return 0;
      });
  }, [projects, tab, claimedIds]);

  if (loading) {
    return (
      <section className="prod-queue" aria-label="Cola de producción">
        <InlineLoading label="Cargando cola…" />
      </section>
    );
  }

  const title = 'Órdenes';
  const subtitle =
    tab === 'accepted'
      ? 'Liberados de Almacén, esperando que arranque el corte.'
      : 'Con corte activo — ya se está fabricando.';

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

      <WorkspaceTabs
        tabs={[
          {
            id: 'accepted',
            label: 'Para fabricar',
            icon: <ClipboardList size={16} strokeWidth={1.5} aria-hidden />,
          },
          {
            id: 'produced',
            label: 'Ya en producción',
            icon: <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden />,
          },
        ]}
        activeTab={tab}
        onTabChange={setTab}
        ariaLabel="Estado de la cola"
        idPrefix="prod-queue"
        testIdPrefix="prod"
      />

      <div
        role="tabpanel"
        id={`prod-queue-panel-${tab}`}
        aria-labelledby={`prod-queue-tab-${tab}`}
      >
        {rows.length === 0 ? (
        <EmptyState
          variant="empty"
          icon={Factory}
          title={
            tab === 'accepted'
              ? 'No hay proyectos para fabricar'
              : 'Ninguno tiene corte activo'
          }
          description={
            tab === 'accepted'
              ? 'Cuando Almacén libere materiales, aparece acá.'
              : 'Las obras con corte iniciado se listan en esta pestaña.'
          }
        />
      ) : (
        <ul className="prod-queue__list" aria-label="Cola de fabricación">
          {rows.map((project) => {
            const sale = salePriceFor(project.id);
            const lastExport = project.production?.lastExportAt;
            const nestingAt = project.nestingImport?.importedAt;
            return (
              <li
                key={project.id}
                className={`prod-queue-card${onOpenOrder ? ' card-open-host' : ''}`}
              >
                <div className="prod-queue-card__row">
                  <div className="prod-queue-card__main">
                    <div className="prod-queue-card__top">
                      {onOpenOrder ? (
                        <h3 className="prod-queue-card__name">
                          <button
                            type="button"
                            className="card-open"
                            onClick={() => onOpenOrder(project.id)}
                            data-testid={`prod-open-order-${project.id}`}
                            aria-label={`Abrir orden ${project.name}`}
                          >
                            {project.name}
                          </button>
                        </h3>
                      ) : (
                        <h3 className="prod-queue-card__name">{project.name}</h3>
                      )}
                      <StatusBadge status={project.status} />
                    </div>
                    <p
                      className="prod-queue-card__client"
                      title={customerLabelFor(project.customerId) || undefined}
                    >
                      {customerLabelFor(project.customerId) || '—'}
                    </p>
                    <p className="prod-queue-card__meta">
                      {project.priceSnapshot?.capturedAt ? (
                        <>
                          <span>Aceptado {formatIsoDate(project.priceSnapshot.capturedAt)}</span>
                          <span className="prod-queue-card__dot" aria-hidden>
                            ·
                          </span>
                        </>
                      ) : null}
                      <span>Actualizado {formatIsoDate(project.updatedAt)}</span>
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
                    <p className="prod-queue-card__signals">
                      <ProjectFloorStageChip project={project} />
                      {lastExport ? (
                          <span
                            className="prod-queue-card__signal"
                            data-testid={`prod-signal-pack-${project.id}`}
                          >
                            Pack generado {formatIsoDate(lastExport)}
                          </span>
                        ) : null}
                        {nestingAt ? (
                          <span
                            className="prod-queue-card__signal"
                            data-testid={`prod-signal-nesting-${project.id}`}
                          >
                            Nesting {formatIsoDate(nestingAt)}
                          </span>
                        ) : null}
                      </p>
                  </div>
                  <div className="prod-queue-card__actions">
                    {onExportProductionPack ? (
                      <button
                        type="button"
                        className="btn btn--primary"
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
                    {project.status === 'accepted' && !claimedIds.has(project.id) ? (
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
      </div>
    </section>
  );
}
