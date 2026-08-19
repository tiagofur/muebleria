/**
 * Agregados catalog list — search, cards, click → detail.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { Agregado } from '@muebles/domain';
import { Blocks, Layers, Plus, Settings2 } from 'lucide-react';
import { EmptyState, PageHeader, PageToolbar, SearchInput } from '../../common';

export type AgregadoListViewProps = {
  readonly rows: readonly Agregado[];
  readonly search: string;
  readonly setSearch: Dispatch<SetStateAction<string>>;
  readonly canMutate: boolean;
  readonly onCreate: () => void;
  readonly onOpenDetail: (item: Agregado) => void;
};

export function AgregadoListView({
  rows,
  search,
  setSearch,
  canMutate,
  onCreate,
  onOpenDetail,
}: AgregadoListViewProps): ReactNode {
  const isFilterEmpty = rows.length === 0 && Boolean(search.trim());

  return (
    <>
      <PageHeader
        title="Agregados"
        subtitle="Sub-ensambles reutilizables: cajones, puertas con bisagras y jaladeras, divisiones."
        icon={<Blocks size={16} strokeWidth={1.5} />}
        primaryAction={
          canMutate ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onCreate}
              data-testid="create-agregado-btn"
            >
              <Plus size={16} strokeWidth={1.5} aria-hidden /> Nuevo agregado
            </button>
          ) : undefined
        }
      />

      <PageToolbar
        ariaLabel="Buscar y filtrar agregados"
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por código o nombre…"
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title={isFilterEmpty ? 'No se encontraron agregados' : 'Sin agregados'}
          description={
            isFilterEmpty
              ? 'Probá cambiando la búsqueda.'
              : 'Creá tu primer agregado: una puerta con bisagras y jaladera, un cajón maderero, etc.'
          }
          actionLabel={
            isFilterEmpty ? 'Limpiar búsqueda' : canMutate ? 'Crear agregado' : undefined
          }
          onAction={
            isFilterEmpty ? () => setSearch('') : canMutate ? onCreate : undefined
          }
          variant={isFilterEmpty ? 'no-results' : 'empty'}
        />
      ) : (
        <ul className="agregado-cards-grid" data-testid="agregado-list">
          {rows.map((item) => {
            const dims = item.externalDims ?? { width: 0, height: 0, depth: 0 };
            const piecesCount = (item.components ?? []).length;
            const placementsCount = (item.components ?? []).reduce(
              (acc, c) => acc + (c.overrides?.hardwarePlacements?.length ?? 0),
              0,
            );
            const hardwareCount = (item.hardwareLines ?? []).length + placementsCount;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="entity-card agregado-card"
                  onClick={() => onOpenDetail(item)}
                  data-testid={`agregado-card-${item.code}`}
                >
                  <div className="agregado-card__meta">
                    <span className="agregado-card__code">{item.code}</span>
                    {dims.width > 0 && (
                      <span className="agregado-card__dims">
                        {dims.width} × {dims.height} × {dims.depth} mm
                      </span>
                    )}
                  </div>
                  <h3 className="agregado-card__name">{item.name}</h3>
                  {item.description && (
                    <p className="agregado-card__desc">{item.description}</p>
                  )}
                  <div className="agregado-card__stats">
                    <span className="agregado-card__stat">
                      <Layers size={13} /> {piecesCount} pieza{piecesCount !== 1 ? 's' : ''}
                    </span>
                    <span className="agregado-card__stat">
                      <Settings2 size={13} /> {hardwareCount} herraje{hardwareCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
