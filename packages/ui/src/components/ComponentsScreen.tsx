import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Component, OptionGroup } from '@muebles/domain';
import { Eye, EyeOff, Pencil, Plus, Puzzle, SearchX, Trash2, Check } from 'lucide-react';
import {
  EmptyState,
  Modal,
  SearchInput,
  StatusChips,
  useDebouncedValue,
  useRoutableEntitySelection,
  Part3DViewer,
} from '../common';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateUniqueCode,
} from '../catalogs';
import './components.css';

/** Shared placement options for components and structure/module instances. */
export const COMPONENT_PLACEMENTS: {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: 'base', label: 'Base' },
  { value: 'superior', label: 'Superior' },
  { value: 'lateral_izquierdo', label: 'Lateral Izquierdo' },
  { value: 'lateral_derecho', label: 'Lateral Derecho' },
  { value: 'frontal', label: 'Frontal' },
  { value: 'trasera', label: 'Trasera' },
  { value: 'interno', label: 'Interno' },
  { value: 'puerta', label: 'Puerta' },
  { value: 'frente_cajon', label: 'Frente de Cajón' },
  { value: 'custom', label: 'Personalizado' },
];

export const PLACEMENT_LABEL: Record<string, string> = Object.fromEntries(
  COMPONENT_PLACEMENTS.map((p) => [p.value, p.label]),
);

type ComponentEditorTab = 'general' | 'geometry' | 'edges' | 'options';

const COMPONENT_EDITOR_TABS: readonly {
  readonly id: ComponentEditorTab;
  readonly label: string;
}[] = [
  { id: 'general', label: 'Datos Generales' },
  { id: 'geometry', label: 'Geometría' },
  { id: 'edges', label: 'Cantos' },
  { id: 'options', label: 'Opciones' },
];

export interface ComponentDraft {
  code: string;
  name: string;
  placement: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  lengthFormula: string;
  widthFormula: string;
  xFormula: string;
  yFormula: string;
  zFormula: string;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  edgeL1: boolean;
  edgeL2: boolean;
  edgeW1: boolean;
  edgeW2: boolean;
  optionRoles: string;
  notes: string;
  active: boolean;
}

const emptyDraft = (): ComponentDraft => ({
  code: '',
  name: '',
  placement: 'interno',
  lengthMm: 0,
  widthMm: 0,
  thicknessMm: 0,
  lengthFormula: '',
  widthFormula: '',
  xFormula: '',
  yFormula: '',
  zFormula: '',
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  edgeL1: false,
  edgeL2: false,
  edgeW1: false,
  edgeW2: false,
  optionRoles: '',
  notes: '',
  active: true,
});

function toDraft(item: Component): ComponentDraft {
  const edges = new Map(item.defaultEdges.map((e) => [e.side, e.enabled]));
  return {
    code: item.code,
    name: item.name,
    placement: item.placement,
    lengthMm: item.geometry.kind === 'rectangular_board' ? item.geometry.lengthMm : 0,
    widthMm: item.geometry.kind === 'rectangular_board' ? item.geometry.widthMm : 0,
    thicknessMm: item.geometry.kind === 'rectangular_board' ? item.geometry.thicknessMm : 0,
    lengthFormula: (item.geometry.kind === 'rectangular_board' && item.geometry.lengthFormula) ? item.geometry.lengthFormula : '',
    widthFormula: (item.geometry.kind === 'rectangular_board' && item.geometry.widthFormula) ? item.geometry.widthFormula : '',
    xFormula: item.xFormula ?? '',
    yFormula: item.yFormula ?? '',
    zFormula: item.zFormula ?? '',
    rotateX: item.rotateX ?? 0,
    rotateY: item.rotateY ?? 0,
    rotateZ: item.rotateZ ?? 0,
    edgeL1: edges.get('L1') ?? false,
    edgeL2: edges.get('L2') ?? false,
    edgeW1: edges.get('W1') ?? false,
    edgeW2: edges.get('W2') ?? false,
    optionRoles: item.optionRoles.join(', '),
    notes: item.notes ?? '',
    active: item.active,
  };
}

export interface ComponentsScreenProps {
  readonly components: readonly Component[];
  readonly optionGroups: readonly OptionGroup[];
  readonly onCreate: (draft: ComponentDraft) => void;
  readonly onUpdate: (id: string, draft: ComponentDraft) => void;
  readonly onToggleActive: (id: string) => void;
  readonly canMutate: boolean;
  readonly openComponentId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
}

