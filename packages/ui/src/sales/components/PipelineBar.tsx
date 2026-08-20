import type { ReactNode } from 'react';
import type { StatusStats } from './salesDashboardHelpers';

export function PipelineBar({
  abiertas,
  cerradas,
  canceladas,
}: {
  readonly abiertas: StatusStats;
  readonly cerradas: StatusStats;
  readonly canceladas: StatusStats;
}): ReactNode {
  const total = abiertas.count + cerradas.count + canceladas.count;
  if (total === 0) return null;

  return (
    <div className="sales-pipeline" aria-label="Pipeline de ventas">
      <div className="sales-pipeline__bar">
        {abiertas.count > 0 && (
          <div
            className="sales-pipeline__seg sales-pipeline__seg--abiertas"
            style={{ width: `${(abiertas.count / total) * 100}%` }}
            title={`Abiertas: ${abiertas.count}`}
          />
        )}
        {cerradas.count > 0 && (
          <div
            className="sales-pipeline__seg sales-pipeline__seg--cerradas"
            style={{ width: `${(cerradas.count / total) * 100}%` }}
            title={`Cerradas: ${cerradas.count}`}
          />
        )}
        {canceladas.count > 0 && (
          <div
            className="sales-pipeline__seg sales-pipeline__seg--canceladas"
            style={{ width: `${(canceladas.count / total) * 100}%` }}
            title={`Canceladas: ${canceladas.count}`}
          />
        )}
      </div>
      <div className="sales-pipeline__legend">
        <span className="sales-pipeline__legend-item">
          <span className="sales-pipeline__dot sales-pipeline__dot--abiertas" />
          Abiertas ({abiertas.count})
        </span>
        <span className="sales-pipeline__legend-item">
          <span className="sales-pipeline__dot sales-pipeline__dot--cerradas" />
          Cerradas ({cerradas.count})
        </span>
        <span className="sales-pipeline__legend-item">
          <span className="sales-pipeline__dot sales-pipeline__dot--canceladas" />
          Canceladas ({canceladas.count})
        </span>
      </div>
    </div>
  );
}
