/**
 * Fábrica — Tabbed work queue per production sector (Phase 1 roadmap).
 * Replaces StationQueueScreen ("Mi Estación") with horizontal tabs.
 *
 * Each tab shows items WAITING for that sector across every factory project,
 * with a one-tap advance button. Despacho and Instalación tabs follow the
 * same pattern (packaged → loaded → installed).
 *
 * Read-derive only (itemsWaitingForSector from domain); advancing goes
 * through the shell callback so the server enforces station scoping.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Factory } from 'lucide-react';

import {
  floorStatusForSector,
  itemsWaitingForSector,
  normalizeItemFloorStatus,
  ITEM_FLOOR_STATUS_LABELS_ES,
  PIPELINE_SECTORS,
  PRODUCTION_SECTOR_LABELS_ES,
  type ItemFloorStatus,
  type PipelineSector,
  type Project,
} from '@muebles/domain';
import { EmptyState } from '../common';
import { useRovingTabList } from '../common/rovingTabList';
import type {
  DashboardMetrics,
  SectorDashboard,
} from './ProductionManagerDashboard';

/** All sectors visible in Fábrica tabs (production pipeline). */
const FABRIC_TAB_SECTORS: readonly PipelineSector[] = PIPELINE_SECTORS;

type FabricTabSector = PipelineSector | 'shipping' | 'installation';

/** Sector → target floor status for the advance button. */
const TARGET_STATUS: Readonly<Record<FabricTabSector, ItemFloorStatus | null>> = {
  cutting: 'cut',
  edge_banding: 'edged',
  assembly: 'assembled',
  packaging: 'packaged',
  shipping: 'loaded',
  installation: 'installed',
};

/** Tab labels in Spanish. */
const TAB_LABELS: Readonly<Record<FabricTabSector, string>> = {
  cutting: 'Corte',
  edge_banding: 'Encintado',
  assembly: 'Armado',
  packaging: 'Embalaje',
  shipping: 'Despacho',
  installation: 'Instalación',
};

function formatAvgMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

/**
 * Totals for the metrics table footer: queue is a plain sum; the overall
 * average time is weighted by items completed today (sectors without
 * completions don't pull the average down).
 */
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
  for (const s of sectors) {
    queue += s.queueLength;
    completedToday += s.itemsCompletedToday;
    activeOperators += s.activeOperators;
    weighted += s.avgTimeMinutes * s.itemsCompletedToday;
  }
  return {
    queue,
    completedToday,
    activeOperators,
    avgTimeMinutes:
      completedToday > 0 ? weighted / completedToday : null,
  };
}

