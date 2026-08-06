/**
 * Import kitchen plan geometry from simple CAD exports (DXF) and helpers for
 * image underlays. Pure domain — no fs/network.
 */

import type { KitchenPlanUnderlay, KitchenWall } from './types';

/** Default assumed span when the user drops an image without scale. */
export const DEFAULT_UNDERLAY_WIDTH_MM = 5000;
export const DEFAULT_UNDERLAY_HEIGHT_MM = 4000;

export type DxfImportResult = {
  readonly walls: readonly KitchenWall[];
  readonly warnings: readonly string[];
  /** How many LINE / LWPOLYLINE segments were considered. */
  readonly segmentCount: number;
};

export type ParseDxfOptions = {
  readonly newId: () => string;
  /** Drop segments shorter than this (mm). Default 50. */
  readonly minLengthMm?: number;
  /**
   * Snap angles near cardinals (0/90/180/270) within this tolerance (deg).
   * Default 8.
   */
  readonly snapToleranceDeg?: number;
  /**
   * DXF units often are mm already; if drawing is in meters, set unitScale to 1000.
   * Default 1 (assume mm).
   */
  readonly unitScale?: number;
};

type DxfLine = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

/**
 * Parse a minimal ASCII DXF (LINE + LWPOLYLINE closed/open) into kitchen walls.
 * Not a full CAD importer — workshop plans with axis-aligned walls work best.
 */
export function parseDxfToKitchenWalls(
  dxfText: string,
  options: ParseDxfOptions,
): DxfImportResult {
  const warnings: string[] = [];
  const text = dxfText.replace(/^\uFEFF/, '');
  if (!text.trim()) {
    return { walls: [], warnings: ['Archivo DXF vacío.'], segmentCount: 0 };
  }
  if (!/^\s*0\s*$/m.test(text) && !text.includes('SECTION')) {
    warnings.push(
      'El archivo no parece un DXF ASCII (falta estructura 0/SECTION).',
    );
  }

  const pairs = parseDxfPairs(text);
  const lines = extractLinesFromPairs(pairs);
  const minLen = Math.max(1, options.minLengthMm ?? 50);
  const snapTol = Math.max(0, options.snapToleranceDeg ?? 8);
  const scale = Number.isFinite(options.unitScale) ? (options.unitScale as number) : 1;

  const walls: KitchenWall[] = [];
  let considered = 0;
  for (const line of lines) {
    considered += 1;
    const x1 = line.x1 * scale;
    const y1 = line.y1 * scale;
    const x2 = line.x2 * scale;
    const y2 = line.y2 * scale;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < minLen) continue;
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    angleDeg = snapCardinalAngle(angleDeg, snapTol);
    // Recompute axis-aligned end so walls stay orthogonal when snapped.
    const rad = (angleDeg * Math.PI) / 180;
    const endX = x1 + Math.cos(rad) * length;
    const endY = y1 + Math.sin(rad) * length;
    // Prefer origin at min corner along run for +X/+Y walls.
    let originX = x1;
    let originY = y1;
    let finalAngle = angleDeg;
    let finalLen = length;
    if (angleDeg === 180 || angleDeg === 270) {
      // Flip so wall direction is +X or +Y from origin.
      originX = endX;
      originY = endY;
      finalAngle = angleDeg === 180 ? 0 : 90;
      // length unchanged
    } else if (angleDeg === 0 || angleDeg === 90) {
      originX = x1;
      originY = y1;
      finalAngle = angleDeg;
    } else {
      originX = x1;
      originY = y1;
      finalAngle = angleDeg;
    }
    walls.push({
      id: options.newId(),
      lengthMm: Math.max(1, Math.round(finalLen)),
      angleDeg: finalAngle,
      originXMm: Math.round(originX),
      originYMm: Math.round(originY),
      name: `Muro ${walls.length + 1}`,
    });
  }

  if (walls.length === 0) {
    warnings.push(
      considered === 0
        ? 'No se encontraron líneas LINE/LWPOLYLINE en el DXF.'
        : `Se leyeron ${considered} segmentos pero todos midieron menos de ${minLen} mm (¿unidades en metros? probá escala 1000).`,
    );
  } else if (walls.length > 40) {
    warnings.push(
      `Se importaron ${walls.length} muros — revisá superposiciones o capas de detalle.`,
    );
  }

  return { walls, warnings, segmentCount: considered };
}

/**
 * Build underlay metadata for an imported plan image.
 * Caller supplies pixel size; default mm span keeps a usable kitchen scale.
 */
