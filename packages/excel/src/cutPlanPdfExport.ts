/**
 * Professional 2D Guillotine Cut Plan PDF Export (F115).
 *
 * Generates vector workshop cutting plans and warehouse requisition sheets:
 * 1. Warehouse Cover Page: Exact board counts, net vs gross m², scrap %, and useful remnants list.
 * 2. Board Layout Pages: High-res dimensioned diagrams, edge banding markers (L1/L2/W1/W2),
 *    grain direction indicators, useful remnants, and step-by-step guillotine cut sequences.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CutPlan, CutPlanConfig, CutPlanSheet, CutPlanPlacedPiece, CutPlanRemnant } from '@granete/domain';
import { ValidationError } from '@granete/domain';

export interface CutPlanPdfExportInput {
  readonly cutPlan: CutPlan;
  readonly projectName?: string;
  readonly customerName?: string;
  readonly dateIso?: string;
}

const PAGE_WIDTH = 841.89;  // A4 Landscape (pt)
const PAGE_HEIGHT = 595.28;
const MARGIN = 32;

function drawClippedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
  color = rgb(0.12, 0.14, 0.18),
): void {
  let clipped = text;
  if (font.widthOfTextAtSize(text, size) > maxWidth) {
    let t = text;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) {
      t = t.slice(0, -1);
    }
    clipped = `${t}…`;
  }
  page.drawText(clipped, {
    x,
    y,
    size,
    font,
    color,
  });
}

/**
 * Builds the Cover Page (Carátula de Almacén y Requisición de Tableros).
 */
