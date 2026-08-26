/**
 * Thermal printer configuration section for piece and module labels.
 */

import type { ReactNode } from 'react';
import { Printer } from 'lucide-react';
import type { ZplDpi, ZplSizePreset } from '@granete/domain';
import type { LabelPrinterSettings } from '../labelPrinterSettings';

export interface LabelPrinterConfigSectionProps {
  readonly printer: LabelPrinterSettings;
  readonly onPrinterChange: (
    updater: (prev: LabelPrinterSettings) => LabelPrinterSettings,
  ) => void;
  readonly availablePresets?: readonly ZplSizePreset[];
  readonly presetTestId?: string;
  readonly dpiTestId?: string;
  readonly borderTestId?: string;
  readonly qrFormatTestId?: string;
  readonly qrHostTestId?: string;
  readonly printerNameTestId?: string;
  readonly title?: string;
  readonly hasRawPrint?: boolean;
}

const DEFAULT_PRESETS: readonly ZplSizePreset[] = [
  '100x50',
  '100x150',
  '50x25',
];

export function LabelPrinterConfigSection({
  printer,
  onPrinterChange,
  availablePresets = DEFAULT_PRESETS,
  presetTestId = 'prod-labels-preset',
  dpiTestId = 'prod-labels-dpi',
  borderTestId = 'prod-labels-border',
  qrFormatTestId = 'prod-labels-qr-format',
  qrHostTestId = 'prod-labels-qr-host',
  printerNameTestId = 'prod-labels-printer-name',
  title = 'Impresora térmica',
  hasRawPrint = false,
}: LabelPrinterConfigSectionProps): ReactNode {
  return (
    <div className="prod-labels__printer">
      <p className="prod-labels__printer-title">
        <Printer size={16} strokeWidth={1.5} aria-hidden />
        {title}
      </p>
      <label className="prod-labels__filter">
        <span className="prod-labels__filter-label">Tamaño</span>
        <select
          className="prod-modulos__floor-select"
          value={printer.preset}
          onChange={(e) =>
            onPrinterChange((p) => ({
              ...p,
              preset: e.target.value as ZplSizePreset,
            }))
          }
          data-testid={presetTestId}
        >
          {availablePresets.includes('100x150') && (
            <option value="100x150">
              100 × 150 mm
              {availablePresets.length === 2 ? ' (Recomendado)' : ''}
            </option>
          )}
          {availablePresets.includes('100x50') && (
            <option value="100x50">100 × 50 mm</option>
          )}
          {availablePresets.includes('50x25') && (
            <option value="50x25">50 × 25 mm</option>
          )}
        </select>
      </label>
      <label className="prod-labels__filter">
        <span className="prod-labels__filter-label">Resolución</span>
        <select
          className="prod-modulos__floor-select"
          value={printer.dpi}
          onChange={(e) =>
            onPrinterChange((p) => ({
              ...p,
              dpi: Number(e.target.value) as ZplDpi,
            }))
          }
          data-testid={dpiTestId}
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
            onPrinterChange((p) => ({
              ...p,
              includeBorder: e.target.checked,
            }))
          }
          data-testid={borderTestId}
        />
        <span>Borde en la etiqueta</span>
      </label>
      <label className="prod-labels__filter">
        <span className="prod-labels__filter-label">QR</span>
        <select
          className="prod-modulos__floor-select"
          value={printer.qrFormat ?? 'json'}
          onChange={(e) =>
            onPrinterChange((p) => ({
              ...p,
              qrFormat: e.target.value as 'json' | 'url',
            }))
          }
          data-testid={qrFormatTestId}
        >
          <option value="json">JSON (offline, recomendado)</option>
          <option value="url">Deep link (abre la app móvil)</option>
        </select>
      </label>
      {printer.qrFormat === 'url' ? (
        <label className="prod-labels__filter">
          <span className="prod-labels__filter-label">Dominio del link</span>
          <input
            type="text"
            className="prod-modulos__floor-select"
            value={printer.qrHost ?? ''}
            onChange={(e) =>
              onPrinterChange((p) => ({ ...p, qrHost: e.target.value }))
            }
            placeholder="taller.tudominio.com (vacío = muebles://)"
            data-testid={qrHostTestId}
          />
        </label>
      ) : null}
      {hasRawPrint ? (
        <label className="prod-labels__filter">
          <span className="prod-labels__filter-label">Impresora (nombre)</span>
          <input
            type="text"
            className="prod-modulos__floor-select prod-labels__printer-input"
            value={printer.printerName ?? ''}
            onChange={(e) =>
              onPrinterChange((p) => ({ ...p, printerName: e.target.value }))
            }
            placeholder="Zebra-GK420"
            data-testid={printerNameTestId}
          />
        </label>
      ) : null}
      <p className="prod-labels__printer-hint">
        {hasRawPrint
          ? 'Imprimí directo a la Zebra (raw). En navegador, descargá el .zpl y enviálo con el driver en modo raw.'
          : 'Para imprimir directo a la Zebra usá la app de escritorio. En navegador, descargá el .zpl y enviálo con el driver en modo raw (o Zebra Browser Print) — no lo imprimas como documento.'}
      </p>
    </div>
  );
}
