/**
 * Sales showcase of modules — photos without BOM/cost editing (F040 / F043).
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  filterModulesByCategory,
  UNCATEGORIZED_FILTER,
  type CategoryFilterId,
  type Module,
  type ModuleCategory,
} from '@muebles/domain';
import { Package, Search, ShoppingCart } from 'lucide-react';
import { CatalogImage } from '../common/CatalogImage';
import { EmptyState, Modal, SearchInput, useDebouncedValue } from '../common';
import { matchesCodeOrName } from '../catalogs/catalogHelpers';
import './moduleShowcase.css';

export type ModuleShowcaseProps = {
  readonly modules: readonly Module[];
  readonly categories?: readonly ModuleCategory[];
  /** Resolve relative /api/media paths with auth if needed. */
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  /** Open read-only detail (defaults to internal modal when omitted). */
  readonly onSelect?: (moduleId: string) => void;
  /**
   * Sales CTA: start quoting with this module (shell navigates to cotizaciones).
   * When omitted, detail still shows without the CTA.
   */
  readonly onUseInQuote?: (moduleId: string) => void;
};

function dimLabel(m: Module): string {
  const dims = m.externalDims;
  if (dims && (dims.width || dims.height || dims.depth)) {
    return `${dims.width || '—'} × ${dims.height || '—'} × ${dims.depth || '—'} mm`;
  }
  return 'Medidas a definir';
}

function categoryLabel(
  module: Module,
  categories: readonly ModuleCategory[],
): string | null {
  if (!module.categoryId) return null;
  const cat = categories.find((c) => c.id === module.categoryId);
  return cat?.name ?? null;
}

