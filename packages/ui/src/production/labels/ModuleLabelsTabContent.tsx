/**
 * Module and package labels tab content with live QR preview, search, and thermal printer controls.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { FileDown, Printer, Search, Tags } from 'lucide-react';
import type { ModuleLabel, Project } from '@granete/domain';
import {
  moduleBatchToZpl,
  moduleLabelQrPayload,
  moduleLabelQrPayloadUrl,
  ZPL_SIZE_PRESETS,
} from '@granete/domain';
import type { LabelPrinterSettings } from '../labelPrinterSettings';
import { LabelPrinterConfigSection } from './LabelPrinterConfigSection';
import type { PrintRawBridge } from './PieceLabelsTabContent';

export interface ModuleLabelsTabContentProps {
  readonly project: Project;
  readonly moduleLabels: readonly ModuleLabel[];
  readonly printer: LabelPrinterSettings;
  readonly onPrinterChange: (
    updater: (prev: LabelPrinterSettings) => LabelPrinterSettings,
  ) => void;
  readonly printRaw: PrintRawBridge | null;
  readonly exportBusy: boolean;
  readonly onExportModulePdf?: (
    labels: readonly ModuleLabel[],
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

export function ModuleLabelsTabContent({
  project,
  moduleLabels,
  printer,
  onPrinterChange,
  printRaw,
  exportBusy,
  onExportModulePdf,
  onDownloadZpl,
}: ModuleLabelsTabContentProps): ReactNode {
  const [query, setQuery] = useState('');
  const [activeModIdx, setActiveModIdx] = useState(0);
  const [modQrDataUrl, setModQrDataUrl] = useState<string | null>(null);
  const [printFeedback, setPrintFeedback] = useState<
    { ok: boolean; message: string } | null
  >(null);

  const filteredModuleLabels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return moduleLabels;
    return moduleLabels.filter((m) =>
      [
        m.factoryCode,
        m.moduleCode,
        m.moduleName,
        m.spaceName,
        m.wallName,
        m.customerName,
        `bulto ${m.packageIndex}`,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [moduleLabels, query]);

  const activeMod =
    filteredModuleLabels[
      Math.min(activeModIdx, Math.max(0, filteredModuleLabels.length - 1))
    ];
  const revision = project.production?.revision?.toString();
  const dims = ZPL_SIZE_PRESETS[printer.preset];

  // Real QR for Module Label preview
  useEffect(() => {
    if (!activeMod) {
      setModQrDataUrl(null);
      return;
    }
    let cancelled = false;
    const qrFields = {
      projectId: activeMod.projectId,
      itemId: activeMod.itemId,
      factoryCode: activeMod.factoryCode,
      moduleCode: activeMod.moduleCode,
      moduleName: activeMod.moduleName,
      packageIndex: activeMod.packageIndex,
      totalPackages: activeMod.totalPackages,
      unitIndex: activeMod.unitIndex,
      unitQuantity: activeMod.unitQuantity,
      widthMm: activeMod.widthMm,
      heightMm: activeMod.heightMm,
      depthMm: activeMod.depthMm,
      revision: revision ?? activeMod.revision,
    };
    const payload = (
      printer.qrFormat === 'url'
        ? moduleLabelQrPayloadUrl
        : moduleLabelQrPayload
    )(
      qrFields,
      printer.qrFormat === 'url'
        ? { host: printer.qrHost || undefined }
        : undefined,
    );
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1 })
      .then((url) => {
        if (!cancelled) setModQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setModQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeMod, revision, printer.qrFormat, printer.qrHost]);

  const handleDownloadZpl = () => {
    if (filteredModuleLabels.length === 0) return;
    const content = moduleBatchToZpl(filteredModuleLabels, printer.preset, {
      dpi: printer.dpi,
      includeBorder: printer.includeBorder,
      projectId: project.id,
      revision,
      qrFormat: printer.qrFormat,
      qrHost: printer.qrHost,
    });
    const filename = `etiquetas_muebles_${slugify(project.name)}_${printer.preset}.zpl`;
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
    if (filteredModuleLabels.length === 0) {
      setPrintFeedback({
        ok: false,
        message: 'No hay etiquetas para enviar a la impresora.',
      });
      return;
    }
    setPrintFeedback(null);
    try {
      const zpl = moduleBatchToZpl(filteredModuleLabels, printer.preset, {
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
          message: `Enviadas ${filteredModuleLabels.length} etiqueta${
            filteredModuleLabels.length === 1 ? '' : 's'
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
          <span className="sr-only">Buscar muebles y bultos</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveModIdx(0);
            }}
            placeholder="Buscar código, mueble, bulto, ambiente, muro…"
            data-testid="prod-module-labels-search"
          />
        </label>
        <p
          className="prod-modulos__count"
          data-testid="prod-module-labels-count"
        >
          {filteredModuleLabels.length} bulto
          {filteredModuleLabels.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="prod-labels__grid">
        <section
          className="prod-labels__preview-col"
          aria-label="Preview de etiqueta de mueble y configuración"
        >
          <div
            className={`prod-labels__card prod-labels__card--${printer.preset}`}
            style={{
              aspectRatio: `${dims.widthMm} / ${dims.heightMm}`,
              borderColor: 'var(--color-primary)',
              boxShadow: 'var(--shadow-md)',
            }}
            data-testid="prod-module-labels-preview-card"
          >
            {activeMod ? (
              <>
                <div
                  className="prod-labels__card-main"
                  style={{ gap: '0.35rem' }}
                >
                  <div
                    style={{
                      background: 'var(--color-surface-sunken)',
                      padding: '0.25rem 0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      color: 'var(--color-primary)',
                      display: 'inline-block',
                      alignSelf: 'flex-start',
                    }}
                  >
                    BULTO {activeMod.packageIndex} DE {activeMod.totalPackages}
                  </div>
                  <p
                    className="prod-labels__card-title"
                    style={{ fontSize: '1.05rem', margin: 0 }}
                  >
                    {activeMod.factoryCode} — {activeMod.moduleName}
                  </p>
                  <p
                    className="prod-labels__card-dims"
                    style={{ color: 'var(--color-text-main)', margin: 0 }}
                  >
                    <strong>Medidas:</strong> {activeMod.measuresLabel}
                  </p>
                  <p className="prod-labels__card-line" style={{ margin: 0 }}>
                    <strong>Obra:</strong> {activeMod.projectName}
                    {activeMod.customerName
                      ? ` (${activeMod.customerName})`
                      : ''}
                  </p>
                  <p className="prod-labels__card-line" style={{ margin: 0 }}>
                    <strong>Ubicación:</strong>{' '}
                    {activeMod.spaceName || 'General'}
                    {activeMod.wallName ? ` · ${activeMod.wallName}` : ''}
                  </p>
                  <p
                    className="prod-labels__card-line"
                    style={{ fontSize: '0.75rem', opacity: 0.8, margin: 0 }}
                  >
                    Unidad {activeMod.unitIndex}/{activeMod.unitQuantity} ·{' '}
                    {activeMod.boardPartCount} piezas ·{' '}
                    {activeMod.hardwareCount} herrajes
                  </p>
                </div>
                <div className="prod-labels__card-qr">
                  {modQrDataUrl ? (
                    <img src={modQrDataUrl} alt="QR del bulto" />
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
            availablePresets={['100x150', '100x50']}
            presetTestId="prod-module-labels-preset"
            dpiTestId="prod-module-labels-dpi"
            borderTestId="prod-module-labels-border"
            qrFormatTestId="prod-module-labels-qr-format"
            qrHostTestId="prod-module-labels-qr-host"
            printerNameTestId="prod-module-labels-printer-name"
            title="Impresora térmica de bultos"
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
              data-testid="prod-module-labels-print-feedback"
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
                  filteredModuleLabels.length === 0 ||
                  !(printer.printerName ?? '').trim()
                }
                onClick={() => {
                  void handlePrintRaw();
                }}
                data-testid="prod-module-labels-print-raw"
              >
                <Printer size={16} strokeWidth={1.5} aria-hidden />
                Imprimir en {(printer.printerName || 'Zebra').trim()}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              disabled={exportBusy || filteredModuleLabels.length === 0}
              onClick={handleDownloadZpl}
              data-testid="prod-module-labels-download-zpl"
            >
              <Tags size={16} strokeWidth={1.5} aria-hidden />
              Descargar ZPL Bultos ({filteredModuleLabels.length})
            </button>
            <button
              type="button"
              className="btn"
              disabled={
                exportBusy ||
                filteredModuleLabels.length === 0 ||
                !onExportModulePdf
              }
              onClick={() => {
                if (onExportModulePdf)
                  void onExportModulePdf(filteredModuleLabels);
              }}
              data-testid="prod-module-labels-download-pdf"
            >
              <FileDown size={16} strokeWidth={1.5} aria-hidden />
              {exportBusy ? 'Generando…' : 'Descargar PDF Bultos'}
            </button>
          </div>
        </section>

        <section
          className="prod-labels__list-col"
          aria-label="Listado de bultos y muebles"
        >
          {filteredModuleLabels.length === 0 ? (
            <p className="prod-hub__placeholder-body">
              Ningún bulto coincide con la búsqueda.
            </p>
          ) : (
            <div className="prod-modulos__table-wrap">
              <table className="prod-modulos__table">
                <thead>
                  <tr>
                    <th scope="col">Bulto</th>
                    <th scope="col">Mueble</th>
                    <th scope="col">Medidas</th>
                    <th scope="col">Ambiente / Muro</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModuleLabels.map((m, idx) => (
                    <tr
                      key={`${m.itemId}-${m.packageIndex}-${idx}`}
                      className={
                        idx ===
                        Math.min(activeModIdx, filteredModuleLabels.length - 1)
                          ? 'prod-labels__row--active'
                          : undefined
                      }
                      onClick={() => setActiveModIdx(idx)}
                      data-testid={`prod-module-labels-row-${idx}`}
                    >
                      <td>
                        <strong>
                          {m.packageIndex}/{m.totalPackages}
                        </strong>
                      </td>
                      <td>
                        <code>{m.factoryCode}</code> — {m.moduleName}
                      </td>
                      <td>{m.measuresLabel}</td>
                      <td>
                        {m.spaceName || 'General'}
                        {m.wallName ? ` · ${m.wallName}` : ''}
                      </td>
                      <td>
                        <span className="prod-modulos__status-badge">
                          {m.floorStatus || 'pending'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="prod-modulos__footnote">
            Elegí un bulto para ver su preview de etiqueta adhesiva.
          </p>
        </section>
      </div>
    </>
  );
}