function renderWarehouseCoverPage(
  doc: PDFDocument,
  input: CutPlanPdfExportInput,
  font: PDFFont,
  fontBold: PDFFont,
): void {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const plan = input.cutPlan;
  const projectName = input.projectName || plan.projectName || plan.projectId;
  const customerName = input.customerName || 'Cliente General';
  const dateStr = new Date(input.dateIso || plan.generatedAt).toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Top header banner
  page.drawRectangle({
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 48,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 48,
    color: rgb(0.12, 0.16, 0.24),
  });

  page.drawText('GRANETE · PLAN DE CORTE Y REQUISICIÓN DE ALMACÉN', {
    x: MARGIN + 16,
    y: PAGE_HEIGHT - MARGIN - 26,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText(`Proyecto: ${projectName} · ${customerName} · Fecha: ${dateStr}`, {
    x: MARGIN + 16,
    y: PAGE_HEIGHT - MARGIN - 42,
    size: 9.5,
    font,
    color: rgb(0.8, 0.85, 0.92),
  });

  // Key KPI Cards for Warehouse (Requisición exacta de tableros)
  const cardW = (PAGE_WIDTH - MARGIN * 2 - 36) / 4;
  const cardH = 56;
  const cardY = PAGE_HEIGHT - MARGIN - 120;

  const kpis = [
    { label: 'TABLEROS COMPLETOS', val: `${plan.stats.totalSheets}`, sub: 'a despachar por almacén', highlight: true },
    { label: 'PIEZAS TOTALES', val: `${plan.stats.totalPieces}`, sub: 'a cortar en taller' },
    { label: 'ÁREA NETA TOTAL', val: `${plan.stats.totalNetPiecesAreaM2.toFixed(2)} m²`, sub: `Bruto: ${plan.stats.totalGrossAreaM2.toFixed(2)} m²` },
    { label: 'RETAZOS ÚTILES', val: `${plan.usefulRemnants.length}`, sub: `${plan.stats.totalUsefulRemnantsAreaM2.toFixed(2)} m² recuperables` },
  ];

  kpis.forEach((kpi, idx) => {
    const cx = MARGIN + idx * (cardW + 12);
    page.drawRectangle({
      x: cx,
      y: cardY,
      width: cardW,
      height: cardH,
      color: kpi.highlight ? rgb(0.92, 0.96, 1) : rgb(0.96, 0.97, 0.98),
      borderColor: kpi.highlight ? rgb(0.2, 0.45, 0.8) : rgb(0.82, 0.85, 0.9),
      borderWidth: 1.5,
    });

    page.drawText(kpi.label, {
      x: cx + 10,
      y: cardY + cardH - 14,
      size: 7.5,
      font: fontBold,
      color: kpi.highlight ? rgb(0.1, 0.3, 0.7) : rgb(0.4, 0.45, 0.5),
    });

    page.drawText(kpi.val, {
      x: cx + 10,
      y: cardY + cardH - 34,
      size: 16,
      font: fontBold,
      color: rgb(0.1, 0.14, 0.2),
    });

    page.drawText(kpi.sub, {
      x: cx + 10,
      y: cardY + cardH - 48,
      size: 7.5,
      font,
      color: rgb(0.45, 0.5, 0.55),
    });
  });

  // Table: Requisición de Materiales por Almacén
  const tableY = cardY - 24;
  page.drawText('1. REQUISICIÓN EXACTA DE TABLEROS (DESPACHO DE ALMACÉN)', {
    x: MARGIN,
    y: tableY,
    size: 10,
    font: fontBold,
    color: rgb(0.15, 0.2, 0.28),
  });

  const cols = [
    { title: 'CÓDIGO', w: 75 },
    { title: 'MATERIAL', w: 210 },
    { title: 'TABLEROS A DESPACHAR', w: 140 },
    { title: 'PIEZAS', w: 60 },
    { title: 'ÁREA NETA', w: 85 },
    { title: 'RENDIMIENTO', w: 95 },
    { title: 'RETAZOS ÚTILES', w: 110 },
  ];

  let curY = tableY - 18;
  let curX = MARGIN;

  // Table header
  page.drawRectangle({
    x: MARGIN,
    y: curY - 4,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 18,
    color: rgb(0.9, 0.92, 0.95),
  });

  cols.forEach((col) => {
    drawClippedText(page, col.title, curX + 4, curY, fontBold, 7.5, col.w - 8, rgb(0.2, 0.25, 0.35));
    curX += col.w;
  });

  curY -= 20;

  plan.stats.byMaterial.forEach((m, idx) => {
    const rowBg = idx % 2 === 0 ? rgb(0.98, 0.99, 1) : rgb(1, 1, 1);
    page.drawRectangle({
      x: MARGIN,
      y: curY - 4,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 18,
      color: rowBg,
      borderColor: rgb(0.88, 0.9, 0.94),
      borderWidth: 0.5,
    });

    curX = MARGIN;
    drawClippedText(page, m.materialCode, curX + 4, curY, fontBold, 8.5, cols[0]!.w - 8);
    curX += cols[0]!.w;
    drawClippedText(page, m.materialName, curX + 4, curY, font, 8.5, cols[1]!.w - 8);
    curX += cols[1]!.w;
    drawClippedText(page, `${m.sheetsNeeded} tablero${m.sheetsNeeded === 1 ? '' : 's'} completo${m.sheetsNeeded === 1 ? '' : 's'}`, curX + 4, curY, fontBold, 8.5, cols[2]!.w - 8, rgb(0.05, 0.4, 0.15));
    curX += cols[2]!.w;
    drawClippedText(page, `${m.piecesCount}`, curX + 4, curY, font, 8.5, cols[3]!.w - 8);
    curX += cols[3]!.w;
    drawClippedText(page, `${m.netAreaM2.toFixed(2)} m²`, curX + 4, curY, font, 8.5, cols[4]!.w - 8);
    curX += cols[4]!.w;
    drawClippedText(page, `${m.yieldPercent}% (Merma: ${m.wastePercent}%)`, curX + 4, curY, font, 8.5, cols[5]!.w - 8);
    curX += cols[5]!.w;
    drawClippedText(page, `${m.usefulRemnantsCount} (${m.usefulRemnantsAreaM2.toFixed(2)} m²)`, curX + 4, curY, font, 8.5, cols[6]!.w - 8);

    curY -= 19;
  });

  // Cutting Config & Remnant Inventory Section
  const lowerY = curY - 14;
  const halfW = (PAGE_WIDTH - MARGIN * 2 - 16) / 2;

  // Left Box: Cutting Configuration
  page.drawRectangle({
    x: MARGIN,
    y: MARGIN + 10,
    width: halfW,
    height: lowerY - (MARGIN + 10),
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.85, 0.88, 0.92),
    borderWidth: 1,
  });

  page.drawText('2. PARÁMETROS TÉCNICOS DE CORTE', {
    x: MARGIN + 12,
    y: lowerY - 16,
    size: 9,
    font: fontBold,
    color: rgb(0.15, 0.2, 0.3),
  });

  const trim = plan.config.trim;
  const configLines = [
    `• Espesor de disco (saw kerf): ${plan.config.sawKerfMm} mm`,
    `• Descuento de cintilla (sobrecorte): ${plan.config.deductEdgeBand ? 'Activado (corte en crudo descontando espesor de cantos)' : 'Desactivado (corte a medida final con pre-fresado de cantos)'}`,
    `• Refilado Superior (Top): ${trim.topMm} mm · Inferior (Bottom): ${trim.bottomMm} mm`,
    `• Refilado Izquierdo (Left): ${trim.leftMm} mm · Derecho (Right): ${trim.rightMm} mm`,
    `• Veta: ${plan.config.allowRotationNoGrain ? 'Rotación libre solo en piezas sin veta (grain=0)' : 'Rotación bloqueada en todas las piezas'}`,
    `• Umbral retazo útil: dimensiones mínimas ${plan.config.minRemnantLengthMm} × ${plan.config.minRemnantWidthMm} mm`,
    `• Lógica de corte: Guillotina 2D (orilla a orilla, apto para escuadradora manual)`,
  ];

  configLines.forEach((line, lIdx) => {
    page.drawText(line, {
      x: MARGIN + 12,
      y: lowerY - 34 - lIdx * 14,
      size: 8,
      font,
      color: rgb(0.3, 0.35, 0.42),
    });
  });

  // Right Box: Useful Remnants for Warehouse Stock Recovery
  const rightX = MARGIN + halfW + 16;
  page.drawRectangle({
    x: rightX,
    y: MARGIN + 10,
    width: halfW,
    height: lowerY - (MARGIN + 10),
    color: rgb(0.96, 0.99, 0.96),
    borderColor: rgb(0.75, 0.88, 0.78),
    borderWidth: 1,
  });

  page.drawText('3. RETAZOS ÚTILES PARA INGRESAR AL ALMACÉN', {
    x: rightX + 12,
    y: lowerY - 16,
    size: 9,
    font: fontBold,
    color: rgb(0.1, 0.4, 0.15),
  });

  if (plan.usefulRemnants.length === 0) {
    page.drawText('No se generaron retazos mayores al umbral mínimo (corte de alto aprovechamiento).', {
      x: rightX + 12,
      y: lowerY - 36,
      size: 8,
      font,
      color: rgb(0.4, 0.5, 0.4),
    });
  } else {
    page.drawText(`Se detectaron ${plan.usefulRemnants.length} retazos útiles reutilizables:`, {
      x: rightX + 12,
      y: lowerY - 32,
      size: 8,
      font: fontBold,
      color: rgb(0.2, 0.35, 0.2),
    });

    plan.usefulRemnants.slice(0, 5).forEach((rem, rIdx) => {
      const remText = `• Tablero #${rem.sheetIndex + 1}: ${rem.lengthMm} × ${rem.widthMm} mm (${rem.areaM2.toFixed(2)} m²) · ${rem.materialCode || rem.materialName}`;
      page.drawText(remText, {
        x: rightX + 12,
        y: lowerY - 48 - rIdx * 14,
        size: 8,
        font,
        color: rgb(0.15, 0.3, 0.18),
      });
    });
    if (plan.usefulRemnants.length > 5) {
      page.drawText(`... y ${plan.usefulRemnants.length - 5} retazos más (detallados en cada plano).`, {
        x: rightX + 12,
        y: lowerY - 48 - 5 * 14,
        size: 7.5,
        font,
        color: rgb(0.35, 0.45, 0.35),
      });
    }
  }
}

/**
 * Builds an Individual Board Cutting Diagram Sheet.
 */
function renderBoardSheetPage(
  doc: PDFDocument,
  sheet: CutPlanSheet,
  sheetIndex: number,
  totalSheets: number,
  config: CutPlanConfig,
  projectName: string,
  customerName: string,
  font: PDFFont,
  fontBold: PDFFont,
): void {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Page Header
  let headerY = PAGE_HEIGHT - MARGIN + 4;
  page.drawText(`TABLERO ${sheetIndex + 1} DE ${totalSheets} · ${sheet.materialName} (${sheet.materialCode})`, {
    x: MARGIN,
    y: headerY,
    size: 11,
    font: fontBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  page.drawText(`${projectName} · ${customerName}`, {
    x: MARGIN + 460,
    y: headerY,
    size: 8.5,
    font,
    color: rgb(0.4, 0.45, 0.5),
  });

  headerY -= 13;
  page.drawText(
    `Dimensión: ${sheet.sheetLengthMm} × ${sheet.sheetWidthMm} mm${sheet.thicknessMm ? ` × ${sheet.thicknessMm}mm` : ''} · Piezas: ${sheet.pieces.length} · Aprovechamiento: ${sheet.yieldPercent}% (Merma: ${sheet.wastePercent}%) · Disco: ${config.sawKerfMm}mm`,
    {
      x: MARGIN,
      y: headerY,
      size: 8,
      font,
      color: rgb(0.35, 0.4, 0.48),
    },
  );

  // Diagram & Instructions layout partition
  const diagramW = 540;
  const diagramH = 460;
  const diagX = MARGIN;
  const diagY = MARGIN + 22;

  const instX = diagX + diagramW + 16;
  const instW = PAGE_WIDTH - MARGIN - instX;
  const instY = diagY;
  const instH = diagramH;

  // Scale board to fit in diagram area
  const scale = Math.min(diagramW / sheet.sheetLengthMm, diagramH / sheet.sheetWidthMm);
  const drawW = sheet.sheetLengthMm * scale;
  const drawH = sheet.sheetWidthMm * scale;

  const originX = diagX + (diagramW - drawW) / 2;
  const originY = diagY + (diagramH - drawH) / 2;

  // Draw Raw Board Outer Box
  page.drawRectangle({
    x: originX,
    y: originY,
    width: drawW,
    height: drawH,
    color: rgb(0.95, 0.95, 0.96),
    borderColor: rgb(0.2, 0.25, 0.32),
    borderWidth: 1.5,
  });

  // Draw Trim Box (Refilado interior)
  const trim = config.trim;
  const trimX = originX + trim.leftMm * scale;
  const trimY = originY + trim.bottomMm * scale;
  const trimW = (sheet.sheetLengthMm - trim.leftMm - trim.rightMm) * scale;
  const trimH = (sheet.sheetWidthMm - trim.topMm - trim.bottomMm) * scale;

  if (trim.topMm > 0 || trim.bottomMm > 0 || trim.leftMm > 0 || trim.rightMm > 0) {
    page.drawRectangle({
      x: trimX,
      y: trimY,
      width: trimW,
      height: trimH,
      borderColor: rgb(0.7, 0.75, 0.8),
      borderWidth: 0.8,
    });
  }

  // Draw Useful Remnants (Green boxes ONLY if truly useful and >= 0.24 m2)
  sheet.remnants.forEach((rem) => {
    if (!rem.isUseful || rem.areaM2 < 0.24) return;
    const rx = originX + rem.xMm * scale;
    const ry = originY + rem.yMm * scale;
    const rw = rem.lengthMm * scale;
    const rh = rem.widthMm * scale;

    page.drawRectangle({
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      color: rgb(0.9, 0.97, 0.92),
      borderColor: rgb(0.25, 0.65, 0.35),
      borderWidth: 1.2,
    });

    if (rw > 30 && rh > 14) {
      drawClippedText(page, `RETAZO ${Math.round(rem.lengthMm)}×${Math.round(rem.widthMm)} mm`, rx + 3, ry + rh - 10, fontBold, 6.5, rw - 6, rgb(0.1, 0.45, 0.2));
    }
  });

  // Analysis of Guillotine strips (horizontal vs vertical) for PDF
  const yClusters = new Map<number, typeof sheet.pieces[0][]>();
  const xClusters = new Map<number, typeof sheet.pieces[0][]>();

  for (const p of sheet.pieces) {
    let foundYKey: number | null = null;
    for (const k of yClusters.keys()) {
      if (Math.abs(k - p.yMm) <= 2) {
        foundYKey = k;
        break;
      }
    }
    if (foundYKey !== null) {
      yClusters.get(foundYKey)!.push(p);
    } else {
      yClusters.set(p.yMm, [p]);
    }

    let foundXKey: number | null = null;
    for (const k of xClusters.keys()) {
      if (Math.abs(k - p.xMm) <= 2) {
        foundXKey = k;
        break;
      }
    }
    if (foundXKey !== null) {
      xClusters.get(foundXKey)!.push(p);
    } else {
      xClusters.set(p.xMm, [p]);
    }
  }

  const avgPiecesPerY = sheet.pieces.length / Math.max(1, yClusters.size);
  const avgPiecesPerX = sheet.pieces.length / Math.max(1, xClusters.size);
  const isHorizontal = avgPiecesPerY >= avgPiecesPerX;

  let primCutCoordinate: number | null = null;
  let primCutAxis: 'horizontal' | 'vertical' = 'horizontal';

  if (isHorizontal) {
    // HORIZONTAL STRIPS
    primCutAxis = 'horizontal';
    const sortedYKeys = [...yClusters.keys()].sort((a, b) => a - b);
    let maxUsedY = 0;

    for (const yKey of sortedYKeys) {
      const rowPieces = yClusters.get(yKey)!;
      const minY = Math.min(...rowPieces.map((p) => p.yMm));
      const maxY = Math.max(...rowPieces.map((p) => p.yMm + p.widthMm));
      const maxX = Math.max(...rowPieces.map((p) => p.xMm + p.lengthMm));
      const rowHeight = maxY - minY;
      if (maxY > maxUsedY) maxUsedY = maxY;

      // Draw continuous rip line
      const ry = originY + maxY * scale;
      page.drawLine({
        start: { x: originX, y: ry },
        end: { x: originX + drawW, y: ry },
        color: rgb(0.5, 0.55, 0.62),
        thickness: 0.8,
      });

      // Draw vertical cross cuts between pieces in row
      for (const p of rowPieces) {
        const cutX = p.xMm + p.lengthMm;
        const cx = originX + cutX * scale;
        page.drawLine({
          start: { x: cx, y: originY + minY * scale },
          end: { x: cx, y: originY + maxY * scale },
          color: rgb(0.65, 0.7, 0.76),
          thickness: 0.6,
        });

        // Waste gap above piece
        if (p.widthMm < rowHeight - 1) {
          page.drawRectangle({
            x: originX + p.xMm * scale,
            y: originY + (p.yMm + p.widthMm) * scale,
            width: p.lengthMm * scale,
            height: (rowHeight - p.widthMm) * scale,
            color: rgb(0.92, 0.94, 0.96),
            borderColor: rgb(0.78, 0.82, 0.88),
            borderWidth: 0.5,
          });
        }
      }

      // Leftover at end of row
      if (maxX < sheet.sheetLengthMm - 15) {
        page.drawRectangle({
          x: originX + maxX * scale,
          y: originY + minY * scale,
          width: (sheet.sheetLengthMm - maxX) * scale,
          height: rowHeight * scale,
          color: rgb(0.92, 0.94, 0.96),
          borderColor: rgb(0.78, 0.82, 0.88),
          borderWidth: 0.5,
        });
      }
    }

    const largeRemnant = sheet.remnants.find((r) => r.isUseful && r.yMm >= maxUsedY - 5 && r.areaM2 >= 0.24);
    primCutCoordinate = largeRemnant ? largeRemnant.yMm : sortedYKeys.length > 0 ? Math.max(...yClusters.get(sortedYKeys[0]!)!.map((p) => p.yMm + p.widthMm)) : null;
  } else {
    // VERTICAL STRIPS
    primCutAxis = 'vertical';
    const sortedXKeys = [...xClusters.keys()].sort((a, b) => a - b);
    let maxUsedX = 0;

    for (const xKey of sortedXKeys) {
      const colPieces = xClusters.get(xKey)!;
      const minX = Math.min(...colPieces.map((p) => p.xMm));
      const maxX = Math.max(...colPieces.map((p) => p.xMm + p.lengthMm));
      const maxY = Math.max(...colPieces.map((p) => p.yMm + p.widthMm));
      const colWidth = maxX - minX;
      if (maxX > maxUsedX) maxUsedX = maxX;

      // Draw continuous vertical rip line
      const rx = originX + maxX * scale;
      page.drawLine({
        start: { x: rx, y: originY },
        end: { x: rx, y: originY + drawH },
        color: rgb(0.5, 0.55, 0.62),
        thickness: 0.8,
      });

      // Draw horizontal cross cuts between pieces in column
      for (const p of colPieces) {
        const cutY = p.yMm + p.widthMm;
        const cy = originY + cutY * scale;
        page.drawLine({
          start: { x: originX + minX * scale, y: cy },
          end: { x: originX + maxX * scale, y: cy },
          color: rgb(0.65, 0.7, 0.76),
          thickness: 0.6,
        });

        // Waste gap to the right of piece
        if (p.lengthMm < colWidth - 1) {
          page.drawRectangle({
            x: originX + (p.xMm + p.lengthMm) * scale,
            y: originY + p.yMm * scale,
            width: (colWidth - p.lengthMm) * scale,
            height: p.widthMm * scale,
            color: rgb(0.92, 0.94, 0.96),
            borderColor: rgb(0.78, 0.82, 0.88),
            borderWidth: 0.5,
          });
        }
      }

      // Leftover at bottom of column
      if (maxY < sheet.sheetWidthMm - 15) {
        page.drawRectangle({
          x: originX + minX * scale,
          y: originY + maxY * scale,
          width: colWidth * scale,
          height: (sheet.sheetWidthMm - maxY) * scale,
          color: rgb(0.92, 0.94, 0.96),
          borderColor: rgb(0.78, 0.82, 0.88),
          borderWidth: 0.5,
        });
      }
    }

    const largeRemnant = sheet.remnants.find((r) => r.isUseful && r.xMm >= maxUsedX - 5 && r.areaM2 >= 0.24);
    primCutCoordinate = largeRemnant ? largeRemnant.xMm : sortedXKeys.length > 0 ? Math.max(...xClusters.get(sortedXKeys[0]!)!.map((p) => p.xMm + p.lengthMm)) : null;
  }

  // Draw Primary 1st Cut Badge & Line
  if (primCutCoordinate != null) {
    if (primCutAxis === 'horizontal') {
      const lineY = originY + primCutCoordinate * scale;
      page.drawLine({
        start: { x: originX, y: lineY },
        end: { x: originX + drawW, y: lineY },
        color: rgb(0.85, 0.5, 0.1),
        thickness: 1.5,
      });

      page.drawRectangle({
        x: originX + 4,
        y: lineY - 6,
        width: 80,
        height: 11,
        color: rgb(0.85, 0.5, 0.1),
      });
      page.drawText(`1er CORTE (Y=${Math.round(primCutCoordinate)}mm)`, {
        x: originX + 7,
        y: lineY - 3,
        size: 5.5,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
    } else {
      const lineX = originX + primCutCoordinate * scale;
      page.drawLine({
        start: { x: lineX, y: originY },
        end: { x: lineX, y: originY + drawH },
        color: rgb(0.85, 0.5, 0.1),
        thickness: 1.5,
      });

      page.drawRectangle({
        x: lineX - 40,
        y: originY + drawH - 12,
        width: 80,
        height: 11,
        color: rgb(0.85, 0.5, 0.1),
      });
      page.drawText(`1er CORTE (X=${Math.round(primCutCoordinate)}mm)`, {
        x: lineX - 37,
        y: originY + drawH - 9,
        size: 5.5,
        font: fontBold,
        color: rgb(1, 1, 1),
      });
    }
  }

  // Draw Placed Pieces
  sheet.pieces.forEach((p, idx) => {
    const px = originX + p.xMm * scale;
    const py = originY + p.yMm * scale;
    const pw = p.lengthMm * scale;
    const ph = p.widthMm * scale;

    // Piece body: Clean white card with slate border
    page.drawRectangle({
      x: px,
      y: py,
      width: pw,
      height: ph,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.2, 0.25, 0.35),
      borderWidth: 0.9,
    });

    // Draw Edge Banding lines in Cobalt Blue (L1, L2, W1, W2)
    const edgeColor = rgb(0.15, 0.45, 0.85); // Technical Cobalt Blue
    const edgeThickness = 2.0;

    if (p.L1 === 1) {
      page.drawLine({
        start: { x: px, y: py + ph },
        end: { x: px + pw, y: py + ph },
        color: edgeColor,
        thickness: edgeThickness,
      });
    }
    if (p.L2 === 1) {
      page.drawLine({
        start: { x: px, y: py },
        end: { x: px + pw, y: py },
        color: edgeColor,
        thickness: edgeThickness,
      });
    }
    if (p.W1 === 1) {
      page.drawLine({
        start: { x: px, y: py },
        end: { x: px, y: py + ph },
        color: edgeColor,
        thickness: edgeThickness,
      });
    }
    if (p.W2 === 1) {
      page.drawLine({
        start: { x: px + pw, y: py },
        end: { x: px + pw, y: py + ph },
        color: edgeColor,
        thickness: edgeThickness,
      });
    }

    // Piece Labels
    if (pw > 28 && ph > 14) {
      const codeStr = p.partCode || `P${idx + 1}`;
      const modStr = p.moduleCode ? `[${p.moduleCode}] ` : '';
      drawClippedText(page, `${modStr}${codeStr}`, px + 3, py + ph - 9, fontBold, 7, pw - 6, rgb(0.08, 0.12, 0.2));

      if (ph > 22) {
        const dimsStr = `${p.lengthMm} × ${p.widthMm}`;
        drawClippedText(page, dimsStr, px + 3, py + ph - 17, font, 6.5, pw - 6, rgb(0.3, 0.35, 0.42));
      }

      if (ph > 32) {
        drawClippedText(page, p.partName, px + 3, py + ph - 25, font, 5.5, pw - 6, rgb(0.45, 0.5, 0.55));
      }
    }
  });

  // Right Side: Step-by-Step Guillotine Cut Sequence
  page.drawRectangle({
    x: instX,
    y: instY,
    width: instW,
    height: instH,
    color: rgb(0.98, 0.98, 0.99),
    borderColor: rgb(0.85, 0.88, 0.92),
    borderWidth: 1,
  });

  page.drawText('SECUENCIA DE CORTE (GUILLOTINA)', {
    x: instX + 10,
    y: instY + instH - 16,
    size: 8.5,
    font: fontBold,
    color: rgb(0.12, 0.16, 0.24),
  });

  let seqY = instY + instH - 32;
  const maxInst = 22;
  const shownInstructions = sheet.instructions.slice(0, maxInst);

  shownInstructions.forEach((inst) => {
    let bulletColor = rgb(0.3, 0.35, 0.4);
    if (inst.phase === 1) bulletColor = rgb(0.7, 0.4, 0.1);
    if (inst.phase === 2) bulletColor = rgb(0.1, 0.4, 0.7);
    if (inst.phase === 3) bulletColor = rgb(0.2, 0.55, 0.3);

    page.drawText(`${inst.step}.`, {
      x: instX + 8,
      y: seqY,
      size: 7.5,
      font: fontBold,
      color: bulletColor,
    });

    drawClippedText(page, inst.description, instX + 22, seqY, font, 7, instW - 28, rgb(0.2, 0.25, 0.3));
    seqY -= 17;
  });

  if (sheet.instructions.length > maxInst) {
    page.drawText(`... y ${sheet.instructions.length - maxInst} cortes de despiece más.`, {
      x: instX + 8,
      y: seqY,
      size: 7,
      font,
      color: rgb(0.5, 0.55, 0.6),
    });
  }

  // Footer
  page.drawText(
    `Bordes en rojo = Tapa-canto aplicado (L1, L2, W1, W2) · Cuadros verdes = Retazos útiles guardables en almacén`,
    {
      x: MARGIN,
      y: MARGIN + 4,
      size: 7.5,
      font: fontBold,
      color: rgb(0.4, 0.45, 0.5),
    },
  );
}

/**
 * Main export function: Generates vector PDF document for the entire CutPlan.
 */
export async function cutPlanPdfExport(input: CutPlanPdfExportInput): Promise<Uint8Array> {
  const plan = input.cutPlan;
  if (!plan || plan.sheets.length === 0) {
    throw new ValidationError('El plan de corte no contiene tableros para exportar.', {
      field: 'cutPlan',
    });
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const projectName = input.projectName || plan.projectName || plan.projectId;
  const customerName = input.customerName || '';

  // 1. Warehouse Cover Page
  renderWarehouseCoverPage(doc, input, font, fontBold);

  // 2. Individual Board Pages
  for (let sIdx = 0; sIdx < plan.sheets.length; sIdx++) {
    const sheet = plan.sheets[sIdx]!;
    renderBoardSheetPage(
      doc,
      sheet,
      sIdx,
      plan.sheets.length,
      plan.config,
      projectName,
      customerName,
      font,
      fontBold,
    );
  }

  return doc.save();
}
