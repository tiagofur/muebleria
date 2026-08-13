/**
 * Modal dialog for pre-viewing, configuring, and exporting Zebra ZPL thermal labels (F071).
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { PieceLabel, ZplDpi, ZplSizePreset } from '@muebles/domain';
import {
  dotsPerMm,
  pieceBatchToZpl,
  pieceLabelQrPayload,
  pieceToZpl,
  ZPL_SIZE_PRESETS,
} from '@muebles/domain';
import { ChevronLeft, ChevronRight, Download, Printer, QrCode, X } from 'lucide-react';
import './zplLabelPreviewModal.css';

export interface ZplLabelPreviewModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly labels: readonly PieceLabel[];
  readonly projectName?: string;
  readonly onDownloadZpl?: (zplContent: string, filename: string) => void;
  readonly onPrintZpl?: (zplContent: string) => void;
}

export function ZplLabelPreviewModal({
  isOpen,
  onClose,
  labels,
  projectName = 'Proyecto',
  onDownloadZpl,
  onPrintZpl,
}: ZplLabelPreviewModalProps): ReactNode {
  const [preset, setPreset] = useState<ZplSizePreset>('100x50');
  const [dpi, setDpi] = useState<ZplDpi>(203);
  const [includeBorder, setIncludeBorder] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showZplCode, setShowZplCode] = useState(false);

  const currentLabel = labels[activeIdx] ?? labels[0];
  const sizeDims = ZPL_SIZE_PRESETS[preset];

  const currentZpl = useMemo(() => {
    if (!currentLabel) return '';
    return pieceToZpl(currentLabel, preset, { dpi, includeBorder, projectId: projectName });
  }, [currentLabel, preset, dpi, includeBorder, projectName]);

  const batchZpl = useMemo(() => {
    if (labels.length === 0) return '';
    return pieceBatchToZpl(labels, preset, { dpi, includeBorder, projectId: projectName });
  }, [labels, preset, dpi, includeBorder, projectName]);

  if (!isOpen || labels.length === 0 || !currentLabel) {
    return null;
  }

  const qrPayload = pieceLabelQrPayload({
    projectId: projectName,
    moduleCode: currentLabel.moduleCode,
    partCode: currentLabel.partCode,
    description: currentLabel.description,
    materialCode: currentLabel.materialCode,
    lengthMm: currentLabel.lengthMm,
    widthMm: currentLabel.widthMm,
  });

  const handleDownload = () => {
    const filename = `etiquetas_${projectName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${preset}.zpl`;
    if (onDownloadZpl) {
      onDownloadZpl(batchZpl, filename);
    } else {
      const blob = new Blob([batchZpl], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const handlePrint = () => {
    if (onPrintZpl) {
      onPrintZpl(batchZpl);
    } else {
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<pre style="font-family:monospace;white-space:pre-wrap;">${batchZpl}</pre>`);
        win.document.close();
        win.print();
      }
    }
  };

  return (
    <div className="zpl-modal-overlay" data-testid="zpl-modal-overlay">
      <div className="zpl-modal" role="dialog" aria-modal="true" aria-labelledby="zpl-modal-title">
        <header className="zpl-modal__header">
          <h3 id="zpl-modal-title" className="zpl-modal__title">
            Etiquetas ZPL para Impresoras Térmicas (Zebra)
          </h3>
          <button
            type="button"
            className="zpl-modal__close-btn"
            onClick={onClose}
            aria-label="Cerrar modal"
            data-testid="zpl-modal-close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="zpl-modal__body">
          {/* Controls Bar */}
          <div className="zpl-modal__controls">
            <label className="zpl-modal__field">
              <span>Tamaño de etiqueta</span>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as ZplSizePreset)}
                data-testid="zpl-preset-select"
              >
                <option value="100x50">100 × 50 mm (Estándar)</option>
                <option value="100x150">100 × 150 mm (Grande / Palet)</option>
                <option value="50x25">50 × 25 mm (Compacta)</option>
              </select>
            </label>

            <label className="zpl-modal__field">
              <span>Resolución (DPI)</span>
              <select
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value) as ZplDpi)}
                data-testid="zpl-dpi-select"
              >
                <option value={203}>203 DPI (8 dots/mm - Estándar)</option>
                <option value={300}>300 DPI (11.8 dots/mm - Alta res.)</option>
              </select>
            </label>

            <label className="zpl-modal__checkbox">
              <input
                type="checkbox"
                checked={includeBorder}
                onChange={(e) => setIncludeBorder(e.target.checked)}
                data-testid="zpl-border-checkbox"
              />
              <span>Incluir borde exterior</span>
            </label>

            <button
              type="button"
              className="zpl-modal__toggle-code"
              onClick={() => setShowZplCode(!showZplCode)}
              data-testid="zpl-toggle-code"
            >
              {showZplCode ? 'Ver preview visual' : 'Ver código ZPL raw'}
            </button>
          </div>

          {/* Visual Preview / Code Section */}
          {showZplCode ? (
            <div className="zpl-modal__code-view" data-testid="zpl-code-view">
              <pre className="zpl-modal__code">{currentZpl}</pre>
            </div>
          ) : (
            <div className="zpl-modal__preview-area" data-testid="zpl-preview-area">
              <div
                className={`zpl-card zpl-card--${preset}`}
                style={{
                  aspectRatio: `${sizeDims.widthMm} / ${sizeDims.heightMm}`,
                  border: includeBorder ? '2px solid #1e293b' : '1px dashed #cbd5e1',
                }}
                data-testid="zpl-visual-card"
              >
                <div className="zpl-card__main">
                  <div className="zpl-card__header">
                    <span className="zpl-card__part-code">
                      {currentLabel.partCode || 'PZA'}
                    </span>
                    <span className="zpl-card__desc">{currentLabel.description}</span>
                  </div>
                  <div className="zpl-card__module">
                    Mod: {currentLabel.moduleCode} — {currentLabel.moduleName}
                  </div>
                  <div className="zpl-card__dims">
                    Medida: <strong>{currentLabel.lengthMm} × {currentLabel.widthMm} mm</strong> | Cant: {currentLabel.quantity}
                  </div>
                  <div className="zpl-card__mat">
                    Material: {currentLabel.materialName} ({currentLabel.materialCode})
                  </div>
                  <div className="zpl-card__edge">
                    Encintado: {currentLabel.edgeBandingInstruction}
                  </div>
                </div>

                <div className="zpl-card__qr-box">
                  <QrCode size={preset === '50x25' ? 24 : preset === '100x150' ? 64 : 44} />
                  <span className="zpl-card__qr-sub">QR ZPL</span>
                </div>
              </div>
            </div>
          )}

          {/* Pagination */}
          <div className="zpl-modal__pagination">
            <button
              type="button"
              className="zpl-modal__pag-btn"
              disabled={activeIdx === 0}
              onClick={() => setActiveIdx((prev) => Math.max(0, prev - 1))}
              data-testid="zpl-prev-btn"
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            <span className="zpl-modal__pag-info" data-testid="zpl-pag-info">
              Pieza {activeIdx + 1} de {labels.length}
            </span>
            <button
              type="button"
              className="zpl-modal__pag-btn"
              disabled={activeIdx >= labels.length - 1}
              onClick={() => setActiveIdx((prev) => Math.min(labels.length - 1, prev + 1))}
              data-testid="zpl-next-btn"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <footer className="zpl-modal__footer">
          <span className="zpl-modal__total-count">
            Total: {labels.length} etiquetas ({preset} mm @ {dpi} DPI)
          </span>

          <div className="zpl-modal__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={handlePrint}
              data-testid="zpl-print-btn"
            >
              <Printer size={16} /> Imprimir ZPL
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleDownload}
              data-testid="zpl-download-btn"
            >
              <Download size={16} /> Descargar .ZPL ({labels.length})
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
