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
  Catalog,
} from '@muebles/domain';
import {
  UNCATEGORIZED_FILTER,
  canPlaceCategory,
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
  categoryPath,
  childrenOf,
  filterModulesByCategory,
  resolveBom,
  type CategoryFilterId,
} from '@muebles/domain';
import {
  ChevronLeft,
  Copy,
  Layers,
  Package,
  Pencil,
  Plus,
  SearchX,
  Settings2,
  Trash2,
  Box,
} from 'lucide-react';
import { validateNonNegativeNumber, validateRequiredName } from '../catalogs/catalogHelpers';
import { CatalogPicker } from '../catalogs/CatalogPicker';
import { COMPONENT_PLACEMENTS } from '../components';
import {
  CatalogImage,
  EmptyState,
  Modal,
  PageLoading,
  SearchInput,
  useDebouncedValue,
  Part3DViewer,
} from '../common';
import '../catalogs/catalogs.css';
import {
  emptyBoardPartDraft,
  emptyCategoryDraft,
  emptyHardwareLineDraft,
  emptyModuleDraft,
  filterModulesByQuery,
  flattenCategoriesForSelect,
  formatModuleMoney,
  moduleHardwareGridInputId,
  modulePartGridInputId,
  moduleToDraft,
  nextGridEnterTarget,
  optionGroupsForBoardParts,
  optionGroupsForHardware,
  suggestPartCode,
  validateModuleCode,
  defaultOptionChoicesForModule,
  type BoardPartDraft,
  type CategoryDraft,
  type ComponentInstanceDraft,
  type HardwareLineDraft,
  type ModuleDraft,
  type ModulePartGridField,
} from './moduleHelpers';
import { ModuleMeasureSection } from './components/ModuleMeasureSection';
import './modules.css';

export type { ModuleDraft, BoardPartDraft, HardwareLineDraft, CategoryDraft, ComponentInstanceDraft };

type ModuleEditorTab = 'general' | 'composition' | 'hardware' | 'cost';

const MODULE_EDITOR_TABS: readonly {
  readonly id: ModuleEditorTab;
  readonly label: string;
}[] = [
  { id: 'general', label: 'General' },
  { id: 'composition', label: 'Composición' },
  { id: 'hardware', label: 'Herrajes' },
  { id: 'cost', label: 'Costo' },
];

function tabForModuleValidationError(message: string): ModuleEditorTab {
  const m = message.toLocaleLowerCase('es-UY');
  if (m.includes('herraje')) return 'hardware';
  if (
    m.includes('estructura') ||
    m.includes('componente') ||
    m.includes('composición') ||
    m.includes('preset')
  ) {
    return 'composition';
  }
  return 'general';
}

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

