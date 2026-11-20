/**
 * #1648 — «Entregas en riesgo» filter toggle (late or due this week). Shared by
 * Cotizaciones, Producción and Estado de Planta so the three views filter the
 * same way. Presentation only: the count and the predicate come from
 * `projectDeliveryInfo` / `isDeliveryAttention` in @granete/domain.
 */
import type { ReactNode } from 'react';
import './delivery.css';

export interface DeliveryRiskToggleProps {
  readonly pressed: boolean;
  readonly count: number;
  readonly onChange: (next: boolean) => void;
  readonly testId?: string;
}

export function DeliveryRiskToggle({ pressed, count, onChange, testId }: DeliveryRiskToggleProps): ReactNode {
  return (
    <button
      type="button"
      className="btn btn--ghost btn--small delivery-risk-toggle"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      data-testid={testId ?? 'delivery-risk-toggle'}
      title="Atrasadas o que vencen esta semana"
    >
      Entregas en riesgo ({count})
    </button>
  );
}
