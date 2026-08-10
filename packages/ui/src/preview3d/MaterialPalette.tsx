/**
 * MaterialPalette — paleta de ambient materials (piso/muro) arrastrable al 3D.
 * F067. Reemplaza los <select> nativos de Piso/Pared del ProjectSpatialStudio.
 *
 * Drag source HTML5: cada material es draggable, codifica su id + surfaceType
 * en dataTransfer (PAINT_DRAG_MIME). El canvas del FurnitureScene3D es el drop
 * target y resuelve la superficie golpeada por raycast.
 */

import type { ReactNode } from 'react';
import type { AmbientMaterial } from '@muebles/domain';
import {
  PAINT_DRAG_MIME,
  encodePaintDrag,
  type PaintDragPayload,
} from './paintMaterial';
import './materialPalette.css';

export type MaterialPaletteProps = {
  readonly materials: readonly AmbientMaterial[];
  readonly activeFloorId?: string;
  readonly activeWallId?: string;
  readonly testId?: string;
};

function MaterialSwatch({
  material,
}: {
  readonly material: AmbientMaterial;
}): ReactNode {
  if (material.previewTextureUrl) {
    return (
      <img
        className="material-palette__thumb-img"
        src={material.previewTextureUrl}
        alt=""
        draggable={false}
      />
    );
  }
  if (material.previewColor) {
    return (
      <svg
        className="material-palette__swatch"
        width={40}
        height={40}
        viewBox="0 0 40 40"
        aria-label={material.previewColor}
      >
        <rect x={0} y={0} width={40} height={40} rx={6} fill={material.previewColor} />
      </svg>
    );
  }
  return <span className="material-palette__no-preview">—</span>;
}

function MaterialChip({
  material,
  active,
  testId,
}: {
  readonly material: AmbientMaterial;
  readonly active: boolean;
  readonly testId: string;
}): ReactNode {
  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>): void => {
    const payload: PaintDragPayload = {
      materialId: material.id,
      surfaceType: material.surfaceType,
    };
    e.dataTransfer.setData(PAINT_DRAG_MIME, encodePaintDrag(payload));
    e.dataTransfer.setData('text/plain', material.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <button
      type="button"
      className={
        'material-palette__chip' + (active ? ' material-palette__chip--active' : '')
      }
      draggable
      onDragStart={handleDragStart}
      aria-pressed={active}
      aria-label={`${material.name} (${material.code}) — arrastrar para aplicar`}
      data-testid={testId}
    >
      <span className="material-palette__thumb">
        <MaterialSwatch material={material} />
      </span>
      <span className="material-palette__label">
        <span className="material-palette__name">{material.name}</span>
        {material.code ? (
          <span className="material-palette__code">{material.code}</span>
        ) : null}
      </span>
    </button>
  );
}

export function MaterialPalette({
  materials,
  activeFloorId,
  activeWallId,
  testId = 'material-palette',
}: MaterialPaletteProps): ReactNode {
  const floors = materials.filter(
    (m) => m.active && m.surfaceType === 'floor',
  );
  const walls = materials.filter((m) => m.active && m.surfaceType === 'wall');

  return (
    <div className="material-palette" data-testid={testId}>
      <p className="material-palette__hint">
        Arrastrá un material al piso o muro del 3D para aplicarlo.
      </p>

      <div className="material-palette__group">
        <h6 className="material-palette__group-title">Piso</h6>
        {floors.length === 0 ? (
          <p className="material-palette__empty">Sin materiales de piso.</p>
        ) : (
          <ul className="material-palette__list" role="list">
            {floors.map((m) => (
              <li key={m.id}>
                <MaterialChip
                  material={m}
                  active={m.id === activeFloorId}
                  testId={`${testId}-floor-${m.id}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="material-palette__group">
        <h6 className="material-palette__group-title">Muro</h6>
        {walls.length === 0 ? (
          <p className="material-palette__empty">Sin materiales de muro.</p>
        ) : (
          <ul className="material-palette__list" role="list">
            {walls.map((m) => (
              <li key={m.id}>
                <MaterialChip
                  material={m}
                  active={m.id === activeWallId}
                  testId={`${testId}-wall-${m.id}`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
