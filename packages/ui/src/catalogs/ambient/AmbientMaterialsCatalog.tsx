/**
 * Ambient materials / finishes catalog ABM — visual presentation materials
 * (surfaces, textures, hardware finishes, 3D geometries) for the scene.
 * NEVER enters BOM/cost/quote (F086 / spec #4148 / AmbientLeakGuard).
 *
 * Pattern: tabla-expand + CategoryTree sidebar + Modal SM (design.md §6.4).
 * F117 split: form in AmbientMaterialFormModal, categories in
 * AmbientCategoryModals + AmbientCategoryTree.
 */

import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AmbientCategory, AmbientMaterial } from '@muebles/domain';
import {
  categoryPath,
  filterAmbientMaterialsByCategory,
  isValidPreviewColor,
  normalizePreviewColor,
  UNCATEGORIZED_FILTER,
} from '@muebles/domain';
import {
  Eye,
  EyeOff,
  Palette,
  Pencil,
  Plus,
  SearchX,
} from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  PageToolbar,
  SearchInput,
  StatusChips,
  useDebouncedValue,
} from '../../common';
import {
  filterCatalogItems,
  validateRequiredName,
  validateUniqueCode,
  type CatalogStatusFilter,
} from '../catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from '../CatalogTable';
import { AmbientCategoryModals } from './AmbientCategoryModals';
import { CategoryTree } from './AmbientCategoryTree';
import { AmbientMaterialFormModal } from './AmbientMaterialFormModal';
import {
  type AmbientCategoryDraft,
  type AmbientMaterialDraft,
  emptyDraft,
  toDraft,
} from './ambientMaterialDraft';

export type { AmbientCategoryDraft, AmbientMaterialDraft };

import '../catalogs.css';

export interface AmbientMaterialsCatalogProps {
  readonly materials: readonly AmbientMaterial[];
  readonly categories?: readonly AmbientCategory[];
  readonly onCreate: (draft: AmbientMaterialDraft) => void;
  readonly onUpdate: (id: string, draft: AmbientMaterialDraft) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  readonly onCreateCategory?: (draft: AmbientCategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: AmbientCategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
  /** F035: hide ABM when false (read-only list). roleCanMutateCatalog gate. */
  readonly canMutate?: boolean;
  /** F042: upload media; returns relative media URL. */
  readonly onUploadImage?: (file: File) => Promise<string>;
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

export function AmbientMaterialsCatalog({
  materials,
  categories = [],
  onCreate,
  onUpdate,
  onDeactivate,
  onReactivate,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  canMutate = true,
  onUploadImage,
  resolveImageUrl = (u) => u,
}: AmbientMaterialsCatalogProps): ReactNode {
  const formId = useId();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Material Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AmbientMaterialDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  // Category Manage Modal state
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);

  // Category counts
  const categoryFilterCounts = useMemo(() => {
    const byCategoryId = new Map<string, number>();
    for (const cat of categories) {
      byCategoryId.set(
        cat.id,
        filterAmbientMaterialsByCategory(materials, cat.id, categories).length,
      );
    }
    return {
      all: materials.length,
      uncategorized: filterAmbientMaterialsByCategory(
        materials,
        UNCATEGORIZED_FILTER,
        categories,
      ).length,
      byCategoryId,
    };
  }, [materials, categories]);

  // Filtered rows (by Category + Status + Search)
  const rows = useMemo(() => {
    const byCat = filterAmbientMaterialsByCategory(
      materials,
      categoryFilter,
      categories,
    );
    return filterCatalogItems(byCat, {
      status,
      query: debouncedSearch,
    });
  }, [materials, categoryFilter, categories, status, debouncedSearch]);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft({
      ...emptyDraft(),
      categoryId:
        categoryFilter && categoryFilter !== UNCATEGORIZED_FILTER
          ? categoryFilter
          : '',
    });
    setError(null);
    setModalOpen(true);
  };

