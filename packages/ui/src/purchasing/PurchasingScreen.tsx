/**
 * PurchasingScreen — Compras / Almacén workspace (Fase 3).
 *
 * Shows what each ACTIVE project needs per material type (herrajes /
 * tableros / cintillas) as picking lists derived from the domain — no
 * real stock management in the MVP. Warehouse operators mark a project's
 * list as "despachado"; supervisors (gerente_produccion) see it read-only.
 *
 * Picking state hydrates from `initialPicking` (persisted despachos) and
 * every toggle is reported through `onTogglePick` so the shell persists it.
 * Design: follows eng-landing pattern (purchasing.css, `.purch-` prefix).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Layers,
  PackageCheck,
  Ruler,
  Warehouse,
  Wrench,
} from 'lucide-react';
import {
  computeProductionTotals,
  pickingKey,
  PICKING_STATUS_LABELS_ES,
  stockStatus,
  stockUnitLabel,
  stockUnitPlural,
  type BoardSheetEstimate,
  type HardwarePurchaseRow,
  type MaterialStock,
  type PickingMaterial,
  type PickingStatus,
  type ProductionCutRow,
  type ProductionEdgeTotal,
  type ProductionMaterialTotal,
  type ProjectPickingState,
  type PurchaseOrder,
  type StockMaterialKind,
  type StockMovement,
  type StockMovementType,
  type Supplier,
} from '@muebles/domain';
import { EmptyState } from '../common';
import { useRovingTabList } from '../common/rovingTabList';
import { StockPanel, type StockCatalogOption } from './StockPanel';
import {
  PurchaseOrdersPanel,
  type PoLineInput,
} from './PurchaseOrdersPanel';
import './purchasing.css';

/** Hardware unit labels (matches catalogs/HardwareCatalog). */
const HARDWARE_UNIT_LABELS: Readonly<Record<string, string>> = {
  piece: 'Pieza',
  set: 'Juego',
  meter: 'Metro',
};

/**
 * One active project with its material data pre-calculated by the shell.
 * cutRows feed both Tableros and Cintillas via `computeProductionTotals`.
 */
export type ActiveProjectMaterial = {
  readonly projectId: string;
  readonly projectName: string;
  readonly hardware: readonly HardwarePurchaseRow[];
  readonly cutRows: readonly ProductionCutRow[];
  /**
   * Estimated full sheets per material (catalog-sized, via
   * `estimateBoardSheets`). Optional — Tableros falls back to pieces/m².
   */
  readonly sheetEstimates?: readonly BoardSheetEstimate[];
};

