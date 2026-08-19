/**
 * Engineering Log — tracks the lifecycle of engineering work on a project.
 *
 * Each project can have at most one EngineeringLog. The log records who
 * started engineering, when docs were generated, and when the project was
 * sent to production (with a revision counter).
 */

import type { Project } from './types';

/** Engineering lifecycle status derived from the log fields. */
export type EngineeringStatus =
  /** No log yet — engineering hasn't started. */
  | 'pending'
  /** Log exists but no docs generated yet. */
  | 'in_progress'
  /** Docs generated (generatedAt is set). */
  | 'documented';

/**
 * Immutable engineering audit log for a project.
 * All timestamps are ISO 8601 strings.
 */
export interface EngineeringLog {
  /** User id who started engineering. */
  readonly startedBy: string;
  /** When engineering was started. */
  readonly startedAt: string;
  /** User id who last generated documentation. */
  readonly generatedBy?: string;
  /** When documentation was last generated. */
  readonly generatedAt?: string;
  /** User id who sent the project to production. */
  readonly sentToProductionBy?: string;
  /** When the project was sent to production. */
  readonly sentToProductionAt?: string;
  /** Monotonic revision counter. Incremented on each "send to production". */
  readonly revision: number;
}

/**
 * Derive the engineering status from a log (or absence thereof).
 */
export function engineeringStatus(log: EngineeringLog | undefined): EngineeringStatus {
  if (!log) return 'pending';
  if (log.generatedAt) return 'documented';
  return 'in_progress';
}

/**
 * Create a new EngineeringLog with revision 1.
 */
export function createEngineeringLog(startedBy: string, startedAt: string): EngineeringLog {
  return { startedBy, startedAt, revision: 1 };
}

/**
 * Record documentation generation on an existing log.
 */
export function recordGeneration(
  log: EngineeringLog,
  generatedBy: string,
  generatedAt: string,
): EngineeringLog {
  return { ...log, generatedBy, generatedAt };
}

/**
 * Record "sent to production" and bump the revision.
 */
export function recordSentToProduction(
  log: EngineeringLog,
  sentToProductionBy: string,
  sentToProductionAt: string,
): EngineeringLog {
  return {
    ...log,
    sentToProductionBy,
    sentToProductionAt,
    revision: log.revision + 1,
  };
}

/**
 * Whether engineering may send the project to production: the quote is
 * accepted AND the documentation was generated (project-lifecycle.md §3 —
 * "Enviar a producción" requires documented engineering, no bypass).
 */
export function canSendToProduction(project: Project): boolean {
  return (
    project.status === 'accepted' &&
    engineeringStatus(project.engineeringLog) === 'documented'
  );
}

/** Spanish labels for engineering statuses. */
export const ENGINEERING_STATUS_LABELS_ES: Readonly<Record<EngineeringStatus, string>> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  documented: 'Documentado',
};

/* ── Engineering Dashboard Analytics ─────────────────────────────────────── */

export interface EngineeringDashboardProjectMetrics {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerId?: string;
  readonly customerLabel?: string;
  readonly status: EngineeringStatus;
  readonly isSentToProduction: boolean;
  readonly stage: 'ingenieria' | 'almacen' | 'produccion' | 'ventas';
  readonly engineerId?: string;
  readonly startedAt?: string;
  readonly generatedAt?: string;
  readonly sentToProductionAt?: string;
  readonly revision: number;
  readonly waitTimeHours?: number;
  readonly cycleTimeHours?: number;
  readonly moduleCount: number;
  readonly cutPieceCount: number;
  readonly isStagnant: boolean;
  readonly stagnantReason?: string;
}

export interface EngineerWorkloadSummary {
  readonly engineerId: string;
  readonly activeCount: number;
  readonly documentedCount: number;
  readonly sentCount: number;
  readonly totalAssigned: number;
  readonly avgCycleHours: number | null;
}

