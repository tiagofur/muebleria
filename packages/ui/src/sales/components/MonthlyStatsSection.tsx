import type { ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
import { formatMoneyDisplay } from '../../common';
import type { MonthlyStats } from './salesDashboardHelpers';

export function MonthlyStatsSection({
  stats,
  title,
}: {
  readonly stats: MonthlyStats;
  readonly title: string;
}): ReactNode {
  return (
    <div className="sales-monthly">
      <h3 className="sales-section-title">
        <BarChart3 size={16} strokeWidth={1.5} />
        {title}
      </h3>

      <div className="sales-monthly__grid">
        {/* Mes actual */}
        <div className="sales-monthly__card">
          <h4 className="sales-monthly__card-title">Este mes</h4>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cotizaciones</span>
            <span className="sales-monthly__value">
              {stats.mesActual.cotizaciones.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.cotizaciones.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Abiertas</span>
            <span className="sales-monthly__value sales-monthly__value--open">
              {stats.mesActual.abiertas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.abiertas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cerradas</span>
            <span className="sales-monthly__value sales-monthly__value--closed">
              {stats.mesActual.cerradas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.cerradas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Canceladas</span>
            <span className="sales-monthly__value sales-monthly__value--cancelled">
              {stats.mesActual.canceladas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.canceladas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Instaladas</span>
            <span className="sales-monthly__value sales-monthly__value--installed">
              {stats.mesActual.instaladas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.mesActual.instaladas.totalValue)}
            </span>
          </div>
        </div>

        {/* Totales */}
        <div className="sales-monthly__card">
          <h4 className="sales-monthly__card-title">Totales</h4>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cotizaciones</span>
            <span className="sales-monthly__value">
              {stats.total.cotizaciones.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.cotizaciones.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Abiertas</span>
            <span className="sales-monthly__value sales-monthly__value--open">
              {stats.total.abiertas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.abiertas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Cerradas</span>
            <span className="sales-monthly__value sales-monthly__value--closed">
              {stats.total.cerradas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.cerradas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Canceladas</span>
            <span className="sales-monthly__value sales-monthly__value--cancelled">
              {stats.total.canceladas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.canceladas.totalValue)}
            </span>
          </div>
          <div className="sales-monthly__row">
            <span className="sales-monthly__label">Instaladas</span>
            <span className="sales-monthly__value sales-monthly__value--installed">
              {stats.total.instaladas.count}
            </span>
            <span className="sales-monthly__money">
              {formatMoneyDisplay(stats.total.instaladas.totalValue)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
