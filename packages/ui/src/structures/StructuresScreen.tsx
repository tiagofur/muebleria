import {
  useEffect,
  useId,
  useMemo,
  useState,
  useRef,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Structure, OptionGroup, DimensionPreset } from '@muebles/domain';
import { evaluatePartFormula } from '@muebles/domain';
import { Eye, EyeOff, Layers, Pencil, Plus, SearchX, Trash2, LayoutGrid, Check } from 'lucide-react';
import {
  EmptyState,
  Modal,
  SearchInput,
  SpatialPartFields,
  StatusChips,
  useDebouncedValue,
  useRoutableEntitySelection,
} from '../common';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateUniqueCode,
} from '../catalogs';
import {
  boardPartToDraft,
  emptyBoardPartDraft,
  edgesFromFlags,
  optionGroupsForBoardParts,
  suggestPartCode,
  type BoardPartDraft,
} from '../modules';
type StructureEditorTab = 'general' | 'presets' | 'parts';
import './structures.css';
const STRUCTURE_EDITOR_TABS = [
  { id: 'general', label: 'Datos Generales' },
  { id: 'presets', label: 'Presets de Medida' },
  { id: 'parts', label: 'Piezas de Tablero' },
] as const;

export interface StructureDraft {
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  boardParts: BoardPartDraft[];
  presets: DimensionPreset[];
  notes: string;
  active: boolean;
}

const emptyDraft = (): StructureDraft => ({
  code: '',
  name: '',
  widthMm: 0,
  heightMm: 0,
  depthMm: 0,
  boardParts: [],
  presets: [],
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
    boardParts: item.boardParts.map((p) => boardPartToDraft(p)),
    presets: item.presets ? item.presets.map((pr) => ({ ...pr })) : [],
  };
}

export interface StructuresScreenProps {
  readonly structures: readonly Structure[];
  readonly optionGroups: readonly OptionGroup[];
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

  const boardRoles = useMemo(
    () => optionGroupsForBoardParts(optionGroups),
    [optionGroups],
  );

  const [previewPresetId, setPreviewPresetId] = useState<string>('');

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

