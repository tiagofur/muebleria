/**
 * F143 — geometría pura de las guías temporales de distancia durante el drag
 * de un mueble: el gap al vecino (o extremo de muro) más cercano. El caller
 * pasa cajas en coordenadas de plano (mm) — incluidos extremos de muro como
 * pares sintéticos de ancho cero. La escena lo dibuja como capa efímera; nada
 * se persiste ni toca el dominio.
 */

export type PlanBox = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export type DragGuide =
  | {
      /** Gap horizontal (a lo largo del muro): segmento en X a altura plana `atY`. */
      readonly kind: 'x';
      readonly fromX: number;
      readonly toX: number;
      readonly atY: number;
      readonly gapMm: number;
    }
  | {
    /** Gap vertical en plano (profundidad): segmento en Y a `atX`. */
    readonly kind: 'y';
    readonly fromY: number;
    readonly toY: number;
    readonly atX: number;
    readonly gapMm: number;
  };

export const DRAG_GUIDE_MAX_RANGE_MM = 150;

function intervalsOverlap(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): boolean {
  return aMin < bMax - 1 && aMax > bMin + 1;
}

/**
 * Gap (≥0) al par más cercano dentro del rango visible. Sólo cuenta pares que
 * comparten banda en el eje perpendicular (vecinos reales del mismo muro);
 * null cuando no hay ninguno lo bastante cerca.
 */
export function resolveDragGuide(
  dragged: PlanBox,
  peers: readonly PlanBox[],
  opts?: { readonly maxRangeMm?: number },
): DragGuide | null {
  const maxRange = opts?.maxRangeMm ?? DRAG_GUIDE_MAX_RANGE_MM;
  let best: DragGuide | null = null;
  let bestGap = Infinity;

  for (const peer of peers) {
    if (intervalsOverlap(dragged.minY, dragged.maxY, peer.minY, peer.maxY)) {
      // peer a la derecha → gap = peer.minX - dragged.maxX
      const gapRight = peer.minX - dragged.maxX;
      if (gapRight >= 0 && gapRight <= maxRange && gapRight < bestGap) {
        bestGap = gapRight;
        const overlapMinY = Math.max(dragged.minY, peer.minY);
        const overlapMaxY = Math.min(dragged.maxY, peer.maxY);
        best = {
          kind: 'x',
          fromX: dragged.maxX,
          toX: peer.minX,
          atY: (overlapMinY + overlapMaxY) / 2,
          gapMm: Math.round(gapRight),
        };
      }
      // peer a la izquierda
      const gapLeft = dragged.minX - peer.maxX;
      if (gapLeft >= 0 && gapLeft <= maxRange && gapLeft < bestGap) {
        bestGap = gapLeft;
        const overlapMinY = Math.max(dragged.minY, peer.minY);
        const overlapMaxY = Math.min(dragged.maxY, peer.maxY);
        best = {
          kind: 'x',
          fromX: peer.maxX,
          toX: dragged.minX,
          atY: (overlapMinY + overlapMaxY) / 2,
          gapMm: Math.round(gapLeft),
        };
      }
    }
    if (intervalsOverlap(dragged.minX, dragged.maxX, peer.minX, peer.maxX)) {
      const gapBack = peer.minY - dragged.maxY;
      if (gapBack >= 0 && gapBack <= maxRange && gapBack < bestGap) {
        bestGap = gapBack;
        const overlapMinX = Math.max(dragged.minX, peer.minX);
        const overlapMaxX = Math.min(dragged.maxX, peer.maxX);
        best = {
          kind: 'y',
          fromY: dragged.maxY,
          toY: peer.minY,
          atX: (overlapMinX + overlapMaxX) / 2,
          gapMm: Math.round(gapBack),
        };
      }
      const gapFront = dragged.minY - peer.maxY;
      if (gapFront >= 0 && gapFront <= maxRange && gapFront < bestGap) {
        bestGap = gapFront;
        const overlapMinX = Math.max(dragged.minX, peer.minX);
        const overlapMaxX = Math.min(dragged.maxX, peer.maxX);
        best = {
          kind: 'y',
          fromY: peer.maxY,
          toY: dragged.minY,
          atX: (overlapMinX + overlapMaxX) / 2,
          gapMm: Math.round(gapFront),
        };
      }
    }
  }
  return best;
}

/** Caja de un módulo en plano desde origen/tamaño/yaw (delegado fino de placementAabb). */
export function planBoxForModule(m: {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly depth: number;
  readonly yawDeg?: number;
}): PlanBox {
  const a = ((m.yawDeg ?? 0) % 360 + 360) % 360;
  if (a > 45 && a < 135) {
    return {
      minX: m.originX - m.depth,
      maxX: m.originX,
      minY: m.originY,
      maxY: m.originY + m.width,
    };
  }
  if (a >= 135 && a <= 225) {
    return {
      minX: m.originX - m.width,
      maxX: m.originX,
      minY: m.originY - m.depth,
      maxY: m.originY,
    };
  }
  if (a > 225 && a < 315) {
    return {
      minX: m.originX,
      maxX: m.originX + m.depth,
      minY: m.originY - m.width,
      maxY: m.originY,
    };
  }
  return {
    minX: m.originX,
    maxX: m.originX + m.width,
    minY: m.originY,
    maxY: m.originY + m.depth,
  };
}
