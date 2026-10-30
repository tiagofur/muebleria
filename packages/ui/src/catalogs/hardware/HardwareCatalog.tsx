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
import type { Agregado, Hardware, HardwareKitCreateRequest, HardwareKitResult } from '@granete/domain';
import {
  ValidationError,
  countMachiningOperations,
  validateMachiningProfile,
  suggestDuplicateCode,
} from '@granete/domain';
import type { HardwareAssetService } from '@granete/storage';
import { Copy, Eye, EyeOff, PackagePlus, Pencil, Plus, SearchX, Settings2 } from 'lucide-react';
import {
  ConfirmDialog,
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
import { HardwareKitWizardModal } from './HardwareKitWizardModal';
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
  readonly onCreate: (draft: HardwareDraft) => void | Promise<void>;
  readonly onUpdate: (id: string, draft: HardwareDraft) => void | Promise<void>;
  readonly onDeactivate: (id: string) => void | Promise<void>;
  readonly onReactivate: (id: string) => void | Promise<void>;
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /** F035: hide ABM when false. */
  readonly canMutate?: boolean;
  readonly showCosts?: boolean;
  /** #667 M2: 3D asset service for uploads, listings and retirements */
  readonly assetService?: HardwareAssetService;
  /** Optional callback to reload catalog on readback failure */
  readonly onReload?: () => Promise<void>;
  /** F042: upload catalog image. */
  readonly onUploadImage?: (file: File) => Promise<string>;
  /** #1416: kit wizard — creates kit + design parts + drawer agregado. */
  readonly onCreateKit?: (req: HardwareKitCreateRequest) => Promise<HardwareKitResult>;
  /** #1416: agregado codes for the wizard's fail-closed collision check. */
  readonly agregadoCodes?: readonly string[];
  /** #1418 restante (perfección): catálogo de agregados para el link kit→diseño. */
  readonly agregados?: readonly Agregado[];
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

// K4 #1032: same workshop-facing labels as the form's shape select — the
// internal enum value never reaches the user.
const PREVIEW_SHAPE_LABELS_ES: Readonly<Record<string, string>> = {
  knob: 'Tirador (perilla)',
  'bar-pull': 'Tirador (barra)',
  'cup-pull': 'Tirador (copa)',
  hinge: 'Bisagra',
  slide: 'Corredera',
  rail: 'Riel',
  leg: 'Pata',
};

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
  assetService,
  onReload,
  onUploadImage,
  onCreateKit,
  agregadoCodes = [],
  agregados = [],
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
  const [saving, setSaving] = useState(false);
  // K2 #1032: destructive actions ask first; the row button only requests.
  const [confirmDeactivate, setConfirmDeactivate] = useState<Hardware | null>(null);
  // K4 #1032: saved identity for the modal title (stable while fields change).
  const editingHardware = editingId
    ? (hardware.find((h) => h.id === editingId) ?? null)
    : null;
  const [readbackError, setReadbackError] = useState<string | null>(null);
  // #1416: kit wizard («Juego de herraje»).
  const [kitWizardOpen, setKitWizardOpen] = useState(false);
  // #1422 slice 1: las partes de diseño viven «dentro» de su kit — ocultas
  // por defecto; el chip del toolbar las muestra. Con búsqueda activa se
  // muestran siempre (el search debe encontrarlas).
  const [showDesignParts, setShowDesignParts] = useState(false);

  const partsByKit = useMemo(() => {
    const map = new Map<string, Hardware[]>();
    for (const h of hardware) {
      if (!h.kitHardwareId) continue;
      const list = map.get(h.kitHardwareId) ?? [];
      list.push(h);
      map.set(h.kitHardwareId, list);
    }
    return map;
  }, [hardware]);
  const kitById = useMemo(() => new Map(hardware.map((h) => [h.id, h] as const)), [hardware]);
  // #1418 restante: kit → agregado de diseño (la receta cuyo kit es este herraje).
  const designByKit = useMemo(() => {
    const map = new Map<string, Agregado>();
    for (const a of agregados) {
      if (a.commercialKitHardwareId && !map.has(a.commercialKitHardwareId)) {
        map.set(a.commercialKitHardwareId, a);
      }
    }
    return map;
  }, [agregados]);

  const rows = useMemo(
    () =>
      filterCatalogItems(hardware, {
        status,
        query: debouncedSearch,
      }).filter(
        (h) =>
          showDesignParts ||
          debouncedSearch.trim() !== '' ||
          !h.kitHardwareId,
      ),
    [hardware, status, debouncedSearch, showDesignParts],
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

  // K2 #1032: duplicate via the create flow — prefilled, disambiguated code.
  const startDuplicate = (item: Hardware) => {
    const next = toDraft(item);
    next.code = suggestDuplicateCode(item.code, hardware.map((h) => h.code));
    next.name = `${item.name} (copia)`;
    setEditingId(null);
    setDraft(next);
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
    const costErr = validateNonNegativeNumber(draft.costPerUnit, 'Costo unitario');
    if (costErr) return costErr;
    if (draft.machining && draft.machining.parts.length > 0) {
      try {
        validateMachiningProfile(draft.machining);
      } catch (err) {
        if (err instanceof ValidationError) return err.message;
        throw err;
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
    setReadbackError(null);
    try {
      if (editingId) {
        await onUpdate(editingId, draft);
      } else {
        await onCreate(draft);
      }
      closeModal();
    } catch (err: unknown) {
      // Keep modal open, keep draft and previous binding intact (prompt §5.3)
      const msg = err instanceof Error ? err.message : 'Error al guardar los cambios';
      setError(msg);
    } finally {
      setSaving(false);
    }
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
      {
        key: 'name',
        header: 'Nombre',
        render: (r) => {
          const parts = partsByKit.get(r.id);
          const kit = r.kitHardwareId ? kitById.get(r.kitHardwareId) : undefined;
          return (
            <span className="catalog-hw-name">
              {r.name}
              {parts && parts.length > 0 ? (
                <span
                  className="catalog-badge catalog-badge--kit"
                  data-testid={`hardware-kit-parts-badge-${r.code}`}
                >
                  {parts.length} {parts.length === 1 ? 'parte' : 'partes'} de diseño
                </span>
              ) : null}
              {kit ? (
                <span className="catalog-badge catalog-badge--part">
                  Parte de {kit.code}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        key: 'unit',
        header: 'Unidad',
        render: (r) => UNIT_LABELS[r.unit],
      },
      {
        key: 'cost',
        header: 'Costo unit.',
        numeric: true,
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
        secondaryActions={
          // #1416: kit wizard as a visible secondary action (K5: «Nuevo
          // herraje» remains the single primary CTA).
          canMutate && !isTrulyEmpty && onCreateKit ? (
            <button
              type="button"
              className="btn"
              onClick={() => setKitWizardOpen(true)}
              data-testid="hardware-kit-wizard-open"
            >
              <PackagePlus size={16} strokeWidth={1.5} aria-hidden />
              Juego de herraje
            </button>
          ) : undefined
        }
        primaryAction={
          // K5 #1032: ONE creation CTA per state — on the truly-empty state
          // the EmptyState owns the action (same contract as Perfiles).
          canMutate && !isTrulyEmpty ? (
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
          filters={
            <>
              <StatusChips value={status} onChange={setStatus} />
              <button
                type="button"
                className={
                  showDesignParts
                    ? 'ui-status-chips__chip is-selected'
                    : 'ui-status-chips__chip'
                }
                onClick={() => setShowDesignParts((v) => !v)}
                data-testid="hardware-toggle-design-parts"
              >
                Partes de diseño: {showDesignParts ? 'visibles' : 'ocultas'}
              </button>
            </>
          }
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
            secondaryActionLabel={onCreateKit && canMutate ? 'Juego de herraje' : undefined}
            onSecondaryAction={onCreateKit && canMutate ? () => setKitWizardOpen(true) : undefined}
            secondaryActionTestId="hardware-kit-wizard-open"
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
                {(partsByKit.get(row.id)?.length ?? 0) > 0 ? (
                  <div
                    className="catalog-row-detail__field catalog-row-detail__field--full"
                    data-testid={`hardware-kit-parts-${row.code}`}
                  >
                    <span className="catalog-row-detail__label">
                      Partes de este juego
                    </span>
                    <ul className="catalog-kit-parts">
                      {partsByKit.get(row.id)!.map((part) => (
                        <li key={part.id}>
                          <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                            {part.code}
                          </span>{' '}
                          — {part.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {designByKit.get(row.id) ? (
                  <div
                    className="catalog-row-detail__field catalog-row-detail__field--full"
                    data-testid={`hardware-kit-design-${row.code}`}
                  >
                    <span className="catalog-row-detail__label">Diseño (receta)</span>
                    <span className="catalog-row-detail__value">
                      {designByKit.get(row.id)!.code} — {designByKit.get(row.id)!.name}
                    </span>
                  </div>
                ) : null}
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
                {row.machining ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Maquinado CNC</span>
                    <span className="catalog-row-detail__value">
                      {row.machining.parts.length}{' '}
                      {row.machining.parts.length === 1 ? 'parte' : 'partes'} ·{' '}
                      {countMachiningOperations(row.machining)}{' '}
                      {countMachiningOperations(row.machining) === 1
                        ? 'perforación'
                        : 'perforaciones'}
                    </span>
                  </div>
                ) : null}
                <div className="catalog-row-detail__field" data-testid="hardware-detail-3d">
                  <span className="catalog-row-detail__label">Modelo 3D y montaje</span>
                  <span className="catalog-row-detail__value">
                    {row.visualAsset ? (
                      <>
                        <span className="status-badge status-badge--info" style={{ marginRight: '0.25rem' }}>
                          {(row.visualAsset.representation ?? 'skp').toUpperCase()}
                        </span>
                        <span className="status-badge status-badge--neutral" style={{ marginRight: '0.25rem' }}>
                          {row.visualAsset.validationState === 'validated'
                            ? 'Validado'
                            : row.visualAsset.validationState === 'failed'
                            ? 'Falló validación'
                            : 'Pendiente de validación'}
                        </span>
                        <span className="catalog-row-detail__value--mono">
                          {row.visualAsset.sha256 ? `${row.visualAsset.sha256.slice(0, 12)}...` : ''}
                        </span>
                      </>
                    ) : row.previewShape ? (
                      `Forma genérica: ${PREVIEW_SHAPE_LABELS_ES[row.previewShape] ?? row.previewShape}`
                    ) : (
                      'Sin modelo de archivo asociado'
                    )}
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
                )
                : undefined
            }
          />
        )}
      </div>

      <HardwareFormModal
        open={modalOpen}
        identity={editingHardware ? { code: editingHardware.code, name: editingHardware.name } : undefined}
        editingId={editingId}
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        error={error}
        canMutate={canMutate}
        saving={saving}
        assetService={assetService}
        onUploadImage={onUploadImage}
        resolveImageUrl={resolveImageUrl}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />

      {onCreateKit ? (
        <HardwareKitWizardModal
          open={kitWizardOpen}
          onClose={() => setKitWizardOpen(false)}
          hardware={hardware}
          agregadoCodes={agregadoCodes}
          onCreateKit={onCreateKit}
          assetService={assetService}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDeactivate != null}
        onClose={() => setConfirmDeactivate(null)}
        title="Desactivar herraje"
        message={
          confirmDeactivate
            ? `¿Seguro que querés desactivar "${confirmDeactivate.code} — ${confirmDeactivate.name}"? Deja de ofrecerse para nuevos usos y podés reactivarlo desde el filtro de inactivos. Si algún mueble plantilla u obra lo usa, el servidor rechaza la operación.`
            : ''
        }
        confirmLabel="Desactivar"
        dataTestId="hardware-deactivate-confirm"
        onConfirm={() => {
          if (confirmDeactivate) onDeactivate(confirmDeactivate.id);
        }}
      />
    </section>
  );
}
