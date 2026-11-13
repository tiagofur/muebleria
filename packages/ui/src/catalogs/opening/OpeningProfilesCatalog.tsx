/**
 * Opening profiles catalog ABM (#1325): list + search + chips + modal,
 * mirroring HardwareProfilesCatalog (its structural twin). The profile is a
 * CATALOG entity — versions, verified datasheet, BOM member references —
 * never a workshop preference. Pure props + callbacks; data flows through
 * the caller's hook.
 */

import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { suggestDuplicateCode } from '@granete/domain';
import { GraneteApiError, type GraneteApiClient, type OpeningProfileWrite } from '@granete/storage';
import { Copy, Eye, EyeOff, DoorOpen, Pencil, Plus, SearchX } from 'lucide-react';
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
import { GolaProfileEditorModal } from './GolaProfileEditorModal';
import type { CatalogPickerOption } from '../CatalogPicker';
import {
  bodyModifiersOfDraft,
  datasheetStatusOfDraft,
  emptyOpeningProfileDraft,
  isHardwareMemberRole,
  membersMapOfDraft,
  suggestOpeningProfileId,
  toOpeningProfileDraft,
  type OpeningProfileBodyModifierLike,
  type OpeningProfileBOMMembersLike,
  type OpeningProfileDraft,
} from './openingProfileDraft';

export type { OpeningProfileDraft };

import '../catalogs.css';

export interface OpeningProfileRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** #1329 — nullable: not declared yet is the truthful absence. */
  readonly manufacturer: string | null;
  readonly gripType: string;
  readonly crossSection: string | null;
  readonly placements: readonly string[];
  readonly datasheetStatus: string;
  readonly frontReductionMm: number | null;
  readonly gripClearanceMm: number | null;
  readonly doorReductionMm: number | null;
  /** #1534 — v2 fields; optional because legacy rows predate them. */
  readonly material?: string | null;
  readonly frontDiscountTopMm?: number | null;
  readonly frontDiscountBetweenMm?: number | null;
  readonly usage?: Record<string, { usable?: boolean; message?: string | null }>;
  readonly profileHeightMm: number | null;
  readonly profileDepthMm: number | null;
  readonly geometryOrigin: string | null;
  readonly bodyModifiers: readonly OpeningProfileBodyModifierLike[];
  /** BOM member keys present on the profile (profile / supports / endCaps). */
  readonly bomMemberKeys: readonly string[];
  readonly bomMembers: OpeningProfileBOMMembersLike | null;
  readonly active: boolean;
  readonly version: number;
}

export interface OpeningProfilesCatalogProps {
  readonly profiles: readonly OpeningProfileRow[];
  readonly onCreate: (id: string, draft: OpeningProfileDraft) => void | Promise<void>;
  readonly onUpdate: (id: string, expectedVersion: number, draft: OpeningProfileDraft) => void | Promise<void>;
  readonly onDeactivate: (id: string, expectedVersion: number) => void | Promise<void>;
  readonly openEntityId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /** Hide ABM when false. */
  readonly canMutate?: boolean;
  /** #1526 — hardware and components to pick members from (search by name or code). */
  readonly hardwareOptions?: readonly CatalogPickerOption[] | null;
  readonly componentOptions?: readonly CatalogPickerOption[] | null;
  /** #1534 — the API handle + session token for the editor's live preview. */
  readonly api?: GraneteApiClient | null;
  readonly token?: string | null;
}

/** #1534 — the Agarre column: v2 material/positions for gola rows. */
function gripColumn(r: OpeningProfileRow): string {
  if (r.gripType !== 'gola') return GRIP_SHORT[r.gripType] ?? r.gripType;
  const materialLabel = r.material === 'melamine' ? 'Italiana' : r.crossSection ? `Gola ${r.crossSection}` : 'Gola';
  const positions = [
    ...(r.placements.includes('top') ? ['superior'] : []),
    ...(r.placements.includes('between') ? ['entre frentes'] : []),
  ];
  return `${materialLabel} (${positions.join(' + ') || 'sin posición'})`;
}

/** #1534 — the Uso column: the per-position use rule served by the API
 * (disponible ≠ válido), verbatim — the message already names the position
 * («No se puede usar entre frentes: falta el descuento»). */
