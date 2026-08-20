/**
 * DXF R12 (ASCII) export of a Cut Plan for CNC nesting workflows (F125).
 *
 * Two variants:
 * - 'sheets': one block per nested board (outline + placed pieces + labels),
 *   laid out in a row — CAM reference of the app's own nesting result.
 * - 'pieces': loose pieces in a grid with labels, no board outlines — for
 *   external nesting software that prefers to nest by itself.
 *
 * Layers: TABLERO (board outline), PIEZA (piece contours), ETIQUETA (labels),
 * VETA (grain direction), PERF (drilling circles), RETAZO (useful remnants).
 * Units are millimeters, Y axis up, origin at each block's bottom-left corner.
 * Drilling holes are projected on the piece plane for non-rotated pieces only
 * (rotated hole mirroring is undefined without a machine-side convention), and
 * only for faces parallel to the piece plane ('front'/'back') — edge-drilled
 * holes (top/bottom/left/right) do not project onto the 2D contour.
 */

import type {
  CutPlan,
  CutPlanPlacedPiece,
  PartDrillingPattern,
} from '@muebles/domain';
import { ValidationError } from '@muebles/domain';

export interface DxfCutPlanExportInput {
  readonly cutPlan: CutPlan;
  readonly variant: 'sheets' | 'pieces';
  /** Optional drilling patterns keyed by pieceCode — drawn as PERF circles. */
  readonly drilling?: readonly PartDrillingPattern[];
}

const DXF_LAYERS: ReadonlyArray<{ name: string; color: number }> = [
  { name: 'TABLERO', color: 7 },
  { name: 'PIEZA', color: 1 },
  { name: 'ETIQUETA', color: 3 },
  { name: 'VETA', color: 5 },
  { name: 'PERF', color: 4 },
  { name: 'RETAZO', color: 8 },
];

const SHEET_GAP_MM = 200;
const PIECES_ROW_MAX_MM = 6000;
const PIECES_GAP_MM = 100;
const LABEL_HEIGHT_MM = 30;
const LABEL_LINE_STEP_MM = 38;

const PROJECTED_DRILLING_FACES: ReadonlySet<string> = new Set(['front', 'back']);

const ASCII_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N',
  '×': 'x', '·': '-', '°': 'deg', '±': '+-', '≤': '<=', '≥': '>=',
};

function dxfText(value: string): string {
  let out = '';
  for (const ch of value) {
    const mapped = ASCII_MAP[ch] ?? ch;
    out += mapped.charCodeAt(0) >= 32 && mapped.charCodeAt(0) <= 126 ? mapped : '';
  }
  return out.slice(0, 250);
}

function fmt(value: number): string {
  return value.toFixed(2);
}

function pair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function polyline(layer: string, x: number, y: number, length: number, width: number): string {
  let s = '';
  s += pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(70, 1);
  const corners: Array<[number, number]> = [
    [x, y],
    [x + length, y],
    [x + length, y + width],
    [x, y + width],
  ];
  for (const [cx, cy] of corners) {
    s += pair(0, 'VERTEX') + pair(8, layer) + pair(10, fmt(cx)) + pair(20, fmt(cy));
  }
  s += pair(0, 'SEQEND') + pair(8, layer);
  return s;
}

function text(layer: string, x: number, y: number, height: number, value: string): string {
  return (
    pair(0, 'TEXT') +
    pair(8, layer) +
    pair(10, fmt(x)) +
    pair(20, fmt(y)) +
    pair(40, fmt(height)) +
    pair(1, dxfText(value))
  );
}

function line(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return (
    pair(0, 'LINE') +
    pair(8, layer) +
    pair(10, fmt(x1)) +
    pair(20, fmt(y1)) +
    pair(11, fmt(x2)) +
    pair(21, fmt(y2))
  );
}

function circle(layer: string, x: number, y: number, radius: number): string {
  return (
    pair(0, 'CIRCLE') +
    pair(8, layer) +
    pair(10, fmt(x)) +
    pair(20, fmt(y)) +
    pair(40, fmt(radius))
  );
}

function edgesLabel(p: CutPlanPlacedPiece): string {
  const edges = [p.L1 ? 'L1' : '', p.L2 ? 'L2' : '', p.W1 ? 'W1' : '', p.W2 ? 'W2' : '']
    .filter(Boolean)
    .join('+');
  return edges ? `Cantos: ${edges}` : 'Sin cantos';
}

function pieceLabelLines(p: CutPlanPlacedPiece, withMaterial: boolean): string[] {
  const lines = [
    `${p.partCode}  ${p.originalLengthMm}x${p.originalWidthMm}`,
    `${p.moduleCode} ${p.moduleCode ? '·' : ''} ${p.labelRef}`,
    edgesLabel(p),
  ];
  if (withMaterial) lines.push(p.materialName);
  return lines;
}

function drawPiece(
  entities: string[],
  p: CutPlanPlacedPiece,
  x: number,
  y: number,
  withMaterial: boolean,
  drillingByPiece?: Map<string, PartDrillingPattern>,
): void {
  entities.push(polyline('PIEZA', x, y, p.lengthMm, p.widthMm));

  const lines = pieceLabelLines(p, withMaterial);
  const maxLines = p.widthMm >= 200 ? lines.length : 1;
  for (let i = 0; i < maxLines; i++) {
    entities.push(text('ETIQUETA', x + 10, y + 15 + i * LABEL_LINE_STEP_MM, LABEL_HEIGHT_MM, lines[i]!));
  }

  if (p.grain === 1 && p.lengthMm > 200 && p.widthMm > 60) {
    const cy = y + p.widthMm / 2;
    const cx = x + p.lengthMm / 2;
    const half = (p.lengthMm * 0.6) / 2;
    entities.push(line('VETA', cx - half, cy, cx + half, cy));
    entities.push(line('VETA', cx + half, cy, cx + half - 40, cy + 20));
    entities.push(line('VETA', cx + half, cy, cx + half - 40, cy - 20));
  }

  if (drillingByPiece && !p.rotated) {
    const pattern = drillingByPiece.get(p.partCode);
    if (pattern) {
      for (const hole of pattern.holes) {
        if (!PROJECTED_DRILLING_FACES.has(hole.face)) continue;
        entities.push(circle('PERF', x + hole.xMm, y + hole.yMm, hole.diameterMm / 2));
      }
    }
  }
}

