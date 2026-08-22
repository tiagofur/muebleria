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
  | { readonly kind: 'ceiling' }
  | { readonly kind: 'countertop' };

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
  readonly kind: 'floor' | 'wall' | 'ceiling' | 'countertop';
  readonly wallId?: string;
  readonly distance: number;
};

/**
 * Dado una lista de intersects resueltos (ordenados por distancia, el más
 * cercano primero), devuelve la superficie de pintura golpeada o null si
 * ninguno es una superficie pintable (piso/muro/techo/mesada).
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
    if (hit.kind === 'countertop') {
      return { kind: 'countertop' };
    }
  }
  return null;
}

/**
 * Valida que un material pueda aplicarse a una superficie.
 * Con el nuevo catálogo de Acabados 3D, todos los materiales son universales
 * y pueden aplicarse libremente a pisos, muros, techos y elementos 3D.
 */
export function canApplyMaterial(
  _materialSurfaceType: AmbientSurfaceType | undefined,
  _target: PaintSurface,
): boolean {
  return true;
}

/**
 * Payload que viaja en el dataTransfer del drag HTML5 de la paleta.
 */
export const PAINT_DRAG_MIME = 'application/x-muebles-paint';

export type PaintDragPayload = {
  readonly materialId: string;
  readonly surfaceType?: AmbientSurfaceType;
};

/** Serializa el payload del drag a JSON string. */
export function encodePaintDrag(payload: PaintDragPayload): string {
  return JSON.stringify(payload);
}

/** Deserializa el payload del drag; devuelve null si está corrupto/vacío. */
export function decodePaintDrag(raw: string | null): PaintDragPayload | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<PaintDragPayload>;
      if (typeof parsed.materialId === 'string' && parsed.materialId.length > 0) {
        if (
          parsed.surfaceType === undefined ||
          parsed.surfaceType === 'floor' ||
          parsed.surfaceType === 'wall' ||
          parsed.surfaceType === 'ceiling'
        ) {
          return { materialId: parsed.materialId, surfaceType: parsed.surfaceType };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  return { materialId: trimmed };
}

// ─── F065 Drag de ítem sin colocar → viewport 3D ────────────────────────────

/**
 * MIME type para arrastrar un ítem "sin colocar" desde la lista lateral al
 * viewport 3D. Diferente a PAINT_DRAG_MIME para que los handlers puedan
 * distinguir entre "pintar una superficie" y "colocar un módulo".
 */
export const UNPLACED_DRAG_MIME = 'application/x-muebles-unplaced';

/** Payload del drag de ítems sin colocar. */
export type UnplacedDragPayload = {
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
};

/** Serializa el payload de un ítem sin colocar. */
export function encodeUnplacedDrag(payload: UnplacedDragPayload): string {
  return JSON.stringify(payload);
}

/** Deserializa el payload de un ítem sin colocar; devuelve null si corrupto. */
export function decodeUnplacedDrag(
  raw: string | null,
): UnplacedDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UnplacedDragPayload>;
    if (
      typeof parsed.itemId === 'string' &&
      typeof parsed.instanceIndex === 'number' &&
      typeof parsed.widthMm === 'number' &&
      typeof parsed.heightMm === 'number' &&
      typeof parsed.depthMm === 'number'
    ) {
      return {
        itemId: parsed.itemId,
        instanceIndex: parsed.instanceIndex,
        widthMm: parsed.widthMm,
        heightMm: parsed.heightMm,
        depthMm: parsed.depthMm,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── F141 Drag de tarjeta de biblioteca → viewport 3D ───────────────────────

/**
 * MIME type para arrastrar un módulo del catálogo (biblioteca) al viewport.
 * Distinto de UNPLACED_DRAG_MIME porque el ítem todavía no existe: el drop
 * crea el ProjectItem y lo coloca en la misma operación (inserción atómica).
 */
export const LIBRARY_DRAG_MIME = 'application/x-muebles-library';

/** Payload del drag de una tarjeta de la biblioteca. */
export type LibraryDragPayload = {
  readonly moduleId: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
};

/** Serializa el payload de una tarjeta de biblioteca. */
export function encodeLibraryDrag(payload: LibraryDragPayload): string {
  return JSON.stringify(payload);
}

/** Deserializa el payload de biblioteca; devuelve null si corrupto. */
export function decodeLibraryDrag(
  raw: string | null,
): LibraryDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LibraryDragPayload>;
    if (
      typeof parsed.moduleId === 'string' &&
      parsed.moduleId.length > 0 &&
      typeof parsed.widthMm === 'number' &&
      typeof parsed.heightMm === 'number' &&
      typeof parsed.depthMm === 'number'
    ) {
      return {
        moduleId: parsed.moduleId,
        widthMm: parsed.widthMm,
        heightMm: parsed.heightMm,
        depthMm: parsed.depthMm,
      };
    }
    return null;
  } catch {
    return null;
  }
}
