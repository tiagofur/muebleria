/**
 * Materials (MaterialBoard) catalog ABM — list + search + chips + modal MD.
 * F027: material links default edge band by id; create-edge shortcut from form.
 * F117 split: form lives in MaterialFormModal, edge quick-create in
 * EdgeQuickCreateModal, expanded detail in MaterialExpandedDetail.
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { EdgeBand, MaterialBoard, MaterialCategory } from '@granete/domain';
import {
  filterMaterialBoardsByCategory,
  isValidPreviewColor,
  normalizePreviewColor,
  UNCATEGORIZED_FILTER,
} from '@granete/domain';
import {
  Eye,
  EyeOff,
  Layers,
  Pencil,
  Plus,
  SearchX,
} from 'lucide-react';
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
import { consumeRequestCreateKey } from '../../common/consumeRequestCreateKey';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
} from '../catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from '../CatalogTable';
import type { EdgeDraft } from '../EdgesCatalog';
import type { CategoryDraft } from '../../modules/moduleHelpers';
import { CategoryTree } from '../ambient/AmbientCategoryTree';
import { MaterialCategoryModals } from './MaterialCategoryModals';
import {
  loadImageNaturalSize,
  suggestTextureTileMmFromImage,
} from '../materialTextureTileSuggest';
import { EdgeQuickCreateModal } from './EdgeQuickCreateModal';
import { MaterialFormModal } from './MaterialFormModal';
import { MaterialExpandedDetail } from './MaterialExpandedDetail';
import {
  type MaterialCostInputs,
  type MaterialDraft,
  emptyDraft,
  hasPreview3dConfig,
  toDraft,
} from './materialDraft';

export type { MaterialCostInputs, MaterialDraft };

import '../catalogs.css';

export interface MaterialsCatalogProps {
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  /** F142: subgrupos de materiales (árbol de categorías) para el form. */
  readonly materialCategories?: readonly MaterialCategory[];
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
  /**
   * Increment from shell to open create modal (Dashboard getting-started).
   * 0 / undefined = no request.
   */
  readonly requestCreateKey?: number;
  /** F035: hide ABM when false (read-only list). */
  readonly canMutate?: boolean;
  /** F039: hide unit costs for vendedor. */
  readonly showCosts?: boolean;
  /** F042: upload catalog image; returns relative media URL. */
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  /** Category CRUD for material categories (F142) */
  readonly onCreateCategory?: (draft: CategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: CategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
}

