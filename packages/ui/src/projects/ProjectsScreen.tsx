/**
 * Projects list + quotation detail — cards + Modal MD (F022).
 * Cost formulas live in the shell; this component only renders breakdown props.
 */

import {
  useMemo,
  type ReactNode,
} from 'react';
import type {
  AmbientCategory,
  AmbientMaterial,
  Component,
  Customer,
  EdgeBand,
  MaterialCategory,
  ExportIssue,
  FurnitureType,
  Hardware,
  MaterialBoard,
  Module,
  ModuleBaseMode,
  ModuleCategory,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
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
  WorkshopSettings,
  Agregado,
  ProductionCutRow,
  WarrantyPhotoKind,
  WarrantyTicket,
  WarrantyTicketCategory,
  WarrantyTicketPriority,
  ProductionReleaseOptions,
  ChangeOrderImpact,
  ApprovalType,
  CommercialStatus,
} from '@muebles/domain';

import {
  type DropdownMenuSection,
  PageLoading,
} from '../common';
import '../catalogs/catalogs.css';
import { ExportIssueList } from './ExportIssueList';
import { ProjectDetailView } from './components/ProjectDetailView';
import type { CostingHandlers } from './components/CostingPanel';
import type { CostingPanelView } from './costingView';
import type { SurveyHandlers } from './components/SiteSurveyPanel';
import type { ProjectOverviewNav } from './components/ProjectOverviewPanel';
import { ProjectsListView } from './components/ProjectsListView';
import { ProjectModalsContainer } from './components/ProjectModalsContainer';
import {
  formatProjectMoney,
  type AddItemDraft,
  type ProjectDraft,
} from './projectHelpers';
import { useProjectsScreenState } from './helpers/useProjectsScreenState';
import './projects.css';

export type { ProjectDraft, AddItemDraft };
export { ExportIssueList, type ExportIssueListProps } from './ExportIssueList';

export interface ProjectsScreenProps {
  /** When true, show section loading (workspace/async gate). */
  readonly loading?: boolean;
  readonly projects: readonly Project[];
  readonly modules: readonly Module[];
  /** Module categories for PRJ-11 cascade filter in add-item modal. */
  readonly categories?: readonly ModuleCategory[];
  readonly optionGroups: readonly OptionGroup[];
  /** Component + structure catalogs to resolve option roles from composed modules. */
  readonly catalogComponents?: readonly Component[];
  readonly catalogStructures?: readonly Structure[];
  /** Agregados catalog for 3D preview (so module.agregados render in project 3D). */
  readonly catalogAgregados?: readonly Agregado[];
  readonly materials: readonly MaterialBoard[];
  /** F142: subgrupos de tableros para el dock de Proyectar. */
  readonly materialCategories?: readonly MaterialCategory[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  /** Ambient materials for 3D room scenes (floor/wall textures). */
  readonly ambientMaterials?: readonly AmbientMaterial[];
  /** Hierarchical ambient categories for 3D finishes palette. */
  readonly ambientCategories?: readonly AmbientCategory[];
  /** Catalog customers for name lookup on cards / detail / search. */
  readonly customers?: readonly Customer[];
  /** F034: admin can pick portfolio owner on create/edit. */
  readonly canAssignOwner?: boolean;
  readonly assignableOwners?: readonly {
    readonly id: string;
    readonly name: string;
    readonly role?: string;
  }[];
  readonly ownerLabels?: Readonly<Record<string, string>>;
  readonly onCreate: (draft: ProjectDraft) => void;
  readonly onUpdate: (id: string, draft: ProjectDraft) => void;
  readonly onDelete: (id: string) => void;
  /** Deep-copy project as draft (F015). Shell owns ids/timestamps. */
  readonly onDuplicate?: (id: string) => void;
  // --- Project templates (#110 / H15) ---
  /** Reusable project templates available to start a quote from. */
  readonly projectTemplates?: readonly ProjectTemplate[];
  /** Save a project as a new reusable template. */
  readonly onSaveAsTemplate?: (projectId: string, name: string) => void;
  /** Clone a template into a new editable draft quote. */
  readonly onCreateFromTemplate?: (
    templateId: string,
    draft: ProjectDraft,
  ) => void;
  /** Delete a reusable template. */
  readonly onDeleteTemplate?: (templateId: string) => void;
  readonly onAddItem: (
    projectId: string,
    input: {
      moduleId: string;
      quantity: number;
      optionChoices: OptionChoices;
      measurePresetId?: string;
      baseMode?: ModuleBaseMode;
    },
    /** F141: id del ítem creado, para colocar desde la biblioteca de Proyectar. */
  ) => string | undefined;
  readonly onUpdateItem: (projectId: string, item: ProjectItem) => void;
  readonly onRemoveItem: (projectId: string, itemId: string) => void;
  /** Reorder items by moving from one index to another (F052 / drag & drop). */
  readonly onReorderItems?: (projectId: string, fromIndex: number, toIndex: number) => void;
  /** Kitchen plan walls + placements (#133). */
  readonly onUpdateKitchenLayout?: (
    projectId: string,
    layout: import('@muebles/domain').ProjectKitchenLayout,
  ) => void;
  /**
   * Soft lock for multi-user Proyectar (auth). When omitted, no lock protocol.
   */
  readonly planActor?: {
    readonly userId: string;
    readonly userName: string;
  };
  readonly onAcquirePlanEdit?: (projectId: string) => boolean;
  readonly onRenewPlanEdit?: (projectId: string) => boolean;
  readonly onReleasePlanEdit?: (projectId: string) => void;
  /** Apply A/B scenario B role choice to all lines (#137). Draft only. */
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
    nestingImport: NonNullable<import('@muebles/domain').Project['nestingImport']>,
  ) => void;

