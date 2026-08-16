/**
 * ZPL (Zebra Programming Language) label writer for workshop thermal printers (F071).
 *
 * Pure domain logic. Generates ZPL II commands for individual piece labels or batch print jobs.
 * Supports 3 common size presets (100x50 mm, 100x150 mm, 50x25 mm) and native
 * ZPL QR code rendering (^BQ).
 */

import { pieceLabelQrPayload, pieceLabelQrPayloadUrl } from './pieceLabelQr';
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
  /**
   * QR form (F091 / D7): 'json' (default) or 'url' deep link wrapping the
   * same JSON. qrHost switches the URL form to https://<host>/scan#…
   */
  readonly qrFormat?: 'json' | 'url';
  readonly qrHost?: string;
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

  const labelQrFields = {
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
  };
  const qrPayload = options.qrFormat === 'url'
    ? pieceLabelQrPayloadUrl(labelQrFields, { host: options.qrHost })
    : pieceLabelQrPayload(labelQrFields);

  const lines: string[] = [];
  lines.push('^XA');
  lines.push(`^PW${widthDots}`);
  lines.push(`^LL${heightDots}`);
  lines.push('^CI28'); // UTF-8 character encoding

  if (options.includeBorder !== false) {
    const borderMargin = Math.round(2 * dpmm);
    const borderW = widthDots - borderMargin * 2;
    const borderH = heightDots - borderMargin * 2;
    // Base frame border
    lines.push(`^FO${borderMargin},${borderMargin}^GB${borderW},${borderH},1^FS`);

    // Edge banding indicator bars (L1=Top, L2=Bottom, W1=Left, W2=Right)
    const edgeBarThick = Math.max(3, Math.round(1.0 * dpmm));
    if (label.L1) {
      // Top edge
      lines.push(`^FO${borderMargin},${borderMargin}^GB${borderW},${edgeBarThick},${edgeBarThick}^FS`);
    }
    if (label.L2) {
      // Bottom edge
      const yBottom = borderMargin + borderH - edgeBarThick;
      lines.push(`^FO${borderMargin},${yBottom}^GB${borderW},${edgeBarThick},${edgeBarThick}^FS`);
    }
    if (label.W1) {
      // Left edge
      lines.push(`^FO${borderMargin},${borderMargin}^GB${edgeBarThick},${borderH},${edgeBarThick}^FS`);
    }
    if (label.W2) {
      // Right edge
      const xRight = borderMargin + borderW - edgeBarThick;
      lines.push(`^FO${xRight},${borderMargin}^GB${edgeBarThick},${borderH},${edgeBarThick}^FS`);
    }
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
    // Large 100x150 mm label — Rich Industrial Workshop Format
    const fTitle = Math.round(6 * dpmm);
    const fSub = Math.round(4.5 * dpmm);
    const fBody = Math.round(3.8 * dpmm);
    const fDetail = Math.round(3.2 * dpmm);
    const marginX = Math.round(7 * dpmm);

    // Header section
    let y = Math.round(8 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fTitle},${fTitle}^FD${title}^FS`);
    y += Math.round(9 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fSub},${fSub}^FD${moduleStr}^FS`);
    y += Math.round(8 * dpmm);
    const thickStr = label.thicknessMm ? ` | Esp: ${label.thicknessMm} mm` : '';
    lines.push(`^FO${marginX},${y}^A0N,${fBody},${fBody}^FD${dimsStr}${thickStr}^FS`);
    y += Math.round(7 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fDetail},${fDetail}^FD${matStr}^FS`);
    y += Math.round(6 * dpmm);
    lines.push(`^FO${marginX},${y}^A0N,${fDetail},${fDetail}^FD${edgeStr}^FS`);

    // Divider
    y += Math.round(8 * dpmm);
    const contentW = widthDots - marginX * 2;
    lines.push(`^FO${marginX},${y}^GB${contentW},2,2^FS`);

    // Graphical Piece Diagram (Schematic Representation)
    y += Math.round(6 * dpmm);
    const diagX = marginX + Math.round(4 * dpmm);
    const diagW = Math.round(45 * dpmm);
    const diagH = Math.round(32 * dpmm);

    // Outer piece rectangle box
    lines.push(`^FO${diagX},${y}^GB${diagW},${diagH},2^FS`);

    // Edge banding indicator on the schematic diagram
    const barW = Math.round(1.5 * dpmm);
    if (label.L1) {
      // Top (L1)
      lines.push(`^FO${diagX},${y}^GB${diagW},${barW},${barW}^FS`);
    }
    if (label.L2) {
      // Bottom (L2)
      lines.push(`^FO${diagX},${y + diagH - barW}^GB${diagW},${barW},${barW}^FS`);
    }
    if (label.W1) {
      // Left (W1)
      lines.push(`^FO${diagX},${y}^GB${barW},${diagH},${barW}^FS`);
    }
    if (label.W2) {
      // Right (W2)
      lines.push(`^FO${diagX + diagW - barW},${y}^GB${barW},${diagH},${barW}^FS`);
    }

    // Dimension labels & side names around diagram
    lines.push(`^FO${diagX},${y - Math.round(4.5 * dpmm)}^A0N,${Math.round(2.6 * dpmm)},${Math.round(2.6 * dpmm)}^FDL1: ${label.lengthMm} mm${label.L1 ? ' [CANTO]' : ''}^FS`);
    lines.push(`^FO${diagX},${y + diagH + Math.round(1.5 * dpmm)}^A0N,${Math.round(2.6 * dpmm)},${Math.round(2.6 * dpmm)}^FDL2: ${label.lengthMm} mm${label.L2 ? ' [CANTO]' : ''}^FS`);

    // Grain direction inside diagram
    const grainText = label.grain === 1 ? 'VETA: LONGITUDINAL (L)' : 'VETA: SIN DIRECCION';
    lines.push(`^FO${diagX + Math.round(4 * dpmm)},${y + Math.round(14 * dpmm)}^A0N,${Math.round(2.8 * dpmm)},${Math.round(2.8 * dpmm)}^FD${grainText}^FS`);

    // Right-side info block alongside diagram
    const sideInfoX = diagX + diagW + Math.round(6 * dpmm);
    const sideInfoW = widthDots - sideInfoX - marginX;
    let infoY = y;
    lines.push(`^FO${sideInfoX},${infoY}^A0N,${Math.round(2.6 * dpmm)},${Math.round(2.6 * dpmm)}^FDW1 (Izq): ${label.widthMm} mm${label.W1 ? ' [C]' : ''}^FS`);
    infoY += Math.round(5 * dpmm);
    lines.push(`^FO${sideInfoX},${infoY}^A0N,${Math.round(2.6 * dpmm)},${Math.round(2.6 * dpmm)}^FDW2 (Der): ${label.widthMm} mm${label.W2 ? ' [C]' : ''}^FS`);
    infoY += Math.round(6 * dpmm);
    if (label.edgeBandName) {
      lines.push(`^FO${sideInfoX},${infoY}^A0N,${Math.round(2.5 * dpmm)},${Math.round(2.5 * dpmm)}^FDCanto: ${sanitizeZplText(label.edgeBandName)}^FS`);
    }

    // Lower section: QR Code + Barcode footer
    y += diagH + Math.round(10 * dpmm);
    lines.push(`^FO${marginX},${y}^GB${contentW},2,2^FS`);
    y += Math.round(6 * dpmm);

    const qrMag = dpi === 300 ? 5 : 4;
    lines.push(`^FO${marginX + Math.round(6 * dpmm)},${y}^BQN,2,${qrMag}^FDMM,A${qrPayload}^FS`);

    const scanHintX = marginX + Math.round(40 * dpmm);
    lines.push(`^FO${scanHintX},${y + Math.round(4 * dpmm)}^A0N,${Math.round(4 * dpmm)},${Math.round(4 * dpmm)}^FDESCANEO CNC / PISO^FS`);
    lines.push(`^FO${scanHintX},${y + Math.round(12 * dpmm)}^A0N,${Math.round(3.2 * dpmm)},${Math.round(3.2 * dpmm)}^FD${sanitizeZplText(label.partCode || '')}^FS`);
    lines.push(`^FO${scanHintX},${y + Math.round(18 * dpmm)}^A0N,${Math.round(2.8 * dpmm)},${Math.round(2.8 * dpmm)}^FD${sanitizeZplText(label.moduleCode)}^FS`);
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