export function FabricScreen({
  projects,
  assignedSectors,
  canAdvance,
  onAdvance,
  customerLabelFor,
  metrics = null,
  testId,
}: {
  /** Projects in the factory (accepted/produced), already role-filtered. */
  readonly projects: readonly Project[];
  /**
   * Sectors assigned to the current user. Null/empty = unrestricted
   * (legacy produccion operators see every station).
   */
  readonly assignedSectors: readonly string[] | null;
  readonly canAdvance: boolean;
  /**
   * Advance one item to the station's target status. Called with the
   * RESOLVED target so the shell hits the enforcing endpoint.
   */
  readonly onAdvance: (projectId: string, itemId: string, target: ItemFloorStatus) => void;
  readonly customerLabelFor?: (customerId: string) => string;
  /**
   * Per-sector metrics for supervisors (admin/gerente_produccion). When
   * present, the header gains the [Cola]/[Métricas] toggle (Fase 4.1).
   * Null/omitted (still loading, fetch failed, or sector-scoped operator)
   * keeps the pure queue view.
   */
  readonly metrics?: DashboardMetrics | null;
  readonly testId?: string;
}): ReactNode {
  // Determine which tabs are visible based on assigned sectors.
  const visibleTabs = useMemo<FabricTabSector[]>(() => {
    const assigned = assignedSectors ?? [];
    if (assigned.length === 0) {
      // Unrestricted: all pipeline tabs.
      return [...FABRIC_TAB_SECTORS];
    }
    // Filter to only the assigned sectors, preserving pipeline order.
    return FABRIC_TAB_SECTORS.filter((s) => assigned.includes(s));
  }, [assignedSectors]);

  // Active tab state.
  const [activeTab, setActiveTab] = useState<FabricTabSector>(
    () => visibleTabs[0] ?? 'cutting',
  );

  // Recompute if assignedSectors changes (e.g. user navigates back).
  const effectiveTab = visibleTabs.includes(activeTab)
    ? activeTab
    : visibleTabs[0] ?? 'cutting';

  // [Cola]/[Métricas] view toggle — only for supervisors with metrics data.
  const [showMetrics, setShowMetrics] = useState(false);
  const metricsTotals = useMemo(
    () => (metrics ? summarizeFabricMetrics(metrics.sectors) : null),
    [metrics],
  );

  // Fase 5.2 — ARIA tabs keyboard pattern (arrows/Home/End + roving tabindex).
  const sectorTabs = useRovingTabList({
    tabIds: visibleTabs,
    selectedId: effectiveTab,
    onSelect: setActiveTab,
  });

  // Build rows for the active tab only (not all sectors).
  const rows = useMemo(() => {
    const factoryProjects = projects.filter(
      (p) => p.status === 'accepted' || p.status === 'produced',
    );

    // Shipping and installation are not pipeline sectors with itemsWaitingForSector.
    // They use a different filter: items whose current status matches the "waiting" state.
    if (effectiveTab === 'shipping') {
      // Items waiting for loading = status 'packaged'
      return factoryProjects.flatMap((project) =>
        project.items
          .filter((item) => normalizeItemFloorStatus(item.floorStatus) === 'packaged')
          .map((item) => ({
            projectId: project.id,
            projectName: project.name,
            customerLabel: customerLabelFor?.(project.customerId) ?? '',
            itemId: item.id,
            moduleName: item.moduleId,
            quantity: item.quantity,
            currentStatus: normalizeItemFloorStatus(item.floorStatus),
          })),
      );
    }

    if (effectiveTab === 'installation') {
      // Items waiting for installation = status 'loaded'
      return factoryProjects.flatMap((project) =>
        project.items
          .filter((item) => normalizeItemFloorStatus(item.floorStatus) === 'loaded')
          .map((item) => ({
            projectId: project.id,
            projectName: project.name,
            customerLabel: customerLabelFor?.(project.customerId) ?? '',
            itemId: item.id,
            moduleName: item.moduleId,
            quantity: item.quantity,
            currentStatus: normalizeItemFloorStatus(item.floorStatus),
          })),
      );
    }

    // Pipeline sectors: use domain helper.
    const sector = effectiveTab as PipelineSector;
    return factoryProjects.flatMap((project) =>
      itemsWaitingForSector(project, sector).map((item) => ({
        projectId: project.id,
        projectName: project.name,
        customerLabel: customerLabelFor?.(project.customerId) ?? '',
        itemId: item.id,
        moduleName: item.moduleId,
        quantity: item.quantity,
        currentStatus: normalizeItemFloorStatus(item.floorStatus),
      })),
    );
  }, [projects, effectiveTab, customerLabelFor]);

  // Total items across ALL visible tabs (for the header badge).
  const totalWaiting = useMemo(() => {
    const factoryProjects = projects.filter(
      (p) => p.status === 'accepted' || p.status === 'produced',
    );
    let total = 0;
    for (const tab of visibleTabs) {
      if (tab === 'shipping') {
        total += factoryProjects.reduce(
          (acc, p) =>
            acc +
            p.items.filter(
              (i) => normalizeItemFloorStatus(i.floorStatus) === 'packaged',
            ).length,
          0,
        );
      } else if (tab === 'installation') {
        total += factoryProjects.reduce(
          (acc, p) =>
            acc +
            p.items.filter(
              (i) => normalizeItemFloorStatus(i.floorStatus) === 'loaded',
            ).length,
          0,
        );
      } else {
        total += factoryProjects.reduce(
          (acc, p) => acc + itemsWaitingForSector(p, tab).length,
          0,
        );
      }
    }
    return total;
  }, [projects, visibleTabs]);

  const target = TARGET_STATUS[effectiveTab] ?? null;

  return (
    <section className="fabric" aria-label="Fábrica" data-testid={testId ?? 'fabric-screen'}>
      {/* Header */}
      <header className="fabric__header">
        <div className="fabric__title-row">
          <span className="fabric__title-icon" aria-hidden>
            <Factory size={20} strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="fabric__title">Fábrica</h2>
            <p className="fabric__subtitle">
              Cola de trabajo por sector. Avanzás solo lo tuyo — el resto del
              taller ve el progreso en Estado de Planta.
            </p>
          </div>
        </div>
        <div className="fabric__header-actions">
          {metrics ? (
            <div
              className="fabric__view-toggle"
              role="group"
              aria-label="Vista de fábrica"
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
              {metrics.sectors.map((s) => (
                <tr key={s.sector}>
                  <th scope="row">{s.label || s.sector}</th>
                  <td>{s.queueLength}</td>
                  <td>{s.activeOperators}</td>
                  <td>{s.itemsCompletedToday}</td>
                  <td>{formatAvgMinutes(s.avgTimeMinutes)}</td>
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
          <p className="fabric__metrics-note">
            Promedio general ponderado por ítems completados hoy. El detalle
            completo vive en Producción → Dashboard.
          </p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <nav
            className="fabric__tabs"
            aria-label="Sectores de fábrica"
            role="tablist"
            {...sectorTabs.tabListProps}
          >
        {visibleTabs.map((tab, index) => {
          const isActive = tab === effectiveTab;
          // Count items for this tab.
          let count = 0;
          const factoryProjects = projects.filter(
            (p) => p.status === 'accepted' || p.status === 'produced',
          );
          if (tab === 'shipping') {
            count = factoryProjects.reduce(
              (acc, p) =>
                acc +
                p.items.filter(
                  (i) => normalizeItemFloorStatus(i.floorStatus) === 'packaged',
                ).length,
              0,
            );
          } else if (tab === 'installation') {
            count = factoryProjects.reduce(
              (acc, p) =>
                acc +
                p.items.filter(
                  (i) => normalizeItemFloorStatus(i.floorStatus) === 'loaded',
                ).length,
              0,
            );
          } else {
            count = factoryProjects.reduce(
              (acc, p) => acc + itemsWaitingForSector(p, tab).length,
              0,
            );
          }
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              {...sectorTabs.tabPropsAt(index)}
              aria-selected={isActive}
              aria-controls={`fabric-tab-panel-${tab}`}
              id={`fabric-tab-${tab}`}
              className={`fabric__tab ${isActive ? 'fabric__tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
              data-testid={`fabric-tab-${tab}`}
            >
              {TAB_LABELS[tab]}
              {count > 0 ? (
                <span className="fabric__tab-count">{count}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Tab panel */}
      <div
        className="fabric__panel"
        role="tabpanel"
        id={`fabric-tab-panel-${effectiveTab}`}
        aria-labelledby={`fabric-tab-${effectiveTab}`}
        data-testid={`fabric-panel-${effectiveTab}`}
      >
        {totalWaiting === 0 ? (
          <EmptyState
            title="Nada esperándote"
            description={
              assignedSectors && assignedSectors.length > 0
                ? 'No hay trabajos en cola para tus sectores asignados.'
                : 'Cuando entren obras a fábrica, acá aparece tu cola por sector.'
            }
          />
        ) : rows.length === 0 ? (
          <div className="fabric__empty-tab">
            <p>Sin trabajos en cola para {TAB_LABELS[effectiveTab]}.</p>
          </div>
        ) : (
          <ul className="fabric__list">
            {rows.map((row) => (
              <li
                key={`${row.projectId}-${row.itemId}`}
                className="fabric__row"
                data-testid={`fabric-row-${row.itemId}`}
              >
                <div className="fabric__row-main">
                  <span className="fabric__row-project">{row.projectName}</span>
                  <span className="fabric__row-meta">
                    {row.customerLabel ? `${row.customerLabel} · ` : ''}
                    {row.quantity}{' '}
                    {row.quantity === 1 ? 'mueble' : 'muebles'} · está en{' '}
                    {ITEM_FLOOR_STATUS_LABELS_ES[row.currentStatus]}
                  </span>
                </div>
                {canAdvance && target ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => onAdvance(row.projectId, row.itemId, target)}
                    data-testid={`fabric-advance-${row.itemId}`}
                  >
                    <Factory size={16} strokeWidth={1.5} aria-hidden />
                    Marcar {ITEM_FLOOR_STATUS_LABELS_ES[target]}
                  </button>
                ) : (
                  <span className="fabric__row-waiting">
                    {target ? ITEM_FLOOR_STATUS_LABELS_ES[target] : '—'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
        </>
      )}
    </section>
  );
}
