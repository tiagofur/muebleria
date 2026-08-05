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
import { geometrySummary, placementLabel } from '../componentDraft';

export type ComponentListViewProps = {
  readonly rows: readonly Component[];
  readonly search: string;
  readonly setSearch: Dispatch<SetStateAction<string>>;
  readonly status: CatalogStatusFilter;
  readonly setStatus: Dispatch<SetStateAction<CatalogStatusFilter>>;
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
  canMutate,
  onCreate,
  onOpenDetail,
}: ComponentListViewProps): ReactNode {
  const isFilterEmpty =
    rows.length === 0 && (Boolean(search.trim()) || status !== 'active');

  return (
    <>
      <header className="catalog-page__header">
        <div>
          <h1 className="catalog-page__title">Componentes</h1>
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
          placeholder="Buscar por código o nombre…"
        />
        <StatusChips
          value={status}
          onChange={setStatus}
          data-testid="component-status-chips"
        />
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
              ? 'Probá cambiando el texto de búsqueda o el filtro de estado.'
              : 'Comenzá agregando componentes reutilizables para composición.'
          }
          actionLabel={
            canMutate && !isFilterEmpty ? 'Crear componente' : undefined
          }
          onAction={canMutate && !isFilterEmpty ? onCreate : undefined}
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
