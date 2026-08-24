/**
 * Wall elevations PDF for production (PROD-1.1).
 * One A4 landscape page per wall + optional unplaced appendix.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  buildProductionElevations,
  type Module,
  type Project,
  type ProductionElevationsResult,
  type ProductionIslandUnit,
  type ProductionWallElevation,
} from '@muebles/domain';

export type WallElevationsPdfInput = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly customerName?: string;
};

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
/** Print-friendly margin (~12 mm) for shop printers. */
const MARGIN = 40;

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = rgb(0.1, 0.1, 0.12),
): void {
  // pdf-lib WinAnsi cannot encode all unicode; strip risky chars.
  const safe = text.replace(/[^\x20-\x7EÁÉÍÓÚáéíóúÑñÜü°×·]/g, '?');
  try {
    page.drawText(safe, { x, y, size, font, color });
  } catch {
    page.drawText(safe.replace(/[^\x20-\x7E]/g, '?'), {
      x,
      y,
      size,
      font,
      color,
    });
  }
}

function drawWallPage(
  page: PDFPage,
  wall: ProductionWallElevation,
  projectName: string,
  customerName: string | undefined,
  font: PDFFont,
  fontBold: PDFFont,
): void {
  let y = PAGE_H - MARGIN;
  drawText(page, 'ELEVACION DE MURO — PRODUCCION', MARGIN, y, fontBold, 14, rgb(0.1, 0.25, 0.45));
  y -= 16;
  drawText(page, `Proyecto: ${projectName}`, MARGIN, y, fontBold, 10);
  y -= 12;
  if (customerName) {
    drawText(page, `Cliente: ${customerName}`, MARGIN, y, font, 9);
    y -= 12;
  }
  drawText(
    page,
    `${wall.wallName}  ·  largo ${wall.wallLengthMm} mm  ·  ${wall.units.length} modulo(s)`,
    MARGIN,
    y,
    fontBold,
    11,
  );
  y -= 20;

  // Drawing area
  const drawLeft = MARGIN + 20;
  const drawRight = PAGE_W - MARGIN - 20;
  const drawBottom = MARGIN + 80;
  const drawTop = y - 10;
  const drawW = drawRight - drawLeft;
  const drawH = drawTop - drawBottom;

  const maxZ = Math.max(
    2200,
    ...wall.units.map((u) => u.bottomZMm + u.heightMm + 100),
  );
  const scaleX = drawW / Math.max(wall.wallLengthMm, 1);
  const scaleY = drawH / maxZ;

  // Floor line
  page.drawLine({
    start: { x: drawLeft, y: drawBottom },
    end: { x: drawRight, y: drawBottom },
    thickness: 1.5,
    color: rgb(0.2, 0.2, 0.22),
  });
  drawText(page, '0', drawLeft - 14, drawBottom - 4, font, 7);
  drawText(
    page,
    `${wall.wallLengthMm}`,
    drawRight - 20,
    drawBottom - 12,
    font,
    7,
  );
  drawText(page, 'mm', drawRight + 4, drawBottom - 12, font, 7);

  // Modules as rectangles
  for (const u of wall.units) {
    const x = drawLeft + u.offsetMm * scaleX;
    const w = Math.max(u.widthMm * scaleX, 4);
    const h = Math.max(u.heightMm * scaleY, 4);
    const by = drawBottom + u.bottomZMm * scaleY;

    const fill =
      u.elevation === 'wall'
        ? rgb(0.85, 0.9, 0.95)
        : rgb(0.93, 0.9, 0.85);
    page.drawRectangle({
      x,
      y: by,
      width: w,
      height: h,
      borderWidth: 1,
      borderColor: rgb(0.15, 0.2, 0.3),
      color: fill,
    });

    const label = u.label.length > 18 ? `${u.label.slice(0, 16)}…` : u.label;
    if (w > 28) {
      drawText(page, label, x + 2, by + h / 2 - 3, font, 7);
    }
    // Width dimension under unit
    drawText(
      page,
      `${u.widthMm}`,
      x + Math.max(0, w / 2 - 10),
      by - 10,
      font,
      6,
    );
  }

  // Legend
  let ly = MARGIN + 50;
  drawText(page, 'Leyenda: base (beige) · alto/muro (azul) · cotas en mm', MARGIN, ly, font, 8);
  ly -= 12;
  if (wall.units.length === 0) {
    drawText(page, 'Sin modulos colocados en este muro.', MARGIN, ly, font, 9);
  } else {
    for (const u of wall.units.slice(0, 12)) {
      drawText(
        page,
        `${u.label}  ${u.widthMm}x${u.heightMm} mm  offset ${u.offsetMm}  ${u.elevation === 'wall' ? 'alto' : 'base'}`,
        MARGIN,
        ly,
        font,
        7,
      );
      ly -= 9;
    }
  }
}

/**
 * Island sheet (#255): one page per free-place unit — simple front elevation
 * with measures, code and plan position. Islands never project onto wall
 * elevations, so this is their replacement artifact for the shop.
 */
