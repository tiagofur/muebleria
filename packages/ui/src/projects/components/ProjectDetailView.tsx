/**
 * Project detail view (F058b) — extracted from ProjectsScreen.renderDetail.
 *
 * Renders the sticky workspace chrome (status + total + action buttons) and
 * the 2-column body (main with options/measure defaults/panels/items + aside
 * with totals + material summary).
 *
 * All state lives in the parent (ProjectsScreen) and is passed down as
 * controlled props: navigation handlers reset most of it and several pieces
 * (3D viewer, add-item) are consumed by sibling modals in the parent.
 *
 * #193 — Props are forwarded into a React Context so child components
 * (items, panels, totals) can pull what they need without prop threading.
 *
 * #refactor — Sub-sections extracted to reduce file size:
 *   - ProjectItemsSection  → items list with 3D, quantity, measure, choices
 *   - ProjectOptionsSection → project-level option defaults
 *   - ProjectMeasureDefaults → depth/height defaults by furniture type
 *   - ProjectTotalsAside   → breakdown, material summary, nesting, issues
 */

import { useMemo, useState, type ReactNode } from 'react';
import type {
  Component,
  Customer,
  ExportIssue,
  FurnitureType,
  Module,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectMaterialSummary,
  ProjectPhoto,
  ProjectPhotoStage,
  ProjectStatus,
  ProjectTechnicalStatus,
  ProjectInternalMessage,
  ProjectInternalMessageType,
  ProjectTemplate,
  QuoteBreakdown,
  Structure,
  WarrantyPhotoKind,
  WarrantyRefabricationPiece,
  WarrantyTicket,
} from '@muebles/domain';
import { TECHNICAL_STATUS_METADATA } from '@muebles/domain';


import {
  Camera,
  Check,
  ChevronLeft,
  Copy,
  Factory,
  HardHat,
  LayoutTemplate,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  DropdownMenu,
  type DropdownMenuItem,
  type DropdownMenuSection,
} from '../../common';
import { KitchenPlanPanel } from './KitchenPlanPanel';
import { QuoteScenarioCompare } from './QuoteScenarioCompare';
import { InstallationChecklistPanel } from './InstallationChecklistPanel';
import { ProjectPhotosGallery } from './ProjectPhotosGallery';
import { InternalCommsPanel } from './InternalCommsPanel';
import { WarrantyTicketsPanel } from './WarrantyTicketsPanel';
import { WhatsAppButton } from '../../crm/WhatsAppButton';
import { StatusBadge } from './StatusBadge';
import { ProjectItemsSection } from './ProjectItemsSection';
import { ProjectOptionsSection } from './ProjectOptionsSection';
import { ProjectMeasureDefaults } from './ProjectMeasureDefaults';
import { ProjectTotalsAside } from './ProjectTotalsAside';
import { allFootprints } from '../kitchenPlanHelpers';
import {
  formatProjectMoney,
  resolveCustomerName,
} from '../projectHelpers';
import {
  ProjectDetailProvider,
  useProjectDetail,
  type ProjectDetailCatalogs,
  type ProjectDetailItemHandlers,
  type ProjectDetailRemoveConfirm,
  type ProjectDetail3DHandlers,
} from './projectDetailContext';

/** Advanced quote tools — collapsed by default (progressive disclosure). */
type QuoteToolsPanel = 'kitchen' | 'scenarios' | 'checklist' | 'photos' | 'internal_comms' | 'warranties' | null;




/**
 * Exactly one lifecycle/production primary per status (buttons.css rule).
 * PROD-0.2: when factory workspace is wired (`onOpenInProduction`), plant-ready
 * primary is open-production — not Optimizer / mark-produced in quote chrome.
 */
type ChromePrimary =
  | 'send'
  | 'accept'
  | 'open-production'
  | 'mark-produced'
  | 'export'
  | null;

// ─── Re-export context types for external consumers ──────────────────
export type { ProjectDetailCatalogs, ProjectDetailItemHandlers, ProjectDetailRemoveConfirm, ProjectDetail3DHandlers };
export { useProjectDetail } from './projectDetailContext';

// ─── Props (unchanged — backward compatible) ────────────────────────

export interface ProjectDetailViewProps {
  // --- Project data ---
  readonly project: Project;
  readonly projectEstimates: Readonly<Record<string, number | null>>;

  // --- Catalog data ---
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalogs: ProjectDetailCatalogs;
  /** Needed so line pickers resolve INTERIOR/FRENTE from structure components. */
  readonly catalogComponents?: readonly Component[];
  readonly catalogStructures?: readonly Structure[];
  readonly customers: readonly Customer[];
  readonly ownerLabels: Readonly<Record<string, string>>;

