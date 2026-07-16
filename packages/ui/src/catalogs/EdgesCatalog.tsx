/**
 * Edge bands (EdgeBand) catalog ABM — list + search + chips + modal SM (F020).
 */

import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { EdgeBand } from '@muebles/domain';
import { Eye, EyeOff, Minus, Pencil, Plus, SearchX } from 'lucide-react';
import {
  EmptyState,
  formatMoneyDisplay,
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
import './catalogs.css';

export type EdgeDraft = {
  code: string;
  name: string;
  thicknessMm: number;
  costPerMl: number;
  notes: string;
};

const emptyDraft = (): EdgeDraft => ({
  code: '',
  name: '',
  thicknessMm: 0.5,
  costPerMl: 0,
  notes: '',
});

function toDraft(item: EdgeBand): EdgeDraft {
  return {
    code: item.code,
    name: item.name,
    thicknessMm: item.thicknessMm,
    costPerMl: item.costPerMl,
    notes: item.notes ?? '',
  };
}

export interface EdgesCatalogProps {
  readonly edges: readonly EdgeBand[];
  readonly onCreate: (draft: EdgeDraft) => void;
  readonly onUpdate: (id: string, draft: EdgeDraft) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /** F035: hide ABM when false. */
  readonly canMutate?: boolean;
  readonly showCosts?: boolean;
}

export function EdgesCatalog({
  edges,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  openEntityId = null,
  onSelectionChange,
  canMutate = true,
  showCosts = true,
}: EdgesCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const edgeIds = useMemo(() => edges.map((e) => e.id), [edges]);
  const { selectedId: expandedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId,
      onSelectionChange,
      knownIds: edgeIds,
    });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EdgeDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      filterCatalogItems(edges, {
        status,
        query: debouncedSearch,
      }),
    [edges, status, debouncedSearch],
  );

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setModalOpen(true);
  };

  const startEdit = (item: EdgeBand) => {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setError(null);
    setModalOpen(true);
  };

  const toggleExpand = (item: EdgeBand) => {
    toggleSelectedId(item.id);
  };

  const validate = (): string | null => {
    const codeErr = validateUniqueCode(draft.code, edges, editingId ?? undefined);
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;
    return (
      validateNonNegativeNumber(draft.thicknessMm, 'Espesor') ??
      validateNonNegativeNumber(draft.costPerMl, 'Costo/ML')
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
    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    closeModal();
  };

  const columns: CatalogColumn<EdgeBand>[] = useMemo(
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
        key: 'cost',
        header: 'Costo/ML',
        render: (r) => formatMoneyDisplay(r.costPerMl),
      },
      {
        key: 'status',
        header: 'Estado',
        render: (r) => <ActiveBadge active={r.active} />,
      },
    ],
    [],
  );
  const visibleColumns = useMemo(
    () => (showCosts ? columns : columns.filter((c) => c.key !== 'cost')),
    [columns, showCosts],
  );

  const isTrulyEmpty = edges.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

  return (
    <section className="catalog-page" aria-label="Catálogo de cantos">
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Cantos</h2>
        <div className="catalog-page__toolbar">
          {canMutate ? (
          <button type="button" className="btn btn--primary" onClick={startCreate}>
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            Nuevo canto
          </button>
          ) : null}
        </div>
      </div>

      {!isTrulyEmpty ? (
        <div className="catalog-page__filters">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar cantos…"
            aria-label="Buscar cantos"
          />
          <StatusChips value={status} onChange={setStatus} />
        </div>
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={Minus}
            title="No hay cantos"
            description="Agregá el primer canto del catálogo o cargá la semilla del workspace."
            actionLabel="Agregar canto"
            onAction={startCreate}
          />
        ) : isFilterEmpty ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title="Sin resultados"
            description="No hay cantos que coincidan con la búsqueda o el filtro."
            actionLabel="Limpiar filtros"
            onAction={() => {
              setSearch('');
              setStatus('active');
            }}
          />
        ) : (
          <CatalogTable
            columns={visibleColumns}
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
                  <span className="catalog-row-detail__label">Costo / ML</span>
                  <span className="catalog-row-detail__value">
                    {formatMoneyDisplay(row.costPerMl)}
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
        title={editingId ? 'Editar canto' : 'Nuevo canto'}
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
            <label htmlFor="edge-code">Código</label>
            <input
              id="edge-code"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              autoComplete="off"
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="edge-name">Nombre</label>
            <input
              id="edge-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="edge-thickness">Espesor (mm)</label>
            <input
              id="edge-thickness"
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
          <div className="catalog-form__field">
            <label htmlFor="edge-cost">Costo / ML</label>
            <input
              id="edge-cost"
              type="number"
              min={0}
              step="any"
              value={draft.costPerMl}
              onChange={(e) =>
                setDraft({ ...draft, costPerMl: Number(e.target.value) })
              }
              required
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="edge-notes">Notas</label>
            <textarea
              id="edge-notes"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>
        </form>
      </Modal>
    </section>
  );
}
