/**
 * Production hub — Etiquetas tab: the single home for piece labels.
 * Office prints PDF (A4); plant prints thermal ZPL. Same data, same QR,
 * scope + copies configurable, faithful preview (real QR).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import type { PieceLabel, Project, ZplDpi, ZplSizePreset } from '@muebles/domain';
import {
  pieceBatchToZpl,
  pieceLabelEdgeSides,
  pieceLabelQrPayload,
  ZPL_SIZE_PRESETS,
} from '@muebles/domain';
import { FileDown, Printer, Search, Tags } from 'lucide-react';
import {
  readLabelPrinterSettings,
  writeLabelPrinterSettings,
} from './labelPrinterSettings';

/** Raw-print bridge — only injected by the desktop shell (zpl:printRaw). */
type PrintRawBridge = (
  printerName: string,
  payload: string,
) => Promise<{ ok: boolean; error?: string }>;

type ElectronPrintHost = {
  readonly electronAPI?: { readonly printRaw?: PrintRawBridge };
};

function readPrintRawBridge(): PrintRawBridge | null {
  const host = (globalThis as { window?: ElectronPrintHost }).window;
  const bridge = host?.electronAPI?.printRaw;
  return typeof bridge === 'function' ? bridge : null;
}

export type ProductionOrderLabelsPanelProps = {
  readonly project: Project;
  /** Resolved labels (domain generatePieceLabels); null = resolve error. */
  readonly labels: readonly PieceLabel[] | null;
  readonly labelsError?: string | null;
  /** Shell builds the PDF from the scoped labels + copy mode. */
  readonly onExportPdf?: (
    labels: readonly PieceLabel[],
    perUnit: boolean,
  ) => void | Promise<void>;
  readonly exportBusy?: boolean;
  /** Test seam — defaults to a browser blob download. */
  readonly onDownloadZpl?: (content: string, filename: string) => void;
};

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'proyecto'
  );
}

/** One label per unit (quantity 3 → 3 physical labels). */
function expandPerUnit(labels: readonly PieceLabel[]): PieceLabel[] {
  return labels.flatMap((label) => {
    const copies = Math.max(1, Math.floor(label.quantity));
    return Array.from({ length: copies }, () => ({ ...label, quantity: 1 }));
  });
}

