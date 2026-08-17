/**
 * Engineering Log — tracks the lifecycle of engineering work on a project.
 *
 * Each project can have at most one EngineeringLog. The log records who
 * started engineering, when docs were generated, and when the project was
 * sent to production (with a revision counter).
 */

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

/** Spanish labels for engineering statuses. */
export const ENGINEERING_STATUS_LABELS_ES: Readonly<Record<EngineeringStatus, string>> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  documented: 'Documentado',
};