export function ModuleShowcase({
  modules,
  categories = [],
  resolveImageUrl = (u) => u,
  onSelect,
  onUseInQuote,
}: ModuleShowcaseProps): ReactNode {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterId>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const showCategoryFilter = categories.length > 0;

  const categoryCounts = useMemo(() => {
    const byId = new Map<string, number>();
    for (const cat of categories) {
      byId.set(
        cat.id,
        filterModulesByCategory(modules, cat.id, categories).length,
      );
    }
    return {
      all: modules.length,
      uncategorized: filterModulesByCategory(
        modules,
        UNCATEGORIZED_FILTER,
        categories,
      ).length,
      byId,
    };
  }, [modules, categories]);

  const rows = useMemo(() => {
    const byCat = filterModulesByCategory(modules, categoryFilter, categories);
    const q = debounced.trim().toLowerCase();
    if (!q) return byCat;
    return byCat.filter((m) => matchesCodeOrName(m, q));
  }, [modules, categories, categoryFilter, debounced]);

  const detail = detailId
    ? (modules.find((m) => m.id === detailId) ?? null)
    : null;

  function openDetail(moduleId: string): void {
    setDetailId(moduleId);
    onSelect?.(moduleId);
  }

  function clearFilters(): void {
    setQuery('');
    setCategoryFilter(null);
  }

  return (
    <section className="module-showcase" aria-label="Vitrina de muebles">
      <header className="module-showcase__header">
        <div>
          <h2 className="module-showcase__title">Vitrina de muebles</h2>
          <p className="module-showcase__lead">
            Catálogo visual para cotizar. Las medidas son de referencia; el
            despiece lo arma ingeniería.
          </p>
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar mueble…"
          aria-label="Buscar en vitrina"
        />
      </header>

      {showCategoryFilter ? (
        <div
          className="module-showcase__filters"
          role="toolbar"
          aria-label="Filtrar por categoría"
          data-testid="showcase-category-filters"
        >
          <button
            type="button"
            className={
              categoryFilter === null
                ? 'module-showcase-chip module-showcase-chip--active'
                : 'module-showcase-chip'
            }
            onClick={() => setCategoryFilter(null)}
            data-testid="showcase-filter-all"
          >
            Todas
            <span className="module-showcase-chip__count">
              {categoryCounts.all}
            </span>
          </button>
          {categories
            .filter((c) => !c.parentId)
            .map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={
                  categoryFilter === cat.id
                    ? 'module-showcase-chip module-showcase-chip--active'
                    : 'module-showcase-chip'
                }
                onClick={() => setCategoryFilter(cat.id)}
                data-testid={`showcase-filter-${cat.id}`}
              >
                {cat.name}
                <span className="module-showcase-chip__count">
                  {categoryCounts.byId.get(cat.id) ?? 0}
                </span>
              </button>
            ))}
          {(categoryCounts.uncategorized > 0 ||
            categoryFilter === UNCATEGORIZED_FILTER) && (
            <button
              type="button"
              className={
                categoryFilter === UNCATEGORIZED_FILTER
                  ? 'module-showcase-chip module-showcase-chip--active'
                  : 'module-showcase-chip'
              }
              onClick={() => setCategoryFilter(UNCATEGORIZED_FILTER)}
              data-testid="showcase-filter-uncategorized"
            >
              Sin categoría
              <span className="module-showcase-chip__count">
                {categoryCounts.uncategorized}
              </span>
            </button>
          )}
        </div>
      ) : null}

      {modules.length === 0 ? (
        <EmptyState
          variant="empty"
          icon={Package}
          title="No hay muebles en el catálogo"
          description="Cuando ingeniería cargue plantillas con foto, van a verse acá."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="no-results"
          icon={Search}
          title="Sin resultados"
          description="Probá otro término o categoría."
          actionLabel="Limpiar filtros"
          onAction={clearFilters}
        />
      ) : (
        <ul className="module-showcase__grid">
          {rows.map((m) => {
            const catName = categoryLabel(m, categories);
            return (
              <li key={m.id}>
                <article
                  className="module-showcase-card"
                  data-testid={`showcase-card-${m.id}`}
                >
                  <button
                    type="button"
                    className="module-showcase-card__hit"
                    onClick={() => openDetail(m.id)}
                    data-testid={`showcase-card-open-${m.id}`}
                    aria-label={`Ver ${m.name}`}
                  >
                    <CatalogImage
                      src={resolveImageUrl(m.imageUrl)}
                      alt={m.name}
                      size="lg"
                      className="module-showcase-card__img"
                    />
                    <div className="module-showcase-card__body">
                      <p className="module-showcase-card__code">{m.code}</p>
                      <h3 className="module-showcase-card__name">{m.name}</h3>
                      <p className="module-showcase-card__dims">
                        {dimLabel(m)}
                      </p>
                      {catName ? (
                        <p className="module-showcase-card__cat">{catName}</p>
                      ) : null}
                    </div>
                  </button>
                  {onUseInQuote ? (
                    <div className="module-showcase-card__actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--small module-showcase-card__cta"
                        onClick={() => onUseInQuote(m.id)}
                        data-testid={`showcase-use-${m.id}`}
                      >
                        <ShoppingCart size={14} strokeWidth={1.5} aria-hidden />
                        Usar en cotización
                      </button>
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={detail !== null}
        onClose={() => setDetailId(null)}
        title={detail?.name ?? 'Mueble'}
        size="md"
        footer={
          detail ? (
            <div className="module-showcase-detail__footer">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setDetailId(null)}
              >
                Cerrar
              </button>
              {onUseInQuote ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    onUseInQuote(detail.id);
                    setDetailId(null);
                  }}
                  data-testid="showcase-detail-use"
                >
                  <ShoppingCart size={16} strokeWidth={1.5} aria-hidden />
                  Usar en cotización
                </button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {detail ? (
          <div
            className="module-showcase-detail"
            data-testid="showcase-detail"
          >
            <CatalogImage
              src={resolveImageUrl(detail.imageUrl)}
              alt={detail.name}
              size="lg"
              className="module-showcase-detail__img"
            />
            <dl className="module-showcase-detail__meta">
              <div>
                <dt>Código</dt>
                <dd>{detail.code}</dd>
              </div>
              <div>
                <dt>Medidas</dt>
                <dd>{dimLabel(detail)}</dd>
              </div>
              {categoryLabel(detail, categories) ? (
                <div>
                  <dt>Categoría</dt>
                  <dd>{categoryLabel(detail, categories)}</dd>
                </div>
              ) : null}
            </dl>
            {detail.notes ? (
              <p className="module-showcase-detail__notes">{detail.notes}</p>
            ) : (
              <p className="module-showcase-detail__notes module-showcase-detail__notes--muted">
                Vista de solo lectura. El despiece y costos los define
                ingeniería al armar la cotización.
              </p>
            )}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
