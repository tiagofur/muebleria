/**
 * ZPL (Zebra Programming Language) label writer for workshop thermal printers (F071).
 *
 * Pure domain logic. Generates ZPL II commands for individual piece labels or batch print jobs.
 * Supports 3 common size presets (100x50 mm, 100x150 mm, 50x25 mm) and native
 * ZPL QR code rendering (^BQ).
 */

import { pieceLabelQrPayload } from './pieceLabelQr';
import type { PieceLabel } from './types';
import { ValidationError } from './errors';

export type ZplSizePreset = '100x50' | '100x150' | '50x25';
export type ZplDpi = 203 | 300;

export interface ZplExportOptions {
  readonly preset?: ZplSizePreset;
  readonly dpi?: ZplDpi;
  readonly includeBorder?: boolean;
  readonly projectId?: string;
  /** Production order revision — printed into the QR payload (v2). */
  readonly revision?: string;
}

export interface ZplSizeDimensions {
  readonly widthMm: number;
  readonly heightMm: number;
}

export const ZPL_SIZE_PRESETS: Record<ZplSizePreset, ZplSizeDimensions> = {
  '100x50': { widthMm: 100, heightMm: 50 },
  '100x150': { widthMm: 100, heightMm: 150 },
  '50x25': { widthMm: 50, heightMm: 25 },
};

/** Sanitize field data for ZPL string rendering. */
export function sanitizeZplText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\^/g, ' ')
    .replace(/~/g, ' ')
    .replace(/_/g, '-');
}

/** Compute dots per millimeter for given DPI. */
export function dotsPerMm(dpi: ZplDpi): number {
  return dpi === 300 ? 11.81 : 8.0;
}

/** "L1+W2" shorthand for the edge-banded sides of a label. */
export function pieceLabelEdgeSides(label: PieceLabel): string {
  const sides = [
    label.L1 ? 'L1' : null,
    label.L2 ? 'L2' : null,
    label.W1 ? 'W1' : null,
    label.W2 ? 'W2' : null,
  ].filter(Boolean);
  return sides.length > 0 ? sides.join('+') : '';
}

/**
 * Generate ZPL II format string for a single piece label.
 */