function CostPreviewPanel({
  costPreview,
  previewBlocked,
  missingGroups,
  groupLabels,
  allowEmptyHint,
}: {
  readonly costPreview: QuoteBreakdown | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly allowEmptyHint?: boolean;
}): ReactNode {
  if (allowEmptyHint && !costPreview && !previewBlocked) {
    return (
      <p className="catalog-empty catalog-empty--flush">
        Guardá el mueble para ver el preview de costo con defaults de opción.
      </p>
    );
  }

  return (
    <div
      className={
        previewBlocked || !costPreview
          ? 'module-cost-preview module-cost-preview--blocked'
          : 'module-cost-preview'
      }
      role="status"
      aria-live="polite"
    >
      <h4 className="module-cost-preview__title">
        Preview de costo (con opciones por defecto)
      </h4>
      {previewBlocked || !costPreview ? (
        <>
          <p className="module-cost-preview__blocked-msg">
            Preview bloqueado: faltan grupos o no se pudo calcular.
          </p>
          {missingGroups.length > 0 ? (
            <ul className="module-cost-preview__missing">
              {missingGroups.map((code) => (
                <li key={code}>{groupLabels?.[code] ?? code}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <dl className="module-cost-preview__grid">
            <div>
              <dt>Materiales</dt>
              <dd>{formatModuleMoney(costPreview.materialsCost)}</dd>
            </div>
            <div>
              <dt>Cantos</dt>
              <dd>{formatModuleMoney(costPreview.edgeTotal)}</dd>
            </div>
            <div>
              <dt>Herrajes</dt>
              <dd>{formatModuleMoney(costPreview.hardwareTotal)}</dd>
            </div>
            <div>
              <dt>Costo directo</dt>
              <dd>{formatModuleMoney(costPreview.directCost)}</dd>
            </div>
          </dl>
          <p className="module-cost-preview__sale">
            Precio de venta: {formatModuleMoney(costPreview.salePrice)}
          </p>
        </>
      )}
    </div>
  );
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

  const resolved3DParts = useMemo(() => {
    if (!viewerModule) return [];
    try {
      const catalog: Catalog = {
        materials: propMaterials,
        edges: propEdges,
        hardware: hardware,
        optionGroups: optionGroups,
        modules: modules,
        structures: propStructures,
        components: propCatalogComponents,
      };
      const choices = defaultOptionChoicesForModule(
        viewerModule,
        optionGroups,
        propCatalogComponents,
        propStructures,
      );
      const bom = resolveBom(viewerModule, choices, catalog);
      return bom.boardParts;
    } catch (e) {
      console.error('Error resolving 3D parts:', e);
      return [];
    }
  }, [
    viewerModule,
    propMaterials,
    propEdges,
    hardware,
    optionGroups,
    modules,
    propStructures,
    propCatalogComponents,
  ]);

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

  const boardRoles = useMemo(
    () => optionGroupsForBoardParts(optionGroups),
    [optionGroups],
  );
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
  useEffect(() => {
    onSelectionChange?.(selectedId);
  }, [selectedId, onSelectionChange]);

  // Sync detail from shell URL (`/modules` vs `/modules/:id`).
  useEffect(() => {
    if (openModuleId == null || openModuleId === '') {
      setSelectedId(null);
      return;
    }
    if (!modules.some((m) => m.id === openModuleId)) return;
    setSelectedId(openModuleId);
  }, [openModuleId, modules]);

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

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
    setEditorTab('general');
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyModuleDraft());
    setError(null);
    setEditorTab('general');
    setModalOpen(true);
  };

  const startEdit = (item: Module) => {
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

  const estimateLabel = (moduleId: string): ReactNode => {
    if (!(moduleId in moduleEstimates)) {
      return (
        <span className="module-card__cost-value module-card__cost-value--muted">
          —
        </span>
      );
    }
    const value = moduleEstimates[moduleId];
    if (value == null) {
      return (
        <span className="module-card__cost-value module-card__cost-value--muted">
          Sin estimado
        </span>
      );
    }
    return (
      <span className="module-card__cost-value">
        {formatModuleMoney(value)}
      </span>
    );
  };

  const renderEditorForm = (): ReactNode => (
    <form
      id={formId}
      className="catalog-form catalog-form--wide module-editor"
      onSubmit={handleSubmit}
      noValidate
    >
      {error ? <p className="catalog-form__error">{error}</p> : null}

      <div
        className="module-editor__tabs"
        role="tablist"
        aria-label="Secciones del editor de mueble"
        data-testid="module-editor-tabs"
      >
        {MODULE_EDITOR_TABS.map((tab) => {
          const selected = editorTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`module-editor-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`module-editor-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={
                selected
                  ? 'module-editor__tab module-editor__tab--active'
                  : 'module-editor__tab'
              }
              data-testid={`module-editor-tab-${tab.id}`}
              onClick={() => setEditorTab(tab.id)}
            >
              {tab.label}
              {tab.id === 'hardware' && draft.hardwareLines.length > 0
                ? ` (${draft.hardwareLines.length})`
                : ''}
              {tab.id === 'composition' && draft.components.length > 0
                ? ` (${draft.components.length})`
                : ''}
            </button>
          );
        })}
      </div>

      <div
        className="module-editor__section"
        role="tabpanel"
        id="module-editor-panel-general"
        aria-labelledby="module-editor-tab-general"
        hidden={editorTab !== 'general'}
        data-testid="module-editor-panel-general"
      >
        <h4 className="module-editor__section-title">Datos generales</h4>
        <div className="module-editor__grid">
          <div className="catalog-form__field">
            <label htmlFor="mod-code">Código</label>
            <input
              id="mod-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mod-name">Nombre</label>
            <input
              id="mod-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mod-labor">Mano de obra base</label>
            <input
              id="mod-labor"
              type="number"
              min={0}
              step="any"
              value={draft.baseLaborCost}
              onChange={(e) =>
                setDraft({ ...draft, baseLaborCost: e.target.value })
              }
              placeholder="Opcional"
            />
          </div>
          <div className="catalog-form__field" data-testid="module-image-field">
            <label htmlFor="mod-image">Foto (vitrina)</label>
            <div className="module-editor__image-row">
              <CatalogImage
                src={resolveImageUrl(draft.imageUrl || undefined)}
                alt={draft.name || 'Mueble'}
                size="md"
              />
              {onUploadImage ? (
                <input
                  id="mod-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void onUploadImage(file)
                      .then((url) => setDraft({ ...draft, imageUrl: url }))
                      .catch(() => {
                        /* shell toasts */
                      });
                    e.target.value = '';
                  }}
                />
              ) : (
                <p className="module-editor__hint">
                  {draft.imageUrl ? draft.imageUrl : 'Sin imagen'}
                </p>
              )}
            </div>
          </div>
        </div>
        <div
          className="module-editor__grid module-editor__grid--spaced"
          data-testid="module-category-cascade"
        >
          <div className="catalog-form__field">
            <label htmlFor="mod-cat-l1">Categoría (nivel 1)</label>
            <select
              id="mod-cat-l1"
              value={draftCascade.level1Id ?? ''}
              onChange={(e) => setDraftCascadeLevel(1, e.target.value)}
            >
              <option value="">Sin categoría</option>
              {draftCascadeOpts.level1.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {draftCascadeOpts.level2.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="mod-cat-l2">Subcategoría (nivel 2)</label>
              <select
                id="mod-cat-l2"
                value={draftCascade.level2Id ?? ''}
                onChange={(e) => setDraftCascadeLevel(2, e.target.value)}
              >
                <option value="">— (usar nivel 1)</option>
                {draftCascadeOpts.level2.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {draftCascadeOpts.level3.length > 0 ? (
            <div className="catalog-form__field">
              <label htmlFor="mod-cat-l3">Subcategoría (nivel 3)</label>
              <select
                id="mod-cat-l3"
                value={draftCascade.level3Id ?? ''}
                onChange={(e) => setDraftCascadeLevel(3, e.target.value)}
              >
                <option value="">— (usar nivel 2)</option>
                {draftCascadeOpts.level3.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="catalog-form__field catalog-form__field--spaced">
          <label htmlFor="mod-notes">Notas</label>
          <input
            id="mod-notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
        <fieldset className="module-editor__dims-legend">
          <legend className="module-editor__section-title">
            Medida base (mm)
            {draft.structureId.trim() ? ' *' : ' (opcional)'}
          </legend>
          <p className="catalog-empty" style={{ marginTop: 0 }}>
            {draft.structureId.trim()
              ? 'Obligatoria si el mueble usa estructura: es el tamaño de referencia (preview y cotización cuando no hay más opciones).'
              : 'Opcional en módulos fijos. Si más abajo agregás opciones de medida, el vendedor elige en cotización.'}
          </p>
          <div className="module-editor__grid module-editor__grid--dims">
            <div className="catalog-form__field">
              <label htmlFor="mod-w">Ancho</label>
              <input
                id="mod-w"
                type="number"
                min={0}
                step="any"
                value={draft.externalWidth}
                onChange={(e) =>
                  setDraft({ ...draft, externalWidth: e.target.value })
                }
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="mod-h">Alto</label>
              <input
                id="mod-h"
                type="number"
                min={0}
                step="any"
                value={draft.externalHeight}
                onChange={(e) =>
                  setDraft({ ...draft, externalHeight: e.target.value })
                }
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="mod-d">Profundidad</label>
              <input
                id="mod-d"
                type="number"
                min={0}
                step="any"
                value={draft.externalDepth}
                onChange={(e) =>
                  setDraft({ ...draft, externalDepth: e.target.value })
                }
              />
            </div>
          </div>
        </fieldset>

        <ModuleMeasureSection
          presets={draft.presets}
          disabled={!canMutate}
          onPresetsChange={(presets) =>
            setDraft((prev) => ({ ...prev, presets }))
          }
          nextId={() =>
            typeof crypto !== 'undefined' &&
            typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          }
          canImportFromStructure={
            (selectedStructure?.presets?.length ?? 0) > 0
          }
          onImportFromStructure={() => {
            const fromStructure = (selectedStructure?.presets ?? []).map(
              (pr) => ({
                id:
                  typeof crypto !== 'undefined' &&
                  typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: pr.name ?? '',
                width: pr.width,
                height: pr.height,
                depth: pr.depth,
              }),
            );
            setDraft((prev) => ({
              ...prev,
              presets: [...prev.presets, ...fromStructure],
            }));
          }}
          canSeedFromBase={
            Number(draft.externalWidth) > 0 &&
            Number(draft.externalHeight) > 0 &&
            Number(draft.externalDepth) > 0
          }
          onSeedFromBase={() => {
            const w = Number(draft.externalWidth);
            const h = Number(draft.externalHeight);
            const d = Number(draft.externalDepth);
            if (!(w > 0 && h > 0 && d > 0)) return;
            const id =
              typeof crypto !== 'undefined' &&
              typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            setDraft((prev) => ({
              ...prev,
              presets: [
                ...prev.presets,
                {
                  id,
                  name: 'Medida base',
                  width: w,
                  height: h,
                  depth: d,
                },
              ],
            }));
          }}
        />
      </div>

      <div
        className="module-editor__section"
        role="tabpanel"
        id="module-editor-panel-composition"
        aria-labelledby="module-editor-tab-composition"
        hidden={editorTab !== 'composition'}
        data-testid="module-editor-panel-composition"
      >
        <div className="module-editor__section-header">
          <h4 className="module-editor__section-title">
            Composición
            {draft.structureId
              ? ` · ${selectedStructure?.code ?? 'estructura'}`
              : ''}
          </h4>
          <button
            type="button"
            className="btn btn--small"
            disabled={!composedEnabled}
            onClick={() => {
              setAddComponentOpen(true);
              setComponentSearch('');
              setNewCompId('');
              setNewCompQty(1);
            }}
            data-testid="add-component-btn"
          >
            <Plus size={14} className="mr-1" /> Agregar componente
          </button>
        </div>

        <p className="catalog-empty" style={{ marginTop: 0 }}>
          Elegí una estructura base y sumá componentes reutilizables (puerta,
          entrepaño, etc.). Las piezas se derivan al cotizar.
        </p>

        <div className="catalog-form__field">
          <label htmlFor="mod-structure">Estructura base</label>
          <select
            id="mod-structure"
            value={draft.structureId}
            onChange={(e) => {
              const sid = e.target.value;
              const struct = structures.find((s) => s.id === sid);
              setDraft((prev) => ({
                ...prev,
                structureId: sid,
                components: sid ? prev.components : [],
                ...(struct?.externalDims
                  ? {
                      externalWidth: String(struct.externalDims.width),
                      externalHeight: String(struct.externalDims.height),
                      externalDepth: String(struct.externalDims.depth),
                    }
                  : {}),
              }));
            }}
            data-testid="structure-picker"
          >
            <option value="">— Sin estructura —</option>
            {structures
              .filter((s) => s.active !== false)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
          </select>
        </div>

        {composedEnabled && selectedStructure ? (
          <>
            {selectedStructure.components &&
            selectedStructure.components.length > 0 ? (
              <p className="catalog-empty" data-testid="structure-body-hint">
                La estructura aporta {selectedStructure.components.length}{' '}
                componente
                {selectedStructure.components.length === 1 ? '' : 's'} de cuerpo.
                Abajo sumás los de este mueble (puertas, entrepaños, …).
              </p>
            ) : null}

            <h5 className="module-editor__section-title">
              Componentes del mueble ({draft.components.length})
            </h5>

            {draft.components.length === 0 ? (
              <p className="catalog-empty" data-testid="composed-section">
                Sin componentes propios. Agregá reutilizables o cotizá solo con
                el cuerpo de la estructura.
              </p>
            ) : (
              <div
                className="module-part-list"
                data-testid="component-instance-list"
              >
                {draft.components.map((comp, idx) => {
                  const catComp = catalogComponents.find(
                    (c) => c.id === comp.componentId,
                  );
                  return (
                    <div
                      key={`${comp.componentId}-${idx}`}
                      className="module-part-card"
                      data-testid={`component-instance-${idx}`}
                    >
                      <div className="module-part-card__header">
                        <h5 className="module-part-card__title">
                          {catComp
                            ? `${catComp.code} — ${catComp.name}`
                            : comp.componentId}
                        </h5>
                        <button
                          type="button"
                          className="btn btn--small btn--danger"
                          onClick={() => {
                            setDraft((prev) => ({
                              ...prev,
                              components: prev.components.filter(
                                (_, i) => i !== idx,
                              ),
                            }));
                          }}
                          data-testid={`remove-component-${idx}`}
                        >
                          Quitar
                        </button>
                      </div>
                      <div className="module-editor__grid">
                        <div className="catalog-form__field module-editor__field--narrow">
                          <label>Cantidad</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={comp.quantity}
                            onChange={(e) => {
                              const qty = Math.max(1, Number(e.target.value));
                              setDraft((prev) => ({
                                ...prev,
                                components: prev.components.map((c, i) =>
                                  i === idx ? { ...c, quantity: qty } : c,
                                ),
                              }));
                            }}
                            data-testid={`component-qty-${idx}`}
                          />
                        </div>
                        <div className="catalog-form__field">
                          <label>Ubicación (opcional)</label>
                          <select
                            value={comp.placementOverride ?? ''}
                            onChange={(e) => {
                              setDraft((prev) => ({
                                ...prev,
                                components: prev.components.map((c, i) =>
                                  i === idx
                                    ? {
                                        ...c,
                                        placementOverride:
                                          e.target.value || undefined,
                                      }
                                    : c,
                                ),
                              }));
                            }}
                            data-testid={`component-placement-${idx}`}
                          >
                            <option value="">— Del componente —</option>
                            {COMPONENT_PLACEMENTS.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className="catalog-empty" data-testid="composed-section">
            Seleccioná una estructura base para componer el mueble.
          </p>
        )}
      </div>

      <div
        className="module-editor__section"
        role="tabpanel"
        id="module-editor-panel-hardware"
        aria-labelledby="module-editor-tab-hardware"
        hidden={editorTab !== 'hardware'}
        data-testid="module-editor-panel-hardware"
      >
        <div className="module-editor__section-header">
          <h4 className="module-editor__section-title">
            Herrajes ({draft.hardwareLines.length})
          </h4>
          <button
            type="button"
            className="btn btn--small"
            onClick={addHardwareLine}
          >
            Agregar herraje
          </button>
        </div>
        {draft.hardwareLines.length === 0 ? (
          <p className="catalog-empty">Sin líneas de herraje.</p>
        ) : (
          <div
            className="module-part-list"
            data-testid="module-hardware-grid"
            onKeyDown={onHardwareGridKeyDown}
          >
            {draft.hardwareLines.map((line, index) => (
              <div key={line.id} className="module-part-card">
                <div className="module-part-card__header">
                  <h5 className="module-part-card__title">
                    Herraje {index + 1}
                  </h5>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => removeHardwareLine(line.id)}
                  >
                    Quitar
                  </button>
                </div>
                <div className="module-editor__grid">
                  <div className="catalog-form__field">
                    <label htmlFor={moduleHardwareGridInputId(line.id, 'mode')}>
                      Modo
                    </label>
                    <select
                      id={moduleHardwareGridInputId(line.id, 'mode')}
                      data-grid-row={line.id}
                      data-grid-field="mode"
                      value={line.mode}
                      onChange={(e) => {
                        const mode = e.target.value as 'role' | 'fixed';
                        updateLine(line.id, {
                          mode,
                          optionRole:
                            mode === 'fixed'
                              ? line.optionRole || 'FIXED'
                              : line.optionRole === 'FIXED'
                                ? hardwareRoles[0]?.code ?? ''
                                : line.optionRole,
                          hardwareId: mode === 'role' ? '' : line.hardwareId,
                        });
                      }}
                    >
                      <option value="role">Por rol de opción</option>
                      <option value="fixed">Herraje fijo</option>
                    </select>
                  </div>
                  <div className="catalog-form__field">
                    <label htmlFor={moduleHardwareGridInputId(line.id, 'qty')}>
                      Cantidad
                    </label>
                    <input
                      id={moduleHardwareGridInputId(line.id, 'qty')}
                      data-grid-row={line.id}
                      data-grid-field="qty"
                      type="number"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(line.id, {
                          quantity: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  {line.mode === 'role' ? (
                    <div className="catalog-form__field">
                      <label htmlFor={`hw-role-${line.id}`}>
                        Rol (optionRole)
                      </label>
                      <select
                        id={`hw-role-${line.id}`}
                        value={line.optionRole}
                        onChange={(e) =>
                          updateLine(line.id, {
                            optionRole: e.target.value,
                          })
                        }
                      >
                        <option value="">Seleccionar grupo…</option>
                        {hardwareRoles.map((g) => (
                          <option key={g.id} value={g.code}>
                            {g.name} ({g.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <CatalogPicker
                      id={`hw-id-${line.id}`}
                      label="Herraje fijo"
                      placeholder="Seleccionar herraje…"
                      searchPlaceholder="Buscar herraje…"
                      value={line.hardwareId}
                      onChange={(hardwareId) =>
                        updateLine(line.id, {
                          hardwareId,
                          optionRole: line.optionRole || 'FIXED',
                        })
                      }
                      items={activeHardware.map((h) => ({
                        id: h.id,
                        code: h.code,
                        name: h.name,
                        active: h.active,
                      }))}
                      data-testid={`module-hardware-picker-${line.id}`}
                    />
                  )}
                  <div className="catalog-form__field">
                    <label htmlFor={`hw-desc-${line.id}`}>
                      Descripción (opcional)
                    </label>
                    <input
                      id={`hw-desc-${line.id}`}
                      value={line.descriptionOverride}
                      onChange={(e) =>
                        updateLine(line.id, {
                          descriptionOverride: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        role="tabpanel"
        id="module-editor-panel-cost"
        aria-labelledby="module-editor-tab-cost"
        hidden={editorTab !== 'cost'}
        data-testid="module-editor-panel-cost"
      >
        {editingId ? (
          <CostPreviewPanel
            costPreview={costPreview}
            previewBlocked={previewBlocked}
            missingGroups={missingGroups}
            groupLabels={groupLabels}
          />
        ) : (
          <CostPreviewPanel
            costPreview={null}
            previewBlocked={false}
            missingGroups={[]}
            allowEmptyHint
          />
        )}
      </div>
    </form>
  );

  const renderDetail = (mod: Module): ReactNode => {
    const estimate = moduleEstimates[mod.id];
    const chromeSale =
      costPreview?.salePrice ??
      (typeof estimate === 'number' ? estimate : null);
    const categoryLabel = mod.categoryId
      ? categoryPath(mod.categoryId, categories)
          .map((c) => c.name)
          .join(' › ') || 'Categoría'
      : 'Sin categoría';

    return (
    <div className="module-detail" data-testid="module-detail">
      <header className="workspace-chrome" data-testid="module-detail-chrome">
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
            <span className="workspace-chrome__code">{mod.code}</span>
            <div className="workspace-chrome__title-row">
              <h2 className="workspace-chrome__title">{mod.name}</h2>
            </div>
            <p
              className={
                mod.categoryId
                  ? 'workspace-chrome__subtitle'
                  : 'workspace-chrome__subtitle workspace-chrome__subtitle--muted'
              }
              data-testid="module-category-path"
            >
              {categoryLabel}
              {(mod.components?.length ?? 0) > 0 ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>
                    ·
                  </span>
                  {mod.components!.length} componente
                  {mod.components!.length === 1 ? '' : 's'}
                </>
              ) : null}
              <span className="workspace-chrome__dot" aria-hidden>
                ·
              </span>
              {mod.hardwareLines.length} herraje
              {mod.hardwareLines.length === 1 ? '' : 's'}
              {mod.externalDims ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>
                    ·
                  </span>
                  {mod.externalDims.width}×{mod.externalDims.height}×
                  {mod.externalDims.depth} mm
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="workspace-chrome__total" data-testid="module-detail-total">
          <span className="workspace-chrome__total-label">Precio est.</span>
          <span
            className={
              chromeSale == null
                ? 'workspace-chrome__total-value workspace-chrome__total-value--muted'
                : 'workspace-chrome__total-value'
            }
          >
            {chromeSale == null ? '—' : formatModuleMoney(chromeSale)}
          </span>
        </div>
        <div className="workspace-chrome__actions">
          <button
            type="button"
            className="btn btn--outline"
            style={{ marginRight: '8px' }}
            onClick={() => {
              setViewerModule(mod);
              setShow3DModal(true);
            }}
            data-testid="view-3d-btn"
          >
            <Box size={16} strokeWidth={1.5} aria-hidden />
            Vista 3D
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => startEdit(mod)}
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden />
            Editar
          </button>
          {onDuplicate ? (
            <button
              type="button"
              className="btn"
              onClick={() => onDuplicate(mod.id)}
            >
              <Copy size={16} strokeWidth={1.5} aria-hidden />
              Duplicar
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => setConfirmDeleteId(mod.id)}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            Eliminar
          </button>
        </div>
      </header>

      {mod.notes ? (
        <p className="module-detail__notes">{mod.notes}</p>
      ) : null}

      <CostPreviewPanel
        costPreview={costPreview}
        previewBlocked={previewBlocked}
        missingGroups={missingGroups}
        groupLabels={groupLabels}
      />

      <section className="module-detail__section" aria-label="Componentes">
        <h3 className="module-detail__section-title">
          Componentes ({mod.components?.length ?? 0})
        </h3>
        {(mod.components?.length ?? 0) === 0 ? (
          <p className="module-detail__empty">
            Sin componentes. Las piezas se derivan de la estructura + componentes.
          </p>
        ) : (
          mod.components!.map((inst, idx) => {
            const catComp = catalogComponents.find(
              (c) => c.id === inst.componentId,
            );
            return (
              <div
                key={`${inst.componentId}-${idx}`}
                className="module-detail-row"
              >
                <span className="module-detail-row__code">
                  {catComp?.code ?? inst.componentId}
                </span>
                <div className="module-detail-row__main">
                  {catComp?.name ?? 'Componente'}
                  <span className="module-detail-row__sub">
                    {inst.placementOverride
                      ? `Ubicación ${inst.placementOverride}`
                      : (catComp?.placement ?? '—')}
                  </span>
                </div>
                <span className="module-detail-row__qty">
                  ×{inst.quantity}
                </span>
              </div>
            );
          })
        )}
      </section>

      <section className="module-detail__section" aria-label="Herrajes">
        <h3 className="module-detail__section-title">
          Herrajes ({mod.hardwareLines.length})
        </h3>
        {mod.hardwareLines.length === 0 ? (
          <p className="module-detail__empty">Sin líneas de herraje.</p>
        ) : (
          mod.hardwareLines.map((line) => {
            const fixed = line.hardwareId
              ? hardwareById.get(line.hardwareId)
              : undefined;
            const label = fixed
              ? `${fixed.code} — ${fixed.name}`
              : `Rol ${line.optionRole}`;
            return (
              <div key={line.id} className="module-detail-row">
                <span className="module-detail-row__code">
                  {fixed?.code ?? line.optionRole}
                </span>
                <div className="module-detail-row__main">
                  {line.descriptionOverride?.trim() || label}
                  <span className="module-detail-row__sub">
                    {fixed ? 'Herraje fijo' : `Por opción (${line.optionRole})`}
                  </span>
                </div>
                <span className="module-detail-row__qty">×{line.quantity}</span>
              </div>
            );
          })
        )}
      </section>
    </div>
    );
  };

  const renderCategoryTree = (
    parentId: string | undefined,
    depth: number,
  ): ReactNode => {
    const nodes = childrenOf(categories, parentId);
    if (nodes.length === 0) return null;
    return (
      <ul
        className={
          depth === 0
            ? 'module-category-tree__list'
            : 'module-category-tree__list module-category-tree__list--nested'
        }
      >
        {nodes.map((node) => {
          const active = categoryFilter === node.id;
          const count = categoryFilterCounts.byCategoryId.get(node.id) ?? 0;
          return (
            <li key={node.id}>
              <button
                type="button"
                className={
                  active
                    ? 'module-category-tree__item module-category-tree__item--active'
                    : 'module-category-tree__item'
                }
                onClick={() =>
                  setCategoryFilter((prev) =>
                    prev === node.id ? null : node.id,
                  )
                }
                data-testid={`category-filter-${node.id}`}
              >
                <span className="module-category-tree__label">{node.name}</span>
                <span
                  className="module-category-tree__count"
                  data-testid={`category-filter-count-${node.id}`}
                >
                  {count}
                </span>
              </button>
              {renderCategoryTree(node.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

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

  const renderManageCategoryRows = (
    parentId: string | undefined,
    depth: number,
  ): ReactNode => {
    const nodes = childrenOf(categories, parentId);
    if (nodes.length === 0) return null;
    return (
      <ul
        className={
          depth === 0
            ? 'module-category-manage__list'
            : 'module-category-manage__list module-category-manage__list--nested'
        }
        data-testid={depth === 0 ? 'manage-categories-list' : undefined}
      >
        {nodes.map((node) => (
          <li key={node.id}>
            <div className="module-category-manage__row">
              <div className="module-category-manage__row-main">
                <span className="module-category-manage__name">
                  {node.name}
                </span>
                <span className="module-category-manage__meta">
                  Nivel {depth + 1}
                </span>
              </div>
              <span className="module-category-manage__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => openEditCategory(node)}
                  aria-label={`Editar ${node.name}`}
                  data-testid={`manage-category-edit-${node.id}`}
                >
                  <Pencil size={14} strokeWidth={1.5} />
                </button>
                {onDeleteCategory ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => setConfirmDeleteCategoryId(node.id)}
                    aria-label={`Eliminar ${node.name}`}
                    data-testid={`manage-category-delete-${node.id}`}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                ) : null}
              </span>
            </div>
            {renderManageCategoryRows(node.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
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

  const renderList = (): ReactNode => (
    <>
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Muebles</h2>
        <div className="catalog-page__toolbar">
          {canMutate && onCreateCategory ? (
            <button
              type="button"
              className="btn"
              onClick={openManageCategories}
              data-testid="manage-categories"
            >
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Editar categorías
            </button>
          ) : null}
          {canMutate ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={startCreate}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo mueble
          </button>
          ) : null}
        </div>
      </div>

      <div className="module-list-layout">
        <aside
          className="module-category-tree"
          aria-label="Filtro por categorías"
          data-testid="category-filter-panel"
        >
          <div className="module-category-tree__header">
            <h3 className="module-category-tree__title">Filtrar</h3>
            {onCreateCategory ? (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={openManageCategories}
                aria-label="Editar categorías"
                data-testid="category-filter-edit"
              >
                <Pencil size={14} strokeWidth={1.5} aria-hidden />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className={
              categoryFilter === null
                ? 'module-category-tree__item module-category-tree__item--active'
                : 'module-category-tree__item'
            }
            onClick={() => setCategoryFilter(null)}
            data-testid="category-filter-all"
          >
            <span className="module-category-tree__label">Todas</span>
            <span
              className="module-category-tree__count"
              data-testid="category-filter-count-all"
            >
              {categoryFilterCounts.all}
            </span>
          </button>
          <button
            type="button"
            className={
              categoryFilter === UNCATEGORIZED_FILTER
                ? 'module-category-tree__item module-category-tree__item--active'
                : 'module-category-tree__item'
            }
            onClick={() => setCategoryFilter(UNCATEGORIZED_FILTER)}
            data-testid="category-filter-uncategorized"
          >
            <span className="module-category-tree__label">Sin categoría</span>
            <span
              className="module-category-tree__count"
              data-testid="category-filter-count-uncategorized"
            >
              {categoryFilterCounts.uncategorized}
            </span>
          </button>
          {categories.length === 0 ? (
            <p className="module-category-tree__empty">
              Sin categorías. Usá «Editar categorías» para crear la jerarquía.
            </p>
          ) : (
            renderCategoryTree(undefined, 0)
          )}
        </aside>

        <div className="module-list-main">
          {!isTrulyEmpty ? (
            <div className="catalog-page__filters">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar muebles…"
                aria-label="Buscar muebles"
              />
            </div>
          ) : null}

          {isTrulyEmpty ? (
            <EmptyState
              icon={Package}
              title="No hay muebles"
              description="Creá el primer mueble del catálogo o cargá la semilla del workspace."
              actionLabel="Nuevo mueble"
              onAction={startCreate}
            />
          ) : isFilterEmpty ? (
            <EmptyState
              variant="no-results"
              icon={SearchX}
              title="Sin resultados"
              description="No hay muebles que coincidan con el filtro o la búsqueda."
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearch('');
                setCategoryFilter(null);
              }}
            />
          ) : (
            <ul className="module-card-grid" aria-label="Lista de muebles">
              {filtered.map((mod) => (
                <li key={mod.id}>
                  <button
                    type="button"
                    className="module-card"
                    onClick={() => openDetail(mod)}
                    data-testid={`module-card-${mod.id}`}
                  >
                    <span className="module-card__code">{mod.code}</span>
                    <h3 className="module-card__name">{mod.name}</h3>
                    <div className="module-card__stats">
                      <span className="module-card__stat">
                        <Layers size={14} strokeWidth={1.5} aria-hidden />
                        {mod.components?.length ?? 0} componente
                        {(mod.components?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                      <span className="module-card__stat">
                        <Settings2 size={14} strokeWidth={1.5} aria-hidden />
                        {mod.hardwareLines.length} herraje
                        {mod.hardwareLines.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="module-card__cost">
                      <span className="module-card__cost-label">
                        Costo estimado
                      </span>
                      {estimateLabel(mod.id)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );

  if (loading) {
    return (
      <section className="catalog-page" aria-label="Muebles">
        <PageLoading label="Cargando muebles…" data-testid="modules-loading" />
      </section>
    );
  }

  return (
    <section className="catalog-page" aria-label="Muebles (módulos)">
      {selected ? renderDetail(selected) : renderList()}

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
        {renderEditorForm()}
      </Modal>

      {/* Component Adder Modal */}
      <Modal
        open={addComponentOpen}
        onClose={() => setAddComponentOpen(false)}
        title="Agregar componente"
        size="sm"
        data-testid="component-adder-modal"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setAddComponentOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!newCompId}
              onClick={() => {
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
              data-testid="confirm-add-component"
            >
              Agregar
            </button>
          </>
        }
      >
        <div className="catalog-form">
          <div className="catalog-form__field">
            <label htmlFor="comp-adder-search">Buscar componente</label>
            <input
              id="comp-adder-search"
              value={componentSearch}
              onChange={(e) => setComponentSearch(e.target.value)}
              placeholder="Buscar por código o nombre…"
              autoFocus
              data-testid="comp-adder-search"
            />
          </div>

          {filteredCatalogComponents.length === 0 ? (
            <p className="catalog-empty" style={{ fontStyle: 'italic' }}>
              {componentSearch
                ? 'Sin resultados'
                : 'No hay componentes activos en el catálogo.'}
            </p>
          ) : (
            <div
              style={{
                maxHeight: '200px',
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '0.75rem',
              }}
              data-testid="comp-adder-list"
            >
              {filteredCatalogComponents.map((comp) => (
                <label
                  key={comp.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    cursor: 'pointer',
                    background:
                      newCompId === comp.id
                        ? 'color-mix(in srgb, var(--primary) 10%, transparent)'
                        : undefined,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <input
                    type="radio"
                    name="comp-adder-radio"
                    checked={newCompId === comp.id}
                    onChange={() => setNewCompId(comp.id)}
                    data-testid={`comp-radio-${comp.code}`}
                  />
                  <div>
                    <span className="font-mono" style={{ fontSize: 'var(--text-xs)' }}>
                      {comp.code}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', marginLeft: '0.5rem' }}>
                      {comp.name}
                    </span>
                    <span className="text-muted" style={{ fontSize: 'var(--text-xs)', marginLeft: '0.5rem' }}>
                      {comp.optionRoles.join(', ')}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          )}

          {newCompId && (
            <div className="catalog-form__field">
              <label htmlFor="comp-adder-qty">Cantidad</label>
              <input
                id="comp-adder-qty"
                type="number"
                min={1}
                step={1}
                value={newCompQty}
                onChange={(e) =>
                  setNewCompQty(Math.max(1, Number(e.target.value)))
                }
                data-testid="comp-adder-qty"
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={manageCategoriesOpen}
        onClose={closeManageCategories}
        title="Gestionar categorías"
        size="md"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={closeManageCategories}
            >
              Cerrar
            </button>
            {onCreateCategory ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={openCreateCategory}
                data-testid="manage-categories-new"
              >
                <Plus size={16} strokeWidth={1.5} aria-hidden />
                Nueva categoría
              </button>
            ) : null}
          </>
        }
      >
        <div
          className="module-category-manage"
          data-testid="manage-categories-modal"
        >
          <p className="module-category-manage__hint">
            Organizá la jerarquía de muebles (hasta 3 niveles). El panel lateral
            solo filtra la lista.
          </p>
          {categories.length === 0 ? (
            <p className="module-category-manage__empty">
              Todavía no hay categorías. Creá la primera con «Nueva categoría».
            </p>
          ) : (
            renderManageCategoryRows(undefined, 0)
          )}
        </div>
      </Modal>

      <Modal
        open={categoryModalOpen}
        onClose={closeCategoryModal}
        title={editingCategoryId ? 'Editar categoría' : 'Nueva categoría'}
        size="sm"
        footer={
          <>
            <button type="button" className="btn" onClick={closeCategoryModal}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={categoryFormId}
            >
              Guardar
            </button>
          </>
        }
      >
        <form
          id={categoryFormId}
          className="catalog-form"
          onSubmit={handleCategorySubmit}
        >
          {categoryError ? (
            <p className="catalog-form__error">{categoryError}</p>
          ) : null}
          <div className="catalog-form__field">
            <label htmlFor="cat-name">Nombre</label>
            <input
              id="cat-name"
              value={categoryDraft.name}
              onChange={(e) =>
                setCategoryDraft({ ...categoryDraft, name: e.target.value })
              }
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="cat-parent">Padre (opcional)</label>
            <select
              id="cat-parent"
              value={categoryDraft.parentId}
              onChange={(e) =>
                setCategoryDraft({
                  ...categoryDraft,
                  parentId: e.target.value,
                })
              }
            >
              <option value="">— Raíz (nivel 1) —</option>
              {flatCategories
                .filter((row) => row.id !== editingCategoryId && row.depth < 2)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="catalog-form__field">
            <label htmlFor="cat-sort">Orden</label>
            <input
              id="cat-sort"
              type="number"
              value={categoryDraft.sortOrder}
              onChange={(e) =>
                setCategoryDraft({
                  ...categoryDraft,
                  sortOrder: e.target.value,
                })
              }
            />
          </div>
        </form>
      </Modal>

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

      <Modal
        open={deleteCategoryTarget != null}
        onClose={() => setConfirmDeleteCategoryId(null)}
        title="Eliminar categoría"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmDeleteCategoryId(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (confirmDeleteCategoryId) {
                  handleDeleteCategory(confirmDeleteCategoryId);
                }
              }}
            >
              Eliminar
            </button>
          </>
        }
      >
        <p className="project-confirm-modal__text">
          ¿Seguro que querés eliminar la categoría{' '}
          <strong>{deleteCategoryTarget?.name ?? ''}</strong>? Solo se puede
          si no tiene hijos.
        </p>
      </Modal>

      <Modal
        open={show3DModal}
        onClose={() => {
          setShow3DModal(false);
          setViewerModule(null);
        }}
        title={viewerModule ? `Vista 3D — ${viewerModule.code} - ${viewerModule.name}` : 'Vista 3D'}
        size="lg"
      >
        {viewerModule ? (
          <Part3DViewer
            parts={resolved3DParts}
            width={viewerModule.externalDims?.width ?? 800}
            height={viewerModule.externalDims?.height ?? 700}
            depth={viewerModule.externalDims?.depth ?? 500}
          />
        ) : null}
      </Modal>
    </section>
  );
}
