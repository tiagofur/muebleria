/**
 * Ambient materials / finishes catalog ABM — visual presentation materials
 * (surfaces, textures, hardware finishes, 3D geometries) for the scene.
 * NEVER enters BOM/cost/quote (F086 / spec #4148 / AmbientLeakGuard).
 *
 * Pattern: tabla-expand + CategoryTree sidebar + Modal SM (design.md §6.4).
 * Supports 3-level category hierarchy (Categoría L1 -> Subcategoría L2 -> Subcategoría L3).
 */

import {
  useId,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  AmbientCategory,
  AmbientMaterial,
  AmbientSurfaceType,
} from '@muebles/domain';
import {
  cascadeFromCategoryId,
  cascadeOptions,
  cascadeSelectedCategoryId,
  categoryPath,
  childrenOf,
  filterAmbientMaterialsByCategory,
  isValidPreviewColor,
  normalizePreviewColor,
  UNCATEGORIZED_FILTER,
} from '@muebles/domain';
import {
  Eye,
  EyeOff,
  Layers,
  Palette,
  Pencil,
  Plus,
  SearchX,
  Trash2,
} from 'lucide-react';
import {
  EmptyState,
  Modal,
  SearchInput,
  StatusChips,
  useDebouncedValue,
} from '../common';
import {
  filterCatalogItems,
  validateRequiredName,
  validateUniqueCode,
  type CatalogStatusFilter,
} from './catalogHelpers';
import { ActiveBadge, CatalogTable, type CatalogColumn } from './CatalogTable';
import type { CategoryDraft } from '../modules/moduleHelpers';

import './catalogs.css';

export type AmbientMaterialDraft = {
  code: string;
  name: string;
  surfaceType: AmbientSurfaceType;
  categoryId?: string;
  previewColor: string;
  /** Relative media path for 3D texture. */
  previewTextureUrl: string;
  previewTextureTileWidthMm: number;
  previewTextureTileLengthMm: number;
  previewRoughness?: number | '';
  previewMetalness?: number | '';
  previewClearcoat?: number | '';
};

export type AmbientCategoryDraft = CategoryDraft;

const emptyDraft = (): AmbientMaterialDraft => ({
  code: '',
  name: '',
  surfaceType: 'floor',
  categoryId: '',
  previewColor: '',
  previewTextureUrl: '',
  previewTextureTileWidthMm: 0,
  previewTextureTileLengthMm: 0,
  previewRoughness: '',
  previewMetalness: '',
  previewClearcoat: '',
});

function toDraft(item: AmbientMaterial): AmbientMaterialDraft {
  return {
    code: item.code,
    name: item.name,
    surfaceType: item.surfaceType,
    categoryId: item.categoryId ?? '',
    previewColor: item.previewColor ?? '',
    previewTextureUrl: item.previewTextureUrl ?? '',
    previewTextureTileWidthMm: item.previewTextureTileWidthMm ?? 0,
    previewTextureTileLengthMm: item.previewTextureTileLengthMm ?? 0,
    previewRoughness: item.previewRoughness ?? '',
    previewMetalness: item.previewMetalness ?? '',
    previewClearcoat: item.previewClearcoat ?? '',
  };
}

const SURFACE_TYPE_LABEL: Readonly<Record<AmbientSurfaceType, string>> = {
  floor: 'Suelo',
  wall: 'Pared',
  ceiling: 'Techo',
};

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

function CategoryTree({
  categories,
  parentId,
  depth,
  categoryFilter,
  setCategoryFilter,
  counts,
}: {
  readonly categories: readonly AmbientCategory[];
  readonly parentId: string | undefined;
  readonly depth: number;
  readonly categoryFilter: string | null;
  readonly setCategoryFilter: Dispatch<SetStateAction<string | null>>;
  readonly counts: ReadonlyMap<string, number>;
}): ReactNode {
  const nodes = childrenOf(categories, parentId);
  if (nodes.length === 0) return null;
  return (
    <ul
      className={
        depth === 0
          ? 'module-category-tree__list'
          : 'module-category-tree__list module-category-tree__list--nested'
      }
    >
      {nodes.map((node) => {
        const active = categoryFilter === node.id;
        const count = counts.get(node.id) ?? 0;
        return (
          <li key={node.id}>
            <button
              type="button"
              className={
                active
                  ? 'module-category-tree__item module-category-tree__item--active'
                  : 'module-category-tree__item'
              }
              onClick={() =>
                setCategoryFilter((prev) => (prev === node.id ? null : node.id))
              }
              data-testid={`category-filter-${node.id}`}
            >
              <span className="module-category-tree__label">{node.name}</span>
              <span
                className="module-category-tree__count"
                data-testid={`category-filter-count-${node.id}`}
              >
                {count}
              </span>
            </button>
            <CategoryTree
              categories={categories}
              parentId={node.id}
              depth={depth + 1}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              counts={counts}
            />
          </li>
        );
      })}
    </ul>
  );
}

