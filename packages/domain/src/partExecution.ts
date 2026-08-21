/**
 * Physical Production Execution Models: Part Instances, Operations, Routing & Module Units.
 * Canonical implementation of docs/production-flow-v2.md & docs/operational-core-v1.md (OC-030..OC-034).
 *
 * Core physical invariant:
 * Cutting, CNC and Edge Banding operate on PIECES (PartInstance).
 * Assembly consumes finished pieces and produces MODULE UNITS (ModuleUnitExecution).
 * Packaging, Loading and Installation operate on Module Units / Packages.
 */

import type { EdgeAssignment, Grain, Project, ProjectItem, ResolvedBoardPart } from './types';
import type { ProductionSector } from './productionSectors';
import { type ItemFloorStatus, ITEM_FLOOR_STATUSES } from './productionFloor';

export const PART_OPERATION_TYPES = [
  'cut',
  'cnc',
  'edge_banding',
  'inspection',
] as const;

export type PartOperationType = (typeof PART_OPERATION_TYPES)[number];

export function isPartOperationType(value: string): value is PartOperationType {
  return (PART_OPERATION_TYPES as readonly string[]).includes(value);
}

export const PART_OPERATION_STATUSES = [
  'queued',
  'in_progress',
  'completed',
  'blocked',
  'rework',
  'skipped',
] as const;

export type PartOperationStatus = (typeof PART_OPERATION_STATUSES)[number];

export function isPartOperationStatus(value: string): value is PartOperationStatus {
  return (PART_OPERATION_STATUSES as readonly string[]).includes(value);
}

export const MODULE_UNIT_STATUSES = [
  'awaiting_parts',
  'assembly',
  'module_qc',
  'packaged',
  'loaded',
  'installed',
] as const;

export type ModuleUnitStatus = (typeof MODULE_UNIT_STATUSES)[number];

export function isModuleUnitStatus(value: string): value is ModuleUnitStatus {
  return (MODULE_UNIT_STATUSES as readonly string[]).includes(value);
}

/**
 * Allowed physical transitions between module unit statuses (OC-033).
 * Units move strictly forward: awaiting_parts → assembly → module_qc →
 * packaged → loaded → installed. Backwards moves require rework of pieces,
 * not a status change. Kept in parity with backend-go partExecution.go.
 */
export const MODULE_UNIT_STATUS_TRANSITIONS: Readonly<
  Record<ModuleUnitStatus, readonly ModuleUnitStatus[]>
> = {
  awaiting_parts: ['assembly'],
  assembly: ['module_qc'],
  module_qc: ['packaged'],
  packaged: ['loaded'],
  loaded: ['installed'],
  installed: [],
};

export function canTransitionModuleUnitStatus(
  from: ModuleUnitStatus,
  to: ModuleUnitStatus,
): boolean {
  return MODULE_UNIT_STATUS_TRANSITIONS[from].includes(to);
}

export function nextModuleUnitStatus(status: ModuleUnitStatus): ModuleUnitStatus | null {
  return MODULE_UNIT_STATUS_TRANSITIONS[status][0] ?? null;
}

export type PartOperation = {
  readonly id: string;
  readonly type: PartOperationType;
  readonly sequence: number;
  readonly status: PartOperationStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly operatorId?: string;
  readonly operatorName?: string;
  readonly machineId?: string;
  readonly notes?: string;
};

export type PartInstanceStatus =
  | 'pending'
  | 'in_progress'
  | 'ready_for_assembly'
  | 'assembled'
  | 'scrapped';

export type PartInstance = {
  readonly id: string;
  readonly projectId: string;
  readonly productionRevision: string;
  readonly projectItemId: string;
  readonly unitIndex: number;
  readonly partCode: string;
  readonly partDefinitionId?: string;
  readonly description: string;
  readonly materialId: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly grain: Grain;
  readonly edges: readonly EdgeAssignment[];
  readonly requiredOperations: readonly PartOperation[];
  readonly currentOperationIndex: number;
  readonly status: PartInstanceStatus;
};

export type SupervisorAssemblyOverride = {
  readonly overriddenBy: string;
  readonly overriddenAt: string;
  readonly reason: string;
  readonly missingPartsCount: number;
};

