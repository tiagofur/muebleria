/**
 * Presentation gate for price preview — shows block message or children when choices are complete.
 * Does not compute prices (OPT-05).
 */

import type { ReactNode } from 'react';
import type { OptionChoices } from '@muebles/domain';
import { canShowPricePreview } from './optionGroupHelpers';
import './optionGroups.css';

export interface PricePreviewGateProps {
  readonly requiredGroupCodes: readonly string[];
  readonly optionChoices: OptionChoices;
  /** Resolved Spanish labels for missing group codes (optional). */
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly blockedMessage?: string;
  readonly children: ReactNode;
}

export function PricePreviewGate({
  requiredGroupCodes,
  optionChoices,
  groupLabels,
  blockedMessage = 'Preview de precio bloqueado: faltan opciones obligatorias.',
  children,
}: PricePreviewGateProps): ReactNode {
  const gate = canShowPricePreview(requiredGroupCodes, optionChoices);

  if (!gate.ok) {
    const labels = gate.missingGroups.map(
      (code) => groupLabels?.[code] ?? code,
    );
    return (
      <div
        className="price-preview-gate price-preview-gate--blocked"
        role="status"
        aria-live="polite"
      >
        <p className="price-preview-gate__message">{blockedMessage}</p>
        <ul className="price-preview-gate__missing">
          {labels.map((label, i) => (
            <li key={gate.missingGroups[i]}>{label}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="price-preview-gate price-preview-gate--ok">{children}</div>
  );
}
