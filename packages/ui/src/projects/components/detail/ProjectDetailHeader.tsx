/**
 * Header and action toolbar for ProjectDetailView.
 */

import { type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Factory,
  HardHat,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';
import {
  TECHNICAL_STATUS_METADATA,
  COMMERCIAL_STATUS_LABELS_ES,
  PROJECT_STAGE_LABELS_ES,
  deriveProjectStage,
  isProjectStaleForProduction,
  type ProjectStatus,
} from '@granete/domain';
import { DropdownMenu, type DropdownMenuSection } from '../../../common';
import { WhatsAppButton } from '../../../crm/WhatsAppButton';
import { StatusBadge } from '../StatusBadge';
import { formatProjectMoney, resolveCustomerName } from '../../projectHelpers';
import { useProjectDetail } from '../projectDetailContext';

export type ChromePrimary =
  | 'open-production'
  | 'mark-produced'
  | 'export'
  | null;

export interface ProjectDetailHeaderProps {
  readonly primary: ChromePrimary;
  readonly chromeSale: number | null;
  readonly moreSections: readonly DropdownMenuSection[];
  readonly exportMenuClose?: () => void;
  readonly onRequestStatus?: (next: ProjectStatus, message: string) => void;
  readonly confirmSendText?: string;
  readonly confirmAcceptText?: string;
}

export function ProjectDetailHeader({
  primary,
  chromeSale,
  moreSections,
  exportMenuClose,
}: ProjectDetailHeaderProps): ReactNode {
  const ctx = useProjectDetail();
  const {
    project,
    customers,
    exportBusy,
    productionExportDisabled,
    productionExportOk,
    onOpenInProduction,
    onExport,
    onBackToList,
    onOpenSpatialStudio,
    onEditMeta,
    onMarkProduced,
    onChangeStatus,
    canMutate,
    canMarkProduced,
    quoteAuthority,
    onOpenReconciliation,
  } = ctx;

  const hasOpenInProduction = Boolean(onOpenInProduction);
  const canEditContent = canMutate && project.status === 'draft';

  const exportTitle = !productionExportOk
    ? 'Export de producción solo con una cotización aceptada (o En producción)'
    : 'Exportar cut-list Optimizer (.xlsx)';

  const showExportInChrome =
    Boolean(onExport) && productionExportOk && !hasOpenInProduction;

  const showMarkProducedInChrome =
    primary === 'mark-produced' &&
    Boolean(onMarkProduced) &&
    canMarkProduced &&
    !hasOpenInProduction;

  const frozenAuthority = quoteAuthority?.kind === 'ready' ? quoteAuthority : null;
  const frozenCustomer = frozenAuthority
    ? customers.find((customer) => customer.id === frozenAuthority.customerId)
    : null;
  const identityUnavailable = quoteAuthority && !frozenAuthority;
  const detailCurrency = frozenAuthority?.currency ?? (!quoteAuthority ? project.currency : null);

  return (
    <header className="workspace-chrome" data-testid="project-detail-chrome">
      <div className="workspace-chrome__lead">
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={onBackToList}
          aria-label="Volver a la lista"
        >
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
          Lista
        </button>
        <div className="workspace-chrome__identity">
          <div className="workspace-chrome__title-row">
            <h2 className="workspace-chrome__title">
              {frozenAuthority
                ? frozenAuthority.projectName
                : quoteAuthority?.kind === 'loading'
                  ? 'Cargando cotización…'
                  : identityUnavailable
                    ? 'Cotización comercial no disponible'
                    : project.name}
            </h2>
            {quoteAuthority?.kind === 'ready' ? (
              <span className={`status-badge status-badge--${quoteAuthority.status === 'accepted' ? 'accepted' : quoteAuthority.status === 'published' ? 'quoted' : 'draft'}`}>
                Q{quoteAuthority.revisionNumber} · {quoteAuthority.status === 'accepted' ? 'Aceptada' : quoteAuthority.status === 'published' ? 'Publicada' : quoteAuthority.status === 'superseded' ? 'Reemplazada' : 'Borrador'}
              </span>
            ) : quoteAuthority ? (
              <span className="badge badge--warning-subtle">Sin autoridad comercial</span>
            ) : (
              <StatusBadge status={project.status} />
            )}
            <span
              className="badge badge--neutral-subtle"
              title="Etapa Operativa del Proyecto"
              style={{ fontSize: '0.75rem' }}
            >
              {PROJECT_STAGE_LABELS_ES[deriveProjectStage(project)]}
            </span>
            {project.commercialStatus && (
              <span
                className={`badge badge--${
                  project.commercialStatus === 'won'
                    ? 'success-subtle'
                    : project.commercialStatus === 'lost' || project.commercialStatus === 'cancelled'
                      ? 'danger-subtle'
                      : 'info-subtle'
                }`}
                title="Estado Comercial"
                style={{ fontSize: '0.75rem' }}
              >
                {COMMERCIAL_STATUS_LABELS_ES[project.commercialStatus]}
              </span>
            )}
            {isProjectStaleForProduction(project) && (
              <span
                className="badge badge--danger-subtle"
                title="Cambios posteriores a la liberación detectados (Stale)"
                style={{ fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
              >
                <AlertTriangle size={11} aria-hidden="true" />
                Stale
              </span>
            )}
            {project.technicalStatus && project.technicalStatus !== 'pending_assignment' ? (
              <span
                className={`status-badge status-badge--${
                  TECHNICAL_STATUS_METADATA[project.technicalStatus].color === 'neutral'
                    ? 'cancelled'
                    : TECHNICAL_STATUS_METADATA[project.technicalStatus].color === 'info'
                      ? 'open'
                      : TECHNICAL_STATUS_METADATA[project.technicalStatus].color === 'success'
                        ? 'done'
                        : TECHNICAL_STATUS_METADATA[project.technicalStatus].color
                }`}
                style={{ marginLeft: '0.25rem', fontSize: '0.75rem' }}
                title={TECHNICAL_STATUS_METADATA[project.technicalStatus].description}
              >
                <HardHat size={12} />
                {TECHNICAL_STATUS_METADATA[project.technicalStatus].shortLabel}
              </span>
            ) : null}
          </div>

          <p className="workspace-chrome__subtitle">
            {frozenAuthority
              ? frozenAuthority.customerName
              : quoteAuthority
                ? 'Identidad, moneda y cantidades no disponibles sin una revisión exacta.'
                : resolveCustomerName(project.customerId, customers)}
            {frozenAuthority ? (
              frozenCustomer?.phone ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>·</span>
                  <WhatsAppButton
                    customerName={frozenAuthority.customerName}
                    phone={frozenCustomer.phone}
                    projectName={frozenAuthority.projectName}
                    quoteAmount={chromeSale != null ? formatProjectMoney(chromeSale, frozenAuthority.currency) : undefined}
                    workshopName={ctx.workshopName}
                    compact
                    label="WhatsApp"
                  />
                </>
              ) : (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>·</span>
                  Teléfono no disponible para Q{frozenAuthority.revisionNumber}
                </>
              )
            ) : null}
            {frozenAuthority || !quoteAuthority ? (
              <>
                <span className="workspace-chrome__dot" aria-hidden>·</span>
                {frozenAuthority?.furnitureQuantity ?? project.items.length} mueble{(frozenAuthority?.furnitureQuantity ?? project.items.length) === 1 ? '' : 's'}
                <span className="workspace-chrome__dot" aria-hidden>·</span>
                {detailCurrency}
              </>
            ) : null}
            {!quoteAuthority && ctx.showCosts ? (
              <>
                <span className="workspace-chrome__dot" aria-hidden>·</span>
                Margen ×{project.marginFactor.toFixed(2)}
              </>
            ) : null}
          </p>
        </div>
      </div>
      <div className="workspace-chrome__total" data-testid="project-detail-total">
        <span className="workspace-chrome__total-label">Precio de venta</span>
        <span className={chromeSale == null ? 'workspace-chrome__total-value workspace-chrome__total-value--muted' : 'workspace-chrome__total-value'}>
          {chromeSale == null || !detailCurrency ? '—' : formatProjectMoney(chromeSale, detailCurrency)}
        </span>
      </div>
      <div
        className="workspace-chrome__actions project-detail__chrome-actions"
        data-testid="project-chrome-actions"
      >
        {quoteAuthority?.kind === 'ready' && onOpenReconciliation && quoteAuthority.status !== 'accepted' ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onOpenReconciliation(project.id, quoteAuthority.revisionId)}
            data-testid="quote-revision-lifecycle-action"
          >
            Gestionar Q{quoteAuthority.revisionNumber}
          </button>
        ) : null}
        {quoteAuthority?.kind === 'error' ? (
          <button type="button" className="btn btn--secondary" onClick={quoteAuthority.onRetry}>
            Reintentar carga
          </button>
        ) : null}
        {(quoteAuthority?.kind === 'empty' || quoteAuthority?.kind === 'legacy') && onOpenReconciliation ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onOpenReconciliation(
              project.id,
              quoteAuthority.kind === 'legacy' ? quoteAuthority.revisionId : undefined,
            )}
          >
            Crear nueva revisión
          </button>
        ) : null}
        {primary === 'open-production' && onOpenInProduction ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onOpenInProduction(project.id)}
            data-testid="project-open-in-production"
            title="Abre la orden en el workspace de Producción (solo fábrica)"
          >
            <Factory size={16} strokeWidth={1.5} aria-hidden /> Abrir en
            Producción
          </button>
        ) : null}

        {showMarkProducedInChrome && onMarkProduced ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onMarkProduced(project.id)}
            data-testid="project-mark-produced"
          >
            <Factory size={16} strokeWidth={1.5} aria-hidden /> Marcar en
            producción
          </button>
        ) : null}

        {showExportInChrome && onExport ? (
          <button
            type="button"
            className={primary === 'export' ? 'btn btn--primary' : 'btn'}
            disabled={productionExportDisabled}
            title={exportTitle}
            onClick={() => {
              void onExport?.();
            }}
            data-testid="project-chrome-export"
          >
            {exportBusy ? 'Exportando…' : 'Exportar Optimizer'}
          </button>
        ) : null}

        {onOpenSpatialStudio ? (
          <button
            type="button"
            className="btn"
            onClick={onOpenSpatialStudio}
            data-testid="project-chrome-projectar"
            title="Estudio 3D: colocar y mover muebles en el ambiente"
          >
            Proyectar
          </button>
        ) : null}

        {canEditContent ? (
          <button
            type="button"
            className="btn"
            onClick={() => onEditMeta(project)}
            data-testid="project-chrome-edit"
            title="Editar nombre, cliente y datos comerciales (solo borrador)"
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden /> Editar
          </button>
        ) : null}

        {moreSections.length > 0 ? (
          <DropdownMenu
            ariaLabel="Más acciones de la cotización"
            triggerLabel={exportBusy ? 'Trabajando…' : 'Más'}
            triggerIcon={
              <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
            }
            triggerClassName="btn"
            disabled={
              exportBusy &&
              moreSections.every((s) => s.items.every((i) => i.disabled))
            }
            sections={moreSections}
            onClose={exportMenuClose}
          />
        ) : null}
      </div>
    </header>
  );
}
