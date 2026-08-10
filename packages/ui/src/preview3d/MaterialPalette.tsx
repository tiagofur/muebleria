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
  readonly activeCeilingId?: string;
  readonly testId?: string;
  readonly onOpenCatalog?: () => void;
  readonly onSelectMaterial?: (material: AmbientMaterial) => void;
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
  onSelect,
}: {
  readonly material: AmbientMaterial;
  readonly active: boolean;
  readonly testId: string;
  readonly onSelect?: (material: AmbientMaterial) => void;
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
      onClick={() => onSelect?.(material)}
      aria-pressed={active}
      aria-label={`${material.name} (${material.code}) — hacer clic o arrastrar para aplicar`}
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
  activeCeilingId,
  testId = 'material-palette',
  onOpenCatalog,
  onSelectMaterial,
}: MaterialPaletteProps): ReactNode {
  const floors = materials.filter(
    (m) => m.active && m.surfaceType === 'floor',
  );
  const walls = materials.filter((m) => m.active && m.surfaceType === 'wall');
  const ceilings = materials.filter(
    (m) => m.active && m.surfaceType === 'ceiling',
  );

  return (
    <div className="material-palette" data-testid={testId}>
      <p className="material-palette__hint">
        Hacé clic o arrastrá un material al piso, muro o techo del 3D para aplicarlo.
      </p>

      {materials.length === 0 && onOpenCatalog ? (
        <div className="material-palette__empty-box">
          <p className="material-palette__empty">
            No hay materiales de ambiente configurados en el catálogo.
          </p>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onOpenCatalog}
            data-testid={`${testId}-open-catalog`}
          >
            Ir a Materiales de ambiente
          </button>
        </div>
      ) : null}

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
                  onSelect={onSelectMaterial}
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
                  onSelect={onSelectMaterial}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="material-palette__group">
        <h6 className="material-palette__group-title">Techo</h6>
        {ceilings.length === 0 ? (
          <p className="material-palette__empty">Sin materiales de techo.</p>
        ) : (
          <ul className="material-palette__list" role="list">
            {ceilings.map((m) => (
              <li key={m.id}>
                <MaterialChip
                  material={m}
                  active={m.id === activeCeilingId}
                  testId={`${testId}-ceiling-${m.id}`}
                  onSelect={onSelectMaterial}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
