/**
 * Module catalog list — category filter tree + cards.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Module, ModuleCategory } from '@muebles/domain';
import {
  UNCATEGORIZED_FILTER,
  childrenOf,
  type CategoryFilterId,
} from '@muebles/domain';
import { Layers, Package, Pencil, Plus, SearchX, Settings2 } from 'lucide-react';
import { EmptyState, SearchInput } from '../../common';
import { formatModuleMoney } from '../moduleHelpers';

export type ModuleCategoryFilterCounts = {
  readonly all: number;
  readonly uncategorized: number;
  readonly byCategoryId: ReadonlyMap<string, number>;
};

export type ModuleListViewProps = {
  readonly filtered: readonly Module[];
  readonly categories: readonly ModuleCategory[];
  readonly categoryFilter: CategoryFilterId;
  readonly setCategoryFilter: Dispatch<SetStateAction<CategoryFilterId>>;
  readonly categoryFilterCounts: ModuleCategoryFilterCounts;
  readonly search: string;
  readonly setSearch: Dispatch<SetStateAction<string>>;
  readonly isTrulyEmpty: boolean;
  readonly isFilterEmpty: boolean;
  readonly canMutate: boolean;
  readonly moduleEstimates: Readonly<Record<string, number | null>>;
  readonly onManageCategories: () => void;
  readonly onStartCreate: () => void;
  readonly onOpenDetail: (mod: Module) => void;
  readonly onCreateCategory?: unknown;
};

function estimateLabel(
  moduleEstimates: Readonly<Record<string, number | null>>,
  moduleId: string,
): ReactNode {
  if (!(moduleId in moduleEstimates)) {
    return (
      <span className="module-card__cost-value module-card__cost-value--muted">
        —
      </span>
    );
  }
  const value = moduleEstimates[moduleId];
  if (value == null) {
    return (
      <span className="module-card__cost-value module-card__cost-value--muted">
        Sin estimado
      </span>
    );
  }
  return (
    <span className="module-card__cost-value">{formatModuleMoney(value)}</span>
  );
}

function CategoryTree({
  categories,
  parentId,
  depth,
  categoryFilter,
  setCategoryFilter,
  counts,
}: {
  readonly categories: readonly ModuleCategory[];
  readonly parentId: string | undefined;
  readonly depth: number;
  readonly categoryFilter: CategoryFilterId;
  readonly setCategoryFilter: Dispatch<SetStateAction<CategoryFilterId>>;
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

export function ModuleListView({
  filtered,
  categories,
  categoryFilter,
  setCategoryFilter,
  categoryFilterCounts,
  search,
  setSearch,
  isTrulyEmpty,
  isFilterEmpty,
  canMutate,
  moduleEstimates,
  onManageCategories,
  onStartCreate,
  onOpenDetail,
  onCreateCategory,
}: ModuleListViewProps): ReactNode {
  return (
    <>
      <div className="catalog-page__header">
        <h2 className="catalog-page__title">Muebles</h2>
        <div className="catalog-page__toolbar">
          {canMutate && onCreateCategory ? (
            <button
              type="button"
              className="btn"
              onClick={onManageCategories}
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
              onClick={onStartCreate}
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden />
              Nuevo mueble
            </button>
          ) : null}
        </div>
      </div>

      <div className="module-list-layout">
        <aside
          className="module-category-tree"
          aria-label="Filtro por categorías"
          data-testid="category-filter-panel"
        >
          <div className="module-category-tree__header">
            <h3 className="module-category-tree__title">Filtrar</h3>
            {onCreateCategory ? (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={onManageCategories}
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
              Sin categorías. Usá «Editar categorías» para crear la jerarquía.
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

        <div className="module-list-main">
          {!isTrulyEmpty ? (
            <div className="catalog-page__filters">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Buscar muebles…"
                aria-label="Buscar muebles"
              />
            </div>
          ) : null}

          {isTrulyEmpty ? (
            <EmptyState
              icon={Package}
              title="No hay muebles"
              description="Creá el primer mueble del catálogo o cargá la semilla del workspace."
              actionLabel="Nuevo mueble"
              onAction={onStartCreate}
            />
          ) : isFilterEmpty ? (
            <EmptyState
              variant="no-results"
              icon={SearchX}
              title="Sin resultados"
              description="No hay muebles que coincidan con el filtro o la búsqueda."
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearch('');
                setCategoryFilter(null);
              }}
            />
          ) : (
            <ul className="module-card-grid" aria-label="Lista de muebles">
              {filtered.map((mod) => (
                <li key={mod.id}>
                  <button
                    type="button"
                    className="module-card"
                    onClick={() => onOpenDetail(mod)}
                    data-testid={`module-card-${mod.id}`}
                  >
                    <span className="module-card__code">{mod.code}</span>
                    <h3 className="module-card__name">{mod.name}</h3>
                    <div className="module-card__stats">
                      <span className="module-card__stat">
                        <Layers size={14} strokeWidth={1.5} aria-hidden />
                        {mod.components?.length ?? 0} componente
                        {(mod.components?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                      <span className="module-card__stat">
                        <Settings2 size={14} strokeWidth={1.5} aria-hidden />
                        {mod.hardwareLines.length} herraje
                        {mod.hardwareLines.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="module-card__cost">
                      <span className="module-card__cost-label">
                        Costo estimado
                      </span>
                      {estimateLabel(moduleEstimates, mod.id)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
