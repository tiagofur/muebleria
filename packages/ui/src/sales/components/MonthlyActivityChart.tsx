import type { ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
import type { MonthlyActivity } from './salesDashboardHelpers';

export function MonthlyActivityChart({
  data,
}: {
  readonly data: readonly MonthlyActivity[];
}): ReactNode {
  const total = data.reduce((acc, d) => acc + d.created + d.won, 0);
  if (total === 0) return null;
  const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.won)));
  const description = data
    .map((d) => `${d.label}: ${d.created} creadas, ${d.won} ganadas`)
    .join('; ');
  return (
    <div className="sales-monthly-chart" data-testid="sales-monthly-chart">
      <h3 className="sales-section-title">
        <BarChart3 size={16} strokeWidth={1.5} />
        Actividad por mes
      </h3>
      <div
        className="sales-monthly-chart__chart"
        role="img"
        aria-label={`Proyectos creados y ganados por mes. ${description}.`}
      >
        {data.map((d) => (
          <div
            key={d.key}
            className="sales-monthly-chart__month"
            data-testid={`sales-month-${d.key}`}
          >
            <div className="sales-monthly-chart__bars">
              <span className="sales-monthly-chart__bar-col">
                <span className="sales-monthly-chart__value">
                  {d.created > 0 ? d.created : ''}
                </span>
                <span
                  className="sales-monthly-chart__bar sales-monthly-chart__bar--created"
                  style={{ height: `${Math.round((d.created / max) * 100)}%` }}
                />
              </span>
              <span className="sales-monthly-chart__bar-col">
                <span className="sales-monthly-chart__value">
                  {d.won > 0 ? d.won : ''}
                </span>
                <span
                  className="sales-monthly-chart__bar sales-monthly-chart__bar--won"
                  style={{ height: `${Math.round((d.won / max) * 100)}%` }}
                />
              </span>
            </div>
            <span className="sales-monthly-chart__label">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="sales-monthly-chart__legend" aria-hidden>
        <span className="sales-monthly-chart__legend-item">
          <span className="sales-monthly-chart__dot sales-monthly-chart__dot--created" />
          Creadas
        </span>
        <span className="sales-monthly-chart__legend-item">
          <span className="sales-monthly-chart__dot sales-monthly-chart__dot--won" />
          Ganadas
        </span>
      </div>
    </div>
  );
}
