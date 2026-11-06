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
import type {
  Agregado,
  Hardware,
  HardwareCategoryNode,
  HardwareKitCreateRequest,
  HardwareKitResult,
  KitPartPlacementConfig,
} from '@granete/domain';
import {
  UNCATEGORIZED_FILTER,
  ValidationError,
  countMachiningOperations,
  ensureAgregadoKitParts,
  filterHardwareByCategory,
  formatKitPartPlacementLabel,
  isHardwareKitPart,
  validateMachiningProfile,
  suggestDuplicateCode,
  syncAgregadoWithKitParts,
} from '@granete/domain';
import type { HardwareAssetService, WorkshopKitTemplateRow } from '@granete/storage';
import type { CategoryDraft } from '../../modules/moduleHelpers';
import { CategoryTree } from '../ambient/AmbientCategoryTree';
import { HardwareCategoryModals } from './HardwareCategoryModals';
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
import { KitTemplateEditorModal } from './KitTemplateEditorModal';
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
  /** #1422 slice 2: plantillas de juego del taller para el asistente. */
  readonly kitTemplates?: readonly WorkshopKitTemplateRow[];
  readonly kitTemplatesStatus?: { readonly loading: boolean; readonly notice: string | null };
  readonly onSaveKitTemplate?: (row: WorkshopKitTemplateRow) => Promise<WorkshopKitTemplateRow>;
  readonly onDeleteKitTemplate?: (id: string, expectedVersion: number) => Promise<void>;
  readonly onReloadKitTemplates?: () => Promise<void>;
  /** #1418 restante (perfección): catálogo de agregados para el link kit→diseño. */
  readonly agregados?: readonly Agregado[];
  /** Actualiza la receta del agregado asociado al kit cuando cambian sus partes (#1422 / #1435). */
  readonly onUpdateAgregado?: (agregado: Agregado) => void | Promise<void>;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  /** #1507: árbol de subgrupos de herrajes + su ABM (mismo patrón que tableros F142). */
  readonly hardwareCategories?: readonly HardwareCategoryNode[];
  readonly onCreateCategory?: (draft: CategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: CategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
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
  onUpdateAgregado,
  kitTemplates = [],
  kitTemplatesStatus,
  onSaveKitTemplate,
  onDeleteKitTemplate,
  onReloadKitTemplates,
  resolveImageUrl = (u) => u,
  hardwareCategories = [],
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: HardwareCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  // #1507: filtro por subgrupo de herrajes (null = todas).
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
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
  // #1422 slice 2: editor de plantillas del taller (desde el asistente).
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WorkshopKitTemplateRow | null>(null);
  // #1422 slice 1 revisión owner: las partes de diseño NUNCA son filas sueltas
  // — viven anidadas dentro del card expandido de su kit (como un XML:
  // <kit><parte/><parte/></kit>). Sólo la búsqueda las lista planas para poder
  // encontrarlas; el chip anterior se elimina.
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
    for (const a of agregados) {
      for (const rm of a.rigidMembers ?? []) {
        const hwId = rm.source.fixed?.hardwareId;
        if (!hwId) continue;
        const part = kitById.get(hwId);
        if (part?.kitHardwareId && !map.has(part.kitHardwareId)) {
          map.set(part.kitHardwareId, a);
        }
      }
    }
    // #1493: kits declarados por VARIANTE (una altura Blum MERIVOBOX = un kit)
    // también ligan la receta al kit.
    for (const a of agregados) {
      for (const vs of a.variantSets ?? []) {
        for (const v of vs.variants ?? []) {
          if (v.commercialKitHardwareId && !map.has(v.commercialKitHardwareId)) {
            map.set(v.commercialKitHardwareId, a);
          }
        }
      }
    }
    return map;
  }, [agregados, kitById]);

  /** #1422 owner: badge fija/móvil de una parte, leído de la receta del kit o de la parte. */
  const membershipBadgeOf = (part: Hardware): string | null => {
    const recipe = part.kitHardwareId ? designByKit.get(part.kitHardwareId) : undefined;
    const member = recipe?.rigidMembers?.find(
      (m) => m.source.fixed?.hardwareId === part.id,
    );
    const actor = part.designParts?.[0]?.actorMembership || member?.actorMembership;
    if (!actor) return null;
    if (actor === 'body') return 'Fija al mueble';
    if (actor === 'actor:drawer') return 'Móvil — sale con el cajón';
    return 'Móvil — abre con la puerta';
  };

  // #1507: counts del árbol por subgrupo (nodo + descendientes) + sin categoría.
  const categoryFilterCounts = useMemo(() => {
    const byCategoryId = new Map<string, number>();
    for (const cat of hardwareCategories) {
      byCategoryId.set(
        cat.id,
        filterHardwareByCategory(hardware, cat.id, hardwareCategories).length,
      );
    }
    return {
      all: hardware.length,
      uncategorized: filterHardwareByCategory(
        hardware,
        UNCATEGORIZED_FILTER,
        hardwareCategories,
      ).length,
      byCategoryId,
    };
  }, [hardware, hardwareCategories]);

  const rows = useMemo(
    () =>
      filterCatalogItems(
        filterHardwareByCategory(hardware, categoryFilter, hardwareCategories),
        {
          status,
          query: debouncedSearch,
        },
      ).filter((h) => !isHardwareKitPart(h) || debouncedSearch.trim() !== ''),
    [hardware, categoryFilter, hardwareCategories, status, debouncedSearch],
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

  const syncKitAgregado = (kitId: string, updatedParts: readonly Hardware[]) => {
    if (!onUpdateAgregado) return;
    const recipe = designByKit.get(kitId);
    if (!recipe) return;
    // #1493: kit ligado por variante ⇒ sync ADITIVO. Review #1494 slice 2:
    // el mismo guard mixto del store — si la receta TAMBIÉN declara kits por
    // variante, el espejo destructivo del kit a nivel agregado borraría en
    // silencio las partes de los otros kits; en esa combinación manda el
    // sync aditivo.
    const declaresAnyVariantKit = (recipe.variantSets ?? []).some((vs) =>
      (vs.variants ?? []).some((v) => (v.commercialKitHardwareId ?? '').trim() !== ''),
    );
    const synced =
      recipe.commercialKitHardwareId === kitId && !declaresAnyVariantKit
        ? syncAgregadoWithKitParts(recipe, updatedParts)
        : ensureAgregadoKitParts(recipe, updatedParts);
    void onUpdateAgregado(synced);
  };

  // #1422 owner: edición del kit → partes indentadas dentro del formulario.
  const openKitPart = (part: Hardware) => {
    closeModal();
    startEdit(part);
  };
  const removeKitPart = (part: Hardware) => {
    const draft = toDraft(part);
    delete draft.kitHardwareId;
    void onUpdate(part.id, draft);
    if (part.kitHardwareId) {
      const remaining = (partsByKit.get(part.kitHardwareId) ?? []).filter((p) => p.id !== part.id);
      syncKitAgregado(part.kitHardwareId, remaining);
    }
  };
  const linkExistingPartToKit = (kit: Hardware, partId: string) => {
    const targetPart = hardware.find((h) => h.id === partId);
    if (!targetPart) return;
    const draft = toDraft(targetPart);
    draft.kitHardwareId = kit.id;
    void onUpdate(targetPart.id, draft);
    const currentParts = partsByKit.get(kit.id) ?? [];
    if (!currentParts.some((p) => p.id === targetPart.id)) {
      syncKitAgregado(kit.id, [...currentParts, { ...targetPart, kitHardwareId: kit.id }]);
    }
  };
  const addKitPart = (kit: Hardware) => {
    const existing = new Set(hardware.map((h) => h.code));
    let n = (partsByKit.get(kit.id)?.length ?? 0) + 1;
    while (existing.has(`${kit.code}-P${n}`)) n += 1;
    const next = emptyDraft();
    next.code = `${kit.code}-P${n}`;
    next.name = `${kit.name} — Parte ${n}`;
    next.unit = 'piece';
    next.costPerUnit = 0;
    next.kitHardwareId = kit.id;
    closeModal();
    setEditingId(null);
    setDraft(next);
    setError(null);
    setModalOpen(true);
  };

  const updateKitPartConfig = (part: Hardware, nextCfg: KitPartPlacementConfig) => {
    const nextDesignParts = [
      {
        componentName: part.code,
        actorMembership: nextCfg.actorMembership,
        label: formatKitPartPlacementLabel(nextCfg),
        finishKey: '',
      },
    ];
    const partDraft = toDraft(part);
    partDraft.designParts = nextDesignParts;
    void onUpdate(part.id, partDraft);
    if (part.kitHardwareId) {
      const currentParts = partsByKit.get(part.kitHardwareId) ?? [];
      const updatedParts = currentParts.map((p) =>
        p.id === part.id
          ? {
              ...p,
              designParts: [
                {
                  componentName: part.code,
                  actorMembership: nextCfg.actorMembership,
                  label: formatKitPartPlacementLabel(nextCfg),
                },
              ],
            }
          : p,
      );
      syncKitAgregado(part.kitHardwareId, updatedParts);
    }
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
    // #1453 F1: the canonical bounding box travels complete or empty.
    const dimFilled = [
      draft.dimensionWidthMm,
      draft.dimensionHeightMm,
      draft.dimensionDepthMm,
    ].filter((v) => v.trim() !== '').length;
    if (dimFilled !== 0 && dimFilled !== 3) {
      return 'Las dimensiones W×H×D van completas o vacías — completá las tres o dejá las tres en blanco';
    }
    if (dimFilled === 3) {
      const nums = [
        Number(draft.dimensionWidthMm),
        Number(draft.dimensionHeightMm),
        Number(draft.dimensionDepthMm),
      ];
      if (nums.some((n) => !Number.isFinite(n) || n <= 0)) {
        return 'Las dimensiones W×H×D deben ser mayores a 0 mm';
      }
    }
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
              {r.pieces && r.pieces.length > 0 ? (
                <span
                  className="catalog-badge catalog-badge--kit"
                  data-testid={`hardware-pieces-badge-${r.code}`}
                >
                  {r.pieces.length} pieza{r.pieces.length === 1 ? '' : 's'} D/I/C
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
  // #1507: el sidebar de categorías aparece cuando hay árbol o se puede crear.
  const showCategorySidebar =
    hardwareCategories.length > 0 || Boolean(onCreateCategory);

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
              onClick={() => {
                onReloadKitTemplates?.();
                setKitWizardOpen(true);
              }}
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
            </>
          }
        />
      ) : null}

      <div className={showCategorySidebar ? 'module-list-layout' : 'catalog-layout'}>
        {showCategorySidebar ? (
          <aside
            className="module-category-tree"
            aria-label="Filtro por categorías"
            data-testid="hardware-category-filter-panel"
          >
            <div className="module-category-tree__header">
              <h3 className="module-category-tree__title">Categorías</h3>
              {canMutate && onCreateCategory ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setManageCategoriesOpen(true)}
                  aria-label="Editar categorías"
                  data-testid="hardware-category-filter-edit"
                >
                  <Pencil size={14} strokeWidth={1.5} aria-hidden />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className={
                categoryFilter === null
                  ? 'module-category-tree__item module-category-tree__item--active'
                  : 'module-category-tree__item'
              }
              onClick={() => setCategoryFilter(null)}
              data-testid="hardware-category-filter-all"
            >
              <span className="module-category-tree__label">Todas</span>
              <span
                className="module-category-tree__count"
                data-testid="hardware-category-filter-count-all"
              >
                {categoryFilterCounts.all}
              </span>
            </button>
            <button
              type="button"
              className={
                categoryFilter === UNCATEGORIZED_FILTER
                  ? 'module-category-tree__item module-category-tree__item--active'
                  : 'module-category-tree__item'
              }
              onClick={() => setCategoryFilter(UNCATEGORIZED_FILTER)}
              data-testid="hardware-category-filter-uncategorized"
            >
              <span className="module-category-tree__label">Sin categoría</span>
              <span
                className="module-category-tree__count"
                data-testid="hardware-category-filter-count-uncategorized"
              >
                {categoryFilterCounts.uncategorized}
              </span>
            </button>
            {hardwareCategories.length === 0 ? (
              <p className="module-category-tree__empty">
                Sin categorías. Usá «Editar categorías» para crear la jerarquía de herrajes.
              </p>
            ) : (
              <CategoryTree
                categories={hardwareCategories}
                parentId={undefined}
                depth={0}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                counts={categoryFilterCounts.byCategoryId}
              />
            )}
          </aside>
        ) : null}
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
                    <div className="catalog-kit-parts">
                      {partsByKit.get(row.id)!.map((part) => {
                        const badge = membershipBadgeOf(part);
                        return (
                          <div
                            key={part.id}
                            className="catalog-kit-part-card"
                            data-testid={`hardware-kit-part-card-${part.code}`}
                          >
                            <div className="catalog-kit-part-card__photo">
                              <CatalogImage
                                src={resolveImageUrl(part.imageUrl)}
                                alt={part.name}
                                size="md"
                              />
                            </div>
                            <div className="catalog-kit-part-card__fields">
                              <div className="catalog-row-detail__field">
                                <span className="catalog-row-detail__label">Código</span>
                                <span className="catalog-row-detail__value catalog-row-detail__value--mono">
                                  {part.code}
                                </span>
                              </div>
                              <div className="catalog-row-detail__field">
                                <span className="catalog-row-detail__label">Nombre</span>
                                <span className="catalog-row-detail__value">
                                  {part.name}
                                  {badge ? (
                                    <span
                                      className="status-badge status-badge--info"
                                      style={{ marginLeft: '0.4rem' }}
                                      data-testid={`hardware-kit-part-membership-${part.code}`}
                                    >
                                      {badge}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                              <div className="catalog-row-detail__field">
                                <span className="catalog-row-detail__label">Unidad</span>
                                <span className="catalog-row-detail__value">
                                  {UNIT_LABELS[part.unit]}
                                </span>
                              </div>
                              <div className="catalog-row-detail__field">
                                <span className="catalog-row-detail__label">Costo unitario</span>
                                <span className="catalog-row-detail__value">
                                  {formatMoneyDisplay(part.costPerUnit)}
                                </span>
                              </div>
                              <div className="catalog-row-detail__field">
                                <span className="catalog-row-detail__label">Estado</span>
                                <span className="catalog-row-detail__value">
                                  <ActiveBadge active={part.active} />
                                </span>
                              </div>
                            </div>
                            {canMutate ? (
                              <div className="catalog-kit-part-card__actions">
                                <button
                                  type="button"
                                  className="btn btn--small btn--ghost"
                                  aria-label={`Editar ${part.code}`}
                                  onClick={() => startEdit(part)}
                                >
                                  <Pencil size={14} strokeWidth={1.5} aria-hidden />
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--small btn--ghost"
                                  aria-label={`Duplicar ${part.code}`}
                                  onClick={() => startDuplicate(part)}
                                >
                                  <Copy size={14} strokeWidth={1.5} aria-hidden />
                                  Duplicar
                                </button>
                                {part.active ? (
                                  <button
                                    type="button"
                                    className="btn btn--small btn--ghost btn--danger"
                                    aria-label={`Desactivar ${part.code}`}
                                    onClick={() => setConfirmDeactivate(part)}
                                  >
                                    <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                                    Desactivar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn--small btn--ghost"
                                    aria-label={`Reactivar ${part.code}`}
                                    onClick={() => onReactivate(part.id)}
                                  >
                                    Reactivar
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
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

      <HardwareCategoryModals
        open={manageCategoriesOpen}
        onClose={() => setManageCategoriesOpen(false)}
        categories={hardwareCategories}
        onCreateCategory={onCreateCategory}
        onUpdateCategory={onUpdateCategory}
        onDeleteCategory={onDeleteCategory}
        onAfterDelete={(deletedId) => {
          if (categoryFilter === deletedId) {
            setCategoryFilter(null);
          }
        }}
      />

      <HardwareFormModal
        open={modalOpen}
        identity={editingHardware ? { code: editingHardware.code, name: editingHardware.name } : undefined}
        editingId={editingId}
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        hardwareCategories={hardwareCategories}
        error={error}
        canMutate={canMutate}
        saving={saving}
        assetService={assetService}
        onUploadImage={onUploadImage}
        resolveImageUrl={resolveImageUrl}
        onSubmit={handleSubmit}
        onClose={closeModal}
        kitParts={editingHardware ? partsByKit.get(editingHardware.id) : undefined}
        kitRecipe={
          editingHardware
            ? designByKit.get(editingHardware.id) ??
              (draft.kitHardwareId ? designByKit.get(draft.kitHardwareId) : undefined)
            : draft.kitHardwareId
              ? designByKit.get(draft.kitHardwareId)
              : undefined
        }
        availableHardware={hardware}
        onEditKitPart={canMutate ? openKitPart : undefined}
        onRemoveKitPart={canMutate ? removeKitPart : undefined}
        onAddKitPart={canMutate && editingHardware ? () => addKitPart(editingHardware) : undefined}
        onLinkExistingPart={
          canMutate && editingHardware
            ? (partId) => linkExistingPartToKit(editingHardware, partId)
            : undefined
        }
        onUpdateKitPartConfig={canMutate ? updateKitPartConfig : undefined}
      />

      {onCreateKit ? (
        <HardwareKitWizardModal
          open={kitWizardOpen}
          onClose={() => setKitWizardOpen(false)}
          hardware={hardware}
          agregadoCodes={agregadoCodes}
          onCreateKit={onCreateKit}
          assetService={assetService}
          customTemplates={kitTemplates}
          templatesStatus={kitTemplatesStatus}
          onEditTemplates={
            onSaveKitTemplate
              ? () => {
                  setEditingTemplate(null);
                  setKitWizardOpen(false);
                  setTemplateEditorOpen(true);
                }
              : undefined
          }
          onEditTemplate={
            onSaveKitTemplate && onDeleteKitTemplate
              ? (row) => {
                  setEditingTemplate(row);
                  setKitWizardOpen(false);
                  setTemplateEditorOpen(true);
                }
              : undefined
          }
        />
      ) : null}

      {onSaveKitTemplate ? (
        <KitTemplateEditorModal
          open={templateEditorOpen}
          onClose={() => setTemplateEditorOpen(false)}
          editing={editingTemplate}
          onSave={onSaveKitTemplate}
          onDelete={onDeleteKitTemplate}
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
