/**
 * Production sectors: the workshop organization layer over the floor pipeline
 * (F092, Phase 0 of the sectors/roles plan — JD 2026-08-17).
 *
 * A sector owns one step of the physical manufacturing flow. Roles of the
 * floor (Fase 2) advance items only inside their sector; until then the
 * mapping below is the single source of truth for "which station produced
 * this status" used by visibility surfaces (plant board, project strip).
 */

import type { Project } from './types';
import {
  ITEM_FLOOR_STATUSES,
  normalizeItemFloorStatus,
  nextItemFloorStatus,
} from './productionFloor';
import type { ItemFloorStatus } from './productionFloor';

/**
 * Workshop sectors.
 *
 * - Pipeline sectors (cutting → installation) own one step of the
 *   manufacturing flow.
 * - `warehouse` stages materials before cutting (no floor status of its
 *   own yet).
 * - `herrajes`, `tableros`, `cintillas` are first-class material sectors
 *   for warehouse operators — each represents a material type the operator
 *   manages (F094 refined: no sub-sector nesting).
 * - `cnc` joins the pipeline when the `machined` status lands (Fase 3).
 */
export const PRODUCTION_SECTORS = [
  'warehouse',
  'cutting',
  'cnc',
  'edge_banding',
  'assembly',
  'packaging',
  'shipping',
  'installation',
  'herrajes',
  'tableros',
  'cintillas',
] as const;

export type ProductionSector = (typeof PRODUCTION_SECTORS)[number];

export function isProductionSector(value: string): value is ProductionSector {
  return (PRODUCTION_SECTORS as readonly string[]).includes(value);
}

export const PRODUCTION_SECTOR_LABELS_ES: Readonly<
  Record<ProductionSector, string>
> = {
  warehouse: 'Almacén',
  cutting: 'Corte',
  cnc: 'CNC',
  edge_banding: 'Encintado',
  assembly: 'Armado',
  packaging: 'Embalaje',
  shipping: 'Despacho',
  installation: 'Instalación',
  herrajes: 'Herrajes',
  tableros: 'Tableros',
  cintillas: 'Cintillas',
};

/**
 * Sectors that map onto the current 7-status pipeline, in manufacturing
 * order. Used for progress strips and the plant board.
 */
export const PIPELINE_SECTORS = [
  'cutting',
  'edge_banding',
  'assembly',
  'packaging',
  'shipping',
  'installation',
] as const;

export type PipelineSector = (typeof PIPELINE_SECTORS)[number];

const STATUS_TO_SECTOR: Readonly<Record<ItemFloorStatus, ProductionSector | null>> = {
  pending: null,
  cut: 'cutting',
  edged: 'edge_banding',
  assembled: 'assembly',
  packaged: 'packaging',
  loaded: 'shipping',
  installed: 'installation',
};

/** Sector that produces `status`; null while still queued (pending). */
export function sectorForFloorStatus(
  status: ItemFloorStatus,
): ProductionSector | null {
  return STATUS_TO_SECTOR[status];
}

/**
 * Floor status a sector produces. `warehouse` stages materials before
 * cutting and `cnc` waits for the `machined` status (Fase 3), so both
 * return null today.
 */
export function floorStatusForSector(
  sector: ProductionSector,
): ItemFloorStatus | null {
  for (const [status, owner] of Object.entries(STATUS_TO_SECTOR)) {
    if (owner === sector) return status as ItemFloorStatus;
  }
  return null;
}

/**
 * Items whose next pipeline step belongs to `sector` — the station queue.
 * `warehouse` claims queued (pending) items alongside `cutting`: staging
 * happens before the saw, cutting after it.
 */
export function itemsWaitingForSector(
  project: Project,
  sector: ProductionSector,
): Project['items'] {
  return project.items.filter((item) => {
    const current = normalizeItemFloorStatus(item.floorStatus);
    if (sector === 'warehouse') return current === 'pending';
    const target = floorStatusForSector(sector);
    if (!target) return false;
    return nextItemFloorStatus(current) === target;
  });
}

export type FloorStageProgress = {
  readonly sector: PipelineSector;
  /** Items that reached (or passed) this sector's status. */
  readonly done: number;
  /** Items waiting at this sector right now. */
  readonly waiting: number;
  readonly total: number;
};

export type ProjectFloorSummary = {
  readonly totalItems: number;
  readonly installedItems: number;
  readonly percentage: number;
  readonly stages: readonly FloorStageProgress[];
  /**
   * First pipeline sector with unfinished items (the bottleneck, in
   * manufacturing order) — the honest "where is this project right
   * now" answer derivable without events. Null when everything is
   * installed.
   */
  readonly activeSector: PipelineSector | null;
};

/**
 * Aggregate floor progress of a project, per sector, for visibility
 * surfaces (project strip, plant board). Pure derivation from item
 * floor statuses — no events required.
 */
export function buildProjectFloorSummary(project: Project): ProjectFloorSummary {
  const total = project.items.length;
  const byStatus = new Map<ItemFloorStatus, number>();
  for (const item of project.items) {
    const s = normalizeItemFloorStatus(item.floorStatus);
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const countAt = (s: ItemFloorStatus) => byStatus.get(s) ?? 0;

  const indexOf = (s: ItemFloorStatus) => ITEM_FLOOR_STATUSES.indexOf(s);
  const reachedOrPassed = (targetIdx: number) => {
    let done = 0;
    for (const [status, qty] of byStatus) {
      if (indexOf(status) >= targetIdx) done += qty;
    }
    return done;
  };

  const stages: FloorStageProgress[] = PIPELINE_SECTORS.map((sector) => {
    const target = floorStatusForSector(sector)!;
    const targetIdx = indexOf(target);
    return {
      sector,
      done: reachedOrPassed(targetIdx),
      waiting: countAt(
        targetIdx > 0 ? ITEM_FLOOR_STATUSES[targetIdx - 1]! : 'pending',
      ),
      total,
    };
  });

  const activeSector =
    stages.find((stage) => stage.done < stage.total)?.sector ?? null;

  const percentage =
    total > 0
      ? Math.round(
          (project.items.reduce((acc, item) => {
            const idx = indexOf(normalizeItemFloorStatus(item.floorStatus));
            return acc + idx / (ITEM_FLOOR_STATUSES.length - 1);
          }, 0) /
            total) *
            100,
        )
      : 0;

  return {
    totalItems: total,
    installedItems: countAt('installed'),
    percentage,
    stages,
    activeSector,
  };
}
