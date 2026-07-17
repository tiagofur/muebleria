/**
 * Engineering catalog of reusable furniture components (H06 / #101, H08 / #103).
 */
import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  FurnitureComponent,
  FurnitureComponentKind,
  OptionGroup,
} from '@muebles/domain';
import {
  FURNITURE_COMPONENT_KINDS,
  furnitureComponentKindLabelEs,
  isFurnitureComponentKind,
} from '@muebles/domain';
import { Box, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
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
import {
  boardPartToDraft,
  emptyBoardPartDraft,
  emptyHardwareLineDraft,
  edgesFromFlags,
  hardwareLineToDraft,
  optionGroupsForBoardParts,
  type BoardPartDraft,
  type HardwareLineDraft,
} from '../modules';
import '../structures/structures.css';

type EditorTab = 'general' | 'parts' | 'hardware';

const EDITOR_TABS = [
  { id: 'general' as const, label: 'Datos' },
  { id: 'parts' as const, label: 'Piezas' },
  { id: 'hardware' as const, label: 'Herrajes' },
];

export interface ComponentDraft {
  code: string;
  name: string;
  kind: FurnitureComponentKind;
  notes: string;
  active: boolean;
  boardParts: BoardPartDraft[];
  hardwareLines: HardwareLineDraft[];
}

const emptyDraft = (): ComponentDraft => ({
  code: '',
  name: '',
  kind: 'puerta',
  notes: '',
  active: true,
  boardParts: [],
  hardwareLines: [],
});

function toDraft(item: FurnitureComponent): ComponentDraft {
  return {
    code: item.code,
    name: item.name,
    kind: isFurnitureComponentKind(item.kind) ? item.kind : 'otro',
    notes: item.notes ?? '',
    active: item.active !== false,
    boardParts: item.boardParts.map((p) => boardPartToDraft(p)),
    hardwareLines: item.hardwareLines.map((l) => hardwareLineToDraft(l)),
  };
}

export interface ComponentsScreenProps {
  readonly components: readonly FurnitureComponent[];
  readonly optionGroups: readonly OptionGroup[];
  readonly onCreate: (draft: ComponentDraft) => void;
  readonly onUpdate: (id: string, draft: ComponentDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  readonly openComponentId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  readonly canMutate?: boolean;
}

function nextId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ComponentsScreen({
  components,
  optionGroups,
  onCreate,
  onUpdate,
  onDelete,
  onDeactivate,
  onReactivate,
  openComponentId = null,
  onSelectionChange,
  canMutate = true,
}: ComponentsScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const ids = useMemo(() => components.map((c) => c.id), [components]);
  const { selectedId: expandedId, setSelectedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId: openComponentId,
      onSelectionChange,
      knownIds: ids,
    });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComponentDraft>(emptyDraft);
  const [tab, setTab] = useState<EditorTab>('general');
  const [formError, setFormError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      filterCatalogItems(
        components.map((c) => ({
          ...c,
          active: c.active !== false,
        })),
        { query: debouncedSearch, status },
      ),
    [components, debouncedSearch, status],
  );

  const boardGroups = useMemo(
    () => optionGroupsForBoardParts(optionGroups),
    [optionGroups],
  );
  const hwGroups = useMemo(
    () => optionGroups.filter((g) => g.kind === 'hardware'),
    [optionGroups],
  );

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setTab('general');
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (item: FurnitureComponent) => {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setTab('general');
    setFormError(null);
    setModalOpen(true);
  };

  const validate = (): string | null => {
    if (!draft.code.trim() || !draft.name.trim()) {
      return 'Código y nombre son obligatorios.';
    }
    const unique = validateUniqueCode(
      draft.code,
      components.map((c) => ({
        id: c.id,
        code: c.code,
        active: c.active !== false,
      })),
      editingId ?? undefined,
    );
    if (unique) return unique;
    if (draft.boardParts.length === 0 && draft.hardwareLines.length === 0) {
      return 'Agregá al menos una pieza o un herraje.';
    }
    for (const p of draft.boardParts) {
      if (!p.description.trim() || !p.optionRole.trim()) {
        return 'Cada pieza necesita descripción y rol de opción.';
      }
      if (p.lengthMm <= 0 || p.widthMm <= 0 || p.quantity < 1) {
        return 'Medidas y cantidad de piezas deben ser mayores a 0.';
      }
    }
    return null;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    if (editingId) onUpdate(editingId, draft);
    else onCreate(draft);
    setModalOpen(false);
  };

  return (
    <section className="structures-screen" data-testid="components-screen">
      <header className="structures-screen__header">
        <div>
          <h2 className="structures-screen__title">Componentes</h2>
          <p className="structures-screen__lead">
            Puertas, entrepaños y otros adosables reutilizables en varios
            muebles.
          </p>
        </div>
        {canMutate ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={openCreate}
            data-testid="component-create"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo componente
          </button>
        ) : null}
      </header>

      <div className="catalog-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por código o nombre…"
          aria-label="Buscar componentes"
        />
        <StatusChips value={status} onChange={setStatus} />
      </div>

      {components.length === 0 ? (
        <EmptyState
          variant="empty"
          icon={Box}
          title="Sin componentes"
          description="Creá una Puerta o un Entrepaño para reutilizarlos al armar muebles."
          actionLabel={canMutate ? 'Nuevo componente' : undefined}
          onAction={canMutate ? openCreate : undefined}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="no-results"
          icon={SearchX}
          title="Sin resultados"
          description="Probá otro término o filtro de estado."
          actionLabel="Limpiar filtros"
          onAction={() => {
            setSearch('');
            setStatus('active');
          }}
        />
      ) : (
        <ul className="structures-grid">
          {rows.map((c) => {
            const expanded = expandedId === c.id;
            const kind = isFurnitureComponentKind(c.kind) ? c.kind : 'otro';
            return (
              <li key={c.id}>
                <article
                  className={
                    expanded
                      ? 'structure-card structure-card--expanded'
                      : 'structure-card'
                  }
                  data-testid={`component-card-${c.id}`}
                >
                  <button
                    type="button"
                    className="structure-card__hit"
                    onClick={() => toggleSelectedId(c.id)}
                    data-testid={`component-card-open-${c.id}`}
                  >
                    <p className="structure-card__code">{c.code}</p>
                    <h3 className="structure-card__name">{c.name}</h3>
                    <p className="structure-card__meta">
                      {furnitureComponentKindLabelEs(kind)} ·{' '}
                      {c.boardParts.length} piezas · {c.hardwareLines.length}{' '}
                      herrajes
                    </p>
                  </button>
                  {expanded ? (
                    <div className="structure-card__detail">
                      {c.notes ? <p>{c.notes}</p> : null}
                      <ul>
                        {c.boardParts.map((p) => (
                          <li key={p.id}>
                            {p.description} — {p.lengthMm}×{p.widthMm} mm
                            {p.lengthFormula ? ` (${p.lengthFormula})` : ''}
                          </li>
                        ))}
                      </ul>
                      {canMutate ? (
                        <div className="structure-card__actions">
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => openEdit(c)}
                            data-testid={`component-edit-${c.id}`}
                          >
                            <Pencil size={14} strokeWidth={1.5} aria-hidden />
                            Editar
                          </button>
                          {c.active !== false ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() => onDeactivate(c.id)}
                            >
                              Desactivar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() => onReactivate(c.id)}
                            >
                              Reactivar
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--ghost btn--small"
                            onClick={() => onDelete(c.id)}
                            data-testid={`component-delete-${c.id}`}
                          >
                            <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                            Eliminar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Editar componente' : 'Nuevo componente'}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form={formId}
              className="btn btn--primary"
              data-testid="component-save"
            >
              Guardar
            </button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="structure-form">
          <div className="structure-form__tabs" role="tablist">
            {EDITOR_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={
                  tab === t.id
                    ? 'structure-form__tab structure-form__tab--active'
                    : 'structure-form__tab'
                }
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {formError ? (
            <p className="form-error" role="alert" data-testid="component-form-error">
              {formError}
            </p>
          ) : null}

          {tab === 'general' ? (
            <div className="structure-form__panel">
              <label className="field">
                <span className="field__label">Código</span>
                <input
                  className="input"
                  value={draft.code}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, code: e.target.value }))
                  }
                  data-testid="component-code"
                  required
                />
              </label>
              <label className="field">
                <span className="field__label">Nombre</span>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  data-testid="component-name"
                  required
                />
              </label>
              <label className="field">
                <span className="field__label">Tipo</span>
                <select
                  className="input"
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      kind: e.target.value as FurnitureComponentKind,
                    }))
                  }
                  data-testid="component-kind"
                >
                  {FURNITURE_COMPONENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {furnitureComponentKindLabelEs(k)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Notas</span>
                <textarea
                  className="input"
                  rows={2}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                />
              </label>
            </div>
          ) : null}

          {tab === 'parts' ? (
            <div className="structure-form__panel">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    boardParts: [...d.boardParts, emptyBoardPartDraft(nextId())],
                  }))
                }
                data-testid="component-add-part"
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Pieza
              </button>
              {draft.boardParts.map((p, idx) => (
                <div key={p.id} className="structure-form__part-row">
                  <input
                    className="input"
                    placeholder="Descripción"
                    value={p.description}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        boardParts: d.boardParts.map((x, i) =>
                          i === idx
                            ? { ...x, description: e.target.value }
                            : x,
                        ),
                      }))
                    }
                  />
                  <input
                    className="input"
                    type="number"
                    placeholder="Largo mm"
                    value={p.lengthMm || ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        boardParts: d.boardParts.map((x, i) =>
                          i === idx
                            ? { ...x, lengthMm: Number(e.target.value) || 0 }
                            : x,
                        ),
                      }))
                    }
                  />
                  <input
                    className="input"
                    type="number"
                    placeholder="Ancho mm"
                    value={p.widthMm || ''}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        boardParts: d.boardParts.map((x, i) =>
                          i === idx
                            ? { ...x, widthMm: Number(e.target.value) || 0 }
                            : x,
                        ),
                      }))
                    }
                  />
                  <input
                    className="input"
                    placeholder="Fórmula L (ej. H-4)"
                    value={p.lengthFormula}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        boardParts: d.boardParts.map((x, i) =>
                          i === idx
                            ? { ...x, lengthFormula: e.target.value }
                            : x,
                        ),
                      }))
                    }
                  />
                  <input
                    className="input"
                    placeholder="Fórmula A (ej. W/2)"
                    value={p.widthFormula}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        boardParts: d.boardParts.map((x, i) =>
                          i === idx
                            ? { ...x, widthFormula: e.target.value }
                            : x,
                        ),
                      }))
                    }
                  />
                  <select
                    className="input"
                    value={p.optionRole}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        boardParts: d.boardParts.map((x, i) =>
                          i === idx
                            ? { ...x, optionRole: e.target.value }
                            : x,
                        ),
                      }))
                    }
                  >
                    <option value="">Rol…</option>
                    {boardGroups.map((g) => (
                      <option key={g.id} value={g.code}>
                        {g.code}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        boardParts: d.boardParts.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {tab === 'hardware' ? (
            <div className="structure-form__panel">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    hardwareLines: [
                      ...d.hardwareLines,
                      emptyHardwareLineDraft(nextId()),
                    ],
                  }))
                }
                data-testid="component-add-hw"
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Herraje
              </button>
              {draft.hardwareLines.map((l, idx) => (
                <div key={l.id} className="structure-form__part-row">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        hardwareLines: d.hardwareLines.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                quantity:
                                  Math.max(1, Math.floor(Number(e.target.value)) || 1),
                              }
                            : x,
                        ),
                      }))
                    }
                  />
                  <select
                    className="input"
                    value={l.optionRole}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        hardwareLines: d.hardwareLines.map((x, i) =>
                          i === idx
                            ? { ...x, optionRole: e.target.value, mode: 'role' }
                            : x,
                        ),
                      }))
                    }
                  >
                    <option value="">Rol herraje…</option>
                    {hwGroups.map((g) => (
                      <option key={g.id} value={g.code}>
                        {g.code}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        hardwareLines: d.hardwareLines.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </form>
      </Modal>
    </section>
  );
}

/** Map draft → domain entity (caller assigns id). */
export function componentDraftToEntity(
  id: string,
  draft: ComponentDraft,
): FurnitureComponent {
  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    kind: draft.kind,
    notes: draft.notes.trim() || undefined,
    active: draft.active,
    boardParts: draft.boardParts.map((p) => ({
      id: p.id,
      code: p.code.trim() || undefined,
      description: p.description.trim(),
      quantity: p.quantity,
      lengthMm: p.lengthMm,
      widthMm: p.widthMm,
      edges: edgesFromFlags(p.edgeL1, p.edgeL2, p.edgeW1, p.edgeW2),
      optionRole: p.optionRole.trim(),
      lengthFormula: p.lengthFormula?.trim() || undefined,
      widthFormula: p.widthFormula?.trim() || undefined,
    })),
    hardwareLines: draft.hardwareLines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      descriptionOverride: l.descriptionOverride.trim() || undefined,
      optionRole:
        l.mode === 'fixed'
          ? l.optionRole.trim() || 'FIXED'
          : l.optionRole.trim(),
      hardwareId:
        l.mode === 'fixed' && l.hardwareId.trim()
          ? l.hardwareId.trim()
          : undefined,
    })),
  };
}