export interface EngineeringDashboardStats {
  readonly pendingCount: number;
  readonly inProgressCount: number;
  readonly documentedCount: number;
  readonly sentToProductionCount: number;
  readonly totalActiveQueue: number;
  readonly totalSent: number;
  readonly avgWaitTimeHours: number | null;
  readonly avgCycleTimeHours: number | null;
  readonly avgRevisionCount: number | null;
  readonly totalModulesCalculated: number;
  readonly totalCutPiecesCalculated: number;
  readonly stagnantAlerts: readonly EngineeringDashboardProjectMetrics[];
  readonly engineerWorkload: readonly EngineerWorkloadSummary[];
  readonly projects: readonly EngineeringDashboardProjectMetrics[];
}

/**
 * Compute aggregate analytics and individual metrics for the Engineering Dashboard.
 */
export function computeEngineeringDashboardStats(
  projects: readonly (Project & { readonly customerLabel?: string })[],
  nowIso?: string,
): EngineeringDashboardStats {
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();

  let pendingCount = 0;
  let inProgressCount = 0;
  let documentedCount = 0;
  let sentToProductionCount = 0;
  let totalModulesCalculated = 0;
  let totalCutPiecesCalculated = 0;

  const waitTimes: number[] = [];
  const cycleTimes: number[] = [];
  const revisions: number[] = [];

  const projectMetricsList: EngineeringDashboardProjectMetrics[] = [];
  const stagnantAlerts: EngineeringDashboardProjectMetrics[] = [];
  const engineerWorkloadMap = new Map<
    string,
    {
      activeCount: number;
      documentedCount: number;
      sentCount: number;
      cycleTimes: number[];
    }
  >();

  // Only consider accepted / active projects that belong to the engineering lifecycle.
  for (const p of projects) {
    if (p.status !== 'accepted' && p.status !== 'produced') {
      continue;
    }

    const log = p.engineeringLog;
    const status = engineeringStatus(log);
    const isSent = Boolean(log?.sentToProductionAt);
    
    let stage: 'ingenieria' | 'almacen' | 'produccion' | 'ventas' = 'ingenieria';
    if (isSent) {
      stage = p.materialsRelease ? 'produccion' : 'almacen';
    }

    // Module and piece counts
    let moduleCount = 0;
    if (p.items && p.items.length > 0) {
      for (const item of p.items) {
        moduleCount += item.quantity || 1;
      }
    }
    const cutPieceCount = moduleCount * 8;

    // Time calculations
    const createdAtMs = p.createdAt ? new Date(p.createdAt).getTime() : now;
    const depositAtMs = createdAtMs;
    const startedAtMs = log?.startedAt ? new Date(log.startedAt).getTime() : undefined;
    const generatedAtMs = log?.generatedAt ? new Date(log.generatedAt).getTime() : undefined;
    const sentAtMs = log?.sentToProductionAt ? new Date(log.sentToProductionAt).getTime() : undefined;

    let waitTimeHours: number | undefined;
    if (startedAtMs) {
      waitTimeHours = Math.max(0, Math.round(((startedAtMs - depositAtMs) / (1000 * 3600)) * 10) / 10);
      waitTimes.push(waitTimeHours);
    } else if (stage === 'ingenieria') {
      waitTimeHours = Math.max(0, Math.round(((now - depositAtMs) / (1000 * 3600)) * 10) / 10);
    }

    let cycleTimeHours: number | undefined;
    if (startedAtMs && sentAtMs) {
      cycleTimeHours = Math.max(0, Math.round(((sentAtMs - startedAtMs) / (1000 * 3600)) * 10) / 10);
      cycleTimes.push(cycleTimeHours);
    } else if (startedAtMs) {
      cycleTimeHours = Math.max(0, Math.round(((now - startedAtMs) / (1000 * 3600)) * 10) / 10);
    }

    if (log?.revision) {
      revisions.push(log.revision);
    }

    // Stagnancy check
    let isStagnant = false;
    let stagnantReason: string | undefined;

    if (stage === 'ingenieria') {
      if (status === 'pending') {
        pendingCount++;
        const hoursWaiting = (now - depositAtMs) / (1000 * 3600);
        if (hoursWaiting > 72) {
          isStagnant = true;
          stagnantReason = `Lleva ${Math.floor(hoursWaiting / 24)} días en cola sin iniciar ingeniería`;
        }
      } else if (status === 'in_progress') {
        inProgressCount++;
        const hoursInProgress = startedAtMs ? (now - startedAtMs) / (1000 * 3600) : 0;
        if (hoursInProgress > 120) {
          isStagnant = true;
          stagnantReason = `Lleva ${Math.floor(hoursInProgress / 24)} días en modelado sin documentar`;
        }
      } else if (status === 'documented') {
        documentedCount++;
        const hoursDoc = generatedAtMs ? (now - generatedAtMs) / (1000 * 3600) : 0;
        if (hoursDoc > 72) {
          isStagnant = true;
          stagnantReason = `Documentado hace ${Math.floor(hoursDoc / 24)} días sin enviar a planta`;
        }
      }
    } else if (isSent) {
      sentToProductionCount++;
    }

    totalModulesCalculated += moduleCount;
    totalCutPiecesCalculated += cutPieceCount;

    const engineerId = log?.startedBy || log?.generatedBy || log?.sentToProductionBy;
    if (engineerId) {
      let rec = engineerWorkloadMap.get(engineerId);
      if (!rec) {
        rec = { activeCount: 0, documentedCount: 0, sentCount: 0, cycleTimes: [] };
        engineerWorkloadMap.set(engineerId, rec);
      }
      if (isSent) {
        rec.sentCount++;
        if (cycleTimeHours !== undefined && startedAtMs && sentAtMs) {
          rec.cycleTimes.push(cycleTimeHours);
        }
      } else if (status === 'documented') {
        rec.documentedCount++;
      } else {
        rec.activeCount++;
      }
    }

    const metric: EngineeringDashboardProjectMetrics = {
      projectId: p.id,
      projectName: p.name,
      customerId: p.customerId,
      customerLabel: p.customerLabel,
      status,
      isSentToProduction: isSent,
      stage,
      engineerId,
      startedAt: log?.startedAt,
      generatedAt: log?.generatedAt,
      sentToProductionAt: log?.sentToProductionAt,
      revision: log?.revision ?? 1,
      waitTimeHours,
      cycleTimeHours,
      moduleCount,
      cutPieceCount,
      isStagnant,
      stagnantReason,
    };

    projectMetricsList.push(metric);
    if (isStagnant) {
      stagnantAlerts.push(metric);
    }
  }

  const avgWaitTimeHours =
    waitTimes.length > 0
      ? Math.round((waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) * 10) / 10
      : null;

  const avgCycleTimeHours =
    cycleTimes.length > 0
      ? Math.round((cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) * 10) / 10
      : null;

  const avgRevisionCount =
    revisions.length > 0
      ? Math.round((revisions.reduce((a, b) => a + b, 0) / revisions.length) * 10) / 10
      : null;

  const engineerWorkload: EngineerWorkloadSummary[] = Array.from(
    engineerWorkloadMap.entries(),
  ).map(([engineerId, data]) => {
    const avgCycle =
      data.cycleTimes.length > 0
        ? Math.round((data.cycleTimes.reduce((a, b) => a + b, 0) / data.cycleTimes.length) * 10) / 10
        : null;
    return {
      engineerId,
      activeCount: data.activeCount,
      documentedCount: data.documentedCount,
      sentCount: data.sentCount,
      totalAssigned: data.activeCount + data.documentedCount + data.sentCount,
      avgCycleHours: avgCycle,
    };
  });

  return {
    pendingCount,
    inProgressCount,
    documentedCount,
    sentToProductionCount,
    totalActiveQueue: pendingCount + inProgressCount + documentedCount,
    totalSent: sentToProductionCount,
    avgWaitTimeHours,
    avgCycleTimeHours,
    avgRevisionCount,
    totalModulesCalculated,
    totalCutPiecesCalculated,
    stagnantAlerts,
    engineerWorkload,
    projects: projectMetricsList,
  };
}
