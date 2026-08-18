/**
 * Compras / Almacén — picking domain (Fase 3, MVP).
 *
 * The warehouse workspace shows what each active project NEEDS per material
 * type (herrajes / tableros / cintillas) — no real stock yet. The picking
 * status below is the persistence contract for a future phase; today the
 * screen keeps it in local state (no storage).
 */

/** Material types with a picking list per project. */
export const PICKING_MATERIALS = ['herrajes', 'tableros', 'cintillas'] as const;

export type PickingMaterial = (typeof PICKING_MATERIALS)[number];

/** Picking status of a project's material list. */
export type PickingStatus = 'pendiente' | 'despachado';

export const PICKING_STATUS_LABELS_ES: Readonly<Record<PickingStatus, string>> = {
  pendiente: 'Pendiente',
  despachado: 'Despachado',
};

/**
 * One project × material picking state. Not persisted yet — this is the
 * contract for the future storage phase (markedBy = user email).
 */
export type ProjectPickingState = {
  readonly projectId: string;
  readonly material: PickingMaterial;
  readonly status: PickingStatus;
  /** ISO timestamp when marked despachado. */
  readonly markedAt?: string;
  /** User email that marked the pick. */
  readonly markedBy?: string;
};

/** Local-state key: `${projectId}:${material}` (MVP — no persistence). */
export function pickingKey(
  projectId: string,
  material: PickingMaterial,
): string {
  return `${projectId}:${material}`;
}
