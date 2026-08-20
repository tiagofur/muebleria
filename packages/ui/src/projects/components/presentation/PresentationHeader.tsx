/**
 * Header banner for ProjectPresentationMode.
 */

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { formatMoneyDisplay } from '../../../common';

export interface PresentationHeaderProps {
  readonly workshopName?: string;
  readonly projectName: string;
  readonly customerName?: string;
  readonly salePrice: number | null;
  readonly currency: string;
  readonly onClose: () => void;
}

export function PresentationHeader({
  workshopName,
  projectName,
  customerName,
  salePrice,
  currency,
  onClose,
}: PresentationHeaderProps): ReactNode {
  return (
    <header className="project-presentation__header">
      <div>
        {workshopName ? (
          <p className="project-presentation__workshop-name">
            {workshopName}
          </p>
        ) : null}
        <p className="project-presentation__kicker">Cotización</p>
        <h1 className="project-presentation__title">{projectName}</h1>
        {customerName ? (
          <p className="project-presentation__customer">{customerName}</p>
        ) : null}
      </div>
      <div className="project-presentation__total-block">
        <span className="project-presentation__total-label">Total</span>
        <span
          className="project-presentation__total-value"
          data-testid="project-presentation-total"
        >
          {salePrice == null
            ? '—'
            : formatMoneyDisplay(salePrice, { currency })}
        </span>
      </div>
      <button
        type="button"
        className="btn btn--ghost project-presentation__close"
        onClick={onClose}
        data-testid="project-presentation-close"
        aria-label="Salir de presentación"
      >
        <X size={20} strokeWidth={1.5} aria-hidden />
        Salir
      </button>
    </header>
  );
}
