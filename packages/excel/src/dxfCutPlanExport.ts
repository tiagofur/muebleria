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
  readonly projectName?: string;
  /** Optional drilling patterns keyed by pieceCode — drawn as PERF circles. */
  readonly drilling?: readonly PartDrillingPattern[];
}

export interface DxfSheetCutFile {
  readonly sheetIndex: number;
  readonly materialCode?: string;
  readonly materialName: string;
  readonly fileName: string;
  readonly dxfContent: string;
  readonly bytes: Uint8Array;
  readonly piecesCount: number;
  readonly sheetLengthMm: number;
  readonly sheetWidthMm: number;
}

export interface DxfPieceCutFile {
  readonly pieceId: string;
  readonly partCode: string;
  readonly partName: string;
  readonly moduleCode: string;
  readonly labelRef: string;
  readonly materialName: string;
  readonly fileName: string;
  readonly dxfContent: string;
  readonly bytes: Uint8Array;
  readonly lengthMm: number;
  readonly widthMm: number;
}

export interface GenerateDxfOptions {
  readonly cutPlan: CutPlan;
  readonly projectName?: string;
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

/**
 * Drilling layer convention (F130) — one layer per FACE + DIAMETER so CAM
 * software (SCM Maestro) maps layer → tool once and every program follows:
 *   PERF_F<Ø>   front-face holes (viewed from the front, as drawn)
 *   PERF_B<Ø>   back-face holes, ALREADY MIRRORED (width axis) so the
 *               operator flips the piece and runs the same coordinates
 *   PERF_CANTO<Ø> edge-face holes, projected onto the piece outline at the
 *               point where the edge sits (horizontal-aggregate drilling)
 * Depth is NOT part of the layer: same Ø drills at the depth each tool is
 * set to; per-hole depths live in the drilling report.
 */
const DRILLING_FACE_COLORS: Readonly<Record<string, number>> = {
  F: 4,
  B: 1,
  CANTO: 6,
};

function drillingLayerName(face: string, diameterMm: number): string {
  const group = face === 'front' ? 'F' : face === 'back' ? 'B' : 'CANTO';
  return `PERF_${group}${Math.round(diameterMm)}`;
}

function drillingLayersFor(patterns: Iterable<PartDrillingPattern>): string[] {
  const names = new Set<string>();
  for (const pattern of patterns) {
    for (const hole of pattern.holes) {
      names.add(drillingLayerName(hole.face, hole.diameterMm));
    }
  }
  return [...names].sort();
}

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

export function sanitizeFileNameToken(raw: string): string {
  const mapped = dxfText(raw);
  return (
    mapped
      .replace(/[^\w\d-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'item'
  );
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
    const pattern = drillingByPiece.get(p.labelRef ?? p.partCode) ?? drillingByPiece.get(p.partCode);
    if (pattern) {
      for (const hole of pattern.holes) {
        const layer = drillingLayerName(hole.face, hole.diameterMm);
        // Face-plane convention (partDrillingResolver, mirrors hardwarePlacement):
        // front/back holes carry xMm along the piece WIDTH and yMm along the
        // LENGTH. The piece rect is drawn with X = length / Y = width.
        if (hole.face === 'front') {
          entities.push(circle(layer, x + hole.yMm, y + hole.xMm, hole.diameterMm / 2));
        } else if (hole.face === 'back') {
          // Back face: MIRRORED on the width axis — the operator flips the
          // piece around its length axis and runs these coordinates as drawn.
          entities.push(circle(layer, x + hole.yMm, y + (p.widthMm - hole.xMm), hole.diameterMm / 2));
        } else if (hole.face === 'left' || hole.face === 'right') {
          // Edge normal to width: projected at the piece side, positioned
          // along the length by the hole's y.
          const edgeY = hole.face === 'left' ? 0 : p.widthMm;
          entities.push(circle(layer, x + hole.yMm, y + edgeY, hole.diameterMm / 2));
        } else {
          // top/bottom: edge normal to length, positioned along the width.
          const edgeX = hole.face === 'top' ? p.lengthMm : 0;
          entities.push(circle(layer, x + edgeX, y + hole.xMm, hole.diameterMm / 2));
        }
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

function buildLayerTable(extraLayerNames: readonly string[] = []): string {
  const extra = extraLayerNames.map((name) => ({
    name,
    color: DRILLING_FACE_COLORS[name.startsWith('PERF_CANTO') ? 'CANTO' : name.startsWith('PERF_B') ? 'B' : 'F'] ?? 4,
  }));
  const layers = [...DXF_LAYERS, ...extra];
  let s = pair(0, 'SECTION') + pair(2, 'TABLES');
  s += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  for (const layer of layers) {
    s += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0) + pair(62, layer.color) + pair(6, 'CONTINUOUS');
  }
  s += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  return s;
}

function buildSingleSheetDxf(
  sheet: CutPlan['sheets'][number],
  drillingByPiece?: Map<string, PartDrillingPattern>,
): string {
  const entities: string[] = [];
  entities.push(polyline('TABLERO', 0, 0, sheet.sheetLengthMm, sheet.sheetWidthMm));
  entities.push(
    text(
      'ETIQUETA',
      0,
      sheet.sheetWidthMm + 60,
      LABEL_HEIGHT_MM * 1.5,
      `TABLERO #${sheet.sheetIndex + 1} - ${sheet.materialName}` +
        (sheet.thicknessMm ? ` ${sheet.thicknessMm}mm` : ''),
    ),
  );

  for (const piece of sheet.pieces) {
    drawPiece(entities, piece, piece.xMm, piece.yMm, false, drillingByPiece);
  }

  for (const remnant of sheet.remnants.filter((r) => r.isUseful)) {
    entities.push(polyline('RETAZO', remnant.xMm, remnant.yMm, remnant.lengthMm, remnant.widthMm));
    entities.push(
      text(
        'ETIQUETA',
        remnant.xMm + 10,
        remnant.yMm + 10,
        LABEL_HEIGHT_MM,
        `RETAZO ${Math.round(remnant.lengthMm)}x${Math.round(remnant.widthMm)}`,
      ),
    );
  }

  const maxX = sheet.sheetLengthMm;
  const maxY = sheet.sheetWidthMm + 120;
  return (
    buildHeader(maxX, maxY) +
    buildLayerTable(drillingByPiece ? drillingLayersFor(drillingByPiece.values()) : []) +
    wrapEntities(entities)
  );
}

function buildSinglePieceDxf(
  piece: CutPlanPlacedPiece,
  drillingByPiece?: Map<string, PartDrillingPattern>,
): string {
  const entities: string[] = [];
  drawPiece(entities, piece, 0, 0, true, drillingByPiece);
  const maxX = piece.lengthMm;
  const maxY = piece.widthMm + 60;
  return (
    buildHeader(maxX, maxY) +
    buildLayerTable(drillingByPiece ? drillingLayersFor(drillingByPiece.values()) : []) +
    wrapEntities(entities)
  );
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

  return (
    buildHeader(maxX, maxY) +
    buildLayerTable(drillingByPiece ? drillingLayersFor(drillingByPiece.values()) : []) +
    wrapEntities(entities)
  );
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

  return (
    buildHeader(maxX, y + rowHeight + labelsReservedMm + PIECES_GAP_MM) +
    buildLayerTable(drillingByPiece ? drillingLayersFor(drillingByPiece.values()) : []) +
    wrapEntities(entities)
  );
}

function wrapEntities(entities: string[]): string {
  return pair(0, 'SECTION') + pair(2, 'ENTITIES') + entities.join('') + pair(0, 'ENDSEC') + pair(0, 'EOF');
}

/**
 * Generates an array of standalone DXF R12 files, one for each nested board (sheet).
 * Coordinated at local (0,0) machine origin with its pieces, labels, and remnants.
 */
export function generateDxfBySheet(options: GenerateDxfOptions): DxfSheetCutFile[] {
  const { cutPlan, projectName, drilling } = options;
  if (!cutPlan.sheets || cutPlan.sheets.length === 0) {
    return [];
  }

  const drillingByPiece = drilling
    ? new Map(drilling.map((pattern) => [pattern.pieceCode, pattern] as const))
    : undefined;

  const baseProject = sanitizeFileNameToken(
    projectName || cutPlan.projectName || cutPlan.projectId || 'plan-de-corte',
  );

  const results: DxfSheetCutFile[] = [];

  for (const sheet of cutPlan.sheets) {
    const sheetNum = String(sheet.sheetIndex + 1).padStart(2, '0');
    const safeMat = sanitizeFileNameToken(sheet.materialCode || sheet.materialName || 'material');
    const fileName = `${baseProject}_Tablero-${sheetNum}_${safeMat}_${Math.round(sheet.sheetLengthMm)}x${Math.round(sheet.sheetWidthMm)}.dxf`;

    const dxfContent = buildSingleSheetDxf(sheet, drillingByPiece);
    const bytes = new TextEncoder().encode(dxfContent);

    results.push({
      sheetIndex: sheet.sheetIndex,
      materialCode: sheet.materialCode,
      materialName: sheet.materialName,
      fileName,
      dxfContent,
      bytes,
      piecesCount: sheet.pieces.length,
      sheetLengthMm: sheet.sheetLengthMm,
      sheetWidthMm: sheet.sheetWidthMm,
    });
  }

  return results;
}

/**
 * Generates an array of standalone DXF R12 files, one for each individual piece.
 * Coordinated at local (0,0) origin with piece contours, labels, grain, and drilling.
 */
export function generateDxfByPiece(options: GenerateDxfOptions): DxfPieceCutFile[] {
  const { cutPlan, projectName, drilling } = options;
  if (!cutPlan.sheets || cutPlan.sheets.length === 0) {
    return [];
  }

  const pieces = cutPlan.sheets.flatMap((s) => s.pieces);
  if (pieces.length === 0) {
    return [];
  }

  const drillingByPiece = drilling
    ? new Map(drilling.map((pattern) => [pattern.pieceCode, pattern] as const))
    : undefined;

  const baseProject = sanitizeFileNameToken(
    projectName || cutPlan.projectName || cutPlan.projectId || 'plan-de-corte',
  );

  const nameCounts = new Map<string, number>();
  const results: DxfPieceCutFile[] = [];

  for (const piece of pieces) {
    const safePart = sanitizeFileNameToken(piece.partCode || 'pieza');
    const modToken = piece.moduleCode ? `_${sanitizeFileNameToken(piece.moduleCode)}` : '';
    const labelToken = piece.labelRef ? `_${sanitizeFileNameToken(piece.labelRef)}` : '';

    const baseName = `${baseProject}_${safePart}${modToken}${labelToken}`;
    const count = (nameCounts.get(baseName) ?? 0) + 1;
    nameCounts.set(baseName, count);

    const suffix = count > 1 ? `_${count}` : '';
    const fileName = `${baseName}${suffix}.dxf`;

    const dxfContent = buildSinglePieceDxf(piece, drillingByPiece);
    const bytes = new TextEncoder().encode(dxfContent);

    results.push({
      pieceId: piece.id,
      partCode: piece.partCode,
      partName: piece.partName,
      moduleCode: piece.moduleCode,
      labelRef: piece.labelRef,
      materialName: piece.materialName,
      fileName,
      dxfContent,
      bytes,
      lengthMm: piece.lengthMm,
      widthMm: piece.widthMm,
    });
  }

  return results;
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