  // --- Job costing (OC-080..OC-084, #304): estimate vs actual panel ---
  readonly costingViewByProject?: Readonly<Record<string, CostingPanelView>>;
  readonly costingHandlers?: CostingHandlers;
  readonly canManageCosting?: boolean;
  readonly canCaptureCosting?: boolean;
  readonly canRecordOtherCosting?: boolean;
  readonly canVoidCosting?: boolean;
  readonly costingLabelsByMaterial?: Readonly<Record<string, string>>;
  // --- Structured site survey (OC-040/OC-041, #305) ---
  readonly surveyHandlers?: SurveyHandlers;
  readonly canCaptureSurvey?: boolean;
  readonly canVerifySurvey?: boolean;
  readonly canApproveSurvey?: boolean;
  /** Transversal workspace navigation for the overview panel (OC-091). */
  readonly overviewNav?: ProjectOverviewNav;
  /** F029: project-wide option defaults (empty keys inherit on each line). */
  readonly onUpdateProjectLevelChoices?: (
    projectId: string,
    choices: OptionChoices,
  ) => void;
  /** #109: project-level measure defaults keyed by furnitureType. Pre-selects
   * the closest module preset when adding an item; per-line override wins. */
  readonly onUpdateMeasureDefaults?: (
    projectId: string,
    defaults:
      | { readonly [type in FurnitureType]?: { readonly depth?: number; readonly height?: number } }
      | undefined,
  ) => void;
  /**
   * Notifies parent when the selected project id changes (null = list / none).
   * Parent computes domain breakdown and passes breakdown props.
   */
  readonly onSelectionChange?: (projectId: string | null) => void;
  /** Domain QuoteBreakdown from shell (PRJ-06, UX-03). Null when blocked/unavailable. */
  readonly breakdown?: QuoteBreakdown | null;
  /**
   * Consolidated m² / cantos / herrajes for planning (F047 / #97).
   * Shell computes via domain; null when blocked/unavailable.
   */
  readonly materialSummary?: ProjectMaterialSummary | null;
  /** Live backend recalculation in flight (auth session). */
  readonly breakdownLoading?: boolean;
  /**
   * Backend recalculation failed; panel may still show local/fallback totals.
   * Parent owns toast; this prop drives the totals panel alert.
   */
  readonly breakdownError?: string | null;
  readonly previewBlocked?: boolean;
  readonly missingGroups?: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  /**
   * Optimizer export (F010). When provided, Export button is enabled.
   * Shell owns validate → cut rows → xlsx → download/dialog.
   */
  readonly onExport?: () => void | Promise<void>;
  /**
   * @deprecated Not shown in quote UI — factory exports live in Producción.
   * Kept optional so older shells can still pass the prop without breaking.
   */
  readonly onExportHardware?: () => void | Promise<void>;
  /**
   * @deprecated Not shown in quote UI — factory exports live in Producción.
   */
  readonly onExportPieceLabels?: () => void | Promise<void>;
  /**
   * @deprecated Not shown in quote UI — pack lives in Producción hub/queue.
   */
  readonly onExportProductionPack?: () => void | Promise<void>;
  /**
   * Open factory workspace for the selected plant-ready project (PROD-0.1).
   * Shell navigates to `/production/:id`.
   */
  readonly onOpenInProduction?: (projectId: string) => void;
  /**
   * Commercial quote export for client (F030 / #36).
   * Shell owns breakdown → xlsx → download.
   */
  readonly onExportCommercialQuote?: () => void | Promise<void>;
  /**
   * Commercial quote PDF for client (F045 / #90).
   * - detailed: listado de muebles + total de venta
   * - summary: solo datos del proyecto + total de venta
   */
  readonly onExportCommercialQuotePdf?: (
    variant: 'detailed' | 'summary',
  ) => void | Promise<void>;
  readonly exportErrors?: readonly ExportIssue[];
  readonly exportBusy?: boolean;
  /** When true, export buttons stay disabled (shell already blocked). */
  readonly exportBlocked?: boolean;
  /**
   * Sale-price estimates per project id (domain-computed in shell).
   * `null` value = blocked / unavailable.
   */
  readonly projectEstimates?: Readonly<Record<string, number | null>>;
  /**
   * Open detail for this project id when set (e.g. from Dashboard).
   * Shell owns navigation; screen reacts via effect.
   */
  readonly openProjectId?: string | null;
  /**
   * Incrementing token to open the create-project modal from outside
   * (Dashboard quick action). 0 / undefined = no request.
   */
  readonly requestCreateKey?: number;
  /** Workshop defaults for new quotation drafts (F031). */
  readonly workshopSettings?: WorkshopSettings | null;
  /** F035: hide create/edit/duplicate when false. */
  readonly canMutate?: boolean;
  /** F035: hide delete (gerente/admin only). */
  readonly canDelete?: boolean;
  /** F036: reopen closed quote → draft (clears snapshot). */
  readonly canReopen?: boolean;
  /** Admin/gerente: reopen accepted|produced → draft (#257). */
  readonly canForceReopenClosed?: boolean;
  /** F036: mark accepted → produced (click-only). */
  readonly canMarkProduced?: boolean;
  /** Shell applies status transition (snapshot rules). */
  readonly onMarkProduced?: (projectId: string) => void;
  /** Transition status: draft→quoted, quoted→accepted (gap #3). */
  readonly onChangeStatus?: (projectId: string, status: ProjectStatus) => void;
  readonly onReopen?: (projectId: string) => void;
  /** #200: restore a project to a previous version snapshot. */
  readonly onRestoreVersion?: (projectId: string, version: number) => void;
  /** F039: hide margin and cost breakdown. */
  readonly showCosts?: boolean;
  /**
   * Fase 3 slice 3.5: when set, auto-open the presentation mode for this
   * project id (used by ?present=projectId URL sharing).
   */
  readonly autoPresentId?: string | null;
  /** Auth-aware media URL resolver for 3D textures. */
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;