function usabilityColumn(r: OpeningProfileRow): ReactNode {
  const usage = r.usage ?? {};
  const parts: string[] = [];
  for (const [position, label] of [['top', 'superior'], ['between', 'entre frentes']] as const) {
    if (!r.placements.includes(position)) continue;
    const verdict = usage[position];
    parts.push(verdict?.usable === true ? `${label}: OK` : verdict?.message ?? `${label}: no utilizable`);
  }
  if (parts.length === 0) return '—';
  return (
    <span className="gola-editor__uso-list">
      {parts.map((part) => (
        <span key={part} className="gola-editor__uso-line">{part}</span>
      ))}
    </span>
  );
}

const GRIP_SHORT: Readonly<Record<string, string>> = {
  gola: 'Gola',
  handle: 'Jaladera',
  bottom_reveal: 'Rebase',
  none: '—',
};

function formatNumber(v: number | null | undefined): string {
  if (v == null) return '?';
  // Round to 2 decimal places to avoid IEEE-754 float printing like 27.200000762939453.
  const rounded = Math.round(v * 100) / 100;
  return String(rounded);
}

/** Plain-workshop description of one declared effect (detail view). */
function modifierLabel(
  modifier: OpeningProfileBodyModifierLike,
  datasheetDepth: number | null,
): string {
  if (modifier.effect === 'depth_reduction' || modifier.depth_reduction_mm !== undefined) {
    if (modifier.depth_reduction_mm != null) {
      return `Descuento de profundidad: ${formatNumber(modifier.depth_reduction_mm)} mm`;
    }
    return `Descuento de profundidad: deriva de la ficha (${formatNumber(datasheetDepth)} mm)`;
  }
  if (modifier.notch_at !== undefined || modifier.notch_height_mm !== undefined) {
    return `Muesca en costados: ${formatNumber(modifier.notch_height_mm)} × ${formatNumber(modifier.notch_depth_mm)} mm`;
  }
  return `Efecto sobre ${modifier.role}`;
}