  // --- Breakdown / totals ---
  readonly breakdown?: QuoteBreakdown | null;
  readonly materialSummary?: ProjectMaterialSummary | null;
  readonly breakdownLoading?: boolean;
  readonly breakdownError?: string | null;
  readonly previewBlocked?: boolean;
  readonly missingGroups?: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly showCosts: boolean;

  // --- Export menu (precomputed by parent) ---
  readonly exportMenu: {
    readonly sections: readonly DropdownMenuSection[];
    readonly onClose?: () => void;
  };
  readonly exportBlockMessage: ReactNode;
  readonly exportErrors: readonly ExportIssue[];
  readonly exportBusy: boolean;
  readonly exportBlocked: boolean;
  readonly productionExportDisabled: boolean;
  readonly productionExportOk: boolean;
  readonly onExport?: () => void | Promise<void>;
  readonly onExportProductionPack?: () => void | Promise<void>;
  /** Navigate to production order hub (PROD-0.1). Only when plant-ready. */
  readonly onOpenInProduction?: (projectId: string) => void;

  // --- Item handlers + inline-remove confirm ---
  readonly itemHandlers: ProjectDetailItemHandlers;
  readonly removeConfirm: ProjectDetailRemoveConfirm;

  // --- Project-level choice / measure handlers ---
  readonly updateProjectLevelChoice: (
    groupCode: string,
    optionId: string,
  ) => void;
  readonly onUpdateMeasureDefaults?: (
    projectId: string,
    defaults:
      | {
          readonly [type in FurnitureType]?: {
            readonly depth?: number;
            readonly height?: number;
          };
        }
      | undefined,
  ) => void;

  // --- 3D viewer ---
  readonly viewer3D: ProjectDetail3DHandlers;

  // --- Item error (detail-side quantity/measure errors) ---
  readonly itemError: string | null;
  readonly addItemModalOpen: boolean;

  // --- Add-item modal trigger ---
  readonly onOpenAddItemModal: () => void;

  // --- Navigation / chrome action handlers ---
  readonly onBackToList: () => void;
  readonly onOpenPresentation: () => void;
  readonly onOpenSpatialStudio?: () => void;
  readonly postAddPlaceCue?: boolean;
  readonly onDismissPostAddPlaceCue?: () => void;
  readonly onOpenSpatialStudioUnplaced?: () => void;
  readonly onEditMeta: (project: Project) => void;
  readonly onDuplicate?: (id: string) => void;
  readonly onSaveAsTemplate?: (projectId: string) => void;
  readonly onMarkProduced?: (projectId: string) => void;
  /** Transition status: draft→quoted, quoted→accepted (gap #3). */
  readonly onChangeStatus?: (projectId: string, status: ProjectStatus) => void;
  readonly onRequestReopen: () => void;
  readonly onRequestDelete: () => void;

  // --- Kitchen layout / scenarios / checklist / nesting callbacks ---
  readonly onUpdateKitchenLayout?: (
    projectId: string,
    layout: import('@muebles/domain').ProjectKitchenLayout,
  ) => void;
  readonly onApplyScenarioB?: (
    projectId: string,
    role: string,
    choiceId: string,
  ) => void;
  readonly onDuplicateWithScenarioB?: (
    projectId: string,
    role: string,
    choiceId: string,
  ) => void;
  readonly onExportScenarioPdf?: (
    projectId: string,
    role: string,
    choiceId: string,
  ) => void;
  readonly onUpdateInstallationChecklist?: (
    projectId: string,
    items: readonly import('@muebles/domain').InstallationChecklistItem[],
  ) => void;
  readonly onImportNesting?: (
    projectId: string,
    nestingImport: NonNullable<Project['nestingImport']>,
  ) => void;
  readonly onUpdateProjectLevelChoices?: (
    projectId: string,
    choices: OptionChoices,
  ) => void;

  // --- Version history (#200) ---
  readonly onRestoreVersion?: (version: number) => void;

  // --- Permission flags ---
  readonly canMutate: boolean;
  readonly canDelete: boolean;
  readonly canReopen: boolean;
  readonly canForceReopenClosed?: boolean;
  readonly canMarkProduced: boolean;
  readonly projectTemplates?: readonly ProjectTemplate[];

  // --- CRM & Project Photos (CRM Phase 1) ---
  readonly photos?: readonly ProjectPhoto[];
  readonly onUploadPhotos?: (
    files: File[],
    stage: ProjectPhotoStage,
    caption?: string,
  ) => Promise<void>;
  readonly onUpdatePhoto?: (
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ) => Promise<void>;
  readonly onDeletePhoto?: (photoId: string) => Promise<void>;
  readonly workshopName?: string;