export function MaterialsCatalog({
  materials,
  edges,
  materialCategories = [],
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  onCreateEdge,
  getCostPerM2,
  openEntityId = null,
  onSelectionChange,
  requestCreateKey = 0,
  canMutate = true,
  showCosts = true,
  onUploadImage,
  resolveImageUrl = (u) => u,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: MaterialsCatalogProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
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
  const [tileSuggestBusy, setTileSuggestBusy] = useState(false);
  const [tileSuggestMsg, setTileSuggestMsg] = useState<string | null>(null);
  /** Progressive disclosure: color / texture / tile mm (Fase 3 UI). */
  const [preview3dOpen, setPreview3dOpen] = useState(false);

  const categoryFilterCounts = useMemo(() => {
    const byCategoryId = new Map<string, number>();
    for (const cat of materialCategories) {
      byCategoryId.set(
        cat.id,
        filterMaterialBoardsByCategory(materials, cat.id, materialCategories).length,
      );
    }
    return {
      all: materials.length,
      uncategorized: filterMaterialBoardsByCategory(
        materials,
        UNCATEGORIZED_FILTER,
        materialCategories,
      ).length,
      byCategoryId,
    };
  }, [materials, materialCategories]);

  const rows = useMemo(() => {
    const byCat = filterMaterialBoardsByCategory(
      materials,
      categoryFilter,
      materialCategories,
    );
    return filterCatalogItems(byCat, {
      status,
      query: debouncedSearch,
    });
  }, [materials, categoryFilter, materialCategories, status, debouncedSearch]);

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

  const suggestTilesFromImage = async () => {
    setTileSuggestMsg(null);
    const textureImagePath =
      draft.previewTextureUrl.trim() || draft.imageUrl.trim() || '';
    if (!textureImagePath) {
      setTileSuggestMsg(
        'Cargá una foto del material (o activá “Usar foto como textura 3D”) antes de sugerir medidas.',
      );
      return;
    }
    const url = resolveImageUrl(textureImagePath);
    if (!url) {
      setTileSuggestMsg('No se pudo resolver la URL de la imagen.');
      return;
    }
    setTileSuggestBusy(true);
    try {
      const { widthPx, heightPx } = await loadImageNaturalSize(url);
      const suggested = suggestTextureTileMmFromImage({
        imageWidthPx: widthPx,
        imageHeightPx: heightPx,
        boardWidthMm: draft.widthMm,
        boardLengthMm: draft.lengthMm,
        baseWidthMm:
          draft.previewTextureTileWidthMm > 0
            ? draft.previewTextureTileWidthMm
            : undefined,
      });
      setDraft((prev) => ({
        ...prev,
        previewTextureTileWidthMm: suggested.tileWidthMm,
        previewTextureTileLengthMm: suggested.tileLengthMm,
      }));
      setTileSuggestMsg(
        suggested.mode === 'board'
          ? `Base desde el tablero: ${suggested.tileWidthMm} × ${suggested.tileLengthMm} mm (foto ≈ cara completa). Ajustá si es un recorte.`
          : `Base por proporción de la imagen (${widthPx}×${heightPx} px): ${suggested.tileWidthMm} × ${suggested.tileLengthMm} mm. Ajustá si no calza en 3D.`,
      );
    } catch {
      setTileSuggestMsg(
        'No se pudo leer la imagen. Verificá que la foto cargue bien en el catálogo.',
      );
    } finally {
      setTileSuggestBusy(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setTileSuggestMsg(null);
    setTileSuggestBusy(false);
    setPreview3dOpen(false);
    setError(null);
    setEdgeCreateOpen(false);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setPreview3dOpen(false);
    setTileSuggestMsg(null);
    setEdgeCreateOpen(false);
    setModalOpen(true);
  };

  // Consume once per key bump so remount with the same key does not re-open
  // create (JD R4-W sticky create — same pattern as ModulesScreen).
  useEffect(() => {
    if (!consumeRequestCreateKey('materials', requestCreateKey)) return;
    startCreate();
    // Intentionally only when shell bumps the key (Dashboard handoff).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate is stable enough per bump
  }, [requestCreateKey]);

  const startEdit = (item: MaterialBoard) => {
    const next = toDraft(item);
    setEditingId(item.id);
    setDraft(next);
    setError(null);
    setPreview3dOpen(hasPreview3dConfig(next));
    setTileSuggestMsg(null);
    setEdgeCreateOpen(false);
    setModalOpen(true);
  };

  const openCreateEdge = () => setEdgeCreateOpen(true);

  const validate = (): string | null => {
    const codeErr = validateUniqueCode(
      draft.code,
      materials,
      editingId ?? undefined,
    );
    if (codeErr) return codeErr;
    const nameErr = validateRequiredName(draft.name);
    if (nameErr) return nameErr;
    if (!draft.manufacturer.trim()) {
      return 'Ingresá el fabricante del tablero (ej. Arauco, Masisa).';
    }
    const colorTrim = draft.previewColor.trim();
    if (colorTrim && !isValidPreviewColor(colorTrim)) {
      return 'Color de vista previa inválido. Usá #RGB o #RRGGBB, o dejalo vacío.';
    }
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
    const normalizedColor = normalizePreviewColor(draft.previewColor);
    const parsePbr = (v: number | '' | undefined) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;

    const finalDraft = {
      ...draft,
      costPerM2: calculatedCost,
      previewColor: normalizedColor ?? '',
      previewTextureUrl: draft.previewTextureUrl.trim(),
      previewTextureTileWidthMm:
        draft.previewTextureTileWidthMm > 0
          ? draft.previewTextureTileWidthMm
          : 0,
      previewTextureTileLengthMm:
        draft.previewTextureTileLengthMm > 0
          ? draft.previewTextureTileLengthMm
          : 0,
      previewRoughness: parsePbr(draft.previewRoughness),
      previewMetalness: parsePbr(draft.previewMetalness),
      previewClearcoat: parsePbr(draft.previewClearcoat),
    };

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
        key: 'previewColor',
        header: 'Color',
        render: (r) =>
          r.previewColor ? (
            <svg
              className="material-color-swatch"
              width={20}
              height={20}
              viewBox="0 0 20 20"
              aria-label={r.previewColor}
              data-testid={`material-swatch-${r.id}`}
            >
              <rect
                x={0}
                y={0}
                width={20}
                height={20}
                rx={4}
                fill={r.previewColor}
              />
            </svg>
          ) : (
            <span className="catalog-form__hint">—</span>
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
        key: 'thickness',
        header: 'Espesor (mm)',
        render: (r) => r.thicknessMm,
      },
      {
        key: 'dimensions',
        header: 'Medidas (mm)',
        render: (r) => {
          const areaM2 = (r.lengthMm * r.widthMm) / 1_000_000;
          return `${r.lengthMm} × ${r.widthMm} (${areaM2.toFixed(2)} m²)`;
        },
      },
      {
        key: 'boardPrice',
        header: 'Precio Hoja',
        render: (r) => formatMoneyDisplay(r.boardPrice),
      },
      {
        key: 'waste',
        header: 'Merma (%)',
        render: (r) => `${r.wastePercent}%`,
      },
      {
        key: 'cost',
        header: 'Costo/m²',
        render: (r) => formatMoneyDisplay(r.costPerM2),
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
    () =>
      showCosts
        ? columns
        : columns.filter(
            (c) => c.key !== 'boardPrice' && c.key !== 'waste' && c.key !== 'cost',
          ),
    [columns, showCosts],
  );

  const isTrulyEmpty = materials.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;

      const showCategorySidebar =
    materialCategories.length > 0 || Boolean(onCreateCategory);

  return (
    <section className="catalog-page" aria-label="Catálogo de materiales">
      <PageHeader
        title="Materiales"
        subtitle="Tableros del catálogo (melamina, MDF, etc.)"
        icon={<Layers size={16} strokeWidth={1.5} />}
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo material
            </button>
          ) : undefined
        }
      />

      <div className={showCategorySidebar ? 'module-list-layout' : 'catalog-layout'}>
        {showCategorySidebar ? (
          <aside
            className="module-category-tree"
            aria-label="Filtro por categorías"
            data-testid="category-filter-panel"
          >
            <div className="module-category-tree__header">
              <h3 className="module-category-tree__title">Categorías</h3>
              {canMutate && onCreateCategory ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setManageCategoriesOpen(true)}
                  aria-label="Editar categorías"
                  data-testid="category-filter-edit"
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
              data-testid="category-filter-all"
            >
              <span className="module-category-tree__label">Todas</span>
              <span
                className="module-category-tree__count"
                data-testid="category-filter-count-all"
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
              data-testid="category-filter-uncategorized"
            >
              <span className="module-category-tree__label">Sin categoría</span>
              <span
                className="module-category-tree__count"
                data-testid="category-filter-count-uncategorized"
              >
                {categoryFilterCounts.uncategorized}
              </span>
            </button>
            {materialCategories.length === 0 ? (
              <p className="module-category-tree__empty">
                Sin categorías. Usá «Editar categorías» para crear la jerarquía de materiales.
              </p>
            ) : (
              <CategoryTree
                categories={materialCategories}
                parentId={undefined}
                depth={0}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                counts={categoryFilterCounts.byCategoryId}
              />
            )}
          </aside>
        ) : null}

        <div className="module-list-main">
          {!isTrulyEmpty ? (
            <PageToolbar
              ariaLabel="Buscar y filtrar materiales"
              search={
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar materiales…"
                  aria-label="Buscar materiales"
                />
              }
              filters={<StatusChips value={status} onChange={setStatus} />}
            />
          ) : null}

          {isTrulyEmpty ? (
            <EmptyState
              icon={Layers}
              title="No hay materiales"
              description="Agregá el primer tablero del catálogo o cargá la semilla del workspace."
              actionLabel="Agregar material"
              onAction={startCreate}
            />
          ) : isFilterEmpty ? (
            <EmptyState
              variant="no-results"
              icon={SearchX}
              title="Sin resultados"
              description="No hay materiales que coincidan con la búsqueda o el filtro."
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearch('');
                setStatus('active');
                setCategoryFilter(null);
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
                <MaterialExpandedDetail
                  row={row}
                  edgeNameById={edgeNameById}
                  resolveImageUrl={resolveImageUrl}
                />
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
      </div>

      <MaterialCategoryModals
        open={manageCategoriesOpen}
        onClose={() => setManageCategoriesOpen(false)}
        categories={materialCategories}
        onCreateCategory={onCreateCategory}
        onUpdateCategory={onUpdateCategory}
        onDeleteCategory={onDeleteCategory}
        onAfterDelete={(deletedId) => {
          if (categoryFilter === deletedId) {
            setCategoryFilter(null);
          }
        }}
      />

      <MaterialFormModal
        materialCategories={materialCategories}
        open={modalOpen}
        editingId={editingId}
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        error={error}
        activeEdges={activeEdges}
        canMutate={canMutate}
        getCostPerM2={getCostPerM2}
        onUploadImage={onUploadImage}
        resolveImageUrl={resolveImageUrl}
        preview3dOpen={preview3dOpen}
        setPreview3dOpen={setPreview3dOpen}
        tileSuggestBusy={tileSuggestBusy}
        tileSuggestMsg={tileSuggestMsg}
        onSuggestTiles={() => {
          void suggestTilesFromImage();
        }}
        onSubmit={handleSubmit}
        onClose={closeModal}
        onOpenCreateEdge={openCreateEdge}
      />

      <EdgeQuickCreateModal
        open={edgeCreateOpen}
        prefill={{ code: draft.code.trim(), name: draft.name.trim() }}
        edges={edges}
        onClose={() => setEdgeCreateOpen(false)}
        onCreateEdge={onCreateEdge}
        onCreated={(newId) => {
          setDraft((d) => ({ ...d, defaultEdgeBandId: newId }));
          setEdgeCreateOpen(false);
        }}
      />
    </section>
  );
}
