/**
 * Sticky 3D scene preview + reference container inputs for Component Editor.
 */

import { useState, type ReactNode } from 'react';
import type { PlacementDims, ResolvedBoardPart } from '@muebles/domain';
import type {
  MaterialColorLookup,
  MaterialTextureLookup,
} from '../../preview3d';
import { FurnitureScene3D } from '../../preview3d';

export interface ComponentGeometry3DViewportProps {
  readonly previewParts: readonly ResolvedBoardPart[];
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly containerDims: PlacementDims;
  readonly onContainerDimsChange: (dims: PlacementDims) => void;
  readonly showInContext: boolean;
  readonly onShowInContextChange: (v: boolean) => void;
  readonly hidden: boolean;
}

export function ComponentGeometry3DViewport({
  previewParts,
  materialColors,
  materialTextures,
  containerDims,
  onContainerDimsChange,
  showInContext,
  onShowInContextChange,
  hidden,
}: ComponentGeometry3DViewportProps): ReactNode {
  const [showOutlines, setShowOutlines] = useState(true);

  return (
    <div
      className="component-geometry__viewport"
      data-testid="component-geometry-viewport"
    >
      <div className="component-geometry__preview-bar">
        <div className="component-geometry__container-fields">
          <span className="component-geometry__container-label">
            Mueble de referencia:
          </span>
          <label className="component-geometry__container-field">
            <span>Ancho</span>
            <input
              type="number"
              min={1}
              value={Math.round(containerDims.PW)}
              onChange={(e) =>
                onContainerDimsChange({
                  ...containerDims,
                  PW: Math.max(1, Number(e.target.value)),
                })
              }
              data-testid="container-pw"
            />
          </label>
          <label className="component-geometry__container-field">
            <span>Alto</span>
            <input
              type="number"
              min={1}
              value={Math.round(containerDims.PH)}
              onChange={(e) =>
                onContainerDimsChange({
                  ...containerDims,
                  PH: Math.max(1, Number(e.target.value)),
                })
              }
              data-testid="container-ph"
            />
          </label>
          <label className="component-geometry__container-field">
            <span>Prof.</span>
            <input
              type="number"
              min={1}
              value={Math.round(containerDims.PD)}
              onChange={(e) =>
                onContainerDimsChange({
                  ...containerDims,
                  PD: Math.max(1, Number(e.target.value)),
                })
              }
              data-testid="container-pd"
            />
          </label>
        </div>
        <label className="component-geometry__toggle">
          <input
            type="checkbox"
            checked={showInContext}
            onChange={(e) => onShowInContextChange(e.target.checked)}
            data-testid="show-in-context-toggle"
          />
          <span>Mostrar en el mueble</span>
        </label>
        <label className="component-geometry__toggle">
          <input
            type="checkbox"
            checked={showOutlines}
            onChange={(e) => setShowOutlines(e.target.checked)}
            data-testid="component-geometry-outlines-toggle"
          />
          <span>Contornos</span>
        </label>
      </div>
      <p className="component-geometry__viewport-hint">
        Referencia solo para el preview (no se guarda en el componente).
      </p>
      {!hidden ? (
        <FurnitureScene3D
          modules={[
            {
              key: 'component-preview',
              parts: previewParts,
              width: containerDims.PW,
              height: containerDims.PH,
              depth: containerDims.PD,
              originX: 0,
              originY: 0,
              originZ: 0,
              showOuterGhost: showInContext,
            },
          ]}
          totalWidth={containerDims.PW}
          totalHeight={containerDims.PH}
          totalDepth={containerDims.PD}
          showFloor={false}
          colorMode="material"
          materialColors={materialColors}
          materialTextures={materialTextures}
          showOutlines={showOutlines}
          testId="component-geometry-3d"
        />
      ) : null}
    </div>
  );
}