  const startEdit = (item: AmbientMaterial) => {
    setEditingId(item.id);
    setDraft(toDraft(item));
    setError(null);
    setModalOpen(true);
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
    const colorTrim = draft.previewColor.trim();
    if (colorTrim && !isValidPreviewColor(colorTrim)) {
      return 'Color de vista previa inválido. Usá #RGB o #RRGGBB, o dejalo vacío.';
    }
    return null;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    const parsePbr = (v: number | '' | undefined) =>
      typeof v === 'number' && Number.isFinite(v)
        ? Math.min(1, Math.max(0, v))
        : undefined;

    const finalDraft: AmbientMaterialDraft = {
      ...draft,
      categoryId: draft.categoryId?.trim() || undefined,
      previewColor: normalizePreviewColor(draft.previewColor) ?? '',
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

  const columns: CatalogColumn<AmbientMaterial>[] = useMemo(
    () => [
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
              data-testid={`ambient-material-swatch-${r.id}`}
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
        key: 'category',
        header: 'Categoría',
        render: (r) => {
          const path = categoryPath(r.categoryId, categories);
          if (path.length === 0) {
            return <span className="catalog-form__hint">—</span>;
          }
          return (
            <span className="badge badge--neutral">
              {path.map((c) => c.name).join(' › ')}
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Estado',
        render: (r) => <ActiveBadge active={r.active} />,
      },
    ],
    [categories],
  );

  const isTrulyEmpty = materials.length === 0;
  const isFilterEmpty = !isTrulyEmpty && rows.length === 0;
  const showCategorySidebar = categories.length > 0 || Boolean(onCreateCategory);

  return (
    <section className="catalog-page" aria-label="Catálogo de acabados">
      <PageHeader
        title="Acabados"
        subtitle="Acabados y texturas visuales para superficies, herrajes y objetos 3D (solo presentación, sin costo)"
        icon={<Palette size={16} strokeWidth={1.5} />}
        secondaryActions={
          canMutate && onCreateCategory ? (
            <button
              type="button"
              className="btn"
              onClick={() => setManageCategoriesOpen(true)}
              data-testid="manage-categories"
            >
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Editar categorías
            </button>
          ) : undefined
        }
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
              data-testid="ambient-material-create"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo acabado
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
            {categories.length === 0 ? (
              <p className="module-category-tree__empty">
                Sin categorías. Usá «Editar categorías» para crear la jerarquía de acabados.
              </p>
            ) : (
              <CategoryTree
                categories={categories}
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
              ariaLabel="Buscar y filtrar acabados"
              search={
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar acabados…"
                  aria-label="Buscar acabados"
                />
              }
              filters={<StatusChips value={status} onChange={setStatus} />}
            />
          ) : null}

          {isTrulyEmpty ? (
            <EmptyState
              icon={Palette}
              title="No hay acabados registrados"
              description="Agregá acabados visuales para texturizar superficies, herrajes y elementos 3D en el Estudio y Proyectos."
              actionLabel="Agregar acabado"
              onAction={startCreate}
            />
          ) : isFilterEmpty ? (
            <EmptyState
              variant="no-results"
              icon={SearchX}
              title="Sin resultados"
              description="No hay acabados que coincidan con la búsqueda o la categoría seleccionada."
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearch('');
                setStatus('active');
                setCategoryFilter(null);
              }}
            />
          ) : (
            <CatalogTable
              columns={columns}
              rows={rows}
              expandedId={expandedId}
              isInactive={(r) => !r.active}
              onRowClick={(row) =>
                setExpandedId((prev) => (prev === row.id ? null : row.id))
              }
              renderExpandedDetail={(row) => {
                const path = categoryPath(row.categoryId, categories);
                return (
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
                      <span className="catalog-row-detail__label">Categoría</span>
                      <span className="catalog-row-detail__value">
                        {path.length > 0
                          ? path.map((c) => c.name).join(' › ')
                          : 'Sin categoría'}
                      </span>
                    </div>
                    <div className="catalog-row-detail__field">
                      <span className="catalog-row-detail__label">Estado</span>
                      <span className="catalog-row-detail__value">
                        <ActiveBadge active={row.active} />
                      </span>
                    </div>
                  </>
                );
              }}
              getRowActions={(row) =>
                canMutate ? (
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
                ) : null
              }
            />
          )}
        </div>
      </div>

      <AmbientMaterialFormModal
        open={modalOpen}
        editingId={editingId}
        formId={formId}
        draft={draft}
        setDraft={setDraft}
        categories={categories}
        error={error}
        canMutate={canMutate}
        onUploadImage={onUploadImage}
        resolveImageUrl={resolveImageUrl}
        onSubmit={handleSubmit}
        onClose={closeModal}
      />

      <AmbientCategoryModals
        open={manageCategoriesOpen}
        onClose={() => setManageCategoriesOpen(false)}
        categories={categories}
        onCreateCategory={onCreateCategory}
        onUpdateCategory={onUpdateCategory}
        onDeleteCategory={onDeleteCategory}
        onAfterDelete={(id) => {
          if (categoryFilter === id) {
            setCategoryFilter(null);
          }
        }}
      />
    </section>
  );
}
