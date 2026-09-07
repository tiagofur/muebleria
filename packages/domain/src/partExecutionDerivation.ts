/**
 * Physical executions derivation from the catalog-resolved BOM (#301).
 *
 * The BOM resolution pipeline lives in TS (engine); this module turns a
 * released project + catalog into the physical PartInstances and
 * ModuleUnits the floor executes. CNC routing is not a guess: a piece
 * requires CNC when the project drilling resolver yields holes for it
 * (manual hardware placements + joint rules, projectDrilling.ts).
 */

import type { Catalog, Module, Project } from './types';
import { resolveBom } from './engine/bom';
import { effectiveOptionChoices } from './optionChoices';
import { baseContextForItem } from './plinth';
import { releaseAuthorityOf } from './releaseAuthority';
import { resolveProjectDrilling } from './projectDrilling';
import {
  derivePartInstancesForProject,
  deriveModuleUnitsForProject,
  type ModuleUnitExecution,
  type PartInstance,
} from './partExecution';

export const CANONICAL_PART_ROUTING_BLOCKER = 'La liberación no contiene evidencia congelada de rutas y maquinados. Ingeniería debe completar esa evidencia antes de generar o avanzar piezas.';

export type ProjectPartExecutions = {
  readonly parts: readonly PartInstance[];
  readonly units: readonly ModuleUnitExecution[];
};

export type DeriveProjectPartExecutionsError = {
  readonly projectItemId: string;
  readonly message: string;
};

export type DeriveProjectPartExecutionsResult =
  | { readonly ok: true; readonly executions: ProjectPartExecutions }
  | { readonly ok: false; readonly error: DeriveProjectPartExecutionsError };

/** Options of {@link deriveProjectPartExecutions}. */
export interface DeriveProjectPartExecutionsOptions {
  /**
   * Exact release authority token stamped on every part/unit (#577 /
   * OPS-DT-1): the canonical ProductionRelease id (or the legacy blob id for
   * pre-DT projects). Defaults to the project's resolved authority; never a
   * made-up token — the server 409s any execution stamped with a revision
   * that differs from the released one.
   */
  readonly productionRevision?: string;
}

/**
 * Derive the physical executions of a project from its catalog BOM.
 * Returns ok:false (instead of throwing) when an item cannot resolve, so
 * callers can surface which line blocks generation instead of losing the
 * whole release.
 */
export function deriveProjectPartExecutions(
  project: Project,
  catalog: Catalog,
  opts?: DeriveProjectPartExecutionsOptions,
): DeriveProjectPartExecutionsResult {
  // This adapter only resolves legacy project/catalog data. P1's immutable
  // snapshot currently contains BOM demand, not complete routing coverage.
  // An explicit release token cannot turn mutable input into frozen evidence.
  if (releaseAuthorityOf(project)?.source === 'canonical') {
    return {
      ok: false,
      error: {
        projectItemId: '',
        message: CANONICAL_PART_ROUTING_BLOCKER,
      },
    };
  }
  // 1. Board parts per item (same resolution as material summary / cut rows).
  const boardPartsByItem: Record<string, readonly import('./types').ResolvedBoardPart[]> = {};
  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      return {
        ok: false,
        error: { projectItemId: item.id, message: `cantidad inválida: ${item.quantity}` },
      };
    }
    const module: Module | undefined = catalog.modules.find((m) => m.id === item.moduleId);
    if (!module) {
      return {
        ok: false,
        error: { projectItemId: item.id, message: `módulo no encontrado: ${item.moduleId}` },
      };
    }
    try {
      const bom = resolveBom(
        module,
        effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
        catalog,
        item.measurePresetId,
        item.structureRevisionPin,
        baseContextForItem(project, item, catalog),
        item.customDims,
      );
      boardPartsByItem[item.id] = bom.boardParts;
    } catch (err) {
      return {
        ok: false,
        error: {
          projectItemId: item.id,
          message: err instanceof Error ? err.message : 'BOM no resoluble',
        },
      };
    }
  }

  // 2. CNC routing from real drilling: a piece needs CNC when its drilling
  //    pattern has holes (manual hardware + joint rules). Patterns map back
  //    to pieces through their cut-list link.
  const holesByPartId = new Map<string, number>();
  try {
    const drilling = resolveProjectDrilling({ project, catalog });
    for (const pattern of drilling.patterns) {
      const link = drilling.links.find((l) => l.labelRef === pattern.pieceCode);
      if (link) holesByPartId.set(link.partId, pattern.holes.length);
    }
  } catch {
    // Drilling is best-effort for routing: without it, pieces keep the
    // cut(+edge) route — the stations still work, CNC just never queues.
  }

  // 3. Physical expansion stamped with the exact release authority token:
  //    canonical ProductionRelease id first, legacy blob id only for pre-DT
  //    projects, empty only when nothing was ever released (#577 — the
  //    server guard 409s any token that differs from the released one).
  const revision = opts?.productionRevision ?? releaseAuthorityOf(project)?.releaseId ?? '';
  return {
    ok: true,
    executions: {
      parts: derivePartInstancesForProject(project, boardPartsByItem, {
        productionRevision: revision,
        hasMachiningForPart: (part) => (holesByPartId.get(part.id) ?? 0) > 0,
      }),
      units: deriveModuleUnitsForProject(project, { productionRevision: revision }),
    },
  };
}