function drawIslandPage(
  page: PDFPage,
  island: ProductionIslandUnit,
  projectName: string,
  customerName: string | undefined,
  font: PDFFont,
  fontBold: PDFFont,
): void {
  let y = PAGE_H - MARGIN;
  drawText(page, 'FICHA DE ISLA — PRODUCCION', MARGIN, y, fontBold, 14, rgb(0.1, 0.25, 0.45));
  y -= 16;
  drawText(page, `Proyecto: ${projectName}`, MARGIN, y, fontBold, 10);
  y -= 12;
  if (customerName) {
    drawText(page, `Cliente: ${customerName}`, MARGIN, y, font, 9);
    y -= 12;
  }
  drawText(
    page,
    `Isla ${island.label}  ·  ${island.moduleName}  ·  Ambiente: ${island.spaceName}`,
    MARGIN,
    y,
    fontBold,
    11,
  );
  y -= 20;

  // Drawing area — single centered unit
  const drawLeft = MARGIN + 60;
  const drawRight = PAGE_W - MARGIN - 120;
  const drawBottom = MARGIN + 80;
  const drawTop = y - 10;
  const drawW = drawRight - drawLeft;
  const drawH = drawTop - drawBottom;

  const maxZ = Math.max(1600, island.bottomZMm + island.heightMm + 160);
  const scaleX = Math.min(drawW / Math.max(island.widthMm, 1), 0.5);
  const scaleY = drawH / maxZ;

  const w = Math.max(island.widthMm * scaleX, 8);
  const x = drawLeft + (drawW - w) / 2;

  // Floor line
  page.drawLine({
    start: { x: drawLeft, y: drawBottom },
    end: { x: drawRight, y: drawBottom },
    thickness: 1.5,
    color: rgb(0.2, 0.2, 0.22),
  });
  drawText(page, 'piso', drawLeft, drawBottom - 12, font, 7);

  // Island body (beige — floor unit family, same legend as walls)
  const by = drawBottom + island.bottomZMm * scaleY;
  const h = Math.max(island.heightMm * scaleY, 8);
  page.drawRectangle({
    x,
    y: by,
    width: w,
    height: h,
    borderWidth: 1,
    borderColor: rgb(0.15, 0.2, 0.3),
    color: rgb(0.93, 0.9, 0.85),
  });

  const label = island.label.length > 18 ? `${island.label.slice(0, 16)}…` : island.label;
  if (w > 28) {
    drawText(page, label, x + 2, by + h / 2 - 3, font, 8);
  }
  // Width dimension under unit; height at its right
  drawText(page, `${island.widthMm}`, x + Math.max(0, w / 2 - 10), by - 10, font, 7);
  drawText(page, `${island.heightMm}`, x + w + 6, by + h / 2, font, 7);
  if (island.baseClearanceMm > 0) {
    drawText(page, `zoclo ${island.baseClearanceMm}`, x + 2, by + 2, font, 6);
  }

  // Info block
  let ly = MARGIN + 50;
  drawText(
    page,
    `Medidas: ${island.widthMm} x ${island.heightMm} x ${island.depthMm} mm (ancho x alto x fondo)`,
    MARGIN,
    ly,
    font,
    8,
  );
  ly -= 12;
  drawText(
    page,
    `Posicion en planta: X ${island.freeXMm} mm  ·  Y ${island.freeYMm} mm  ·  rotacion ${island.freeYawDeg}°`,
    MARGIN,
    ly,
    font,
    8,
  );
  ly -= 12;
  drawText(
    page,
    'Ubicacion libre — no se proyecta en alzados de muro.',
    MARGIN,
    ly,
    font,
    8,
  );
}

/**
 * Generate multi-page elevations PDF: one page per wall, one sheet per
 * free-place island, and an unplaced appendix. Throws when the layout has
 * neither walls nor islands.
 */
export async function wallElevationsPdfExport(
  input: WallElevationsPdfInput,
): Promise<Uint8Array> {
  const elevations = buildProductionElevations(input.project, input.modules);
  if (elevations.walls.length === 0 && elevations.islands.length === 0) {
    throw new Error(
      'Sin muros ni islas en el layout — no hay elevaciones de produccion para exportar',
    );
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const wall of elevations.walls) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawWallPage(
      page,
      wall,
      input.project.name,
      input.customerName,
      font,
      fontBold,
    );
  }

  // #255: islands get their own sheets — included in the production pack.
  for (const island of elevations.islands) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawIslandPage(
      page,
      island,
      input.project.name,
      input.customerName,
      font,
      fontBold,
    );
  }

  // Appendix: unplaced (islas ya tienen su hoja propia)
  if (elevations.unplaced.length > 0) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    drawText(page, 'ANEXO — SIN COLOCAR', MARGIN, y, fontBold, 12);
    y -= 18;
    drawText(
      page,
      'No se inventan posiciones en las elevaciones de muro.',
      MARGIN,
      y,
      font,
      9,
    );
    y -= 16;
    drawText(page, 'Sin colocar en plano:', MARGIN, y, fontBold, 10);
    y -= 12;
    for (const u of elevations.unplaced) {
      drawText(page, `· ${u.label} (${u.moduleCode})`, MARGIN + 8, y, font, 9);
      y -= 11;
      if (y < MARGIN) break;
    }
  }

  return doc.save();
}

export type { ProductionElevationsResult };