export type ModuleUnitExecution = {
  readonly id: string;
  readonly projectId: string;
  readonly projectItemId: string;
  readonly unitIndex: number;
  readonly productionRevision: string;
  readonly status: ModuleUnitStatus;
  readonly packageCount?: number;
  readonly supervisorOverride?: SupervisorAssemblyOverride;
  readonly assembledAt?: string;
  readonly qcPassedAt?: string;
  readonly packagedAt?: string;
  readonly loadedAt?: string;
  readonly installedAt?: string;
  readonly notes?: string;
};

export type AssemblyReadiness = {
  readonly isReady: boolean;
  readonly canStartWithOverride: boolean;
  readonly readyPieces: number;
  readonly totalPieces: number;
  readonly missingPieces: readonly PartInstance[];
  readonly blockers: readonly string[];
  readonly hasOverride: boolean;
};

export type DerivePartInstancesOptions = {
  readonly productionRevision?: string;
  readonly hasMachiningForPart?: (part: ResolvedBoardPart, item: ProjectItem) => boolean;
};

/**
 * Determine the ordered list of operations required for a given piece.
 * Skips CNC if piece has no machining / holes.
 * Skips edge banding if piece has no edge bands assigned.
 */
export function resolvePartRequiredOperations(
  part: ResolvedBoardPart,
  hasMachining = false,
): readonly PartOperation[] {
  const ops: PartOperation[] = [];
  let seq = 1;

  // 1. Cut is always step 1 (geometry generation from sheet)
  ops.push({
    id: `op-cut-${seq}`,
    type: 'cut',
    sequence: seq++,
    status: 'queued',
  });

  // 2. CNC / machining (only if required)
  if (hasMachining) {
    ops.push({
      id: `op-cnc-${seq}`,
      type: 'cnc',
      sequence: seq++,
      status: 'queued',
    });
  }

  // 3. Edge banding (only if at least one edge is enabled)
  const hasEdges = part.edges && part.edges.some((e) => Boolean(e && e.enabled));
  if (hasEdges) {
    ops.push({
      id: `op-edge-${seq}`,
      type: 'edge_banding',
      sequence: seq++,
      status: 'queued',
    });
  }

  return ops;
}

/**
 * Derive all discrete physical PartInstances for a project given resolved BOM board parts.
 * Multiplies item.quantity x resolvedPart.quantity to create distinct identifiable parts.
 */
export function derivePartInstancesForProject(
  project: Project,
  resolvedBoardPartsByItem: Readonly<Record<string, readonly ResolvedBoardPart[]>>,
  opts: DerivePartInstancesOptions = {},
): readonly PartInstance[] {
  const revision = opts.productionRevision ?? (project.productionRelease?.id || 'rev-1');
  const result: PartInstance[] = [];

  for (const item of project.items) {
    const parts = resolvedBoardPartsByItem[item.id] ?? [];
    const itemQty = Math.max(1, Math.floor(item.quantity || 1));

    for (let uIdx = 1; uIdx <= itemQty; uIdx++) {
      for (const piece of parts) {
        const pieceQty = Math.max(1, Math.floor(piece.quantity || 1));
        for (let pIdx = 1; pIdx <= pieceQty; pIdx++) {
          const partCode = piece.code || piece.id || `P${pIdx}`;
          const partId = `${project.id}_${item.id}_u${uIdx}_${partCode}_${pIdx}`;
          const hasMachining = opts.hasMachiningForPart?.(piece, item) ?? false;
          const operations = resolvePartRequiredOperations(piece, hasMachining);

          result.push({
            id: partId,
            projectId: project.id,
            productionRevision: revision,
            projectItemId: item.id,
            unitIndex: uIdx,
            partCode,
            partDefinitionId: piece.id,
            description: piece.description,
            materialId: piece.materialId,
            lengthMm: piece.lengthMm,
            widthMm: piece.widthMm,
            thicknessMm: piece.thicknessMm || 18,
            grain: piece.grain ?? 0,
            edges: piece.edges ?? [],
            requiredOperations: operations,
            currentOperationIndex: 0,
            status: 'pending',
          });
        }
      }
    }
  }

  return result;
}

/**
 * Derive discrete ModuleUnitExecutions for all project items (1 per physical unit).
 */
