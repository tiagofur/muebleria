/**
 * State hook for ProjectsScreen (search, filters, selection, modals, handlers).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  Agregado,
  AmbientCategory,
  AmbientMaterial,
  Component,
  Customer,
  EdgeBand,
  FurnitureType,
  Hardware,
  MaterialBoard,
  Module,
  ModuleBaseMode,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectTemplate,
  Structure,
  WorkshopSettings,
} from '@muebles/domain';
import { useDebouncedValue } from '../../common';
import { consumeRequestCreateKey } from '../../common/consumeRequestCreateKey';
import {
  emptyProjectDraft,
  filterProjectsList,
  projectToDraft,
  quickAddPayloadForModule,
  setItemOptionChoice,
  setProjectLevelChoice,
  validateItemQuantity,
  type ProjectDraft,
  type ProjectStatusFilter,
} from '../projectHelpers';

export interface UseProjectsScreenStateProps {
  readonly projects: readonly Project[];
  readonly modules: readonly Module[];
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  readonly ambientMaterials?: readonly AmbientMaterial[];
  readonly ambientCategories?: readonly AmbientCategory[];
  readonly catalogComponents?: readonly Component[];
  readonly catalogStructures?: readonly Structure[];
  readonly catalogAgregados?: readonly Agregado[];
  readonly customers?: readonly Customer[];
  readonly optionGroups: readonly OptionGroup[];
  readonly workshopSettings?: WorkshopSettings | null;
  readonly requestCreateKey?: number;
  readonly openProjectId?: string | null;
  readonly autoPresentId?: string | null;
  readonly projectTemplates?: readonly ProjectTemplate[];
  readonly canMutate?: boolean;
  readonly onCreate: (draft: ProjectDraft) => void;
  readonly onUpdate: (id: string, draft: ProjectDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onCreateFromTemplate?: (templateId: string, draft: ProjectDraft) => void;
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
  readonly onUpdateKitchenLayout?: (
    projectId: string,
    layout: import('@muebles/domain').ProjectKitchenLayout,
  ) => void;
  readonly onAcquirePlanEdit?: (projectId: string) => boolean;
  readonly onRenewPlanEdit?: (projectId: string) => boolean;
  readonly onReleasePlanEdit?: (projectId: string) => void;
  readonly onUpdateProjectLevelChoices?: (
    projectId: string,
    choices: OptionChoices,
  ) => void;
  readonly onSelectionChange?: (projectId: string | null) => void;
}

export function useProjectsScreenState({
  projects,
  modules,
  materials,
  edges,
  hardware,
  ambientMaterials = [],
  ambientCategories = [],
  catalogComponents = [],
  catalogStructures = [],
  catalogAgregados = [],
  customers = [],
  optionGroups,
  workshopSettings = null,
  requestCreateKey = 0,
  openProjectId = null,
  autoPresentId = null,
  projectTemplates,
  canMutate = true,
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
}: UseProjectsScreenStateProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [statusFilter, setStatusFilter] =
    useState<ProjectStatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaEditingId, setMetaEditingId] = useState<string | null>(null);
  const [metaDraft, setMetaDraft] = useState<ProjectDraft>(() =>
    emptyProjectDraft(workshopSettings),
  );
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);
  const [showSpatialStudio, setShowSpatialStudio] = useState(false);
  const [spatialBootstrap, setSpatialBootstrap] = useState<{
    listFilter?: 'all' | 'unplaced' | 'placed';
    selectKey?: string | null;
  } | null>(null);
  const [postAddPlaceCue, setPostAddPlaceCue] = useState(false);

  // Auto-open presentation when autoPresentId matches
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
  const [viewerQuoteRun, setViewerQuoteRun] = useState(false);
  const [confirmRemoveItemId, setConfirmRemoveItemId] = useState<string | null>(
    null,
  );
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
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
      ambientMaterials,
      ambientCategories,
      agregados: catalogAgregados,
    }),
    [
      modules,
      catalogStructures,
      catalogComponents,
      materials,
      edges,
      hardware,
      optionGroups,
      ambientMaterials,
      ambientCategories,
      catalogAgregados,
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

  useEffect(() => {
    onSelectionChange?.(selectedId);
  }, [selectedId, onSelectionChange]);

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

  useEffect(() => {
    if (!consumeRequestCreateKey('projects', requestCreateKey)) return;
    setMetaEditingId(null);
    setMetaDraft(emptyProjectDraft(workshopSettings));
    setMetaModalOpen(true);
  }, [requestCreateKey, workshopSettings]);

  useEffect(() => {
    if (selectedId && !projects.some((p) => p.id === selectedId)) {
      setSelectedId(null);
      onSelectionChange?.(null);
      setConfirmDelete(false);
    }
  }, [projects, selectedId, onSelectionChange]);

  const closeMetaModal = () => {
    setMetaModalOpen(false);
    setMetaEditingId(null);
  };

  const closeAddItemModal = () => {
    setAddItemModalOpen(false);
  };

  const startCreate = () => {
    setMetaEditingId(null);
    setMetaDraft(emptyProjectDraft(workshopSettings));
    setMetaModalOpen(true);
  };

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

  const handleAddItemSubmit = (payload: {
    moduleId: string;
    quantity: number;
    optionChoices: OptionChoices;
    measurePresetId?: string;
    baseMode?: ModuleBaseMode;
  }) => {
    if (!selectedId) return;
    onAddItem(selectedId, payload);
    closeAddItemModal();
    if (onUpdateKitchenLayout && canMutate) {
      if (showSpatialStudio) {
        setSpatialBootstrap({ listFilter: 'unplaced', selectKey: null });
      } else {
        setPostAddPlaceCue(true);
      }
    }
  };

  /**
   * F141 (#309): inserción rápida desde la biblioteca de Proyectar. Mismo
   * seeding que el modal (quickAddPayloadForModule) y mismo camino de
   * persistencia (onAddItem); devuelve el id del ítem creado para que el
   * studio lo coloque, o null si no se pudo crear.
   */
  const insertCatalogItem = (moduleId: string): string | null => {
    if (!selectedId || !selectedProject || !canMutate) return null;
    const mod = modules.find((m) => m.id === moduleId);
    if (!mod) return null;
    const payload = quickAddPayloadForModule(mod, {
      optionGroups,
      catalogComponents,
      catalogStructures,
      catalogAgregados,
      projectLevelChoices: selectedProject.projectLevelChoices,
      measureDefaults: selectedProject.measureDefaults,
    });
    return onAddItem(selectedId, payload) ?? null;
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

  return {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    selectedId,
    setSelectedId,
    selectedProject,
    metaModalOpen,
    metaEditingId,
    metaDraft,
    addItemModalOpen,
    itemError,
    setItemError,
    confirmDelete,
    setConfirmDelete,
    confirmReopen,
    setConfirmReopen,
    showPresentation,
    setShowPresentation,
    showSpatialStudio,
    setShowSpatialStudio,
    spatialBootstrap,
    setSpatialBootstrap,
    postAddPlaceCue,
    setPostAddPlaceCue,
    show3DModal,
    setShow3DModal,
    viewerItem,
    setViewerItem,
    viewerQuoteRun,
    setViewerQuoteRun,
    confirmRemoveItemId,
    setConfirmRemoveItemId,
    templatePickerOpen,
    setTemplatePickerOpen,
    saveAsTemplateOpen,
    setSaveAsTemplateOpen,
    templatesManagementOpen,
    setTemplatesManagementOpen,
    catalogs,
    project3dCatalog,
    filtered,
    isTrulyEmpty,
    isFilterEmpty,
    handleAcquirePlanEdit,
    handleRenewPlanEdit,
    handleReleasePlanEdit,
    closeMetaModal,
    closeAddItemModal,
    startCreate,
    startFromTemplate,
    confirmFromTemplate,
    startSaveAsTemplate,
    requestDeleteTemplate,
    startEditMeta,
    openDetail,
    backToList,
    handleSubmitMeta,
    openAddItemModal,
    handleAddItemSubmit,
    insertCatalogItem,
    openSpatialStudioUnplaced,
    updateItemMeasurePreset,
    updateItemQuantity,
    updateItemChoice,
    updateProjectLevelChoice,
    handleDelete,
  };
}
