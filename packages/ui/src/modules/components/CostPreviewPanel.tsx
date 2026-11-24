/**
 * Domain cost preview block — numbers come from shell props only.
 */

import type { ReactNode } from 'react';
import type { QuoteBreakdown } from '@granete/domain';
import { formatModuleMoney } from '../moduleHelpers';

/**
 * What the module editor's cost preview carries (#1579): the breakdown plus
 * the engine's notices — today, a door taller than the hinge table's last
 * band. The persisted QuoteBreakdown never holds them: a notice is derived
 * on the fly and must stay out of frozen price snapshots.
 */
export type CostPreview = QuoteBreakdown & {
  readonly notices?: readonly string[];
};

export type CostPreviewPanelProps = {
  readonly costPreview: CostPreview | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly allowEmptyHint?: boolean;
  /** Domain resolution error behind a blocked preview (why it failed). */
  readonly previewError?: string | null;
};

export function CostPreviewPanel({
  costPreview,
  previewBlocked,
  missingGroups,
  groupLabels,
  allowEmptyHint,
  previewError,
}: CostPreviewPanelProps): ReactNode {
  if (allowEmptyHint && !costPreview && !previewBlocked) {
    return (
      <p className="catalog-empty catalog-empty--flush">
        Guardá el mueble para ver el preview de costo con defaults de opción.
      </p>
    );
  }

  const notices = costPreview?.notices ?? [];

  return (
    <div
      className={
        previewBlocked || !costPreview
          ? 'module-cost-preview module-cost-preview--blocked'
          : 'module-cost-preview'
      }
      role="status"
      aria-live="polite"
    >
      <h4 className="module-cost-preview__title">
        Preview de costo (con opciones por defecto)
      </h4>
      {previewBlocked || !costPreview ? (
        <>
          <p className="module-cost-preview__blocked-msg">
            Preview bloqueado: faltan grupos o no se pudo calcular.
          </p>
          {missingGroups.length > 0 ? (
            <ul className="module-cost-preview__missing">
              {missingGroups.map((code) => (
                <li key={code}>{groupLabels?.[code] ?? code}</li>
              ))}
            </ul>
          ) : null}
          {previewError ? (
            <p className="module-cost-preview__blocked-msg">
              {previewError}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <dl className="module-cost-preview__grid">
            <div>
              <dt>Materiales</dt>
              <dd>{formatModuleMoney(costPreview.materialsCost)}</dd>
            </div>
            <div>
              <dt>Cantos</dt>
              <dd>{formatModuleMoney(costPreview.edgeTotal)}</dd>
            </div>
            <div>
              <dt>Herrajes</dt>
              <dd>{formatModuleMoney(costPreview.hardwareTotal)}</dd>
            </div>
            <div>
              <dt>Costo directo</dt>
              <dd>{formatModuleMoney(costPreview.directCost)}</dd>
            </div>
          </dl>
          {/* #1579: avisos del motor junto al costo del mueble. No bloquean:
              dicen lo que el resolve decidió (p. ej. una puerta más alta que
              la última banda de la tabla de bisagras toma el máximo). */}
          {notices.length > 0 ? (
            <ul className="module-cost-preview__notices" data-testid="module-cost-preview-notices">
              {notices.map((notice) => (
                <li key={notice} className="module-cost-preview__notice">
                  {notice}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="module-cost-preview__sale">
            Precio de venta: {formatModuleMoney(costPreview.salePrice)}
          </p>
        </>
      )}
    </div>
  );
}
