/**
 * Derive ModuleComponentInstance.overrides from the BoardEditor's resolved
 * parts (gap #1 — persistence).
 *
 * The BoardEditor works with ResolvedBoardPart (numeric x/y/z, lengthMm,
 * widthMm). When the user edits a part's pose or dimensions in the board
 * editor, those edits live in the editorStore's scratch space. This function
 * maps them back to the override shape the domain expects, keyed by the
 * original componentId.
 *
 * Part IDs from resolveComposedModule follow the pattern
 * `${componentId}-copy-${i}` (bom.ts:464). We parse that to recover the
 * componentId, then group all copies of the same component. Because overrides
 * are per-instance (not per-copy), we apply the LAST copy's edited values —
 * this is acceptable for the common case (quantity 1 per component instance).
 *
 * Only parts whose pose/dims DIFFER from the original resolved values produce
 * overrides; untouched parts produce nothing (keeping the draft clean).
 */

import type { ResolvedBoardPart } from '@granete/domain';

export type ComponentOverrides = {
  readonly lengthFormula?: string;
  readonly widthFormula?: string;
  readonly xFormula?: string;
  readonly yFormula?: string;
  readonly zFormula?: string;
  readonly rotateX?: number;
  readonly rotateY?: number;
  readonly rotateZ?: number;
};

export type OverridesByComponentId = Readonly<Record<string, ComponentOverrides>>;

/** Parse `${componentId}-copy-${i}` → componentId. Returns null if no match. */
function componentIdFromPartId(partId: string): string | null {
  const match = partId.match(/^(.+)-copy-\d+$/);
  return match ? match[1]! : null;
}

/**
 * Compare two resolved parts and produce overrides for the fields that differ.
 * Returns null if nothing changed (no overrides needed).
 */
function diffToOverrides(
  edited: ResolvedBoardPart,
  original: ResolvedBoardPart,
): ComponentOverrides | null {
  const entries: Record<string, string | number | undefined> = {};

  // Dimensions (stored as literal-string formulas).
  if (edited.lengthMm !== original.lengthMm) {
    entries.lengthFormula = String(edited.lengthMm);
  }
  if (edited.widthMm !== original.widthMm) {
    entries.widthFormula = String(edited.widthMm);
  }

  // Poses (stored as literal-string formulas for x/y/z; numbers for rotate).
  if (edited.x !== original.x) {
    entries.xFormula = String(edited.x ?? 0);
  }
  if (edited.y !== original.y) {
    entries.yFormula = String(edited.y ?? 0);
  }
  if (edited.z !== original.z) {
    entries.zFormula = String(edited.z ?? 0);
  }
  if (edited.rotateX !== original.rotateX) {
    entries.rotateX = edited.rotateX;
  }
  if (edited.rotateY !== original.rotateY) {
    entries.rotateY = edited.rotateY;
  }
  if (edited.rotateZ !== original.rotateZ) {
    entries.rotateZ = edited.rotateZ;
  }

  return Object.keys(entries).length > 0
    ? (entries as ComponentOverrides)
    : null;
}

/**
 * Build a map of componentId → overrides for parts that changed vs their
 * original resolved values.
 *
 * @param edited   The current editorStore parts (after user edits).
 * @param original The parts as originally resolved (before edits).
 */
export function deriveOverridesFromParts(
  edited: readonly ResolvedBoardPart[],
  original: readonly ResolvedBoardPart[],
): OverridesByComponentId {
  const originalById = new Map(original.map((p) => [p.id, p]));
  const result: Record<string, ComponentOverrides> = {};

  for (const part of edited) {
    const componentId = componentIdFromPartId(part.id);
    if (!componentId) continue;
    const orig = originalById.get(part.id);
    if (!orig) continue; // new part (duplicate) — not persisted in this milestone
    const overrides = diffToOverrides(part, orig);
    if (overrides) {
      result[componentId] = overrides;
    }
  }

  return result;
}