export function deriveModuleUnitsForProject(
  project: Project,
  opts: { readonly productionRevision?: string } = {},
): readonly ModuleUnitExecution[] {
  const revision = opts.productionRevision ?? (project.productionRelease?.id || 'rev-1');
  const result: ModuleUnitExecution[] = [];

  for (const item of project.items) {
    const itemQty = Math.max(1, Math.floor(item.quantity || 1));
    for (let uIdx = 1; uIdx <= itemQty; uIdx++) {
      const unitId = `${project.id}_${item.id}_u${uIdx}`;
      result.push({
        id: unitId,
        projectId: project.id,
        projectItemId: item.id,
        unitIndex: uIdx,
        productionRevision: revision,
        status: 'awaiting_parts',
      });
    }
  }

  return result;
}

/**
 * Advance an operation for a PartInstance.
 * If all operations are completed, the part status becomes 'ready_for_assembly'.
 */
export function advancePartOperation(
  part: PartInstance,
  operationType: PartOperationType,
  details: {
    readonly operatorId?: string;
    readonly operatorName?: string;
    readonly machineId?: string;
    readonly notes?: string;
    readonly at?: string;
  } = {},
): PartInstance {
  const opIdx = part.requiredOperations.findIndex(
    (op) => op.type === operationType && (op.status === 'queued' || op.status === 'in_progress'),
  );

  if (opIdx === -1) {
    return part;
  }

  // Physical stations are sequential per piece (cut → cnc → edge_banding):
  // an operation can only be completed when every previous operation in the
  // route is already completed or skipped.
  const previousOps = part.requiredOperations.slice(0, opIdx);
  const predecessorsDone = previousOps.every(
    (op) => op.status === 'completed' || op.status === 'skipped',
  );
  if (!predecessorsDone) {
    return part;
  }

  const timestamp = details.at ?? new Date().toISOString();
  const updatedOps = part.requiredOperations.map((op, idx) => {
    if (idx !== opIdx) return op;
    return {
      ...op,
      status: 'completed' as PartOperationStatus,
      completedAt: timestamp,
      operatorId: details.operatorId ?? op.operatorId,
      operatorName: details.operatorName ?? op.operatorName,
      machineId: details.machineId ?? op.machineId,
      notes: details.notes ?? op.notes,
    };
  });

  const nextOpIdx = updatedOps.findIndex((op) => op.status === 'queued' || op.status === 'in_progress');
  const allDone = updatedOps.every((op) => op.status === 'completed' || op.status === 'skipped');

  return {
    ...part,
    requiredOperations: updatedOps,
    currentOperationIndex: nextOpIdx >= 0 ? nextOpIdx : updatedOps.length - 1,
    status: allDone ? 'ready_for_assembly' : 'in_progress',
  };
}

/**
 * Check if a specific module unit is ready to begin assembly.
 *
 * Stale revision guard (docs/production-flow-v2.md §7): a unit may only be
 * assembled against the revision that is released today. When
 * `currentProductionRevision` is provided and differs from the unit's (or a
 * piece's) production revision, assembly is blocked until a supervisor
 * override is recorded — physical production never runs silently against a
 * stale revision.
 */