export type PurchasingScreenProps = {
  /** Active projects (accepted/produced), already role-filtered. */
  readonly projects: readonly ActiveProjectMaterial[];
  /**
   * Current user role. `gerente_produccion` = read-only (no dispatch
   * button); `admin`/`almacen`/guest (null) can mark despachado.
   */
  readonly role: string | null;
  /**
   * Assigned material sectors (almacen). Null/empty = unrestricted
   * (supervisors and local mode see all tabs — consistent with FabricScreen).
   */
  readonly assignedSectors?: readonly string[] | null;
  /**
   * Persisted picking states (despachos already marked) — hydrates the
   * component when it mounts or the shell reloads them. Absence = pendiente.
   */
  readonly initialPicking?: readonly ProjectPickingState[] | null;
  /**
   * Called after every optimistic toggle with the new state, so the shell
   * persists it (localStorage / API). Optional: local-only fallback keeps
   * the screen working without a repository.
   */
  readonly onTogglePick?: (state: {
    projectId: string;
    material: PickingMaterial;
    status: PickingStatus;
  }) => void;

  // --- Stock (Fase 3b): saldos + movimientos para chips y el tab Compras ---

  /** Live balances per tracked material (null = not loaded yet). */
  readonly stock?: readonly MaterialStock[] | null;
  /** Ledger (newest first) para la columna "Último" del panel. */
  readonly stockMovements?: readonly StockMovement[] | null;
  /** `${kind}:${materialId}` → label de catálogo (resuelto por el shell). */
  readonly stockLabels?: Readonly<Record<string, string>>;
  /** Opciones de catálogo por tipo para el modal de movimientos. */
  readonly stockCatalogOptions?: ReadonlyArray<{
    kind: StockMaterialKind;
    items: readonly StockCatalogOption[];
  }>;
  /** code → catalog id para matchear filas de picking contra el stock. */
  readonly materialIdByCode?: Readonly<Record<string, string>>;
  readonly edgeIdByCode?: Readonly<Record<string, string>>;
  readonly onRecordStockMovement?: (payload: {
    kind: StockMaterialKind;
    materialId: string;
    type: StockMovementType;
    quantity: number;
    note?: string;
  }) => Promise<void>;
  readonly onUpsertStockMin?: (payload: {
    kind: StockMaterialKind;
    materialId: string;
    minStock: number;
  }) => Promise<void>;
  /**
   * `${kind}:${materialId}` → precio unitario del catálogo (costPerUnit /
   * boardPrice / costPerMl) para el valor de inventario (Fase 3c).
   */
  readonly stockPrices?: Readonly<Record<string, number>>;
  /**
   * Cost visibility (COST-01/02): cuando es false el panel omite las
   * columnas de costo y el total de inventario. Default false.
   */
  readonly showStockCosts?: boolean;
  /** Código de moneda para el total de inventario. */
  readonly currency?: string;

  // --- Proveedores + órdenes de compra (Fase 3c) ---

  /** Supplier directory (active + inactive). */
  readonly suppliers?: readonly Supplier[] | null;
  /** Purchase orders, newest first, with their items. */
  readonly purchaseOrders?: readonly PurchaseOrder[] | null;
  readonly onSaveSupplier?: (data: {
    id?: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }) => Promise<void>;
  readonly onDeactivateSupplier?: (id: string) => Promise<void>;
  readonly onSavePurchaseOrder?: (data: {
    id?: string;
    supplierId: string;
    notes?: string;
    items: readonly PoLineInput[];
  }) => Promise<void>;
  readonly onEmitPurchaseOrder?: (id: string) => Promise<void>;
  readonly onCancelPurchaseOrder?: (id: string) => Promise<void>;
  readonly onReceivePurchaseOrder?: (
    id: string,
    lines: readonly PoLineInput[],
  ) => Promise<void>;
};

type MaterialTab = PickingMaterial;
type ScreenTab = MaterialTab | 'compras';

const MATERIAL_TABS: readonly MaterialTab[] = ['herrajes', 'tableros', 'cintillas'];

const TAB_LABELS: Readonly<Record<ScreenTab, string>> = {
  herrajes: 'Herrajes',
  tableros: 'Tableros',
  cintillas: 'Cintillas',
  compras: 'Compras',
};

/** Filas de material/canto con id de catálogo resuelto (para matchear stock). */
type MaterialTotalView = ProductionMaterialTotal & { readonly materialId?: string };
type EdgeTotalView = ProductionEdgeTotal & { readonly edgeId?: string };

type ProjectView = ActiveProjectMaterial & {
  readonly materials: readonly MaterialTotalView[];
  readonly edges: readonly EdgeTotalView[];
  readonly totalAreaM2: number;
  readonly totalEdgeMl: number;
};

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatAreaM2(value: number): string {
  return `${value.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} m²`;
}

function unitLabel(unit: string): string {
  return HARDWARE_UNIT_LABELS[unit] ?? unit;
}

