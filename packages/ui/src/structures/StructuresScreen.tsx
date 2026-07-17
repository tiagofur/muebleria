import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Component, Structure, OptionGroup, DimensionPreset } from '@muebles/domain';
import { Eye, EyeOff, Pencil, Plus, Trash2, LayoutGrid } from 'lucide-react';
import {
  EmptyState,
  Modal,
  SearchInput,
  StatusChips,
  useDebouncedValue,
  useRoutableEntitySelection,
} from '../common';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateUniqueCode,
} from '../catalogs';
import { type ComponentInstanceDraft } from '../modules';
import { COMPONENT_PLACEMENTS } from '../components';
type StructureEditorTab = 'general' | 'presets' | 'components';
import './structures.css';
const STRUCTURE_EDITOR_TABS = [
  { id: 'general', label: 'Datos Generales' },
  { id: 'presets', label: 'Presets de Medida' },
  { id: 'components', label: 'Componentes' },
] as const;

export interface StructureDraft {
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  presets: DimensionPreset[];
  components: ComponentInstanceDraft[];
  notes: string;
  active: boolean;
}

const emptyDraft = (): StructureDraft => ({
  code: '',
  name: '',
  widthMm: 0,
  heightMm: 0,
  depthMm: 0,
  presets: [],
  components: [],
  notes: '',
  active: true,
});

function toDraft(item: Structure): StructureDraft {
  return {
    code: item.code,
    name: item.name,
    widthMm: item.externalDims?.width ?? 0,
    heightMm: item.externalDims?.height ?? 0,
    depthMm: item.externalDims?.depth ?? 0,
    notes: item.notes ?? '',
    active: item.active !== false,
    presets: item.presets ? item.presets.map((pr) => ({ ...pr })) : [],
    components: item.components
      ? item.components.map((c) => ({
          componentId: c.componentId,
          quantity: c.quantity,
          placementOverride: c.placementOverride ?? '',
        }))
      : [],
  };
}

export interface StructuresScreenProps {
  readonly structures: readonly Structure[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalogComponents?: readonly Component[];
  readonly onCreate: (draft: StructureDraft) => void;
  readonly onUpdate: (id: string, draft: StructureDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  /** URL handoff: `/structures/:id` expands that row. */
  readonly openStructureId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /** Role matrix: can current user mutate structures? */
  readonly canMutate?: boolean;
}

export function StructuresScreen({
  structures,
  optionGroups,
  catalogComponents = [],
  onCreate,
  onUpdate,
  onDelete,
  onDeactivate,
  onReactivate,
  openStructureId = null,
  onSelectionChange,
  canMutate = true,
}: StructuresScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');

  const structureIds = useMemo(() => structures.map((s) => s.id), [structures]);
  const { selectedId: expandedId, setSelectedId, toggleSelectedId } = useRoutableEntitySelection({
    openEntityId: openStructureId,
    onSelectionChange,
    knownIds: structureIds,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StructureDraft>(emptyDraft);
  const [editorTab, setEditorTab] = useState<StructureEditorTab>('general');
  const [error, setError] = useState<string | null>(null);

  // Deletion confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [previewPresetId, setPreviewPresetId] = useState<string>('');
  const [addComponentOpen, setAddComponentOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const debouncedCompSearch = useDebouncedValue(componentSearch);
  const [newCompId, setNewCompId] = useState('');
  const [newCompQty, setNewCompQty] = useState(1);

  const filteredComponents = useMemo(() => {
    const q = debouncedCompSearch.trim().toLocaleLowerCase('es-UY');
    if (!q) return catalogComponents.filter((c) => c.active);
    return catalogComponents.filter(
      (c) =>
        c.active &&
        (`${c.code} ${c.name}`.toLocaleLowerCase('es-UY').includes(q) ||
          c.optionRoles.some((r) => r.toLocaleLowerCase('es-UY').includes(q))),
    );
  }, [catalogComponents, debouncedCompSearch]);

  useEffect(() => {
    if (draft.presets.length > 0) {
      if (!draft.presets.some((p) => p.id === previewPresetId)) {
        setPreviewPresetId(draft.presets[0]!.id);
      }
    } else {
      setPreviewPresetId('');
    }
  }, [draft.presets, previewPresetId]);

  const addPreset = () => {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraft((prev) => ({
      ...prev,
      presets: [
        ...prev.presets,
        {
          id,
          name: '',
          width: prev.widthMm || 500,
          height: prev.heightMm || 720,
          depth: prev.depthMm || 560,
        },
      ],
    }));
  };

  const removePreset = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      presets: prev.presets.filter((p) => p.id !== id),
    }));
  };

  const updatePreset = (id: string, patch: Partial<DimensionPreset>) => {
    setDraft((prev) => ({
      ...prev,
      presets: prev.presets.map((p) =>
        p.id === id ? ({ ...p, ...patch } as DimensionPreset) : p,
      ),
    }));
  };

  const normalizedStructures = useMemo(() => {
    return structures.map((s) => ({
      ...s,
      active: s.active !== false,
    }));
  }, [structures]);

  const rows = useMemo(
    () =>
      filterCatalogItems(normalizedStructures, {
        status,
        query: debouncedSearch,
      }),
    [normalizedStructures, status, debouncedSearch],
  );

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setEditorTab('general');
    setError(null);
  };