  // --- CRM & Internal Comms (CRM Phase 2) ---
  readonly internalMessages?: readonly ProjectInternalMessage[];
  readonly onSendInternalMessage?: (msg: {
    messageType: ProjectInternalMessageType;
    content: string;
    senderName?: string;
  }) => Promise<void> | void;
  readonly onUpdateTechnicalWorkflow?: (updates: {
    assignedEngineerId?: string;
    technicalStatus?: ProjectTechnicalStatus;
    surveyCompletedAt?: string;
    installationScheduledDate?: string;
    comment?: string;
  }) => Promise<void> | void;
  readonly assignableOwners?: readonly { readonly id: string; readonly name: string; readonly role?: string }[];
  readonly currentUserId?: string;

  // --- CRM & Warranty Desk (CRM Phase 3) ---
  readonly warranties?: readonly WarrantyTicket[];
  readonly availableCutRows?: readonly import('@muebles/domain').ProductionCutRow[];
  readonly onCreateWarrantyTicket?: (
    ticket: Partial<WarrantyTicket> & {
      projectId: string;
      title: string;
      category: import('@muebles/domain').WarrantyTicketCategory;
      priority: import('@muebles/domain').WarrantyTicketPriority;
    },
  ) => Promise<void>;

  readonly onUpdateWarrantyTicket?: (
    ticketId: string,
    updates: Partial<WarrantyTicket>,
  ) => Promise<void>;
  readonly onDeleteWarrantyTicket?: (ticketId: string) => Promise<void>;
  readonly onUploadWarrantyPhoto?: (
    ticketId: string,
    file: File,
    kind?: WarrantyPhotoKind,
    caption?: string,
  ) => Promise<void>;
  readonly onExportWarrantyRefabricationOptimizer?: (
    ticket: WarrantyTicket,
  ) => void;
}




// ─── Inner component (consumes context) ─────────────────────────────

function resolveChromePrimary(args: {
  status: ProjectStatus;
  canMutate: boolean;
  canMarkProduced: boolean;
  hasChangeStatus: boolean;
  hasMarkProduced: boolean;
  hasExport: boolean;
  /** PROD-0.2: factory hub available — prefers open-production over plant chrome CTAs. */
  hasOpenInProduction: boolean;
}): ChromePrimary {
  const {
    status,
    canMutate,
    canMarkProduced,
    hasChangeStatus,
    hasMarkProduced,
    hasExport,
    hasOpenInProduction,
  } = args;
  // #257: mark-produced never primary on quote when factory hub exists.
  // Prefer open-production; produced only from Producción for plant roles.
  if (status === 'draft' && canMutate && hasChangeStatus) return 'send';
  if (status === 'quoted' && canMutate && hasChangeStatus) return 'accept';
  if (
    (status === 'accepted' || status === 'produced') &&
    hasOpenInProduction
  ) {
    return 'open-production';
  }
  // Legacy: only when Producción nav is not wired — and never for vendedor
  // (canMarkProduced already false for vendedor).
  if (
    status === 'accepted' &&
    canMarkProduced &&
    hasMarkProduced &&
    !hasOpenInProduction
  ) {
    return 'mark-produced';
  }
  if (
    (status === 'accepted' || status === 'produced') &&
    hasExport
  ) {
    return 'export';
  }
  return null;
}

const CONFIRM_SEND =
  '¿Enviar cotización al cliente?\n\nSe congelan precios y el diseño queda en solo lectura. Si el cliente pide cambios, podés reabrir a borrador antes de aceptar.';
const CONFIRM_ACCEPT =
  '¿Aceptar esta cotización?\n\nEl pedido pasa a fábrica. Después de aceptar no se puede volver a borrador: solo ver y producir.';
const CONFIRM_REOPEN =
  '¿Reabrir a borrador?\n\nSe descongelan los precios y vuelve a ser editable. Usalo si el cliente pidió cambios antes de aceptar.';
const CONFIRM_REOPEN_FORCE =
  '¿Reabrir a borrador una cotización ya aceptada/en producción?\n\nEsto es una excepción de admin/gerente. Se descongelan precios y el diseño vuelve a ser editable.';