export function createPlanUnderlay(params: {
  readonly imageUrl: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly widthMm?: number;
  readonly fileName?: string;
  readonly opacity?: number;
}): KitchenPlanUnderlay {
  const pxW = Math.max(1, Math.round(params.pixelWidth));
  const pxH = Math.max(1, Math.round(params.pixelHeight));
  const widthMm = Math.max(
    100,
    Math.round(params.widthMm ?? DEFAULT_UNDERLAY_WIDTH_MM),
  );
  const heightMm = Math.max(
    100,
    Math.round((widthMm * pxH) / pxW),
  );
  return {
    imageUrl: params.imageUrl,
    widthMm,
    heightMm,
    originXMm: 0,
    originYMm: 0,
    opacity:
      params.opacity === undefined
        ? 0.45
        : Math.min(1, Math.max(0.05, params.opacity)),
    ...(params.fileName ? { fileName: params.fileName } : {}),
  };
}

/** Scale underlay so its width becomes `widthMm` (keeps aspect). */
export function scalePlanUnderlay(
  underlay: KitchenPlanUnderlay,
  widthMm: number,
): KitchenPlanUnderlay {
  const w = Math.max(100, Math.round(widthMm));
  const aspect = underlay.heightMm / Math.max(1, underlay.widthMm);
  return {
    ...underlay,
    widthMm: w,
    heightMm: Math.max(100, Math.round(w * aspect)),
  };
}

// --- DXF internals ---

function parseDxfPairs(text: string): Array<{ code: number; value: string }> {
  const lines = text.split(/\r?\n/);
  const pairs: Array<{ code: number; value: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!.trim();
    // Skip blank lines without desyncing group code / value pairs.
    if (raw === '') {
      i += 1;
      continue;
    }
    const code = Number.parseInt(raw, 10);
    if (!Number.isFinite(code)) {
      i += 1;
      continue;
    }
    const value = (lines[i + 1] ?? '').trim();
    pairs.push({ code, value });
    i += 2;
  }
  return pairs;
}

function extractLinesFromPairs(
  pairs: Array<{ code: number; value: string }>,
): DxfLine[] {
  const out: DxfLine[] = [];
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value.toUpperCase() === 'LINE') {
      const ent = readEntity(pairs, i + 1);
      i = ent.next;
      const x1 = ent.nums.get(10);
      const y1 = ent.nums.get(20);
      const x2 = ent.nums.get(11);
      const y2 = ent.nums.get(21);
      if (
        x1 !== undefined &&
        y1 !== undefined &&
        x2 !== undefined &&
        y2 !== undefined
      ) {
        out.push({ x1, y1, x2, y2 });
      }
      continue;
    }
    if (p.code === 0 && p.value.toUpperCase() === 'LWPOLYLINE') {
      const ent = readEntity(pairs, i + 1);
      i = ent.next;
      const verts = ent.vertices;
      if (verts.length >= 2) {
        const closed = (ent.nums.get(70) ?? 0) & 1;
        for (let v = 0; v < verts.length - 1; v++) {
          const a = verts[v]!;
          const b = verts[v + 1]!;
          out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
        if (closed && verts.length >= 3) {
          const a = verts[verts.length - 1]!;
          const b = verts[0]!;
          out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
      }
      continue;
    }
    i += 1;
  }
  return out;
}

function readEntity(
  pairs: Array<{ code: number; value: string }>,
  start: number,
): {
  next: number;
  nums: Map<number, number>;
  vertices: Array<{ x: number; y: number }>;
} {
  const nums = new Map<number, number>();
  const vertices: Array<{ x: number; y: number }> = [];
  let pendingX: number | undefined;
  let i = start;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0) break;
    if (p.code === 10) {
      const x = Number(p.value);
      if (Number.isFinite(x)) pendingX = x;
    } else if (p.code === 20 && pendingX !== undefined) {
      const y = Number(p.value);
      if (Number.isFinite(y)) {
        vertices.push({ x: pendingX, y });
      }
      // Also store last 10/20 for LINE-style single pairs.
      nums.set(10, pendingX);
      if (Number.isFinite(y)) nums.set(20, y);
      pendingX = undefined;
    } else {
      const n = Number(p.value);
      if (Number.isFinite(n)) nums.set(p.code, n);
    }
    i += 1;
  }
  // LINE end point 11/21 may already be in nums from generic path if we only
  // used 10/20 for vertices. Re-scan for 11/21 if missing.
  if (!nums.has(11) || !nums.has(21)) {
    for (let j = start; j < i; j++) {
      const p = pairs[j]!;
      if (p.code === 11 || p.code === 21) {
        const n = Number(p.value);
        if (Number.isFinite(n)) nums.set(p.code, n);
      }
    }
  }
  return { next: i, nums, vertices };
}

function snapCardinalAngle(angleDeg: number, toleranceDeg: number): number {
  let a = ((angleDeg % 360) + 360) % 360;
  const cards = [0, 90, 180, 270];
  for (const c of cards) {
    const d = Math.min(Math.abs(a - c), 360 - Math.abs(a - c));
    if (d <= toleranceDeg) return c;
  }
  // Normalize near-360 to 0
  if (a > 360 - toleranceDeg) return 0;
  return Math.round(a);
}
