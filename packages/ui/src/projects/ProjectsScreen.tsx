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
  Customer,
  EdgeBand,
  ExportIssue,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  QuoteBreakdown,
} from '@muebles/domain';
import {
  cascadeOptions,
  cascadeSelectedCategoryId,
  filterModulesByCategory,
  isProjectClosed,
  type CategoryFilterId,
} from '@muebles/domain';
import {
  AlertCircle,
  ChevronLeft,
  Copy,
  FileText,
  Package,
  Pencil,
  Plus,
  SearchX,
  Trash2,
} from 'lucide-react';
import { CatalogPicker } from '../catalogs/CatalogPicker';
import {
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
import {
  customersForProjectPicker,
  defaultChoicesForNewItem,
  emptyAddItemDraft,
  emptyProjectDraft,
  filterProjectsByQuery,
  formatIsoDate,
  formatProjectMoney,
  groupsForModuleItem,
  optionsForGroup,
  PROJECT_STATUSES,
  projectStatusBadgeClass,
  projectStatusLabel,
  projectToDraft,
  resolveCustomerName,
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
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
  /** Catalog customers for name lookup on cards / detail / search. */
  readonly customers?: readonly Customer[];
  readonly onCreate: (draft: ProjectDraft) => void;
  readonly onUpdate: (id: string, draft: ProjectDraft) => void;
  readonly onDelete: (id: string) => void;
  /** Deep-copy project as draft (F015). Shell owns ids/timestamps. */
  readonly onDuplicate?: (id: string) => void;
  readonly onAddItem: (
    projectId: string,
    input: { moduleId: string; quantity: number; optionChoices: OptionChoices },
  ) => void;
  readonly onUpdateItem: (projectId: string, item: ProjectItem) => void;
  readonly onRemoveItem: (projectId: string, itemId: string) => void;
  /**
   * Notifies parent when the selected project id changes (null = list / none).
   * Parent computes domain breakdown and passes breakdown props.
   */
  readonly onSelectionChange?: (projectId: string | null) => void;
  /** Domain QuoteBreakdown from shell (PRJ-06, UX-03). Null when blocked/unavailable. */
  readonly breakdown?: QuoteBreakdown | null;
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
}

function StatusBadge({ status }: { readonly status: Project['status'] }): ReactNode {
  return (
    <span className={`status-badge ${projectStatusBadgeClass(status)}`}>
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {projectStatusLabel(status)}
    </span>
  );
}

export function ProjectsScreen({
  projects,
  modules,
  categories = [],
  optionGroups,
  materials,
  edges,
  hardware,
  customers = [],
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  onSelectionChange,
  breakdown = null,
  breakdownLoading = false,
  breakdownError = null,
  previewBlocked = false,
  missingGroups = [],
  groupLabels,
  onExport,
  onExportHardware,
  exportErrors = [],
  exportBusy = false,
  exportBlocked = false,
  projectEstimates = {},
  openProjectId = null,
  requestCreateKey = 0,
  loading = false,
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
  const [draft, setDraft] = useState<ProjectDraft>(emptyProjectDraft);
  /** When true, meta form uses free-text name to create a customer on submit. */
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [addItem, setAddItem] = useState<AddItemDraft>(() =>
    emptyAddItemDraft(modules, optionGroups),
  );
  const [itemError, setItemError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveItemId, setConfirmRemoveItemId] = useState<string | null>(
    null,
  );

  const catalogs = useMemo(
    () => ({ materials, edges, hardware }),
    [materials, edges, hardware],
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
    setDraft(emptyProjectDraft());
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
    setDraft(emptyProjectDraft());
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
    setDraft(emptyProjectDraft());
    setNewCustomerMode(false);
    setError(null);
    setMetaModalOpen(true);
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
    setAddItem({
      moduleId,
      quantity: addItem.quantity || 1,
      optionChoices: mod
        ? defaultChoicesForNewItem(mod, optionGroups)
        : {},
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
    for (const group of groups) {
      if (!addItem.optionChoices[group.code]) {
        setItemError(`Falta elegir: ${group.name} (${group.code}).`);
        return;
      }
    }

    setItemError(null);
    onAddItem(selectedId, {
      moduleId: addItem.moduleId,
      quantity: addItem.quantity,
      optionChoices: addItem.optionChoices,
    });
    closeAddItemModal();
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
    const optionChoices: OptionChoices = {
      ...item.optionChoices,
      [groupCode]: optionId,
    };
    onUpdateItem(selectedId, { ...item, optionChoices });
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
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {projectStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
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
                ? 'Sin módulos en este filtro'
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
      </div>

      {addGroups.length === 0 ? (
        <p className="catalog-empty" style={{ marginTop: 'var(--space-3)' }}>
          Este mueble no tiene grupos de opción requeridos.
        </p>
      ) : (
        <div className="project-item-choices" style={{ marginTop: 'var(--space-3)' }}>
          {addGroups.map((group) => {
            const options = optionsForGroup(group, catalogs);
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
                      optionChoices: {
                        ...addItem.optionChoices,
                        [group.code]: e.target.value,
                      },
                    })
                  }
                >
                  <option value="">Seleccionar…</option>
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
        Podés agregar el mismo mueble más de una vez con distintas opciones.
      </p>
    </form>
  );

  const renderList = (): ReactNode => (
    <>
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Proyectos / Cotización</h2>
        <div className="catalog-page__toolbar">
          <button
            type="button"
            className="btn btn--primary"
            onClick={startCreate}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo proyecto
          </button>
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar proyectos o clientes…"
            aria-label="Buscar proyectos"
          />
        </div>
      ) : null}

      {isTrulyEmpty ? (
        <EmptyState
          icon={FileText}
          title="No hay proyectos"
          description="Creá la primera cotización para un cliente y agregá muebles del catálogo."
          actionLabel="Nuevo proyecto"
          onAction={startCreate}
        />
      ) : isFilterEmpty ? (
        <EmptyState
          variant="no-results"
          icon={SearchX}
          title="Sin resultados"
          description="No hay proyectos que coincidan con la búsqueda."
          actionLabel="Limpiar filtros"
          onAction={() => setSearch('')}
        />
      ) : (
        <ul className="project-card-grid" aria-label="Lista de proyectos">
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

  const renderDetail = (project: Project): ReactNode => (
    <div className="project-detail" data-testid="project-detail">
      <div className="project-detail__top">
        <div className="project-detail__identity">
          <button
            type="button"
            className="btn btn--ghost btn--small project-detail__back"
            onClick={backToList}
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
            Volver a la lista
          </button>
          <div className="project-detail__title-row">
            <h2 className="project-detail__title">{project.name}</h2>
            <StatusBadge status={project.status} />
          </div>
          <p className="project-detail__client">
            {resolveCustomerName(project.customerId, customers)}
          </p>
          <div className="project-detail__meta">
            <span>
              {project.items.length} mueble
              {project.items.length === 1 ? '' : 's'}
            </span>
            <span>{project.currency}</span>
            <span>Margen ×{project.marginFactor.toFixed(2)}</span>
            <span>Actualizado {formatIsoDate(project.updatedAt)}</span>
          </div>
          {project.notes ? (
            <p className="project-detail__notes">{project.notes}</p>
          ) : null}
        </div>
        <div className="project-detail__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => startEditMeta(project)}
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden />
            Editar proyecto
          </button>
          {onDuplicate ? (
            <button
              type="button"
              className="btn"
              onClick={() => onDuplicate(project.id)}
            >
              <Copy size={16} strokeWidth={1.5} aria-hidden />
              Duplicar
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            Eliminar
          </button>
        </div>
      </div>

      <div className="project-detail__body">
        <section
          className="project-detail__section project-detail__items"
          aria-label="Ítems de cotización"
        >
          <div className="project-detail__section-header">
            <h3 className="project-detail__section-title">
              Muebles ({project.items.length})
            </h3>
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
                          : `Módulo desconocido (${item.moduleId})`}
                      </h4>
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
                    </div>

                    {groups.length === 0 ? (
                      <p className="catalog-empty">
                        Este mueble no tiene grupos de opción requeridos.
                      </p>
                    ) : (
                      <div className="project-item-choices">
                        {groups.map((group) => {
                          const options = optionsForGroup(group, catalogs);
                          return (
                            <div
                              key={group.id}
                              className="catalog-form__field"
                            >
                              <label
                                htmlFor={`choice-${item.id}-${group.code}`}
                              >
                                {group.name} ({group.code})
                              </label>
                              <select
                                id={`choice-${item.id}-${group.code}`}
                                value={item.optionChoices[group.code] ?? ''}
                                onChange={(e) =>
                                  updateItemChoice(
                                    item,
                                    group.code,
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="">Seleccionar…</option>
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
                <div>
                  <dt>Materiales</dt>
                  <dd>{formatProjectMoney(breakdown.materialsCost)}</dd>
                </div>
                <div>
                  <dt>Cantos</dt>
                  <dd>{formatProjectMoney(breakdown.edgeTotal)}</dd>
                </div>
                <div>
                  <dt>Herrajes</dt>
                  <dd>{formatProjectMoney(breakdown.hardwareTotal)}</dd>
                </div>
                <div>
                  <dt>Costo directo</dt>
                  <dd>{formatProjectMoney(breakdown.directCost)}</dd>
                </div>
                <div>
                  <dt>MO modular</dt>
                  <dd>{formatProjectMoney(breakdown.laborModular)}</dd>
                </div>
                <div>
                  <dt>MO fija</dt>
                  <dd>{formatProjectMoney(breakdown.laborFixedCost)}</dd>
                </div>
                <div>
                  <dt>Factor margen</dt>
                  <dd>{breakdown.marginFactor.toFixed(2)}</dd>
                </div>
                <div className="project-totals__sale-row">
                  <dt>Precio de venta</dt>
                  <dd className="project-totals__sale">
                    {formatProjectMoney(breakdown.salePrice)}
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

          <div className="project-totals__exports">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!onExport || exportDisabled}
              title={
                onExport
                  ? 'Exportar cut-list Optimizer (.xlsx)'
                  : 'Export Optimizer no disponible en este shell'
              }
              onClick={() => {
                void onExport?.();
              }}
            >
              {exportBusy ? 'Exportando…' : 'Exportar Optimizer'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!onExportHardware || exportDisabled}
              title={
                onExportHardware
                  ? 'Exportar lista de herrajes para compras (.xlsx)'
                  : 'Export lista de herrajes no disponible en este shell'
              }
              onClick={() => {
                void onExportHardware?.();
              }}
            >
              {exportBusy ? 'Exportando…' : 'Lista de herrajes'}
            </button>
          </div>

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

  if (loading) {
    return (
      <section className="catalog-page" aria-label="Cotizaciones">
        <PageLoading label="Cargando cotizaciones…" data-testid="projects-loading" />
      </section>
    );
  }

  return (
    <section className="catalog-page" aria-label="Proyectos y cotización">
      {selectedProject ? renderDetail(selectedProject) : renderList()}

      <Modal
        open={metaModalOpen}
        onClose={closeMetaModal}
        title={metaEditingId ? 'Editar proyecto' : 'Nuevo proyecto'}
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

      <Modal
        open={confirmDelete && selectedProject != null}
        onClose={() => setConfirmDelete(false)}
        title="Eliminar proyecto"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setConfirmDelete(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (selectedProject) handleDelete(selectedProject.id);
              }}
            >
              Eliminar
            </button>
          </>
        }
      >
        <p className="project-confirm-modal__text">
          ¿Seguro que querés eliminar{' '}
          <strong>{selectedProject?.name ?? 'este proyecto'}</strong>? Esta
          acción no se puede deshacer.
        </p>
      </Modal>
    </section>
  );
}
