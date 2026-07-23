/**
 * BoardPropertiesPanel — drawer derecho con propiedades de la pieza
 * seleccionada en el BoardCanvas (Fase 1 slice 1.2).
 *
 * Muestra: dimensiones (length, width, thickness), pose (x/y/z, rotateX/Y/Z),
 * material/role, y botones de acción (duplicate, delete).
 * Inputs editables que llaman a callbacks del editorStore.
 */

import { type ReactNode } from 'react';
import { Copy, Trash2, X } from 'lucide-react';
import type { BoardPartVisual } from '../preview3d/boardPartVisual';
import type { PartPose, PartDimensions } from './types';
import './boardPropertiesPanel.css';

export interface BoardPropertiesPanelProps {
  readonly part: BoardPartVisual | null;
  readonly onClose: () => void;
  readonly onUpdatePose: (pose: PartPose) => void;
  readonly onUpdateDimensions: (dims: PartDimensions) => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
}

function NumberField({
  label,
  value,
  onChange,
  unit = 'mm',
  step = 1,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (v: number) => void;
  readonly unit?: string;
  readonly step?: number;
}): ReactNode {
  return (
    <label className="board-props__field">
      <span className="board-props__label">{label}</span>
      <div className="board-props__input-row">
        <input
          type="number"
          className="board-props__input"
          value={Math.round(value)}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
        />
        <span className="board-props__unit">{unit}</span>
      </div>
    </label>
  );
}

export function BoardPropertiesPanel({
  part,
  onClose,
  onUpdatePose,
  onUpdateDimensions,
  onDuplicate,
  onRemove,
}: BoardPropertiesPanelProps): ReactNode {
  if (!part) return null;

  // BoardPartVisual.size = [width(X), thickness(Y), length(Z)]
  // BoardPartVisual.position = [x, z_workshop, y_workshop] (Three swap)
  const [width, thickness, length] = part.size;
  const [posX, posZ, posY] = part.position;

  // Rotation is in radians from the visual — convert to degrees for display.
  const rotXDeg = Math.round((part.rotation[0] * 180) / Math.PI);
  const rotYDeg = Math.round((part.rotation[1] * 180) / Math.PI);
  const rotZDeg = Math.round((part.rotation[2] * 180) / Math.PI);

  return (
    <aside
      className="board-props"
      data-testid="board-properties-panel"
      aria-label="Propiedades de la pieza"
    >
      <header className="board-props__header">
        <h3 className="board-props__title">{part.description}</h3>
        <button
          type="button"
          className="btn btn--icon board-props__close"
          aria-label="Cerrar panel"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </header>

      <div className="board-props__meta">
        <span className="board-props__badge">{part.optionRole}</span>
        <span
          className="board-props__color-swatch"
          style={{ background: part.color }}
          aria-label={`Color: ${part.color}`}
        />
      </div>

      <section className="board-props__section">
        <h4 className="board-props__section-title">Dimensiones</h4>
        <div className="board-props__grid-2">
          <NumberField
            label="Largo"
            value={length}
            onChange={(v) => onUpdateDimensions({ lengthMm: v })}
          />
          <NumberField
            label="Ancho"
            value={width}
            onChange={(v) => onUpdateDimensions({ widthMm: v })}
          />
        </div>
        <NumberField
          label="Espesor"
          value={thickness}
          step={0.5}
          onChange={(v) => onUpdateDimensions({ thicknessMm: v })}
        />
      </section>

      <section className="board-props__section">
        <h4 className="board-props__section-title">Posición (mm)</h4>
        <div className="board-props__grid-3">
          <NumberField label="X" value={posX} onChange={(v) => onUpdatePose({ x: v })} />
          <NumberField label="Y" value={posY} onChange={(v) => onUpdatePose({ y: v })} />
          <NumberField label="Z" value={posZ} onChange={(v) => onUpdatePose({ z: v })} />
        </div>
      </section>

      <section className="board-props__section">
        <h4 className="board-props__section-title">Rotación (°)</h4>
        <div className="board-props__grid-3">
          <NumberField
            label="Rot X"
            value={rotXDeg}
            unit="°"
            onChange={(v) => onUpdatePose({ rotateX: v })}
          />
          <NumberField
            label="Rot Y"
            value={rotYDeg}
            unit="°"
            onChange={(v) => onUpdatePose({ rotateY: v })}
          />
          <NumberField
            label="Rot Z"
            value={rotZDeg}
            unit="°"
            onChange={(v) => onUpdatePose({ rotateZ: v })}
          />
        </div>
      </section>

      <footer className="board-props__actions">
        <button
          type="button"
          className="btn btn--small"
          onClick={onDuplicate}
          data-testid="board-props-duplicate"
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden />
          Duplicar
        </button>
        <button
          type="button"
          className="btn btn--small btn--danger"
          onClick={onRemove}
          data-testid="board-props-delete"
        >
          <Trash2 size={14} strokeWidth={1.5} aria-hidden />
          Eliminar
        </button>
      </footer>
    </aside>
  );
}
