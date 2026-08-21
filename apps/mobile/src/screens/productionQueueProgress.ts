/**
 * Physical progress counting for the production queue (#301).
 * Pure module — no react-native imports, so it stays unit-testable.
 */

/** Raw part-executions payload of GET /projects/{id}/part-executions. */
export interface PartExecutionsPayload {
  part_instances?: { status?: string }[];
  module_units?: { status?: string }[];
}

/**
 * Physical progress of a obra (#301): pieces ready for assembly over total
 * (pre-assembly truth) and installed units over total (post-assembly).
 * Returns null when the obra runs the legacy item flow (no executions).
 */
export function physicalProgress(payload: PartExecutionsPayload | null | undefined): {
  partsReady: number;
  partsTotal: number;
  unitsInstalled: number;
  unitsTotal: number;
} | null {
  const parts = payload?.part_instances ?? [];
  const units = payload?.module_units ?? [];
  if (parts.length === 0 || units.length === 0) return null;
  return {
    partsReady: parts.filter(
      (p) => p.status === 'ready_for_assembly' || p.status === 'assembled',
    ).length,
    partsTotal: parts.length,
    unitsInstalled: units.filter((u) => u.status === 'installed').length,
    unitsTotal: units.length,
  };
}
