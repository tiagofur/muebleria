/**
 * Materials (MaterialBoard) catalog ABM — list + search + chips + modal SM (F020).
 * F027: material links default edge band by id; create-edge shortcut from form.
 */

import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { EdgeBand, MaterialBoard } from '@muebles/domain';
import { Eye, EyeOff, Layers, Pencil, Plus } from 'lucide-react';
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
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
} from './catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from './CatalogTable';
import type { EdgeDraft } from './EdgesCatalog';
import './catalogs.css';

export type MaterialDraft = {
  code: string;
  name: string;
  widthMm: number;
  lengthMm: number;
  thicknessMm: number;
  grainDefault: boolean;
  boardPrice: number;
  wastePercent: number;
  costPerM2: number;
  /** Linked EdgeBand id (never by name). Empty string = none. */
  defaultEdgeBandId: string;
  notes: string;
};

/** Inputs the shell needs to compute costPerM2 (domain formula stays out of UI). */
export type MaterialCostInputs = {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly boardPrice: number;
  readonly wastePercent: number;
};

const emptyDraft = (): MaterialDraft => ({
  code: '',
  name: '',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 15,
  grainDefault: false,
  boardPrice: 0,
  wastePercent: 0,
  costPerM2: 0,
  defaultEdgeBandId: '',
  notes: '',
});

function toDraft(item: MaterialBoard): MaterialDraft {
  return {
    code: item.code,
    name: item.name,
    widthMm: item.widthMm,
    lengthMm: item.lengthMm,
    thicknessMm: item.thicknessMm,
    grainDefault: item.grainDefault,
    boardPrice: item.boardPrice,
    wastePercent: item.wastePercent,
    costPerM2: item.costPerM2,
    defaultEdgeBandId: item.defaultEdgeBandId ?? '',
    notes: item.notes ?? '',
  };
}

const emptyEdgeDraft = (): EdgeDraft => ({
  code: '',
  name: '',
  thicknessMm: 0.5,
  costPerMl: 0,
  notes: '',
});

export interface MaterialsCatalogProps {
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly onCreate: (draft: MaterialDraft) => void;
  readonly onUpdate: (id: string, draft: MaterialDraft) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  /** Creates an edge band and returns its new id (for linking as default). */
  readonly onCreateEdge: (draft: EdgeDraft) => string;
  /**
   * Domain formula injected by the shell (architecture.md: UI does not calculate).
   * Used for live preview and to fill draft.costPerM2 on save.
   */
  readonly getCostPerM2: (input: MaterialCostInputs) => number;
  /** URL handoff: `/materials/:id` expands that row. */
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
}

