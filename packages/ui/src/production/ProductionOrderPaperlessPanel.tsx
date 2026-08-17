/**
 * Paperless floor mode — large touch-friendly cards (PROD-4.2 / #240, F089).
 * QR scan: piece-label payload v2 (or plain code) jumps to the module and
 * advances its floor status automatically. Input paths: HID scanner gun
 * (global listener), camera modal, or manual typing.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { ItemFloorStatus, Module, Project } from '@muebles/domain';
import {
  ITEM_FLOOR_STATUSES,
  ITEM_FLOOR_STATUS_LABELS_ES,
  nextItemFloorStatus,
  parsePieceLabelScan,
} from '@muebles/domain';
import { Camera, ScanLine } from 'lucide-react';
import { buildProductionModuleRows } from './productionModuleRows';
import { playScanFeedback } from './scanFeedback';
import { ScanCameraModal } from './ScanCameraModal';
import { useHidScanner } from './useHidScanner';

export type ProductionOrderPaperlessPanelProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly onSetFloorStatus?: (
    itemId: string,
    status: ItemFloorStatus,
  ) => void;
  readonly canSetFloorStatus?: boolean;
  /** Ignore the same item scanned twice within this window (ms). Default 1500. */
  readonly scanDebounceMs?: number;
};

export type ProductionModuleRow = ReturnType<
  typeof buildProductionModuleRows
>[number];

/**
 * Match a raw scan (payload v2/v1 JSON, factory code or module name)
 * against the module rows of this order.
 */
export function matchModuleFromScan(
  scan: string,
  rows: readonly ProductionModuleRow[],
): ProductionModuleRow | null {
  const parsed = parsePieceLabelScan(scan);
  if (!parsed) return null;
  if (parsed.kind === 'modulePayload' && parsed.fields.itemId) {
    const directMatch = rows.find((r) => r.itemId === parsed.fields.itemId);
    if (directMatch) return directMatch;
  }
  const needle = (
    parsed.kind === 'payload'
      ? parsed.fields.moduleCode
      : parsed.kind === 'modulePayload'
        ? parsed.fields.factoryCode || parsed.fields.moduleCode
        : parsed.code
  ).toLowerCase();
  if (!needle) return null;
  return (
    rows.find((r) => r.factoryCode.toLowerCase() === needle) ??
    rows.find((r) => r.moduleCode.toLowerCase() === needle) ??
    rows.find(
      (r) =>
        r.factoryCode.toLowerCase().includes(needle) ||
        r.moduleCode.toLowerCase().includes(needle) ||
        r.moduleName.toLowerCase().includes(needle),
    ) ??
    null
  );
}

