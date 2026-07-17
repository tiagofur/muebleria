/**
 * Components catalog list — search, chips, expandable cards.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Component } from '@muebles/domain';
import { Check, Eye, EyeOff, Pencil, Plus, Puzzle } from 'lucide-react';
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
  readonly expandedId: string | null;
  readonly onToggleExpand: (id: string) => void;
  readonly canMutate: boolean;
  readonly onCreate: () => void;
  readonly onEdit: (item: Component) => void;
  readonly onToggleActive: (item: Component) => void;
};

export function ComponentListView({
  rows,
  search,
  setSearch,
  status,
  setStatus,
  expandedId,
  onToggleExpand,
  canMutate,
  onCreate,
  onEdit,
  onToggleActive,
}: ComponentListViewProps): ReactNode {
  return (
    <>
      <header className="catalog-screen__header">
        <div>
          <h1 className="catalog-screen__title">Componentes</h1>
          <p className="catalog-screen__subtitle">
            Piezas reutilizables de ingeniería para composición de muebles
          </p>
        </div>
        {canMutate ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={onCreate}
            data-testid="create-component-btn"
          >
            <Plus size={16} /> Nuevo Componente
          </button>
        ) : null}
      </header>

      <div className="catalog-screen__filters">
        <div className="catalog-screen__search-wrapper">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código o nombre…"
          />
        </div>
        <StatusChips
          value={status}
          onChange={setStatus}
          data-testid="component-status-chips"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title={search ? 'No se encontraron componentes' : 'Sin componentes'}
          description={
            search
              ? 'Probá cambiando el texto de búsqueda o el filtro de estado.'
              : 'Comenzá agregando componentes reutilizables para composición.'
          }
          actionLabel={canMutate && !search ? 'Crear componente' : undefined}
          onAction={canMutate && !search ? onCreate : undefined}
          variant={search ? 'no-results' : 'empty'}
        />
      ) : (
        <div className="component-cards-grid" data-testid="component-list">
          {rows.map((item) => {
            const isExpanded = expandedId === item.id;

            return (
              <div
                key={item.id}
                className={`component-card ${!item.active ? 'component-card--inactive' : ''} ${isExpanded ? 'component-card--expanded' : ''}`}
                data-testid={`component-card-${item.code}`}
              >
                <div
                  className="component-card__summary"
                  onClick={() => onToggleExpand(item.id)}
                >
                  <div className="component-card__meta">
                    <span className="component-card__code font-mono">
                      {item.code}
                    </span>
                    {!item.active ? (
                      <span className="badge badge--inactive ml-2">
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
                      Roles: <strong>{item.optionRoles.join(', ')}</strong>
                    </span>
                  </div>
                  {item.notes ? (
                    <p className="component-card__notes-preview">{item.notes}</p>
                  ) : null}
                </div>

                {isExpanded ? (
                  <div className="component-card__expanded-content">
                    <h4 className="component-expanded-title">
                      Cantos por defecto
                    </h4>
                    <div className="component-edges-list">
                      {item.defaultEdges.map((edge) => (
                        <span
                          key={edge.side}
                          className={`component-edge-badge ${edge.enabled ? 'component-edge-badge--on' : 'component-edge-badge--off'}`}
                        >
                          {edge.enabled ? <Check size={12} /> : null}
                          {edge.side}
                        </span>
                      ))}
                    </div>

                    {canMutate ? (
                      <div className="component-card__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => onEdit(item)}
                          data-testid={`edit-btn-${item.code}`}
                        >
                          <Pencil size={14} className="mr-1" /> Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => onToggleActive(item)}
                          data-testid={`toggle-active-btn-${item.code}`}
                        >
                          {item.active ? (
                            <>
                              <EyeOff size={14} className="mr-1" /> Desactivar
                            </>
                          ) : (
                            <>
                              <Eye size={14} className="mr-1" /> Activar
                            </>
                          )}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