export function ProductionOrderLabelsPanel({
  project,
  labels,
  labelsError = null,
  onExportPdf,
  exportBusy = false,
  onDownloadZpl,
}: ProductionOrderLabelsPanelProps): ReactNode {
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [materialFilter, setMaterialFilter] = useState<string>('all');
  const [perUnit, setPerUnit] = useState(false);
  const [printer, setPrinter] = useState(() => readLabelPrinterSettings());
  const [activeIdx, setActiveIdx] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [printRaw] = useState<PrintRawBridge | null>(() => readPrintRawBridge());
  const [printFeedback, setPrintFeedback] = useState<
    { ok: boolean; message: string } | null
  >(null);

  useEffect(() => {
    writeLabelPrinterSettings(printer);
  }, [printer]);

  const moduleOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const l of labels ?? []) codes.add(l.moduleCode);
    return [...codes].sort((a, b) => a.localeCompare(b, 'es'));
  }, [labels]);

  const materialOptions = useMemo(() => {
    const names = new Set<string>();
    for (const l of labels ?? []) names.add(l.materialName);
    return [...names].sort((a, b) => a.localeCompare(b, 'es'));
  }, [labels]);

  const filtered = useMemo(() => {
    if (!labels) return [];
    const q = query.trim().toLowerCase();
    return labels.filter((l) => {
      if (moduleFilter !== 'all' && l.moduleCode !== moduleFilter) return false;
      if (materialFilter !== 'all' && l.materialName !== materialFilter) {
        return false;
      }
      if (!q) return true;
      return [l.partCode, l.description, l.moduleCode, l.materialCode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [labels, query, moduleFilter, materialFilter]);

  const printLabels = useMemo(
    () => (perUnit ? expandPerUnit(filtered) : [...filtered]),
    [filtered, perUnit],
  );

  const active = printLabels[Math.min(activeIdx, printLabels.length - 1)];
  const revision = project.production?.revision?.toString();
  const dims = ZPL_SIZE_PRESETS[printer.preset];

  // Real QR for the faithful preview (canvas unavailable → placeholder).
  useEffect(() => {
    if (!active) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    const payload = pieceLabelQrPayload({
      projectId: project.id,
      moduleCode: active.moduleCode,
      partCode: active.partCode,
      description: active.description,
      materialCode: active.materialCode,
      lengthMm: active.lengthMm,
      widthMm: active.widthMm,
      quantity: active.quantity,
      edgeSides: pieceLabelEdgeSides(active),
      edgeCode: active.edgeBandCode,
      revision,
    });
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, project.id, revision]);

  if (labels === null) {
    return (
      <div className="prod-labels" data-testid="prod-hub-etiquetas">
        <p className="prod-hub__ready-banner prod-hub__ready-banner--blocked">
          {labelsError || 'No se pudieron resolver las etiquetas de pieza.'}
        </p>
      </div>
    );
  }

  if (labels.length === 0) {
    return (
      <div className="prod-labels" data-testid="prod-hub-etiquetas">
        <p className="prod-hub__placeholder-body">
          No hay piezas de tablero para etiquetar. Revisá módulos y opciones en
          cotización.
        </p>
      </div>
    );
  }

  const handleDownloadZpl = () => {
    if (printLabels.length === 0) return;
    const content = pieceBatchToZpl(printLabels, printer.preset, {
      dpi: printer.dpi,
      includeBorder: printer.includeBorder,
      projectId: project.id,
      revision,
    });
    const filename = `etiquetas_${slugify(project.name)}_${printer.preset}${
      perUnit ? '_por_unidad' : ''
    }.zpl`;
    if (onDownloadZpl) {
      onDownloadZpl(content, filename);
      return;
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintRaw = async () => {
    if (!printRaw || printLabels.length === 0) return;
    setPrintFeedback(null);
    const content = pieceBatchToZpl(printLabels, printer.preset, {
      dpi: printer.dpi,
      includeBorder: printer.includeBorder,
      projectId: project.id,
      revision,
    });
    const result = await printRaw(printer.printerName ?? '', content);
    setPrintFeedback(
      result.ok
        ? { ok: true, message: `Enviadas ${printLabels.length} etiquetas a ${printer.printerName}.` }
        : { ok: false, message: result.error ?? 'No se pudo imprimir' },
    );
  };

  return (
    <div className="prod-labels" data-testid="prod-hub-etiquetas">
      <p className="prod-hub__exports-hint">
        Etiquetas de pieza de toda la orden — misma población que el despiece.
        Oficina: PDF A4 para imprimir y cortar. Planta: archivo{' '}
        <strong>.zpl</strong> para la impresora térmica (Zebra).
      </p>

      <div className="prod-modulos__toolbar">
        <label className="prod-modulos__search">
          <Search size={16} strokeWidth={1.5} aria-hidden />
          <span className="sr-only">Buscar etiquetas</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Buscar código, pieza, módulo…"
            data-testid="prod-labels-search"
          />
        </label>
        <label className="prod-labels__filter">
          <span className="prod-labels__filter-label">Módulo</span>
          <select
            className="prod-modulos__floor-select"
            value={moduleFilter}
            onChange={(e) => {
              setModuleFilter(e.target.value);
              setActiveIdx(0);
            }}
            data-testid="prod-labels-module-filter"
          >
            <option value="all">Todos</option>
            {moduleOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="prod-labels__filter">
          <span className="prod-labels__filter-label">Material</span>
          <select
            className="prod-modulos__floor-select"
            value={materialFilter}
            onChange={(e) => {
              setMaterialFilter(e.target.value);
              setActiveIdx(0);
            }}
            data-testid="prod-labels-material-filter"
          >
            <option value="all">Todos</option>
            {materialOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div
          className="prod-despiece__group"
          role="group"
          aria-label="Copias por pieza"
        >
          <button
            type="button"
            className={
              perUnit ? 'prod-hub__tab' : 'prod-hub__tab prod-hub__tab--active'
            }
            onClick={() => setPerUnit(false)}
            data-testid="prod-labels-per-piece"
          >
            1 por pieza
          </button>
          <button
            type="button"
            className={
              perUnit ? 'prod-hub__tab prod-hub__tab--active' : 'prod-hub__tab'
            }
            onClick={() => setPerUnit(true)}
            data-testid="prod-labels-per-unit"
          >
            1 por unidad (× cant)
          </button>
        </div>
        <p className="prod-modulos__count" data-testid="prod-labels-count">
          {filtered.length} etiqueta{filtered.length === 1 ? '' : 's'}
          {perUnit ? ` · ${printLabels.length} impresiones` : ''}
        </p>
      </div>

      <div className="prod-labels__grid">
        <section
          className="prod-labels__preview-col"
          aria-label="Preview y configuración de impresión"
        >
          <div
            className={`prod-labels__card prod-labels__card--${printer.preset}${
              active?.L1 ? ' prod-labels__card--edge-l1' : ''
            }${active?.L2 ? ' prod-labels__card--edge-l2' : ''}${
              active?.W1 ? ' prod-labels__card--edge-w1' : ''
            }${active?.W2 ? ' prod-labels__card--edge-w2' : ''}`}
            style={{ aspectRatio: `${dims.widthMm} / ${dims.heightMm}` }}
            data-testid="prod-labels-preview-card"
          >
            {active ? (
              <>
                <div className="prod-labels__card-main">
                  <p className="prod-labels__card-title">
                    {active.partCode || active.description}
                  </p>
                  <p className="prod-labels__card-dims">
                    {active.lengthMm} × {active.widthMm} mm
                    {active.thicknessMm ? ` × ${active.thicknessMm} mm` : ''}
                    {perUnit ? '' : ` · ×${active.quantity}`}
                  </p>
                  <p className="prod-labels__card-line">
                    {active.moduleCode} — {active.moduleName}
                  </p>
                  <p className="prod-labels__card-line">
                    <strong>Tablero:</strong> {active.materialName} ({active.materialCode})
                  </p>
                  {active.edgeBandName || active.edgeBandCode ? (
                    <p className="prod-labels__card-line">
                      <strong>Canto:</strong> {active.edgeBandName || active.edgeBandCode}
                      {active.edgeBandThicknessMm ? ` (${active.edgeBandThicknessMm} mm)` : ''}
                    </p>
                  ) : null}
                  {pieceLabelEdgeSides(active) ? (
                    <p className="prod-labels__card-edge">
                      Encintado: {pieceLabelEdgeSides(active)}
                    </p>
                  ) : null}

                  {printer.preset === '100x150' ? (
                    <div className="prod-labels__diagram-box" data-testid="prod-labels-diagram">
                      <div className="prod-labels__diagram-dim prod-labels__diagram-dim--top">
                        L1: {active.lengthMm} mm {active.L1 ? '●' : ''}
                      </div>
                      <div className="prod-labels__diagram-middle">
                        <div className="prod-labels__diagram-dim prod-labels__diagram-dim--left">
                          W1 {active.W1 ? '●' : ''}
                        </div>
                        <div
                          className={`prod-labels__diagram-rect${
                            active.L1 ? ' prod-labels__diagram-rect--l1' : ''
                          }${active.L2 ? ' prod-labels__diagram-rect--l2' : ''}${
                            active.W1 ? ' prod-labels__diagram-rect--w1' : ''
                          }${active.W2 ? ' prod-labels__diagram-rect--w2' : ''}`}
                        >
                          <span className="prod-labels__diagram-grain">
                            {active.grain === 1 ? 'Veta ↗ Longitudinal' : 'Sin veta fija'}
                          </span>
                        </div>
                        <div className="prod-labels__diagram-dim prod-labels__diagram-dim--right">
                          W2 {active.W2 ? '●' : ''}
                        </div>
                      </div>
                      <div className="prod-labels__diagram-dim prod-labels__diagram-dim--bottom">
                        L2: {active.lengthMm} mm {active.L2 ? '●' : ''}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="prod-labels__card-qr">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="QR de la etiqueta" />
                  ) : (
                    <span className="prod-labels__card-qr-placeholder">
                      QR
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="prod-labels__card-line">Sin resultados.</p>
            )}
          </div>

          <div className="prod-labels__printer">
            <p className="prod-labels__printer-title">
              <Printer size={16} strokeWidth={1.5} aria-hidden />
              Impresora térmica
            </p>
            <label className="prod-labels__filter">
              <span className="prod-labels__filter-label">Tamaño</span>
              <select
                className="prod-modulos__floor-select"
                value={printer.preset}
                onChange={(e) =>
                  setPrinter((p) => ({
                    ...p,
                    preset: e.target.value as ZplSizePreset,
                  }))
                }
                data-testid="prod-labels-preset"
              >
                <option value="100x50">100 × 50 mm</option>
                <option value="100x150">100 × 150 mm</option>
                <option value="50x25">50 × 25 mm</option>
              </select>
            </label>
            <label className="prod-labels__filter">
              <span className="prod-labels__filter-label">Resolución</span>
              <select
                className="prod-modulos__floor-select"
                value={printer.dpi}
                onChange={(e) =>
                  setPrinter((p) => ({
                    ...p,
                    dpi: Number(e.target.value) as ZplDpi,
                  }))
                }
                data-testid="prod-labels-dpi"
              >
                <option value={203}>203 DPI</option>
                <option value={300}>300 DPI</option>
              </select>
            </label>
            <label className="prod-labels__check">
              <input
                type="checkbox"
                checked={printer.includeBorder}
                onChange={(e) =>
                  setPrinter((p) => ({ ...p, includeBorder: e.target.checked }))
                }
                data-testid="prod-labels-border"
              />
              <span>Borde en la etiqueta</span>
            </label>
            {printRaw ? (
              <label className="prod-labels__filter">
                <span className="prod-labels__filter-label">
                  Impresora (nombre)
                </span>
                <input
                  type="text"
                  className="prod-modulos__floor-select prod-labels__printer-input"
                  value={printer.printerName ?? ''}
                  onChange={(e) =>
                    setPrinter((p) => ({ ...p, printerName: e.target.value }))
                  }
                  placeholder="Zebra-GK420"
                  data-testid="prod-labels-printer-name"
                />
              </label>
            ) : null}
            <p className="prod-labels__printer-hint">
              {printRaw
                ? 'Imprimí directo a la Zebra (raw). En navegador, descargá el .zpl y enviálo con el driver en modo raw.'
                : 'Para imprimir directo a la Zebra usá la app de escritorio. En navegador, descargá el .zpl y enviálo con el driver en modo raw (o Zebra Browser Print) — no lo imprimas como documento.'}
            </p>
          </div>

          {printFeedback ? (
            <p
              className={
                printFeedback.ok
                  ? 'prod-modulos__footnote'
                  : 'catalog-form__error'
              }
              role={printFeedback.ok ? 'status' : 'alert'}
              data-testid="prod-labels-print-feedback"
            >
              {printFeedback.message}
            </p>
          ) : null}

          <div className="prod-labels__actions">
            {printRaw ? (
              <button
                type="button"
                className="btn"
                disabled={
                  printLabels.length === 0 || !(printer.printerName ?? '').trim()
                }
                onClick={() => {
                  void handlePrintRaw();
                }}
                data-testid="prod-labels-print-raw"
              >
                <Printer size={16} strokeWidth={1.5} aria-hidden />
                Imprimir en {(printer.printerName || 'Zebra').trim()}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              disabled={exportBusy || printLabels.length === 0}
              onClick={handleDownloadZpl}
              data-testid="prod-labels-download-zpl"
            >
              <Tags size={16} strokeWidth={1.5} aria-hidden />
              Descargar .zpl ({printLabels.length})
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                exportBusy || filtered.length === 0 || !onExportPdf
              }
              onClick={() => {
                if (onExportPdf) void onExportPdf(filtered, perUnit);
              }}
              data-testid="prod-labels-download-pdf"
            >
              <FileDown size={16} strokeWidth={1.5} aria-hidden />
              {exportBusy ? 'Generando…' : 'Descargar PDF (oficina)'}
            </button>
          </div>
        </section>

        <section className="prod-labels__list-col" aria-label="Listado de etiquetas">
          {printLabels.length === 0 ? (
            <p className="prod-hub__placeholder-body">
              Ninguna etiqueta coincide con los filtros.
            </p>
          ) : (
            <div className="prod-modulos__table-wrap">
              <table className="prod-modulos__table">
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Pieza</th>
                    <th scope="col">Módulo</th>
                    <th scope="col">L × A</th>
                    <th scope="col">Material</th>
                    <th scope="col">Cantos</th>
                  </tr>
                </thead>
                <tbody>
                  {printLabels.map((l, idx) => (
                    <tr
                      key={`${l.moduleCode}-${l.partCode ?? l.description}-${idx}`}
                      className={
                        idx === Math.min(activeIdx, printLabels.length - 1)
                          ? 'prod-labels__row--active'
                          : undefined
                      }
                      onClick={() => setActiveIdx(idx)}
                      data-testid={`prod-labels-row-${idx}`}
                    >
                      <td>
                        <code className="prod-modulos__code">
                          {l.partCode || '—'}
                        </code>
                      </td>
                      <td>{l.description}</td>
                      <td>{l.moduleCode}</td>
                      <td>
                        {l.lengthMm}×{l.widthMm}
                      </td>
                      <td>{l.materialName}</td>
                      <td>{pieceLabelEdgeSides(l) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="prod-modulos__footnote">
            Elegí una fila para ver su preview. El QR es el mismo en PDF y ZPL
            {revision ? ` · OP rev. ${revision}` : ''}.
          </p>
        </section>
      </div>
    </div>
  );
}
