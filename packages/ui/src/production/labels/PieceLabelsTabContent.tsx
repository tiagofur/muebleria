/**
 * Piece labels tab content with live QR preview, diagram, filters, and thermal printer controls.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { FileDown, Printer, Search, Tags } from 'lucide-react';
import type { PieceLabel, Project } from '@muebles/domain';
import {
  pieceBatchToZpl,
  pieceLabelEdgeSides,
  pieceLabelQrPayload,
  pieceLabelQrPayloadUrl,
  ZPL_SIZE_PRESETS,
} from '@muebles/domain';
import type { LabelPrinterSettings } from '../labelPrinterSettings';
import { LabelPrinterConfigSection } from './LabelPrinterConfigSection';

export type PrintRawBridge = (
  printerName: string,
  payload: string,
) => Promise<{ ok: boolean; error?: string }>;

export interface PieceLabelsTabContentProps {
  readonly project: Project;
  readonly labels: readonly PieceLabel[];
  readonly printer: LabelPrinterSettings;
  readonly onPrinterChange: (
    updater: (prev: LabelPrinterSettings) => LabelPrinterSettings,
  ) => void;
  readonly printRaw: PrintRawBridge | null;
  readonly exportBusy: boolean;
  readonly onExportPdf?: (
    labels: readonly PieceLabel[],
    perUnit: boolean,
  ) => void | Promise<void>;
  readonly onDownloadZpl?: (content: string, filename: string) => void;
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'proyecto'
  );
}

function expandPerUnit(labels: readonly PieceLabel[]): PieceLabel[] {
  return labels.flatMap((label) => {
    const copies = Math.max(1, Math.floor(label.quantity));
    return Array.from({ length: copies }, () => ({ ...label, quantity: 1 }));
  });
}

export function PieceLabelsTabContent({
  project,
  labels,
  printer,
  onPrinterChange,
  printRaw,
  exportBusy,
  onExportPdf,
  onDownloadZpl,
}: PieceLabelsTabContentProps): ReactNode {
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [materialFilter, setMaterialFilter] = useState<string>('all');
  const [perUnit, setPerUnit] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [printFeedback, setPrintFeedback] = useState<
    { ok: boolean; message: string } | null
  >(null);

  const moduleOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const l of labels) codes.add(l.moduleCode);
    return [...codes].sort((a, b) => a.localeCompare(b, 'es'));
  }, [labels]);

  const materialOptions = useMemo(() => {
    const names = new Set<string>();
    for (const l of labels) names.add(l.materialName);
    return [...names].sort((a, b) => a.localeCompare(b, 'es'));
  }, [labels]);

  const filtered = useMemo(() => {
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

  const active =
    printLabels[Math.min(activeIdx, Math.max(0, printLabels.length - 1))];
  const revision = project.production?.revision?.toString();
  const dims = ZPL_SIZE_PRESETS[printer.preset];

  // Real QR for Piece Label preview
  useEffect(() => {
    if (!active) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    const payload = (
      printer.qrFormat === 'url' ? pieceLabelQrPayloadUrl : pieceLabelQrPayload
    )(
      {
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
      },
      printer.qrFormat === 'url'
        ? { host: printer.qrHost || undefined }
        : undefined,
    );
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
  }, [active, project.id, revision, printer.qrFormat, printer.qrHost]);

  const handleDownloadZpl = () => {
    if (printLabels.length === 0) return;
    const content = pieceBatchToZpl(printLabels, printer.preset, {
      dpi: printer.dpi,
      includeBorder: printer.includeBorder,
      projectId: project.id,
      revision,
      qrFormat: printer.qrFormat,
      qrHost: printer.qrHost,
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
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintRaw = async () => {
    if (!printRaw) return;
    const targetName = (printer.printerName ?? '').trim();
    if (!targetName) {
      setPrintFeedback({
        ok: false,
        message: 'Configurá el nombre de la impresora térmica primero.',
      });
      return;
    }
    if (printLabels.length === 0) {
      setPrintFeedback({
        ok: false,
        message: 'No hay etiquetas para enviar a la impresora.',
      });
      return;
    }
    setPrintFeedback(null);
    try {
      const zpl = pieceBatchToZpl(printLabels, printer.preset, {
        dpi: printer.dpi,
        includeBorder: printer.includeBorder,
        projectId: project.id,
        revision,
        qrFormat: printer.qrFormat,
        qrHost: printer.qrHost,
      });
      const res = await printRaw(targetName, zpl);
      if (res.ok) {
        setPrintFeedback({
          ok: true,
          message: `Enviadas ${printLabels.length} etiqueta${
            printLabels.length === 1 ? '' : 's'
          } a ${targetName}.`,
        });
      } else {
        setPrintFeedback({
          ok: false,
          message: res.error || `Error al imprimir en ${targetName}.`,
        });
      }
    } catch (err) {
      setPrintFeedback({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'Error al comunicar con la impresora.',
      });
    }
  };

  return (
    <>
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
              perUnit ? 'prod-seg-btn' : 'prod-seg-btn prod-seg-btn--active'
            }
            aria-pressed={!perUnit}
            onClick={() => setPerUnit(false)}
            data-testid="prod-labels-per-piece"
          >
            1 por pieza
          </button>
          <button
            type="button"
            className={
              perUnit ? 'prod-seg-btn prod-seg-btn--active' : 'prod-seg-btn'
            }
            aria-pressed={perUnit}
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
                    <strong>Tablero:</strong> {active.materialName} (
                    {active.materialCode})
                  </p>
                  {active.edgeBandName || active.edgeBandCode ? (
                    <p className="prod-labels__card-line">
                      <strong>Canto:</strong>{' '}
                      {active.edgeBandName || active.edgeBandCode}
                      {active.edgeBandThicknessMm
                        ? ` (${active.edgeBandThicknessMm} mm)`
                        : ''}
                    </p>
                  ) : null}
                  {pieceLabelEdgeSides(active) ? (
                    <p className="prod-labels__card-edge">
                      Encintado: {pieceLabelEdgeSides(active)}
                    </p>
                  ) : null}

                  {printer.preset === '100x150' ? (
                    <div
                      className="prod-labels__diagram-box"
                      data-testid="prod-labels-diagram"
                    >
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
                            {active.grain === 1
                              ? 'Veta ↗ Longitudinal'
                              : 'Sin veta fija'}
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
                    <span className="prod-labels__card-qr-placeholder">QR</span>
                  )}
                </div>
              </>
            ) : (
              <p className="prod-labels__card-line">Sin resultados.</p>
            )}
          </div>

          <LabelPrinterConfigSection
            printer={printer}
            onPrinterChange={onPrinterChange}
            hasRawPrint={Boolean(printRaw)}
          />

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
                  printLabels.length === 0 ||
                  !(printer.printerName ?? '').trim()
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
              disabled={exportBusy || filtered.length === 0 || !onExportPdf}
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

        <section
          className="prod-labels__list-col"
          aria-label="Listado de etiquetas"
        >
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
    </>
  );
}