export function pieceToZpl(
  label: PieceLabel,
  preset: ZplSizePreset = '100x50',
  options: ZplExportOptions = {},
): string {
  const dpi = options.dpi ?? 203;
  const dpmm = dotsPerMm(dpi);
  const dims = ZPL_SIZE_PRESETS[preset] ?? ZPL_SIZE_PRESETS['100x50'];
  const widthDots = Math.round(dims.widthMm * dpmm);
  const heightDots = Math.round(dims.heightMm * dpmm);

  const title = sanitizeZplText(
    label.partCode ? `${label.partCode} - ${label.description}` : label.description,
  );
  const moduleStr = sanitizeZplText(`Mod: ${label.moduleCode} - ${label.moduleName}`);
  const dimsStr = sanitizeZplText(
    `Medida: ${label.lengthMm}x${label.widthMm} mm | Cant: ${label.quantity}`,
  );
  const matStr = sanitizeZplText(`Material: ${label.materialName} (${label.materialCode})`);
  const edgeStr = sanitizeZplText(`Encintado: ${label.edgeBandingInstruction}`);

  const qrPayload = pieceLabelQrPayload({
    projectId: options.projectId ?? 'PROJ',
    moduleCode: label.moduleCode,
    partCode: label.partCode,
    description: label.description,
    materialCode: label.materialCode,
    lengthMm: label.lengthMm,
    widthMm: label.widthMm,
    quantity: label.quantity,
    edgeSides: pieceLabelEdgeSides(label),
    edgeCode: label.edgeBandCode,
    revision: options.revision,
  });

  const lines: string[] = [];
  lines.push('^XA');
  lines.push(`^PW${widthDots}`);
  lines.push(`^LL${heightDots}`);
  lines.push('^CI28'); // UTF-8 character encoding

  if (options.includeBorder !== false) {
    const borderMargin = Math.round(2 * dpmm);
    const borderW = widthDots - borderMargin * 2;
    const borderH = heightDots - borderMargin * 2;
    lines.push(`^FO${borderMargin},${borderMargin}^GB${borderW},${borderH},2^FS`);
  }

  if (preset === '50x25') {
    // Compact 50x25 mm label
    const fTitle = Math.round(3.5 * dpmm);
    const fBody = Math.round(2.8 * dpmm);
    const marginX = Math.round(4 * dpmm);
    const qrSize = Math.round(16 * dpmm);
    const qrMag = dpi === 300 ? 3 : 2;

    lines.push(`^FO${marginX},${Math.round(3 * dpmm)}^A0N,${fTitle},${fTitle}^FD${title}^FS`);
    lines.push(`^FO${marginX},${Math.round(8 * dpmm)}^A0N,${fBody},${fBody}^FD${dimsStr}^FS`);
    lines.push(`^FO${marginX},${Math.round(12 * dpmm)}^A0N,${fBody},${fBody}^FD${matStr}^FS`);
    lines.push(`^FO${marginX},${Math.round(16 * dpmm)}^A0N,${fBody},${fBody}^FD${edgeStr}^FS`);

    const qrX = widthDots - marginX - qrSize;
    lines.push(`^FO${qrX},${Math.round(4 * dpmm)}^BQN,2,${qrMag}^FDMM,A${qrPayload}^FS`);
  } else if (preset === '100x150') {
    // Large 100x150 mm label
    const fTitle = Math.round(7 * dpmm);
    const fSub = Math.round(5 * dpmm);
    const fBody = Math.round(4.5 * dpmm);
    const marginX = Math.round(6 * dpmm);
    const qrMag = dpi === 300 ? 5 : 4;

    let y = Math.round(8 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fTitle},${fTitle}^FD${title}^FS`);
    y += Math.round(12 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fSub},${fSub}^FD${moduleStr}^FS`);
    y += Math.round(10 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fBody},${fBody}^FD${dimsStr}^FS`);
    y += Math.round(9 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fBody},${fBody}^FD${matStr}^FS`);
    y += Math.round(9 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fBody},${fBody}^FD${edgeStr}^FS`);

    y += Math.round(12 * dpmm);
    lines.push(`^FO${marginX},${y}^BQN,2,${qrMag}^FDMM,A${qrPayload}^FS`);
  } else {
    // Standard 100x50 mm label
    const fTitle = Math.round(5 * dpmm);
    const fSub = Math.round(3.8 * dpmm);
    const fBody = Math.round(3.5 * dpmm);
    const marginX = Math.round(5 * dpmm);
    const qrMag = dpi === 300 ? 4 : 3;

    lines.push(`^FO${marginX},${Math.round(5 * dpmm)}^A0N,${fTitle},${fTitle}^FD${title}^FS`);
    lines.push(`^FO${marginX},${Math.round(12 * dpmm)}^A0N,${fSub},${fSub}^FD${moduleStr}^FS`);
    lines.push(`^FO${marginX},${Math.round(18 * dpmm)}^A0N,${fBody},${fBody}^FD${dimsStr}^FS`);
    lines.push(`^FO${marginX},${Math.round(24 * dpmm)}^A0N,${fBody},${fBody}^FD${matStr}^FS`);
    lines.push(`^FO${marginX},${Math.round(30 * dpmm)}^A0N,${fBody},${fBody}^FD${edgeStr}^FS`);

    const qrSize = Math.round(30 * dpmm);
    const qrX = widthDots - marginX - qrSize;
    lines.push(`^FO${qrX},${Math.round(8 * dpmm)}^BQN,2,${qrMag}^FDMM,A${qrPayload}^FS`);
  }

  lines.push('^XZ');
  return lines.join('\n');
}

/**
 * Generate ZPL II format string for a batch of piece labels.
 */
export function pieceBatchToZpl(
  labels: readonly PieceLabel[],
  preset: ZplSizePreset = '100x50',
  options: ZplExportOptions = {},
): string {
  if (labels.length === 0) {
    throw new ValidationError('no hay piezas para generar etiquetas ZPL', {
      field: 'labels',
    });
  }
  return labels.map((l) => pieceToZpl(l, preset, options)).join('\n');
}