  // --- CRM & Project Photos (CRM Phase 1) ---
  readonly photos?: readonly ProjectPhoto[];
  readonly onUploadPhotos?: (
    projectId: string,
    files: File[],
    stage: ProjectPhotoStage,
    caption?: string,
  ) => Promise<void>;
  readonly onUpdatePhoto?: (
    projectId: string,
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ) => Promise<void>;
  readonly onDeletePhoto?: (projectId: string, photoId: string) => Promise<void>;
  readonly workshopName?: string;

  // --- CRM & Internal Comms (CRM Phase 2) ---
  readonly internalMessages?: readonly ProjectInternalMessage[];
  readonly onSendInternalMessage?: (msg: {
    projectId: string;
    messageType: ProjectInternalMessageType;
    content: string;
    senderName?: string;
  }) => Promise<void> | void;
  readonly onUpdateTechnicalWorkflow?: (
    projectId: string,
    updates: {
      assignedEngineerId?: string;
      technicalStatus?: ProjectTechnicalStatus;
      surveyCompletedAt?: string;
      installationScheduledDate?: string;
      comment?: string;
    },
  ) => Promise<void> | void;
  readonly currentUserId?: string;

  // --- CRM & Warranty Desk (CRM Phase 3) ---
  readonly warranties?: readonly WarrantyTicket[];
  readonly availableCutRows?: readonly ProductionCutRow[];
  readonly onCreateWarrantyTicket?: (
    ticket: Partial<WarrantyTicket> & {
      projectId: string;
      title: string;
      category: WarrantyTicketCategory;
      priority: WarrantyTicketPriority;
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
    options?: ProductionReleaseOptions,
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
      impact?: ChangeOrderImpact;
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
    type: ApprovalType,
    notes?: string,
  ) => void | Promise<void>;
  readonly onChangeCommercialStatus?: (
    projectId: string,
    status: CommercialStatus,
  ) => void | Promise<void>;
  readonly onRecordDeposit?: (
    projectId: string,
    params: import('@muebles/domain').DepositReceivedPayload & { note?: string },
  ) => void | Promise<void>;
}

export function ProjectsScreen({
  projects,
  modules,
  categories = [],
  optionGroups,
  materials,
  materialCategories = [],
  edges,
  hardware,
  ambientMaterials = [],
  ambientCategories = [],
  catalogComponents = [],
  catalogStructures = [],
  catalogAgregados = [],
  customers = [],
  canAssignOwner = false,
  assignableOwners = [],
  ownerLabels = {},
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
  projectTemplates,
  onSaveAsTemplate,
  onCreateFromTemplate,
  onDeleteTemplate,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  onReorderItems,
  onUpdateKitchenLayout,
  planActor,
  onAcquirePlanEdit,
  onRenewPlanEdit,
  onReleasePlanEdit,
  onApplyScenarioB,
  onDuplicateWithScenarioB,
  onExportScenarioPdf,
  onUpdateInstallationChecklist,
  onImportNesting,
  costingViewByProject,
  costingHandlers,
  canManageCosting = false,
  canCaptureCosting = false,
  canRecordOtherCosting = false,
  canVoidCosting = false,
  costingLabelsByMaterial,
  surveyHandlers,
  canCaptureSurvey = false,
  canVerifySurvey = false,
  canApproveSurvey = false,
  overviewNav,
  onUpdateProjectLevelChoices,
  onUpdateMeasureDefaults,
  onSelectionChange,
  breakdown = null,
  materialSummary = null,
  breakdownLoading = false,
  breakdownError = null,
  previewBlocked = false,
  missingGroups = [],
  groupLabels,
  onExport,
  onExportProductionPack,
  onOpenInProduction,
  onExportCommercialQuote,
  onExportCommercialQuotePdf,
  exportErrors = [],
  exportBusy = false,
  exportBlocked = false,
  projectEstimates = {},
  openProjectId = null,
  requestCreateKey = 0,
  loading = false,
  workshopSettings = null,
  canMutate = true,
  canDelete = true,
  canReopen = false,
  canForceReopenClosed = false,
  canMarkProduced = false,
  onMarkProduced,
  onChangeStatus,
  onReopen,
  onRestoreVersion,
  showCosts = true,
  autoPresentId = null,
  resolveImageUrl = (u) => u,
  photos,
  onUploadPhotos,
  onUpdatePhoto,
  onDeletePhoto,
  workshopName,
  internalMessages,
  onSendInternalMessage,
  onUpdateTechnicalWorkflow,
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
}: ProjectsScreenProps): ReactNode {
  const state = useProjectsScreenState({
    projects,
    modules,
    materials,
    edges,
    hardware,
    ambientMaterials,
    ambientCategories,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
    customers,
    optionGroups,
    workshopSettings,
    requestCreateKey,
    openProjectId,
    autoPresentId,
    projectTemplates,
    canMutate,
    onCreate,
    onUpdate,
    onDelete,
    onCreateFromTemplate,
    onDeleteTemplate,
    onAddItem,
    onUpdateItem,
    onUpdateKitchenLayout,
    onAcquirePlanEdit,
    onRenewPlanEdit,
    onReleasePlanEdit,
    onUpdateProjectLevelChoices,
    onSelectionChange,
  });

  const estimateLabel = (projectId: string): ReactNode => {
    if (!(projectId in projectEstimates)) {
      return (
        <span className="project-card__price-value project-card__price-value--muted">
          —
        </span>
      );
    }
    const value = projectEstimates[projectId];
    if (value == null) {
      return (
        <span className="project-card__price-value project-card__price-value--muted">
          Sin total
        </span>
      );
    }
    return (
      <span className="project-card__price-value">
        {formatProjectMoney(value)}
      </span>
    );
  };

  /** Block export when shell says so or options incomplete; still allow retry after listed issues. */
  const exportDisabled =
    exportBusy || exportBlocked || previewBlocked || !state.selectedProject;
  /** F041: Optimizer/herrajes only for accepted/produced (plant-ready). */
  const productionExportOk =
    state.selectedProject != null &&
    (state.selectedProject.status === 'accepted' ||
      state.selectedProject.status === 'produced');
  const productionExportDisabled = exportDisabled || !productionExportOk;

  const exportMenu = useMemo<{
    readonly sections: readonly DropdownMenuSection[];
    readonly onClose?: () => void;
  }>(() => {
    if (!state.selectedProject) return { sections: [] };
    const itemsEmpty = state.selectedProject.items.length === 0;

    const commercialItems = [
      onExportCommercialQuote
        ? {
            id: 'quote',
            label: 'Exportar cotización',
            hint: 'Para el cliente (.xlsx)',
            disabled: exportBusy || exportBlocked || itemsEmpty,
            onSelect: () => void onExportCommercialQuote(),
          }
        : null,
      onExportCommercialQuotePdf
        ? {
            id: 'pdf-list',
            label: 'PDF listado',
            hint: 'Muebles + total de venta',
            disabled: exportBusy || exportBlocked || itemsEmpty,
            onSelect: () => void onExportCommercialQuotePdf('detailed'),
          }
        : null,
      onExportCommercialQuotePdf
        ? {
            id: 'pdf-summary',
            label: 'PDF resumen',
            hint: 'Datos + total, sin listado',
            disabled: exportBusy || exportBlocked || itemsEmpty,
            onSelect: () => void onExportCommercialQuotePdf('summary'),
          }
        : null,
    ].filter((x): x is NonNullable<typeof x> => x !== null);

    if (commercialItems.length === 0) return { sections: [] };
    return {
      sections: [
        {
          id: 'commercial',
          label: 'Comercial',
          items: commercialItems,
        },
      ],
    };
  }, [
    state.selectedProject,
    onExportCommercialQuote,
    onExportCommercialQuotePdf,
    exportBusy,
    exportBlocked,
  ]);

  const exportBlockMessage = previewBlocked
    ? 'Exportación bloqueada: completá las opciones obligatorias de los muebles.'
    : exportBlocked
      ? 'Exportación no disponible con el estado actual.'
      : exportErrors.length > 0
        ? 'Hay errores de validación en el último intento. Corregí los ítems e intentá de nuevo.'
        : null;

  if (loading) {
    return (
      <section className="catalog-page" aria-label="Cotizaciones">
        <PageLoading label="Cargando cotizaciones…" data-testid="projects-loading" />
      </section>
    );
  }

  return (
    <section className="catalog-page" aria-label="Cotizaciones">
      {state.selectedProject ? (
        <ProjectDetailView
          project={state.selectedProject}
          projectEstimates={projectEstimates}
          modules={modules}
          optionGroups={optionGroups}
          catalogs={state.catalogs}
          catalogComponents={catalogComponents}
          catalogStructures={catalogStructures}
          customers={customers}
          ownerLabels={ownerLabels}
          breakdown={breakdown}
          materialSummary={materialSummary}
          breakdownLoading={breakdownLoading}
          breakdownError={breakdownError}
          previewBlocked={previewBlocked}
          missingGroups={missingGroups}
          groupLabels={groupLabels}
          showCosts={showCosts}
          exportMenu={exportMenu}
          exportBlockMessage={exportBlockMessage}
          exportErrors={exportErrors}
          exportBusy={exportBusy}
          exportBlocked={exportBlocked}
          productionExportDisabled={productionExportDisabled}
          productionExportOk={productionExportOk}
          onExport={onExport}
          onExportProductionPack={onExportProductionPack}
          onOpenInProduction={onOpenInProduction}
          itemHandlers={{
            onUpdateItemQuantity: state.updateItemQuantity,
            onUpdateItemMeasurePreset: state.updateItemMeasurePreset,
            onUpdateItemChoice: state.updateItemChoice,
            onRemoveItem,
            onReorderItems: onReorderItems
              ? (fromIndex, toIndex) => {
                  if (!state.selectedId) return;
                  onReorderItems(state.selectedId, fromIndex, toIndex);
                }
              : undefined,
          }}
          removeConfirm={{
            confirmRemoveItemId: state.confirmRemoveItemId,
            onRequestRemoveItem: (itemId) => state.setConfirmRemoveItemId(itemId),
            onCancelRemoveItem: () => state.setConfirmRemoveItemId(null),
            onConfirmRemoveItem: (projectId, itemId) => {
              onRemoveItem(projectId, itemId);
              state.setConfirmRemoveItemId(null);
            },
          }}
          updateProjectLevelChoice={state.updateProjectLevelChoice}
          onUpdateMeasureDefaults={onUpdateMeasureDefaults}
          viewer3D={{
            onOpenQuote3D: () => {
              state.setViewerItem(null);
              state.setViewerQuoteRun(true);
              state.setShow3DModal(true);
            },
            onOpenItem3D: (item, mod) => {
              state.setViewerQuoteRun(false);
              state.setViewerItem({ item, mod });
              state.setShow3DModal(true);
            },
          }}
          itemError={state.itemError}
          addItemModalOpen={state.addItemModalOpen}
          onOpenAddItemModal={state.openAddItemModal}
          onBackToList={state.backToList}
          onOpenPresentation={() => state.setShowPresentation(true)}
          onOpenSpatialStudio={
            onUpdateKitchenLayout
              ? () => {
                  state.setPostAddPlaceCue(false);
                  state.setSpatialBootstrap(null);
                  state.setShowSpatialStudio(true);
                }
              : undefined
          }
          postAddPlaceCue={state.postAddPlaceCue}
          onDismissPostAddPlaceCue={() => state.setPostAddPlaceCue(false)}
          onOpenSpatialStudioUnplaced={
            onUpdateKitchenLayout ? state.openSpatialStudioUnplaced : undefined
          }
          onEditMeta={state.startEditMeta}
          onDuplicate={onDuplicate}
          onSaveAsTemplate={
            canMutate && onSaveAsTemplate
              ? () => state.startSaveAsTemplate()
              : undefined
          }
          onMarkProduced={onMarkProduced}
          onChangeStatus={onChangeStatus}
          onRequestReopen={() => state.setConfirmReopen(true)}
          onRequestDelete={() => state.setConfirmDelete(true)}
          onUpdateKitchenLayout={onUpdateKitchenLayout}
          onApplyScenarioB={onApplyScenarioB}
          onDuplicateWithScenarioB={onDuplicateWithScenarioB}
          onExportScenarioPdf={onExportScenarioPdf}
          onUpdateInstallationChecklist={onUpdateInstallationChecklist}
          onImportNesting={onImportNesting}
          costingView={costingViewByProject?.[state.selectedProject!.id] ?? null}
          costingHandlers={costingHandlers}
          canManageCosting={canManageCosting}
          canCaptureCosting={canCaptureCosting}
          canRecordOtherCosting={canRecordOtherCosting}
          canVoidCosting={canVoidCosting}
          costingLabelsByMaterial={costingLabelsByMaterial}
          surveyHandlers={surveyHandlers}
          canCaptureSurvey={canCaptureSurvey}
          canVerifySurvey={canVerifySurvey}
          canApproveSurvey={canApproveSurvey}
          overviewNav={overviewNav}
          onUpdateProjectLevelChoices={onUpdateProjectLevelChoices}
          canMutate={canMutate}
          canDelete={canDelete}
          onRestoreVersion={onRestoreVersion ? (version) => onRestoreVersion(state.selectedProject!.id, version) : undefined}
          canReopen={canReopen}
          canForceReopenClosed={canForceReopenClosed}
          canMarkProduced={canMarkProduced}
          projectTemplates={projectTemplates}
          photos={photos}
          onUploadPhotos={
            onUploadPhotos
              ? (files, stage, caption) => onUploadPhotos(state.selectedProject!.id, files, stage, caption)
              : undefined
          }
          onUpdatePhoto={
            onUpdatePhoto
              ? (photoId, updates) => onUpdatePhoto(state.selectedProject!.id, photoId, updates)
              : undefined
          }
          onDeletePhoto={
            onDeletePhoto
              ? (photoId) => onDeletePhoto(state.selectedProject!.id, photoId)
              : undefined
          }
          workshopName={workshopName}
          internalMessages={internalMessages}
          onSendInternalMessage={
            onSendInternalMessage
              ? (msg) => onSendInternalMessage({ projectId: state.selectedProject!.id, ...msg })
              : undefined
          }
          onUpdateTechnicalWorkflow={
            onUpdateTechnicalWorkflow
              ? (updates) => onUpdateTechnicalWorkflow(state.selectedProject!.id, updates)
              : undefined
          }
          assignableOwners={assignableOwners}
          currentUserId={currentUserId}
          warranties={warranties}
          availableCutRows={availableCutRows}
          onCreateWarrantyTicket={onCreateWarrantyTicket}
          onUpdateWarrantyTicket={onUpdateWarrantyTicket}
          onDeleteWarrantyTicket={onDeleteWarrantyTicket}
          onUploadWarrantyPhoto={onUploadWarrantyPhoto}
          onExportWarrantyRefabricationOptimizer={onExportWarrantyRefabricationOptimizer}
          onReleaseToProduction={onReleaseToProduction}
          onRevokeProductionRelease={onRevokeProductionRelease}
          onCreateChangeOrder={onCreateChangeOrder}
          onSubmitChangeOrder={onSubmitChangeOrder}
          onApproveChangeOrder={onApproveChangeOrder}
          onRejectChangeOrder={onRejectChangeOrder}
          onCreateDesignRevision={onCreateDesignRevision}
          onDecideApproval={onDecideApproval}
          onRequestApproval={onRequestApproval}
          onChangeCommercialStatus={onChangeCommercialStatus}
          onRecordDeposit={onRecordDeposit}
        />
      ) : (
        <ProjectsListView
          projects={projects}
          filtered={state.filtered}
          customers={customers}
          projectTemplates={projectTemplates}
          search={state.search}
          statusFilter={state.statusFilter}
          isTrulyEmpty={state.isTrulyEmpty}
          isFilterEmpty={state.isFilterEmpty}
          canMutate={canMutate}
          hasCreateFromTemplate={!!onCreateFromTemplate}
          hasDeleteTemplate={!!onDeleteTemplate}
          estimateLabel={estimateLabel}
          onSearchChange={state.setSearch}
          onStatusFilterChange={state.setStatusFilter}
          onClearFilters={() => {
            state.setSearch('');
            state.setStatusFilter('all');
          }}
          onNewProject={state.startCreate}
          onFromTemplate={state.startFromTemplate}
          onManageTemplates={() => state.setTemplatesManagementOpen(true)}
          onOpenProject={state.openDetail}
        />
      )}

      <ProjectModalsContainer
        selectedProject={state.selectedProject}
        modules={modules}
        categories={categories}
        optionGroups={optionGroups}
        materials={materials}
        edges={edges}
        hardware={hardware}
        catalogComponents={catalogComponents}
        catalogStructures={catalogStructures}
        catalogAgregados={catalogAgregados}
        customers={customers}
        workshopSettings={workshopSettings}
        canAssignOwner={canAssignOwner}
        assignableOwners={assignableOwners}
        showCosts={showCosts}
        canMutate={canMutate}
        canReopen={canReopen}
        canMarkProduced={canMarkProduced}
        metaModalOpen={state.metaModalOpen}
        metaEditingId={state.metaEditingId}
        metaDraft={state.metaDraft}
        addItemModalOpen={state.addItemModalOpen}
        confirmDelete={state.confirmDelete}
        confirmReopen={state.confirmReopen}
        showPresentation={state.showPresentation}
        showSpatialStudio={state.showSpatialStudio}
        show3DModal={state.show3DModal}
        viewerItem={state.viewerItem}
        viewerQuoteRun={state.viewerQuoteRun}
        templatePickerOpen={state.templatePickerOpen}
        saveAsTemplateOpen={state.saveAsTemplateOpen}
        templatesManagementOpen={state.templatesManagementOpen}
        projectTemplates={projectTemplates}
        catalogs={state.catalogs}
        project3dCatalog={state.project3dCatalog}
        breakdown={breakdown}
        projectEstimates={projectEstimates}
        spatialBootstrap={state.spatialBootstrap}
        planActor={planActor}
        resolveImageUrl={resolveImageUrl}
        onCloseMetaModal={state.closeMetaModal}
        onSubmitMeta={state.handleSubmitMeta}
        onCloseAddItemModal={state.closeAddItemModal}
        onAddItemSubmit={state.handleAddItemSubmit}
        onCancelDelete={() => state.setConfirmDelete(false)}
        onConfirmDelete={(id) => state.handleDelete(id)}
        onCancelReopen={() => state.setConfirmReopen(false)}
        onConfirmReopen={(id) => {
          onReopen?.(id);
          state.setConfirmReopen(false);
        }}
        onClosePresentation={() => state.setShowPresentation(false)}
        onGoToProyectar={
          onUpdateKitchenLayout
            ? () => {
                state.setShowPresentation(false);
                state.setShowSpatialStudio(true);
              }
            : undefined
        }
        onInsertCatalogItem={state.insertCatalogItem}
        onUpdateProjectLevelChoice={
          onUpdateProjectLevelChoices
            ? (groupCode, optionId) =>
                state.updateProjectLevelChoice(groupCode, optionId)
            : undefined
        }
        materialCategories={materialCategories}
        onAcquirePlanEdit={planActor && onAcquirePlanEdit ? state.handleAcquirePlanEdit : undefined}
        onRenewPlanEdit={planActor && onRenewPlanEdit ? state.handleRenewPlanEdit : undefined}
        onReleasePlanEdit={planActor && onReleasePlanEdit ? state.handleReleasePlanEdit : undefined}
        onCloseSpatialStudio={() => {
          state.setShowSpatialStudio(false);
          state.setSpatialBootstrap(null);
        }}
        onUpdateKitchenLayout={onUpdateKitchenLayout}
        onUpdateItem={onUpdateItem}
        onClose3DModal={() => {
          state.setShow3DModal(false);
          state.setViewerItem(null);
          state.setViewerQuoteRun(false);
        }}
        onCloseTemplatePicker={() => state.setTemplatePickerOpen(false)}
        onConfirmFromTemplate={state.confirmFromTemplate}
        onCloseSaveAsTemplate={() => state.setSaveAsTemplateOpen(false)}
        onSaveAsTemplate={onSaveAsTemplate}
        onCloseTemplatesManagement={() => state.setTemplatesManagementOpen(false)}
        onDeleteTemplate={state.requestDeleteTemplate}
      />
    </section>
  );
}