export function PurchasingScreen({
  projects,
  role,
  assignedSectors = null,
  initialPicking = null,
  onTogglePick,
  stock = null,
  stockMovements = null,
  stockLabels = {},
  stockCatalogOptions = [],
  materialIdByCode = undefined,
  edgeIdByCode = undefined,
  onRecordStockMovement,
  onUpsertStockMin,
  stockPrices = {},
  showStockCosts = false,
  currency,
  suppliers = null,
  purchaseOrders = null,
  onSaveSupplier,
  onDeactivateSupplier,
  onSavePurchaseOrder,
  onEmitPurchaseOrder,
  onCancelPurchaseOrder,
  onReceivePurchaseOrder,
}: PurchasingScreenProps): ReactNode {
  const [picking, setPicking] = useState<Record<string, PickingStatus>>({});
  const [activeTab, setActiveTab] = useState<ScreenTab>('herrajes');
  const [comprasTab, setComprasTab] = useState<'stock' | 'purchase'>('stock');

  // Fase 5.2 — ARIA tabs keyboard pattern (arrows/Home/End + roving tabindex).
  // Wired below once visibleMaterialTabs resolves to the effective tabs.

  // Hydrate from persisted states (mount + shell reloads). Rebuilds the map
  // from the prop so server truth wins over any stale optimistic update.
  useEffect(() => {
    const map: Record<string, PickingStatus> = {};
    for (const s of initialPicking ?? []) {
      map[pickingKey(s.projectId, s.material)] = s.status;
    }
    setPicking(map);
  }, [initialPicking]);

  /** gerente_produccion (and no one else besides admin/almacen) is read-only. */
  const canMarkPicked = role == null || role === 'admin' || role === 'almacen';

  // Sector-scoped tabs: almacen with assigned sectors sees only those.
  const visibleMaterialTabs = useMemo<MaterialTab[]>(() => {
    const assigned = assignedSectors ?? [];
    if (assigned.length === 0) return [...MATERIAL_TABS];
    return MATERIAL_TABS.filter((t) => assigned.includes(t));
  }, [assignedSectors]);

  const visibleTabs = useMemo<ScreenTab[]>(
    () => [...visibleMaterialTabs, 'compras'],
    [visibleMaterialTabs],
  );

  const effectiveTab = visibleTabs.includes(activeTab)
    ? activeTab
    : (visibleTabs[0] ?? 'compras');

  const materialTabsKeyboard = useRovingTabList({
    tabIds: visibleTabs,
    selectedId: effectiveTab,
    onSelect: setActiveTab,
  });
  const comprasTabsKeyboard = useRovingTabList({
    tabIds: ['stock', 'purchase'] as const,
    selectedId: comprasTab,
    onSelect: setComprasTab,
  });

  // Per-project derived totals (materials + edges) — computed once. Las filas
  // llevan el id de catálogo resuelto (materialId/edgeId) para el stock.
  const projectViews = useMemo<ProjectView[]>(
    () =>
      projects.map((p) => {
        const totals = computeProductionTotals(p.cutRows);
        return {
          ...p,
          materials: totals.materials.map((m) => ({
            ...m,
            materialId: materialIdByCode?.[m.materialCode ?? m.key],
          })),
          edges: totals.edges.map((e) => ({
            ...e,
            edgeId: edgeIdByCode?.[e.edgeBandCode ?? e.key],
          })),
          totalAreaM2: totals.totalAreaM2,
          totalEdgeMl: totals.totalEdgeMl,
        };
      }),
    [projects, materialIdByCode, edgeIdByCode],
  );

  /** Stock row de un material, o undefined si no está trackeado. */
  const stockFor = (
    kind: StockMaterialKind,
    materialId: string | undefined,
  ): MaterialStock | undefined =>
    materialId
      ? (stock ?? []).find((s) => s.kind === kind && s.materialId === materialId)
      : undefined;

  /** Chip de stock para una fila de picking. */
  const renderStockChip = (
    kind: StockMaterialKind,
    materialId: string | undefined,
    hardwareUnit?: string,
  ): ReactNode => {
    const row = stockFor(kind, materialId);
    if (!row) {
      return (
        <span className="purch-stock-chip purch-stock-chip--none">sin stock</span>
      );
    }
    const unit = stockUnitLabel(kind, hardwareUnit);
    const status = stockStatus(row.quantity, row.minStock);
    return (
      <span
        className={`purch-stock-chip purch-stock-chip--${status}`}
        data-testid={`purch-stock-chip-${kind}-${materialId}`}
      >
        stock {formatQty(row.quantity)} {stockUnitPlural(unit, row.quantity)}
      </span>
    );
  };

  const statusFor = (projectId: string, material: MaterialTab): PickingStatus =>
    picking[pickingKey(projectId, material)] ?? 'pendiente';

  const togglePick = (projectId: string, material: MaterialTab): void => {
    const key = pickingKey(projectId, material);
    const next: PickingStatus =
      picking[key] === 'despachado' ? 'pendiente' : 'despachado';
    // Optimistic local update first — the badge/stat feedback is instant.
    setPicking((prev) => ({ ...prev, [key]: next }));
    // Report the new state so the shell persists it (no-op without repo).
    onTogglePick?.({ projectId, material, status: next });
  };

  /** Projects with a pending pick per material (tab badges). */
  const pendingCounts = useMemo<Record<ScreenTab, number>>(() => {
    const counts: Record<ScreenTab, number> = {
      herrajes: 0,
      tableros: 0,
      cintillas: 0,
      compras: 0,
    };
    for (const p of projectViews) {
      if (
        p.hardware.length > 0 &&
        picking[pickingKey(p.projectId, 'herrajes')] !== 'despachado'
      ) {
        counts.herrajes += 1;
      }
      if (
        p.materials.length > 0 &&
        picking[pickingKey(p.projectId, 'tableros')] !== 'despachado'
      ) {
        counts.tableros += 1;
      }
      if (
        p.edges.length > 0 &&
        picking[pickingKey(p.projectId, 'cintillas')] !== 'despachado'
      ) {
        counts.cintillas += 1;
      }
    }
    return counts;
  }, [projectViews, picking]);

  const stats = useMemo(
    () => ({
      projects: projectViews.length,
      hardwareLines: projectViews.reduce((s, p) => s + p.hardware.length, 0),
      areaM2: projectViews.reduce((s, p) => s + p.totalAreaM2, 0),
      edgeMl: projectViews.reduce((s, p) => s + p.totalEdgeMl, 0),
    }),
    [projectViews],
  );

  const projectsWithHardware = projectViews.filter((p) => p.hardware.length > 0);
  const projectsWithMaterials = projectViews.filter((p) => p.materials.length > 0);
  const projectsWithEdges = projectViews.filter((p) => p.edges.length > 0);

  const renderProjectActions = (
    projectId: string,
    material: MaterialTab,
  ): ReactNode => {
    const status = statusFor(projectId, material);
    if (!canMarkPicked) {
      return (
        <span
          className={`purch-badge purch-badge--${status}`}
          data-testid={`purch-status-${projectId}-${material}`}
        >
          {PICKING_STATUS_LABELS_ES[status]}
        </span>
      );
    }
    if (status === 'despachado') {
      return (
        <div className="purch-card__actions">
          <span
            className="purch-badge purch-badge--despachado"
            data-testid={`purch-status-${projectId}-${material}`}
          >
            <CheckCircle2 size={12} strokeWidth={2} aria-hidden />
            {PICKING_STATUS_LABELS_ES.despachado}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => togglePick(projectId, material)}
            data-testid={`purch-unmark-${projectId}-${material}`}
          >
            Desmarcar
          </button>
        </div>
      );
    }
    return (
      <div className="purch-card__actions">
        <span
          className="purch-badge purch-badge--pendiente"
          data-testid={`purch-status-${projectId}-${material}`}
        >
          <CircleDashed size={12} strokeWidth={2} aria-hidden />
          {PICKING_STATUS_LABELS_ES.pendiente}
        </span>
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={() => togglePick(projectId, material)}
          data-testid={`purch-mark-${projectId}-${material}`}
        >
          <PackageCheck size={14} strokeWidth={1.5} aria-hidden />
          Marcar despachado
        </button>
      </div>
    );
  };

  const renderHardwareTab = (): ReactNode => {
    if (projectsWithHardware.length === 0) {
      return (
        <EmptyState
          icon={Wrench}
          title="Sin herrajes por despachar"
          description="Los proyectos activos con herrajes resueltos aparecen acá como listas de picking."
        />
      );
    }
    return (
      <ul className="purch-project-list">
        {projectsWithHardware.map((p) => (
          <li
            key={p.projectId}
            className="purch-card"
            data-testid={`purch-project-${p.projectId}`}
          >
            <div className="purch-card__header">
              <div className="purch-card__titles">
                <span className="purch-card__name">{p.projectName}</span>
                <span className="purch-card__sub">
                  {p.hardware.length} {p.hardware.length === 1 ? 'línea' : 'líneas'}
                </span>
              </div>
              {renderProjectActions(p.projectId, 'herrajes')}
            </div>
            <ul className="purch-card__rows">
              {p.hardware.map((row, i) => (
                <li
                  key={row.hardwareId ?? `${p.projectId}-h-${i}`}
                  className="purch-row"
                >
                  <span className="purch-row__name">
                    {row.description}
                    <code className="purch-row__code">{row.code}</code>
                  </span>
                  <div className="purch-row__right">
                    <span className="purch-row__qty">
                      {formatQty(row.purchaseQuantity)} {unitLabel(row.unit)}
                      {row.purchasePackages
                        ? ` · ${row.purchasePackages} paq.`
                        : ''}
                    </span>
                    {renderStockChip('herrajes', row.hardwareId, row.unit)}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  };

  const renderTablerosTab = (): ReactNode => {
    if (projectsWithMaterials.length === 0) {
      return (
        <EmptyState
          icon={Layers}
          title="Sin tableros por despachar"
          description="Los tableros necesarios por proyecto activo aparecen acá, derivados del despiece."
        />
      );
    }
    return (
      <ul className="purch-project-list">
        {projectsWithMaterials.map((p) => (
          <li
            key={p.projectId}
            className="purch-card"
            data-testid={`purch-project-${p.projectId}`}
          >
            <div className="purch-card__header">
              <div className="purch-card__titles">
                <span className="purch-card__name">{p.projectName}</span>
                <span className="purch-card__sub">{formatAreaM2(p.totalAreaM2)}</span>
              </div>
              {renderProjectActions(p.projectId, 'tableros')}
            </div>
            <ul className="purch-card__rows">
              {p.materials.map((m) => (
                <li key={m.key} className="purch-row">
                  <span className="purch-row__name">
                    {m.name}
                    {m.thicknessMm ? ` · ${m.thicknessMm} mm` : ''}
                  </span>
                  <div className="purch-row__right">
                    <span className="purch-row__qty">
                      {m.pieces} {m.pieces === 1 ? 'pieza' : 'piezas'} ·{' '}
                      {formatAreaM2(m.areaM2)}
                    </span>
                    {renderStockChip('tableros', m.materialId)}
                  </div>
                </li>
              ))}
            </ul>
            {p.sheetEstimates && p.sheetEstimates.length > 0 ? (
              <div className="purch-card__sheets">
                <span className="purch-card__sheets-title">
                  Planchas estimadas
                </span>
                {p.sheetEstimates.map((s) => (
                  <div key={s.materialId} className="purch-card__sheets-row">
                    <span>
                      {s.name} · ~{s.estimatedSheets} plancha
                      {s.estimatedSheets === 1 ? '' : 's'}
                      {s.sheetWidthMm > 0
                        ? ` (${s.sheetWidthMm}×${s.sheetLengthMm} mm)`
                        : ''}
                    </span>
                    {renderStockChip('tableros', s.materialId)}
                  </div>
                ))}
                <span className="purch-card__sheets-note">
                  Estimado — nesting real en software de corte
                </span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  };

  const renderCintillasTab = (): ReactNode => {
    if (projectsWithEdges.length === 0) {
      return (
        <EmptyState
          icon={Ruler}
          title="Sin cintillas por despachar"
          description="Los cantos en metros lineales por proyecto activo aparecen acá."
        />
      );
    }
    return (
      <ul className="purch-project-list">
        {projectsWithEdges.map((p) => (
          <li
            key={p.projectId}
            className="purch-card"
            data-testid={`purch-project-${p.projectId}`}
          >
            <div className="purch-card__header">
              <div className="purch-card__titles">
                <span className="purch-card__name">{p.projectName}</span>
                <span className="purch-card__sub">
                  {p.totalEdgeMl.toLocaleString('es-AR', { maximumFractionDigits: 2 })}{' '}
                  ml
                </span>
              </div>
              {renderProjectActions(p.projectId, 'cintillas')}
            </div>
            <ul className="purch-card__rows">
              {p.edges.map((e) => (
                <li key={e.key} className="purch-row">
                  <span className="purch-row__name">
                    {e.name}
                    {e.thicknessMm ? ` · ${e.thicknessMm} mm` : ''}
                  </span>
                  <div className="purch-row__right">
                    <span className="purch-row__qty">
                      {e.ml.toLocaleString('es-AR', { maximumFractionDigits: 2 })}{' '}
                      ml
                    </span>
                    {renderStockChip('cintillas', e.edgeId)}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  };

  const renderComprasTab = (): ReactNode => {
    const canEditStock =
      canMarkPicked && onRecordStockMovement != null && onUpsertStockMin != null;
    const canEditPurchasing =
      canMarkPicked &&
      onSaveSupplier != null &&
      onSavePurchaseOrder != null &&
      onEmitPurchaseOrder != null &&
      onCancelPurchaseOrder != null &&
      onReceivePurchaseOrder != null;
    return (
      <div className="purch-compras">
        <div
          className="purch-stock__filters purch-compras__tabs"
          role="tablist"
          aria-label="Compras"
          {...comprasTabsKeyboard.tabListProps}
        >
          {(['stock', 'purchase'] as const).map((t, index) => (
            <button
              key={t}
              type="button"
              role="tab"
              {...comprasTabsKeyboard.tabPropsAt(index)}
              aria-selected={comprasTab === t}
              className={`tab-btn ${comprasTab === t ? 'tab-btn--active' : ''}`}
              onClick={() => setComprasTab(t)}
              data-testid={`purch-compras-tab-${t}`}
            >
              {t === 'stock' ? 'Stock' : 'Órdenes y proveedores'}
            </button>
          ))}
        </div>
        {comprasTab === 'stock' ? (
          <StockPanel
            stock={stock ?? []}
            movements={stockMovements}
            labels={stockLabels}
            catalogOptions={stockCatalogOptions}
            canEdit={canEditStock}
            onRecordMovement={async (payload) => {
              if (onRecordStockMovement) await onRecordStockMovement(payload);
            }}
            onSetMin={async (payload) => {
              if (onUpsertStockMin) await onUpsertStockMin(payload);
            }}
            prices={stockPrices}
            showCosts={showStockCosts}
            currency={currency}
          />
        ) : (
          <PurchaseOrdersPanel
            suppliers={suppliers ?? []}
            orders={purchaseOrders ?? []}
            canEdit={canEditPurchasing}
            catalogOptions={stockCatalogOptions}
            onSaveSupplier={async (data) => {
              if (onSaveSupplier) await onSaveSupplier(data);
            }}
            onDeactivateSupplier={async (id) => {
              if (onDeactivateSupplier) await onDeactivateSupplier(id);
            }}
            onSavePurchaseOrder={async (data) => {
              if (onSavePurchaseOrder) await onSavePurchaseOrder(data);
            }}
            onEmitPurchaseOrder={async (id) => {
              if (onEmitPurchaseOrder) await onEmitPurchaseOrder(id);
            }}
            onCancelPurchaseOrder={async (id) => {
              if (onCancelPurchaseOrder) await onCancelPurchaseOrder(id);
            }}
            onReceivePurchaseOrder={async (id, lines) => {
              if (onReceivePurchaseOrder) await onReceivePurchaseOrder(id, lines);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <section className="purch-landing" aria-label="Compras y almacén">
      <header className="purch-landing__header">
        <div>
          <h2 className="purch-landing__title">Compras / Almacén</h2>
          <p className="purch-landing__subtitle">
            Qué necesita cada proyecto activo, como lista de picking por
            material. Sin gestión de stock en esta fase.
          </p>
        </div>
        <span className="purch-landing__badge">
          <Warehouse size={14} strokeWidth={1.5} aria-hidden />
          {stats.projects} {stats.projects === 1 ? 'proyecto activo' : 'proyectos activos'}
        </span>
      </header>

      {/* Stat cards */}
      <div className="purch-stats">
        <div className="purch-stat" data-testid="purch-stat-projects">
          <span className="purch-stat__icon purch-stat__icon--projects">
            <Warehouse size={18} strokeWidth={1.5} />
          </span>
          <div className="purch-stat__body">
            <span className="purch-stat__value">{stats.projects}</span>
            <span className="purch-stat__label">Proyectos activos</span>
          </div>
        </div>
        <div className="purch-stat" data-testid="purch-stat-hardware">
          <span className="purch-stat__icon purch-stat__icon--hardware">
            <Wrench size={18} strokeWidth={1.5} />
          </span>
          <div className="purch-stat__body">
            <span className="purch-stat__value">{stats.hardwareLines}</span>
            <span className="purch-stat__label">Líneas de herrajes</span>
          </div>
        </div>
        <div className="purch-stat" data-testid="purch-stat-tableros">
          <span className="purch-stat__icon purch-stat__icon--tableros">
            <Layers size={18} strokeWidth={1.5} />
          </span>
          <div className="purch-stat__body">
            <span className="purch-stat__value">{formatAreaM2(stats.areaM2)}</span>
            <span className="purch-stat__label">Tableros (área neta)</span>
          </div>
        </div>
        <div className="purch-stat" data-testid="purch-stat-cintillas">
          <span className="purch-stat__icon purch-stat__icon--cintillas">
            <Ruler size={18} strokeWidth={1.5} />
          </span>
          <div className="purch-stat__body">
            <span className="purch-stat__value">
              {stats.edgeMl.toLocaleString('es-AR', { maximumFractionDigits: 1 })}{' '}
              ml
            </span>
            <span className="purch-stat__label">Cintillas</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <nav
        className="tab-bar"
        role="tablist"
        aria-label="Tabs de compras y almacén"
        {...materialTabsKeyboard.tabListProps}
      >
        <div className="tab-bar__inner">
          {visibleTabs.map((tab, index) => {
            const isActive = effectiveTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                {...materialTabsKeyboard.tabPropsAt(index)}
                aria-selected={isActive}
                className={`tab-btn ${isActive ? 'tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab)}
                data-testid={`purch-tab-${tab}`}
              >
                {TAB_LABELS[tab]}
                {tab !== 'compras' && pendingCounts[tab] > 0 ? (
                  <span className="tab-btn__badge">{pendingCounts[tab]}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="purch-panel" data-testid={`purch-panel-${effectiveTab}`}>
        {effectiveTab === 'herrajes' ? renderHardwareTab() : null}
        {effectiveTab === 'tableros' ? renderTablerosTab() : null}
        {effectiveTab === 'cintillas' ? renderCintillasTab() : null}
        {effectiveTab === 'compras' ? renderComprasTab() : null}
      </div>
    </section>
  );
}
