/**
 * Paint-mode control for 3D viewers: material finishes vs workshop role colors.
 * This does NOT choose catalog materials — only how existing parts are colored.
 */

import type { ReactNode } from 'react';
import type { BoardColorMode } from './boardPartVisual';

export type PaintModeFieldProps = {
  readonly id: string;
  readonly value: BoardColorMode;
  readonly onChange: (mode: BoardColorMode) => void;
  readonly testId?: string;
  /** Extra context (e.g. "Los acabados vienen de la cotización"). */
  readonly hint?: string;
};

export function PaintModeField({
  id,
  value,
  onChange,
  testId = 'paint-mode',
  hint,
}: PaintModeFieldProps): ReactNode {
  return (
    <div className="catalog-form__field" data-testid={`${testId}-field`}>
      <label htmlFor={id}>Cómo se pinta</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as BoardColorMode)}
        data-testid={`${testId}-select`}
      >
        <option value="material">Acabados del material</option>
        <option value="role">Solo roles de pieza (taller)</option>
      </select>
      <p className="catalog-form__hint" data-testid={`${testId}-hint`}>
        {hint ??
          (value === 'material'
            ? 'Muestra color, veta y textura del material de cada pieza. No elige el material: solo cómo se ve.'
            : 'Colorea por rol (INTERIOR, FRENTE…) con tintes fijos de taller. Útil para leer el despiece, no para ver el acabado real.')}
      </p>
    </div>
  );
}