export function ProductionOrderPaperlessPanel({
  project,
  modules,
  onSetFloorStatus,
  canSetFloorStatus = false,
  scanDebounceMs = 1500,
}: ProductionOrderPaperlessPanelProps): ReactNode {
  const [filter, setFilter] = useState<ItemFloorStatus | 'all'>('all');
  const [scan, setScan] = useState('');
  const [scanMatchId, setScanMatchId] = useState<string | null>(null);
  const [scanMiss, setScanMiss] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastAdvanceLabel, setLastAdvanceLabel] = useState<string | null>(
    null,
  );
  const lastScanAtRef = useRef<{ itemId: string; at: number } | null>(null);
  const rows = useMemo(
    () => buildProductionModuleRows(project, modules, null),
    [project, modules],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const handleScanText = useCallback(
    (text: string) => {
      const currentRows = rowsRef.current;
      const match = matchModuleFromScan(text, currentRows);
      if (match) {
        setScanMatchId(match.itemId);
        setScanMiss(false);
        setFilter('all');
        const next = nextItemFloorStatus(match.floorStatus);
        const now = Date.now();
        const last = lastScanAtRef.current;
        const debounced = last?.itemId === match.itemId && now - last.at < scanDebounceMs;
        if (debounced) {
          playScanFeedback('hit');
          return;
        }
        lastScanAtRef.current = { itemId: match.itemId, at: now };
        if (autoAdvance && canSetFloorStatus && onSetFloorStatus && next) {
          onSetFloorStatus(match.itemId, next);
          setLastAdvanceLabel(ITEM_FLOOR_STATUS_LABELS_ES[next]);
          playScanFeedback('advance');
        } else {
          setLastAdvanceLabel(null);
          playScanFeedback('hit');
        }
      } else {
        setScanMatchId(null);
        setLastAdvanceLabel(null);
        setScanMiss(true);
        playScanFeedback('miss');
      }
    },
    [autoAdvance, canSetFloorStatus, onSetFloorStatus, scanDebounceMs],
  );

  useHidScanner({ onScan: handleScanText, enabled: !cameraOpen });

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.floorStatus === filter);
  }, [rows, filter]);

  const scanMatch = scanMatchId
    ? (rows.find((r) => r.itemId === scanMatchId) ?? null)
    : null;

  const handleScanSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!scan.trim()) return;
    handleScanText(scan);
    setScan('');
  };

  const advanceScanned = () => {
    if (!scanMatch) return;
    const next = nextItemFloorStatus(scanMatch.floorStatus);
    if (!next || !onSetFloorStatus) return;
    onSetFloorStatus(scanMatch.itemId, next);
    setLastAdvanceLabel(ITEM_FLOOR_STATUS_LABELS_ES[next]);
    setScanMatchId(null);
  };

  return (
    <div className="prod-paperless" data-testid="prod-hub-piso">
      <p className="prod-hub__exports-hint">
        Modo piso — escaneá el QR de la etiqueta (lector USB, cámara o a mano)
        y el avance es automático. Sin editar diseño.
      </p>

      <form
        className="prod-paperless__scan"
        onSubmit={handleScanSubmit}
        data-testid="prod-piso-scan-form"
      >
        <ScanLine size={18} strokeWidth={1.5} aria-hidden />
        <label className="prod-paperless__scan-label" htmlFor="prod-piso-scan">
          Escaneá el QR de una etiqueta o tipeá el código del mueble
        </label>
        <input
          id="prod-piso-scan"
          type="text"
          className="prod-modulos__floor-select prod-paperless__scan-input"
          value={scan}
          onChange={(e) => {
            setScan(e.target.value);
            setScanMiss(false);
          }}
          placeholder="MOD-03, MOD-03-L2 o payload QR…"
          data-testid="prod-piso-scan-input"
        />
        <button
          type="submit"
          className="btn btn--small"
          disabled={!scan.trim()}
          data-testid="prod-piso-scan-submit"
        >
          Buscar
        </button>
        <button
          type="button"
          className="btn btn--small prod-paperless__camera-btn"
          onClick={() => setCameraOpen(true)}
          data-testid="prod-piso-camera-open"
        >
          <Camera size={16} strokeWidth={1.5} aria-hidden /> Cámara
        </button>
        <label className="prod-paperless__auto">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
            data-testid="prod-piso-autoadvance-toggle"
          />
          Auto-avanzar al escanear
        </label>
      </form>

      {scanMatch ? (
        <div
          className={
            lastAdvanceLabel
              ? 'prod-paperless__scan-result prod-paperless__scan-result--advance'
              : 'prod-paperless__scan-result'
          }
          data-testid="prod-piso-scan-result"
          role="status"
        >
          <span>
            <strong>{scanMatch.factoryCode}</strong> · {scanMatch.moduleName} —{' '}
            {ITEM_FLOOR_STATUS_LABELS_ES[scanMatch.floorStatus]}
            {lastAdvanceLabel ? (
              <span
                className="prod-paperless__advance-chip"
                data-testid="prod-piso-scan-advanced"
              >
                ✓ → {lastAdvanceLabel}
              </span>
            ) : null}
          </span>
          {canSetFloorStatus &&
          !lastAdvanceLabel &&
          nextItemFloorStatus(scanMatch.floorStatus) ? (
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={advanceScanned}
              data-testid="prod-piso-scan-advance"
            >
              Marcar:{' '}
              {ITEM_FLOOR_STATUS_LABELS_ES[
                nextItemFloorStatus(scanMatch.floorStatus)!
              ]}
            </button>
          ) : null}
        </div>
      ) : scanMiss ? (
        <p
          className="catalog-form__error"
          role="alert"
          data-testid="prod-piso-scan-miss"
        >
          Código no reconocido en esta obra.
        </p>
      ) : null}

      <div
        className="tab-bar tab-bar--compact"
        role="toolbar"
        aria-label="Filtrar por estado de piso"
      >
        <button
          type="button"
          className={
            filter === 'all'
              ? 'tab-btn tab-btn--active'
              : 'tab-btn'
          }
          onClick={() => setFilter('all')}
          data-testid="prod-piso-filter-all"
        >
          Todos ({rows.length})
        </button>
        {ITEM_FLOOR_STATUSES.map((s) => {
          const n = rows.filter((r) => r.floorStatus === s).length;
          return (
            <button
              key={s}
              type="button"
              className={
                filter === s
                  ? 'tab-btn tab-btn--active'
                  : 'tab-btn'
              }
              onClick={() => setFilter(s)}
              data-testid={`prod-piso-filter-${s}`}
            >
              {ITEM_FLOOR_STATUS_LABELS_ES[s]} ({n})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="prod-hub__placeholder-body">
          No hay módulos en este filtro.
        </p>
      ) : (
        <ul className="prod-paperless__grid">
          {filtered.map((row) => {
            const next = nextItemFloorStatus(row.floorStatus);
            return (
              <li
                key={row.itemId}
                className={
                  row.itemId === scanMatchId
                    ? 'prod-paperless__card prod-paperless__card--scan'
                    : 'prod-paperless__card'
                }
                data-testid={`prod-piso-card-${row.itemId}`}
              >
                <p className="prod-paperless__code">{row.factoryCode}</p>
                <p className="prod-paperless__name">{row.moduleName}</p>
                <p className="prod-paperless__meta">
                  ×{row.quantity} · {row.measuresLabel}
                </p>
                <p className="prod-paperless__status">
                  {ITEM_FLOOR_STATUS_LABELS_ES[row.floorStatus]}
                </p>
                {canSetFloorStatus && onSetFloorStatus && next ? (
                  <button
                    type="button"
                    className="btn btn--primary prod-paperless__advance"
                    data-testid={`prod-piso-advance-${row.itemId}`}
                    onClick={() => onSetFloorStatus(row.itemId, next)}
                  >
                    Marcar: {ITEM_FLOOR_STATUS_LABELS_ES[next]}
                  </button>
                ) : canSetFloorStatus && !next ? (
                  <p className="prod-modulos__muted">Completo</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ScanCameraModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetect={handleScanText}
      />
    </div>
  );
}
