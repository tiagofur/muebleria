/**
 * Surface look for material paint mode: solid color, color+grain, or photo texture.
 */

import type { ReactNode } from 'react';
import type { MaterialSurfaceMode } from './boardPartVisual';

export type MaterialSurfaceModeFieldProps = {
  readonly id: string;
  readonly value: MaterialSurfaceMode;
  readonly onChange: (mode: MaterialSurfaceMode) => void;
  readonly testId?: string;
  /** When false (role paint mode), control is hidden. */
  readonly visible?: boolean;
};

const HINTS: Record<MaterialSurfaceMode, string> = {
  color: 'Solo el color de preview del material (sin veta ni foto).',
  grain:
    'Color; y marca de veta solo en materiales con “Veta por defecto”. Sin veta = solo color.',
  texture:
    'Foto del material (textura 3D o foto de catálogo). Si no hay foto: veta si aplica, si no color.',
};

export function MaterialSurfaceModeField({
  id,
  value,
  onChange,
  testId = 'material-surface-mode',
  visible = true,
}: MaterialSurfaceModeFieldProps): ReactNode {
  if (!visible) return null;

  return (
    <div className="catalog-form__field" data-testid={`${testId}-field`}>
      <label htmlFor={id}>Vista del acabado</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as MaterialSurfaceMode)}
        data-testid={`${testId}-select`}
      >
        <option value="color">Solo color</option>
        <option value="grain">Color + marca de veta</option>
        <option value="texture">Textura (foto)</option>
      </select>
      <p className="catalog-form__hint" data-testid={`${testId}-hint`}>
        {HINTS[value]}
      </p>
    </div>
  );
}
