/**
 * Domain cost preview block — numbers come from shell props only.
 */

import type { ReactNode } from 'react';
import type { QuoteBreakdown } from '@muebles/domain';
import { formatModuleMoney } from '../moduleHelpers';

export type CostPreviewPanelProps = {
  readonly costPreview: QuoteBreakdown | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly allowEmptyHint?: boolean;
};

export function CostPreviewPanel({
  costPreview,
  previewBlocked,
  missingGroups,
  groupLabels,
  allowEmptyHint,
}: CostPreviewPanelProps): ReactNode {
  if (allowEmptyHint && !costPreview && !previewBlocked) {
    return (
      <p className="catalog-empty catalog-empty--flush">
        Guardá el mueble para ver el preview de costo con defaults de opción.
      </p>
    );
  }

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
          <p className="module-cost-preview__sale">
            Precio de venta: {formatModuleMoney(costPreview.salePrice)}
          </p>
        </>
      )}
    </div>
  );
}
