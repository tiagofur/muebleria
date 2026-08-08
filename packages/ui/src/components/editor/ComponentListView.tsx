/**
 * Components catalog list — search, chips, card-detalle (click → detail).
 * Fase 5 UI: no in-card expand; actions live on ComponentDetailView.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Component } from '@muebles/domain';
import { Plus, Puzzle } from 'lucide-react';
import {
  EmptyState,
  SearchInput,
  StatusChips,
} from '../../common';
import type { CatalogStatusFilter } from '../../catalogs';
import {
  COMPONENT_PLACEMENTS,
  geometrySummary,
  placementLabel,
} from '../componentDraft';

export type ComponentListViewProps = {
  readonly rows: readonly Component[];
  readonly search: string;
  readonly setSearch: Dispatch<SetStateAction<string>>;
  readonly status: CatalogStatusFilter;
  readonly setStatus: Dispatch<SetStateAction<CatalogStatusFilter>>;
  readonly placementFilter: string;
  readonly setPlacementFilter: Dispatch<SetStateAction<string>>;
  readonly canMutate: boolean;
  readonly onCreate: () => void;
  readonly onOpenDetail: (item: Component) => void;
};

export function ComponentListView({
  rows,
  search,
  setSearch,
  status,
  setStatus,
  placementFilter,
  setPlacementFilter,
  canMutate,
  onCreate,
  onOpenDetail,
}: ComponentListViewProps): ReactNode {
  const isFilterEmpty =
    rows.length === 0 &&
    (Boolean(search.trim()) ||
      status !== 'active' ||
      placementFilter !== 'all');

  const clearFilters = () => {
    setSearch('');
    setStatus('active');
    setPlacementFilter('all');
  };

  return (
    <>
      <header className="catalog-page__header">
        <div>
          <h2 className="catalog-page__title">Componentes</h2>
          <p className="page-header__subtitle">
            Piezas reutilizables de ingeniería para composición de muebles
          </p>
        </div>
        {canMutate ? (
          <div className="catalog-page__toolbar">
            <button
              type="button"
              className="btn btn--primary"
              onClick={onCreate}
              data-testid="create-component-btn"
            >
              <Plus size={16} /> Nuevo componente
            </button>
          </div>
        ) : null}
      </header>

      <div className="catalog-page__filters">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por código, nombre o ubicación…"
        />
        <StatusChips
          value={status}
          onChange={setStatus}
          data-testid="component-status-chips"
        />
        <label className="component-list__placement-filter">
          <span className="component-list__placement-filter-label">
            Ubicación
          </span>
          <select
            value={placementFilter}
            onChange={(e) => setPlacementFilter(e.target.value)}
            aria-label="Filtrar por ubicación"
            data-testid="component-placement-filter"
          >
            <option value="all">Todas</option>
            {COMPONENT_PLACEMENTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title={
            isFilterEmpty
              ? 'No se encontraron componentes'
              : 'Sin componentes'
          }
          description={
            isFilterEmpty
              ? 'Probá cambiando la búsqueda, el estado o la ubicación.'
              : 'Comenzá agregando componentes reutilizables para composición.'
          }
          actionLabel={
            isFilterEmpty
              ? 'Limpiar filtros'
              : canMutate
                ? 'Crear componente'
                : undefined
          }
          onAction={
            isFilterEmpty
              ? clearFilters
              : canMutate
                ? onCreate
                : undefined
          }
          variant={isFilterEmpty ? 'no-results' : 'empty'}
        />
      ) : (
        <ul className="component-cards-grid" data-testid="component-list">
          {rows.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`component-card ${!item.active ? 'component-card--inactive' : ''}`}
                onClick={() => onOpenDetail(item)}
                data-testid={`component-card-${item.code}`}
              >
                <div className="component-card__meta">
                  <span className="component-card__code">{item.code}</span>
                  {!item.active ? (
                    <span className="catalog-badge catalog-badge--inactive">
                      Inactivo
                    </span>
                  ) : null}
                  <span className="component-card__placement-badge">
                    {placementLabel(item.placement)}
                  </span>
                </div>
                <h3 className="component-card__name">{item.name}</h3>
                <div className="component-card__details-row">
                  <span>
                    Geometría: <strong>{geometrySummary(item)}</strong>
                  </span>
                  <span>
                    Roles: <strong>{item.optionRoles.join(', ') || '—'}</strong>
                  </span>
                </div>
                {item.notes ? (
                  <p className="component-card__notes-preview">{item.notes}</p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