export function ComponentsScreen({
  components,
  optionGroups,
  onCreate,
  onUpdate,
  onToggleActive,
  canMutate = true,
  openComponentId = null,
  onSelectionChange,
}: ComponentsScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');

  const componentIds = useMemo(() => components.map((c) => c.id), [components]);
  const { selectedId: expandedId, setSelectedId, toggleSelectedId } = useRoutableEntitySelection({
    openEntityId: openComponentId,
    onSelectionChange,
    knownIds: componentIds,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComponentDraft>(emptyDraft);
  const [editorTab, setEditorTab] = useState<ComponentEditorTab>('general');
  const [error, setError] = useState<string | null>(null);

  const previewParts = useMemo(() => {
    return [
      {
        id: 'preview',
        widthMm: draft.widthMm || 300,
        lengthMm: draft.lengthMm || 500,
        thicknessMm: draft.thicknessMm || 18,
        x: 0,
        y: 0,
        z: 0,
        rotateX: draft.rotateX || 0,
        rotateY: draft.rotateY || 0,
        rotateZ: draft.rotateZ || 0,
        optionRole: draft.optionRoles.split(',')[0]?.trim() || 'INTERIOR',
        description: draft.name || 'Componente de Prueba',
        quantity: 1,
        grain: 0 as const,
        edges: [],
        materialId: 'preview-material',
      },
    ];
  }, [draft]);

  const normalizedComponents = useMemo(() => {
    return components.map((c) => ({
      ...c,
      active: c.active !== false,
    }));
  }, [components]);

  const rows = useMemo(
    () =>
      filterCatalogItems(normalizedComponents, {
        status,
        query: debouncedSearch,
      }),
    [normalizedComponents, status, debouncedSearch],
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

  const handleEdit = (item: Component) => {
    setDraft(toDraft(item));
    setEditingId(item.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  const handleToggleActive = (item: Component) => {
    onToggleActive(item.id);
  };

  const geometrySummary = (item: Component): string => {
    if (item.geometry.kind === 'rectangular_board') {
      return `${item.geometry.lengthMm}×${item.geometry.widthMm}×${item.geometry.thicknessMm} mm`;
    }
    return '—';
  };

  const placementLabel = (placement: string): string =>
    PLACEMENT_LABEL[placement] ?? placement;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const codeError = validateUniqueCode(
      draft.code,
      normalizedComponents,
      editingId ?? undefined,
    );
    if (codeError) {
      setError(codeError);
      return;
    }

    if (!draft.code.trim()) {
      setError('El código es obligatorio.');
      return;
    }
    if (!draft.name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (draft.lengthMm <= 0 || draft.widthMm <= 0 || draft.thicknessMm <= 0) {
      setError('Las dimensiones deben ser mayores a 0.');
      return;
    }
    if (!draft.optionRoles.trim()) {
      setError('Debe especificar al menos un Rol de Opción.');
      return;
    }

    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    closeModal();
  };

  return (
    <div className="catalog-screen" data-testid="components-screen">
      <header className="catalog-screen__header">
        <div>
          <h1 className="catalog-screen__title">Componentes</h1>
          <p className="catalog-screen__subtitle">
            Piezas reutilizables de ingeniería para composición de muebles
          </p>
        </div>
        {canMutate && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleCreateNew}
            data-testid="create-component-btn"
          >
            <Plus size={16} /> Nuevo Componente
          </button>
        )}
      </header>

      <div className="catalog-screen__filters">
        <div className="catalog-screen__search-wrapper">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código o nombre…"
          />
        </div>
        <StatusChips
          value={status}
          onChange={setStatus}
          data-testid="component-status-chips"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title={search ? 'No se encontraron componentes' : 'Sin componentes'}
          description={
            search
              ? 'Probá cambiando el texto de búsqueda o el filtro de estado.'
              : 'Comenzá agregando componentes reutilizables para composición.'
          }
          actionLabel={canMutate && !search ? 'Crear componente' : undefined}
          onAction={canMutate && !search ? handleCreateNew : undefined}
          variant={search ? 'no-results' : 'empty'}
        />
      ) : (
        <div className="component-cards-grid" data-testid="component-list">
          {rows.map((item) => {
            const isExpanded = expandedId === item.id;

            return (
              <div
                key={item.id}
                className={`component-card ${!item.active ? 'component-card--inactive' : ''} ${isExpanded ? 'component-card--expanded' : ''}`}
                data-testid={`component-card-${item.code}`}
              >
                <div
                  className="component-card__summary"
                  onClick={() => toggleSelectedId(item.id)}
                >
                  <div className="component-card__meta">
                    <span className="component-card__code font-mono">{item.code}</span>
                    {!item.active && (
                      <span className="badge badge--inactive ml-2">Inactivo</span>
                    )}
                    <span className="component-card__placement-badge">
                      {placementLabel(item.placement)}
                    </span>
                  </div>
                  <h3 className="component-card__name">{item.name}</h3>
                  <div className="component-card__details-row">
                    <span>
                      Geometría: <strong>{geometrySummary(item)}</strong>
                    </span>
                    <span>
                      Roles: <strong>{item.optionRoles.join(', ')}</strong>
                    </span>
                  </div>
                  {item.notes && (
                    <p className="component-card__notes-preview">{item.notes}</p>
                  )}
                </div>

                {isExpanded && (
                  <div className="component-card__expanded-content">
                    <h4 className="component-expanded-title">Cantos por defecto</h4>
                    <div className="component-edges-list">
                      {item.defaultEdges.map((edge) => (
                        <span
                          key={edge.side}
                          className={`component-edge-badge ${edge.enabled ? 'component-edge-badge--on' : 'component-edge-badge--off'}`}
                        >
                          {edge.enabled ? <Check size={12} /> : null}
                          {edge.side}
                        </span>
                      ))}
                    </div>

                    {canMutate && (
                      <div className="component-card__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => handleEdit(item)}
                          data-testid={`edit-btn-${item.code}`}
                        >
                          <Pencil size={14} className="mr-1" /> Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => handleToggleActive(item)}
                          data-testid={`toggle-active-btn-${item.code}`}
                        >
                          {item.active ? (
                            <><EyeOff size={14} className="mr-1" /> Desactivar</>
                          ) : (
                            <><Eye size={14} className="mr-1" /> Activar</>
                          )}
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

      <Modal
        open={modalOpen}
        title={editingId ? 'Editar Componente' : 'Nuevo Componente'}
        onClose={closeModal}
        size="lg"
        data-testid="component-modal"
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
            aria-label="Secciones del editor de componente"
            data-testid="component-editor-tabs"
            style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}
          >
            {COMPONENT_EDITOR_TABS.map((tab) => {
              const selected = editorTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`component-editor-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`component-editor-panel-${tab.id}`}
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
                  data-testid={`component-editor-tab-${tab.id}`}
                  onClick={() => setEditorTab(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* TAB: Datos Generales */}
          <div
            role="tabpanel"
            id="component-editor-panel-general"
            aria-labelledby="component-editor-tab-general"
            hidden={editorTab !== 'general'}
            data-testid="component-editor-panel-general"
          >
            <div className="module-editor__grid">
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-code`}>Código</label>
                <input
                  id={`${formId}-code`}
                  value={draft.code}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, code: e.target.value }))
                  }
                  placeholder="Ej: COM-PUE-01"
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
                  placeholder="Ej: Puerta"
                  required
                  data-testid="input-name"
                />
              </div>
            </div>

            <div className="module-editor__grid">
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-placement`}>Ubicación</label>
                <select
                  id={`${formId}-placement`}
                  value={draft.placement}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, placement: e.target.value }))
                  }
                  required
                  data-testid="input-placement"
                >
                  {COMPONENT_PLACEMENTS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="catalog-form__field">
              <label htmlFor={`${formId}-notes`}>Notas / Descripción técnica</label>
              <textarea
                id={`${formId}-notes`}
                rows={3}
                value={draft.notes}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Especificaciones adicionales..."
                data-testid="input-notes"
              />
            </div>
          </div>

          {/* TAB: Geometría */}
          <div
            role="tabpanel"
            id="component-editor-panel-geometry"
            aria-labelledby="component-editor-tab-geometry"
            hidden={editorTab !== 'geometry'}
            data-testid="component-editor-panel-geometry"
          >
            <p className="text-small text-muted mb-4">
              Dimensiones de la pieza de tablero rectangular.
            </p>
            <div className="module-editor__grid mb-4">
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-length`}>Largo Base (mm)</label>
                <input
                  id={`${formId}-length`}
                  type="number"
                  min={1}
                  value={draft.lengthMm || ''}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      lengthMm: Math.max(0, Number(e.target.value)),
                    }))
                  }
                  required
                  data-testid="input-length"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-width`}>Ancho Base (mm)</label>
                <input
                  id={`${formId}-width`}
                  type="number"
                  min={1}
                  value={draft.widthMm || ''}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      widthMm: Math.max(0, Number(e.target.value)),
                    }))
                  }
                  required
                  data-testid="input-width"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-thickness`}>Espesor Base (mm)</label>
                <input
                  id={`${formId}-thickness`}
                  type="number"
                  min={1}
                  value={draft.thicknessMm || ''}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      thicknessMm: Math.max(0, Number(e.target.value)),
                    }))
                  }
                  required
                  data-testid="input-thickness"
                />
              </div>
            </div>

            <div className="module-editor__grid mb-4">
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-length-formula`}>Fórmula de Largo (e.g. PH - 31)</label>
                <input
                  id={`${formId}-length-formula`}
                  type="text"
                  value={draft.lengthFormula}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      lengthFormula: e.target.value,
                    }))
                  }
                  placeholder="H"
                  data-testid="input-length-formula"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-width-formula`}>Fórmula de Ancho (e.g. PW - 31)</label>
                <input
                  id={`${formId}-width-formula`}
                  type="text"
                  value={draft.widthFormula}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      widthFormula: e.target.value,
                    }))
                  }
                  placeholder="D"
                  data-testid="input-width-formula"
                />
              </div>
            </div>

            <div className="module-editor__grid mb-4">
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-x-formula`}>Fórmula Posición X (e.g. i * (PW - T))</label>
                <input
                  id={`${formId}-x-formula`}
                  type="text"
                  value={draft.xFormula}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      xFormula: e.target.value,
                    }))
                  }
                  placeholder="0"
                  data-testid="input-x-formula"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-y-formula`}>Fórmula Posición Y</label>
                <input
                  id={`${formId}-y-formula`}
                  type="text"
                  value={draft.yFormula}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      yFormula: e.target.value,
                    }))
                  }
                  placeholder="0"
                  data-testid="input-y-formula"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-z-formula`}>Fórmula Posición Z</label>
                <input
                  id={`${formId}-z-formula`}
                  type="text"
                  value={draft.zFormula}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      zFormula: e.target.value,
                    }))
                  }
                  placeholder="0"
                  data-testid="input-z-formula"
                />
              </div>
            </div>

            <div className="module-editor__grid mb-4">
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-rotate-x`}>Rotación X (grados)</label>
                <input
                  id={`${formId}-rotate-x`}
                  type="number"
                  value={draft.rotateX}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      rotateX: Number(e.target.value),
                    }))
                  }
                  placeholder="0"
                  data-testid="input-rotate-x"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-rotate-y`}>Rotación Y (grados)</label>
                <input
                  id={`${formId}-rotate-y`}
                  type="number"
                  value={draft.rotateY}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      rotateY: Number(e.target.value),
                    }))
                  }
                  placeholder="0"
                  data-testid="input-rotate-y"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-rotate-z`}>Rotación Z (grados)</label>
                <input
                  id={`${formId}-rotate-z`}
                  type="number"
                  value={draft.rotateZ}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      rotateZ: Number(e.target.value),
                    }))
                  }
                  placeholder="0"
                  data-testid="input-rotate-z"
                />
              </div>
            </div>

            <div className="component-editor__preview-section mt-4 mb-4">
              <label className="mb-2 block text-small font-medium" style={{ display: 'block', margin: '12px 0 6px 0' }}>
                Vista Previa 3D de la Pieza
              </label>
              <Part3DViewer
                parts={previewParts}
                width={(draft.widthMm || 300) * 1.5}
                height={(draft.thicknessMm || 18) * 1.5}
                depth={(draft.lengthMm || 500) * 1.5}
              />
            </div>
          </div>

          {/* TAB: Cantos */}
          <div
            role="tabpanel"
            id="component-editor-panel-edges"
            aria-labelledby="component-editor-tab-edges"
            hidden={editorTab !== 'edges'}
            data-testid="component-editor-panel-edges"
          >
            <p className="text-small text-muted mb-4">
              Seleccioná los cantos que llevan cintilla por defecto.
            </p>
            <div
              className="module-edge-flags"
              role="group"
              aria-label="Cantos por defecto"
              data-testid="component-edges-group"
            >
              {(
                [
                  ['edgeL1', 'L1'],
                  ['edgeL2', 'L2'],
                  ['edgeW1', 'W1'],
                  ['edgeW2', 'W2'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="component-edge-check">
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    data-testid={`edge-${label}`}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* TAB: Opciones */}
          <div
            role="tabpanel"
            id="component-editor-panel-options"
            aria-labelledby="component-editor-tab-options"
            hidden={editorTab !== 'options'}
            data-testid="component-editor-panel-options"
          >
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-optionRoles`}>
                Roles de Opción
              </label>
              <select
                id={`${formId}-optionRoles`}
                multiple
                value={draft.optionRoles.split(',').map((s) => s.trim()).filter(Boolean)}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
                  setDraft((prev) => ({ ...prev, optionRoles: selected.join(', ') }));
                }}
                required
                data-testid="input-optionRoles"
                className="catalog-form__multi-select"
              >
                {optionGroups.map((g) => (
                  <option key={g.id} value={g.code}>
                    {g.code} — {g.name} ({g.kind === 'board' ? 'Tablero' : g.kind === 'hardware' ? 'Herraje' : 'Canto'})
                  </option>
                ))}
              </select>
              <p className="text-small text-muted mt-1">
                Grupos de opciones que aplican a este componente. Mantené Ctrl/Cmd para seleccionar múltiples.
              </p>
            </div>
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
    </div>
  );
}
