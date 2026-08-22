/**
 * Project detail view (F058b) — extracted from ProjectsScreen.renderDetail.
 *
 * Renders the sticky workspace chrome (status + total + action buttons) and
 * the 2-column body (main with options/measure defaults/panels/items + aside
 * with totals + material summary).
 *
 * #193 — Props are forwarded into a React Context so child components
 * (items, panels, totals) can pull what they need without prop threading.
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
  WarrantyTicket,
} from '@muebles/domain';

import {
  Check,
  Copy,
  LayoutTemplate,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  ConfirmDialog,
  type DropdownMenuItem,
  type DropdownMenuSection,
} from '../../common';
import { ProjectFloorProgressStrip } from '../../production/ProjectFloorProgressStrip';
import { ProjectStalenessBanner } from './ProjectStalenessBanner';
import { CostingPanel } from './CostingPanel';
import type { CostingPanelView } from '../costingView';
import type { CostingHandlers } from './CostingPanel';
import { ProductionReleaseModal } from './ProductionReleaseModal';
import { ChangeOrderModal } from './ChangeOrderModal';
import { ProjectItemsSection } from './ProjectItemsSection';
import { ProjectOptionsSection } from './ProjectOptionsSection';
import { ProjectMeasureDefaults } from './ProjectMeasureDefaults';
import { ProjectTotalsAside } from './ProjectTotalsAside';
import { allFootprints } from '../kitchenPlanHelpers';
import {
  ProjectDetailHeader,
  type ChromePrimary,
} from './detail/ProjectDetailHeader';
import {
  ProjectDetailToolsNav,
  type QuoteToolsPanel,
} from './detail/ProjectDetailToolsNav';
import { ProjectDetailToolsContent } from './detail/ProjectDetailToolsContent';
import {
  ProjectDetailProvider,
  useProjectDetail,
  type ProjectDetailCatalogs,
  type ProjectDetailItemHandlers,
  type ProjectDetailRemoveConfirm,
  type ProjectDetail3DHandlers,
  type ProjectDetailContextValue,
} from './projectDetailContext';

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

  // --- Job costing (OC-080..OC-084, #304): estimate vs actual panel ---
  readonly costingView?: CostingPanelView | null;
  readonly costingHandlers?: CostingHandlers;
  readonly canManageCosting?: boolean;
  readonly canCaptureCosting?: boolean;
  readonly canRecordOtherCosting?: boolean;
  readonly canVoidCosting?: boolean;
  readonly costingLabelsByMaterial?: Readonly<Record<string, string>>;
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

  // --- Project Lifecycle & Operational Core (OC-010..OC-024) ---
  readonly onReleaseToProduction?: (
    projectId: string,
    note?: string,
    options?: import('@muebles/domain').ProductionReleaseOptions,
  ) => void | Promise<void>;
  readonly onRevokeProductionRelease?: (
    projectId: string,
    reason: string,
  ) => void | Promise<void>;
  readonly onCreateChangeOrder?: (
    projectId: string,
    params: {
      reason: string;
      description?: string;
      impact?: import('@muebles/domain').ChangeOrderImpact;
    },
  ) => void | Promise<void>;
  readonly onSubmitChangeOrder?: (
    projectId: string,
    changeOrderId: string,
  ) => void | Promise<void>;
  readonly onApproveChangeOrder?: (
    projectId: string,
    changeOrderId: string,
    decisionNotes?: string,
  ) => void | Promise<void>;
  readonly onRejectChangeOrder?: (
    projectId: string,
    changeOrderId: string,
    reason: string,
  ) => void | Promise<void>;
  readonly onCreateDesignRevision?: (
    projectId: string,
    name?: string,
    description?: string,
  ) => void | Promise<void>;
  readonly onDecideApproval?: (
    projectId: string,
    approvalId: string,
    decision: 'approved' | 'rejected',
    notes?: string,
  ) => void | Promise<void>;
  readonly onRequestApproval?: (
    projectId: string,
    type: import('@muebles/domain').ApprovalType,
    notes?: string,
  ) => void | Promise<void>;
  readonly onChangeCommercialStatus?: (
    projectId: string,
    status: import('@muebles/domain').CommercialStatus,
  ) => void | Promise<void>;
  readonly onRecordDeposit?: (
    projectId: string,
    params: import('@muebles/domain').DepositReceivedPayload & { note?: string },
  ) => void | Promise<void>;
}

// ─── Inner component (consumes context) ─────────────────────────────

function resolveChromePrimary(args: {
  status: ProjectStatus;
  canMutate: boolean;
  canMarkProduced: boolean;
  hasChangeStatus: boolean;
  hasMarkProduced: boolean;
  hasExport: boolean;
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
  if (status === 'draft' && canMutate && hasChangeStatus) return 'send';
  if (status === 'quoted' && canMutate && hasChangeStatus) return 'accept';
  if (
    (status === 'accepted' || status === 'produced') &&
    hasOpenInProduction
  ) {
    return 'open-production';
  }
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
    ownerLabels,
    breakdown,
    exportMenu,
    productionExportOk,
    onOpenInProduction,
    onOpenPresentation,
    onDuplicate,
    onSaveAsTemplate,
    onMarkProduced,
    onChangeStatus,
    onRequestReopen,
    onRequestDelete,
    canMutate,
    canDelete,
    canReopen,
    canForceReopenClosed,
    canMarkProduced,
  } = ctx;

  const chromeSale = breakdown?.salePrice ?? null;
  const [toolsPanel, setToolsPanel] = useState<QuoteToolsPanel>(null);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [changeOrderModalOpen, setChangeOrderModalOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

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
  const canEditContent = canMutate && project.status === 'draft';
  const primary = resolveChromePrimary({
    status: project.status,
    canMutate,
    canMarkProduced,
    hasChangeStatus: Boolean(onChangeStatus),
    hasMarkProduced: Boolean(onMarkProduced),
    hasExport: Boolean(ctx.onExport),
    hasOpenInProduction,
  });

  const requestStatus = (next: ProjectStatus, message: string) => {
    if (!onChangeStatus) return;
    setPendingConfirm({
      title: next === 'quoted' ? 'Enviar cotización' : 'Aceptar cotización',
      message,
      confirmLabel: next === 'quoted' ? 'Enviar' : 'Aceptar',
      onConfirm: () => onChangeStatus(project.id, next),
    });
  };

  const moreSections = useMemo((): readonly DropdownMenuSection[] => {
    const sections: DropdownMenuSection[] = [];

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
    if (onOpenPresentation) {
      metaItems.push({
        id: 'present',
        label: 'Presentar al cliente',
        onSelect: onOpenPresentation,
      });
    }
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
          setPendingConfirm({
            title: 'Reabrir a borrador',
            message: msg,
            confirmLabel: 'Reabrir',
            onConfirm: () => onRequestReopen(),
          });
        },
      });
    }
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
    <div className="project-detail" data-testid="project-detail">
      <ProjectDetailHeader
        primary={primary}
        chromeSale={chromeSale}
        moreSections={moreSections}
        exportMenuClose={exportMenu.onClose}
        onRequestStatus={requestStatus}
        confirmSendText={CONFIRM_SEND}
        confirmAcceptText={CONFIRM_ACCEPT}
      />

      {project.status === 'accepted' || project.status === 'produced' ? (
        <ProjectFloorProgressStrip project={project} />
      ) : null}

      {project.ownerUserId ? (
        <p className="project-detail__notes" data-testid="project-owner-label">
          Responsable: {ownerLabels[project.ownerUserId] || project.ownerUserId}
        </p>
      ) : null}
      {project.notes ? (
        <p className="project-detail__notes">{project.notes}</p>
      ) : null}

      <ProjectStalenessBanner
        project={project}
        onOpenReleaseModal={() => setReleaseModalOpen(true)}
        onOpenChangeOrderModal={() => setChangeOrderModalOpen(true)}
      />

      <div className="project-detail__body">
        <div className="project-detail__main">
          <ProjectOptionsSection />
          <ProjectMeasureDefaults />
          <ProjectItemsSection />

          <section
            className="project-detail__tools"
            data-testid="project-quote-tools"
            aria-label="Herramientas de cotización"
          >
            <ProjectDetailToolsNav
              toolsPanel={toolsPanel}
              onToggleTools={toggleTools}
              kitchenUnplacedCount={kitchenUnplacedCount}
            />

            <ProjectDetailToolsContent
              toolsPanel={toolsPanel}
              canEditContent={canEditContent}
            />
          </section>

          {ctx.costingView && ctx.showCosts ? (
            <CostingPanel
              view={ctx.costingView}
              handlers={ctx.costingHandlers ?? {}}
              labelsByMaterial={ctx.costingLabelsByMaterial}
              canManage={ctx.canManageCosting ?? false}
              canCapture={ctx.canCaptureCosting ?? false}
              canRecordOther={ctx.canRecordOtherCosting ?? false}
              canVoid={ctx.canVoidCosting ?? false}
            />
          ) : null}
        </div>

        <ProjectTotalsAside />
      </div>

      <ProductionReleaseModal
        project={project}
        isOpen={releaseModalOpen}
        onClose={() => setReleaseModalOpen(false)}
        onRelease={async (note, options) => {
          if (ctx.onReleaseToProduction) {
            await ctx.onReleaseToProduction(project.id, note, options);
          }
        }}
        onRevoke={async (reason) => {
          if (ctx.onRevokeProductionRelease) {
            await ctx.onRevokeProductionRelease(project.id, reason);
          }
        }}
      />

      <ChangeOrderModal
        project={project}
        isOpen={changeOrderModalOpen}
        onClose={() => setChangeOrderModalOpen(false)}
        onCreateChangeOrder={async (params) => {
          if (ctx.onCreateChangeOrder) {
            await ctx.onCreateChangeOrder(project.id, params);
          }
        }}
        onSubmitChangeOrder={async (coId) => {
          if (ctx.onSubmitChangeOrder) {
            await ctx.onSubmitChangeOrder(project.id, coId);
          }
        }}
        onApproveChangeOrder={async (coId, notes) => {
          if (ctx.onApproveChangeOrder) {
            await ctx.onApproveChangeOrder(project.id, coId, notes);
          }
        }}
        onRejectChangeOrder={async (coId, reason) => {
          if (ctx.onRejectChangeOrder) {
            await ctx.onRejectChangeOrder(project.id, coId, reason);
          }
        }}
      />

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        confirmLabel={pendingConfirm?.confirmLabel ?? 'Confirmar'}
        tone="primary"
        onConfirm={() => {
          pendingConfirm?.onConfirm();
          setPendingConfirm(null);
        }}
        onClose={() => setPendingConfirm(null)}
      />
    </div>
  );
}

// ─── Outer wrapper (provides context) ───────────────────────────────

export function ProjectDetailView(props: ProjectDetailViewProps): ReactNode {
  const {
    project,
    projectEstimates,
    modules,
    optionGroups,
    catalogs,
    catalogComponents = [],
    catalogStructures = [],
    customers,
    ownerLabels,
    breakdown = null,
    materialSummary = null,
    breakdownLoading = false,
    breakdownError = null,
    previewBlocked = false,
    missingGroups = [],
    groupLabels = {},
    showCosts,
    exportMenu,
    exportBlockMessage,
    exportErrors,
    exportBusy,
    exportBlocked,
    productionExportDisabled,
    productionExportOk,
    onExport,
    onExportProductionPack,
    onOpenInProduction,
    itemHandlers,
    removeConfirm,
    updateProjectLevelChoice,
    onUpdateMeasureDefaults,
    viewer3D,
    itemError,
    addItemModalOpen,
    onOpenAddItemModal,
    onBackToList,
    onOpenPresentation,
    onOpenSpatialStudio,
    postAddPlaceCue = false,
    onDismissPostAddPlaceCue,
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
    onImportNesting,
    costingView = null,
    costingHandlers,
    canManageCosting = false,
    canCaptureCosting = false,
    canRecordOtherCosting = false,
    canVoidCosting = false,
    costingLabelsByMaterial = {},
    onUpdateProjectLevelChoices,
    onRestoreVersion,
    canMutate,
    canDelete,
    canReopen,
    canForceReopenClosed = false,
    canMarkProduced,
    projectTemplates,
    photos,
    onUploadPhotos,
    onUpdatePhoto,
    onDeletePhoto,
    workshopName,
    internalMessages,
    onSendInternalMessage,
    onUpdateTechnicalWorkflow,
    assignableOwners,
    currentUserId,
    warranties,
    availableCutRows,
    onCreateWarrantyTicket,
    onUpdateWarrantyTicket,
    onDeleteWarrantyTicket,
    onUploadWarrantyPhoto,
    onExportWarrantyRefabricationOptimizer,
    onReleaseToProduction,
    onRevokeProductionRelease,
    onCreateChangeOrder,
    onSubmitChangeOrder,
    onApproveChangeOrder,
    onRejectChangeOrder,
    onCreateDesignRevision,
    onDecideApproval,
    onRequestApproval,
    onChangeCommercialStatus,
    onRecordDeposit,
  } = props;

  const canEditContent = canMutate && project.status === 'draft';

  const contextValue = useMemo(
    (): ProjectDetailContextValue => ({
      project,
      projectEstimates,
      modules,
      optionGroups,
      catalogs,
      catalogComponents,
      catalogStructures,
      customers,
      ownerLabels,
      breakdown,
      materialSummary,
      breakdownLoading,
      breakdownError,
      previewBlocked,
      missingGroups,
      groupLabels,
      showCosts,
    costingView,
    costingHandlers,
    canManageCosting,
    canCaptureCosting,
    canRecordOtherCosting,
    canVoidCosting,
    costingLabelsByMaterial,
      exportMenu,
      exportBlockMessage,
      exportErrors,
      exportBusy,
      exportBlocked,
      productionExportDisabled,
      productionExportOk,
      onExport,
      onExportProductionPack,
      onOpenInProduction,
      itemHandlers,
      removeConfirm,
      updateProjectLevelChoice,
      onUpdateMeasureDefaults,
      viewer3D,
      itemError,
      addItemModalOpen,
      onOpenAddItemModal,
      onBackToList,
      onOpenPresentation,
      onOpenSpatialStudio,
      postAddPlaceCue,
      onDismissPostAddPlaceCue,
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
      onImportNesting,
      onUpdateProjectLevelChoices,
      onRestoreVersion,
      canMutate,
      canEditContent,
      canDelete,
      canReopen,
      canForceReopenClosed,
      canMarkProduced,
      projectTemplates,
      photos,
      onUploadPhotos,
      onUpdatePhoto,
      onDeletePhoto,
      workshopName,
      internalMessages,
      onSendInternalMessage,
      onUpdateTechnicalWorkflow,
      assignableOwners,
      currentUserId,
      warranties,
      availableCutRows,
      onCreateWarrantyTicket,
      onUpdateWarrantyTicket,
      onDeleteWarrantyTicket,
      onUploadWarrantyPhoto,
      onExportWarrantyRefabricationOptimizer,
      onCreateRevision: onCreateDesignRevision
        ? (name, desc) => onCreateDesignRevision(project.id, name, desc)
        : undefined,
      onDecideApproval: onDecideApproval
        ? (appId, dec, notes) => onDecideApproval(project.id, appId, dec, notes)
        : undefined,
      onRequestApproval: onRequestApproval
        ? (type, notes) => onRequestApproval(project.id, type, notes)
        : undefined,
      onChangeCommercialStatus: onChangeCommercialStatus
        ? (status) => onChangeCommercialStatus(project.id, status)
        : undefined,
      onRecordDeposit: onRecordDeposit
        ? (params) => onRecordDeposit(project.id, params)
        : undefined,
    }),
    [
      project,
      projectEstimates,
      modules,
      optionGroups,
      catalogs,
      catalogComponents,
      catalogStructures,
      customers,
      ownerLabels,
      breakdown,
      materialSummary,
      breakdownLoading,
      breakdownError,
      previewBlocked,
      missingGroups,
      groupLabels,
      showCosts,
      exportMenu,
      exportBlockMessage,
      exportErrors,
      exportBusy,
      exportBlocked,
      productionExportDisabled,
      productionExportOk,
      onExport,
      onExportProductionPack,
      onOpenInProduction,
      itemHandlers,
      removeConfirm,
      updateProjectLevelChoice,
      onUpdateMeasureDefaults,
      viewer3D,
      itemError,
      addItemModalOpen,
      onOpenAddItemModal,
      onBackToList,
      onOpenPresentation,
      onOpenSpatialStudio,
      postAddPlaceCue,
      onDismissPostAddPlaceCue,
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
      onImportNesting,
      onUpdateProjectLevelChoices,
      onRestoreVersion,
      canMutate,
      canEditContent,
      canDelete,
      canReopen,
      canForceReopenClosed,
      canMarkProduced,
      projectTemplates,
      photos,
      onUploadPhotos,
      onUpdatePhoto,
      onDeletePhoto,
      workshopName,
      internalMessages,
      onSendInternalMessage,
      onUpdateTechnicalWorkflow,
      assignableOwners,
      currentUserId,
      warranties,
      availableCutRows,
      onCreateWarrantyTicket,
      onUpdateWarrantyTicket,
      onDeleteWarrantyTicket,
      onUploadWarrantyPhoto,
      onExportWarrantyRefabricationOptimizer,
      onCreateDesignRevision,
      onDecideApproval,
      onRequestApproval,
      onChangeCommercialStatus,
      onRecordDeposit,
    ],
  );

  return (
    <ProjectDetailProvider value={contextValue}>
      <ProjectDetailViewInner />
    </ProjectDetailProvider>
  );
}
