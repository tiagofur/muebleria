/**
 * #1648 — compact delivery status chip (lists, boards, overview). Pure: the
 * status comes from `projectDeliveryInfo` in @granete/domain.
 */
import type { ReactNode } from 'react';
import { DELIVERY_STATUS_LABELS_ES, deliveryDaysLabelEs, type DeliveryInfo } from '@granete/domain';
import './delivery.css';

export interface DeliveryStatusChipProps {
  readonly info: DeliveryInfo;
  /** Show the days figure («Atrasado 3 días») instead of the plain label. */
  readonly withDays?: boolean;
  readonly testId?: string;
}

export function DeliveryStatusChip({ info, withDays = false, testId }: DeliveryStatusChipProps): ReactNode {
  const label = withDays ? deliveryDaysLabelEs(info) : DELIVERY_STATUS_LABELS_ES[info.status];
  return (
    <span
      className={`delivery-chip delivery-chip--${info.status}`}
      data-testid={testId ?? 'delivery-status-chip'}
      data-status={info.status}
    >
      {label}
    </span>
  );
}
