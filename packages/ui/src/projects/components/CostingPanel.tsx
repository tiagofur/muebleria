/**
 * CostingPanel — estimate vs actual view of one obra (OC-080..OC-084):
 * frozen baseline, actual material/labor/other costs, variance and gross
 * margins with traceable sources. The shell resolves the domain view
 * (`CostingPanelView`); this component only renders and dispatches actions.
 */

import { useState, type ReactNode } from 'react';
import { ClipboardCheck, DollarSign, ShieldAlert } from 'lucide-react';
import { OTHER_COST_KIND_LABELS_ES, TIME_ENTRY_CATEGORIES, TIME_ENTRY_CATEGORY_LABELS_ES } from '@muebles/domain';
import { MATERIAL_TRUTH_LABELS_ES, type CostingPanelView } from '../costingView';
import '../projects.css';
import './costing.css';

export type CostingHandlers = {
  readonly onCaptureBaseline?: (projectId: string) => void | Promise<void>;
  readonly onSetLaborRate?: (projectId: string, ratePerHour: number) => void | Promise<void>;
  readonly onRecordTime?: (
    projectId: string,
    payload: { category: string; minutes: number; note?: string },
  ) => void | Promise<void>;
  readonly onVoidTime?: (projectId: string, entryId: string) => void | Promise<void>;
  readonly onRecordOtherCost?: (
    projectId: string,
    payload: { kind: string; amount: number; vendor?: string; note?: string },
  ) => void | Promise<void>;
  readonly onVoidOtherCost?: (projectId: string, costId: string) => void | Promise<void>;
};

export type CostingPanelProps = {
  readonly view: CostingPanelView;
  readonly handlers: CostingHandlers;
  readonly labelsByMaterial?: Readonly<Record<string, string>>;
  /** May record labor time (RBAC cost_time_recorded). */
  readonly canManage?: boolean;
  /** May freeze/recapture the baseline and set the shop rate (gerencia). */
  readonly canCapture?: boolean;
  /** May record freight/outsource costs (RBAC cost_other_recorded). */
  readonly canRecordOther?: boolean;
  /** Supervisors only: void wrong entries (RBAC cost_entry_voided). */
  readonly canVoid?: boolean;
  readonly testId?: string;
};

function truthBadgeClass(truth: string): string {
  if (truth === 'actual') return 'status-badge status-badge--done';
  if (truth === 'proxy') return 'status-badge status-badge--progress';
  return 'status-badge status-badge--draft';
}

