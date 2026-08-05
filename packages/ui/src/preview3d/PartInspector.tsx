/**
 * Read-only inspector for a selected ResolvedBoardPart in the 3D viewer.
 * Pure UI — no Three.js. Used by Furniture3DViewer (and tests).
 */

import type { ReactNode } from 'react';
import type { ResolvedBoardPart } from '@muebles/domain';
import { X } from 'lucide-react';

export type PartInspectorProps = {
  readonly part: ResolvedBoardPart | null;
  readonly onClear?: () => void;
  readonly isolateSelected?: boolean;
  readonly onIsolateChange?: (isolate: boolean) => void;
  readonly testId?: string;
};

function formatMm(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return `${Math.round(n)} mm`;
}

function formatDeg(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return `${n}°`;
}

export function PartInspector({
  part,
  onClear,
  isolateSelected = false,
  onIsolateChange,
  testId = 'part-inspector',
}: PartInspectorProps): ReactNode {
  if (!part) {
    return (
      <div className="part-inspector part-inspector--empty" data-testid={testId}>
        <p className="part-inspector__hint">
          Seleccioná una pieza en el 3D o en la lista para ver sus datos.
        </p>
      </div>
    );
  }

  return (
    <div className="part-inspector" data-testid={testId}>
      <div className="part-inspector__header">
        <div className="part-inspector__title-block">
          <h4 className="part-inspector__title" data-testid={`${testId}-title`}>
            {part.description || part.code || part.id}
          </h4>
          {part.code ? (
            <span className="part-inspector__code" data-testid={`${testId}-code`}>
              {part.code}
            </span>
          ) : null}
        </div>
        {onClear ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onClear}
            aria-label="Quitar selección"
            data-testid={`${testId}-clear`}
          >
            <X size={14} strokeWidth={1.5} aria-hidden />
          </button>
        ) : null}
      </div>

      <dl className="part-inspector__grid" data-testid={`${testId}-grid`}>
        <div>
          <dt>Rol</dt>
          <dd data-testid={`${testId}-role`}>{part.optionRole || '—'}</dd>
        </div>
        <div>
          <dt>Largo × Ancho × Espesor</dt>
          <dd data-testid={`${testId}-dims`}>
            {formatMm(part.lengthMm)} × {formatMm(part.widthMm)} ×{' '}
            {formatMm(part.thicknessMm)}
          </dd>
        </div>
        <div>
          <dt>Posición (X / Y / Z)</dt>
          <dd data-testid={`${testId}-pose`}>
            {formatMm(part.x)} / {formatMm(part.y)} / {formatMm(part.z)}
          </dd>
        </div>
        <div>
          <dt>Rotación (X / Y / Z)</dt>
          <dd data-testid={`${testId}-rotation`}>
            {formatDeg(part.rotateX)} / {formatDeg(part.rotateY)} /{' '}
            {formatDeg(part.rotateZ)}
          </dd>
        </div>
        <div>
          <dt>Cantidad</dt>
          <dd data-testid={`${testId}-qty`}>{part.quantity}</dd>
        </div>
        <div>
          <dt>Material</dt>
          <dd data-testid={`${testId}-material`} className="part-inspector__mono">
            {part.materialId || '—'}
          </dd>
        </div>
      </dl>

      {onIsolateChange ? (
        <label className="part-inspector__isolate" data-testid={`${testId}-isolate`}>
          <input
            type="checkbox"
            checked={isolateSelected}
            onChange={(e) => onIsolateChange(e.target.checked)}
            data-testid={`${testId}-isolate-checkbox`}
          />
          Aislar pieza (atenuar el resto)
        </label>
      ) : null}
    </div>
  );
}