export function checkAssemblyReadiness(
  unit: ModuleUnitExecution,
  allProjectParts: readonly PartInstance[],
  opts: { readonly currentProductionRevision?: string } = {},
): AssemblyReadiness {
  const unitParts = allProjectParts.filter(
    (p) => p.projectItemId === unit.projectItemId && p.unitIndex === unit.unitIndex,
  );

  if (unitParts.length === 0) {
    return {
      isReady: false,
      canStartWithOverride: false,
      readyPieces: 0,
      totalPieces: 0,
      missingPieces: [],
      blockers: ['No hay piezas generadas para esta unidad'],
      hasOverride: false,
    };
  }

  const unitRevisionStale =
    opts.currentProductionRevision !== undefined &&
    unit.productionRevision !== opts.currentProductionRevision;
  const staleParts = unitParts.filter((p) => p.productionRevision !== unit.productionRevision);

  const readyPiecesList = unitParts.filter(
    (p) =>
      p.productionRevision === unit.productionRevision &&
      (p.status === 'ready_for_assembly' || p.status === 'assembled'),
  );
  const missingPiecesList = unitParts.filter(
    (p) =>
      p.productionRevision !== unit.productionRevision ||
      (p.status !== 'ready_for_assembly' && p.status !== 'assembled'),
  );
  const hasOverride = Boolean(unit.supervisorOverride);
  const isReady = (missingPiecesList.length === 0 && !unitRevisionStale) || hasOverride;

  const blockers: string[] = [];
  if (unitRevisionStale && !hasOverride) {
    blockers.push(
      `La revisión liberada (${opts.currentProductionRevision}) difiere de la revisión de la unidad (${unit.productionRevision})`,
    );
  }
  if (staleParts.length > 0 && !hasOverride) {
    blockers.push(`${staleParts.length} pieza(s) pertenecen a una revisión anterior`);
  }
  if (missingPiecesList.length > 0 && !hasOverride) {
    blockers.push(`Faltan ${missingPiecesList.length} piezas por terminar antes de armado`);
  }

  return {
    isReady,
    canStartWithOverride: !isReady,
    readyPieces: readyPiecesList.length,
    totalPieces: unitParts.length,
    missingPieces: missingPiecesList,
    blockers,
    hasOverride,
  };
}

/**
 * Roll up the assembly readiness of every physical unit of a project item
 * (OC-033: a qty=3 line is three independent units). Used by station cards
 * that still display one row per item — the item is only assembly-ready when
 * every one of its units is ready.
 */
export function aggregateAssemblyReadiness(
  units: readonly ModuleUnitExecution[],
  allProjectParts: readonly PartInstance[],
  opts: { readonly currentProductionRevision?: string } = {},
): AssemblyReadiness {
  if (units.length === 0) {
    return {
      isReady: false,
      canStartWithOverride: false,
      readyPieces: 0,
      totalPieces: 0,
      missingPieces: [],
      blockers: ['No hay unidades físicas generadas para esta línea'],
      hasOverride: false,
    };
  }

  const perUnit = units.map((unit) => checkAssemblyReadiness(unit, allProjectParts, opts));
  return {
    isReady: perUnit.every((r) => r.isReady),
    canStartWithOverride: perUnit.some((r) => r.canStartWithOverride),
    readyPieces: perUnit.reduce((sum, r) => sum + r.readyPieces, 0),
    totalPieces: perUnit.reduce((sum, r) => sum + r.totalPieces, 0),
    missingPieces: perUnit.flatMap((r) => r.missingPieces),
    blockers: perUnit.flatMap((r) => r.blockers),
    hasOverride: perUnit.some((r) => r.hasOverride),
  };
}

/**
 * Record a supervisor override allowing a module unit to enter assembly with incomplete parts (OC-032).
 */
export function recordSupervisorAssemblyOverride(
  unit: ModuleUnitExecution,
  reason: string,
  overriddenBy: string,
  missingPartsCount: number,
  overriddenAt?: string,
): ModuleUnitExecution {
  return {
    ...unit,
    supervisorOverride: {
      overriddenBy,
      overriddenAt: overriddenAt ?? new Date().toISOString(),
      reason,
      missingPartsCount,
    },
  };
}

/**
 * Filter pieces that are queued or in progress for a given manufacturing station.
 */
export function partsWaitingForSector(
  parts: readonly PartInstance[],
  sector: 'cutting' | 'cnc' | 'edge_banding',
): readonly PartInstance[] {
  const opTypeMap: Record<'cutting' | 'cnc' | 'edge_banding', PartOperationType> = {
    cutting: 'cut',
    cnc: 'cnc',
    edge_banding: 'edge_banding',
  };
  const targetOp = opTypeMap[sector];

  return parts.filter((part) => {
    if (part.status === 'ready_for_assembly' || part.status === 'assembled' || part.status === 'scrapped') {
      return false;
    }
    const currentOp = part.requiredOperations[part.currentOperationIndex];
    if (!currentOp) return false;
    return currentOp.type === targetOp && (currentOp.status === 'queued' || currentOp.status === 'in_progress' || currentOp.status === 'rework');
  });
}

/**
 * Filter module units that are waiting at a given assembly or logistics station.
 */
