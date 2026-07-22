/**
 * Projects list + quotation detail — cards + Modal MD (F022).
 * Cost formulas live in the shell; this component only renders breakdown props.
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
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
  cascadeOptions,
  cascadeSelectedCategoryId,
  effectiveOptionChoices,
  estimateBoardSheets,
  parseNestingImportCsv,
  nestingImportFromRows,
  filterModulesByCategory,
  isProjectClosed,
  pickPresetByMeasureDefaults,
  type CategoryFilterId,
} from '@muebles/domain';
import {
  AlertCircle,
  ChevronLeft,
  Copy,
  FileText,
  LayoutTemplate,
  Package,
  Pencil,
  Plus,
  SearchX,
  Trash2,
  Box,
} from 'lucide-react';
import { CatalogPicker } from '../catalogs/CatalogPicker';
import {
  DropdownMenu,
  type DropdownMenuSection,
  EmptyState,
  InlineLoading,
  Modal,
  PageLoading,
  SearchInput,
  useDebouncedValue,
} from '../common';
import '../catalogs/catalogs.css';
import { PricePreviewGate } from '../optionGroups/PricePreviewGate';
import { ExportIssueList } from './ExportIssueList';
import { Project3DModal } from './components/Project3DModal';
import { KitchenPlanPanel } from './components/KitchenPlanPanel';
import { ProjectPresentationMode } from './components/ProjectPresentationMode';
import { QuoteScenarioCompare } from './components/QuoteScenarioCompare';
import { InstallationChecklistPanel } from './components/InstallationChecklistPanel';
import { ProjectItemStructureRevisionIndicator } from './components/ProjectItemStructureRevisionIndicator';
import { StatusBadge } from './components/StatusBadge';
import { ProjectConfirmDeleteModal } from './components/ProjectConfirmDeleteModal';
import { ProjectConfirmReopenModal } from './components/ProjectConfirmReopenModal';
import { ProjectSaveAsTemplateModal } from './components/ProjectSaveAsTemplateModal';
import { ProjectTemplatesManagementModal } from './components/ProjectTemplatesManagementModal';
import {
  customersForProjectPicker,
  defaultChoicesForNewItem,
  emptyAddItemDraft,
  emptyProjectDraft,
  filterProjectsByQuery,
  formatIsoDate,
  formatProjectMoney,
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  projectStatusLabel,
  statusOptionsForRole,
  projectToDraft,
  resolveCustomerName,
  setItemOptionChoice,
  setProjectLevelChoice,
  furnitureTypeLabel,
  validateItemQuantity,
  validateProjectDraft,
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
  const metaFormId = useId();
  const addItemFormId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addCategoryL1, setAddCategoryL1] = useState('');
  const [addCategoryL2, setAddCategoryL2] = useState('');
  const [addCategoryL3, setAddCategoryL3] = useState('');
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaEditingId, setMetaEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>(() =>
    emptyProjectDraft(workshopSettings),
  );
  /** When true, meta form uses free-text name to create a customer on submit. */
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [addItem, setAddItem] = useState<AddItemDraft>(() =>
    emptyAddItemDraft(modules, optionGroups),
  );
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
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [fromTemplateDraft, setFromTemplateDraft] = useState<ProjectTemplate | null>(null);
  const [fromTemplateName, setFromTemplateName] = useState('');
  const [fromTemplateCustomer, setFromTemplateCustomer] = useState('');
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
    setDraft(emptyProjectDraft(workshopSettings));
    setNewCustomerMode(false);
    setError(null);
    setMetaModalOpen(true);
  }, [requestCreateKey]);

  // If selected project disappears (delete), return to list
  useEffect(() => {
    if (selectedId && !projects.some((p) => p.id === selectedId)) {
      setSelectedId(null);
      setConfirmDelete(false);
    }
  }, [projects, selectedId]);

  useEffect(() => {
    setAddItem((prev) => {
      if (prev.moduleId && modules.some((m) => m.id === prev.moduleId)) {
        return prev;
      }
      return emptyAddItemDraft(modules, optionGroups);
    });
  }, [modules, optionGroups]);

  const closeMetaModal = () => {
    setMetaModalOpen(false);
    setMetaEditingId(null);
    setDraft(emptyProjectDraft(workshopSettings));
    setNewCustomerMode(false);
    setError(null);
  };

  const closeAddItemModal = () => {
    setAddItemModalOpen(false);
    setAddItem(emptyAddItemDraft(modules, optionGroups));
    setAddCategoryL1('');
    setAddCategoryL2('');
    setAddCategoryL3('');
    setItemError(null);
  };

  const addItemCategoryFilter: CategoryFilterId = useMemo(() => {
    const id = cascadeSelectedCategoryId({
      level1Id: addCategoryL1 || undefined,
      level2Id: addCategoryL2 || undefined,
      level3Id: addCategoryL3 || undefined,
    });
    return id ?? null;
  }, [addCategoryL1, addCategoryL2, addCategoryL3]);

  const addCascadeOpts = useMemo(
    () =>
      cascadeOptions(categories, {
        level1Id: addCategoryL1 || undefined,
        level2Id: addCategoryL2 || undefined,
        level3Id: addCategoryL3 || undefined,
      }),
    [categories, addCategoryL1, addCategoryL2, addCategoryL3],
  );

  const modulesForAdd = useMemo(
    () =>
      filterModulesByCategory(modules, addItemCategoryFilter, categories),
    [modules, addItemCategoryFilter, categories],
  );

  const startCreate = () => {
    setMetaEditingId(null);
    setDraft(emptyProjectDraft(workshopSettings));
    setNewCustomerMode(false);
    setError(null);
    setMetaModalOpen(true);
  };

  // --- Project templates (#110 / H15) ---

  const startFromTemplate = () => {
    if (!projectTemplates || projectTemplates.length === 0) return;
    setFromTemplateDraft(null);
    setFromTemplateName('');
    setFromTemplateCustomer('');
    setError(null);
    setTemplatePickerOpen(true);
  };

  const pickTemplate = (template: ProjectTemplate) => {
    setFromTemplateDraft(template);
    setFromTemplateName(`${template.name}`);
    setFromTemplateCustomer('');
  };

  const confirmFromTemplate = (e: FormEvent) => {
    e.preventDefault();
    if (!fromTemplateDraft || !onCreateFromTemplate) return;
    const name = fromTemplateName.trim();
    if (!name) {
      setError('Elegí un nombre para la cotización.');
      return;
    }
    const customerId = fromTemplateCustomer.trim();
    if (!customerId) {
      setError('Elegí un cliente.');
      return;
    }
    // Reuse ProjectDraft shape so the shell handles currency/margin/labor via
    // the same path as createProject. Name + customerId are the template picks.
    const payload: ProjectDraft = {
      ...emptyProjectDraft(workshopSettings),
      name,
      customerId,
      currency: fromTemplateDraft.currency,
      marginFactor: String(fromTemplateDraft.marginFactor),
      laborFixedCost: String(fromTemplateDraft.laborFixedCost),
      notes: fromTemplateDraft.notes ?? '',
      status: 'draft',
    };
    setError(null);
    onCreateFromTemplate(fromTemplateDraft.id, payload);
    setTemplatePickerOpen(false);
    setFromTemplateDraft(null);
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
    setDraft(projectToDraft(project, customers));
    setNewCustomerMode(false);
    setError(null);
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

  const handleSubmitMeta = (e: FormEvent) => {
    e.preventDefault();
    const payload: ProjectDraft = newCustomerMode
      ? {
          ...draft,
          customerId: '',
          customerName: (draft.customerName ?? '').trim(),
        }
      : {
          ...draft,
          customerId: draft.customerId.trim(),
          customerName: '',
        };
    const err = validateProjectDraft(payload);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (metaEditingId) {
      onUpdate(metaEditingId, payload);
    } else {
      onCreate(payload);
    }
    closeMetaModal();
  };

  const pickerCustomers = customersForProjectPicker(
    customers,
    draft.customerId,
  );

  const openAddItemModal = () => {
    setAddItem(emptyAddItemDraft(modules, optionGroups));
    setItemError(null);
    setAddItemModalOpen(true);
  };

  const selectModuleForAdd = (moduleId: string) => {
    const mod = modules.find((m) => m.id === moduleId);
    // Prefill only groups without a project-level default (F029 inherit).
    const seeded = mod ? defaultChoicesForNewItem(mod, optionGroups) : {};
    const projectLevel = selectedProject?.projectLevelChoices ?? {};
    const optionChoices: Record<string, string> = {};
    for (const [code, id] of Object.entries(seeded)) {
      if (!projectLevel[code]?.trim()) {
        optionChoices[code] = id;
      }
    }
    setAddItem({
      moduleId,
      quantity: addItem.quantity || 1,
      optionChoices,
      measurePresetId: mod
        ? pickPresetByMeasureDefaults(mod, selectedProject?.measureDefaults)
        : undefined,
    });
  };

  const handleAddItem = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId || !selectedProject) return;

    const qtyErr = validateItemQuantity(addItem.quantity);
    if (qtyErr) {
      setItemError(qtyErr);
      return;
    }
    if (!addItem.moduleId) {
      setItemError('Elegí un mueble del catálogo.');
      return;
    }
    const mod = modules.find((m) => m.id === addItem.moduleId);
    if (!mod) {
      setItemError('El mueble seleccionado no existe en el catálogo.');
      return;
    }

    const groups = groupsForModuleItem(mod, optionGroups);
    const effective = effectiveOptionChoices(
      addItem.optionChoices,
      selectedProject.projectLevelChoices,
    );
    for (const group of groups) {
      if (!effective[group.code]) {
        setItemError(`Falta elegir: ${group.name} (${group.code}).`);
        return;
      }
    }

    if ((mod.presets?.length ?? 0) > 0) {
      const presetOk = mod.presets!.some((p) => p.id === addItem.measurePresetId);
      if (!presetOk) {
        setItemError('Elegí un preset de medida válido para este mueble.');
        return;
      }
    }

    setItemError(null);
    onAddItem(selectedId, {
      moduleId: addItem.moduleId,
      quantity: addItem.quantity,
      optionChoices: addItem.optionChoices,
      measurePresetId: addItem.measurePresetId,
    });
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

  /**
   * Merge a partial measure default (per furnitureType, depth/height) into the
   * project's measureDefaults (#109). Empty values clear the dimension; a type
   * with no remaining dims is dropped; an empty map clears the whole field.
   */
  const updateMeasureDefaults = (
    type: FurnitureType,
    field: 'depth' | 'height',
    value: string,
  ) => {
    if (!selectedId || !selectedProject || !onUpdateMeasureDefaults) return;
    const prev = { ...(selectedProject.measureDefaults ?? {}) } as Record<
      FurnitureType,
      { depth?: number; height?: number } | undefined
    >;
    const typeEntry = prev[type] ? { ...prev[type]! } : {};
    const parsed = value.trim() === '' ? undefined : Number(value);
    if (field === 'depth') {
      if (parsed === undefined || Number.isNaN(parsed)) delete typeEntry.depth;
      else typeEntry.depth = parsed;
    } else {
      if (parsed === undefined || Number.isNaN(parsed)) delete typeEntry.height;
      else typeEntry.height = parsed;
    }
    if (typeEntry.depth === undefined && typeEntry.height === undefined) {
      delete prev[type];
    } else {
      prev[type] = typeEntry;
    }
    const hasAny = (Object.keys(prev) as FurnitureType[]).some(
      (k) => prev[k] !== undefined,
    );
    onUpdateMeasureDefaults(
      selectedId,
      hasAny ? (prev as Project['measureDefaults']) : undefined,
    );
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

  const addModule = modules.find((m) => m.id === addItem.moduleId);
  const addGroups = groupsForModuleItem(addModule, optionGroups);

  const renderMetaForm = (): ReactNode => (
    <form
      id={metaFormId}
      className="catalog-form catalog-form--wide project-meta-form"
      onSubmit={handleSubmitMeta}
    >
      {error ? <p className="catalog-form__error">{error}</p> : null}
      <div className="project-editor__grid">
        <div className="catalog-form__field">
          <label htmlFor="prj-name">Nombre</label>
          <input
            id="prj-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
            autoComplete="off"
          />
        </div>
        <div className="catalog-form__field">
          {newCustomerMode ? (
            <>
              <label htmlFor="prj-client">Cliente</label>
              <input
                id="prj-client"
                value={draft.customerName ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    customerId: '',
                    customerName: e.target.value,
                  })
                }
                placeholder="Nombre del nuevo cliente"
                autoComplete="organization"
              />
            </>
          ) : (
            <CatalogPicker
              id="prj-client"
              label="Cliente"
              placeholder="Seleccionar cliente…"
              searchPlaceholder="Buscar cliente…"
              value={draft.customerId}
              onChange={(customerId) =>
                setDraft({
                  ...draft,
                  customerId,
                  customerName: '',
                })
              }
              items={pickerCustomers.map((c) => ({
                id: c.id,
                code: '',
                name: c.name,
                active: c.active,
                subtitle: c.email || undefined,
              }))}
              data-testid="project-customer-picker"
            />
          )}
          <div className="catalog-form__field catalog-form__row-check">
            <input
              id="prj-new-client"
              type="checkbox"
              checked={newCustomerMode}
              onChange={(e) => {
                const next = e.target.checked;
                setNewCustomerMode(next);
                setDraft({
                  ...draft,
                  customerId: next ? '' : draft.customerId,
                  customerName: next ? (draft.customerName ?? '') : '',
                });
              }}
            />
            <label htmlFor="prj-new-client">Nuevo cliente</label>
          </div>
        </div>
        <div className="catalog-form__field">
          <label htmlFor="prj-currency">Moneda</label>
          <input
            id="prj-currency"
            value={draft.currency}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
            required
          />
        </div>
        {showCosts ? (
          <>
            <div className="catalog-form__field">
              <label htmlFor="prj-margin">Factor de margen</label>
              <input
                id="prj-margin"
                type="number"
                min={0.01}
                step="any"
                value={draft.marginFactor}
                onChange={(e) =>
                  setDraft({ ...draft, marginFactor: e.target.value })
                }
                required
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="prj-labor">Mano de obra fija</label>
              <input
                id="prj-labor"
                type="number"
                min={0}
                step="any"
                value={draft.laborFixedCost}
                onChange={(e) =>
                  setDraft({ ...draft, laborFixedCost: e.target.value })
                }
                required
              />
            </div>
          </>
        ) : null}
        <div className="catalog-form__field">
          <label htmlFor="prj-status">Estado</label>
          <select
            id="prj-status"
            value={draft.status}
            onChange={(e) =>
              setDraft({
                ...draft,
                status: e.target.value as ProjectDraft['status'],
              })
            }
          >
            {statusOptionsForRole({
              current: draft.status,
              canMutate,
              canReopen,
              canMarkProduced,
            }).map((s) => (
              <option key={s} value={s}>
                {projectStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {canAssignOwner && assignableOwners.length > 0 ? (
        <div
          className="catalog-form__field"
          style={{ marginTop: 'var(--space-3)' }}
        >
          <label htmlFor="prj-owner">Responsable</label>
          <select
            id="prj-owner"
            value={draft.ownerUserId}
            onChange={(e) =>
              setDraft({ ...draft, ownerUserId: e.target.value })
            }
            data-testid="project-owner-select"
          >
            {assignableOwners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.role ? ` (${u.role})` : ''}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="catalog-form__field" style={{ marginTop: 'var(--space-3)' }}>
        <label htmlFor="prj-notes">Notas</label>
        <input
          id="prj-notes"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </div>
    </form>
  );

  const renderAddItemForm = (): ReactNode => (
    <form
      id={addItemFormId}
      className="catalog-form catalog-form--wide project-add-item-form"
      onSubmit={handleAddItem}
    >
      {itemError ? <p className="catalog-form__error">{itemError}</p> : null}
      {categories.length > 0 ? (
        <div
          className="project-editor__grid"
          data-testid="add-item-category-cascade"
          style={{ marginBottom: 'var(--space-3)' }}
        >
          <div className="catalog-form__field">
            <label htmlFor="add-cat-l1">Categoría</label>
            <select
              id="add-cat-l1"
              value={addCategoryL1}
              onChange={(e) => {
                setAddCategoryL1(e.target.value);
                setAddCategoryL2('');
                setAddCategoryL3('');
              }}
            >
              <option value="">Todas</option>
              {addCascadeOpts.level1.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {addCascadeOpts.level2.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="add-cat-l2">Subcategoría</label>
              <select
                id="add-cat-l2"
                value={addCategoryL2}
                onChange={(e) => {
                  setAddCategoryL2(e.target.value);
                  setAddCategoryL3('');
                }}
              >
                <option value="">Todas en nivel 1</option>
                {addCascadeOpts.level2.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {addCascadeOpts.level3.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="add-cat-l3">Nivel 3</label>
              <select
                id="add-cat-l3"
                value={addCategoryL3}
                onChange={(e) => setAddCategoryL3(e.target.value)}
              >
                <option value="">Todas en nivel 2</option>
                {addCascadeOpts.level3.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="project-editor__grid">
        <div className="catalog-form__field">
          <CatalogPicker
            id="add-module"
            label="Mueble"
            placeholder={
              modulesForAdd.length === 0
                ? 'Sin muebles en este filtro'
                : 'Seleccionar mueble…'
            }
            searchPlaceholder="Buscar mueble…"
            value={
              modulesForAdd.some((m) => m.id === addItem.moduleId)
                ? addItem.moduleId
                : ''
            }
            onChange={(moduleId) => {
              if (moduleId) selectModuleForAdd(moduleId);
            }}
            items={modulesForAdd.map((m) => ({
              id: m.id,
              code: m.code,
              name: m.name,
              active: true,
            }))}
            disabled={modulesForAdd.length === 0}
            data-testid="add-item-module-picker"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor="add-qty">Cantidad</label>
          <input
            id="add-qty"
            type="number"
            min={1}
            step={1}
            value={addItem.quantity}
            onChange={(e) =>
              setAddItem({
                ...addItem,
                quantity: Number(e.target.value),
              })
            }
          />
        </div>
        {addModule && (addModule.presets?.length ?? 0) > 0 ? (
          <div className="catalog-form__field">
            <label htmlFor="add-measure-preset">Medida</label>
            <select
              id="add-measure-preset"
              value={addItem.measurePresetId ?? ''}
              onChange={(e) =>
                setAddItem({
                  ...addItem,
                  measurePresetId: e.target.value || undefined,
                })
              }
              data-testid="add-item-measure-preset"
            >
              <option value="">Elegí medida…</option>
              {addModule.presets!.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name?.trim()
                    ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth} mm)`
                    : `${pr.width}×${pr.height}×${pr.depth} mm`}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {addGroups.length === 0 ? (
        <p className="catalog-empty" style={{ marginTop: 'var(--space-3)' }}>
          Este mueble no tiene grupos de opción requeridos.
        </p>
      ) : (
        <div className="project-item-choices" style={{ marginTop: 'var(--space-3)' }}>
          {addGroups.map((group) => {
            const options = optionsForGroup(group, catalogs);
            const projectDefault =
              selectedProject?.projectLevelChoices?.[group.code]?.trim() ?? '';
            const inheritLabel = projectDefault
              ? `Usar default del proyecto (${optionLabelForId(projectDefault, group, catalogs)})`
              : 'Usar default del proyecto';
            return (
              <div key={group.id} className="catalog-form__field">
                <label htmlFor={`add-choice-${group.code}`}>
                  {group.name} ({group.code})
                </label>
                <select
                  id={`add-choice-${group.code}`}
                  value={addItem.optionChoices[group.code] ?? ''}
                  onChange={(e) =>
                    setAddItem({
                      ...addItem,
                      optionChoices: setItemOptionChoice(
                        addItem.optionChoices,
                        group.code,
                        e.target.value,
                      ),
                    })
                  }
                >
                  <option value="">{inheritLabel}</option>
                  {options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name} — {opt.code}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
      <p className="project-editor__hint">
        Vacío = hereda el default del proyecto. Podés agregar el mismo mueble
        más de una vez con distintas opciones.
      </p>
    </form>
  );

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

  const renderDetail = (project: Project): ReactNode => {
    const saleEstimate = projectEstimates[project.id];
    const chromeSale =
      breakdown?.salePrice ??
      (typeof saleEstimate === 'number' ? saleEstimate : null);

    return (
    <div className="project-detail" data-testid="project-detail">
      {/* Sticky tool chrome: status + total + primary export stay visible while scrolling */}
      <header
        className="workspace-chrome"
        data-testid="project-detail-chrome"
      >
        <div className="workspace-chrome__lead">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={backToList}
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
            Lista
          </button>
          <div className="workspace-chrome__identity">
            <div className="workspace-chrome__title-row">
              <h2 className="workspace-chrome__title">{project.name}</h2>
              <StatusBadge status={project.status} />
            </div>
            <p className="workspace-chrome__subtitle">
              {resolveCustomerName(project.customerId, customers)}
              <span className="workspace-chrome__dot" aria-hidden>
                ·
              </span>
              {project.items.length} mueble
              {project.items.length === 1 ? '' : 's'}
              <span className="workspace-chrome__dot" aria-hidden>
                ·
              </span>
              {project.currency}
              {showCosts ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>
                    ·
                  </span>
                  Margen ×{project.marginFactor.toFixed(2)}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="workspace-chrome__total" data-testid="project-detail-total">
          <span className="workspace-chrome__total-label">Precio de venta</span>
          <span
            className={
              chromeSale == null
                ? 'workspace-chrome__total-value workspace-chrome__total-value--muted'
                : 'workspace-chrome__total-value'
            }
          >
            {chromeSale == null
              ? '—'
              : formatProjectMoney(chromeSale, project.currency)}
          </span>
        </div>
        <div className="workspace-chrome__actions">
          {/*
            Chrome — agrupación Fase 2 UI (design.md §6.2):
              1) Exportar Optimizer (primary): el más usado en planta. Visible
                 solo si el callback está presente y la acción está habilitada
                 (rol + status + no bloqueado). En otro caso se va al menú.
              2) Más exports ▾ (DropdownMenu): los 6 exports restantes, agrupados
                 por Producción / Comercial. Cada ítem con su propio disabled.
              3) Presentar, Editar/Duplicar/Guardar plantilla, Marcar en
                 producción, Reabrir, Eliminar — directos (estados/CRUD).
          */}
          {onExport ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={productionExportDisabled}
              title={
                !productionExportOk
                  ? 'Export de producción solo en Aceptado o En producción'
                  : 'Exportar cut-list Optimizer (.xlsx)'
              }
              onClick={() => {
                void onExport?.();
              }}
              data-testid="project-chrome-export"
            >
              {exportBusy ? 'Exportando…' : 'Exportar Optimizer'}
            </button>
          ) : null}
          {exportMenu.sections.length > 0 ? (
            <DropdownMenu
              ariaLabel="Más exports"
              triggerLabel={exportBusy ? 'Exportando…' : 'Más exports'}
              triggerClassName="btn"
              disabled={exportBusy}
              sections={exportMenu.sections}
              onClose={exportMenu.onClose}
            />
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => setShowPresentation(true)}
            data-testid="project-chrome-present"
            title="Modo presentación para el cliente (sin costos ni exports de planta)"
          >
            Presentar
          </button>
          {canMutate ? (
          <button
            type="button"
            className="btn"
            onClick={() => startEditMeta(project)}
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden />
            Editar
          </button>
          ) : null}
          {canMutate && onDuplicate ? (
            <button
              type="button"
              className="btn"
              onClick={() => onDuplicate(project.id)}
            >
              <Copy size={16} strokeWidth={1.5} aria-hidden />
              Duplicar
            </button>
          ) : null}
          {canMutate && onSaveAsTemplate ? (
            <button
              type="button"
              className="btn"
              onClick={startSaveAsTemplate}
              data-testid={`save-as-template-btn-${project.id}`}
            >
              <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
              Guardar como plantilla
            </button>
          ) : null}
          {canMarkProduced &&
          project.status === 'accepted' &&
          onMarkProduced ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onMarkProduced(project.id)}
              data-testid="project-mark-produced"
            >
              Marcar en producción
            </button>
          ) : null}
          {canReopen &&
          (project.status === 'quoted' ||
            project.status === 'accepted' ||
            project.status === 'produced') &&
          onReopen ? (
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmReopen(true)}
              data-testid="project-reopen"
            >
              Reabrir a borrador
            </button>
          ) : null}
          {canDelete ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            Eliminar
          </button>
          ) : null}
        </div>
      </header>

      {project.ownerUserId ? (
        <p className="project-detail__notes" data-testid="project-owner-label">
          Responsable:{' '}
          {ownerLabels[project.ownerUserId] || project.ownerUserId}
        </p>
      ) : null}
      {project.notes ? (
        <p className="project-detail__notes">{project.notes}</p>
      ) : null}

      <div className="project-detail__body">
        {/*
          Single main column (options + items) so the 2-col grid stays:
          main | totals — never three siblings (that pushed totals down).
        */}
        <div className="project-detail__main">
        {optionGroups.length > 0 && onUpdateProjectLevelChoices ? (
          <section
            className="project-detail__section project-level-options"
            aria-label="Opciones del proyecto"
            data-testid="project-level-options"
          >
            <div className="project-detail__section-header">
              <h3 className="project-detail__section-title">
                Opciones del proyecto
              </h3>
            </div>
            <p className="project-editor__hint">
              Defaults de cotización. Cada mueble las hereda salvo que
              overridees en la línea.
            </p>
            <div className="project-item-choices">
              {optionGroups.map((group) => {
                const options = optionsForGroup(group, catalogs);
                return (
                  <div key={group.id} className="catalog-form__field">
                    <label htmlFor={`project-level-${group.code}`}>
                      {group.name} ({group.code})
                    </label>
                    <select
                      id={`project-level-${group.code}`}
                      value={
                        project.projectLevelChoices?.[group.code] ?? ''
                      }
                      onChange={(e) =>
                        updateProjectLevelChoice(group.code, e.target.value)
                      }
                      data-testid={`project-level-choice-${group.code}`}
                    >
                      <option value="">Sin default</option>
                      {options.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name} — {opt.code}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {onUpdateMeasureDefaults && !isProjectClosed(project.status) ? (
          (() => {
            // Render one row per furnitureType actually used by the catalog.
            const typesInUse = Array.from(
              new Set(
                modules.map((m) => m.furnitureType ?? 'inferior'),
              ),
            ) as FurnitureType[];
            if (typesInUse.length === 0) return null;
            const labels: Record<FurnitureType, string> = {
              inferior: 'Inferiores (gabinetes)',
              superior: 'Superiores (alacenas)',
              alto: 'Altos (despensas)',
            };
            return (
              <section
                className="project-detail__section project-measure-defaults"
                aria-label="Parámetros de medida del proyecto"
                data-testid="project-measure-defaults"
              >
                <div className="project-detail__section-header">
                  <h3 className="project-detail__section-title">
                    Parámetros de medida
                  </h3>
                </div>
                <p className="project-editor__hint">
                  Defaults de fondo/alto (mm) por tipo de mueble. Al agregar un
                  mueble se pre-selecciona el preset más cercano; cada línea
                  puede override.
                </p>
                <div className="measure-defaults-grid">
                  {typesInUse.map((type) => {
                    const entry = project.measureDefaults?.[type];
                    return (
                      <div
                        key={type}
                        className="measure-defaults-row"
                        data-testid={`project-measure-default-${type}`}
                      >
                        <span className="measure-defaults-row__label">
                          {labels[type]}
                        </span>
                        <div className="measure-defaults-row__inputs">
                          <div className="measure-input">
                            <label
                              htmlFor={`md-${type}-depth`}
                              className="measure-input__label"
                            >
                              Fondo (mm)
                            </label>
                            <input
                              id={`md-${type}-depth`}
                              className="measure-input__field"
                              type="number"
                              min={1}
                              step="any"
                              placeholder="Ej. 560"
                              value={entry?.depth ?? ''}
                              onChange={(e) =>
                                updateMeasureDefaults(
                                  type,
                                  'depth',
                                  e.target.value,
                                )
                              }
                              data-testid={`project-measure-default-${type}-depth`}
                            />
                          </div>
                          <div className="measure-input">
                            <label
                              htmlFor={`md-${type}-height`}
                              className="measure-input__label"
                            >
                              Alto (mm)
                            </label>
                            <input
                              id={`md-${type}-height`}
                              className="measure-input__field"
                              type="number"
                              min={1}
                              step="any"
                              placeholder="Ej. 720"
                              value={entry?.height ?? ''}
                              onChange={(e) =>
                                updateMeasureDefaults(
                                  type,
                                  'height',
                                  e.target.value,
                                )
                              }
                              data-testid={`project-measure-default-${type}-height`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()
        ) : null}

        <KitchenPlanPanel
          project={project}
          modules={modules}
          canEdit={Boolean(
            canMutate &&
              project.status === 'draft' &&
              onUpdateKitchenLayout,
          )}
          onChange={(layout) => {
            onUpdateKitchenLayout?.(project.id, layout);
          }}
        />

        <QuoteScenarioCompare
          project={project}
          catalog={{
            materials,
            edges,
            hardware,
            optionGroups,
            modules,
          }}
          optionGroups={optionGroups}
          canApply={Boolean(
            canMutate && project.status === 'draft' && onApplyScenarioB,
          )}
          canDuplicate={Boolean(canMutate && onDuplicateWithScenarioB)}
          currency={project.currency}
          onApplyB={(role, choiceId) => {
            onApplyScenarioB?.(project.id, role, choiceId);
          }}
          onDuplicateWithB={(role, choiceId) => {
            onDuplicateWithScenarioB?.(project.id, role, choiceId);
          }}
        />

        <InstallationChecklistPanel
          project={project}
          canEdit={Boolean(canMutate && onUpdateInstallationChecklist)}
          onChange={(items) => {
            onUpdateInstallationChecklist?.(project.id, items);
          }}
        />

        <section
          className="project-detail__section project-detail__items"
          aria-label="Ítems de cotización"
        >
          <div className="project-detail__section-header">
            <h3 className="project-detail__section-title">
              Muebles ({project.items.length})
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {project.items.length > 0 ? (
                <button
                  type="button"
                  className="btn btn--small btn--outline"
                  onClick={() => {
                    setViewerItem(null);
                    setViewerQuoteRun(true);
                    setShow3DModal(true);
                  }}
                  data-testid="project-view-3d-run"
                >
                  <Box size={14} strokeWidth={1.5} aria-hidden />
                  Vista 3D cotización
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={openAddItemModal}
                disabled={modules.length === 0}
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Agregar mueble
              </button>
            </div>
          </div>

          {itemError && !addItemModalOpen ? (
            <p className="catalog-form__error">{itemError}</p>
          ) : null}

          {project.items.length === 0 ? (
            <p className="project-detail__empty">
              Sin muebles. Agregá uno del catálogo para cotizar.
            </p>
          ) : (
            <div className="project-item-list">
              {project.items.map((item, index) => {
                const mod = modules.find((m) => m.id === item.moduleId);
                const groups = groupsForModuleItem(mod, optionGroups);
                return (
                  <div
                    key={item.id}
                    className="project-item-card"
                    data-testid={`project-item-${item.id}`}
                  >
                    <div className="project-item-card__header">
                      <h4 className="project-item-card__title">
                        Ítem {index + 1}:{' '}
                        {mod
                          ? `${mod.name} — ${mod.code}`
                          : `Mueble desconocido (${item.moduleId})`}
                        {mod?.furnitureType ? (
                          <span
                            className="project-item-type-badge"
                            data-testid={`project-item-type-badge-${item.id}`}
                          >
                            {furnitureTypeLabel(mod.furnitureType)}
                          </span>
                        ) : null}
                        {item.structureRevisionPin !== undefined ? (
                          <ProjectItemStructureRevisionIndicator
                            pin={item.structureRevisionPin}
                            testId={`project-item-revision-pin-${item.id}`}
                          />
                        ) : null}
                      </h4>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {mod && (
                          <button
                            type="button"
                            className="btn btn--small btn--outline"
                            onClick={() => {
                              setViewerQuoteRun(false);
                              setViewerItem({ item, mod });
                              setShow3DModal(true);
                            }}
                            data-testid={`view-3d-btn-${item.id}`}
                          >
                            <Box size={14} strokeWidth={1.5} aria-hidden />
                            3D
                          </button>
                        )}
                        {confirmRemoveItemId === item.id ? (
                          <span className="project-inline-confirm">
                            <span className="project-inline-confirm__text">
                              ¿Quitar?
                            </span>
                            <button
                              type="button"
                              className="btn btn--small btn--danger"
                              onClick={() => {
                                onRemoveItem(project.id, item.id);
                                setConfirmRemoveItemId(null);
                              }}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              className="btn btn--small"
                              onClick={() => setConfirmRemoveItemId(null)}
                            >
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--small btn--danger"
                            onClick={() => setConfirmRemoveItemId(item.id)}
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="project-editor__grid">
                      <div className="catalog-form__field">
                        <label htmlFor={`item-qty-${item.id}`}>Cantidad</label>
                        <input
                          id={`item-qty-${item.id}`}
                          type="number"
                          min={1}
                          step={1}
                          value={item.quantity}
                          onChange={(e) =>
                            updateItemQuantity(item, Number(e.target.value))
                          }
                        />
                      </div>
                      {mod && (mod.presets?.length ?? 0) > 0 ? (
                        <div className="catalog-form__field">
                          <label htmlFor={`item-measure-${item.id}`}>
                            Medida
                          </label>
                          <select
                            id={`item-measure-${item.id}`}
                            value={item.measurePresetId ?? ''}
                            onChange={(e) =>
                              updateItemMeasurePreset(item, e.target.value)
                            }
                            data-testid={`item-measure-preset-${item.id}`}
                          >
                            <option value="">Elegí medida…</option>
                            {mod.presets!.map((pr) => (
                              <option key={pr.id} value={pr.id}>
                                {pr.name?.trim()
                                  ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth} mm)`
                                  : `${pr.width}×${pr.height}×${pr.depth} mm`}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>

                    {groups.length === 0 ? (
                      <p className="catalog-empty">
                        Este mueble no tiene grupos de opción requeridos.
                      </p>
                    ) : (
                      <div className="project-item-choices">
                        {groups.map((group) => {
                          const options = optionsForGroup(group, catalogs);
                          const lineValue =
                            item.optionChoices[group.code]?.trim() ?? '';
                          const projectDefault =
                            project.projectLevelChoices?.[group.code]?.trim() ??
                            '';
                          const isOverride = Boolean(lineValue);
                          const inheritLabel = projectDefault
                            ? `Usar default del proyecto (${optionLabelForId(projectDefault, group, catalogs)})`
                            : 'Usar default del proyecto';
                          return (
                            <div
                              key={group.id}
                              className="catalog-form__field"
                            >
                              <label
                                htmlFor={`choice-${item.id}-${group.code}`}
                              >
                                {group.name} ({group.code})
                                {isOverride ? (
                                  <span
                                    className="project-choice-override-badge"
                                    title="Esta línea overridea el default del proyecto"
                                  >
                                    Override
                                  </span>
                                ) : null}
                              </label>
                              <select
                                id={`choice-${item.id}-${group.code}`}
                                value={lineValue}
                                onChange={(e) =>
                                  updateItemChoice(
                                    item,
                                    group.code,
                                    e.target.value,
                                  )
                                }
                                data-testid={`item-choice-${item.id}-${group.code}`}
                              >
                                <option value="">{inheritLabel}</option>
                                {options.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.name} — {opt.code}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </div>

        <aside
          className={
            previewBlocked || !breakdown
              ? 'project-totals project-totals--blocked project-totals--sticky'
              : 'project-totals project-totals--sticky'
          }
          aria-label="Totales de cotización"
          aria-live="polite"
        >
          <div className="project-totals__header">
            <div className="project-totals__heading">
              <h3 className="project-totals__title">
                {isProjectClosed(project.status) && project.priceSnapshot
                  ? 'Totales (congelados)'
                  : 'Totales'}
              </h3>
              {isProjectClosed(project.status) && project.priceSnapshot ? (
                <span
                  className="project-totals__frozen-badge"
                  title={`Precios capturados el ${formatIsoDate(project.priceSnapshot.capturedAt)}`}
                >
                  Precios congelados
                </span>
              ) : null}
            </div>
            {breakdownLoading ? (
              <InlineLoading
                label="Recalculando…"
                data-testid="breakdown-loading"
              />
            ) : null}
          </div>

          {breakdownError ? (
            <p
              className="project-totals__error"
              role="alert"
              data-testid="breakdown-error"
            >
              <AlertCircle size={16} strokeWidth={1.5} aria-hidden />
              <span>{breakdownError}</span>
            </p>
          ) : null}

          <PricePreviewGate
            requiredGroupCodes={previewBlocked ? missingGroups : []}
            optionChoices={{}}
            groupLabels={groupLabels}
            blockedMessage="Totales bloqueados: faltan opciones obligatorias en uno o más ítems."
          >
            {breakdown ? (
              <dl className="project-totals__grid">
                {showCosts ? (
                  <>
                    <div>
                      <dt>Materiales</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.materialsCost,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Cantos</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.edgeTotal,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Herrajes</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.hardwareTotal,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Costo directo</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.directCost,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>MO modular</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.laborModular,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>MO fija</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.laborFixedCost,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Factor margen</dt>
                      <dd>{breakdown.marginFactor.toFixed(2)}</dd>
                    </div>
                  </>
                ) : null}
                <div className="project-totals__sale-row">
                  <dt>Precio de venta</dt>
                  <dd className="project-totals__sale">
                    {formatProjectMoney(breakdown.salePrice, project.currency)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="project-totals__empty">
                {project.items.length === 0
                  ? 'Agregá muebles para ver totales.'
                  : breakdownLoading
                    ? 'Calculando desglose…'
                    : 'No se pudo calcular el desglose con las opciones actuales.'}
              </p>
            )}
          </PricePreviewGate>

          {materialSummary &&
          (materialSummary.materials.length > 0 ||
            materialSummary.hardware.length > 0) ? (
            <section
              className="project-material-summary"
              aria-label="Resumen de materiales"
              data-testid="project-material-summary"
            >
              <h4 className="project-material-summary__title">
                Resumen de materiales
              </h4>
              {materialSummary.materials.length > 0 ? (
                <div className="project-material-summary__block">
                  <p className="project-material-summary__label">
                    Tableros · {materialSummary.totalAreaM2.toFixed(3)} m²
                  </p>
                  <ul className="project-material-summary__list">
                    {materialSummary.materials.map((row) => (
                      <li key={row.materialId}>
                        <span className="project-material-summary__name">
                          {row.name}
                        </span>
                        <span className="project-material-summary__meta">
                          {row.areaM2.toFixed(3)} m²
                          {showCosts
                            ? ` · ${formatProjectMoney(row.boardCost, project.currency)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    const sheets = estimateBoardSheets(
                      materialSummary.materials,
                      materials,
                    ).filter((s) => s.estimatedSheets > 0);
                    if (sheets.length === 0) return null;
                    return (
                      <div
                        className="project-material-summary__block"
                        data-testid="project-sheet-estimate"
                        style={{ marginTop: '0.75rem' }}
                      >
                        <p className="project-material-summary__label">
                          Pliegos estimados
                        </p>
                        <p className="catalog-form__hint" style={{ marginTop: 0 }}>
                          Estimado — nesting real en software de corte
                        </p>
                        <ul className="project-material-summary__list">
                          {sheets.map((s) => (
                            <li key={s.materialId}>
                              <span className="project-material-summary__name">
                                {s.name}
                              </span>
                              <span className="project-material-summary__meta">
                                ~{s.estimatedSheets} pliego
                                {s.estimatedSheets === 1 ? '' : 's'}
                                {s.sheetWidthMm > 0
                                  ? ` (${s.sheetWidthMm}×${s.sheetLengthMm} mm)`
                                  : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}

                  {project.nestingImport && project.nestingImport.rows.length > 0 ? (
                    <div
                      className="project-material-summary__block"
                      data-testid="project-nesting-import"
                      style={{ marginTop: '0.75rem' }}
                    >
                      <p className="project-material-summary__label">
                        Nesting importado
                      </p>
                      <p className="catalog-form__hint" style={{ marginTop: 0 }}>
                        Consumo real ({project.nestingImport.sourceName ?? 'CSV'})
                        · {new Date(project.nestingImport.importedAt).toLocaleString()}
                      </p>
                      <ul className="project-material-summary__list">
                        {project.nestingImport.rows.map((r) => (
                          <li key={r.materialCode}>
                            <span className="project-material-summary__name">
                              {r.materialCode}
                            </span>
                            <span className="project-material-summary__meta">
                              {r.sheetsUsed} pliego{r.sheetsUsed === 1 ? '' : 's'}
                              {r.areaM2 != null ? ` · ${r.areaM2} m²` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {canMutate && onImportNesting ? (
                    <div style={{ marginTop: '0.75rem' }}>
                      <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer' }}>
                        Importar nesting (CSV)
                        <input
                          type="file"
                          accept=".csv,text/csv,text/plain"
                          style={{ display: 'none' }}
                          data-testid="project-nesting-file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            void file.text().then((text) => {
                              const rows = parseNestingImportCsv(text);
                              if (rows.length === 0) return;
                              onImportNesting(
                                project.id,
                                nestingImportFromRows(
                                  rows,
                                  new Date().toISOString(),
                                  file.name,
                                ),
                              );
                            });
                          }}
                        />
                      </label>
                      <p className="catalog-form__hint">
                        Columnas: material_code, sheets_used [, area_m2]
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {materialSummary.edges.length > 0 ? (
                <div className="project-material-summary__block">
                  <p className="project-material-summary__label">
                    Cantos · {materialSummary.totalEdgeMl.toFixed(2)} ML
                  </p>
                  <ul className="project-material-summary__list">
                    {materialSummary.edges.map((row) => (
                      <li key={row.edgeBandId}>
                        <span className="project-material-summary__name">
                          {row.name}
                        </span>
                        <span className="project-material-summary__meta">
                          {row.edgeMl.toFixed(2)} ML
                          {showCosts
                            ? ` · ${formatProjectMoney(row.edgeCost, project.currency)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {materialSummary.hardware.length > 0 ? (
                <div className="project-material-summary__block">
                  <p className="project-material-summary__label">
                    Herrajes · {materialSummary.hardware.reduce((s, h) => s + h.quantity, 0)} uds
                  </p>
                  <ul className="project-material-summary__list">
                    {materialSummary.hardware.map((row) => (
                      <li key={row.hardwareId}>
                        <span className="project-material-summary__name">
                          {row.description}
                        </span>
                        <span className="project-material-summary__meta">
                          ×{row.quantity}
                          {showCosts
                            ? ` · ${formatProjectMoney(row.lineCost, project.currency)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {exportBlockMessage ? (
            <p className="project-totals__export-msg" role="status">
              {exportBlockMessage}
            </p>
          ) : null}

          {exportErrors.length > 0 ? (
            <ExportIssueList issues={exportErrors} />
          ) : null}
        </aside>
      </div>
    </div>
    );
  };

  if (loading) {
    return (
      <section className="catalog-page" aria-label="Cotizaciones">
        <PageLoading label="Cargando cotizaciones…" data-testid="projects-loading" />
      </section>
    );
  }

  return (
    <section className="catalog-page" aria-label="Cotizaciones">
      {selectedProject ? renderDetail(selectedProject) : renderList()}

      <Modal
        open={metaModalOpen}
        onClose={closeMetaModal}
        title={metaEditingId ? 'Editar cotización' : 'Nueva cotización'}
        size="md"
        footer={
          <>
            <button type="button" className="btn" onClick={closeMetaModal}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={metaFormId}
            >
              Guardar
            </button>
          </>
        }
      >
        {renderMetaForm()}
      </Modal>

      <Modal
        open={addItemModalOpen}
        onClose={closeAddItemModal}
        title="Agregar mueble"
        size="md"
        footer={
          <>
            <button type="button" className="btn" onClick={closeAddItemModal}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={addItemFormId}
              disabled={modulesForAdd.length === 0}
            >
              Agregar
            </button>
          </>
        }
      >
        {renderAddItemForm()}
      </Modal>

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
      <Modal
        open={templatePickerOpen}
        onClose={() => {
          setTemplatePickerOpen(false);
          setFromTemplateDraft(null);
        }}
        title="Crear cotización desde plantilla"
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTemplatePickerOpen(false);
                setFromTemplateDraft(null);
              }}
            >
              Cancelar
            </button>
            {fromTemplateDraft ? (
              <button
                type="submit"
                form="from-template-form"
                className="btn btn--primary"
              >
                Crear cotización
              </button>
            ) : null}
          </>
        }
      >
        {!fromTemplateDraft ? (
          <ul
            className="template-picker-list"
            data-testid="template-picker-list"
          >
            {(projectTemplates ?? []).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="template-picker-item"
                  onClick={() => pickTemplate(t)}
                  data-testid={`template-pick-${t.id}`}
                >
                  <LayoutTemplate
                    size={18}
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  <span className="template-picker-item__name">{t.name}</span>
                  <span className="template-picker-item__meta">
                    {t.items.length} mueble{t.items.length === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form id="from-template-form" onSubmit={confirmFromTemplate}>
            <p className="project-editor__hint" style={{ marginBottom: 'var(--space-3)' }}>
              Plantilla: <strong>{fromTemplateDraft.name}</strong> ·{' '}
              {fromTemplateDraft.items.length} mueble
              {fromTemplateDraft.items.length === 1 ? '' : 's'}
            </p>
            <div className="catalog-form__field">
              <label htmlFor="from-template-name">Nombre de la cotización</label>
              <input
                id="from-template-name"
                value={fromTemplateName}
                onChange={(e) => setFromTemplateName(e.target.value)}
                required
                data-testid="from-template-name"
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="from-template-customer">Cliente</label>
              <select
                id="from-template-customer"
                value={fromTemplateCustomer}
                onChange={(e) => setFromTemplateCustomer(e.target.value)}
                required
                data-testid="from-template-customer"
              >
                <option value="">Elegí un cliente…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {error ? (
              <p className="project-editor__error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </Modal>

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