function ProjectDetailViewInner(): ReactNode {
  const ctx = useProjectDetail();
  const {
    project,
    modules,
    optionGroups,
    catalogs,
    customers,
    ownerLabels,
    breakdown,
    exportMenu,
    exportBusy,
    productionExportDisabled,
    productionExportOk,
    onOpenInProduction,
    onExport,
    onBackToList,
    onOpenPresentation,
    onOpenSpatialStudio,
    onOpenSpatialStudioUnplaced,
    onEditMeta,
    onDuplicate,
    onSaveAsTemplate,
    onMarkProduced,
    onChangeStatus,
    onRequestReopen,
    onRequestDelete,
    onUpdateKitchenLayout,
    onApplyScenarioB,
    onDuplicateWithScenarioB,
    onExportScenarioPdf,
    onUpdateInstallationChecklist,
    canMutate,
    canDelete,
    canReopen,
    canForceReopenClosed,
    canMarkProduced,
  } = ctx;

  const chromeSale = breakdown?.salePrice ?? null;
  const [toolsPanel, setToolsPanel] = useState<QuoteToolsPanel>(null);

  const kitchenUnplacedCount = useMemo(() => {
    const fps = allFootprints(project, modules);
    const layout = project.kitchenLayout;
    if (!layout || layout.walls.length === 0) {
      return fps.length > 0 ? fps.length : 0;
    }
    const placed = new Set(
      layout.placements.map((p) => `${p.itemId}#${p.instanceIndex}`),
    );
    return fps.filter((f) => !placed.has(`${f.itemId}#${f.instanceIndex}`))
      .length;
  }, [project, modules]);

  const hasOpenInProduction = Boolean(onOpenInProduction);
  /** #257: design/meta/items only while draft. */
  const canEditContent = canMutate && project.status === 'draft';
  const primary = resolveChromePrimary({
    status: project.status,
    canMutate,
    canMarkProduced,
    hasChangeStatus: Boolean(onChangeStatus),
    hasMarkProduced: Boolean(onMarkProduced),
    hasExport: Boolean(onExport),
    hasOpenInProduction,
  });

  const exportTitle = !productionExportOk
    ? 'Export de producción solo en Aceptado o En producción'
    : 'Exportar cut-list Optimizer (.xlsx)';

  /**
   * PROD-0.2: Optimizer leaves quote chrome when factory workspace is wired.
   * Without `onOpenInProduction`, keep prior plant-ready chrome export.
   */
  const showExportInChrome =
    Boolean(onExport) && productionExportOk && !hasOpenInProduction;
  /**
   * #257: never mark produced from quote when Producción hub is available.
   * Vendedor never has canMarkProduced.
   */
  const showMarkProducedInChrome =
    primary === 'mark-produced' &&
    Boolean(onMarkProduced) &&
    canMarkProduced &&
    !hasOpenInProduction;

  const requestStatus = (next: ProjectStatus, message: string) => {
    if (!onChangeStatus) return;
    if (typeof window !== 'undefined' && !window.confirm(message)) return;
    onChangeStatus(project.id, next);
  };

  const moreSections = useMemo((): readonly DropdownMenuSection[] => {
    const sections: DropdownMenuSection[] = [];

    // Only navigation into the factory workspace — no factory file exports here.
    // Optimizer / herrajes / etiquetas / pack live exclusively in Producción.
    if (hasOpenInProduction && productionExportOk && onOpenInProduction) {
      sections.push({
        id: 'production-hub',
        label: 'Producción',
        items: [
          {
            id: 'open-production',
            label: 'Abrir en Producción',
            hint: 'Pack, corte, checklist de fábrica',
            onSelect: () => onOpenInProduction(project.id),
          },
        ],
      });
    }

    sections.push(...exportMenu.sections);

    const metaItems: DropdownMenuItem[] = [];
    // Presentar moved from chrome to Más to reduce button clutter.
    if (onOpenPresentation) {
      metaItems.push({
        id: 'present',
        label: 'Presentar al cliente',
        onSelect: onOpenPresentation,
      });
    }
    // Duplicate / template allowed for closed quotes (copy, not edit source).
    if (canMutate && onDuplicate) {
      metaItems.push({
        id: 'duplicate',
        label: 'Duplicar',
        icon: <Copy size={16} strokeWidth={1.5} aria-hidden />,
        onSelect: () => onDuplicate(project.id),
      });
    }
    if (canMutate && onSaveAsTemplate) {
      metaItems.push({
        id: 'save-template',
        label: 'Guardar como plantilla',
        icon: <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />,
        onSelect: () => onSaveAsTemplate(project.id),
      });
    }
    if (
      project.status === 'draft' &&
      canMutate &&
      onChangeStatus
    ) {
      metaItems.push({
        id: 'accept-direct',
        label: 'Aceptar cotización…',
        icon: <Check size={16} strokeWidth={1.5} aria-hidden />,
        onSelect: () => requestStatus('accepted', CONFIRM_ACCEPT),
      });
    }
    // #257: quoted → any canReopen (vendedor+); accepted/produced → admin/gerente only.
    const reopenQuoted = canReopen && project.status === 'quoted';
    const reopenClosed =
      canForceReopenClosed &&
      (project.status === 'accepted' || project.status === 'produced');
    if ((reopenQuoted || reopenClosed) && onRequestReopen) {
      metaItems.push({
        id: 'reopen',
        label: 'Reabrir a borrador…',
        icon: <RotateCcw size={16} strokeWidth={1.5} aria-hidden />,
        onSelect: () => {
          const msg = reopenClosed ? CONFIRM_REOPEN_FORCE : CONFIRM_REOPEN;
          if (typeof window !== 'undefined' && !window.confirm(msg)) {
            return;
          }
          onRequestReopen();
        },
      });
    }
    // Destructive action lives in Más (wave 4 chrome density) — not a permanent
    // danger button that steals visual weight from the stage primary.
    if (canDelete) {
      metaItems.push({
        id: 'delete',
        label: 'Eliminar',
        icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden />,
        onSelect: () => onRequestDelete(),
      });
    }
    if (metaItems.length > 0) {
      sections.push({ id: 'meta', label: 'Cotización', items: metaItems });
    }

    return sections;
  }, [
    canDelete,
    canMutate,
    canReopen,
    canForceReopenClosed,
    exportMenu.sections,
    hasOpenInProduction,
    onChangeStatus,
    onDuplicate,
    onOpenInProduction,
    onRequestDelete,
    onRequestReopen,
    onSaveAsTemplate,
    productionExportOk,
    project.id,
    project.status,
    onOpenPresentation,
  ]);

  const toggleTools = (panel: Exclude<QuoteToolsPanel, null>): void => {
    setToolsPanel((current) => (current === panel ? null : panel));
  };

  return (
    <>
      {/* Sticky tool chrome — at most ONE .btn--primary in the action group */}
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
              <h2 className="workspace-chrome__title">{project.name}</h2>
              <StatusBadge status={project.status} />
              {project.technicalStatus && project.technicalStatus !== 'pending_assignment' ? (
                <span
                  className={`internal-comms__status-badge internal-comms__status-badge--${TECHNICAL_STATUS_METADATA[project.technicalStatus].color}`}
                  style={{ marginLeft: '0.25rem', fontSize: '0.75rem' }}
                  title={TECHNICAL_STATUS_METADATA[project.technicalStatus].description}
                >
                  <HardHat size={12} />
                  {TECHNICAL_STATUS_METADATA[project.technicalStatus].shortLabel}
                </span>
              ) : null}
            </div>

            <p className="workspace-chrome__subtitle">
              {resolveCustomerName(project.customerId, customers)}
              {(() => {
                const cust = customers.find((c) => c.id === project.customerId);
                return cust?.phone ? (
                  <>
                    <span className="workspace-chrome__dot" aria-hidden>·</span>
                    <WhatsAppButton
                      customerName={cust.name}
                      phone={cust.phone}
                      projectName={project.name}
                      quoteAmount={chromeSale != null ? formatProjectMoney(chromeSale, project.currency) : undefined}
                      workshopName={ctx.workshopName}
                      compact
                      label="WhatsApp"
                    />
                  </>
                ) : null;
              })()}
              <span className="workspace-chrome__dot" aria-hidden>·</span>
              {project.items.length} mueble{project.items.length === 1 ? '' : 's'}
              <span className="workspace-chrome__dot" aria-hidden>·</span>
              {project.currency}
              {ctx.showCosts ? (
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
            {chromeSale == null ? '—' : formatProjectMoney(chromeSale, project.currency)}
          </span>
        </div>
        <div
          className="workspace-chrome__actions project-detail__chrome-actions"
          data-testid="project-chrome-actions"
        >
          {primary === 'send' && onChangeStatus ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => requestStatus('quoted', CONFIRM_SEND)}
              data-testid="project-send-quote"
              title="Envía al cliente y congela precios (confirmación)"
            >
              <Send size={16} strokeWidth={1.5} aria-hidden /> Enviar al cliente
            </button>
          ) : null}
          {primary === 'accept' && onChangeStatus ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => requestStatus('accepted', CONFIRM_ACCEPT)}
              data-testid="project-accept-quote"
              title="Acepta y congela diseño y precios (confirmación)"
            >
              <Check size={16} strokeWidth={1.5} aria-hidden /> Aceptar cotización
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
              onClose={exportMenu.onClose}
            />
          ) : null}
        </div>
      </header>

      {project.ownerUserId ? (
        <p className="project-detail__notes" data-testid="project-owner-label">
          Responsable: {ownerLabels[project.ownerUserId] || project.ownerUserId}
        </p>
      ) : null}
      {project.notes ? (
        <p className="project-detail__notes">{project.notes}</p>
      ) : null}

      <div className="project-detail__body">
        <div className="project-detail__main">
          {/* Core quote path first: options → measures → items */}
          <ProjectOptionsSection />
          <ProjectMeasureDefaults />
          <ProjectItemsSection />

          {/* Advanced tools — toggle group (not ARIA tabs: zero-selected is valid) */}
          <section
            className="project-detail__tools"
            data-testid="project-quote-tools"
            aria-label="Herramientas de cotización"
          >
            <div className="project-detail__tools-header">
              <h3 className="project-detail__section-title">Herramientas</h3>
              <div
                className="project-detail__tools-tabs"
                role="group"
                aria-label="Paneles avanzados"
              >
                <button
                  type="button"
                  aria-pressed={toolsPanel === 'kitchen'}
                  className={
                    toolsPanel === 'kitchen'
                      ? 'project-detail__tools-tab project-detail__tools-tab--active'
                      : 'project-detail__tools-tab'
                  }
                  data-testid="project-tools-kitchen"
                  onClick={() => toggleTools('kitchen')}
                >
                  Plano / ambiente
                  {kitchenUnplacedCount > 0 ? (
                    <span
                      className="project-detail__tools-badge"
                      data-testid="project-tools-kitchen-unplaced"
                      title={`${kitchenUnplacedCount} sin colocar en el plano`}
                    >
                      {kitchenUnplacedCount}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-pressed={toolsPanel === 'scenarios'}
                  className={
                    toolsPanel === 'scenarios'
                      ? 'project-detail__tools-tab project-detail__tools-tab--active'
                      : 'project-detail__tools-tab'
                  }
                  data-testid="project-tools-scenarios"
                  onClick={() => toggleTools('scenarios')}
                >
                  Escenarios A/B
                </button>
                <button
                  type="button"
                  aria-pressed={toolsPanel === 'checklist'}

                  className={
                    toolsPanel === 'checklist'
                      ? 'project-detail__tools-tab project-detail__tools-tab--active'
                      : 'project-detail__tools-tab'
                  }
                  data-testid="project-tools-checklist"
                  onClick={() => toggleTools('checklist')}
                >
                  Checklist instalación
                </button>
                <button
                  type="button"
                  aria-pressed={toolsPanel === 'photos'}

                  className={
                    toolsPanel === 'photos'
                      ? 'project-detail__tools-tab project-detail__tools-tab--active'
                      : 'project-detail__tools-tab'
                  }
                  data-testid="project-tools-photos"
                  onClick={() => toggleTools('photos')}
                >
                  <Camera size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
                  Fotos / Galería
                  {ctx.photos && ctx.photos.length > 0 ? (
                    <span
                      className="project-detail__tools-badge"
                      title={`${ctx.photos.length} fotos`}
                    >
                      {ctx.photos.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-pressed={toolsPanel === 'internal_comms'}
                  className={
                    toolsPanel === 'internal_comms'
                      ? 'project-detail__tools-tab project-detail__tools-tab--active'
                      : 'project-detail__tools-tab'
                  }
                  data-testid="project-tools-internal-comms"
                  onClick={() => toggleTools('internal_comms')}
                >
                  <MessageSquare size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
                  Handoff & Chat
                  {ctx.internalMessages && ctx.internalMessages.length > 0 ? (
                    <span
                      className="project-detail__tools-badge"
                      title={`${ctx.internalMessages.length} mensajes`}
                    >
                      {ctx.internalMessages.length}
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  aria-pressed={toolsPanel === 'warranties'}
                  className={
                    toolsPanel === 'warranties'
                      ? 'project-detail__tools-tab project-detail__tools-tab--active'
                      : 'project-detail__tools-tab'
                  }
                  data-testid="project-tools-warranties"
                  onClick={() => toggleTools('warranties')}
                >
                  <Wrench size={14} aria-hidden="true" style={{ marginRight: '0.25rem', verticalAlign: 'text-bottom' }} />
                  Garantías & Re-corte
                  {ctx.warranties && ctx.warranties.length > 0 ? (
                    <span
                      className="project-detail__tools-badge"
                      title={`${ctx.warranties.length} tickets de garantía`}
                    >
                      {ctx.warranties.length}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>


            {toolsPanel === null ? (
              <p className="project-detail__tools-hint">
                Abrí un panel solo si lo necesitás. La cotización del día son los
                muebles y el precio a la derecha.
              </p>
            ) : null}

            {toolsPanel === 'kitchen' ? (
              <div
                className="project-detail__tools-panel"
                data-testid="project-tools-panel-kitchen"
              >
                <p className="project-detail__tools-hint">
                  El diseño del ambiente vive en Proyectar (3D + planta).
                </p>
                {onOpenSpatialStudio || onOpenSpatialStudioUnplaced ? (
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    data-testid="project-tools-open-projectar"
                    onClick={() => {
                      if (
                        kitchenUnplacedCount > 0 &&
                        onOpenSpatialStudioUnplaced
                      ) {
                        onOpenSpatialStudioUnplaced();
                        return;
                      }
                      onOpenSpatialStudio?.();
                    }}
                  >
                    Abrir Proyectar
                  </button>
                ) : null}
                <details
                  className="project-detail__kitchen-advanced"
                  data-testid="project-tools-kitchen-advanced"
                >
                  <summary>Edición 2D rápida (avanzado)</summary>
                  <KitchenPlanPanel
                    project={project}
                    modules={modules}
                    canEdit={Boolean(canEditContent && onUpdateKitchenLayout)}
                    onChange={(layout) => {
                      onUpdateKitchenLayout?.(project.id, layout);
                    }}
                  />
                </details>
              </div>
            ) : null}

            {toolsPanel === 'scenarios' ? (
              <div
                className="project-detail__tools-panel"
                data-testid="project-tools-panel-scenarios"
              >
                <QuoteScenarioCompare
                  project={project}
                  catalog={{
                    materials: catalogs.materials,
                    edges: catalogs.edges,
                    hardware: catalogs.hardware,
                    optionGroups,
                    modules,
                  }}
                  optionGroups={optionGroups}
                  canApply={Boolean(
                    canEditContent && onApplyScenarioB,
                  )}
                  canDuplicate={Boolean(canMutate && onDuplicateWithScenarioB)}
                  currency={project.currency}
                  onApplyB={(role, choiceId) => {
                    onApplyScenarioB?.(project.id, role, choiceId);
                  }}
                  onDuplicateWithB={(role, choiceId) => {
                    onDuplicateWithScenarioB?.(project.id, role, choiceId);
                  }}
                  onExportScenarioPdf={(role, choiceId) => {
                    onExportScenarioPdf?.(project.id, role, choiceId);
                  }}
                />
              </div>
            ) : null}

            {toolsPanel === 'checklist' ? (
              <div
                className="project-detail__tools-panel"
                data-testid="project-tools-panel-checklist"
              >
                <InstallationChecklistPanel
                  project={project}
                  canEdit={Boolean(
                    canEditContent && onUpdateInstallationChecklist,
                  )}
                  onChange={(items) => {
                    onUpdateInstallationChecklist?.(project.id, items);
                  }}
                />
              </div>
            ) : null}

            {toolsPanel === 'photos' ? (
              <div
                className="project-detail__tools-panel"
                data-testid="project-tools-panel-photos"
              >
                <ProjectPhotosGallery
                  projectId={project.id}
                  photos={ctx.photos ?? []}
                  onUploadPhotos={ctx.onUploadPhotos ?? (async () => {})}
                  onUpdatePhoto={ctx.onUpdatePhoto ?? (async () => {})}
                  onDeletePhoto={ctx.onDeletePhoto ?? (async () => {})}
                  readOnly={!canMutate}
                />
              </div>
            ) : null}

            {toolsPanel === 'internal_comms' ? (
              <div
                className="project-detail__tools-panel"
                data-testid="project-tools-panel-internal-comms"
              >
                <InternalCommsPanel
                  project={project}
                  messages={ctx.internalMessages ?? []}
                  assignableOwners={ctx.assignableOwners?.map((o) => ({ id: o.id, label: o.name })) ?? []}
                  currentUserId={ctx.currentUserId}
                  onSendMessage={ctx.onSendInternalMessage ?? (() => {})}
                  onUpdateTechnicalWorkflow={ctx.onUpdateTechnicalWorkflow ?? (() => {})}
                />
              </div>
            ) : null}

            {toolsPanel === 'warranties' ? (
              <div
                className="project-detail__tools-panel"
                data-testid="project-tools-panel-warranties"
              >
                <WarrantyTicketsPanel
                  projectId={project.id}
                  projectName={project.name}
                  customerId={project.customerId}
                  tickets={ctx.warranties ?? []}
                  availableCutRows={ctx.availableCutRows ?? []}
                  technicians={ctx.assignableOwners?.map((o) => ({ id: o.id, name: o.name })) ?? []}
                  onCreateTicket={ctx.onCreateWarrantyTicket ?? (async () => {})}
                  onUpdateTicket={ctx.onUpdateWarrantyTicket ?? (async () => {})}
                  onDeleteTicket={ctx.onDeleteWarrantyTicket}
                  onUploadPhoto={ctx.onUploadWarrantyPhoto}
                  onExportRefabricationOptimizer={ctx.onExportWarrantyRefabricationOptimizer}
                />
              </div>
            ) : null}
          </section>


        </div>

        <ProjectTotalsAside />
      </div>
    </>
  );
}

// ─── Public entry point (wraps inner with provider) ──────────────────

export function ProjectDetailView(props: ProjectDetailViewProps): ReactNode {
  const contextValue = {
    project: props.project,
    projectEstimates: props.projectEstimates,
    modules: props.modules,
    optionGroups: props.optionGroups,
    catalogs: props.catalogs,
    catalogComponents: props.catalogComponents ?? [],
    catalogStructures: props.catalogStructures ?? [],
    customers: props.customers,
    ownerLabels: props.ownerLabels,
    breakdown: props.breakdown ?? null,
    materialSummary: props.materialSummary ?? null,
    breakdownLoading: props.breakdownLoading ?? false,
    breakdownError: props.breakdownError ?? null,
    previewBlocked: props.previewBlocked ?? false,
    missingGroups: props.missingGroups ?? [],
    groupLabels: props.groupLabels ?? {},
    showCosts: props.showCosts,
    exportMenu: props.exportMenu,
    exportBlockMessage: props.exportBlockMessage,
    exportErrors: props.exportErrors,
    exportBusy: props.exportBusy,
    exportBlocked: props.exportBlocked,
    productionExportDisabled: props.productionExportDisabled,
    productionExportOk: props.productionExportOk,
    onExport: props.onExport,
    onExportProductionPack: props.onExportProductionPack,
    onOpenInProduction: props.onOpenInProduction,
    itemHandlers: props.itemHandlers,
    removeConfirm: props.removeConfirm,
    updateProjectLevelChoice: props.updateProjectLevelChoice,
    onUpdateMeasureDefaults: props.onUpdateMeasureDefaults,
    viewer3D: props.viewer3D,
    itemError: props.itemError,
    addItemModalOpen: props.addItemModalOpen,
    onOpenAddItemModal: props.onOpenAddItemModal,
    onBackToList: props.onBackToList,
    onOpenPresentation: props.onOpenPresentation,
    onOpenSpatialStudio: props.onOpenSpatialStudio,
    postAddPlaceCue: props.postAddPlaceCue ?? false,
    onDismissPostAddPlaceCue: props.onDismissPostAddPlaceCue,
    onOpenSpatialStudioUnplaced: props.onOpenSpatialStudioUnplaced,
    onEditMeta: props.onEditMeta,
    onDuplicate: props.onDuplicate,
    onSaveAsTemplate: props.onSaveAsTemplate,
    onMarkProduced: props.onMarkProduced,
    onChangeStatus: props.onChangeStatus,
    onRequestReopen: props.onRequestReopen,
    onRequestDelete: props.onRequestDelete,
    onUpdateKitchenLayout: props.onUpdateKitchenLayout,
    onApplyScenarioB: props.onApplyScenarioB,
    onDuplicateWithScenarioB: props.onDuplicateWithScenarioB,
    onExportScenarioPdf: props.onExportScenarioPdf,
    onUpdateInstallationChecklist: props.onUpdateInstallationChecklist,
    onImportNesting: props.onImportNesting,
    onUpdateProjectLevelChoices: props.onUpdateProjectLevelChoices,
    canMutate: props.canMutate,
    canEditContent:
      props.canMutate && props.project.status === 'draft',
    canDelete: props.canDelete,
    canReopen: props.canReopen,
    canForceReopenClosed: Boolean(props.canForceReopenClosed),
    canMarkProduced: props.canMarkProduced,
    onRestoreVersion: props.onRestoreVersion,
    projectTemplates: props.projectTemplates,
    photos: props.photos,
    onUploadPhotos: props.onUploadPhotos,
    onUpdatePhoto: props.onUpdatePhoto,
    onDeletePhoto: props.onDeletePhoto,
    workshopName: props.workshopName,
    internalMessages: props.internalMessages,
    onSendInternalMessage: props.onSendInternalMessage,
    onUpdateTechnicalWorkflow: props.onUpdateTechnicalWorkflow,
    assignableOwners: props.assignableOwners,
    currentUserId: props.currentUserId,
    warranties: props.warranties,
    availableCutRows: props.availableCutRows,
    onCreateWarrantyTicket: props.onCreateWarrantyTicket,
    onUpdateWarrantyTicket: props.onUpdateWarrantyTicket,
    onDeleteWarrantyTicket: props.onDeleteWarrantyTicket,
    onUploadWarrantyPhoto: props.onUploadWarrantyPhoto,
    onExportWarrantyRefabricationOptimizer: props.onExportWarrantyRefabricationOptimizer,
  };


  return (
    <div className="project-detail" data-testid="project-detail">
      <ProjectDetailProvider value={contextValue}>
        <ProjectDetailViewInner />
      </ProjectDetailProvider>
    </div>
  );
}

