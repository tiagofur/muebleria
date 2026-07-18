/**
 * Structures catalog list — search, status chips, expandable cards.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Structure } from '@muebles/domain';
import {
  Eye,
  EyeOff,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  EmptyState,
  SearchInput,
  StatusChips,
} from '../../common';
import { StructureRevisionBadge } from './StructureRevisionBadge';
import type { CatalogStatusFilter } from '../../catalogs';

export type StructureListViewProps = {
  readonly rows: readonly Structure[];
  readonly search: string;
  readonly setSearch: Dispatch<SetStateAction<string>>;
  readonly status: CatalogStatusFilter;
  readonly setStatus: Dispatch<SetStateAction<CatalogStatusFilter>>;
  readonly expandedId: string | null;
  readonly onToggleExpand: (id: string) => void;
  readonly canMutate: boolean;
  readonly onCreate: () => void;
  readonly onEdit: (item: Structure) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  readonly onRequestDelete: (id: string) => void;
};

export function StructureListView({
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
  onDeactivate,
  onReactivate,
  onRequestDelete,
}: StructureListViewProps): ReactNode {
  return (
    <>
      <header className="catalog-screen__header">
        <div>
          <h1 className="catalog-screen__title">Estructuras</h1>
          <p className="catalog-screen__subtitle">
            Cuerpos de ingeniería reutilizables para el taller
          </p>
        </div>
        {canMutate ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={onCreate}
            data-testid="create-structure-btn"
          >
            <Plus size={16} /> Nueva Estructura
          </button>
        ) : null}
      </header>

      <div className="catalog-screen__filters">
        <div className="catalog-screen__search-wrapper">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código o nombre…"
            data-testid="structure-search"
          />
        </div>
        <StatusChips
          value={status}
          onChange={setStatus}
          data-testid="structure-status-chips"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={search ? 'No se encontraron estructuras' : 'Sin estructuras'}
          description={
            search
              ? 'Probá cambiando el texto de búsqueda o el filtro de estado.'
              : 'Comenzá agregando una estructura de ingeniería reutilizable.'
          }
          actionLabel={canMutate && !search ? 'Crear estructura' : undefined}
          onAction={canMutate && !search ? onCreate : undefined}
          variant={search ? 'no-results' : 'empty'}
        />
      ) : (
        <div className="structure-cards-grid" data-testid="structure-list">
          {rows.map((item) => {
            const isExpanded = expandedId === item.id;
            const dims =
              item.externalDims &&
              (item.externalDims.width > 0 ||
                item.externalDims.height > 0 ||
                item.externalDims.depth > 0)
                ? `${item.externalDims.width} × ${item.externalDims.height} × ${item.externalDims.depth} mm`
                : '—';

            return (
              <div
                key={item.id}
                className={`structure-card ${!item.active ? 'structure-card--inactive' : ''} ${isExpanded ? 'structure-card--expanded' : ''}`}
                data-testid={`structure-card-${item.code}`}
              >
                <div
                  className="structure-card__summary"
                  onClick={() => onToggleExpand(item.id)}
                >
                  <div className="structure-card__meta">
                    <span className="structure-card__code font-mono">
                      {item.code}
                    </span>
                    <StructureRevisionBadge
                      structure={item}
                      testId={`structure-revision-${item.code}`}
                    />
                    {!item.active ? (
                      <span className="badge badge--inactive ml-2">
                        Inactivo
                      </span>
                    ) : null}
                  </div>
                  <h3 className="structure-card__name">{item.name}</h3>
                  <div className="structure-card__details-row">
                    <span>
                      Dimensiones: <strong>{dims}</strong>
                    </span>
                    <span>
                      Componentes:{' '}
                      <strong>{item.components?.length ?? 0}</strong>
                    </span>
                  </div>
                  {item.notes ? (
                    <p className="structure-card__notes-preview">{item.notes}</p>
                  ) : null}
                </div>

                {isExpanded ? (
                  <div className="structure-card__expanded-content">
                    {item.presets && item.presets.length > 0 ? (
                      <div className="mb-4" data-testid="expanded-presets">
                        <span className="text-small text-muted font-semibold block mb-1">
                          Medidas permitidas (Presets):
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          {item.presets.map((pr) => (
                            <span
                              key={pr.id}
                              className="badge badge--neutral text-small"
                              style={{
                                border: '1px solid var(--border-default)',
                                background: 'var(--surface-card)',
                              }}
                            >
                              {pr.name
                                ? `${pr.name} (${pr.width}x${pr.height}x${pr.depth})`
                                : `${pr.width} × ${pr.height} × ${pr.depth} mm`}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {canMutate ? (
                      <div className="structure-card__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => onEdit(item)}
                          data-testid={`edit-btn-${item.code}`}
                        >
                          <Pencil size={14} className="mr-1" /> Editar
                        </button>
                        {item.active ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => onDeactivate(item.id)}
                            data-testid={`deactivate-btn-${item.code}`}
                          >
                            <EyeOff size={14} className="mr-1" /> Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => onReactivate(item.id)}
                            data-testid={`reactivate-btn-${item.code}`}
                          >
                            <Eye size={14} className="mr-1" /> Activar
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--danger btn--small"
                          onClick={() => onRequestDelete(item.id)}
                          data-testid={`delete-btn-${item.code}`}
                        >
                          <Trash2 size={14} className="mr-1" /> Eliminar
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
