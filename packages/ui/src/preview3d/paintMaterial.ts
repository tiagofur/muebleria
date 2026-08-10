/**
 * paintMaterial — tipos y lógica pura para drag-apply de materiales ambientales
 * (piso/muro) en el 3D. F067.
 *
 * La función `resolvePaintSurface` es deliberadamente pura y no toca Three.js
 * directamente: recibe los intersects ya resueltos por el raycaster del caller
 * y decide qué superficie fue golpeada. Así es testeable en jsdom sin WebGL.
 */

import type { AmbientSurfaceType } from '@muebles/domain';

/** Superficie objetivo de un drop de material. */
export type PaintSurface =
  | { readonly kind: 'floor' }
  | { readonly kind: 'wall'; readonly wallId: string }
  | { readonly kind: 'ceiling' };

/** Resultado de un drop válido. */
export type PaintDrop = {
  readonly materialId: string;
  readonly surface: PaintSurface;
};

/**
 * Un intersect ya resuelto por el raycaster, normalizado para no acoplarse
 * a la API de THREE.Intersection (que trae Object3D completo). El caller
 * extrae `userData` del mesh golpeado y lo pasa como `kind` + `wallId`.
 */
export type ResolvedIntersect = {
  readonly kind: 'floor' | 'wall' | 'ceiling';
  readonly wallId?: string;
  readonly distance: number;
};

/**
 * Dado una lista de intersects resueltos (ordenados por distancia, el más
 * cercano primero), devuelve la superficie de pintura golpeada o null si
 * ninguno es una superficie pintable (piso/muro/techo).
 */
export function resolvePaintSurface(
  intersects: readonly ResolvedIntersect[],
): PaintSurface | null {
  for (const hit of intersects) {
    if (hit.kind === 'floor') {
      return { kind: 'floor' };
    }
    if (hit.kind === 'wall' && hit.wallId) {
      return { kind: 'wall', wallId: hit.wallId };
    }
    if (hit.kind === 'ceiling') {
      return { kind: 'ceiling' };
    }
  }
  return null;
}

/**
 * Valida que un material pueda aplicarse a una superficie según su
 * surfaceType. Los ambient materials tienen surfaceType 'floor'|'wall'|'ceiling'.
 */
export function canApplyMaterial(
  materialSurfaceType: AmbientSurfaceType,
  target: PaintSurface,
): boolean {
  if (target.kind === 'floor') return materialSurfaceType === 'floor';
  if (target.kind === 'ceiling') return materialSurfaceType === 'ceiling';
  return materialSurfaceType === 'wall';
}

/**
 * Payload que viaja en el dataTransfer del drag HTML5 de la paleta.
 */
export const PAINT_DRAG_MIME = 'application/x-muebles-paint';

export type PaintDragPayload = {
  readonly materialId: string;
  readonly surfaceType: AmbientSurfaceType;
};

/** Serializa el payload del drag a JSON string. */
export function encodePaintDrag(payload: PaintDragPayload): string {
  return JSON.stringify(payload);
}

/** Deserializa el payload del drag; devuelve null si está corrupto/vacío. */
export function decodePaintDrag(raw: string | null): PaintDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PaintDragPayload>;
    if (
      typeof parsed.materialId === 'string' &&
      (parsed.surfaceType === 'floor' || parsed.surfaceType === 'wall')
    ) {
      return { materialId: parsed.materialId, surfaceType: parsed.surfaceType };
    }
    return null;
  } catch {
    return null;
  }
}
