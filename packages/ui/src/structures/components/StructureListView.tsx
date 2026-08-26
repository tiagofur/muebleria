/**
 * Structures catalog list — search, status chips, card-detalle (click → detail).
 * Fase 5 UI: no in-card expand; actions live on StructureDetailView.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Structure } from '@granete/domain';
import { LayoutGrid, Plus } from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  PageToolbar,
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
  readonly canMutate: boolean;
  readonly onCreate: () => void;
  readonly onOpenDetail: (item: Structure) => void;
};

export function StructureListView({
  rows,
  search,
  setSearch,
  status,
  setStatus,
  canMutate,
  onCreate,
  onOpenDetail,
}: StructureListViewProps): ReactNode {
  const isFilterEmpty = rows.length === 0 && (Boolean(search.trim()) || status !== 'active');

  return (
    <>
      <PageHeader
        title="Estructuras"
        subtitle="Cuerpos de ingeniería reutilizables para el taller"
        icon={<LayoutGrid size={16} strokeWidth={1.5} />}
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onCreate}
              data-testid="create-structure-btn"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden /> Nueva estructura
            </button>
          ) : undefined
        }
      />

      <PageToolbar
        ariaLabel="Buscar y filtrar estructuras"
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código o nombre…"
            data-testid="structure-search"
          />
        }
        filters={
          <StatusChips
            value={status}
            onChange={setStatus}
            data-testid="structure-status-chips"
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={
            isFilterEmpty ? 'No se encontraron estructuras' : 'Sin estructuras'
          }
          description={
            isFilterEmpty
              ? 'Probá cambiando el texto de búsqueda o el filtro de estado.'
              : 'Comenzá agregando una estructura de ingeniería reutilizable.'
          }
          actionLabel={
            canMutate && !isFilterEmpty ? 'Crear estructura' : undefined
          }
          onAction={canMutate && !isFilterEmpty ? onCreate : undefined}
          variant={isFilterEmpty ? 'no-results' : 'empty'}
        />
      ) : (
        <ul className="structure-cards-grid" data-testid="structure-list">
          {rows.map((item) => {
            const dims =
              item.externalDims &&
              (item.externalDims.width > 0 ||
                item.externalDims.height > 0 ||
                item.externalDims.depth > 0)
                ? `${item.externalDims.width} × ${item.externalDims.height} × ${item.externalDims.depth} mm`
                : '—';
            const presetCount = item.presets?.length ?? 0;
            const componentCount = item.components?.length ?? 0;

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`structure-card ${!item.active ? 'structure-card--inactive' : ''}`}
                  onClick={() => onOpenDetail(item)}
                  data-testid={`structure-card-${item.code}`}
                >
                  <div className="structure-card__meta">
                    <span className="structure-card__code">{item.code}</span>
                    <StructureRevisionBadge
                      structure={item}
                      testId={`structure-revision-${item.code}`}
                    />
                    {!item.active ? (
                      <span className="status-badge status-badge--inactive">
                        <span className="status-badge__dot" aria-hidden>
                          ●
                        </span>
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
                      Componentes: <strong>{componentCount}</strong>
                    </span>
                    {presetCount > 0 ? (
                      <span>
                        Presets: <strong>{presetCount}</strong>
                      </span>
                    ) : null}
                  </div>
                  {item.notes ? (
                    <p className="structure-card__notes-preview">{item.notes}</p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
