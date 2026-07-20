/**
 * Module (mueble plantilla) ABM — cards + detail + Modal LG (F021).
 * Cost formulas live in the shell; this component only renders cost props.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  Component,
  Hardware,
  Module,
  ModuleCategory,
  OptionGroup,
  QuoteBreakdown,
  Structure,
  MaterialBoard,
  EdgeBand,
} from '@muebles/domain';
import {
  UNCATEGORIZED_FILTER,
  canPlaceCategory,
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
  filterModulesByCategory,
  type CategoryFilterId,
} from '@muebles/domain';
import { validateNonNegativeNumber, validateRequiredName } from '../catalogs/catalogHelpers';
import {
  Modal,
  PageLoading,
  useDebouncedValue,
} from '../common';
import '../catalogs/catalogs.css';
import {
  emptyCategoryDraft,
  emptyHardwareLineDraft,
  emptyModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  moduleHardwareGridInputId,
  moduleToDraft,
  nextGridEnterTarget,
  optionGroupsForHardware,
  validateModuleCode,
  type BoardPartDraft,
  type CategoryDraft,
  type ComponentInstanceDraft,
  type HardwareLineDraft,
  type ModuleDraft,
} from './moduleHelpers';
import { ModuleCategoryModals } from './components/ModuleCategoryModals';
import { ModuleComponentAdderModal } from './components/ModuleComponentAdderModal';
import { ModuleDetailView } from './components/ModuleDetailView';
import { ModuleEditorForm } from './components/ModuleEditorForm';
import { ModuleListView } from './components/ModuleListView';
import { Module3DModal } from './components/Module3DModal';
import {
  tabForModuleValidationError,
  type ModuleEditorTab,
} from './components/moduleEditorTabs';
import './modules.css';

export type { ModuleDraft, BoardPartDraft, HardwareLineDraft, CategoryDraft, ComponentInstanceDraft };

export interface ModulesScreenProps {
  /** When true, show section loading (workspace/async gate). */
  readonly loading?: boolean;
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly hardware: readonly Hardware[];
  readonly materials?: readonly MaterialBoard[];
  readonly edges?: readonly EdgeBand[];
  /** Hierarchical categories (MOD-09). Default empty. */
  readonly categories?: readonly ModuleCategory[];
  readonly onCreate: (draft: ModuleDraft) => void;
  readonly onUpdate: (id: string, draft: ModuleDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onCreateCategory?: (draft: CategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: CategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
  /** Deep-copy module (MOD-05). Shell owns id/code generation. */
  readonly onDuplicate?: (id: string) => void;
  /**
   * Notifies parent when the module used for domain cost preview changes
   * (detail selection or edit modal). Null = none / create mode.
   */
  readonly onEditingChange?: (moduleId: string | null) => void;
  /** Domain QuoteBreakdown from shell (MOD-06). Null when blocked/unavailable. */
  readonly costPreview?: QuoteBreakdown | null;
  readonly previewBlocked?: boolean;
  readonly missingGroups?: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  /**
   * Sale-price estimate per module id (domain-computed in shell).
   * `null` value = blocked / unavailable.
   */
  readonly moduleEstimates?: Readonly<Record<string, number | null>>;
  /**
   * Incrementing token to open the create-module modal from outside
   * (Dashboard quick action). 0 / undefined = no request.
   */
  readonly requestCreateKey?: number;
  /**
   * Open detail for this module id when set (URL `/modules/:id` or shell handoff).
   * null / '' = list view.
   */
  readonly openModuleId?: string | null;
  /**
   * Open editor for this module id when set (URL `/modules/:id/edit`, Fase 3 UI).
   * Sentinel `'new'` means create-new editor. null / undefined = not in edit mode.
   */
  readonly openModuleEditId?: string | null;
  /**
   * Navigate to the editor route. The shell handles the URL change.
   * Pass `'new'` for the create-new editor.
   */
  readonly onRequestEdit?: (moduleId: string) => void;
  /** Notifies parent when detail selection changes (for URL sync). */
  readonly onSelectionChange?: (moduleId: string | null) => void;
  /** Catalog structures for composed module picker. */
  readonly structures?: readonly Structure[];
  /** Catalog components for composed module adder. */
  readonly catalogComponents?: readonly Component[];
  /** F035: hide ABM when false (read-only templates). */
  readonly canMutate?: boolean;
  /**
   * Upload catalog image (F040). Returns relative media URL for draft.imageUrl.
   * Only used when canMutate is true.
   */
  readonly onUploadImage?: (file: File) => Promise<string>;
  /** Resolve media path for preview. */
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

export function ModulesScreen({
  modules,
  optionGroups,
  hardware,
  categories = [],
  onCreate,
  onUpdate,
  onDelete,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onDuplicate,
  onEditingChange,
  costPreview = null,
  previewBlocked = false,
  missingGroups = [],
  groupLabels,
  moduleEstimates = {},
  requestCreateKey = 0,
  openModuleId = null,
  openModuleEditId = null,
  onRequestEdit,
  onSelectionChange,
  loading = false,
  structures: propStructures = [],
  catalogComponents: propCatalogComponents = [],
  materials: propMaterials = [],
  edges: propEdges = [],
  canMutate = true,
  onUploadImage,
  resolveImageUrl = (u) => u,
}: ModulesScreenProps): ReactNode {
  const formId = useId();
  const categoryFormId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilterId>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModuleDraft>(emptyModuleDraft);
  const [error, setError] = useState<string | null>(null);
  /** MD modal: list + manage actions (not mixed into the filter sidebar). */
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  /** SM modal: create/edit single category form. */
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null,
  );
  const [categoryDraft, setCategoryDraft] =
    useState<CategoryDraft>(emptyCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [editorTab, setEditorTab] =
    useState<ModuleEditorTab>('general');
  const [addComponentOpen, setAddComponentOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const debouncedCompSearch = useDebouncedValue(componentSearch);
  const [newCompId, setNewCompId] = useState('');
  const [newCompQty, setNewCompQty] = useState(1);
  const [show3DModal, setShow3DModal] = useState(false);
  const [viewerModule, setViewerModule] = useState<Module | null>(null);

  const structures = propStructures;
  const catalogComponents = propCatalogComponents;
  const composedEnabled = draft.structureId !== '';

  const module3dCatalog = useMemo(
    () => ({
      modules,
      structures: propStructures,
      components: propCatalogComponents,
      materials: propMaterials,
      edges: propEdges,
      hardware,
      optionGroups,
    }),
    [
      modules,
      propStructures,
      propCatalogComponents,
      propMaterials,
      propEdges,
      hardware,
      optionGroups,
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

  /** Counts over full catalog (search only filters cards, not the tree). */
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

  // If selected module disappears (delete), return to list
  useEffect(() => {
    if (selectedId && !modules.some((m) => m.id === selectedId)) {
      setSelectedId(null);
    }
  }, [modules, selectedId]);

  // Notify shell of detail selection (URL sync).
  // Skip when in edit mode — the edit URL (`/modules/:id/edit`) is owned by
  // `openModuleEditId` and we must not navigate back to the view URL.
  useEffect(() => {
    if (openModuleEditId) return;
    onSelectionChange?.(selectedId);
  }, [selectedId, onSelectionChange, openModuleEditId]);

  // Sync detail from shell URL (`/modules` vs `/modules/:id`).
  // Note: in edit mode (`/modules/:id/edit`), `openModuleId` is null because
  // the URL has the `/edit` suffix. We use `openModuleEditId` to keep
  // `selectedId` pointed at the right module so the editor and the
  // "back to detail" flow work.
  useEffect(() => {
    const viewId = openModuleId;
    const editId =
      openModuleEditId && openModuleEditId !== 'new' ? openModuleEditId : null;
    const target = viewId ?? editId;
    if (target == null || target === '') {
      // Only clear selection if we're not in edit mode at all (else we'd
      // accidentally navigate back to the list when entering the editor).
      if (!openModuleEditId) setSelectedId(null);
      return;
    }
    if (!modules.some((m) => m.id === target)) return;
    setSelectedId(target);
  }, [openModuleId, openModuleEditId, modules]);

  /**
   * Sync edit mode from shell URL (`/modules/:id/edit` — Fase 3 UI).
   * - `'new'` sentinel: open create-new editor (still uses the existing modal
   *   in this sub-fase; will become inline in 3a.2).
   * - Real id: open edit on that module. For 3a.1 we still route through the
   *   modal to preserve behavior; the inline layout lands in 3a.2.
   * - null / '': close the editor.
   */
  useEffect(() => {
    if (openModuleEditId == null || openModuleEditId === '') {
      return;
    }
    if (openModuleEditId === 'new') {
      setEditingId(null);
      setDraft(emptyModuleDraft());
      setError(null);
      setModalOpen(true);
      return;
    }
    const module = modules.find((m) => m.id === openModuleEditId);
    if (!module) return;
    setEditingId(module.id);
    setDraft(moduleToDraft(module));
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  }, [openModuleEditId, modules]);

  // Open create modal from shell (Dashboard quick action)
  useEffect(() => {
    if (!requestCreateKey) return;
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
    setModalOpen(true);
  }, [requestCreateKey]);

  // Domain cost preview target: edit modal id, else detail selection
  useEffect(() => {
    if (modalOpen) {
      onEditingChange?.(editingId);
    } else {
      onEditingChange?.(selectedId);
    }
  }, [modalOpen, editingId, selectedId, onEditingChange]);

  /**
   * Close the editor. When the editor was opened via the URL (`openModuleEditId`),
   * navigate back to the view (or list, for create-new). Otherwise (legacy
   * modal triggered by `requestCreateKey` etc.) just close locally.
   */
  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
    setEditorTab('general');
    if (openModuleEditId && onSelectionChange) {
      // After closing the editor, go back to the view (selectedId) or the list.
      onSelectionChange(selectedId);
    }
  };

  /**
   * Open the editor (create-new). When `onRequestEdit` is wired (Fase 3 UI),
   * the shell navigates to `/modules/new/edit` and the effect on
   * `openModuleEditId` triggers the actual editor open. Otherwise (legacy /
   * tests), open the modal directly.
   */
  const startCreate = () => {
    if (onRequestEdit) {
      onRequestEdit('new');
      return;
    }
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
    setEditorTab('general');
    setModalOpen(true);
  };

  /**
   * Open the editor (edit existing). When `onRequestEdit` is wired (Fase 3 UI),
   * the shell navigates to `/modules/:id/edit` and the effect on
   * `openModuleEditId` triggers the actual editor open. Otherwise (legacy /
   * tests), open the modal directly.
   */
  const startEdit = (item: Module) => {
    if (onRequestEdit) {
      onRequestEdit(item.id);
      return;
    }
    setEditingId(item.id);
    setDraft(moduleToDraft(item));
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

  /** After Enter adds a row, focus this field on the new hardware line (issue #39). */
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
        : `hwline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    closeModal();
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
      closeModal();
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

  if (loading) {
    return (
      <section className="catalog-page" aria-label="Muebles">
        <PageLoading label="Cargando muebles…" data-testid="modules-loading" />
      </section>
    );
  }

  return (
    <section className="catalog-page" aria-label="Muebles (módulos)">
      {selected ? (
        <ModuleDetailView
          module={selected}
          categories={categories}
          catalogComponents={catalogComponents}
          hardwareById={hardwareById}
          costPreview={costPreview}
          previewBlocked={previewBlocked}
          missingGroups={missingGroups}
          groupLabels={groupLabels}
          moduleEstimates={moduleEstimates}
          onBack={backToList}
          onEdit={startEdit}
          onDuplicate={onDuplicate}
          onDelete={(id) => setConfirmDeleteId(id)}
          onView3D={(mod) => {
            setViewerModule(mod);
            setShow3DModal(true);
          }}
        />
      ) : (
        <ModuleListView
          filtered={filtered}
          categories={categories}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          categoryFilterCounts={categoryFilterCounts}
          search={search}
          setSearch={setSearch}
          isTrulyEmpty={isTrulyEmpty}
          isFilterEmpty={isFilterEmpty}
          canMutate={canMutate}
          moduleEstimates={moduleEstimates}
          onManageCategories={openManageCategories}
          onStartCreate={startCreate}
          onOpenDetail={openDetail}
          onCreateCategory={onCreateCategory}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar mueble' : 'Nuevo mueble'}
        size="lg"
        footer={
          <>
            <button type="button" className="btn" onClick={closeModal}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" form={formId}>
              Guardar
            </button>
          </>
        }
      >
        <ModuleEditorForm
          formId={formId}
          error={error}
          onSubmit={handleSubmit}
          editorTab={editorTab}
          setEditorTab={setEditorTab}
          draft={draft}
          setDraft={setDraft}
          draftCascade={draftCascade}
          draftCascadeOpts={draftCascadeOpts}
          setDraftCascadeLevel={setDraftCascadeLevel}
          resolveImageUrl={resolveImageUrl}
          onUploadImage={onUploadImage}
          structures={structures}
          selectedStructure={selectedStructure ?? undefined}
          catalogComponents={catalogComponents}
          composedEnabled={composedEnabled}
          onRequestAddComponent={() => {
            setAddComponentOpen(true);
            setComponentSearch('');
            setNewCompId('');
            setNewCompQty(1);
          }}
          canMutate={canMutate}
          hardwareRoles={hardwareRoles}
          activeHardware={activeHardware}
          onAddHardware={addHardwareLine}
          onRemoveHardware={removeHardwareLine}
          onUpdateHardware={updateLine}
          onHardwareGridKeyDown={onHardwareGridKeyDown}
          editingId={editingId}
          costPreview={costPreview}
          previewBlocked={previewBlocked}
          missingGroups={missingGroups}
          groupLabels={groupLabels}
        />
      </Modal>

      <ModuleComponentAdderModal
        open={addComponentOpen}
        onClose={() => setAddComponentOpen(false)}
        componentSearch={componentSearch}
        onSearchChange={setComponentSearch}
        filteredComponents={filteredCatalogComponents}
        newCompId={newCompId}
        onSelect={setNewCompId}
        newCompQty={newCompQty}
        onQtyChange={setNewCompQty}
        onConfirm={() => {
          if (!newCompId) return;
          setDraft((prev) => ({
            ...prev,
            components: [
              ...prev.components,
              {
                componentId: newCompId,
                quantity: newCompQty,
              },
            ],
          }));
          setAddComponentOpen(false);
        }}
      />

      <ModuleCategoryModals
        categories={categories}
        flatCategories={flatCategories}
        manageOpen={manageCategoriesOpen}
        onCloseManage={closeManageCategories}
        onOpenCreate={openCreateCategory}
        formOpen={categoryModalOpen}
        onCloseForm={closeCategoryModal}
        categoryFormId={categoryFormId}
        editingCategoryId={editingCategoryId}
        categoryDraft={categoryDraft}
        setCategoryDraft={setCategoryDraft}
        categoryError={categoryError}
        onSubmitForm={handleCategorySubmit}
        onEditCategory={openEditCategory}
        onRequestDeleteCategory={setConfirmDeleteCategoryId}
        onCreateCategory={onCreateCategory}
        onDeleteCategory={onDeleteCategory}
        deleteTarget={deleteCategoryTarget}
        confirmDeleteCategoryId={confirmDeleteCategoryId}
        onCancelDelete={() => setConfirmDeleteCategoryId(null)}
        onConfirmDelete={() => {
          if (confirmDeleteCategoryId) {
            handleDeleteCategory(confirmDeleteCategoryId);
          }
        }}
      />

      <Modal
        open={deleteTarget != null}
        onClose={() => setConfirmDeleteId(null)}
        title="Eliminar mueble"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (confirmDeleteId) handleDelete(confirmDeleteId);
              }}
            >
              Eliminar
            </button>
          </>
        }
      >
        <p className="project-confirm-modal__text">
          ¿Seguro que querés eliminar{' '}
          <strong>
            {deleteTarget
              ? `${deleteTarget.code} — ${deleteTarget.name}`
              : 'este mueble'}
          </strong>
          ? Esta acción no se puede deshacer.
        </p>
      </Modal>

      <Module3DModal
        open={show3DModal}
        module={viewerModule}
        catalog={module3dCatalog}
        onClose={() => {
          setShow3DModal(false);
          setViewerModule(null);
        }}
      />
    </section>
  );
}
