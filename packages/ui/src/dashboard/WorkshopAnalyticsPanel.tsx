/**
 * Workshop analytics section for the Dashboard (F090).
 * Props-driven: the shell computes `WorkshopAnalytics` via domain functions;
 * this component only renders (charts are CSS bars — no chart library).
 */

import type { ReactNode } from 'react';
import type {
  AnalyticsPeriodDays,
  CommercialFunnelMetrics,
  ProjectStatus,
  WorkshopAnalytics,
  WarrantyAnalyticsMetrics,
} from '@granete/domain';
import { ANALYTICS_PERIODS } from '@granete/domain';
import { WARRANTY_CATEGORY_METADATA } from '@granete/domain';
import { TrendingUp, ShieldAlert, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { formatMoneyDisplay } from '../common/formatMoneyDisplay';
import { projectStatusLabel } from '../projects/projectHelpers';

export type WorkshopAnalyticsPanelProps = {
  readonly analytics: WorkshopAnalytics;
  readonly period: AnalyticsPeriodDays;
  readonly onPeriodChange: (period: AnalyticsPeriodDays) => void;
  readonly loading?: boolean;
  /**
   * #1116: colapsada por defecto — el informe no puede robarle el foco de
   * «hoy» al inicio. El teaser del estado colapsado usa datos reales.
   */
  readonly defaultExpanded?: boolean;
};

const FUNNEL_ORDER: readonly ProjectStatus[] = [
  'draft',
  'quoted',
  'accepted',
  'produced',
];

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function days1(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} d`;
}

function StatCard({
  label,
  value,
  hint,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly testId: string;
}): ReactNode {
  return (
    <li className="stat-card analytics__card" data-testid={testId}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {hint ? <span className="analytics__hint">{hint}</span> : null}
    </li>
  );
}

function BarRow({
  label,
  value,
  max,
  valueLabel,
  testId,
}: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly valueLabel: string;
  readonly testId: string;
}): ReactNode {
  const width = max > 0 ? Math.min(Math.max(Math.round((value / max) * 100), 0), 100) : 0;
  return (
    <li className="analytics__bar-row" data-testid={testId}>
      <span className="analytics__bar-label">{label}</span>
      <span className="analytics__bar-track" aria-hidden>
        <span
          className="analytics__bar-fill"
          style={{ transform: `scaleX(${width / 100})` }}
        />
      </span>
      <span className="analytics__bar-value">{valueLabel}</span>
    </li>
  );
}

function FunnelBlock({
  funnel,
}: {
  readonly funnel: CommercialFunnelMetrics;
}): ReactNode {
  const maxCount = Math.max(...FUNNEL_ORDER.map((s) => funnel.counts[s]), 1);
  return (
    <div className="analytics__block" data-testid="analytics-funnel">
      <h4 className="analytics__block-title">
        <TrendingUp size={16} strokeWidth={1.5} aria-hidden /> Conversión
        comercial
      </h4>
      <ul className="analytics__stats" aria-label="Indicadores comerciales">
        {/* #1116: 4 KPIs — «Tiempo al cierre» vive como hint del rate y no
            como quinta card que rompe el chunking. */}
        <StatCard
          label="Cotizado → ganado"
          value={pct(funnel.quoteToWonRate)}
          hint={`De lo cotizado · cierre prom. ${days1(funnel.avgDaysToClose)}`}
          testId="analytics-quote-won-rate"
        />
        <StatCard
          label="Ticket promedio"
          value={formatMoneyDisplay(funnel.avgTicket ?? 0)}
          testId="analytics-avg-ticket"
        />
        <StatCard
          label="Pipeline abierto"
          value={`${funnel.openPipelineCount}`}
          hint={formatMoneyDisplay(funnel.openPipelineValue)}
          testId="analytics-open-pipeline"
        />
        <StatCard
          label="Estancadas"
          value={`${funnel.stalledCount}`}
          hint={
            funnel.stalledOldestDays !== null
              ? `Más vieja: ${Math.round(funnel.stalledOldestDays)} d`
              : 'Sin movimiento > 14 d'
          }
          testId="analytics-stalled"
        />
      </ul>
      <ul className="analytics__bars" aria-label="Embudo por estado">
        {FUNNEL_ORDER.map((status) => (
          <BarRow
            key={status}
            label={projectStatusLabel(status)}
            value={funnel.counts[status]}
            max={maxCount}
            valueLabel={`${funnel.counts[status]}`}
            testId={`analytics-funnel-${status}`}
          />
        ))}
      </ul>
    </div>
  );
}

function WarrantyBlock({
  warranties,
}: {
  readonly warranties: WarrantyAnalyticsMetrics;
}): ReactNode {
  const maxCategory = Math.max(...Object.values(warranties.byCategory), 1);
  const maxPiece = Math.max(
    ...warranties.topPieces.map((p) => p.occurrences),
    1,
  );
  return (
    <div className="analytics__block" data-testid="analytics-warranty">
      <h4 className="analytics__block-title">
        <ShieldAlert size={16} strokeWidth={1.5} aria-hidden /> Post-venta y
        garantías
      </h4>
      <ul className="analytics__stats" aria-label="Indicadores de garantía">
        <StatCard
          label="Reclamos"
          value={`${warranties.total}`}
          hint={`${warranties.open} abiertos · ${warranties.resolved} resueltos`}
          testId="analytics-warranty-total"
        />
        <StatCard
          label="Obras afectadas"
          value={`${warranties.projectsAffected}`}
          testId="analytics-warranty-projects"
        />
        <StatCard
          label="Refabricación"
          value={`${warranties.refabricatedBoardM2.toFixed(2)} m²`}
          hint={`${warranties.refabricatedPieceCount} piezas`}
          testId="analytics-warranty-board"
        />
        <StatCard
          label="Margen en riesgo"
          value={
            warranties.marginAtRisk === null
              ? '—'
              : formatMoneyDisplay(warranties.marginAtRisk)
          }
          hint="Venta − costo directo de obras con reclamo"
          testId="analytics-warranty-margin"
        />
      </ul>
      {warranties.topPieces.length > 0 ? (
        <>
          <p className="analytics__bars-title">Piezas con más incidencia</p>
          <ul className="analytics__bars" aria-label="Piezas con más incidencia">
            {warranties.topPieces.map((piece) => (
              <BarRow
                key={piece.label}
                label={piece.label}
                value={piece.occurrences}
                max={maxPiece}
                valueLabel={`${piece.occurrences}× · ${piece.quantity} pzas · ${piece.boardM2.toFixed(2)} m²`}
                testId={`analytics-piece-${piece.label}`}
              />
            ))}
          </ul>
        </>
      ) : null}
      <p className="analytics__bars-title">Reclamos por categoría</p>
      <ul className="analytics__bars" aria-label="Reclamos por categoría">
        {(Object.keys(WARRANTY_CATEGORY_METADATA) as readonly (keyof typeof WARRANTY_CATEGORY_METADATA)[])
          .filter((cat) => warranties.byCategory[cat] > 0)
          .map((cat) => (
            <BarRow
              key={cat}
              label={WARRANTY_CATEGORY_METADATA[cat].label}
              value={warranties.byCategory[cat]}
              max={maxCategory}
              valueLabel={`${warranties.byCategory[cat]}`}
              testId={`analytics-category-${cat}`}
            />
          ))}
      </ul>
    </div>
  );
}

export function WorkshopAnalyticsPanel({
  analytics,
  period,
  onPeriodChange,
  loading = false,
  defaultExpanded = false,
}: WorkshopAnalyticsPanelProps): ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasData =
    analytics.funnel.openPipelineCount +
      analytics.funnel.wonCount +
      analytics.warranties.total >
    0;
  return (
    <section
      className="analytics"
      aria-labelledby="analytics-title"
      data-testid="dashboard-analytics"
    >
      <header className="analytics__header">
        <div>
          <h3 className="analytics__title" id="analytics-title">
            Métricas del taller
          </h3>
          <p className="analytics__subtitle">
            Cómo se movió tu taller en el período elegido.
          </p>
        </div>
        {expanded ? (
          <div
            className="analytics__periods"
            role="group"
            aria-label="Período de análisis"
          >
            {ANALYTICS_PERIODS.map((p) => (
              <button
                key={String(p.value)}
                type="button"
                className={
                  period === p.value
                    ? 'analytics__period analytics__period--active'
                    : 'analytics__period'
                }
                aria-pressed={period === p.value}
                onClick={() => onPeriodChange(p.value)}
                data-testid={`analytics-period-${p.value}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="analytics__toggle"
          aria-expanded={expanded}
          aria-controls="analytics-content"
          onClick={() => setExpanded((prev) => !prev)}
          data-testid="analytics-toggle"
        >
          {expanded ? 'Ocultar métricas' : 'Ver métricas'}
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className={
              expanded
                ? 'analytics__toggle-chevron analytics__toggle-chevron--up'
                : 'analytics__toggle-chevron'
            }
          />
        </button>
      </header>
      {/* #1116 re-critique: sin actividad el teaser de ceros es ruido — oculto. */}
      {!expanded && hasData ? (
        <p className="analytics__teaser" data-testid="analytics-teaser">
          Pipeline abierto: {analytics.funnel.openPipelineCount} · Reclamos:{' '}
          {analytics.warranties.total}
        </p>
      ) : null}
      <div id="analytics-content" hidden={!expanded}>
        {loading ? (
          <p className="analytics__empty" data-testid="analytics-loading">
            Cargando métricas…
          </p>
        ) : hasData ? (
          <div className="analytics__grid">
            <FunnelBlock funnel={analytics.funnel} />
            <WarrantyBlock warranties={analytics.warranties} />
          </div>
        ) : (
          <p className="analytics__empty" data-testid="analytics-empty">
            Sin actividad en este período.
          </p>
        )}
      </div>
    </section>
  );
}