export function MaterialsCatalog({
  materials,
  edges,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  onCreateEdge,
  getCostPerM2,
  openEntityId = null,
  onSelectionChange,
}: MaterialsCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const materialIds = useMemo(() => materials.map((m) => m.id), [materials]);
  const { selectedId: expandedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId,
      onSelectionChange,
      knownIds: materialIds,
    });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MaterialDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [edgeCreateOpen, setEdgeCreateOpen] = useState(false);
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft>(emptyEdgeDraft);
  const [edgeError, setEdgeError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      filterCatalogItems(materials, {
        status,
        query: debouncedSearch,
      }),
    [materials, status, debouncedSearch],
  );

  const activeEdges = useMemo(
    () => edges.filter((e) => e.active),
    [edges],
  );

  const edgeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of edges) {
      map.set(e.id, e.name);
    }
    return map;
  }, [edges]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
    setModalOpen(true);
  };

  const startEdit = (item: MaterialBoard) => {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setError(null);
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
    setModalOpen(true);
  };

  const openCreateEdge = () => {
    const name = draft.name.trim();
    const code = draft.code.trim();
    setEdgeDraft({
      code: code ? `CAN-${code.replace(/^TAB-?/i, '')}` : '',
      name: name || '',
      thicknessMm: 0.5,
      costPerMl: 0,
      notes: '',
    });
    setEdgeError(null);
    setEdgeCreateOpen(true);
  };

  const submitCreateEdge = () => {
    const codeErr = validateUniqueCode(edgeDraft.code, edges);
    if (codeErr) {
      setEdgeError(codeErr);
      return;
    }
    const nameErr = validateRequiredName(edgeDraft.name);
    if (nameErr) {
      setEdgeError(nameErr);
      return;
    }
    const numErr =
      validateNonNegativeNumber(edgeDraft.thicknessMm, 'Espesor canto (mm)') ??
      validateNonNegativeNumber(edgeDraft.costPerMl, 'Costo / ML');
    if (numErr) {
      setEdgeError(numErr);
      return;
    }
    const newId = onCreateEdge(edgeDraft);
    setDraft((d) => ({ ...d, defaultEdgeBandId: newId }));
    setEdgeCreateOpen(false);
    setEdgeDraft(emptyEdgeDraft());
    setEdgeError(null);
  };

  const toggleExpand = (item: MaterialBoard) => {
    toggleSelectedId(item.id);
  };

  const validate = (): string | null => {
    const codeErr = validateUniqueCode(
      draft.code,
      materials,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;
    return (
      validateNonNegativeNumber(draft.widthMm, 'Ancho (mm)') ??
      validateNonNegativeNumber(draft.lengthMm, 'Largo (mm)') ??
      validateNonNegativeNumber(draft.thicknessMm, 'Espesor (mm)') ??
      validateNonNegativeNumber(draft.boardPrice, 'Precio del tablero') ??
      validateNonNegativeNumber(draft.wastePercent, 'Merma (%)')
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    const calculatedCost = getCostPerM2({
      widthMm: draft.widthMm,
      lengthMm: draft.lengthMm,
      boardPrice: draft.boardPrice,
      wastePercent: draft.wastePercent,
    });
    const finalDraft = { ...draft, costPerM2: calculatedCost };

    if (editingId) {
      onUpdate(editingId, finalDraft);
    } else {
      onCreate(finalDraft);
    }
    closeModal();
  };

  const columns: CatalogColumn<MaterialBoard>[] = useMemo(
    () => [
      {
        key: 'code',
        header: 'Código',
        render: (r) => (
          <span className="catalog-row-detail__value--mono">{r.code}</span>
        ),
      },
      { key: 'name', header: 'Nombre', render: (r) => r.name },
      {
        key: 'thickness',
        header: 'Espesor (mm)',
        render: (r) => r.thicknessMm,
      },
      {
        key: 'dimensions',
        header: 'Medidas (mm)',
        render: (r) => `${r.lengthMm} × ${r.widthMm}`,
      },
      {
        key: 'boardPrice',
        header: 'Precio Hoja',
        render: (r) => `$${r.boardPrice.toFixed(2)}`,
      },
      {
        key: 'waste',
        header: 'Merma (%)',
        render: (r) => `${r.wastePercent}%`,
      },
      {
        key: 'cost',
        header: 'Costo/m²',
        render: (r) => `$${r.costPerM2.toFixed(2)}`,
      },
      {
        key: 'status',
        header: 'Estado',
        render: (r) => <ActiveBadge active={r.active} />,
      },
    ],
    [],
  );

  const isTrulyEmpty = materials.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

  return (
    <section className="catalog-page" aria-label="Catálogo de materiales">
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Materiales (tableros)</h2>
        <div className="catalog-page__toolbar">
          <button type="button" className="btn btn--primary" onClick={startCreate}>
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo material
          </button>
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar materiales…"
            aria-label="Buscar materiales"
          />
          <StatusChips value={status} onChange={setStatus} />
        </div>
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={Layers}
            title="No hay materiales"
            description="Agregá el primer tablero del catálogo o cargá la semilla del workspace."
            actionLabel="Agregar material"
            onAction={startCreate}
          />
        ) : isFilterEmpty ? (
          <p className="catalog-empty-filter">
            No hay materiales que coincidan con la búsqueda o el filtro.
          </p>
        ) : (
          <CatalogTable
            columns={columns}
            rows={rows}
            expandedId={expandedId}
            isInactive={(r) => !r.active}
            onRowClick={toggleExpand}
            renderExpandedDetail={(row) => (
              <>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Código</span>
                  <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                    {row.code}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Nombre</span>
                  <span className="catalog-row-detail__value">{row.name}</span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Espesor</span>
                  <span className="catalog-row-detail__value">
                    {row.thicknessMm} mm
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Medidas (Largo × Ancho)</span>
                  <span className="catalog-row-detail__value">
                    {row.lengthMm} mm × {row.widthMm} mm
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Veta por defecto</span>
                  <span className="catalog-row-detail__value">
                    {row.grainDefault ? 'Sí' : 'No'}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Cintilla default</span>
                  <span className="catalog-row-detail__value">
                    {row.defaultEdgeBandId
                      ? (edgeNameById.get(row.defaultEdgeBandId) ??
                        row.defaultEdgeBandId)
                      : '—'}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Precio Tablero</span>
                  <span className="catalog-row-detail__value">
                    ${row.boardPrice.toFixed(2)}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Merma</span>
                  <span className="catalog-row-detail__value">
                    {row.wastePercent}%
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Costo / m² (con merma)</span>
                  <span className="catalog-row-detail__value">
                    ${row.costPerM2.toFixed(2)}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Estado</span>
                  <span className="catalog-row-detail__value">
                    <ActiveBadge active={row.active} />
                  </span>
                </div>
                {row.notes ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Notas</span>
                    <span className="catalog-row-detail__value">{row.notes}</span>
                  </div>
                ) : null}
                <div className="catalog-row-detail__actions">
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => startEdit(row)}
                  >
                    <Pencil size={14} strokeWidth={1.5} aria-hidden />
                    Editar
                  </button>
                  {row.active ? (
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={() => onDeactivate(row.id)}
                    >
                      <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                      Desactivar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => onReactivate(row.id)}
                    >
                      <Eye size={14} strokeWidth={1.5} aria-hidden />
                      Reactivar
                    </button>
                  )}
                </div>
              </>
            )}
            getRowActions={(row) => (
              <>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  aria-label={`Editar ${row.code}`}
                  onClick={() => startEdit(row)}
                >
                  <Pencil size={14} strokeWidth={1.5} aria-hidden />
                  Editar
                </button>
                {row.active ? (
                  <button
                    type="button"
                    className="btn btn--small btn--ghost btn--danger"
                    aria-label={`Desactivar ${row.code}`}
                    onClick={() => onDeactivate(row.id)}
                  >
                    <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                    Desactivar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    aria-label={`Reactivar ${row.code}`}
                    onClick={() => onReactivate(row.id)}
                  >
                    <Eye size={14} strokeWidth={1.5} aria-hidden />
                    Reactivar
                  </button>
                )}
              </>
            )}
          />
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar material' : 'Nuevo material'}
        size="sm"
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
        <form id={formId} className="catalog-form" onSubmit={handleSubmit}>
          {error ? <p className="catalog-form__error">{error}</p> : null}

          <div className="catalog-form__field">
            <label htmlFor="mat-code">Código</label>
            <input
              id="mat-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-name">Nombre</label>
            <input
              id="mat-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-thickness">Espesor (mm)</label>
            <input
              id="mat-thickness"
              type="number"
              min={0}
              step="any"
              value={draft.thicknessMm}
              onChange={(e) =>
                setDraft({ ...draft, thicknessMm: Number(e.target.value) })
              }
              required
            />
          </div>
          <div className="catalog-form__field catalog-form__row-check">
            <input
              id="mat-grain"
              type="checkbox"
              checked={draft.grainDefault}
              onChange={(e) =>
                setDraft({ ...draft, grainDefault: e.target.checked })
              }
            />
            <label htmlFor="mat-grain">Veta por defecto</label>
          </div>

          <div className="catalog-form__field">
            <label htmlFor="mat-default-edge">Cintilla por defecto</label>
            <div className="catalog-form__inline-actions">
              <select
                id="mat-default-edge"
                value={draft.defaultEdgeBandId}
                onChange={(e) =>
                  setDraft({ ...draft, defaultEdgeBandId: e.target.value })
                }
              >
                <option value="">— Sin cintilla —</option>
                {activeEdges.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} — {e.name} ({e.thicknessMm} mm)
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--small"
                onClick={openCreateEdge}
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Crear cintilla
              </button>
            </div>
            <p className="catalog-form__hint">
              Link por id (no por nombre). Se usa cuando la pieza tiene cantos y
              la cotización no elige un grupo EDGE.
            </p>
          </div>

          {edgeCreateOpen ? (
            <div
              className="catalog-form__nested"
              role="group"
              aria-label="Nueva cintilla"
            >
              <p className="catalog-form__nested-title">Nueva cintilla</p>
              {edgeError ? (
                <p className="catalog-form__error">{edgeError}</p>
              ) : null}
              <div className="catalog-form__field">
                <label htmlFor="mat-edge-code">Código canto</label>
                <input
                  id="mat-edge-code"
                  value={edgeDraft.code}
                  onChange={(e) =>
                    setEdgeDraft({ ...edgeDraft, code: e.target.value })
                  }
                  autoComplete="off"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor="mat-edge-name">Nombre canto</label>
                <input
                  id="mat-edge-name"
                  value={edgeDraft.name}
                  onChange={(e) =>
                    setEdgeDraft({ ...edgeDraft, name: e.target.value })
                  }
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor="mat-edge-thk">Espesor (mm)</label>
                <input
                  id="mat-edge-thk"
                  type="number"
                  min={0}
                  step="any"
                  value={edgeDraft.thicknessMm}
                  onChange={(e) =>
                    setEdgeDraft({
                      ...edgeDraft,
                      thicknessMm: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor="mat-edge-cost">Costo / ML</label>
                <input
                  id="mat-edge-cost"
                  type="number"
                  min={0}
                  step="any"
                  value={edgeDraft.costPerMl}
                  onChange={(e) =>
                    setEdgeDraft({
                      ...edgeDraft,
                      costPerMl: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="catalog-form__inline-actions">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    setEdgeCreateOpen(false);
                    setEdgeError(null);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  onClick={submitCreateEdge}
                >
                  Crear y vincular
                </button>
              </div>
            </div>
          ) : null}

          <div className="catalog-form__field">
            <label htmlFor="mat-width">Ancho del tablero (mm)</label>
            <input
              id="mat-width"
              type="number"
              min={1}
              value={draft.widthMm}
              onChange={(e) =>
                setDraft({ ...draft, widthMm: Number(e.target.value) })
              }
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-length">Largo del tablero (mm)</label>
            <input
              id="mat-length"
              type="number"
              min={1}
              value={draft.lengthMm}
              onChange={(e) =>
                setDraft({ ...draft, lengthMm: Number(e.target.value) })
              }
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-price">Precio del tablero ($)</label>
            <input
              id="mat-price"
              type="number"
              min={0}
              step="any"
              value={draft.boardPrice}
              onChange={(e) =>
                setDraft({ ...draft, boardPrice: Number(e.target.value) })
              }
              required
            />
          </div>
          <div className="catalog-form__field">
            <label>Costo / m² calculado (con merma)</label>
            <div className="catalog-form__calculated-value">
              $
              {getCostPerM2({
                widthMm: draft.widthMm,
                lengthMm: draft.lengthMm,
                boardPrice: draft.boardPrice,
                wastePercent: draft.wastePercent,
              }).toFixed(2)}
            </div>
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-waste">Merma (%)</label>
            <input
              id="mat-waste"
              type="number"
              min={0}
              step="any"
              value={draft.wastePercent}
              onChange={(e) =>
                setDraft({ ...draft, wastePercent: Number(e.target.value) })
              }
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="mat-notes">Notas</label>
            <textarea
              id="mat-notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </form>
      </Modal>
    </section>
  );
}