function buildHeader(maxX: number, maxY: number): string {
  let s = '';
  s += pair(0, 'SECTION') + pair(2, 'HEADER');
  s += pair(9, '$ACADVER') + pair(1, 'AC1009');
  s += pair(9, '$INSBASE') + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0');
  s += pair(9, '$EXTMIN') + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0');
  s += pair(9, '$EXTMAX') + pair(10, fmt(maxX)) + pair(20, fmt(maxY)) + pair(30, '0.0');
  s += pair(0, 'ENDSEC');
  return s;
}

function buildLayerTable(): string {
  let s = pair(0, 'SECTION') + pair(2, 'TABLES');
  s += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, DXF_LAYERS.length);
  for (const layer of DXF_LAYERS) {
    s += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0) + pair(62, layer.color) + pair(6, 'CONTINUOUS');
  }
  s += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  return s;
}

function buildSheetsVariant(plan: CutPlan, drillingByPiece?: Map<string, PartDrillingPattern>): string {
  const entities: string[] = [];
  let offsetX = 0;
  let maxX = 0;
  let maxY = 0;

  for (const sheet of plan.sheets) {
    entities.push(polyline('TABLERO', offsetX, 0, sheet.sheetLengthMm, sheet.sheetWidthMm));
    entities.push(
      text(
        'ETIQUETA',
        offsetX,
        sheet.sheetWidthMm + 60,
        LABEL_HEIGHT_MM * 1.5,
        `TABLERO #${sheet.sheetIndex + 1} - ${sheet.materialName}` +
          (sheet.thicknessMm ? ` ${sheet.thicknessMm}mm` : ''),
      ),
    );

    for (const piece of sheet.pieces) {
      drawPiece(entities, piece, offsetX + piece.xMm, piece.yMm, false, drillingByPiece);
    }

    for (const remnant of sheet.remnants.filter((r) => r.isUseful)) {
      entities.push(polyline('RETAZO', offsetX + remnant.xMm, remnant.yMm, remnant.lengthMm, remnant.widthMm));
      entities.push(
        text(
          'ETIQUETA',
          offsetX + remnant.xMm + 10,
          remnant.yMm + 10,
          LABEL_HEIGHT_MM,
          `RETAZO ${Math.round(remnant.lengthMm)}x${Math.round(remnant.widthMm)}`,
        ),
      );
    }

    maxX = Math.max(maxX, offsetX + sheet.sheetLengthMm);
    maxY = Math.max(maxY, sheet.sheetWidthMm + 120);
    offsetX += sheet.sheetLengthMm + SHEET_GAP_MM;
  }

  return buildHeader(maxX, maxY) + buildLayerTable() + wrapEntities(entities);
}

function buildPiecesVariant(plan: CutPlan, drillingByPiece?: Map<string, PartDrillingPattern>): string {
  const entities: string[] = [];
  const pieces = plan.sheets.flatMap((s) => s.pieces);
  const labelsReservedMm = 180;

  let x = 0;
  let y = labelsReservedMm;
  let rowHeight = 0;
  let maxX = 0;

  for (const piece of pieces) {
    if (x > 0 && x + piece.lengthMm > PIECES_ROW_MAX_MM) {
      x = 0;
      y += rowHeight + labelsReservedMm + PIECES_GAP_MM;
      rowHeight = 0;
    }
    drawPiece(entities, piece, x, y, true, drillingByPiece);
    x += piece.lengthMm + PIECES_GAP_MM;
    rowHeight = Math.max(rowHeight, piece.widthMm);
    maxX = Math.max(maxX, x);
  }

  return buildHeader(maxX, y + rowHeight + labelsReservedMm + PIECES_GAP_MM) + buildLayerTable() + wrapEntities(entities);
}

function wrapEntities(entities: string[]): string {
  return pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC') + pair(0, 'EOF');
}

/**
 * Serializes a Cut Plan as an ASCII DXF R12 drawing (millimeters).
 */
export function dxfCutPlanExport(input: DxfCutPlanExportInput): Uint8Array {
  const { cutPlan, variant, drilling } = input;

  if (variant === 'sheets' && cutPlan.sheets.length === 0) {
    throw new ValidationError('El plan de corte no tiene tableros para exportar a DXF', {
      variant,
      projectId: cutPlan.projectId,
    });
  }
  const totalPieces = cutPlan.sheets.reduce((sum, s) => sum + s.pieces.length, 0);
  if (totalPieces === 0) {
    throw new ValidationError('El plan de corte no tiene piezas para exportar a DXF', {
      variant,
      projectId: cutPlan.projectId,
    });
  }

  const drillingByPiece = drilling
    ? new Map(drilling.map((pattern) => [pattern.pieceCode, pattern] as const))
    : undefined;

  const body =
    variant === 'sheets'
      ? buildSheetsVariant(cutPlan, drillingByPiece)
      : buildPiecesVariant(cutPlan, drillingByPiece);

  return new TextEncoder().encode(body);
}
