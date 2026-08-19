/** Production board by project for the four manufacturing stations. */

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Factory, Play } from 'lucide-react';

import {
  ITEM_FLOOR_STATUS_LABELS_ES,
  PICKING_STATUS_LABELS_ES,
  type ItemFloorStatus,
  type Project,
  type ProjectPickingState,
} from '@muebles/domain';
import { EmptyState, WorkflowTabs } from '../common';
import type {
  DashboardMetrics,
  SectorDashboard,
} from './ProductionManagerDashboard';
import {
  fabricProjectCards,
  type FabricActiveClaim,
  type FabricProjectMetrics,
  type FabricProjectCard,
  type FabricStation,
} from './fabricProjectCards';

const FABRIC_STATIONS: readonly FabricStation[] = [
  'cutting',
  'edge_banding',
  'assembly',
  'packaging',
];

const TARGET_STATUS: Readonly<Record<FabricStation, ItemFloorStatus>> = {
  cutting: 'cut',
  edge_banding: 'edged',
  assembly: 'assembled',
  packaging: 'packaged',
};

const TAB_LABELS: Readonly<Record<FabricStation, string>> = {
  cutting: 'Corte',
  edge_banding: 'Encintado',
  assembly: 'Armado',
  packaging: 'Embalaje',
};

function formatAvgMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatClaimStart(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function summarizeFabricMetrics(sectors: readonly SectorDashboard[]): {
  queue: number;
  completedToday: number;
  activeOperators: number;
  avgTimeMinutes: number | null;
} {
  let queue = 0;
  let completedToday = 0;
  let activeOperators = 0;
  let weighted = 0;
  for (const sector of sectors) {
    queue += sector.queueLength;
    completedToday += sector.itemsCompletedToday;
    activeOperators += sector.activeOperators;
    weighted += sector.avgTimeMinutes * sector.itemsCompletedToday;
  }
  return {
    queue,
    completedToday,
    activeOperators,
    avgTimeMinutes: completedToday > 0 ? weighted / completedToday : null,
  };
}

function StationMetrics({
  card,
  station,
}: {
  readonly card: FabricProjectCard;
  readonly station: FabricStation;
}): ReactNode {
  const pickingLabel = (
    status: 'pendiente' | 'despachado' | undefined,
  ): string | null => {
    if (!status) return null;
    return status === 'despachado'
      ? 'Surtido por almacén'
      : `Almacén: ${PICKING_STATUS_LABELS_ES[status]}`;
  };

  if (station === 'cutting') {
    return (
      <section
        className="fabric-card__metrics"
        aria-label="Tableros para esta obra"
      >
        <h4 className="fabric-card__section-title">Tableros para esta obra</h4>
        {card.materials.length === 0 ? (
          <p className="fabric-card__missing">
            No hay despiece resuelto para mostrar tableros.
          </p>
        ) : (
          <ul className="fabric-card__metrics-list">
            {card.materials.map((material) => (
              <li key={material.key} className="fabric-card__metric-row">
                <div>
                  <span className="fabric-card__metric-name">
                    {material.name}
                  </span>
                  <span className="fabric-card__metric-meta">
                    {material.areaM2} m² netos · {material.pieces} piezas
                    {material.estimatedSheets
                      ? ` · ~${material.estimatedSheets} planchas`
                      : ''}
                  </span>
                </div>
                {pickingLabel(material.pickingStatus) ? (
                  <span
                    className={
                      material.pickingStatus === 'despachado'
                        ? 'fabric-card__pick fabric-card__pick--ready'
                        : 'fabric-card__pick'
                    }
                  >
                    {pickingLabel(material.pickingStatus)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  if (station === 'edge_banding') {
    return (
      <section
        className="fabric-card__metrics"
        aria-label="Cintillas para esta obra"
      >
        <h4 className="fabric-card__section-title">Cintillas para esta obra</h4>
        {card.edges.length === 0 ? (
          <p className="fabric-card__missing">
            No hay cintillas asignadas para esta obra.
          </p>
        ) : (
          <ul className="fabric-card__metrics-list">
            {card.edges.map((edge) => (
              <li key={edge.key} className="fabric-card__metric-row">
                <div className="fabric-card__edge-main">
                  {edge.previewColor ? (
                    <span
                      className="fabric-card__swatch"
                      style={{ backgroundColor: edge.previewColor }}
                      aria-label={`Color de ${edge.name}`}
                    />
                  ) : null}
                  <div>
                    <span className="fabric-card__metric-name">
                      {edge.name}
                    </span>
                    <span className="fabric-card__metric-meta">
                      {edge.ml} ML · {edge.pieces} piezas · {edge.sides} lados
                      {edge.thicknessMm ? ` · ${edge.thicknessMm} mm` : ''}
                    </span>
                  </div>
                </div>
                {pickingLabel(edge.pickingStatus) ? (
                  <span
                    className={
                      edge.pickingStatus === 'despachado'
                        ? 'fabric-card__pick fabric-card__pick--ready'
                        : 'fabric-card__pick'
                    }
                  >
                    {pickingLabel(edge.pickingStatus)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return null;
}

function ProjectCard({
  card,
  station,
  canAdvance,
  onAdvance,
  onAdvanceBatch,
  onConfirmBatch,
  onClaim,
  onFinish,
}: {
  readonly card: FabricProjectCard;
  readonly station: FabricStation;
  readonly canAdvance: boolean;
  readonly onAdvance: (
    projectId: string,
    itemId: string,
    target: ItemFloorStatus,
  ) => void;
  readonly onAdvanceBatch?: (
    projectId: string,
    itemIds: readonly string[],
    target: ItemFloorStatus,
  ) => void;
  readonly onConfirmBatch?: (
    itemCount: number,
    target: ItemFloorStatus,
  ) => boolean;
  readonly onClaim?: (
    projectId: string,
    sector: FabricStation,
  ) => Promise<void>;
  readonly onFinish?: (
    activityId: string,
    piecesCount: number,
  ) => Promise<void>;
}): ReactNode {
  const target = TARGET_STATUS[station];
  const stationLabel = TAB_LABELS[station].toLowerCase();
  const hasClaims = card.activeClaims.length > 0;
  const itemIds = card.items.map((item) => item.itemId);
  const confirmBatch = (): boolean =>
    onConfirmBatch ? onConfirmBatch(itemIds.length, target) : true;
  const finishAndAdvance = async (activityId: string): Promise<void> => {
    if (!onFinish) return;
    const isLastActiveClaim = card.activeClaims.length === 1;
    if (isLastActiveClaim && !confirmBatch()) return;
    await onFinish(activityId, itemIds.length);
    if (isLastActiveClaim) onAdvanceBatch?.(card.projectId, itemIds, target);
  };
  const advanceBatch = (): void => {
    if (!confirmBatch()) return;
    onAdvanceBatch?.(card.projectId, itemIds, target);
  };

  return (
    <li
      className={`fabric-card ${hasClaims ? 'fabric-card--active' : ''}`}
      data-testid={`fabric-card-${card.projectId}`}
    >
      <header className="fabric-card__header">
        <div>
          <h3 className="fabric-card__title">{card.projectName}</h3>
          {card.customerLabel ? (
            <p className="fabric-card__customer">{card.customerLabel}</p>
          ) : null}
        </div>
        {canAdvance &&
          (hasClaims ? (
            <div className="fabric-card__claim-actions">
              {card.activeClaims.map((claim) => (
                <button
                  key={claim.activityId}
                  type="button"
                  className="btn"
                  onClick={() => void finishAndAdvance(claim.activityId)}
                  data-testid={`fabric-finish-${claim.activityId}`}
                >
                  <Check size={16} strokeWidth={1.5} aria-hidden /> Terminar{' '}
                  {stationLabel}
                </button>
              ))}
            </div>
          ) : onClaim ? (
            <button
              type="button"
              className="btn"
              onClick={() => void onClaim(card.projectId, station)}
              data-testid={`fabric-claim-${card.projectId}`}
            >
              <Play size={16} strokeWidth={1.5} aria-hidden /> Empezar{' '}
              {stationLabel}
            </button>
          ) : null)}
      </header>

      {hasClaims ? (
        <p className="fabric-card__active-copy">
          En curso · empezó{' '}
          {formatClaimStart(card.activeClaims[0]?.startedAt ?? '')} ·{' '}
          {card.activeClaims.map((claim) => claim.operatorName).join(', ')}
        </p>
      ) : null}

      <StationMetrics card={card} station={station} />

      <section
        className="fabric-card__items"
        aria-label={`Módulos en cola de ${card.projectName}`}
      >
        <h4 className="fabric-card__section-title">
          {station === 'assembly'
            ? 'Muebles en cola'
            : station === 'packaging'
              ? 'Módulos a embalar'
              : 'Módulos en cola'}
          <span className="fabric-card__count">{card.items.length}</span>
        </h4>
        <ul className="fabric-card__item-list">
          {card.items.map((item) => (
            <li
              key={item.itemId}
              className="fabric-card__item"
              data-testid={`fabric-row-${item.itemId}`}
            >
              <div>
                <span className="fabric-card__item-name">
                  {item.moduleName} ×{item.quantity}
                </span>
                <span className="fabric-card__item-meta">
                  Está en {ITEM_FLOOR_STATUS_LABELS_ES[item.currentStatus]}
                </span>
              </div>
              {canAdvance ? (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => onAdvance(card.projectId, item.itemId, target)}
                  data-testid={`fabric-advance-${item.itemId}`}
                >
                  Marcar {ITEM_FLOOR_STATUS_LABELS_ES[target]}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {canAdvance && onAdvanceBatch ? (
          <button
            type="button"
            className="btn btn--primary fabric-card__batch"
            onClick={advanceBatch}
            data-testid={`fabric-batch-${card.projectId}`}
          >
            <Check size={16} strokeWidth={1.5} aria-hidden /> Marcar los{' '}
            {card.items.length}
          </button>
        ) : null}
      </section>
    </li>
  );
}

export function FabricScreen({
  projects,
  assignedSectors,
  canAdvance,
  onAdvance,
  customerLabelFor,
  moduleLabelFor,
  metricsByProject = {},
  pickingStates = [],
  activeClaims = [],
  onClaim,
  onFinish,
  onAdvanceBatch,
  onConfirmBatch,
  metrics = null,
  testId,
}: {
  readonly projects: readonly Project[];
  readonly assignedSectors: readonly string[] | null;
  readonly canAdvance: boolean;
  readonly onAdvance: (
    projectId: string,
    itemId: string,
    target: ItemFloorStatus,
  ) => void;
  readonly customerLabelFor?: (customerId: string) => string;
  readonly moduleLabelFor?: (moduleId: string) => string;
  readonly metricsByProject?: Readonly<
    Record<string, FabricProjectMetrics | undefined>
  >;
  readonly pickingStates?: readonly ProjectPickingState[];
  readonly activeClaims?: readonly FabricActiveClaim[];
  readonly onClaim?: (
    projectId: string,
    sector: FabricStation,
  ) => Promise<void>;
  readonly onFinish?: (
    activityId: string,
    piecesCount: number,
  ) => Promise<void>;
  readonly onAdvanceBatch?: (
    projectId: string,
    itemIds: readonly string[],
    target: ItemFloorStatus,
  ) => void;
  readonly onConfirmBatch?: (
    itemCount: number,
    target: ItemFloorStatus,
  ) => boolean;
  readonly metrics?: DashboardMetrics | null;
  readonly testId?: string;
}): ReactNode {
  const visibleTabs = useMemo<FabricStation[]>(() => {
    const assigned = assignedSectors ?? [];
    return assigned.length === 0
      ? [...FABRIC_STATIONS]
      : FABRIC_STATIONS.filter((station) => assigned.includes(station));
  }, [assignedSectors]);
  const [activeTab, setActiveTab] = useState<FabricStation>(
    () => visibleTabs[0] ?? 'cutting',
  );
  const effectiveTab = visibleTabs.includes(activeTab)
    ? activeTab
    : (visibleTabs[0] ?? 'cutting');
  const [showMetrics, setShowMetrics] = useState(false);
  const metricsTotals = useMemo(
    () => (metrics ? summarizeFabricMetrics(metrics.sectors) : null),
    [metrics],
  );
  const cards = useMemo(
    () =>
      fabricProjectCards({
        projects,
        station: effectiveTab,
        metricsByProject,
        pickingStates,
        activeClaims,
        customerLabelFor,
        moduleLabelFor,
      }),
    [
      projects,
      effectiveTab,
      metricsByProject,
      pickingStates,
      activeClaims,
      customerLabelFor,
      moduleLabelFor,
    ],
  );
  const totalWaiting = useMemo(
    () =>
      FABRIC_STATIONS.filter((station) => visibleTabs.includes(station)).reduce(
        (total, station) =>
          total +
          fabricProjectCards({
            projects,
            station,
            metricsByProject,
            pickingStates,
            activeClaims,
          }).reduce((count, card) => count + card.items.length, 0),
        0,
      ),
    [projects, visibleTabs, metricsByProject, pickingStates, activeClaims],
  );

  return (
    <section
      className="fabric"
      aria-label="Producción"
      data-testid={testId ?? 'fabric-screen'}
    >
      <header className="fabric__header">
        <div className="fabric__title-row">
          <span className="fabric__title-icon" aria-hidden>
            <Factory size={20} strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="fabric__title">Producción</h2>
            <p className="fabric__subtitle">
              Obras organizadas por estación. El avance se registra por módulo y
              se refleja en Estado de Planta.
            </p>
          </div>
        </div>
        <div className="fabric__header-actions">
          {metrics ? (
            <div
              className="fabric__view-toggle"
              role="group"
              aria-label="Vista de producción"
            >
              <button
                type="button"
                className={`fabric__view-btn ${!showMetrics ? 'fabric__view-btn--active' : ''}`}
                aria-pressed={!showMetrics}
                onClick={() => setShowMetrics(false)}
                data-testid="fabric-view-queue"
              >
                Cola
              </button>
              <button
                type="button"
                className={`fabric__view-btn ${showMetrics ? 'fabric__view-btn--active' : ''}`}
                aria-pressed={showMetrics}
                onClick={() => setShowMetrics(true)}
                data-testid="fabric-view-metrics"
              >
                Métricas
              </button>
            </div>
          ) : null}
          <span className="fabric__total" data-testid="fabric-total-waiting">
            {totalWaiting} por hacer
          </span>
        </div>
      </header>
      {showMetrics && metrics && metricsTotals ? (
        <div
          className="fabric__metrics"
          data-testid="fabric-metrics"
          aria-label="Métricas por sector"
        >
          <table className="fabric__metrics-table">
            <thead>
              <tr>
                <th scope="col">Sector</th>
                <th scope="col">Cola</th>
                <th scope="col">Operarios</th>
                <th scope="col">Hechos hoy</th>
                <th scope="col">Tiempo prom.</th>
              </tr>
            </thead>
            <tbody>
              {metrics.sectors.map((sector) => (
                <tr key={sector.sector}>
                  <th scope="row">{sector.label || sector.sector}</th>
                  <td>{sector.queueLength}</td>
                  <td>{sector.activeOperators}</td>
                  <td>{sector.itemsCompletedToday}</td>
                  <td>{formatAvgMinutes(sector.avgTimeMinutes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td>{metricsTotals.queue}</td>
                <td>{metricsTotals.activeOperators}</td>
                <td>{metricsTotals.completedToday}</td>
                <td>
                  {metricsTotals.avgTimeMinutes == null
                    ? '—'
                    : formatAvgMinutes(metricsTotals.avgTimeMinutes)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : visibleTabs.length === 0 ? (
        <EmptyState
          title="Tus sectores viven en Embarques o Instalaciones"
          description="No tenés estaciones de fabricación asignadas."
        />
      ) : (
        <>
          <WorkflowTabs
            tabs={visibleTabs.map((station) => ({
              id: station,
              label: TAB_LABELS[station],
              count: fabricProjectCards({
                projects,
                station,
                metricsByProject,
                pickingStates,
                activeClaims,
              }).reduce((total, card) => total + card.items.length, 0),
            }))}
            activeTab={effectiveTab}
            onTabChange={setActiveTab}
            ariaLabel="Estaciones de producción"
            idPrefix="fabric"
            testIdPrefix="fabric"
          />
          <div
            className="fabric__panel"
            role="tabpanel"
            id={`fabric-panel-${effectiveTab}`}
            aria-labelledby={`fabric-tab-${effectiveTab}`}
            data-testid={`fabric-panel-${effectiveTab}`}
          >
            {totalWaiting === 0 ? (
              <EmptyState
                title="Nada esperándote"
                description="Cuando entren obras a fábrica, acá aparece la cola por estación."
              />
            ) : cards.length === 0 ? (
              <div className="fabric__empty-tab">
                <p>Sin trabajos en cola para {TAB_LABELS[effectiveTab]}.</p>
              </div>
            ) : (
              <ul className="fabric__cards">
                {cards.map((card) => (
                  <ProjectCard
                    key={card.projectId}
                    card={card}
                    station={effectiveTab}
                    canAdvance={canAdvance}
                    onAdvance={onAdvance}
                    onAdvanceBatch={onAdvanceBatch}
                    onConfirmBatch={onConfirmBatch}
                    onClaim={onClaim}
                    onFinish={onFinish}
                  />
                ))}
              </ul>
            )}
          </div>
          {visibleTabs.filter((station) => station !== effectiveTab).map((station) => (
            <div
              key={station}
              role="tabpanel"
              id={`fabric-panel-${station}`}
              aria-labelledby={`fabric-tab-${station}`}
              hidden
            />
          ))}
        </>
      )}
    </section>
  );
}