  const handleCreateNew = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  const handleEdit = (item: Structure) => {
    setDraft(toDraft(item));
    setEditingId(item.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const codeError = validateUniqueCode(
      draft.code,
      normalizedStructures,
      editingId ?? undefined,
    );
    if (codeError) {
      setError(codeError);
      return;
    }

    if (draft.presets) {
      for (const pr of draft.presets) {
        if (pr.width <= 0 || pr.height <= 0 || pr.depth <= 0) {
          setError('Las dimensiones de los presets deben ser mayores a 0.');
          return;
        }
      }
    }

    if (draft.components.length === 0) {
      setError(
        'La estructura necesita al menos un componente (por ejemplo laterales o base).',
      );
      return;
    }

    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    closeModal();
  };

  const confirmDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const handleDelete = () => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      if (expandedId === deleteConfirmId) {
        setSelectedId(null);
      }
      setDeleteConfirmId(null);
    }
  };

  return (
    <div className="catalog-screen" data-testid="structures-screen">
      <header className="catalog-screen__header">
        <div>
          <h1 className="catalog-screen__title">Estructuras</h1>
          <p className="catalog-screen__subtitle">
            Cuerpos de ingeniería reutilizables para el taller
          </p>
        </div>
        {canMutate && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleCreateNew}
            data-testid="create-structure-btn"
          >
            <Plus size={16} /> Nueva Estructura
          </button>
        )}
      </header>

      <div className="catalog-screen__filters">
        <div className="catalog-screen__search-wrapper">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código o nombre…"
            data-testid="structure-search"
          />
        </div>
        <StatusChips
          value={status}
          onChange={setStatus}
          data-testid="structure-status-chips"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={search ? 'No se encontraron estructuras' : 'Sin estructuras'}
          description={
            search
              ? 'Probá cambiando el texto de búsqueda o el filtro de estado.'
              : 'Comenzá agregando una estructura de ingeniería reutilizable.'
          }
          actionLabel={canMutate && !search ? 'Crear estructura' : undefined}
          onAction={canMutate && !search ? handleCreateNew : undefined}
          variant={search ? 'no-results' : 'empty'}
        />
      ) : (
        <div className="structure-cards-grid" data-testid="structure-list">
          {rows.map((item) => {
            const isExpanded = expandedId === item.id;
            const dims =
              item.externalDims &&
              (item.externalDims.width > 0 ||
                item.externalDims.height > 0 ||
                item.externalDims.depth > 0)
                ? `${item.externalDims.width} × ${item.externalDims.height} × ${item.externalDims.depth} mm`
                : '—';

            return (
              <div
                key={item.id}
                className={`structure-card ${!item.active ? 'structure-card--inactive' : ''} ${isExpanded ? 'structure-card--expanded' : ''}`}
                data-testid={`structure-card-${item.code}`}
              >
                <div
                  className="structure-card__summary"
                  onClick={() => toggleSelectedId(item.id)}
                >
                  <div className="structure-card__meta">
                    <span className="structure-card__code font-mono">{item.code}</span>
                    {!item.active && (
                      <span className="badge badge--inactive ml-2">Inactivo</span>
                    )}
                  </div>
                  <h3 className="structure-card__name">{item.name}</h3>
                  <div className="structure-card__details-row">
                    <span>
                      Dimensiones: <strong>{dims}</strong>
                    </span>
                    <span>
                      Componentes: <strong>{item.components?.length ?? 0}</strong>
                    </span>
                  </div>
                  {item.notes && (
                    <p className="structure-card__notes-preview">{item.notes}</p>
                  )}
                </div>

                {isExpanded && (
                  <div className="structure-card__expanded-content">
                    {item.presets && item.presets.length > 0 && (
                      <div className="mb-4" data-testid="expanded-presets">
                        <span className="text-small text-muted font-semibold block mb-1">Medidas permitidas (Presets):</span>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {item.presets.map((pr) => (
                            <span key={pr.id} className="badge badge--neutral text-small" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                              {pr.name ? `${pr.name} (${pr.width}x${pr.height}x${pr.depth})` : `${pr.width} × ${pr.height} × ${pr.depth} mm`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {canMutate && (
                      <div className="structure-card__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => handleEdit(item)}
                          data-testid={`edit-btn-${item.code}`}
                        >
                          <Pencil size={14} className="mr-1" /> Editar
                        </button>
                        {item.active ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => onDeactivate(item.id)}
                            data-testid={`deactivate-btn-${item.code}`}
                          >
                            <EyeOff size={14} className="mr-1" /> Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => onReactivate(item.id)}
                            data-testid={`reactivate-btn-${item.code}`}
                          >
                            <Eye size={14} className="mr-1" /> Activar
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--danger btn--small"
                          onClick={() => confirmDelete(item.id)}
                          data-testid={`delete-btn-${item.code}`}
                        >
                          <Trash2 size={14} className="mr-1" /> Eliminar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Main Creation/Edit Modal */}
      <Modal
        open={modalOpen}
        title={editingId ? 'Editar Estructura' : 'Nueva Estructura'}
        onClose={closeModal}
        size="lg"
        data-testid="structure-modal"
      >
          <form id={formId} onSubmit={onSubmit} className="catalog-form">
            {error && (
              <div className="alert alert--danger mb-4" data-testid="form-error">
                {error}
              </div>
            )}

            <div
              className="module-editor__tabs"
              role="tablist"
              aria-label="Secciones del editor de estructura"
              data-testid="structure-editor-tabs"
              style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}
            >
              {STRUCTURE_EDITOR_TABS.map((tab) => {
                const selected = editorTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`structure-editor-tab-${tab.id}`}
                    aria-selected={selected}
                    aria-controls={`structure-editor-panel-${tab.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={
                      selected
                        ? 'module-editor__tab module-editor__tab--active'
                        : 'module-editor__tab'
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      borderBottom: selected ? '2px solid var(--primary)' : '2px solid transparent',
                      color: selected ? 'var(--primary)' : 'var(--text-muted)',
                      padding: '0.75rem 1rem',
                      cursor: 'pointer',
                      fontWeight: selected ? '600' : '400',
                      transition: 'all 0.2s',
                    }}
                    data-testid={`structure-editor-tab-${tab.id}`}
                    onClick={() => setEditorTab(tab.id)}
                  >
                    {tab.label}
                    {tab.id === 'presets' && draft.presets.length > 0
                      ? ` (${draft.presets.length})`
                      : ''}
                  </button>
                );
              })}
            </div>

            {/* TAB PANEL: GENERAL */}
            <div
              role="tabpanel"
              id="structure-editor-panel-general"
              aria-labelledby="structure-editor-tab-general"
              hidden={editorTab !== 'general'}
            >
              <div className="module-editor__grid">
                <div className="catalog-form__field">
                  <label htmlFor={`${formId}-code`}>Código de Estructura</label>
                  <input
                    id={`${formId}-code`}
                    value={draft.code}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, code: e.target.value }))
                    }
                    placeholder="Ej: EST-GAB-720"
                    required
                    disabled={!!editingId}
                    data-testid="input-code"
                  />
                </div>

                <div className="catalog-form__field">
                  <label htmlFor={`${formId}-name`}>Nombre</label>
                  <input
                    id={`${formId}-name`}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Ej: Cuerpo Gabinete Bajo"
                    required
                    data-testid="input-name"
                  />
                </div>
              </div>

              <div className="module-editor__grid">
                <div className="catalog-form__field">
                  <label htmlFor={`${formId}-width`}>Ancho Externo (mm)</label>
                  <input
                    id={`${formId}-width`}
                    type="number"
                    min={0}
                    value={draft.widthMm || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        widthMm: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    placeholder="Opcional"
                    data-testid="input-width"
                  />
                </div>

                <div className="catalog-form__field">
                  <label htmlFor={`${formId}-height`}>Alto Externo (mm)</label>
                  <input
                    id={`${formId}-height`}
                    type="number"
                    min={0}
                    value={draft.heightMm || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        heightMm: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    placeholder="Opcional"
                    data-testid="input-height"
                  />
                </div>

                <div className="catalog-form__field">
                  <label htmlFor={`${formId}-depth`}>Profundidad (mm)</label>
                  <input
                    id={`${formId}-depth`}
                    type="number"
                    min={0}
                    value={draft.depthMm || ''}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        depthMm: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    placeholder="Opcional"
                    data-testid="input-depth"
                  />
                </div>
              </div>

              <div className="catalog-form__field">
                <label htmlFor={`${formId}-notes`}>Notas / Descripción técnica</label>
                <textarea
                  id={`${formId}-notes`}
                  rows={4}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Detalles sobre el armado, cantos especiales..."
                  data-testid="input-notes"
                />
              </div>
            </div>

            {/* TAB PANEL: PRESETS */}
            <div
              role="tabpanel"
              id="structure-editor-panel-presets"
              aria-labelledby="structure-editor-tab-presets"
              hidden={editorTab !== 'presets'}
            >
              {/* Presets de Medidas Editor */}
              <div className="module-editor__parts-header mb-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 className="module-editor__section-title" style={{ margin: 0 }}>Presets de Medidas Permitidas ({draft.presets.length})</h4>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={addPreset}
                  data-testid="add-preset-btn"
                >
                  <Plus size={14} className="mr-1" /> Agregar Preset
                </button>
              </div>

              {draft.presets.length === 0 ? (
                <div className="module-parts-empty" data-testid="presets-empty" style={{ fontStyle: 'italic', color: 'var(--text-muted)', padding: '2rem 1rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                  Sin presets de medida. Si no hay presets, la estructura usará su medida fija por defecto.
                </div>
              ) : (
                <div className="structure-presets-list" data-testid="presets-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem', background: 'var(--bg-card)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  {draft.presets.map((preset, idx) => (
                    <div key={preset.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }} data-testid={`preset-item-${idx}`}>
                      <div className="catalog-form__field" style={{ flex: 2, marginBottom: 0 }}>
                        <input
                          value={preset.name || ''}
                          onChange={(e) => updatePreset(preset.id, { name: e.target.value })}
                          placeholder="Nombre (ej: Gabinete 400)"
                          data-testid={`preset-name-${idx}`}
                        />
                      </div>
                      <div className="catalog-form__field" style={{ flex: 1, marginBottom: 0 }}>
                        <input
                          type="number"
                          min={1}
                          value={preset.width || ''}
                          onChange={(e) => updatePreset(preset.id, { width: Math.max(1, Number(e.target.value)) })}
                          placeholder="Ancho"
                          required
                          data-testid={`preset-width-${idx}`}
                        />
                      </div>
                      <div className="catalog-form__field" style={{ flex: 1, marginBottom: 0 }}>
                        <input
                          type="number"
                          min={1}
                          value={preset.height || ''}
                          onChange={(e) => updatePreset(preset.id, { height: Math.max(1, Number(e.target.value)) })}
                          placeholder="Alto"
                          required
                          data-testid={`preset-height-${idx}`}
                        />
                      </div>
                      <div className="catalog-form__field" style={{ flex: 1, marginBottom: 0 }}>
                        <input
                          type="number"
                          min={1}
                          value={preset.depth || ''}
                          onChange={(e) => updatePreset(preset.id, { depth: Math.max(1, Number(e.target.value)) })}
                          placeholder="Prof."
                          required
                          data-testid={`preset-depth-${idx}`}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn--small btn--danger"
                        onClick={() => removePreset(preset.id)}
                        data-testid={`remove-preset-${idx}`}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {draft.presets.length > 0 && (
                <div className="alert alert--info mb-4" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem' }} data-testid="preview-preset-container">
                  <span style={{ fontWeight: '500' }}>Vista previa de estirado:</span>
                  <select
                    value={previewPresetId}
                    onChange={(e) => setPreviewPresetId(e.target.value)}
                    style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-body)', color: 'var(--text)', cursor: 'pointer' }}
                    data-testid="preview-preset-select"
                  >
                    {draft.presets.map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name || `Preset ${pr.width}x${pr.height}x${pr.depth}`} ({pr.width}x{pr.height}x{pr.depth})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>



            {/* TAB PANEL: COMPONENTS */}
            <div
              role="tabpanel"
              id="structure-editor-panel-components"
              aria-labelledby="structure-editor-tab-components"
              hidden={editorTab !== 'components'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 className="module-editor__section-title" style={{ margin: 0 }}>
                  Componentes ({draft.components.length})
                </h4>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
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

              {draft.components.length === 0 ? (
                <p className="catalog-empty" style={{ fontSize: 'var(--text-sm)' }}>
                  Sin componentes. Agregá componentes reutilizables a esta estructura compuesta.
                </p>
              ) : (
                <div data-testid="component-instance-list">
                  {draft.components.map((comp, idx) => {
                    const catComp = catalogComponents.find(
                      (c) => c.id === comp.componentId,
                    );
                    return (
                      <div
                        key={`${comp.componentId}-${idx}`}
                        className="module-part-card"
                        style={{ marginBottom: '0.5rem' }}
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
            </div>

            <div className="modal__footer mt-6">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={closeModal}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                data-testid="save-btn"
              >
                Guardar
              </button>
            </div>
          </form>
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

          {filteredComponents.length === 0 ? (
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
              {filteredComponents.map((comp) => (
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

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteConfirmId}
        title="¿Eliminar estructura?"
        onClose={() => setDeleteConfirmId(null)}
        size="sm"
        data-testid="delete-confirm-modal"
      >
        <div className="p-4">
          <p className="mb-4">
            ¿Estás seguro de que deseas eliminar esta estructura? Esta acción no se puede deshacer.
          </p>
          <div className="modal__footer">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={handleDelete}
              data-testid="confirm-delete-btn"
            >
              Eliminar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