export function CostingPanel({
  view,
  handlers,
  labelsByMaterial = {},
  canManage = true,
  canCapture,
  canRecordOther,
  canVoid = false,
  testId,
}: CostingPanelProps): ReactNode {
  const captureAllowed = canCapture ?? canManage;
  const otherAllowed = canRecordOther ?? canManage;
  const [minutes, setMinutes] = useState('');
  const [category, setCategory] = useState<string>('cut');
  const [otherKind, setOtherKind] = useState<string>('freight');
  const [otherAmount, setOtherAmount] = useState('');
  const [otherVendor, setOtherVendor] = useState('');
  const [rate, setRate] = useState('');

  const minutesValue = Number(minutes);
  const amountValue = Number(otherAmount);
  const rateValue = Number(rate);

  const recordTime = (): void => {
    if (!handlers.onRecordTime || !Number.isFinite(minutesValue) || minutesValue <= 0) return;
    void handlers.onRecordTime(view.projectId, { category, minutes: minutesValue });
    setMinutes('');
  };

  const recordOther = (): void => {
    if (!handlers.onRecordOtherCost || !Number.isFinite(amountValue) || amountValue <= 0) return;
    void handlers.onRecordOtherCost(view.projectId, {
      kind: otherKind,
      amount: amountValue,
      vendor: otherVendor.trim() || undefined,
    });
    setOtherAmount('');
    setOtherVendor('');
  };

  const saveRate = (): void => {
    if (!handlers.onSetLaborRate || !Number.isFinite(rateValue) || rateValue <= 0) return;
    void handlers.onSetLaborRate(view.projectId, rateValue);
    setRate('');
  };

  if (!view.hasCosting) {
    return (
      <section className="costing-panel" data-testid={testId ?? `costing-panel-${view.projectId}`}>
        <h3 className="costing-panel__title">
          <DollarSign size={18} strokeWidth={1.5} aria-hidden />
          Costos de la obra
        </h3>
        <p className="costing-panel__hint">
          {view.canCaptureBaseline
            ? 'Congelá el baseline (snapshot de cotización + liberación) para comparar estimado vs real.'
            : `Para capturar el baseline falta: ${view.captureBlockers.join(' y ')}.`}
        </p>
        {captureAllowed && view.canCaptureBaseline && handlers.onCaptureBaseline ? (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => handlers.onCaptureBaseline?.(view.projectId)}
            data-testid={`costing-capture-${view.projectId}`}
          >
            <ClipboardCheck size={14} strokeWidth={1.5} aria-hidden />
            Capturar baseline
          </button>
        ) : null}
      </section>
    );
  }

  const summary = view.summary;
  return (
    <section className="costing-panel" data-testid={testId ?? `costing-panel-${view.projectId}`}>
      <div className="costing-panel__header">
        <h3 className="costing-panel__title">
          <DollarSign size={18} strokeWidth={1.5} aria-hidden />
          Costos de la obra
        </h3>
        <span className="status-badge status-badge--done">Baseline capturado</span>
      </div>

      <dl className="costing-panel__stats" aria-label="Estimado vs real">
        <div className="costing-panel__stat">
          <dt>Ingresos</dt>
          <dd>{summary.revenue}</dd>
        </div>
        <div className="costing-panel__stat">
          <dt>Costo directo estimado</dt>
          <dd>{summary.estimatedDirectCost}</dd>
        </div>
        <div className="costing-panel__stat">
          <dt>Costo directo real</dt>
          <dd>{summary.actualDirectCost}</dd>
        </div>
        <div className="costing-panel__stat">
          <dt>Variación</dt>
          <dd>
            {summary.variance === null ? (
              '—'
            ) : (
              <span
                className={
                  summary.varianceOverBudget ? 'costing-panel__over' : 'costing-panel__under'
                }
                data-testid={`costing-variance-${view.projectId}`}
              >
                {summary.varianceOverBudget ? '▲ ' : '▼ '}
                {summary.variance.replace('-', '')}
              </span>
            )}
          </dd>
        </div>
        <div className="costing-panel__stat">
          <dt>Margen bruto esperado</dt>
          <dd>
            {summary.expectedGrossMargin}
            <span className="costing-panel__percent"> {summary.expectedMarginPercent}</span>
          </dd>
        </div>
        <div className="costing-panel__stat">
          <dt>Margen bruto real</dt>
          <dd>
            {summary.actualGrossMargin}
            <span className="costing-panel__percent"> {summary.actualMarginPercent}</span>
          </dd>
        </div>
      </dl>

      {view.baseline ? (
        <p className="costing-panel__source" data-testid={`costing-baseline-source-${view.projectId}`}>
          Baseline del {new Date(view.baseline.capturedAt).toLocaleDateString('es-MX')} · liberación{' '}
          {view.baseline.releaseId} · material {view.baseline.breakdown[0]?.amount} + cantos{' '}
          {view.baseline.breakdown[1]?.amount} + herrajes {view.baseline.breakdown[2]?.amount} + MO{' '}
          {view.baseline.breakdown[3]?.amount} + {view.baseline.breakdown[4]?.amount}
        </p>
      ) : null}

      <div className="costing-panel__section">
        <h4 className="costing-panel__section-title">
          Material real
          <span className={truthBadgeClass(summary.materialTruth)}>
            {MATERIAL_TRUTH_LABELS_ES[summary.materialTruth]}
          </span>
        </h4>
        {view.materialLines.length > 0 ? (
          <table className="costing-panel__table" aria-label="Consumo de material valorizado">
            <thead>
              <tr>
                <th scope="col">Material</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Costo unit.</th>
                <th scope="col">Importe</th>
                <th scope="col">Base</th>
              </tr>
            </thead>
            <tbody>
              {view.materialLines.map((line) => (
                <tr key={line.materialId}>
                  <td>{labelsByMaterial[line.materialId] ?? line.materialId}</td>
                  <td>{line.quantity}</td>
                  <td>{line.unitCost}</td>
                  <td>{line.amount}</td>
                  <td>{line.basisLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="costing-panel__hint">
            Sin consumo de stock asignado a la obra todavía (se valoriza al despachar material).
          </p>
        )}
        {view.missingValuationMaterialIds.length > 0 ? (
          <p className="costing-panel__warning">
            <ShieldAlert size={14} strokeWidth={1.5} aria-hidden />
            Sin precio para valorizar: {view.missingValuationMaterialIds.join(', ')}
          </p>
        ) : null}
      </div>

      <div className="costing-panel__section">
        <h4 className="costing-panel__section-title">
          Mano de obra
          <span className="costing-panel__muted">{summary.actualLaborMinutes}</span>
        </h4>
        <p className="costing-panel__hint">
          Tarifa vigente: <strong>{view.laborRateLabel}</strong> por hora — cada registro congela la
          tarifa del momento.
        </p>
        {captureAllowed && handlers.onSetLaborRate ? (
          <div className="costing-panel__inline-form">
            <label className="costing-panel__field">
              <span>Nueva tarifa / h</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                data-testid={`costing-rate-input-${view.projectId}`}
                aria-label="Nueva tarifa por hora"
              />
            </label>
            <button
              type="button"
              className="btn btn--small"
              disabled={!Number.isFinite(rateValue) || rateValue <= 0}
              onClick={saveRate}
              data-testid={`costing-rate-save-${view.projectId}`}
            >
              Guardar tarifa
            </button>
          </div>
        ) : null}
        {canManage && handlers.onRecordTime ? (
          <div className="costing-panel__inline-form">
            <label className="costing-panel__field">
              <span>Categoría</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                data-testid={`costing-time-category-${view.projectId}`}
                aria-label="Categoría de tiempo"
              >
                {TIME_ENTRY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TIME_ENTRY_CATEGORY_LABELS_ES[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="costing-panel__field">
              <span>Minutos</span>
              <input
                type="number"
                min="0"
                step="1"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                data-testid={`costing-time-minutes-${view.projectId}`}
                aria-label="Minutos trabajados"
              />
            </label>
            <button
              type="button"
              className="btn btn--small"
              disabled={!Number.isFinite(minutesValue) || minutesValue <= 0}
              onClick={recordTime}
              data-testid={`costing-time-save-${view.projectId}`}
            >
              Registrar tiempo
            </button>
          </div>
        ) : null}
        {view.timeEntries.length > 0 ? (
          <ul className="costing-panel__entries" aria-label="Tiempo registrado">
            {view.timeEntries.map((entry) => (
              <li key={entry.id} className={entry.voided ? 'costing-panel__entry costing-panel__entry--voided' : 'costing-panel__entry'}>
                <span className="costing-panel__entry-main">
                  {entry.categoryLabel} · {entry.minutes}
                  {entry.cost !== '—' ? ` · ${entry.cost}` : ''}
                </span>
                <span className="costing-panel__entry-meta">
                  {entry.byName}
                  {entry.voided ? ' · anulado' : ''}
                </span>
                {!entry.voided && canVoid && handlers.onVoidTime ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => handlers.onVoidTime?.(view.projectId, entry.id)}
                    data-testid={`costing-time-void-${entry.id}`}
                  >
                    Anular
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="costing-panel__section">
        <h4 className="costing-panel__section-title">
          Otros costos
          <span className="costing-panel__muted">{summary.actualOtherCost}</span>
        </h4>
        {otherAllowed && handlers.onRecordOtherCost ? (
          <div className="costing-panel__inline-form">
            <label className="costing-panel__field">
              <span>Tipo</span>
              <select
                value={otherKind}
                onChange={(e) => setOtherKind(e.target.value)}
                data-testid={`costing-other-kind-${view.projectId}`}
                aria-label="Tipo de costo"
              >
                {Object.entries(OTHER_COST_KIND_LABELS_ES).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="costing-panel__field">
              <span>Monto</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={otherAmount}
                onChange={(e) => setOtherAmount(e.target.value)}
                data-testid={`costing-other-amount-${view.projectId}`}
                aria-label="Monto del costo"
              />
            </label>
            <label className="costing-panel__field">
              <span>Proveedor</span>
              <input
                type="text"
                value={otherVendor}
                onChange={(e) => setOtherVendor(e.target.value)}
                data-testid={`costing-other-vendor-${view.projectId}`}
                aria-label="Proveedor (opcional)"
              />
            </label>
            <button
              type="button"
              className="btn btn--small"
              disabled={!Number.isFinite(amountValue) || amountValue <= 0}
              onClick={recordOther}
              data-testid={`costing-other-save-${view.projectId}`}
            >
              Agregar costo
            </button>
          </div>
        ) : null}
        {view.otherCosts.length > 0 ? (
          <ul className="costing-panel__entries" aria-label="Costos externos registrados">
            {view.otherCosts.map((cost) => (
              <li key={cost.id} className={cost.voided ? 'costing-panel__entry costing-panel__entry--voided' : 'costing-panel__entry'}>
                <span className="costing-panel__entry-main">
                  {cost.kindLabel} · {cost.amount}
                  {cost.vendor ? ` · ${cost.vendor}` : ''}
                </span>
                <span className="costing-panel__entry-meta">{cost.voided ? 'anulado' : ''}</span>
                {!cost.voided && canVoid && handlers.onVoidOtherCost ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => handlers.onVoidOtherCost?.(view.projectId, cost.id)}
                    data-testid={`costing-other-void-${cost.id}`}
                  >
                    Anular
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
