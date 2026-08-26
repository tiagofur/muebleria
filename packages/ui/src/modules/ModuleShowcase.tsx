/**
 * Sales showcase of modules — commercial photo catalog without BOM/cost (F040 / F043).
 * Browse by photo → confirm in detail → quote. Primary CTA only in detail.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  filterModulesByCategory,
  UNCATEGORIZED_FILTER,
  type CategoryFilterId,
  type Module,
  type ModuleCategory,
} from '@granete/domain';
import { Package, Search, ShoppingCart } from 'lucide-react';
import { CatalogImage } from '../common/CatalogImage';
import { EmptyState, Modal, PageHeader, PageToolbar, SearchInput, useDebouncedValue } from '../common';
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
    <section className="module-showcase" aria-label="Catálogo de módulos de la vitrina">
      {/* Tab content of ShowcaseScreen: page title lives at screen level (§4.1a). */}
      <PageToolbar
        ariaLabel="Buscar y filtrar catálogo de módulos"
        search={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar mueble…"
            aria-label="Buscar en vitrina"
          />
        }
        filters={showCategoryFilter ? (
          <div
            className="module-showcase__filters"
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
        ) : undefined}
      />

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
              <li key={m.id} className="module-showcase__grid-item">
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
                    <div className="module-showcase-card__media">
                      <CatalogImage
                        src={resolveImageUrl(m.imageUrl)}
                        alt={m.name}
                        size="lg"
                        className="module-showcase-card__img"
                      />
                    </div>
                    <div className="module-showcase-card__body">
                      <h3 className="module-showcase-card__name">{m.name}</h3>
                      <p className="module-showcase-card__dims">
                        {dimLabel(m)}
                      </p>
                      <div className="module-showcase-card__meta">
                        <span className="module-showcase-card__code">
                          {m.code}
                        </span>
                        {catName ? (
                          <span className="module-showcase-card__cat">
                            {catName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
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
        size="lg"
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
            <div className="module-showcase-detail__media">
              <CatalogImage
                src={resolveImageUrl(detail.imageUrl)}
                alt={detail.name}
                size="lg"
                className="module-showcase-detail__img"
              />
            </div>
            <div className="module-showcase-detail__content">
              <p className="module-showcase-detail__code">{detail.code}</p>
              <dl className="module-showcase-detail__meta">
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
                  Vista de solo lectura. El despiece y los costos los define
                  ingeniería al armar la cotización.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
