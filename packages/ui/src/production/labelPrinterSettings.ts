/**
 * Persisted thermal printer settings for piece labels (Etiquetas tab).
 * The shop configures its Zebra once; every session reuses it.
 */

import type { ZplDpi, ZplSizePreset } from '@granete/domain';

export type LabelPrinterSettings = {
  readonly preset: ZplSizePreset;
  readonly dpi: ZplDpi;
  readonly includeBorder: boolean;
  /** Thermal printer name for raw ZPL printing (desktop shell only). */
  readonly printerName?: string;
  /**
   * QR payload format (F091 / D7): 'json' (default — offline-friendly,
   * smaller QR, pre-F091 labels) or 'url' (deep link wrapping the same JSON
   * so the OS camera can open the mobile app).
   */
  readonly qrFormat?: 'json' | 'url';
  /** Domain for the https deep-link form; empty = custom scheme muebles:// */
  readonly qrHost?: string;
};

const LABEL_PRINTER_STORAGE_KEY = 'muebles_label_printer_v1';

export const DEFAULT_LABEL_PRINTER_SETTINGS: LabelPrinterSettings = {
  preset: '100x50',
  dpi: 203,
  includeBorder: true,
  printerName: '',
  qrFormat: 'json',
  qrHost: '',
};

function isZplSizePreset(value: unknown): value is ZplSizePreset {
  return value === '100x50' || value === '100x150' || value === '50x25';
}

export function readLabelPrinterSettings(): LabelPrinterSettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_LABEL_PRINTER_SETTINGS;
    }
    const raw = window.localStorage.getItem(LABEL_PRINTER_STORAGE_KEY);
    if (!raw) return DEFAULT_LABEL_PRINTER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LabelPrinterSettings>;
    return {
      preset: isZplSizePreset(parsed.preset)
        ? parsed.preset
        : DEFAULT_LABEL_PRINTER_SETTINGS.preset,
      dpi: parsed.dpi === 300 ? 300 : 203,
      includeBorder: parsed.includeBorder !== false,
      printerName:
        typeof parsed.printerName === 'string' ? parsed.printerName : '',
      qrFormat: parsed.qrFormat === 'url' ? 'url' : 'json',
      qrHost: typeof parsed.qrHost === 'string' ? parsed.qrHost : '',
    };
  } catch {
    return DEFAULT_LABEL_PRINTER_SETTINGS;
  }
}

export function writeLabelPrinterSettings(settings: LabelPrinterSettings): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      LABEL_PRINTER_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // Ignore storage errors — settings just won't persist.
  }
}