export function unitsWaitingForSector(
  units: readonly ModuleUnitExecution[],
  sector: 'assembly' | 'packaging' | 'shipping' | 'installation',
): readonly ModuleUnitExecution[] {
  const statusMap: Record<'assembly' | 'packaging' | 'shipping' | 'installation', ModuleUnitStatus> = {
    assembly: 'awaiting_parts',
    packaging: 'module_qc',
    shipping: 'packaged',
    installation: 'loaded',
  };
  const targetStatus = statusMap[sector];

  return units.filter((unit) => {
    if (sector === 'assembly') {
      return unit.status === 'awaiting_parts' || unit.status === 'assembly';
    }
    return unit.status === targetStatus;
  });
}

/**
 * Advance a ModuleUnitExecution status through assembly -> qc -> packaging -> loading -> installed.
 * Rejects invalid transitions (skips, backwards moves) by returning the unit
 * unchanged — the same convention as advancePartOperation.
 */
export function advanceModuleUnitStatus(
  unit: ModuleUnitExecution,
  targetStatus: ModuleUnitStatus,
  details: {
    readonly at?: string;
    readonly notes?: string;
  } = {},
): ModuleUnitExecution {
  if (targetStatus !== unit.status && !canTransitionModuleUnitStatus(unit.status, targetStatus)) {
    return unit;
  }

  const timestamp = details.at ?? new Date().toISOString();
  return {
    ...unit,
    status: targetStatus,
    notes: details.notes ?? unit.notes,
    assembledAt: targetStatus === 'assembly' || targetStatus === 'module_qc' ? (unit.assembledAt ?? timestamp) : unit.assembledAt,
    qcPassedAt: targetStatus === 'module_qc' || targetStatus === 'packaged' ? (unit.qcPassedAt ?? timestamp) : unit.qcPassedAt,
    packagedAt: targetStatus === 'packaged' || targetStatus === 'loaded' ? (unit.packagedAt ?? timestamp) : unit.packagedAt,
    loadedAt: targetStatus === 'loaded' || targetStatus === 'installed' ? (unit.loadedAt ?? timestamp) : unit.loadedAt,
    installedAt: targetStatus === 'installed' ? (unit.installedAt ?? timestamp) : unit.installedAt,
  };
}

/**
 * Reopen a piece for rework or complete refabrication.
 */
export function triggerPartRework(
  part: PartInstance,
  action: 'rework' | 'refabricate',
  reason: string,
  targetOperation?: PartOperationType,
): PartInstance {
  if (action === 'refabricate') {
    // Reset all operations back to queued
    const resetOps = part.requiredOperations.map((op) => ({
      ...op,
      status: 'queued' as PartOperationStatus,
      completedAt: undefined,
      notes: reason ? `Refabricación: ${reason}` : undefined,
    }));

    return {
      ...part,
      requiredOperations: resetOps,
      currentOperationIndex: 0,
      status: 'pending',
    };
  }

  // Specific operation rework
  const targetOpIdx = targetOperation
    ? part.requiredOperations.findIndex((op) => op.type === targetOperation)
    : part.requiredOperations.findIndex((op) => op.status === 'completed');

  if (targetOpIdx === -1) return part;

  const reworkedOps = part.requiredOperations.map((op, idx) => {
    if (idx < targetOpIdx) return op;
    return {
      ...op,
      status: (idx === targetOpIdx ? 'rework' : 'queued') as PartOperationStatus,
      completedAt: undefined,
      notes: reason ? `Retrabajo: ${reason}` : op.notes,
    };
  });

  return {
    ...part,
    requiredOperations: reworkedOps,
    currentOperationIndex: targetOpIdx,
    status: 'in_progress',
  };
}

/**
 * Derives a backward-compatible ItemFloorStatus for a ProjectItem based on its physical units and pieces.
 */
