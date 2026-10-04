/**
 * Hardware profiles catalog ABM (#914): list + search + chips + modal.
 * Profiles reference the EXISTING hardware catalog by id — the canonical
 * code/price never lives here. Pure props + callbacks, mirroring
 * HardwareCatalog; data flows through the caller's hook.
 */

import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { suggestDuplicateCode, type Hardware } from '@granete/domain';
import { Copy, Eye, EyeOff, Layers, Pencil, Plus, SearchX } from 'lucide-react';
import {
  ConfirmDialog,
  EmptyState,
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
  validateRequiredName,
  validateUniqueCode,
} from '../catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from '../CatalogTable';
import { HardwareProfileFormModal } from './HardwareProfileFormModal';
import {
  type HardwareProfileDraft,
  emptyProfileDraft,
  toProfileDraft,
} from './hardwareProfileDraft';

export type { HardwareProfileDraft };

import '../catalogs.css';

export interface HardwareProfileRowItem {
  readonly hardwareId: string;
  readonly quantity: number;
  readonly applicationRole: string;
}

export interface HardwareProfileRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly revision: string;
  readonly itemCount: number;
  readonly hasRecipe: boolean;
  readonly active: boolean;
  readonly version: number;
  /** Full items for the edit draft (the list response carries them). */
  readonly items: readonly HardwareProfileRowItem[];
}

export interface HardwareProfilesCatalogProps {
  readonly profiles: readonly HardwareProfileRow[];
  readonly hardware: readonly Hardware[];
  readonly onCreate: (draft: HardwareProfileDraft) => void | Promise<void>;
  readonly onUpdate: (id: string, expectedVersion: number, draft: HardwareProfileDraft) => void | Promise<void>;
  readonly onDeactivate: (id: string, expectedVersion: number) => void | Promise<void>;
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /** Hide ABM when false. */
  readonly canMutate?: boolean;
}

