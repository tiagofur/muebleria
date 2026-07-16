/**
 * Sales showcase of modules — photos without BOM/cost editing (F040).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { Module, ModuleCategory } from '@muebles/domain';
import { Package, Search } from 'lucide-react';
import { CatalogImage } from '../common/CatalogImage';
import { EmptyState, SearchInput, useDebouncedValue } from '../common';
import { matchesCodeOrName } from '../catalogs/catalogHelpers';
import './moduleShowcase.css';

export type ModuleShowcaseProps = {
  readonly modules: readonly Module[];
  readonly categories?: readonly ModuleCategory[];
  /** Resolve relative /api/media paths with auth if needed. */
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  readonly onSelect?: (moduleId: string) => void;
};

export function ModuleShowcase({
  modules,
  resolveImageUrl = (u) => u,
  onSelect,
}: ModuleShowcaseProps): ReactNode {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query);

  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return [...modules];
    return modules.filter(
      (m) =>
        matchesCodeOrName(m.code, m.name, q) ||
        m.name.toLowerCase().includes(q),
    );
  }, [modules, debounced]);

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
          description="Probá otro término de búsqueda."
          actionLabel="Limpiar búsqueda"
          onAction={() => setQuery('')}
        />
      ) : (
        <ul className="module-showcase__grid">
          {rows.map((m) => {
            const dims = m.externalDims;
            const dimLabel =
              dims && (dims.width || dims.height || dims.depth)
                ? `${dims.width || '—'} × ${dims.height || '—'} × ${dims.depth || '—'} mm`
                : 'Medidas a definir';
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className="module-showcase-card"
                  onClick={() => onSelect?.(m.id)}
                  data-testid={`showcase-card-${m.id}`}
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
                    <p className="module-showcase-card__dims">{dimLabel}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
