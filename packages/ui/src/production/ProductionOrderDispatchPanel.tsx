/**
 * Production Order Dispatch & Loading Control Panel (Fase 4 / F092).
 * Interactive checklist for warehouse/dispatch verification.
 * Verifies that 100% of physical furniture packages are loaded onto transport
 * before unlocking the "Liberar Salida a Entrega" release gate.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  ItemFloorStatus,
  Module,
  ModuleLabel,
  Project,
} from '@granete/domain';
import {
  calculateLoadingProgress,
  generateModuleLabels,
  ITEM_FLOOR_STATUS_LABELS_ES,
  parsePieceLabelScan,
} from '@granete/domain';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Package,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Truck,
  Undo2,
} from 'lucide-react';
import { playScanFeedback } from './scanFeedback';
import { ScanCameraModal } from './ScanCameraModal';
import { useHidScanner } from './useHidScanner';

export type ProductionOrderDispatchPanelProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly moduleLabels?: readonly ModuleLabel[] | null;
  readonly customerName?: string;
  readonly onSetFloorStatus?: (
    itemId: string,
    status: ItemFloorStatus,
  ) => void | Promise<void>;
  readonly canSetFloorStatus?: boolean;
  readonly onReleaseToDelivery?: () => void | Promise<void>;
  readonly canReleaseToDelivery?: boolean;
  readonly isReleasing?: boolean;
  readonly scanDebounceMs?: number;
};

type FilterMode = 'all' | 'pending_load' | 'loaded';

export function ProductionOrderDispatchPanel({
  project,
  modules,
  moduleLabels: propModuleLabels,
  customerName = '',
  onSetFloorStatus,
  canSetFloorStatus = true,
  onReleaseToDelivery,
  canReleaseToDelivery = true,
  isReleasing = false,
  scanDebounceMs = 1500,
}: ProductionOrderDispatchPanelProps): ReactNode {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [autoMarkLoaded, setAutoMarkLoaded] = useState(true);
  const [lastScannedMessage, setLastScannedMessage] = useState<string | null>(
    null,
  );
  const [scanMiss, setScanMiss] = useState(false);
  const lastScanAtRef = useRef<{ itemId: string; at: number } | null>(null);

  // Compute live loading progress
  const progress = useMemo(
    () => calculateLoadingProgress(project),
    [project],
  );

  // Resolve module labels (or generate from project + modules)
  const labels = useMemo(() => {
    if (propModuleLabels && propModuleLabels.length > 0) {
      return propModuleLabels;
    }
    try {
      return generateModuleLabels(project, { modules } as never, {
        customerName,
        revision: project.production?.revision?.toString(),
      });
    } catch {
      return [];
    }
  }, [propModuleLabels, project, modules, customerName]);

  // Handle scanned QR payload
  const handleScanText = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;

      const parsed = parsePieceLabelScan(text);
      let targetItemId: string | null = null;
      let matchedLabel: ModuleLabel | undefined;

      if (parsed?.kind === 'modulePayload' && parsed.fields.itemId) {
        targetItemId = parsed.fields.itemId;
        matchedLabel = labels.find((l) => l.itemId === targetItemId);
      } else {
        // Fallback match by factory code or module code
        const needle = (
          parsed?.kind === 'payload'
            ? parsed.fields.moduleCode
            : parsed?.kind === 'modulePayload'
              ? parsed.fields.factoryCode || parsed.fields.moduleCode
              : parsed?.code || text
        ).toLowerCase();

        matchedLabel = labels.find(
          (l) =>
            l.factoryCode.toLowerCase() === needle ||
            l.moduleCode.toLowerCase() === needle ||
            l.moduleName.toLowerCase().includes(needle),
        );
        if (matchedLabel) {
          targetItemId = matchedLabel.itemId;
        }
      }

      if (targetItemId && onSetFloorStatus && canSetFloorStatus) {
        const now = Date.now();
        const last = lastScanAtRef.current;
        const debounced =
          last?.itemId === targetItemId && now - last.at < scanDebounceMs;
        if (debounced) {
          playScanFeedback('hit');
          return;
        }
        lastScanAtRef.current = { itemId: targetItemId, at: now };

        const targetStatus: ItemFloorStatus = autoMarkLoaded
          ? 'loaded'
          : 'packaged';
        void onSetFloorStatus(targetItemId, targetStatus);
        setScanMiss(false);
        playScanFeedback('advance');

        const labelText = matchedLabel
          ? `Bulto ${matchedLabel.packageIndex} de ${matchedLabel.totalPackages} (${matchedLabel.factoryCode})`
          : targetItemId;
        setLastScannedMessage(
          `✓ ${labelText} marcado como ${ITEM_FLOOR_STATUS_LABELS_ES[targetStatus].toUpperCase()}`,
        );
      } else {
        setScanMiss(true);
        setLastScannedMessage(null);
        playScanFeedback('miss');
      }
    },
    [labels, onSetFloorStatus, canSetFloorStatus, autoMarkLoaded, scanDebounceMs],
  );

  useHidScanner({ onScan: handleScanText, enabled: !cameraOpen });

  const handleScanSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    handleScanText(scanInput);
    setScanInput('');
  };

  // Find live item status for each label
  const itemsMap = useMemo(() => {
    const map = new Map<string, ItemFloorStatus>();
    for (const item of project.items) {
      map.set(item.id, item.floorStatus ?? 'pending');
    }
    return map;
  }, [project.items]);

  // Filtered labels
  const filteredLabels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return labels.filter((lbl) => {
      const status = itemsMap.get(lbl.itemId) ?? lbl.floorStatus;
      const isLoaded = status === 'loaded' || status === 'installed';

      if (filter === 'pending_load' && isLoaded) return false;
      if (filter === 'loaded' && !isLoaded) return false;

      if (!q) return true;
      return (
        lbl.factoryCode.toLowerCase().includes(q) ||
        lbl.moduleName.toLowerCase().includes(q) ||
        (lbl.spaceName?.toLowerCase().includes(q) ?? false) ||
        (lbl.wallName?.toLowerCase().includes(q) ?? false) ||
        `bulto ${lbl.packageIndex}`.includes(q)
      );
    });
  }, [labels, itemsMap, filter, search]);

  const totalPkgs = progress.totalPackages ?? progress.totalUnits;
  const loadedPkgs = progress.loadedPackages ?? progress.loadedUnits;
  const packagedPkgs = progress.packagedPackages ?? 0;
  const missingPkgs = Math.max(0, totalPkgs - loadedPkgs);
  const isComplete = progress.allLoaded || progress.isComplete;

  return (
    <div className="prod-dispatch" data-testid="prod-hub-despacho">
      {/* Header & Progress Card */}
      <div className="prod-dispatch__hero">
        <div className="prod-dispatch__hero-main">
          <div className="prod-dispatch__hero-header">
            <Truck className="prod-dispatch__hero-icon" size={28} />
            <div>
              <h3 className="prod-dispatch__hero-title">
                Control de Carga y Despacho de Flete
              </h3>
              <p className="prod-dispatch__hero-subtitle">
                Verificación física de bultos en camión. El proyecto solo puede
                liberarse a entrega cuando el 100% de los muebles estén cargados.
              </p>
            </div>
          </div>

          <div className="prod-dispatch__progress-box">
            <div className="prod-dispatch__progress-bar-bg">
              <div
                className={`prod-dispatch__progress-bar-fill ${
                  isComplete ? 'prod-dispatch__progress-bar-fill--complete' : ''
                }`}
                style={{ width: `${progress.percentage}%` }}
                data-testid="prod-dispatch-progress-fill"
              />
            </div>
            <div className="prod-dispatch__progress-stats">
              <span
                className="prod-dispatch__progress-pct"
                data-testid="prod-dispatch-progress-text"
              >
                {progress.percentage}% cargado ({loadedPkgs} de {totalPkgs}{' '}
                bultos)
              </span>
              <span className="prod-dispatch__progress-breakdown">
                {packagedPkgs} embalados · {totalPkgs - packagedPkgs} en proceso
              </span>
            </div>
          </div>
        </div>

        {/* Release to Delivery Gate */}
        <div
          className={`prod-dispatch__gate ${
            isComplete
              ? 'prod-dispatch__gate--ready'
              : 'prod-dispatch__gate--blocked'
          }`}
          data-testid="prod-dispatch-gate"
        >
          {isComplete ? (
            <>
              <div className="prod-dispatch__gate-info">
                <CheckCircle2
                  className="prod-dispatch__gate-icon prod-dispatch__gate-icon--ready"
                  size={24}
                />
                <div>
                  <h4 className="prod-dispatch__gate-title">
                    ¡Carga 100% Completa y Verificada!
                  </h4>
                  <p className="prod-dispatch__gate-desc">
                    Todos los {totalPkgs} bultos están a bordo. La orden está
                    lista para salida de fábrica.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn--success prod-dispatch__gate-btn"
                onClick={onReleaseToDelivery}
                disabled={!canReleaseToDelivery || isReleasing}
                data-testid="prod-dispatch-release-btn"
              >
                {isReleasing ? (
                  <>
                    <RefreshCw className="spin" size={16} /> Liberando…
                  </>
                ) : (
                  <>
                    <Truck size={16} /> Liberar Salida a Entrega
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="prod-dispatch__gate-info">
                <AlertTriangle
                  className="prod-dispatch__gate-icon prod-dispatch__gate-icon--blocked"
                  size={24}
                />
                <div>
                  <h4 className="prod-dispatch__gate-title">
                    Liberación Bloqueada
                  </h4>
                  <p className="prod-dispatch__gate-desc">
                    Faltan <strong>{missingPkgs}</strong> de {totalPkgs} muebles
                    por cargar al transporte.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn--secondary prod-dispatch__gate-btn"
                disabled
                title={`Faltan ${missingPkgs} bultos por cargar al camión`}
                data-testid="prod-dispatch-release-btn-disabled"
              >
                <Truck size={16} /> Liberar Salida ({missingPkgs} faltantes)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Scanner & Search Controls */}
      <div className="prod-dispatch__controls">
        <form
          className="prod-paperless__scan prod-dispatch__scan-form"
          onSubmit={handleScanSubmit}
          data-testid="prod-dispatch-scan-form"
        >
          <ScanLine size={18} strokeWidth={1.5} aria-hidden />
          <input
            type="text"
            className="prod-paperless__scan-input"
            value={scanInput}
            onChange={(e) => {
              setScanInput(e.target.value);
              setScanMiss(false);
            }}
            placeholder="Escanear QR de bulto o escribir código (ej. GAB-01)…"
            data-testid="prod-dispatch-scan-input"
          />
          <button
            type="submit"
            className="btn btn--small"
            disabled={!scanInput.trim()}
            data-testid="prod-dispatch-scan-submit"
          >
            Buscar / Cargar
          </button>
          <button
            type="button"
            className="btn btn--small btn--secondary prod-paperless__camera-btn"
            onClick={() => setCameraOpen(true)}
            data-testid="prod-dispatch-camera-btn"
          >
            <Camera size={16} /> Cámara
          </button>

          <label className="prod-paperless__auto">
            <input
              type="checkbox"
              checked={autoMarkLoaded}
              onChange={(e) => setAutoMarkLoaded(e.target.checked)}
              data-testid="prod-dispatch-auto-loaded"
            />
            <span>Auto-marcar como Cargado al escanear</span>
          </label>
        </form>

        {lastScannedMessage ? (
          <div
            className="prod-paperless__scan-result prod-paperless__scan-result--advance"
            data-testid="prod-dispatch-scan-feedback"
          >
            <CheckCircle2 size={16} /> {lastScannedMessage}
          </div>
        ) : null}

        {scanMiss ? (
          <div
            className="prod-paperless__scan-result prod-paperless__scan-result--miss"
            data-testid="prod-dispatch-scan-miss"
          >
            No se encontró ningún bulto que coincida con el código escaneado.
          </div>
        ) : null}
      </div>

      {/* Filters Bar */}
      <div className="prod-dispatch__filter-bar">
        <div className="prod-dispatch__pills">
          <button
            type="button"
            className={`prod-queue__tab ${
              filter === 'all' ? 'prod-queue__tab--active' : ''
            }`}
            onClick={() => setFilter('all')}
            data-testid="prod-dispatch-filter-all"
          >
            Todos ({labels.length})
          </button>
          <button
            type="button"
            className={`prod-queue__tab ${
              filter === 'pending_load' ? 'prod-queue__tab--active' : ''
            }`}
            onClick={() => setFilter('pending_load')}
            data-testid="prod-dispatch-filter-pending"
          >
            Pendientes de Carga ({missingPkgs})
          </button>
          <button
            type="button"
            className={`prod-queue__tab ${
              filter === 'loaded' ? 'prod-queue__tab--active' : ''
            }`}
            onClick={() => setFilter('loaded')}
            data-testid="prod-dispatch-filter-loaded"
          >
            Cargados en Camión ({loadedPkgs})
          </button>
        </div>

        <input
          type="search"
          className="prod-modulos__floor-select prod-dispatch__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrar por mueble, ambiente o muro…"
          data-testid="prod-dispatch-search"
        />
      </div>

      {/* Package Checklist Grid */}
      <div className="prod-dispatch__grid" data-testid="prod-dispatch-grid">
        {filteredLabels.map((lbl, idx) => {
          const status = itemsMap.get(lbl.itemId) ?? lbl.floorStatus;
          const isLoaded = status === 'loaded' || status === 'installed';
          const isPackaged = status === 'packaged';

          return (
            <div
              key={`${lbl.itemId}-${lbl.packageIndex}-${idx}`}
              className={`prod-dispatch__card ${
                isLoaded ? 'prod-dispatch__card--loaded' : ''
              }`}
              data-testid={`prod-dispatch-card-${lbl.itemId}`}
            >
              <div className="prod-dispatch__card-header">
                <span className="prod-dispatch__bulto-badge">
                  BULTO {lbl.packageIndex} DE {lbl.totalPackages}
                </span>
                <span
                  className={`badge ${
                    isLoaded
                      ? 'badge--success'
                      : isPackaged
                        ? 'badge--primary'
                        : 'badge--neutral'
                  }`}
                  data-testid={`prod-dispatch-status-${lbl.itemId}`}
                >
                  {ITEM_FLOOR_STATUS_LABELS_ES[status as ItemFloorStatus]}
                </span>
              </div>

              <div className="prod-dispatch__card-body">
                <div className="prod-dispatch__card-title-row">
                  <span className="prod-dispatch__card-code">
                    {lbl.factoryCode}
                  </span>
                  <span className="prod-dispatch__card-name">
                    {lbl.moduleName}
                  </span>
                </div>

                <div className="prod-dispatch__card-meta">
                  <span>📐 {lbl.measuresLabel}</span>
                  {lbl.spaceName ? (
                    <span>
                      📍 {lbl.spaceName}
                      {lbl.wallName ? ` · ${lbl.wallName}` : ''}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="prod-dispatch__card-actions">
                {isLoaded ? (
                  <div className="prod-dispatch__card-loaded-row">
                    <span className="prod-dispatch__loaded-tag">
                      <CheckCircle2 size={16} /> Cargado en Transporte
                    </span>
                    {canSetFloorStatus && onSetFloorStatus ? (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        onClick={() =>
                          void onSetFloorStatus(lbl.itemId, 'packaged')
                        }
                        title="Deshacer carga (volver a Embalado)"
                        data-testid={`prod-dispatch-undo-${lbl.itemId}`}
                      >
                        <Undo2 size={14} /> Deshacer
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="prod-dispatch__card-action-buttons">
                    {canSetFloorStatus && onSetFloorStatus ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--small btn--success"
                          onClick={() =>
                            void onSetFloorStatus(lbl.itemId, 'loaded')
                          }
                          data-testid={`prod-dispatch-mark-loaded-${lbl.itemId}`}
                        >
                          <Truck size={14} /> Marcar Cargado ✓
                        </button>
                        {!isPackaged ? (
                          <button
                            type="button"
                            className="btn btn--small btn--secondary"
                            onClick={() =>
                              void onSetFloorStatus(lbl.itemId, 'packaged')
                            }
                            data-testid={`prod-dispatch-mark-packaged-${lbl.itemId}`}
                          >
                            <PackageCheck size={14} /> Embalado
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredLabels.length === 0 ? (
          <div className="prod-dispatch__empty">
            <Package size={32} />
            <p>No se encontraron bultos que coincidan con el filtro.</p>
          </div>
        ) : null}
      </div>

      {cameraOpen ? (
        <ScanCameraModal
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onDetect={(text: string) => {
            setCameraOpen(false);
            handleScanText(text);
          }}
        />
      ) : null}
    </div>
  );
}
