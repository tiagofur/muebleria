/**
 * Expanded row detail for a material — read-only fields. Actions live on the
 * row hover (unified in F117; the duplicated action block was removed).
 */

import type { ReactNode } from 'react';
import type { MaterialBoard } from '@muebles/domain';
import { CatalogImage, formatMoneyDisplay } from '../../common';
import { ActiveBadge } from '../CatalogTable';

export interface MaterialExpandedDetailProps {
  readonly row: MaterialBoard;
  readonly edgeNameById: ReadonlyMap<string, string>;
  readonly resolveImageUrl: (url: string | undefined) => string | undefined;
}

export function MaterialExpandedDetail({
  row,
  edgeNameById,
  resolveImageUrl,
}: MaterialExpandedDetailProps): ReactNode {
  return (
    <>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Foto</span>
        <CatalogImage
          src={resolveImageUrl(row.imageUrl)}
          alt={row.name}
          size="md"
        />
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Código</span>
        <span className="catalog-row-detail__value catalog-row-detail__value--mono">
          {row.code}
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Nombre</span>
        <span className="catalog-row-detail__value">{row.name}</span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Espesor</span>
        <span className="catalog-row-detail__value">
          {row.thicknessMm} mm
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Medidas (Largo × Ancho)</span>
        <span className="catalog-row-detail__value">
          {row.lengthMm} mm × {row.widthMm} mm
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Veta por defecto</span>
        <span className="catalog-row-detail__value">
          {row.grainDefault ? 'Sí' : 'No'}
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Cintilla default</span>
        <span className="catalog-row-detail__value">
          {row.defaultEdgeBandId
            ? (edgeNameById.get(row.defaultEdgeBandId) ??
              row.defaultEdgeBandId)
            : '—'}
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Precio Tablero</span>
        <span className="catalog-row-detail__value">
          {formatMoneyDisplay(row.boardPrice)}
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Merma</span>
        <span className="catalog-row-detail__value">
          {row.wastePercent}%
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Costo / m² (con merma)</span>
        <span className="catalog-row-detail__value">
          {formatMoneyDisplay(row.costPerM2)}
        </span>
      </div>
      <div className="catalog-row-detail__field">
        <span className="catalog-row-detail__label">Estado</span>
        <span className="catalog-row-detail__value">
          <ActiveBadge active={row.active} />
        </span>
      </div>
      {row.notes ? (
        <div className="catalog-row-detail__field">
          <span className="catalog-row-detail__label">Notas</span>
          <span className="catalog-row-detail__value">{row.notes}</span>
        </div>
      ) : null}
    </>
  );
}
