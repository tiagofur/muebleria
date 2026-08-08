/**
 * Projects list + quotation detail — cards + Modal MD (F022).
 * Cost formulas live in the shell; this component only renders breakdown props.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  Component,
  Customer,
  EdgeBand,
  ExportIssue,
  FurnitureType,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectMaterialSummary,
  ProjectStatus,
  ProjectTemplate,
  QuoteBreakdown,
  Structure,
  WorkshopSettings,
} from '@muebles/domain';
import {
  type DropdownMenuSection,
  PageLoading,
  useDebouncedValue,
} from '../common';
import { consumeRequestCreateKey } from '../common/consumeRequestCreateKey';
import '../catalogs/catalogs.css';
import { ExportIssueList } from './ExportIssueList';
import { Project3DModal } from './components/Project3DModal';
import { ProjectPresentationMode } from './components/ProjectPresentationMode';
import { ProjectSpatialStudio } from './components/ProjectSpatialStudio';
import { ProjectDetailView } from './components/ProjectDetailView';
import { ProjectAddItemModal } from './components/ProjectAddItemModal';
import { ProjectConfirmDeleteModal } from './components/ProjectConfirmDeleteModal';
import { ProjectConfirmReopenModal } from './components/ProjectConfirmReopenModal';
import { ProjectMetaModal } from './components/ProjectMetaModal';
import { ProjectSaveAsTemplateModal } from './components/ProjectSaveAsTemplateModal';
import { ProjectTemplatePickerModal } from './components/ProjectTemplatePickerModal';
import { ProjectTemplatesManagementModal } from './components/ProjectTemplatesManagementModal';
import { ProjectsListView } from './components/ProjectsListView';
import {
  emptyProjectDraft,
  filterProjectsList,
  type ProjectStatusFilter,
  formatProjectMoney,
  projectToDraft,
  setItemOptionChoice,
  setProjectLevelChoice,
  validateItemQuantity,
  type AddItemDraft,
  type ProjectDraft,
} from './projectHelpers';
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
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
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
    },
  ) => void;
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
   * Shell navigates to `/produccion/:id`.
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
}

export function ProjectsScreen({
  projects,
  modules,
  categories = [],
  optionGroups,
  materials,
  edges,
  hardware,
  catalogComponents = [],
  catalogStructures = [],
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
}: ProjectsScreenProps): ReactNode {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] =
    useState<ProjectStatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaEditingId, setMetaEditingId] = useState<string | null>(null);
  /** Seed draft for the meta modal — computed by startCreate/startEditMeta and
   * consumed by ProjectMetaModal on its closed→open transition (F058a). */
  const [metaDraft, setMetaDraft] = useState<ProjectDraft>(() =>
    emptyProjectDraft(workshopSettings),
  );
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  // itemError now only surfaces detail-side quantity/measure errors (the
  // add-item modal owns its own internal error state — F058a).
  const [itemError, setItemError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);
  const [showSpatialStudio, setShowSpatialStudio] = useState(false);
  const [spatialBootstrap, setSpatialBootstrap] = useState<{
    listFilter?: 'all' | 'unplaced' | 'placed';
    selectKey?: string | null;
  } | null>(null);
  /** Cue on quote detail after add — never auto-open Proyectar. */
  const [postAddPlaceCue, setPostAddPlaceCue] = useState(false);

  // Fase 3 slice 3.5: auto-open presentation when autoPresentId matches.
  useEffect(() => {
    if (autoPresentId && selectedId === autoPresentId && !showPresentation) {
      setShowPresentation(true);
    }
  }, [autoPresentId, selectedId, showPresentation]);
  const [show3DModal, setShow3DModal] = useState(false);
  const [viewerItem, setViewerItem] = useState<{
    item: ProjectItem;
    mod: Module;
  } | null>(null);
  /** When true, 3D modal shows full quote run (not a single line). */
  const [viewerQuoteRun, setViewerQuoteRun] = useState(false);
  const [confirmRemoveItemId, setConfirmRemoveItemId] = useState<string | null>(
    null,
  );
  // --- Project templates (#110 / H15) ---
  // F058a: picker draft state (selected template / name / customer / error)
  // now lives inside ProjectTemplatePickerModal.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  // F058a: saveAsTemplateName moved into ProjectSaveAsTemplateModal component.
  const [templatesManagementOpen, setTemplatesManagementOpen] = useState(false);

  const catalogs = useMemo(
    () => ({ materials, edges, hardware }),
    [materials, edges, hardware],
  );

  const project3dCatalog = useMemo(
    () => ({
      modules,
      structures: catalogStructures,
      components: catalogComponents,
      materials,
      edges,
      hardware,
      optionGroups,
    }),
    [
      modules,
      catalogStructures,
      catalogComponents,
      materials,
      edges,
      hardware,
      optionGroups,
    ],
  );

  const filtered = useMemo(
    () =>
      filterProjectsList(projects, debouncedSearch, statusFilter, customers),
    [projects, debouncedSearch, statusFilter, customers],
  );

  const selectedProject =
    selectedId !== null
      ? (projects.find((p) => p.id === selectedId) ?? null)
      : null;

  const selectedProjectId = selectedProject?.id;
  const handleAcquirePlanEdit = useCallback((): boolean => {
    if (!selectedProjectId || !onAcquirePlanEdit) return false;
    return onAcquirePlanEdit(selectedProjectId);
  }, [selectedProjectId, onAcquirePlanEdit]);
  const handleRenewPlanEdit = useCallback((): boolean => {
    if (!selectedProjectId || !onRenewPlanEdit) return false;
    return onRenewPlanEdit(selectedProjectId);
  }, [selectedProjectId, onRenewPlanEdit]);
  const handleReleasePlanEdit = useCallback((): void => {
    if (!selectedProjectId || !onReleasePlanEdit) return;
    onReleasePlanEdit(selectedProjectId);
  }, [selectedProjectId, onReleasePlanEdit]);

  // Domain breakdown target: selected detail project
  useEffect(() => {
    onSelectionChange?.(selectedId);
  }, [selectedId, onSelectionChange]);

  // Sync detail selection from shell URL / dashboard handoff.
  // null = list view (e.g. `/projects`); id = detail (`/projects/:id`).
  useEffect(() => {
    if (openProjectId == null || openProjectId === '') {
      setSelectedId(null);
      setConfirmDelete(false);
      setConfirmRemoveItemId(null);
      setItemError(null);
      setAddItemModalOpen(false);
      setMetaModalOpen(false);
      return;
    }
    if (!projects.some((p) => p.id === openProjectId)) return;
    setSelectedId(openProjectId);
    setConfirmDelete(false);
    setConfirmRemoveItemId(null);
    setItemError(null);
    setAddItemModalOpen(false);
    setMetaModalOpen(false);
  }, [openProjectId, projects]);

  // Open create once per requestCreateKey bump (Dashboard handoff).
  // Module-scoped consume survives remount (JD R4-W sticky create key).
  useEffect(() => {
    if (!consumeRequestCreateKey('projects', requestCreateKey)) return;
    setMetaEditingId(null);
    setMetaDraft(emptyProjectDraft(workshopSettings));
    setMetaModalOpen(true);
  }, [requestCreateKey, workshopSettings]);

  // If selected project disappears (delete), return to list
  useEffect(() => {
    if (selectedId && !projects.some((p) => p.id === selectedId)) {
      setSelectedId(null);
      setConfirmDelete(false);
    }
  }, [projects, selectedId]);

  const closeMetaModal = () => {
    setMetaModalOpen(false);
    setMetaEditingId(null);
  };

  // closeAddItemModal just toggles open=false; ProjectAddItemModal resets its
  // own draft/error/cascade on the next closed→open transition (F058a).
  const closeAddItemModal = () => {
    setAddItemModalOpen(false);
  };

  const startCreate = () => {
    setMetaEditingId(null);
    setMetaDraft(emptyProjectDraft(workshopSettings));
    setMetaModalOpen(true);
  };

  // --- Project templates (#110 / H15) ---
  // F058a: the picker owns the template/name/customer draft + validation.
  // startFromTemplate just opens it; confirmFromTemplate routes the validated
  // payload to onCreateFromTemplate and closes.

  const startFromTemplate = () => {
    if (!projectTemplates || projectTemplates.length === 0) return;
    setTemplatePickerOpen(true);
  };

  const confirmFromTemplate = (payload: {
    templateId: string;
    draft: ProjectDraft;
  }) => {
    if (!onCreateFromTemplate) return;
    onCreateFromTemplate(payload.templateId, payload.draft);
    setTemplatePickerOpen(false);
  };

  const startSaveAsTemplate = () => {
    if (!selectedProject) return;
    setSaveAsTemplateOpen(true);
  };

  const requestDeleteTemplate = (templateId: string) => {
    if (!onDeleteTemplate) return;
    onDeleteTemplate(templateId);
  };

  const startEditMeta = (project: Project) => {
    setMetaEditingId(project.id);
    setMetaDraft(projectToDraft(project, customers));
    setMetaModalOpen(true);
  };

  const openDetail = (project: Project) => {
    setSelectedId(project.id);
    setConfirmDelete(false);
    setConfirmRemoveItemId(null);
    setItemError(null);
  };

  const backToList = () => {
    setPostAddPlaceCue(false);
    setSelectedId(null);
    setConfirmDelete(false);
    setConfirmRemoveItemId(null);
    setItemError(null);
    setAddItemModalOpen(false);
    setMetaModalOpen(false);
  };

  // F058a: validation + new-customer normalization now live inside
  // ProjectMetaModal. We only route the validated payload to the right shell
  // callback and close.
  const handleSubmitMeta = (payload: ProjectDraft) => {
    if (metaEditingId) {
      onUpdate(metaEditingId, payload);
    } else {
      onCreate(payload);
    }
    closeMetaModal();
  };

  const openAddItemModal = () => {
    setItemError(null);
    setAddItemModalOpen(true);
  };

  // F058a: draft/validation/preset-preselect now live inside
  // ProjectAddItemModal. We only route the validated payload to onAddItem and
  // close. selectedId is guaranteed set (modal opens from the detail view).
  const handleAddItemSubmit = (payload: {
    moduleId: string;
    quantity: number;
    optionChoices: OptionChoices;
    measurePresetId?: string;
  }) => {
    if (!selectedId) return;
    onAddItem(selectedId, payload);
    closeAddItemModal();
    // Cotizar ≠ Proyectar: never force-open studio after add.
    // If studio is already open, refresh unplaced focus; else show quote cue.
    if (onUpdateKitchenLayout && canMutate) {
      if (showSpatialStudio) {
        setSpatialBootstrap({ listFilter: 'unplaced', selectKey: null });
      } else {
        setPostAddPlaceCue(true);
      }
    }
  };

  const openSpatialStudioUnplaced = () => {
    setPostAddPlaceCue(false);
    setSpatialBootstrap({ listFilter: 'unplaced', selectKey: null });
    setShowSpatialStudio(true);
  };

  const updateItemMeasurePreset = (item: ProjectItem, measurePresetId: string) => {
    if (!selectedId) return;
    setItemError(null);
    onUpdateItem(selectedId, {
      ...item,
      measurePresetId: measurePresetId || undefined,
    });
  };

  const updateItemQuantity = (item: ProjectItem, quantity: number) => {
    if (!selectedId) return;
    const qtyErr = validateItemQuantity(quantity);
    if (qtyErr) {
      setItemError(qtyErr);
      return;
    }
    setItemError(null);
    onUpdateItem(selectedId, { ...item, quantity });
  };

  const updateItemChoice = (
    item: ProjectItem,
    groupCode: string,
    optionId: string,
  ) => {
    if (!selectedId) return;
    // PRJ-09: only ProjectItem.optionChoices changes — never Module.
    // Empty value = inherit project default (F029).
    const optionChoices = setItemOptionChoice(
      item.optionChoices,
      groupCode,
      optionId,
    );
    onUpdateItem(selectedId, { ...item, optionChoices });
  };

  const updateProjectLevelChoice = (groupCode: string, optionId: string) => {
    if (!selectedId || !selectedProject || !onUpdateProjectLevelChoices) return;
    const choices = setProjectLevelChoice(
      selectedProject.projectLevelChoices,
      groupCode,
      optionId,
    );
    onUpdateProjectLevelChoices(selectedId, choices);
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    if (selectedId === id) {
      setSelectedId(null);
    }
    setConfirmDelete(false);
  };

  const isTrulyEmpty = projects.length === 0;
  const isFilterEmpty = !isTrulyEmpty && filtered.length === 0;

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
    exportBusy || exportBlocked || previewBlocked || !selectedProject;
  /** F041: Optimizer/herrajes only for accepted/produced (plant-ready). */
  const productionExportOk =
    selectedProject != null &&
    (selectedProject.status === 'accepted' ||
      selectedProject.status === 'produced');
  const productionExportDisabled = exportDisabled || !productionExportOk;

  /**
   * Quote "Más" commercial exports only.
   * Factory exports (Optimizer, herrajes, etiquetas, pack) live exclusively
   * in the Producción workspace (PROD-0.2 strengthened).
   */
  const exportMenu = useMemo<{
    readonly sections: readonly DropdownMenuSection[];
    readonly onClose?: () => void;
  }>(() => {
    if (!selectedProject) return { sections: [] };
    const itemsEmpty = selectedProject.items.length === 0;

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
    selectedProject,
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

  const renderList = (): ReactNode => (
    <ProjectsListView
      projects={projects}
      filtered={filtered}
      customers={customers}
      projectTemplates={projectTemplates}
      search={search}
      statusFilter={statusFilter}
      isTrulyEmpty={isTrulyEmpty}
      isFilterEmpty={isFilterEmpty}
      canMutate={canMutate}
      hasCreateFromTemplate={!!onCreateFromTemplate}
      hasDeleteTemplate={!!onDeleteTemplate}
      estimateLabel={estimateLabel}
      onSearchChange={setSearch}
      onStatusFilterChange={setStatusFilter}
      onClearFilters={() => {
        setSearch('');
        setStatusFilter('all');
      }}
      onNewProject={startCreate}
      onFromTemplate={startFromTemplate}
      onManageTemplates={() => setTemplatesManagementOpen(true)}
      onOpenProject={openDetail}
    />
  );

  if (loading) {
    return (
      <section className="catalog-page" aria-label="Cotizaciones">
        <PageLoading label="Cargando cotizaciones…" data-testid="projects-loading" />
      </section>
    );
  }

  return (
    <section className="catalog-page" aria-label="Cotizaciones">
      {selectedProject ? (
        <ProjectDetailView
          project={selectedProject}
          projectEstimates={projectEstimates}
          modules={modules}
          optionGroups={optionGroups}
          catalogs={catalogs}
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
            onUpdateItemQuantity: updateItemQuantity,
            onUpdateItemMeasurePreset: updateItemMeasurePreset,
            onUpdateItemChoice: updateItemChoice,
            onRemoveItem,
            onReorderItems: onReorderItems
              ? (fromIndex, toIndex) => {
                  if (!selectedId) return;
                  onReorderItems(selectedId, fromIndex, toIndex);
                }
              : undefined,
          }}
          removeConfirm={{
            confirmRemoveItemId,
            onRequestRemoveItem: (itemId) => setConfirmRemoveItemId(itemId),
            onCancelRemoveItem: () => setConfirmRemoveItemId(null),
            onConfirmRemoveItem: (projectId, itemId) => {
              onRemoveItem(projectId, itemId);
              setConfirmRemoveItemId(null);
            },
          }}
          updateProjectLevelChoice={updateProjectLevelChoice}
          onUpdateMeasureDefaults={onUpdateMeasureDefaults}
          viewer3D={{
            onOpenQuote3D: () => {
              setViewerItem(null);
              setViewerQuoteRun(true);
              setShow3DModal(true);
            },
            onOpenItem3D: (item, mod) => {
              setViewerQuoteRun(false);
              setViewerItem({ item, mod });
              setShow3DModal(true);
            },
          }}
          itemError={itemError}
          addItemModalOpen={addItemModalOpen}
          onOpenAddItemModal={openAddItemModal}
          onBackToList={backToList}
          onOpenPresentation={() => setShowPresentation(true)}
          onOpenSpatialStudio={
            onUpdateKitchenLayout
              ? () => {
                  setPostAddPlaceCue(false);
                  setSpatialBootstrap(null);
                  setShowSpatialStudio(true);
                }
              : undefined
          }
          postAddPlaceCue={postAddPlaceCue}
          onDismissPostAddPlaceCue={() => setPostAddPlaceCue(false)}
          onOpenSpatialStudioUnplaced={
            onUpdateKitchenLayout ? openSpatialStudioUnplaced : undefined
          }
          onEditMeta={startEditMeta}
          onDuplicate={onDuplicate}
          onSaveAsTemplate={
            canMutate && onSaveAsTemplate
              ? (projectId) => startSaveAsTemplate()
              : undefined
          }
          onMarkProduced={onMarkProduced}
          onChangeStatus={onChangeStatus}
          onRequestReopen={() => setConfirmReopen(true)}
          onRequestDelete={() => setConfirmDelete(true)}
          onUpdateKitchenLayout={onUpdateKitchenLayout}
          onApplyScenarioB={onApplyScenarioB}
          onDuplicateWithScenarioB={onDuplicateWithScenarioB}
          onExportScenarioPdf={onExportScenarioPdf}
          onUpdateInstallationChecklist={onUpdateInstallationChecklist}
          onImportNesting={onImportNesting}
          onUpdateProjectLevelChoices={onUpdateProjectLevelChoices}
          canMutate={canMutate}
          canDelete={canDelete}
          onRestoreVersion={onRestoreVersion ? (version) => onRestoreVersion(selectedProject.id, version) : undefined}
          canReopen={canReopen}
          canForceReopenClosed={canForceReopenClosed}
          canMarkProduced={canMarkProduced}
          projectTemplates={projectTemplates}
        />
      ) : (
        renderList()
      )}

      <ProjectMetaModal
        open={metaModalOpen}
        editingId={metaEditingId}
        initialDraft={metaDraft}
        onClose={closeMetaModal}
        onSubmit={handleSubmitMeta}
        customers={customers}
        canAssignOwner={canAssignOwner}
        assignableOwners={assignableOwners}
        showCosts={showCosts}
        canMutate={canMutate}
        canReopen={canReopen}
        canMarkProduced={canMarkProduced}
      />

      <ProjectAddItemModal
        open={addItemModalOpen}
        onClose={closeAddItemModal}
        onSubmit={handleAddItemSubmit}
        modules={modules}
        categories={categories}
        optionGroups={optionGroups}
        catalogs={catalogs}
        catalogComponents={catalogComponents}
        catalogStructures={catalogStructures}
        projectLevelChoices={selectedProject?.projectLevelChoices ?? {}}
        measureDefaults={selectedProject?.measureDefaults}
      />

      <ProjectConfirmDeleteModal
        open={confirmDelete && selectedProject != null}
        projectName={selectedProject?.name ?? ''}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (selectedProject) handleDelete(selectedProject.id);
        }}
      />

      <ProjectConfirmReopenModal
        open={confirmReopen && selectedProject != null}
        projectName={selectedProject?.name ?? ''}
        onCancel={() => setConfirmReopen(false)}
        onConfirm={() => {
          if (selectedProject && onReopen) {
            onReopen(selectedProject.id);
            setConfirmReopen(false);
          }
        }}
      />

      {selectedProject ? (
        <ProjectPresentationMode
          open={showPresentation}
          project={selectedProject}
          modules={modules}
          customers={customers}
          optionGroups={optionGroups}
          catalog={{
            modules,
            structures: catalogStructures,
            components: catalogComponents,
            materials,
            edges,
            hardware,
            optionGroups,
          }}
          salePrice={
            breakdown?.salePrice ??
            (typeof projectEstimates[selectedProject.id] === 'number'
              ? (projectEstimates[selectedProject.id] as number)
              : null)
          }
          workshopName={workshopSettings?.workshopName}
          resolveMediaUrl={resolveImageUrl}
          onClose={() => setShowPresentation(false)}
          onGoToProyectar={
            onUpdateKitchenLayout
              ? () => {
                  setShowPresentation(false);
                  setShowSpatialStudio(true);
                }
              : undefined
          }
        />
      ) : null}

      {selectedProject && onUpdateKitchenLayout ? (
        <ProjectSpatialStudio
          open={showSpatialStudio}
          project={selectedProject}
          modules={modules}
          catalog={project3dCatalog}
          canEdit={canMutate && selectedProject.status === 'draft'}
          resolveMediaUrl={resolveImageUrl}
          quoteSalePrice={
            breakdown?.salePrice ??
            (typeof projectEstimates[selectedProject.id] === 'number'
              ? (projectEstimates[selectedProject.id] as number)
              : null)
          }
          bootstrap={spatialBootstrap}
          onRequestAddItem={
            canMutate && selectedProject.status === 'draft'
              ? openAddItemModal
              : undefined
          }
          planActor={planActor}
          onAcquirePlanEdit={
            planActor && onAcquirePlanEdit ? handleAcquirePlanEdit : undefined
          }
          onRenewPlanEdit={
            planActor && onRenewPlanEdit ? handleRenewPlanEdit : undefined
          }
          onReleasePlanEdit={
            planActor && onReleasePlanEdit ? handleReleasePlanEdit : undefined
          }
          onClose={() => {
            setShowSpatialStudio(false);
            setSpatialBootstrap(null);
          }}
          onChangeLayout={(layout) =>
            onUpdateKitchenLayout(selectedProject.id, layout)
          }
          onUpdateItem={
            canMutate && selectedProject.status === 'draft'
              ? (item) => onUpdateItem(selectedProject.id, item)
              : undefined
          }
        />
      ) : null}

      <Project3DModal
        open={show3DModal}
        project={selectedProject}
        catalog={project3dCatalog}
        resolveMediaUrl={resolveImageUrl}
        focus={
          viewerQuoteRun || !viewerItem
            ? null
            : { item: viewerItem.item, module: viewerItem.mod }
        }
        onClose={() => {
          setShow3DModal(false);
          setViewerItem(null);
          setViewerQuoteRun(false);
        }}
      />

      {/* Project templates (#110 / H15) */}
      <ProjectTemplatePickerModal
        open={templatePickerOpen}
        templates={projectTemplates ?? []}
        customers={customers}
        workshopSettings={workshopSettings}
        onClose={() => setTemplatePickerOpen(false)}
        onConfirm={confirmFromTemplate}
      />

      <ProjectSaveAsTemplateModal
        open={saveAsTemplateOpen}
        initialName={selectedProject?.name ?? ''}
        onClose={() => setSaveAsTemplateOpen(false)}
        onConfirm={(name) => {
          if (selectedProject) {
            onSaveAsTemplate?.(selectedProject.id, name);
            setSaveAsTemplateOpen(false);
          }
        }}
      />

      <ProjectTemplatesManagementModal
        open={templatesManagementOpen}
        templates={projectTemplates ?? []}
        onClose={() => setTemplatesManagementOpen(false)}
        onDeleteTemplate={requestDeleteTemplate}
      />
    </section>
  );
}