export function deriveLegacyItemFloorStatus(
  units: readonly ModuleUnitExecution[],
  parts: readonly PartInstance[],
): ItemFloorStatus {
  if (units.length === 0 && parts.length === 0) return 'pending';

  // 1. If units exist and all units are installed -> 'installed'
  if (units.length > 0 && units.every((u) => u.status === 'installed')) {
    return 'installed';
  }

  // 2. If all units are at least loaded -> 'loaded'
  if (units.length > 0 && units.every((u) => u.status === 'loaded' || u.status === 'installed')) {
    return 'loaded';
  }

  // 3. If all units are at least packaged -> 'packaged'
  if (units.length > 0 && units.every((u) => u.status === 'packaged' || u.status === 'loaded' || u.status === 'installed')) {
    return 'packaged';
  }

  // 4. If any unit is assembled or in qc -> 'assembled'
  if (units.length > 0 && units.some((u) => u.status === 'assembly' || u.status === 'module_qc' || u.status === 'packaged' || u.status === 'loaded' || u.status === 'installed')) {
    return 'assembled';
  }

  // 5. If all parts are ready for assembly (or edged) -> 'edged'
  if (parts.length > 0 && parts.every((p) => p.status === 'ready_for_assembly' || p.status === 'assembled')) {
    return 'edged';
  }

  // 6. If all parts have at least finished cutting -> 'cut'
  if (parts.length > 0 && parts.every((p) => {
    const cutOp = p.requiredOperations.find((op) => op.type === 'cut');
    return cutOp?.status === 'completed';
  })) {
    return 'cut';
  }

  return 'pending';
}

// ─── Physical station queues (#301 DoD: piezas hasta Enchape, unidades desde Armado) ───

/** Sectors whose queue is made of PIECES (pre-assembly) or UNITS (assembly+). */
export type PhysicalStationSector =
  | 'cutting'
  | 'cnc'
  | 'edge_banding'
  | 'assembly'
  | 'packaging'
  | 'shipping'
  | 'installation';

export type PhysicalStationRow =
  | {
      readonly kind: 'part';
      readonly part: PartInstance;
      /** Station operation this piece is waiting for. */
      readonly operationType: PartOperationType;
      readonly operationStatus: PartOperationStatus;
    }
  | {
      readonly kind: 'unit';
      readonly unit: ModuleUnitExecution;
      /** Convergence gate verdict (assembly station rows). */
      readonly readiness: AssemblyReadiness;
    };

/**
 * Honest station queue at physical granularity: pieces for
 * cutting/cnc/edge_banding, units for assembly onwards. Returns [] when the
 * project has no generated physical executions (legacy item flow applies).
 */
export function physicalStationQueue(
  project: Project,
  sector: PhysicalStationSector,
): readonly PhysicalStationRow[] {
  const parts = project.partInstances ?? [];
  const units = project.moduleUnits ?? [];
  if (parts.length === 0 || units.length === 0) return [];

  if (sector === 'cutting' || sector === 'cnc' || sector === 'edge_banding') {
    return partsWaitingForSector(parts, sector).map((part) => ({
      kind: 'part' as const,
      part,
      operationType: part.requiredOperations[part.currentOperationIndex]?.type ?? 'cut',
      operationStatus:
        part.requiredOperations[part.currentOperationIndex]?.status ?? 'queued',
    }));
  }

  const released = project.productionRelease?.id;
  return unitsWaitingForSector(units, sector).map((unit) => ({
    kind: 'unit' as const,
    unit,
    readiness: checkAssemblyReadiness(unit, parts, {
      currentProductionRevision: released,
    }),
  }));
}

export type MissingPieceInfo = {
  readonly partCode: string;
  readonly unitIndex: number;
  /** Station where the missing piece currently sits (null when it has no
   * runnable operation — e.g. stale revision). */
  readonly sector: ProductionSector | null;
};

const OPERATION_SECTOR: Readonly<Record<PartOperationType, ProductionSector | null>> = {
  cut: 'cutting',
  cnc: 'cnc',
  edge_banding: 'edge_banding',
  inspection: null,
};

/**
 * Which station holds each missing piece of a readiness verdict — the
 * armador's "falta FRENTE-01 en Enchape" answer (production-flow-v2 §17).
 */
export function describeMissingPieces(readiness: AssemblyReadiness): readonly MissingPieceInfo[] {
  return readiness.missingPieces.map((part) => ({
    partCode: part.partCode,
    unitIndex: part.unitIndex,
    sector: OPERATION_SECTOR[part.requiredOperations[part.currentOperationIndex]?.type ?? 'cut'] ?? null,
  }));
}
