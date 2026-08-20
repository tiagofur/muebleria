/**
 * Hardware catalog ABM — list + search + chips + modal SM (F020).
 * F117 split: form lives in HardwareFormModal; actions unified on row hover.
 */

import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Hardware } from '@muebles/domain';
import { Eye, EyeOff, Pencil, Plus, SearchX, Settings2 } from 'lucide-react';
import {
  CatalogImage,
  EmptyState,
  formatMoneyDisplay,
  PageHeader,
  PageToolbar,
  SearchInput,
  StatusChips,
  useDebouncedValue,
  useRoutableEntitySelection,
} from '../../common';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
} from '../catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from '../CatalogTable';
import { HardwareFormModal } from './HardwareFormModal';
import {
  UNIT_LABELS,
  type HardwareDraft,
  emptyDraft,
  toDraft,
} from './hardwareDraft';

export type { HardwareDraft };

import '../catalogs.css';

export interface HardwareCatalogProps {
  readonly hardware: readonly Hardware[];
  readonly onCreate: (draft: HardwareDraft) => void;
  readonly onUpdate: (id: string, draft: HardwareDraft) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /** F035: hide ABM when false. */
  readonly canMutate?: boolean;
  readonly showCosts?: boolean;
  /** F042: upload catalog image. */
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

export function HardwareCatalog({
  hardware,
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  openEntityId = null,
  onSelectionChange,
  canMutate = true,
  showCosts = true,
  onUploadImage,
  resolveImageUrl = (u) => u,
}: HardwareCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const hardwareIds = useMemo(() => hardware.map((h) => h.id), [hardware]);
  const { selectedId: expandedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId,
      onSelectionChange,
      knownIds: hardwareIds,
    });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HardwareDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      filterCatalogItems(hardware, {
        status,
        query: debouncedSearch,
      }),
    [hardware, status, debouncedSearch],
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

  const startEdit = (item: Hardware) => {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setError(null);
    setModalOpen(true);
  };

  const validate = (): string | null => {
    const codeErr = validateUniqueCode(
      draft.code,
      hardware,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;
    return validateNonNegativeNumber(draft.costPerUnit, 'Costo unitario');
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

  const columns: CatalogColumn<Hardware>[] = useMemo(
    () => [
      {
        key: 'image',
        header: 'Foto',
        render: (r) => (
          <CatalogImage
            src={resolveImageUrl(r.imageUrl)}
            alt={r.name}
            size="sm"
          />
        ),
      },
      {
        key: 'code',
        header: 'Código',
        render: (r) => (
          <span className="catalog-row-detail__value--mono">{r.code}</span>
        ),
      },
      { key: 'name', header: 'Nombre', render: (r) => r.name },
      {
        key: 'unit',
        header: 'Unidad',
        render: (r) => UNIT_LABELS[r.unit],
      },
      {
        key: 'cost',
        header: 'Costo unit.',
        render: (r) => formatMoneyDisplay(r.costPerUnit),
      },
      {
        key: 'status',
        header: 'Estado',
        render: (r) => <ActiveBadge active={r.active} />,
      },
    ],
    [resolveImageUrl],
  );
  const visibleColumns = useMemo(
    () => (showCosts ? columns : columns.filter((c) => c.key !== 'cost')),
    [columns, showCosts],
  );

  const isTrulyEmpty = hardware.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

  return (
    <section className="catalog-page" aria-label="Catálogo de herrajes">
      <PageHeader
        title="Herrajes"
        subtitle="Bisagras, correderas y demás del catálogo"
        icon={<Settings2 size={16} strokeWidth={1.5} />}
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo herraje
            </button>
          ) : undefined
        }
      />

      {!isTrulyEmpty ? (
        <PageToolbar
          ariaLabel="Buscar y filtrar herrajes"
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar herrajes…"
              aria-label="Buscar herrajes"
            />
          }
          filters={<StatusChips value={status} onChange={setStatus} />}
        />
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={Settings2}
            title="No hay herrajes"
            description="Agregá el primer herraje del catálogo o cargá la semilla del workspace."
            actionLabel="Agregar herraje"
            onAction={startCreate}
          />
        ) : isFilterEmpty ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title="Sin resultados"
            description="No hay herrajes que coincidan con la búsqueda o el filtro."
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
            onRowClick={(row) => toggleSelectedId(row.id)}
            renderExpandedDetail={(row) => (
              <>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Foto</span>
                  <CatalogImage
                    src={resolveImageUrl(row.imageUrl)}
                    alt={row.name}
                    size="md"
                  />
                </div>
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
                  <span className="catalog-row-detail__label">Unidad</span>
                  <span className="catalog-row-detail__value">
                    {UNIT_LABELS[row.unit]}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Costo unitario</span>
                  <span className="catalog-row-detail__value">
                    {formatMoneyDisplay(row.costPerUnit)}
                  </span>
                </div>
                {row.packageSize !== undefined ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Empaque</span>
                    <span className="catalog-row-detail__value">
                      {row.packageSize} {UNIT_LABELS[row.unit].toLowerCase()}
                      {row.unit === 'meter' ? ' / barra' : ''}
                    </span>
                  </div>
                ) : null}
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

      <HardwareFormModal
        open={modalOpen}
        editingId={editingId}
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        error={error}
        canMutate={canMutate}
        onUploadImage={onUploadImage}
        resolveImageUrl={resolveImageUrl}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />
    </section>
  );
}