export function OpeningProfilesCatalog({
  profiles,
  onCreate,
  onUpdate,
  onDeactivate,
  openEntityId = null,
  onSelectionChange,
  canMutate = true,
  hardwareOptions = null,
  componentOptions = null,

  api = null,
  token = null,}: OpeningProfilesCatalogProps): ReactNode {
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
  const [confirmDeactivate, setConfirmDeactivate] = useState<OpeningProfileRow | null>(null);
  const editingProfile = editingId
    ? (profiles.find((p) => p.id === editingId) ?? null)
    : null;
  const [draft, setDraft] = useState<OpeningProfileDraft>(emptyOpeningProfileDraft());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(
    () =>
      filterCatalogItems(
        profiles.map((profile) => ({ ...profile, name: profile.name, description: '' })),
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
    setDraft(emptyOpeningProfileDraft());
    setError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyOpeningProfileDraft());
    setError(null);
    setModalOpen(true);
  };

  const startEdit = (row: OpeningProfileRow) => {
    setEditingId(row.id);
    setEditingVersion(row.version);
    setDraft(toOpeningProfileDraft(row));
    setError(null);
    setModalOpen(true);
  };

  const startDuplicate = (row: OpeningProfileRow) => {
    const next = {
      ...toOpeningProfileDraft(row),
      // Keep id empty so handleSubmit derives it from the final user-edited code.
      id: '',
      code: suggestDuplicateCode(row.code, profiles.map((p) => p.code)),
      name: `${row.name} (copia)`,
    };
    setEditingId(null);
    setEditingVersion(1);
    setDraft(next);
    setError(null);
    setModalOpen(true);
  };

  const validate = (current: OpeningProfileDraft): string | null => {
    if (editingId == null) {
      if (current.id.trim() === '') return 'El identificador del perfil es obligatorio';
    }
    const codeErr = validateUniqueCode(
      current.code,
      profiles,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(current.name);
    if (nameErr) return nameErr;
    // #1534 r1 — the editor ALWAYS writes v2-shaped: without a material the
    // write would fall to the legacy bridge and the typed discounts would
    // vanish silently (judgment A/B MAJOR-1). The material is the preset
    // choice — the brief makes it the first reordering decision.
    if (current.material === '') {
      return 'Elegí el material del perfil: aluminio L, aluminio C o italiana.';
    }
    // #1534 r1 — at least one position: the server rejects an empty
    // compatible set, and the honest client message names the choice.
    if (!current.top && !current.between) {
      return 'Marcá al menos una posición: superior o entre frentes.';
    }
    // #1534 r1 — a declared position's discount is OPTIONAL (disponible ≠
    // válido: the preview and the Uso column report it honestly), and so
    // are the dims — an in-progress profile saves and the Uso column shows
    // what the use rule is missing.
    const hasDims =
      Number.isFinite(Number(current.profileHeightMm)) && Number(current.profileHeightMm) > 0 &&
      Number.isFinite(Number(current.profileDepthMm)) && Number(current.profileDepthMm) > 0;
    const hasAnyDiscount = current.frontDiscountTopMm !== '' || current.frontDiscountBetweenMm !== '';
    if (!hasDims && hasAnyDiscount) {
      return 'Un perfil con descuento exige el alto y la profundidad del perfil mayores a 0';
    }
    // #1534 r1 — the contract carries integers (*int); a decimal here used
    // to die in the generated client with an English internal-key error.
    for (const [field, value, declared] of [
      ['superior', current.frontDiscountTopMm, current.top],
      ['entre frentes', current.frontDiscountBetweenMm, current.between],
    ] as const) {
      // Only DECLARED positions: the write omits an undeclared position's
      // discount, and the field is hidden — naming it would block a save
      // the server accepts with an error the user cannot act on.
      if (declared && value !== '' && (!Number.isInteger(Number(value)) || Number(value) <= 0)) {
        return `El descuento ${field} debe ser un número entero mayor a 0`;
      }
    }
    if (current.notchEnabled) {
      if (!Number.isFinite(Number(current.notchHeightMm)) || Number(current.notchHeightMm) <= 0) {
        return 'La muesca exige un alto mayor a 0';
      }
      if (current.notchDepthSource !== 'strip_thickness' &&
        (!Number.isFinite(Number(current.notchDepthMm)) || Number(current.notchDepthMm) <= 0)) {
        return 'La muesca exige una profundidad mayor a 0 (o el origen por espesor de tira)';
      }
    }
    if (current.depthReductionEnabled && !current.depthReductionDerived) {
      if (!Number.isFinite(Number(current.depthReductionMm)) || Number(current.depthReductionMm) <= 0) {
        return 'El descuento explícito debe ser mayor a 0';
      }
    }
    if (current.bevelEnabled && (!Number.isFinite(Number(current.bevelSizeMm)) || Number(current.bevelSizeMm) <= 0)) {
      // The size comes from the server suggestion (depth − 2); with the
      // depth still undeclared the workshop declares it or clears the
      // effect — the server rejected bevel 0 with no teaching message.
      return 'El bisel exige un tamaño mayor a 0: declará la profundidad del perfil y volvé a elegir la italiana, o desmarcá el bisel.';
    }
    // #1534 r1 — supports without spacing saved and only failed later, at
    // BOM time inside a design (the base editor taught it here).
    const supports = current.members.find((m) => m.key === 'supports');
    if (supports && supports.hardwareId !== '' &&
      (!Number.isInteger(Number(supports.spacingMm)) || Number(supports.spacingMm) <= 0)) {
      return 'Indica cada cuántos mm van los soportes (un número entero mayor a 0)';
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    // #1534: the v2 editor has no id field — derive it from the code.
    const current = editingId == null && draft.id.trim() === '' && draft.code.trim() !== ''
      ? { ...draft, id: suggestOpeningProfileId(draft.code) }
      : draft;
    const err = validate(current);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (editingId) {
        await onUpdate(editingId, editingVersion, current);
      } else {
        await onCreate(current.id.trim(), current);
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

  const columns: CatalogColumn<OpeningProfileRow>[] = useMemo(
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
        key: 'manufacturer',
        header: 'Fabricante',
        render: (r) => r.manufacturer ?? '—',
      },
      {
        key: 'grip',
        header: 'Agarre',
        render: (r) => gripColumn(r),
      },
      {
        key: 'usabilidad',
        header: 'Uso',
        render: (r) => usabilityColumn(r),
      },
      {
        key: 'datasheet',
        header: 'Ficha',
        render: (r) =>
          r.datasheetStatus === 'verified' ? (
            <span className="status-badge status-badge--info">Verificada</span>
          ) : (
            <span className="status-badge status-badge--neutral">Pendiente</span>
          ),
      },
      {
        key: 'effects',
        header: 'Efectos',
        render: (r) => (r.bodyModifiers.length > 0 ? `${r.bodyModifiers.length}` : '—'),
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
    <section className="catalog-page" aria-label="Catálogo de perfiles de apertura">
      <PageHeader
        title="Perfiles de apertura"
        subtitle="Perfiles de agarre con su ficha verificada: geometría declarada, efectos sobre el cuerpo y herrajes por referencia"
        icon={<DoorOpen size={16} strokeWidth={1.5} />}
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
              data-testid="opening-profile-create-btn"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo perfil
            </button>
          ) : undefined
        }
      />

      {!isTrulyEmpty ? (
        <PageToolbar
          ariaLabel="Buscar y filtrar perfiles de apertura"
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar perfiles…"
              aria-label="Buscar perfiles de apertura"
            />
          }
          filters={<StatusChips value={status} onChange={setStatus} />}
        />
      ) : null}

      <div className="catalog-layout">
        {isTrulyEmpty ? (
          <EmptyState
            icon={DoorOpen}
            title="No hay perfiles de apertura"
            description="Un perfil de apertura declara la geometría de ficha (gola, jaladera, rebase), los efectos sobre el cuerpo y los herrajes por referencia."
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
                  <span className="catalog-row-detail__label">Identificador</span>
                  <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                    {row.id}
                  </span>
                </div>
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Versión</span>
                  <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                    v{row.version}
                  </span>
                </div>
                {row.manufacturer ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Fabricante</span>
                    <span className="catalog-row-detail__value">{row.manufacturer}</span>
                  </div>
                ) : null}
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Ficha técnica</span>
                  <span className="catalog-row-detail__value">
                    {row.datasheetStatus === 'verified' ? 'Verificada' : 'Pendiente'}
                  </span>
                </div>
                {row.profileHeightMm != null && row.profileDepthMm != null ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Sección de ficha</span>
                    <span className="catalog-row-detail__value">
                      {formatNumber(row.profileHeightMm)} alto × {formatNumber(row.profileDepthMm)} profundo
                    </span>
                  </div>
                ) : null}
                {row.doorReductionMm != null ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Descuento de puerta</span>
                    <span className="catalog-row-detail__value">
                      {formatNumber(row.doorReductionMm)} mm
                    </span>
                  </div>
                ) : row.frontReductionMm != null ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Descuento de puerta (par de ficha)</span>
                    <span className="catalog-row-detail__value">
                      {formatNumber(row.frontReductionMm)} + {formatNumber(row.gripClearanceMm ?? 0)} mm
                    </span>
                  </div>
                ) : null}
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Fronteras</span>
                  <span className="catalog-row-detail__value">
                    {row.placements.join(', ')}
                  </span>
                </div>
                {row.bodyModifiers.length > 0 ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Efectos declarados</span>
                    <span className="catalog-row-detail__value">
                      {row.bodyModifiers
                        .map((modifier) => modifierLabel(modifier, row.profileDepthMm))
                        .join(' · ')}
                    </span>
                  </div>
                ) : null}
                {row.geometryOrigin ? (
                  <div className="catalog-row-detail__field">
                    <span className="catalog-row-detail__label">Origen de la ficha</span>
                    <span className="catalog-row-detail__value">{row.geometryOrigin}</span>
                  </div>
                ) : null}
                <div className="catalog-row-detail__field">
                  <span className="catalog-row-detail__label">Herrajes del perfil</span>
                  <span className="catalog-row-detail__value">
                    {row.bomMemberKeys.length > 0
                      ? row.bomMemberKeys.join(', ')
                      : 'sin miembros declarados'}
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

      <GolaProfileEditorModal
        open={modalOpen}
        identity={editingProfile ? { code: editingProfile.code, name: editingProfile.name } : undefined}
        editingId={editingId}
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        error={error}
        savedUsage={editingProfile?.usage ?? null}
        canMutate={canMutate}
        saving={saving}
        onSubmit={handleSubmit}
        onClose={closeModal}
        api={api ?? (undefined as unknown as GraneteApiClient)}
        token={token}
        hardwareOptions={hardwareOptions}
        componentOptions={componentOptions}
      />

      <ConfirmDialog
        open={confirmDeactivate != null}
        onClose={() => setConfirmDeactivate(null)}
        title="Desactivar perfil de apertura"
        message={
          confirmDeactivate
            ? `¿Seguro que querés desactivar "${confirmDeactivate.code} — ${confirmDeactivate.name}"? Los diseños existentes siguen resolviendo con su versión pineada.`
            : ''
        }
        confirmLabel="Desactivar"
        dataTestId="opening-profile-deactivate-confirm"
        onConfirm={() => {
          if (confirmDeactivate) onDeactivate(confirmDeactivate.id, confirmDeactivate.version);
        }}
      />
    </section>
  );
}

