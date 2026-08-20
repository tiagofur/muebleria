import type { ReactNode } from 'react';
import type { Users } from 'lucide-react';
import { formatMoneyDisplay } from '../../common';
import type { ClientRanking } from './salesDashboardHelpers';

export function ClientRankingTable({
  title,
  icon: Icon,
  clients,
  valueField,
}: {
  readonly title: string;
  readonly icon: typeof Users;
  readonly clients: readonly ClientRanking[];
  readonly valueField: 'totalValue' | 'projectCount' | 'openCount' | 'cancelledCount';
}): ReactNode {
  if (clients.length === 0) return null;

  const sorted = [...clients].sort((a, b) => b[valueField] - a[valueField]);
  const top = sorted.slice(0, 5);

  const formatValue = (c: ClientRanking): string => {
    switch (valueField) {
      case 'totalValue':
        return formatMoneyDisplay(c.totalValue);
      case 'projectCount':
        return `${c.projectCount}`;
      case 'openCount':
        return `${c.openCount}`;
      case 'cancelledCount':
        return `${c.cancelledCount}`;
    }
  };

  return (
    <div className="sales-ranking">
      <h3 className="sales-section-title">
        <Icon size={16} strokeWidth={1.5} />
        {title}
      </h3>
      <ul className="sales-ranking__list">
        {top.map((c, i) => (
          <li key={c.customerId} className="sales-ranking__item">
            <span className="sales-ranking__rank">{i + 1}</span>
            <div className="sales-ranking__info">
              <span className="sales-ranking__name">{c.customerLabel}</span>
              <span className="sales-ranking__detail">
                {c.projectCount} proyectos · {c.openCount} abiertos · {c.closedCount} cerrados
              </span>
            </div>
            <span className="sales-ranking__value">{formatValue(c)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
