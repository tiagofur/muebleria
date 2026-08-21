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
  totalItems: number;
  installedItems: number;
  percentage: number;
  readonly stages: readonly FloorStageProgress[];
  /**
   * First pipeline sector with unfinished items (the bottleneck, in
   * manufacturing order) — the honest "where is this project right
   * now" answer derivable without events. Null when everything is
   * installed.
   */
  readonly activeSector: PipelineSector | null;
  /**
   * Counting mode (#301 DoD): `physical` when the project has generated
   * part instances + module units — pre-assembly stages count PIECES,
   * assembly+ stages count UNITS. `items` is the legacy line-level count.
   */
  readonly countMode: 'items' | 'physical';
  readonly totalParts?: number;
  readonly totalUnits?: number;
};

/**
 * Aggregate floor progress of a project, per sector, for visibility
 * surfaces (project strip, plant board). Pure derivation — no events
 * required. With physical executions present, counts switch to workshop
 * granularity: pieces until edge banding, units from assembly on.
 */
export function buildProjectFloorSummary(project: Project): ProjectFloorSummary {
  const parts = project.partInstances ?? [];
  const units = project.moduleUnits ?? [];
  if (parts.length > 0 && units.length > 0) {
    return buildPhysicalFloorSummary(parts, units);
  }

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
    countMode: 'items',
  };
}

/**
 * Physical stage counts (#301 DoD): cutting/edge count PIECES (a piece with
 * no CNC route moves straight from cut to ready — it never queues at CNC),
 * assembly+ counts UNITS. done = reached-or-passed, waiting = sitting at the
 * station right now.
 */
const PHYSICAL_UNIT_ORDER = [
  'awaiting_parts',
  'assembly',
  'module_qc',
  'packaged',
  'loaded',
  'installed',
] as const;

function physicalUnitRank(status: string): number {
  const i = PHYSICAL_UNIT_ORDER.indexOf(status as (typeof PHYSICAL_UNIT_ORDER)[number]);
  return i < 0 ? 0 : i;
}

type PhysicalPartView = {
  readonly cutCompleted: boolean;
  readonly readyForAssembly: boolean;
  readonly currentOp: string | undefined;
};

/** Min unit rank each sector considers "passed": assembly passed = module_qc+. */
const PHYSICAL_SECTOR_PASS_RANK: Readonly<Record<PipelineSector, number>> = {
  cutting: -1,
  edge_banding: -1,
  assembly: 2,
  packaging: 3,
  shipping: 4,
  installation: 5,
};

/** Exact unit rank each sector considers "waiting here now". */
const PHYSICAL_SECTOR_WAIT_RANK: Readonly<Record<PipelineSector, number>> = {
  cutting: -1,
  edge_banding: -1,
  assembly: 1,
  packaging: 2,
  shipping: 3,
  installation: 4,
};

function buildPhysicalFloorSummary(
  parts: NonNullable<Project['partInstances']>,
  units: NonNullable<Project['moduleUnits']>,
): ProjectFloorSummary {
  const partViews: readonly PhysicalPartView[] = parts.map((p) => {
    const activeOp = p.requiredOperations[p.currentOperationIndex];
    const opIsActive =
      activeOp !== undefined &&
      (activeOp.status === 'queued' || activeOp.status === 'in_progress' || activeOp.status === 'rework');
    return {
      cutCompleted: p.requiredOperations.some(
        (op) => op.type === 'cut' && op.status === 'completed',
      ),
      readyForAssembly: p.status === 'ready_for_assembly' || p.status === 'assembled',
      currentOp: opIsActive ? activeOp.type : undefined,
    };
  });
  const unitViews: readonly { status: string }[] = units.map((u) => ({ status: u.status }));

  const stages: FloorStageProgress[] = PIPELINE_SECTORS.map((sector) => {
    const isPartStage = sector === 'cutting' || sector === 'edge_banding';
    const total = isPartStage ? partViews.length : units.length;
    let done: number;
    let waiting: number;
    if (sector === 'cutting') {
      done = partViews.filter((p) => p.cutCompleted).length;
      waiting = partViews.filter((p) => p.currentOp === 'cut').length;
    } else if (sector === 'edge_banding') {
      done = partViews.filter((p) => p.readyForAssembly).length;
      waiting = partViews.filter(
        (p) => p.currentOp === 'cnc' || p.currentOp === 'edge_banding',
      ).length;
    } else {
      const passRank = PHYSICAL_SECTOR_PASS_RANK[sector];
      const waitRank = PHYSICAL_SECTOR_WAIT_RANK[sector];
      done = unitViews.filter((u) => physicalUnitRank(u.status) >= passRank).length;
      waiting = unitViews.filter((u) => physicalUnitRank(u.status) === waitRank).length;
    }
    return { sector, done, waiting, total };
  });

  const scored = stages.filter((s) => s.total > 0);
  const percentage =
    scored.length > 0
      ? Math.round((scored.reduce((acc, s) => acc + s.done / s.total, 0) / scored.length) * 100)
      : 0;
  const activeSector =
    stages.find((stage) => stage.total > 0 && stage.done < stage.total)?.sector ?? null;

  return {
    totalItems: units.length,
    installedItems: units.filter((u) => u.status === 'installed').length,
    percentage,
    stages,
    activeSector,
    countMode: 'physical',
    totalParts: partViews.length,
    totalUnits: units.length,
  };
}