/** The persisted write body of the draft (snake_case contract). */
export function openingProfileWriteBody(
  draft: OpeningProfileDraft,
): OpeningProfileWrite {
  // #1534: the v2 editor always writes v2-shaped — material + positions +
  // per-position discounts, with the #1530 bridge fields kept coherent
  // (grip_type=gola, compatible_placements=positions,
  // door_reduction_mm=front_discount_top_mm).
  const positions = [
    ...(draft.top ? ['top'] : []),
    ...(draft.between ? ['between'] : []),
  ];
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    // #1329: informational maker name; absent stays absent (never "").
    ...(draft.manufacturer.trim() !== '' ? { manufacturer: draft.manufacturer.trim() } : {}),
    grip_type: 'gola',
    ...(draft.crossSection !== '' ? { cross_section_shape: draft.crossSection } : {}),
    ...(draft.material !== '' ? { material: draft.material } : {}),
    compatible_placements: positions,
    ...(draft.material !== ''
      ? {
          ...(draft.frontDiscountTopMm !== '' && draft.top
            ? { front_discount_top_mm: Number(draft.frontDiscountTopMm) }
            : {}),
          ...(draft.frontDiscountBetweenMm !== '' && draft.between
            ? { front_discount_between_mm: Number(draft.frontDiscountBetweenMm) }
            : {}),
        }
      : {}),
    // #1534 r1 — the datasheet status derives from the declared envelope
    // (alto + profundidad + descuento efectivo + origen, the legacy
    // authoring rule): declaring the complete datasheet WITH its origin is
    // the verification. A row that arrived verified keeps it while the
    // hidden legacy pair stands; clearing the VISIBLE top discount with no
    // pair demotes honestly (the ficha line shows it as it happens).
    datasheet_status: datasheetStatusOfDraft(draft),
    // #1316/#1530: the workshop-facing discount travels as ONE number; the
    // v2 bridge keeps door_reduction_mm = front_discount_top_mm coherent,
    // and the legacy datasheet pair round-trips as documentation. Only a
    // DECLARED top position mirrors it (r2: a stale hidden value never
    // travels in a write that omits the position).
    ...(draft.material !== ''
      ? draft.top && draft.frontDiscountTopMm !== ''
        ? { door_reduction_mm: Number(draft.frontDiscountTopMm) }
        : {}
      : draft.doorReductionMm !== ''
        ? { door_reduction_mm: Number(draft.doorReductionMm) }
        : {}),
    ...(draft.frontReductionMm !== '' ? { front_reduction_mm: Number(draft.frontReductionMm) } : {}),
    ...(draft.gripClearanceMm !== '' ? { grip_clearance_mm: Number(draft.gripClearanceMm) } : {}),
    ...(draft.profileHeightMm !== '' ? { profile_height_mm: Number(draft.profileHeightMm) } : {}),
    ...(draft.profileDepthMm !== '' ? { profile_depth_mm: Number(draft.profileDepthMm) } : {}),
    ...(draft.geometryOrigin.trim() !== '' ? { geometry_origin: draft.geometryOrigin.trim() } : {}),
    body_modifiers: bodyModifiersOfDraft(draft),
    bom_members: membersMapOfDraft(draft.members),
    active: true,
  };
}
