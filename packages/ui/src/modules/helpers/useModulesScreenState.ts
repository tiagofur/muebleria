/**
 * State hook and action handlers for ModulesScreen.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  Agregado,
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionGroup,
  Structure,
} from '@granete/domain';
import {
  UNCATEGORIZED_FILTER,
  canPlaceCategory,
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
  filterModulesByCategory,
  type CategoryFilterId,
} from '@granete/domain';
import { validateNonNegativeNumber, validateRequiredName } from '../../catalogs/catalogHelpers';
import {
  draftSessionKey,
  seedEditorDraftFromBaseline,
  useDebouncedValue,
  useEntityEditorState,
  useRoutableEntitySelection,
} from '../../common';
import { consumeRequestCreateKey } from '../../common/consumeRequestCreateKey';
import {
  draftToModule,
  emptyCategoryDraft,
  emptyHardwareLineDraft,
  emptyModuleDraft,
  isModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  mergeBoardOverridesIntoDraft,
  moduleCompositionKey,
  moduleHardwareGridInputId,
  moduleToDraft,
  nextGridEnterTarget,
  optionGroupsForHardware,
  validateModuleCode,
  type CategoryDraft,
  type HardwareLineDraft,
  type ModuleDraft,
} from '../moduleHelpers';
import {
  tabForModuleValidationError,
  type ModuleEditorTab,
} from '../components/moduleEditorTabs';

export interface UseModulesScreenStateProps {
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly hardware: readonly Hardware[];
  readonly categories?: readonly ModuleCategory[];
  readonly structures?: readonly Structure[];
  readonly catalogComponents?: readonly Component[];
  readonly catalogAgregados?: readonly Agregado[];
  readonly materials?: readonly MaterialBoard[];
  readonly edges?: readonly EdgeBand[];
  readonly onCreate: (draft: ModuleDraft) => void;
  readonly onUpdate: (id: string, draft: ModuleDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onCreateCategory?: (draft: CategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: CategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
  readonly onEditingChange?: (moduleId: string | null) => void;
  readonly requestCreateKey?: number;
  readonly openModuleId?: string | null;
  readonly openModuleEditId?: string | null;
  readonly onRequestEdit?: (moduleId: string) => void;
  readonly onSelectionChange?: (moduleId: string | null) => void;
  readonly boardEditorSlot?: ReactNode;
  readonly renderBoardEditor?: (args: {
    readonly module: Module;
    readonly compositionKey: string;
  }) => ReactNode;
  readonly boardOverrides?: Readonly<Record<string, unknown>>;
}

export function useModulesScreenState({
  modules,
  optionGroups,
  hardware,
  categories = [],
  structures = [],
  catalogComponents = [],
  catalogAgregados = [],
  materials = [],
  edges = [],
  onCreate,
  onUpdate,
  onDelete,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onEditingChange,
  requestCreateKey = 0,
  openModuleId = null,
  openModuleEditId = null,
  onRequestEdit,
  onSelectionChange,
  boardEditorSlot,
  renderBoardEditor,
  boardOverrides,
}: UseModulesScreenStateProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilterId>(null);

  // F152: canonical URL↔selection sync (same hook as structures/components/
  // catalogs). Seeds selection from openModuleId on mount so /modules/:id
  // deep links survive F5; notifies the shell only on user-driven changes.
  const moduleIds = useMemo(() => modules.map((m) => m.id), [modules]);
  const { selectedId, setSelectedId } = useRoutableEntitySelection({
    openEntityId: openModuleId,
    onSelectionChange,
    knownIds: moduleIds,
  });

  const draftKey = draftSessionKey('module', openModuleEditId ?? 'idle');

  const {
    modalOpen,
    setModalOpen,
    editingId,
    setEditingId,
    draft,
    setDraft,
    initialDraft,
    setInitialDraft,
    confirmDiscard,
    editorTab,
    error,
    isDraftDirty,
    setEditorTab,
    setError,
    setConfirmDiscard,
    forceCloseEditor,
    closeModal,
    clearDraft,
  } = useEntityEditorState<ModuleDraft, ModuleEditorTab>({
    draftKey,
    emptyDraft: emptyModuleDraft,
    draftValidator: isModuleDraft,
    defaultTab: 'general',
    onEditorClose: (restoreId) => {
      if (restoreId && restoreId !== 'new') {
        if (onSelectionChange) {
          onSelectionChange(restoreId);
        } else if (onRequestEdit) {
          onRequestEdit(null as any);
        }
      } else if (onRequestEdit) {
        onRequestEdit(null as any);
      } else if (onSelectionChange) {
        onSelectionChange(null);
      }
    },
    currentSelectionId: selectedId,
  });

  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [categoryDraft, setCategoryDraft] =
    useState<CategoryDraft>(emptyCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [addComponentOpen, setAddComponentOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const debouncedCompSearch = useDebouncedValue(componentSearch);
  const [newCompId, setNewCompId] = useState('');
  const [newCompQty, setNewCompQty] = useState(1);
  const [show3DModal, setShow3DModal] = useState(false);
  const [viewerModule, setViewerModule] = useState<Module | null>(null);

  const composedEnabled = draft.structureId !== '';

  const module3dCatalog = useMemo(
    () => ({
      modules,
      structures,
      components: catalogComponents,
      materials,
      edges,
      hardware,
      optionGroups,
      agregados: catalogAgregados,
    }),
    [
      modules,
      structures,
      catalogComponents,
      materials,
      edges,
      hardware,
      optionGroups,
      catalogAgregados,
    ],
  );

  const selectedStructure = useMemo(
    () => structures.find((s) => s.id === draft.structureId) ?? null,
    [structures, draft.structureId],
  );

  const filteredCatalogComponents = useMemo(() => {
    const q = debouncedCompSearch.trim().toLocaleLowerCase('es-UY');
    if (!q) return catalogComponents.filter((c) => c.active);
    return catalogComponents.filter(
      (c) =>
        c.active &&
        (`${c.code} ${c.name}`.toLocaleLowerCase('es-UY').includes(q) ||
          c.optionRoles.some((r) => r.toLocaleLowerCase('es-UY').includes(q))),
    );
  }, [catalogComponents, debouncedCompSearch]);

  const hardwareRoles = useMemo(
    () => optionGroupsForHardware(optionGroups),
    [optionGroups],
  );
  const activeHardware = useMemo(
    () => hardware.filter((h) => h.active),
    [hardware],
  );
  const hardwareById = useMemo(() => {
    const map = new Map<string, Hardware>();
    for (const h of hardware) map.set(h.id, h);
    return map;
  }, [hardware]);

  const filtered = useMemo(() => {
    const byCat = filterModulesByCategory(
      modules,
      categoryFilter,
      categories,
    );
    return filterModulesByQuery(byCat, debouncedSearch);
  }, [modules, categories, categoryFilter, debouncedSearch]);

  const categoryFilterCounts = useMemo(() => {
    const byCategoryId = new Map<string, number>();
    for (const cat of categories) {
      byCategoryId.set(
        cat.id,
        filterModulesByCategory(modules, cat.id, categories).length,
      );
    }
    return {
      all: modules.length,
      uncategorized: filterModulesByCategory(
        modules,
        UNCATEGORIZED_FILTER,
        categories,
      ).length,
      byCategoryId,
    };
  }, [modules, categories]);

  const draftCascade = useMemo(
    () => cascadeFromCategoryId(draft.categoryId || undefined, categories),
    [draft.categoryId, categories],
  );
  const draftCascadeOpts = useMemo(
    () => cascadeOptions(categories, draftCascade),
    [categories, draftCascade],
  );
  const flatCategories = useMemo(
    () => flattenCategoriesForSelect(categories),
    [categories],
  );

  const setDraftCascadeLevel = (
    level: 1 | 2 | 3,
    value: string,
  ) => {
    const next = {
      level1Id: level >= 1 ? (level === 1 ? value || undefined : draftCascade.level1Id) : undefined,
      level2Id: level >= 2 ? (level === 2 ? value || undefined : draftCascade.level2Id) : undefined,
      level3Id: level >= 3 ? (level === 3 ? value || undefined : draftCascade.level3Id) : undefined,
    };
    if (level === 1) {
      next.level2Id = undefined;
      next.level3Id = undefined;
      next.level1Id = value || undefined;
    } else if (level === 2) {
      next.level3Id = undefined;
      next.level2Id = value || undefined;
    } else {
      next.level3Id = value || undefined;
    }
    setDraft((prev) => ({
      ...prev,
      categoryId: cascadeSelectedCategoryId(next) ?? '',
    }));
  };

  const selected = useMemo(
    () => modules.find((m) => m.id === selectedId) ?? null,
    [modules, selectedId],
  );

  const seededModuleEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (openModuleEditId == null || openModuleEditId === '') {
      setModalOpen(false);
      setEditingId(null);
      seededModuleEditIdRef.current = null;
      return;
    }
    if (openModuleEditId === 'new') {
      if (seededModuleEditIdRef.current === 'new') return;
      seedEditorDraftFromBaseline(
        draftKey,
        emptyModuleDraft(),
        setDraft,
        setInitialDraft,
        isModuleDraft,
      );
      setEditingId(null);
      setEditorTab('general');
      setError(null);
      setModalOpen(true);
      seededModuleEditIdRef.current = 'new';
      return;
    }
    if (seededModuleEditIdRef.current === openModuleEditId) return;
    const module = modules.find((m) => m.id === openModuleEditId);
    if (!module) return;
    seedEditorDraftFromBaseline(
      draftKey,
      moduleToDraft(module),
      setDraft,
      setInitialDraft,
      isModuleDraft,
    );
    setEditingId(module.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
    seededModuleEditIdRef.current = openModuleEditId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openModuleEditId, modules]);

  useEffect(() => {
    if (!consumeRequestCreateKey('modules', requestCreateKey)) return;
    const fresh = emptyModuleDraft();
    setEditingId(null);
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  }, [requestCreateKey]);

  useEffect(() => {
    if (modalOpen) {
      onEditingChange?.(editingId);
    } else {
      onEditingChange?.(selectedId);
    }
  }, [modalOpen, editingId, selectedId, onEditingChange]);

  const startCreate = () => {
    if (onRequestEdit) {
      onRequestEdit('new');
      return;
    }
    const fresh = emptyModuleDraft();
    setEditingId(null);
    setDraft(fresh);
    setInitialDraft(fresh);
    setError(null);
    setEditorTab('general');
    setModalOpen(true);
  };

  const startEdit = (item: Module) => {
    if (onRequestEdit) {
      onRequestEdit(item.id);
      return;
    }
    const fresh = moduleToDraft(item);
    setEditingId(item.id);
    setDraft(fresh);
    setInitialDraft(fresh);
    setError(null);
    setEditorTab('general');
    setModalOpen(true);
  };

  const openDetail = (item: Module) => {
    setSelectedId(item.id);
  };

  const backToList = () => {
    setSelectedId(null);
  };

  const updateLine = (id: string, patch: Partial<HardwareLineDraft>) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.map((l) =>
        l.id === id ? { ...l, ...patch } : l,
      ),
    }));
  };

  const pendingHwFocusRef = useRef<{ field: 'qty' } | null>(null);

  useEffect(() => {
    const pending = pendingHwFocusRef.current;
    if (!pending || draft.hardwareLines.length === 0) return;
    const last = draft.hardwareLines[draft.hardwareLines.length - 1];
    if (!last) return;
    pendingHwFocusRef.current = null;
    const el = document.getElementById(
      moduleHardwareGridInputId(last.id, pending.field),
    ) as HTMLInputElement | null;
    el?.focus();
    el?.select?.();
  }, [draft.hardwareLines]);

  const onHardwareGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.tagName !== 'INPUT') return;
    const field = target.getAttribute('data-grid-field');
    const rowId = target.getAttribute('data-grid-row');
    if (field !== 'qty' || !rowId) return;

    event.preventDefault();
    const rowIds = draft.hardwareLines.map((l) => l.id);
    const next = nextGridEnterTarget({
      rowIds,
      currentRowId: rowId,
      field: 'qty',
    });
    if (!next) return;
    if (next.kind === 'focus') {
      const el = document.getElementById(
        moduleHardwareGridInputId(next.rowId, 'qty'),
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select?.();
      return;
    }
    pendingHwFocusRef.current = { field: 'qty' };
    addHardwareLine();
  };

  const addHardwareLine = () => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    const line = emptyHardwareLineDraft(id);
    if (hardwareRoles[0]) {
      line.optionRole = hardwareRoles[0].code;
    }
    setDraft((prev) => ({
      ...prev,
      hardwareLines: [...prev.hardwareLines, line],
    }));
  };

  const removeHardwareLine = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      hardwareLines: prev.hardwareLines.filter((l) => l.id !== id),
    }));
  };

  const draftBoardModule = useMemo(
    () => draftToModule(editingId ?? 'module-draft', draft),
    [editingId, draft],
  );

  const liveBoardModule = useMemo(
    () =>
      draftToModule(
        editingId ?? 'module-draft',
        mergeBoardOverridesIntoDraft(draft, boardOverrides),
      ),
    [editingId, draft, boardOverrides],
  );

  const boardCompositionKey = useMemo(
    () => moduleCompositionKey(draftBoardModule),
    [draftBoardModule],
  );

  const resolvedBoardEditorSlot = useMemo(() => {
    if (renderBoardEditor) {
      return renderBoardEditor({
        module: liveBoardModule,
        compositionKey: boardCompositionKey,
      });
    }
    return boardEditorSlot;
  }, [
    renderBoardEditor,
    liveBoardModule,
    boardCompositionKey,
    boardEditorSlot,
  ]);

  const validate = (): string | null => {
    const codeErr = validateModuleCode(
      draft.code,
      modules,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;

    if (draft.baseLaborCost.trim()) {
      const n = Number(draft.baseLaborCost);
      const laborErr = validateNonNegativeNumber(n, 'Mano de obra base');
      if (laborErr) return laborErr;
    }

    for (const dim of [
      draft.externalWidth,
      draft.externalHeight,
      draft.externalDepth,
    ]) {
      if (dim.trim()) {
        const n = Number(dim);
        const dimErr = validateNonNegativeNumber(n, 'Dimensión externa');
        if (dimErr) return dimErr;
      }
    }

    if (draft.structureId.trim()) {
      const w = Number(draft.externalWidth);
      const h = Number(draft.externalHeight);
      const d = Number(draft.externalDepth);
      if (!(w > 0 && h > 0 && d > 0)) {
        return 'Con estructura, la medida base (ancho, alto y profundidad) es obligatoria.';
      }
    }

    for (const preset of draft.presets) {
      if (preset.width <= 0 || preset.height <= 0 || preset.depth <= 0) {
        return 'Las opciones de medida adicionales deben tener ancho, alto y profundidad mayores a 0.';
      }
    }

    for (const line of draft.hardwareLines) {
      const qtyErr = validateNonNegativeNumber(line.quantity, 'Cantidad de herraje');
      if (qtyErr) return qtyErr;
      if (line.quantity <= 0) {
        return 'La cantidad de herraje debe ser mayor a 0.';
      }
      if (line.mode === 'role') {
        if (!line.optionRole.trim()) {
          return 'Cada línea de herraje por rol necesita optionRole.';
        }
      } else if (!line.hardwareId.trim()) {
        return 'Cada herraje fijo necesita un herraje del catálogo.';
      }
    }

    return null;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      setEditorTab(tabForModuleValidationError(err));
      return;
    }
    setError(null);
    const draftWithOverrides = mergeBoardOverridesIntoDraft(
      draft,
      boardOverrides,
    );
    if (editingId) {
      onUpdate(editingId, draftWithOverrides);
    } else {
      onCreate(draftWithOverrides);
    }
    forceCloseEditor();
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<
    string | null
  >(null);

  const handleDelete = (id: string) => {
    onDelete(id);
    setConfirmDeleteId(null);
    if (selectedId === id) {
      setSelectedId(null);
    }
    if (editingId === id) {
      forceCloseEditor();
    }
  };

  const handleDeleteCategory = (id: string) => {
    onDeleteCategory?.(id);
    setConfirmDeleteCategoryId(null);
  };

  const deleteTarget = useMemo(
    () =>
      confirmDeleteId
        ? (modules.find((m) => m.id === confirmDeleteId) ?? null)
        : null,
    [confirmDeleteId, modules],
  );

  const deleteCategoryTarget = useMemo(
    () =>
      confirmDeleteCategoryId
        ? (categories.find((c) => c.id === confirmDeleteCategoryId) ?? null)
        : null,
    [confirmDeleteCategoryId, categories],
  );

  const isTrulyEmpty = modules.length === 0;
  const isFilterEmpty = !isTrulyEmpty && filtered.length === 0;

  const openManageCategories = () => {
    setManageCategoriesOpen(true);
  };

  const closeManageCategories = () => {
    setManageCategoriesOpen(false);
  };

  const openCreateCategory = () => {
    setEditingCategoryId(null);
    setCategoryDraft(emptyCategoryDraft());
    setCategoryError(null);
    setCategoryModalOpen(true);
  };

  const openEditCategory = (cat: ModuleCategory) => {
    setEditingCategoryId(cat.id);
    setCategoryDraft({
      name: cat.name,
      parentId: cat.parentId ?? '',
      sortOrder: String(cat.sortOrder),
    });
    setCategoryError(null);
    setCategoryModalOpen(true);
  };

  const closeCategoryModal = () => {
    setCategoryModalOpen(false);
    setEditingCategoryId(null);
    setCategoryDraft(emptyCategoryDraft());
    setCategoryError(null);
  };

  const handleCategorySubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = categoryDraft.name.trim();
    if (!name) {
      setCategoryError('El nombre es obligatorio.');
      return;
    }
    const parentId = categoryDraft.parentId || undefined;
    if (
      !canPlaceCategory(parentId, categories, editingCategoryId ?? undefined)
    ) {
      setCategoryError(
        'No se puede colocar aquí: máximo 3 niveles o jerarquía inválida.',
      );
      return;
    }
    setCategoryError(null);
    if (editingCategoryId) {
      onUpdateCategory?.(editingCategoryId, categoryDraft);
    } else {
      onCreateCategory?.(categoryDraft);
    }
    closeCategoryModal();
  };

  return {
    search,
    setSearch,
    debouncedSearch,
    categoryFilter,
    setCategoryFilter,
    selectedId,
    setSelectedId,
    selected,
    filtered,
    isTrulyEmpty,
    isFilterEmpty,
    categoryFilterCounts,
    flatCategories,
    draftCascade,
    draftCascadeOpts,
    setDraftCascadeLevel,
    // Editor state
    modalOpen,
    editingId,
    draft,
    setDraft,
    initialDraft,
    confirmDiscard,
    setConfirmDiscard,
    editorTab,
    setEditorTab,
    error,
    isDraftDirty,
    forceCloseEditor,
    closeModal,
    clearDraft,
    // Category modals
    manageCategoriesOpen,
    openManageCategories,
    closeManageCategories,
    categoryModalOpen,
    editingCategoryId,
    categoryDraft,
    setCategoryDraft,
    categoryError,
    openCreateCategory,
    openEditCategory,
    closeCategoryModal,
    handleCategorySubmit,
    // 3D modal
    show3DModal,
    setShow3DModal,
    viewerModule,
    setViewerModule,
    module3dCatalog,
    // Component adder modal
    addComponentOpen,
    setAddComponentOpen,
    componentSearch,
    setComponentSearch,
    filteredCatalogComponents,
    newCompId,
    setNewCompId,
    newCompQty,
    setNewCompQty,
    // Hardware grid & lines
    hardwareRoles,
    activeHardware,
    hardwareById,
    addHardwareLine,
    removeHardwareLine,
    updateLine,
    onHardwareGridKeyDown,
    // Structure & board composition
    selectedStructure,
    composedEnabled,
    resolvedBoardEditorSlot,
    // Actions
    startCreate,
    startEdit,
    openDetail,
    backToList,
    handleSubmit,
    // Delete dialogs
    confirmDeleteId,
    setConfirmDeleteId,
    confirmDeleteCategoryId,
    setConfirmDeleteCategoryId,
    deleteTarget,
    deleteCategoryTarget,
    handleDelete,
    handleDeleteCategory,
  };
}