  const getResolvedPartSizes = (part: BoardPartDraft) => {
    const selectedPreset = draft.presets.find((p) => p.id === previewPresetId);
    const dims = selectedPreset
      ? { W: selectedPreset.width, H: selectedPreset.height, D: selectedPreset.depth }
      : { W: draft.widthMm || 0, H: draft.heightMm || 0, D: draft.depthMm || 0 };

    let resolvedLength = part.lengthMm;
    let resolvedWidth = part.widthMm;
    let lengthErr = '';
    let widthErr = '';

    if (part.lengthFormula) {
      try {
        resolvedLength = evaluatePartFormula(part.lengthFormula, dims);
      } catch (err) {
        lengthErr = 'Fórmula inválida';
      }
    }

    if (part.widthFormula) {
      try {
        resolvedWidth = evaluatePartFormula(part.widthFormula, dims);
      } catch (err) {
        widthErr = 'Fórmula inválida';
      }
    }

    return { resolvedLength, resolvedWidth, lengthErr, widthErr };
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

  const addBoardPart = () => {
    const id = `part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraft((prev) => {
      const index = prev.boardParts.length + 1;
      const part = emptyBoardPartDraft(id);
      part.code = suggestPartCode(prev.code || 'EST', index);
      if (boardRoles[0]) {
        part.optionRole = boardRoles[0].code;
      }
      return {
        ...prev,
        boardParts: [...prev.boardParts, part],
      };
    });
  };

  const removeBoardPart = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      boardParts: prev.boardParts.filter((p) => p.id !== id),
    }));
  };

  const updatePart = (id: string, patch: Partial<BoardPartDraft>) => {
    setDraft((prev) => ({
      ...prev,
      boardParts: prev.boardParts.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
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

    if (draft.boardParts.length === 0) {
      setError('Una estructura debe tener al menos una pieza.');
      return;
    }

    for (const p of draft.boardParts) {
      if (!p.code.trim()) {
        setError('Todas las piezas deben tener un código.');
        return;
      }
      if (!p.description.trim()) {
        setError('Todas las piezas deben tener una descripción.');
        return;
      }
      if (p.quantity <= 0) {
        setError('La cantidad de cada pieza debe ser mayor a 0.');
        return;
      }
      if (p.lengthMm <= 0 || p.widthMm <= 0) {
        setError('El largo y ancho de cada pieza debe ser mayor a 0.');
        return;
      }
      if (!p.optionRole) {
        setError('Todas las piezas deben tener asignado un Rol (grupo de opciones).');
        return;
      }
    }

    if (draft.presets) {
      for (const pr of draft.presets) {
        if (pr.width <= 0 || pr.height <= 0 || pr.depth <= 0) {
          setError('Las dimensiones de los presets deben ser mayores a 0.');
          return;
        }
      }
    }

    // Validate formulas
    const mockDims = draft.presets.length > 0
      ? { W: draft.presets[0]!.width, H: draft.presets[0]!.height, D: draft.presets[0]!.depth }
      : { W: draft.widthMm || 500, H: draft.heightMm || 720, D: draft.depthMm || 560 };

    for (const p of draft.boardParts) {
      if (p.lengthFormula?.trim()) {
        try {
          evaluatePartFormula(p.lengthFormula, mockDims);
        } catch (e) {
          setError(`Fórmula de largo inválida para la pieza ${p.code}: ${(e as Error).message}`);
          return;
        }
      }
      if (p.widthFormula?.trim()) {
        try {
          evaluatePartFormula(p.widthFormula, mockDims);
        } catch (e) {
          setError(`Fórmula de ancho inválida para la pieza ${p.code}: ${(e as Error).message}`);
          return;
        }
      }
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
                      Piezas: <strong>{item.boardParts.length}</strong>
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

                    <h4 className="structure-expanded-title">Piezas del cuerpo</h4>
                    <div className="table-responsive">
                      <table className="catalog-table">
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Descripción</th>
                            <th className="text-right">Cant</th>
                            <th className="text-right">Largo (mm)</th>
                            <th className="text-right">Ancho (mm)</th>
                            <th>Fórmulas</th>
                            <th>Rol / Grupo</th>
                            <th>Cantos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.boardParts.map((p) => {
                            const edges = p.edges
                              .filter((e) => e.enabled)
                              .map((e) => e.side)
                              .join(', ');
                            const formulas = [
                              p.lengthFormula ? `L: ${p.lengthFormula}` : null,
                              p.widthFormula ? `A: ${p.widthFormula}` : null,
                            ].filter(Boolean).join(' | ');

                            return (
                              <tr key={p.id}>
                                <td className="font-mono text-small">{p.code || '—'}</td>
                                <td>{p.description}</td>
                                <td className="text-right">{p.quantity}</td>
                                <td className="text-right font-mono">{p.lengthMm}</td>
                                <td className="text-right font-mono">{p.widthMm}</td>
                                <td className="text-small font-mono text-muted">{formulas || '—'}</td>
                                <td className="text-small">{p.optionRole}</td>
                                <td className="text-small text-muted">{edges || 'Ninguno'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

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
                    {tab.id === 'parts' && draft.boardParts.length > 0
                      ? ` (${draft.boardParts.length})`
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

            {/* TAB PANEL: PARTS */}
            <div
              role="tabpanel"
              id="structure-editor-panel-parts"
              aria-labelledby="structure-editor-tab-parts"
              hidden={editorTab !== 'parts'}
            >
              <div className="module-editor__parts-header mb-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 className="module-editor__section-title" style={{ margin: 0 }}>Piezas de Tablero ({draft.boardParts.length})</h4>
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={addBoardPart}
                  data-testid="add-part-btn"
                >
                  <Plus size={14} className="mr-1" /> Agregar Pieza
                </button>
              </div>

              {draft.boardParts.length === 0 ? (
                <div className="module-parts-empty" data-testid="parts-empty" style={{ padding: '2rem 1rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                  Sin piezas. Agregá al menos una pieza de tablero para esta estructura.
                </div>
              ) : (
                <div className="module-part-list" data-testid="parts-list">
                  {draft.boardParts.map((part, index) => (
                    <div key={part.id} className="module-part-card" data-testid={`part-item-${index}`}>
                      <div className="module-part-card__header">
                        <h5 className="module-part-card__title">Pieza {index + 1}</h5>
                        <button
                          type="button"
                          className="btn btn--small btn--danger"
                          onClick={() => removeBoardPart(part.id)}
                          data-testid={`remove-part-${index}`}
                        >
                          Quitar
                        </button>
                      </div>

                      <div className="module-editor__grid module-editor__grid--part">
                        <div className="catalog-form__field module-editor__field--grow">
                          <label>Código pieza</label>
                          <input
                            value={part.code}
                            onChange={(e) =>
                              updatePart(part.id, { code: e.target.value })
                            }
                            placeholder={suggestPartCode(draft.code || 'EST', index + 1)}
                            required
                            data-testid={`part-code-${index}`}
                          />
                        </div>
                        <div className="catalog-form__field module-editor__field--grow">
                          <label>Descripción</label>
                          <input
                            value={part.description}
                            onChange={(e) =>
                              updatePart(part.id, { description: e.target.value })
                            }
                            required
                            data-testid={`part-desc-${index}`}
                          />
                        </div>
                        <div className="catalog-form__field module-editor__field--narrow">
                          <label>Cant</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={part.quantity}
                            onChange={(e) =>
                              updatePart(part.id, {
                                quantity: Math.max(1, Number(e.target.value)),
                              })
                            }
                            required
                            data-testid={`part-qty-${index}`}
                          />
                        </div>
                        <div className="catalog-form__field module-editor__field--narrow">
                          <label>Largo (mm)</label>
                          <input
                            type="number"
                            min={1}
                            value={part.lengthMm || ''}
                            onChange={(e) =>
                              updatePart(part.id, {
                                lengthMm: Math.max(0, Number(e.target.value)),
                              })
                            }
                            required
                            data-testid={`part-length-${index}`}
                          />
                        </div>
                        <div className="catalog-form__field module-editor__field--narrow">
                          <label>Ancho (mm)</label>
                          <input
                            type="number"
                            min={1}
                            value={part.widthMm || ''}
                            onChange={(e) =>
                              updatePart(part.id, {
                                widthMm: Math.max(0, Number(e.target.value)),
                              })
                            }
                            required
                            data-testid={`part-width-${index}`}
                          />
                        </div>
                      </div>

                      <div className="module-editor__grid module-editor__grid--part-formulas" style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                        <div className="catalog-form__field" style={{ flex: 1, marginBottom: 0 }}>
                          <label className="text-small text-muted" style={{ fontSize: '0.75rem', fontWeight: '500' }}>Fórmula Largo (mm)</label>
                          <input
                            value={part.lengthFormula || ''}
                            onChange={(e) => updatePart(part.id, { lengthFormula: e.target.value })}
                            placeholder="Ej: H o W - 36"
                            data-testid={`part-length-formula-${index}`}
                          />
                        </div>
                        <div className="catalog-form__field" style={{ flex: 1, marginBottom: 0 }}>
                          <label className="text-small text-muted" style={{ fontSize: '0.75rem', fontWeight: '500' }}>Fórmula Ancho (mm)</label>
                          <input
                            value={part.widthFormula || ''}
                            onChange={(e) => updatePart(part.id, { widthFormula: e.target.value })}
                            placeholder="Ej: D o D - 10"
                            data-testid={`part-width-formula-${index}`}
                          />
                        </div>
                      </div>

                      <SpatialPartFields
                        testIdPrefix={`struct-part-${index}`}
                        value={{
                          face: part.face,
                          placement: part.placement,
                          originXFormula: part.originXFormula,
                          originYFormula: part.originYFormula,
                          originZFormula: part.originZFormula,
                          designThicknessMm: part.designThicknessMm,
                        }}
                        onChange={(patch) => updatePart(part.id, patch)}
                      />

                      {((part.lengthFormula || part.widthFormula) && (draft.presets.length > 0 || (draft.widthMm > 0 || draft.heightMm > 0 || draft.depthMm > 0))) && (
                        <div className="text-small text-muted" style={{ fontStyle: 'italic', display: 'flex', gap: '1rem', marginBottom: '0.5rem', fontSize: '0.75rem' }} data-testid={`part-resolved-preview-${index}`}>
                          <span>
                            Largo resuelto: <strong style={{ color: 'var(--text)' }}>{getResolvedPartSizes(part).lengthErr ? 'Error' : `${getResolvedPartSizes(part).resolvedLength} mm`}</strong>
                          </span>
                          <span>
                            Ancho resuelto: <strong style={{ color: 'var(--text)' }}>{getResolvedPartSizes(part).widthErr ? 'Error' : `${getResolvedPartSizes(part).resolvedWidth} mm`}</strong>
                          </span>
                        </div>
                      )}

                      <div className="module-part-card__role-edges">
                        <div className="catalog-form__field module-part-card__role">
                          <label>Rol (optionRole)</label>
                          <select
                            value={part.optionRole}
                            onChange={(e) =>
                              updatePart(part.id, { optionRole: e.target.value })
                            }
                            required
                            data-testid={`part-role-${index}`}
                          >
                            <option value="">Seleccionar grupo…</option>
                            {boardRoles.map((g) => (
                              <option key={g.id} value={g.code}>
                                {g.name} ({g.code})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="module-edge-flags" role="group" aria-label="Cantos (cintillas)">
                          <span className="module-edge-flags__label">Cantos</span>
                          {(
                            [
                              ['edgeL1', 'L1'],
                              ['edgeL2', 'L2'],
                              ['edgeW1', 'W1'],
                              ['edgeW2', 'W2'],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              <input
                                type="checkbox"
                                checked={part[key]}
                                onChange={(e) =>
                                  updatePart(part.id, { [key]: e.target.checked })
                                }
                                data-testid={`part-edge-${label}-${index}`}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
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