export function HardwareProfilesCatalog({
  profiles,
  hardware,
  onCreate,
  onUpdate,
  onDeactivate,
  openEntityId = null,
  onSelectionChange,
  canMutate = true,
}: HardwareProfilesCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const profileIds = useMemo(() => profiles.map((p) => p.id), [profiles]);
  const { selectedId: expandedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId,
      onSelectionChange,
      knownIds: profileIds,
    });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<number>(1);
  // K2 #1032: destructive actions ask first; the row button only requests.
  const [confirmDeactivate, setConfirmDeactivate] = useState<HardwareProfileRow | null>(null);
  const [draft, setDraft] = useState<HardwareProfileDraft>(emptyProfileDraft());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(
    () =>
      filterCatalogItems(
        profiles.map((profile) => ({ ...profile, name: profile.name })),
        {
          status,
          query: debouncedSearch,
        },
      ),
    [profiles, status, debouncedSearch],
  );

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyProfileDraft());
    setError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyProfileDraft());
    setError(null);
    setModalOpen(true);
  };

  const startEdit = (row: HardwareProfileRow) => {
    setEditingId(row.id);
    setEditingVersion(row.version);
    setDraft(toProfileDraft(row));
    setError(null);
    setModalOpen(true);
  };

  // K2 #1032: duplicate via the create flow — prefilled, disambiguated code;
  // the copy is a NEW profile (no version history carried over).
  const startDuplicate = (row: HardwareProfileRow) => {
    const next = {
      ...toProfileDraft(row),
      code: suggestDuplicateCode(row.code, profiles.map((p) => p.code)),
      name: `${row.name} (copia)`,
    };
    setEditingId(null);
    setEditingVersion(1);
    setDraft(next);
    setError(null);
    setModalOpen(true);
  };

  const validate = (): string | null => {
    const codeErr = validateUniqueCode(
      draft.code,
      profiles,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;
    if (draft.revision.trim() === '') return 'La revisión técnica es obligatoria';
    if (draft.items.length === 0) return 'Agregá al menos un herraje al perfil';
    const seen = new Set<string>();
    for (const [index, item] of draft.items.entries()) {
      if (!item.hardwareId) return `El herraje de la línea ${index + 1} no fue elegido`;
      if (seen.has(item.hardwareId)) {
        return `El herraje de la línea ${index + 1} ya está en el perfil: las cantidades partidas son ambiguas`;
      }
      seen.add(item.hardwareId);
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `La cantidad de la línea ${index + 1} debe ser un número positivo`;
      }
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (editingId) {
        await onUpdate(editingId, editingVersion, draft);
      } else {
        await onCreate(draft);
      }
      closeModal();
    } catch (err: unknown) {
      // Keep modal open, keep the draft intact (#914 stale-conflict UX).
      if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        (err as { status?: number }).status === 412
      ) {
        setError(
          'El perfil cambió en otra sesión. Recargá la pantalla antes de volver a guardar: tus cambios siguen en el formulario.',
        );
      } else {
        const msg = err instanceof Error ? err.message : 'Error al guardar los cambios';
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const columns: CatalogColumn<HardwareProfileRow>[] = useMemo(
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
        key: 'items',
        header: 'Herrajes',
        render: (r) =>
          `${r.itemCount} ${r.itemCount === 1 ? 'herraje' : 'herrajes'}`,
      },
      {
        key: 'revision',
        header: 'Revisión',
        render: (r) => (
          <span className="catalog-row-detail__value--mono">{r.revision}</span>
        ),
      },
      {
        key: 'recipe',
        header: 'Receta',
        render: (r) =>
          r.hasRecipe ? (
            <span className="badge badge--info">Embebida</span>
          ) : (
            <span className="badge badge--neutral">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Estado',
        render: (r) => <ActiveBadge active={r.active} />,
      },
    ],
    [],
  );

  const isTrulyEmpty = profiles.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

  return (
    <section className="catalog-page" aria-label="Catálogo de perfiles de herrajes">
      <PageHeader
        title="Perfiles de herrajes"
        subtitle="Soluciones de unión: herrajes del catálogo, cantidades por aplicación y su receta técnica"
        icon={<Layers size={16} strokeWidth={1.5} />}
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
              data-testid="hardware-profile-create-btn"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo perfil
            </button>
          ) : undefined
        }
      />

      {!isTrulyEmpty ? (
        <PageToolbar
          ariaLabel="Buscar y filtrar perfiles de herrajes"
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar perfiles…"
              aria-label="Buscar perfiles"
            />
          }
          filters={<StatusChips value={status} onChange={setStatus} />}
        />
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={Layers}
            title="No hay perfiles de herrajes"
            description="Un perfil combina herrajes del catálogo con cantidades por aplicación y su receta técnica versionada."
            actionLabel="Crear perfil"
            onAction={startCreate}
          />
        ) : isFilterEmpty ? (
          <EmptyState
            variant="no-results"
            icon={SearchX}
            title="Sin resultados"
            description="No hay perfiles que coincidan con la búsqueda o el filtro."
            actionLabel="Limpiar filtros"
            onAction={() => {
              setSearch('');
              setStatus('active');
            }}
          />
        ) : (
          <CatalogTable
            columns={columns}
            rows={rows}
            expandedId={expandedId}
            isInactive={(r) => !r.active}
            onRowClick={(row) => toggleSelectedId(row.id)}
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
                {row.description ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Descripción</span>
                    <span className="catalog-row-detail__value">{row.description}</span>
                  </div>
                ) : null}
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Revisión técnica</span>
                  <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                    {row.revision}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Receta técnica</span>
                  <span className="catalog-row-detail__value">
                    {row.hasRecipe
                      ? 'Embebida y pineada en los releases de la biblioteca'
                      : 'Sin cuerpo embebido'}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Estado</span>
                  <span className="catalog-row-detail__value">
                    <ActiveBadge active={row.active} />
                  </span>
                </div>
              </>
            )}
            getRowActions={
              canMutate
                ? (row) => (
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
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      aria-label={`Duplicar ${row.code}`}
                      onClick={() => startDuplicate(row)}
                    >
                      <Copy size={14} strokeWidth={1.5} aria-hidden />
                      Duplicar
                    </button>
                    {row.active ? (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost btn--danger"
                        aria-label={`Desactivar ${row.code}`}
                        onClick={() => setConfirmDeactivate(row)}
                      >
                        <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                        Desactivar
                      </button>
                    ) : null}
                  </>
                )
                : undefined
            }
          />
        )}
      </div>

      <HardwareProfileFormModal
        open={modalOpen}
        editingId={editingId}
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        hardware={hardware}
        error={error}
        canMutate={canMutate}
        saving={saving}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />

      <ConfirmDialog
        open={confirmDeactivate != null}
        onClose={() => setConfirmDeactivate(null)}
        title="Desactivar perfil de herrajes"
        message={
          confirmDeactivate
            ? `¿Seguro que querés desactivar "${confirmDeactivate.code} — ${confirmDeactivate.name}"? El perforado de esta pieza volverá a la regla general de la fábrica.`
            : ''
        }
        confirmLabel="Desactivar"
        dataTestId="hardware-profile-deactivate-confirm"
        onConfirm={() => {
          if (confirmDeactivate) onDeactivate(confirmDeactivate.id, confirmDeactivate.version);
        }}
      />
    </section>
  );
}
