/**
 * Projects list + quotation detail — cards + Modal MD (F022).
 * Cost formulas live in the shell; this component only renders breakdown props.
 */

import {
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
  ProjectTemplate,
  QuoteBreakdown,
  Structure,
  WorkshopSettings,
} from '@muebles/domain';
import {
  FileText,
  LayoutTemplate,
  Package,
  Plus,
  SearchX,
} from 'lucide-react';
import {
  type DropdownMenuSection,
  EmptyState,
  PageLoading,
  SearchInput,
  useDebouncedValue,
} from '../common';
import '../catalogs/catalogs.css';
import { ExportIssueList } from './ExportIssueList';
import { Project3DModal } from './components/Project3DModal';
import { ProjectPresentationMode } from './components/ProjectPresentationMode';
import { ProjectDetailView } from './components/ProjectDetailView';
import { StatusBadge } from './components/StatusBadge';
import { ProjectAddItemModal } from './components/ProjectAddItemModal';
import { ProjectConfirmDeleteModal } from './components/ProjectConfirmDeleteModal';
import { ProjectConfirmReopenModal } from './components/ProjectConfirmReopenModal';
import { ProjectMetaModal } from './components/ProjectMetaModal';
import { ProjectSaveAsTemplateModal } from './components/ProjectSaveAsTemplateModal';
import { ProjectTemplatePickerModal } from './components/ProjectTemplatePickerModal';
import { ProjectTemplatesManagementModal } from './components/ProjectTemplatesManagementModal';
import {
  emptyProjectDraft,
  filterProjectsByQuery,
  formatIsoDate,
  formatProjectMoney,
  projectToDraft,
  resolveCustomerName,
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
  /** Kitchen plan walls + placements (#133). */
  readonly onUpdateKitchenLayout?: (
    projectId: string,
    layout: import('@muebles/domain').ProjectKitchenLayout,
  ) => void;
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
   * Hardware purchase-list export (F013 / EXP-08).
   * Shell owns validate → aggregate → xlsx → download.
   */
  readonly onExportHardware?: () => void | Promise<void>;
  /**
   * Piece labels PDF with edge-banding instruction (F046 / #96).
   * Shell owns validate → labels → PDF → download.
   */
  readonly onExportPieceLabels?: () => void | Promise<void>;
  /** Pack ZIP: Optimizer + herrajes + etiquetas (#134). */
  readonly onExportProductionPack?: () => void | Promise<void>;
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
  /** F036: mark accepted → produced (click-only). */
  readonly canMarkProduced?: boolean;
  /** Shell applies status transition (snapshot rules). */
  readonly onMarkProduced?: (projectId: string) => void;
  readonly onReopen?: (projectId: string) => void;
  /** F039: hide margin and cost breakdown. */
  readonly showCosts?: boolean;
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
  onUpdateKitchenLayout,
  onApplyScenarioB,
  onDuplicateWithScenarioB,
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
  onExportHardware,
  onExportPieceLabels,
  onExportProductionPack,
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
  canMarkProduced = false,
  onMarkProduced,
  onReopen,
  showCosts = true,
}: ProjectsScreenProps): ReactNode {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
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
    () => filterProjectsByQuery(projects, debouncedSearch, customers),
    [projects, debouncedSearch, customers],
  );

  const selectedProject =
    selectedId !== null
      ? (projects.find((p) => p.id === selectedId) ?? null)
      : null;

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

  // Open create modal from shell (Dashboard quick action)
  useEffect(() => {
    if (!requestCreateKey) return;
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
   * Build the "Más exports ▾" menu sections from available callbacks (Fase 2 UI).
   * Items render only when their prop is defined; the shell decides which
   * exports apply per role (production-only exports are undefined for
   * vendedor; commercial exports are undefined for produccion).
   */
  const exportMenu = useMemo<{
    readonly sections: readonly DropdownMenuSection[];
    readonly onClose?: () => void;
  }>(() => {
    if (!selectedProject) return { sections: [] };
    const itemsEmpty = selectedProject.items.length === 0;

    const productionItems = [
      onExportHardware
        ? {
            id: 'hardware',
            label: 'Lista de herrajes',
            hint: 'Para compras (.xlsx)',
            disabled: productionExportDisabled,
            onSelect: () => void onExportHardware(),
          }
        : null,
      onExportPieceLabels
        ? {
            id: 'labels',
            label: 'Etiquetas',
            hint: 'Pieza + encintado (PDF)',
            disabled: productionExportDisabled,
            onSelect: () => void onExportPieceLabels(),
          }
        : null,
      onExportProductionPack
        ? {
            id: 'pack',
            label: 'Pack producción',
            hint: 'ZIP (Optimizer + herrajes + etiquetas)',
            disabled: productionExportDisabled,
            onSelect: () => void onExportProductionPack(),
          }
        : null,
    ].filter((x): x is NonNullable<typeof x> => x !== null);

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

    const sections: DropdownMenuSection[] = [];
    if (productionItems.length > 0) {
      sections.push({
        id: 'production',
        label: 'Producción',
        items: productionItems,
      });
    }
    if (commercialItems.length > 0) {
      sections.push({
        id: 'commercial',
        label: 'Comercial',
        items: commercialItems,
      });
    }
    return { sections };
  }, [
    selectedProject,
    onExportHardware,
    onExportPieceLabels,
    onExportProductionPack,
    onExportCommercialQuote,
    onExportCommercialQuotePdf,
    productionExportDisabled,
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
    <>
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Cotizaciones</h2>
        <div className="catalog-page__toolbar">
          {canMutate ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={startCreate}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nueva cotización
          </button>
          ) : null}
          {canMutate &&
          projectTemplates &&
          projectTemplates.length > 0 &&
          onCreateFromTemplate ? (
            <button
              type="button"
              className="btn"
              onClick={startFromTemplate}
              data-testid="new-from-template-btn"
            >
              <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
              Desde plantilla
            </button>
          ) : null}
          {canMutate &&
          projectTemplates &&
          projectTemplates.length > 0 &&
          onDeleteTemplate ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setTemplatesManagementOpen(true)}
              data-testid="manage-templates-btn"
              title="Gestionar plantillas"
            >
              <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
              Plantillas
            </button>
          ) : null}
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar cotizaciones o clientes…"
            aria-label="Buscar cotizaciones"
          />
        </div>
      ) : null}

      {isTrulyEmpty ? (
        <div>
          <EmptyState
            icon={FileText}
            title="No hay cotizaciones"
            description="Creá la primera cotización para un cliente y agregá muebles del catálogo."
            actionLabel="Nueva cotización"
            onAction={startCreate}
          />
          {canMutate &&
          projectTemplates &&
          projectTemplates.length > 0 &&
          onCreateFromTemplate ? (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn"
                onClick={startFromTemplate}
                data-testid="empty-from-template-btn"
              >
                <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
                Crear desde plantilla
              </button>
            </div>
          ) : null}
        </div>
      ) : isFilterEmpty ? (
        <EmptyState
          variant="no-results"
          icon={SearchX}
          title="Sin resultados"
          description="No hay cotizaciones que coincidan con la búsqueda."
          actionLabel="Limpiar filtros"
          onAction={() => setSearch('')}
        />
      ) : (
        <ul className="project-card-grid" aria-label="Lista de cotizaciones">
          {filtered.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="project-card"
                onClick={() => openDetail(project)}
                data-testid={`project-card-${project.id}`}
              >
                <div className="project-card__top">
                  <h3 className="project-card__name">{project.name}</h3>
                  <StatusBadge status={project.status} />
                </div>
                <p className="project-card__client">
                  {resolveCustomerName(project.customerId, customers)}
                </p>
                <div className="project-card__stats">
                  <span className="project-card__stat">
                    <Package size={14} strokeWidth={1.5} aria-hidden />
                    {project.items.length} mueble
                    {project.items.length === 1 ? '' : 's'}
                  </span>
                  <span className="project-card__stat">
                    Act. {formatIsoDate(project.updatedAt)}
                  </span>
                </div>
                <div className="project-card__price">
                  <span className="project-card__price-label">
                    Precio total
                  </span>
                  {estimateLabel(project.id)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
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
          itemHandlers={{
            onUpdateItemQuantity: updateItemQuantity,
            onUpdateItemMeasurePreset: updateItemMeasurePreset,
            onUpdateItemChoice: updateItemChoice,
            onRemoveItem,
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
          onEditMeta={startEditMeta}
          onDuplicate={onDuplicate}
          onSaveAsTemplate={
            canMutate && onSaveAsTemplate
              ? (projectId) => startSaveAsTemplate()
              : undefined
          }
          onMarkProduced={onMarkProduced}
          onRequestReopen={() => setConfirmReopen(true)}
          onRequestDelete={() => setConfirmDelete(true)}
          onUpdateKitchenLayout={onUpdateKitchenLayout}
          onApplyScenarioB={onApplyScenarioB}
          onDuplicateWithScenarioB={onDuplicateWithScenarioB}
          onUpdateInstallationChecklist={onUpdateInstallationChecklist}
          onImportNesting={onImportNesting}
          onUpdateProjectLevelChoices={onUpdateProjectLevelChoices}
          canMutate={canMutate}
          canDelete={canDelete}
          canReopen={canReopen}
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
          onClose={() => setShowPresentation(false)}
        />
      ) : null}

      <Project3DModal
        open={show3DModal}
        project={selectedProject}
        catalog={project3dCatalog}
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