function ManageCategoryRows({
  categories,
  parentId,
  depth,
  onEdit,
  onDelete,
  canDelete,
}: {
  readonly categories: readonly AmbientCategory[];
  readonly parentId: string | undefined;
  readonly depth: number;
  readonly onEdit: (cat: AmbientCategory) => void;
  readonly onDelete: (id: string) => void;
  readonly canDelete: boolean;
}): ReactNode {
  const nodes = childrenOf(categories, parentId);
  if (nodes.length === 0) return null;
  return (
    <ul
      className={
        depth === 0
          ? 'module-category-manage__list'
          : 'module-category-manage__list module-category-manage__list--nested'
      }
      data-testid={depth === 0 ? 'manage-categories-list' : undefined}
    >
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="module-category-manage__row">
            <div className="module-category-manage__row-main">
              <span className="module-category-manage__name">{node.name}</span>
              <span className="module-category-manage__meta">
                Nivel {depth + 1}
              </span>
            </div>
            <span className="module-category-manage__actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onEdit(node)}
                aria-label={`Editar ${node.name}`}
                data-testid={`manage-category-edit-${node.id}`}
              >
                <Pencil size={14} strokeWidth={1.5} />
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onDelete(node.id)}
                  aria-label={`Eliminar ${node.name}`}
                  data-testid={`manage-category-delete-${node.id}`}
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              ) : null}
            </span>
          </div>
          <ManageCategoryRows
            categories={categories}
            parentId={node.id}
            depth={depth + 1}
            onEdit={onEdit}
            onDelete={onDelete}
            canDelete={canDelete}
          />
        </li>
      ))}
    </ul>
  );
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
  const catFormId = useId();

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
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catDraft, setCatDraft] = useState<AmbientCategoryDraft>({
    name: '',
    parentId: '',
    sortOrder: '0',
  });
  const [catError, setCatError] = useState<string | null>(null);
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);

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

  // Draft category cascade for 3-level selector in material form modal
  const draftCascade = useMemo(
    () => cascadeFromCategoryId(draft.categoryId || undefined, categories),
    [draft.categoryId, categories],
  );
  const draftCascadeOpts = useMemo(
    () => cascadeOptions(categories, draftCascade),
    [categories, draftCascade],
  );

  const setDraftCascadeLevel = (level: 1 | 2 | 3, value: string) => {
    const next = {
      level1Id:
        level >= 1
          ? level === 1
            ? value || undefined
            : draftCascade.level1Id
          : undefined,
      level2Id:
        level >= 2
          ? level === 2
            ? value || undefined
            : draftCascade.level2Id
          : undefined,
      level3Id:
        level >= 3
          ? level === 3
            ? value || undefined
            : draftCascade.level3Id
          : undefined,
    };
    if (level === 1) {
      next.level2Id = undefined;
      next.level3Id = undefined;
      next.level1Id = value || undefined;
    } else if (level === 2) {
      next.level3Id = undefined;
      next.level2Id = value || undefined;
    } else {
      next.level3Id = value || undefined;
    }
    setDraft((prev) => ({
      ...prev,
      categoryId: cascadeSelectedCategoryId(next) ?? '',
    }));
  };

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

  // Category modal handlers
  const openCreateCategory = () => {
    setEditingCatId(null);
    setCatDraft({ name: '', parentId: '', sortOrder: '0' });
    setCatError(null);
    setCatFormOpen(true);
  };

  const openEditCategory = (cat: AmbientCategory) => {
    setEditingCatId(cat.id);
    setCatDraft({
      name: cat.name,
      parentId: cat.parentId ?? '',
      sortOrder: String(cat.sortOrder),
    });
    setCatError(null);
    setCatFormOpen(true);
  };

  const handleCategorySubmit = (e: FormEvent) => {
    e.preventDefault();
    const name = catDraft.name.trim();
    if (!name) {
      setCatError('El nombre es obligatorio');
      return;
    }
    if (editingCatId) {
      onUpdateCategory?.(editingCatId, {
        name,
        parentId: catDraft.parentId.trim(),
        sortOrder: String(catDraft.sortOrder),
      });
    } else {
      onCreateCategory?.({
        name,
        parentId: catDraft.parentId.trim(),
        sortOrder: String(catDraft.sortOrder),
      });
    }
    setCatFormOpen(false);
    setEditingCatId(null);
  };

  const deleteCatTarget = useMemo(
    () => (deleteCatId ? categories.find((c) => c.id === deleteCatId) ?? null : null),
    [deleteCatId, categories],
  );

  const confirmDeleteCategory = () => {
    if (deleteCatId) {
      onDeleteCategory?.(deleteCatId);
      if (categoryFilter === deleteCatId) {
        setCategoryFilter(null);
      }
    }
    setDeleteCatId(null);
  };

  // Flattened categories for parent picker in category modal (max 2 levels for parent so child is max L3)
  const categoryParentOptions = useMemo(() => {
    const opts: { id: string; name: string }[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      if (depth >= 2) return; // Cannot be parent if depth is already 2 (would create L4)
      for (const c of childrenOf(categories, parentId)) {
        if (c.id !== editingCatId) {
          const indent = depth > 0 ? `${'—'.repeat(depth)} ` : '';
          opts.push({ id: c.id, name: `${indent}${c.name}` });
          walk(c.id, depth + 1);
        }
      }
    };
    walk(undefined, 0);
    return opts;
  }, [categories, editingCatId]);

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
        key: 'surfaceType',
        header: 'Tipo',
        render: (r) => SURFACE_TYPE_LABEL[r.surfaceType],
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
      <div className="catalog-page__header">
        <div>
          <h2 className="catalog-page__title">Catálogo de Acabados</h2>
          <p className="page-header__subtitle">
            Acabados y texturas visuales para superficies, herrajes y objetos 3D (solo presentación, sin costo)
          </p>
        </div>
        <div className="catalog-page__toolbar">
          {canMutate && onCreateCategory ? (
            <button
              type="button"
              className="btn"
              onClick={() => setManageCategoriesOpen(true)}
              data-testid="manage-categories"
            >
              <Pencil size={16} strokeWidth={1.5} aria-hidden />
              Editar categorías
            </button>
          ) : null}
          {canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={startCreate}
              data-testid="ambient-material-create"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo acabado
            </button>
          ) : null}
        </div>
      </div>

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
            <div className="catalog-page__filters">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar acabados…"
                aria-label="Buscar acabados"
              />
              <StatusChips value={status} onChange={setStatus} />
            </div>
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
                      <span className="catalog-row-detail__label">
                        Tipo de superficie
                      </span>
                      <span className="catalog-row-detail__value">
                        {SURFACE_TYPE_LABEL[row.surfaceType]}
                      </span>
                    </div>
                    <div className="catalog-row-detail__field">
                      <span className="catalog-row-detail__label">Estado</span>
                      <span className="catalog-row-detail__value">
                        <ActiveBadge active={row.active} />
                      </span>
                    </div>
                    {canMutate ? (
                      <div className="catalog-row-detail__actions">
                        <button
                          type="button"
                          className="btn btn--small btn--primary"
                          onClick={() => startEdit(row)}
                        >
                          <Pencil size={14} strokeWidth={1.5} aria-hidden />
                          Editar
                        </button>
                        {row.active ? (
                          <button
                            type="button"
                            className="btn btn--small"
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
                    ) : null}
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

      {/* Material Modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar acabado' : 'Nuevo acabado'}
        size="sm"
        dataTestId="ambient-material-form-modal"
        footer={
          <>
            <button type="button" className="btn" onClick={closeModal}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={formId}
              data-testid="ambient-material-submit"
            >
              Guardar
            </button>
          </>
        }
      >
        <form id={formId} className="catalog-form" onSubmit={handleSubmit}>
          {error ? <p className="catalog-form__error">{error}</p> : null}

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">Identidad</legend>
            <div className="catalog-form__field">
              <label htmlFor="amb-code">Código</label>
              <input
                id="amb-code"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                autoComplete="off"
                required
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor="amb-name">Nombre</label>
              <input
                id="amb-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
              />
            </div>

            {/* 3-Level Category Cascade */}
            <div className="catalog-form__field">
              <label htmlFor="amb-category-l1">Categoría</label>
              <select
                id="amb-category-l1"
                value={draftCascade.level1Id ?? ''}
                onChange={(e) => setDraftCascadeLevel(1, e.target.value)}
                data-testid="ambient-material-category-l1"
              >
                <option value="">Sin categoría</option>
                {draftCascadeOpts.level1.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {draftCascade.level1Id && draftCascadeOpts.level2.length > 0 ? (
              <div className="catalog-form__field">
                <label htmlFor="amb-category-l2">Subcategoría 1 (opcional)</label>
                <select
                  id="amb-category-l2"
                  value={draftCascade.level2Id ?? ''}
                  onChange={(e) => setDraftCascadeLevel(2, e.target.value)}
                  data-testid="ambient-material-category-l2"
                >
                  <option value="">Ninguna</option>
                  {draftCascadeOpts.level2.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {draftCascade.level2Id && draftCascadeOpts.level3.length > 0 ? (
              <div className="catalog-form__field">
                <label htmlFor="amb-category-l3">Subcategoría 2 (opcional)</label>
                <select
                  id="amb-category-l3"
                  value={draftCascade.level3Id ?? ''}
                  onChange={(e) => setDraftCascadeLevel(3, e.target.value)}
                  data-testid="ambient-material-category-l3"
                >
                  <option value="">Ninguna</option>
                  {draftCascadeOpts.level3.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="catalog-form__field">
              <label htmlFor="amb-surface">Tipo de superficie</label>
              <select
                id="amb-surface"
                value={draft.surfaceType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    surfaceType: e.target.value as AmbientSurfaceType,
                  })
                }
              >
                <option value="floor">Suelo</option>
                <option value="wall">Pared</option>
                <option value="ceiling">Techo</option>
              </select>
            </div>
          </fieldset>

          <fieldset className="catalog-form__section">
            <legend className="catalog-form__section-title">
              Vista 3D y textura
            </legend>
            <div className="catalog-form__field">
              <label htmlFor="amb-color">Color de vista previa</label>
              <div className="material-preview-color-row">
                <input
                  id="amb-color-picker"
                  type="color"
                  className="material-preview-color-picker"
                  value={
                    /^#([0-9a-fA-F]{6})$/.test(draft.previewColor)
                      ? draft.previewColor
                      : '#D4C4A8'
                  }
                  onChange={(e) =>
                    setDraft({ ...draft, previewColor: e.target.value })
                  }
                  aria-label="Selector de color"
                  data-testid="ambient-material-color-picker"
                />
                <input
                  id="amb-color"
                  className="material-preview-color-hex"
                  value={draft.previewColor}
                  onChange={(e) =>
                    setDraft({ ...draft, previewColor: e.target.value })
                  }
                  placeholder="#F5F5F0"
                  autoComplete="off"
                />
              </div>
              <p className="catalog-form__hint">
                Color sólido para el 3D (#RRGGBB). Vacío = color genérico.
              </p>
            </div>
            <div
              className="catalog-form__field"
              data-testid="ambient-material-image-field"
            >
              <label htmlFor="amb-texture">Textura (foto)</label>
              <div className="catalog-form__image-row">
                {draft.previewTextureUrl ? (
                  <img
                    src={resolveImageUrl(draft.previewTextureUrl)}
                    alt={draft.name || 'Textura'}
                    className="catalog-image catalog-image--md"
                  />
                ) : (
                  <span className="catalog-form__hint">Sin textura</span>
                )}
                {canMutate && onUploadImage ? (
                  <input
                    id="amb-texture"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void (async () => {
                        try {
                          const url = await onUploadImage(file);
                          setDraft((prev) => ({
                            ...prev,
                            previewTextureUrl: url,
                          }));
                        } catch {
                          /* shell toasts */
                        }
                      })();
                      e.target.value = '';
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="catalog-form__field-row">
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-tex-tile-w">
                  Muestra textura X — ancho (mm)
                </label>
                <input
                  id="amb-tex-tile-w"
                  type="number"
                  min={0}
                  step="1"
                  value={draft.previewTextureTileWidthMm || ''}
                  placeholder="600"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      previewTextureTileWidthMm: Number(e.target.value) || 0,
                    })
                  }
                  data-testid="ambient-material-texture-tile-width"
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-tex-tile-l">
                  Muestra textura Y — alto (mm)
                </label>
                <input
                  id="amb-tex-tile-l"
                  type="number"
                  min={0}
                  step="1"
                  value={draft.previewTextureTileLengthMm || ''}
                  placeholder="600"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      previewTextureTileLengthMm: Number(e.target.value) || 0,
                    })
                  }
                  data-testid="ambient-material-texture-tile-length"
                />
              </div>
            </div>
            <div className="catalog-form__field-row">
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-pbr-roughness">Rugosidad (0..1)</label>
                <input
                  id="amb-pbr-roughness"
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  value={draft.previewRoughness ?? ''}
                  placeholder="0.6"
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? '' : Number(e.target.value);
                    setDraft({ ...draft, previewRoughness: val });
                  }}
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-pbr-clearcoat">Laca / Brillo (0..1)</label>
                <input
                  id="amb-pbr-clearcoat"
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  value={draft.previewClearcoat ?? ''}
                  placeholder="0"
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? '' : Number(e.target.value);
                    setDraft({ ...draft, previewClearcoat: val });
                  }}
                />
              </div>
              <div className="catalog-form__field catalog-form__field--grow">
                <label htmlFor="amb-pbr-metalness">Metálico (0..1)</label>
                <input
                  id="amb-pbr-metalness"
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  value={draft.previewMetalness ?? ''}
                  placeholder="0"
                  onChange={(e) => {
                    const val =
                      e.target.value === '' ? '' : Number(e.target.value);
                    setDraft({ ...draft, previewMetalness: val });
                  }}
                />
              </div>
            </div>
          </fieldset>
        </form>
      </Modal>

      {/* Category Management Modal */}
      <Modal
        open={manageCategoriesOpen}
        onClose={() => setManageCategoriesOpen(false)}
        title="Administrar categorías de acabados"
        size="md"
        dataTestId="ambient-category-manage-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--primary"
              onClick={openCreateCategory}
              data-testid="ambient-category-create-btn"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nueva categoría
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setManageCategoriesOpen(false)}
            >
              Cerrar
            </button>
          </>
        }
      >
        <div className="module-category-manage">
          {categories.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="Sin categorías"
              description="Creá categorías para organizar los acabados y materiales visuales."
              actionLabel="Crear primera categoría"
              onAction={openCreateCategory}
            />
          ) : (
            <ManageCategoryRows
              categories={categories}
              parentId={undefined}
              depth={0}
              onEdit={openEditCategory}
              onDelete={(id) => setDeleteCatId(id)}
              canDelete={Boolean(onDeleteCategory)}
            />
          )}
        </div>
      </Modal>

      {/* Create / Edit Category Modal */}
      <Modal
        open={catFormOpen}
        onClose={() => {
          setCatFormOpen(false);
          setEditingCatId(null);
        }}
        title={editingCatId ? 'Editar categoría' : 'Nueva categoría de acabados'}
        size="sm"
        dataTestId="ambient-category-form-modal"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCatFormOpen(false);
                setEditingCatId(null);
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={catFormId}
              data-testid="ambient-category-submit"
            >
              Guardar
            </button>
          </>
        }
      >
        <form id={catFormId} className="catalog-form" onSubmit={handleCategorySubmit}>
          {catError ? <p className="catalog-form__error">{catError}</p> : null}
          <div className="catalog-form__field">
            <label htmlFor="cat-name">Nombre</label>
            <input
              id="cat-name"
              value={catDraft.name}
              onChange={(e) =>
                setCatDraft({ ...catDraft, name: e.target.value })
              }
              placeholder="Ej. Maderas, Metales, Cerámicos…"
              autoComplete="off"
              required
              data-testid="ambient-category-name-input"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="cat-parent">Categoría padre (opcional)</label>
            <select
              id="cat-parent"
              value={catDraft.parentId}
              onChange={(e) =>
                setCatDraft({ ...catDraft, parentId: e.target.value })
              }
              data-testid="ambient-category-parent-select"
            >
              <option value="">Principal (Nivel 1)</option>
              {categoryParentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            <p className="catalog-form__hint">
              Máximo 3 niveles de profundidad (Categoría › Subcategoría 1 › Subcategoría 2).
            </p>
          </div>
        </form>
      </Modal>

      {/* Delete Category Confirmation Modal */}
      <Modal
        open={Boolean(deleteCatId)}
        onClose={() => setDeleteCatId(null)}
        title="Eliminar categoría"
        size="sm"
        dataTestId="ambient-category-delete-confirm-modal"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setDeleteCatId(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={confirmDeleteCategory}
              data-testid="ambient-category-confirm-delete"
            >
              Eliminar
            </button>
          </>
        }
      >
        <p>
          ¿Estás seguro de que deseás eliminar la categoría{' '}
          <strong>{deleteCatTarget?.name}</strong>? Los acabados asignados a
          esta categoría quedarán como «Sin categoría».
        </p>
      </Modal>
    </section>
  );
}
