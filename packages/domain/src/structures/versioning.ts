/**
 * Structure revision versioning (#108 / Slice 1).
 *
 * A published `Structure` is versioned: each edit produces a new `revision`
 * (monotonic) and the previous revision's BOM-relevant fields are pushed as an
 * immutable snapshot onto `history`. When a project is closed, each line item
 * captures the current `structureRevisionPin` so the frozen BOM can be
 * re-resolved against the exact revision the quote used — even after the
 * catalog structure is edited, replaced, or soft-deleted.
 *
 * Boundary: pure domain logic, no I/O. Mirrors the `QuotePriceSnapshot`
 * precedent (engine.ts `captureQuoteSnapshot`).
 */

import type {
  Catalog,
  ProjectItem,
  Structure,
  StructureRevision,
} from '../types';
import { ResolutionError } from '../errors';

/** Default revision assumed for legacy structures that omit `revision` (#108). */
export const DEFAULT_STRUCTURE_REVISION = 1;

/**
 * Normalized revision number — `undefined` (legacy data) is treated as 1.
 * Exposed for callers that need to compare revisions without the normalization dance.
 */
export function structureRevision(structure: Structure): number {
  return structure.revision ?? DEFAULT_STRUCTURE_REVISION;
}

/**
 * Build the immutable snapshot of the *current* structure's BOM-relevant fields.
 * Only fields that affect `resolveBom` are captured (notes/active are irrelevant
 * for re-resolution and intentionally dropped).
 */
export function snapshotStructureRevision(
  structure: Structure,
): StructureRevision {
  return {
    revision: structureRevision(structure),
    code: structure.code,
    name: structure.name,
    externalDims: structure.externalDims,
    presets: structure.presets,
    components: structure.components,
  };
}

/**
 * Apply an edit to a published structure (#108): the previous revision is
 * snapshotted and prepended to `history`, and the returned structure carries
 * `revision = current.revision + 1` plus the new draft fields.
 *
 * `nextDraft` carries the editable fields (everything except `id`, `revision`,
 * `history` — those are derived). Snapshots are prepended (newest-first) so
 * `history[0]` is always the most recently superseded revision.
 *
 * Returns the new structure and the previous revision number (handy for audits).
 */
export function bumpStructureRevision(
  current: Structure,
  nextDraft: Omit<Structure, 'id' | 'revision' | 'history'>,
): { structure: Structure; oldRevision: number } {
  const oldRevision = structureRevision(current);
  const snapshot = snapshotStructureRevision(current);
  const structure: Structure = {
    ...nextDraft,
    id: current.id,
    revision: oldRevision + 1,
    // Prepend newest-first; existing history (if any) follows in order.
    history: [snapshot, ...(current.history ?? [])],
  };
  return { structure, oldRevision };
}

/** Fields needed to re-resolve a pinned revision exactly as it was. */
export interface ResolvedStructureRevision {
  readonly revision: number;
  readonly code: string;
  readonly name: string;
  readonly externalDims?: Structure['externalDims'];
  readonly presets?: Structure['presets'];
  readonly components?: Structure['components'];
}

/**
 * Resolve which revision of `structure` should be used for BOM resolution,
 * honoring a pinned revision (#108):
 *
 * - `pin === undefined` → current revision (live).
 * - `pin === current revision` → current revision (live).
 * - `pin` matches an entry in `history` → that frozen snapshot.
 * - otherwise → throw `ResolutionError`. This covers the degenerate case where
 *   the structure was deleted without leaving a snapshot, or the pin points at
 *   a revision that was never snapshotted. We fail loudly with context rather
 *   than silently falling back to live (which would corrupt a frozen quote).
 *
 * `current` is accepted as `Structure` for ergonomic chaining; callers that only
 * have a partial structure should build a stub. The `id` is echoed back when
 * provided so error context can reference it.
 */
export function resolveStructureRevision(
  structure: Structure,
  pin?: number,
): ResolvedStructureRevision {
  const currentRevision = structureRevision(structure);

  if (pin === undefined || pin === currentRevision) {
    return {
      revision: currentRevision,
      code: structure.code,
      name: structure.name,
      externalDims: structure.externalDims,
      presets: structure.presets,
      components: structure.components,
    };
  }

  const matched = structure.history?.find((h) => h.revision === pin);
  if (matched) {
    return {
      revision: matched.revision,
      code: matched.code,
      name: matched.name,
      externalDims: matched.externalDims,
      presets: matched.presets,
      components: matched.components,
    };
  }

  const availableRevisions = [
    currentRevision,
    ...(structure.history ?? []).map((h) => h.revision),
  ].sort((a, b) => a - b);

  throw new ResolutionError(
    `Structure revision pin ${pin} not found for structure "${structure.code}"`,
    {
      structureId: structure.id,
      structureCode: structure.code,
      pin,
      currentRevision,
      availableRevisions,
      field: 'structureRevisionPin',
    },
  );
}

/**
 * Reify a resolved revision back into a full `Structure` so it can be fed to
 * `resolveComposedModule` / `resolveBom` unchanged. `id`/`notes`/`active`/
 * `history`/`revision` are carried over from `structure` since they don't
 * affect BOM resolution but keep the object shape-complete.
 *
 * Used by `resolveBom` when a pin is present.
 */
export function reifyResolvedStructure(
  structure: Structure,
  resolved: ResolvedStructureRevision,
): Structure {
  return {
    ...structure,
    code: resolved.code,
    name: resolved.name,
    externalDims: resolved.externalDims,
    presets: resolved.presets,
    components: resolved.components,
    revision: resolved.revision,
  };
}

/**
 * Convenience: resolve `structure` honoring `pin` and return a full `Structure`
 * ready to pass into BOM resolution. Throws via `resolveStructureRevision` for
 * unknown pins.
 */
export function resolveStructureForPin(
  structure: Structure,
  pin?: number,
): Structure {
  const resolved = resolveStructureRevision(structure, pin);
  return reifyResolvedStructure(structure, resolved);
}

/**
 * Peg `structureRevisionPin` onto each project item based on its module's
 * current structure revision (#108). Used when a project is closed
 * (quoted/accepted/produced) so the BOM stays frozen against later edits.
 *
 * Items whose module has no structure (or whose structure is missing from the
 * catalog) are returned unchanged — there is nothing to pin.
 */
export function captureProjectItemStructurePins(
  items: readonly ProjectItem[],
  catalog: Catalog,
): readonly ProjectItem[] {
  const modulesById = new Map(catalog.modules.map((m) => [m.id, m]));
  const structuresById = new Map(
    (catalog.structures ?? []).map((s) => [s.id, s]),
  );

  return items.map((item) => {
    const module = modulesById.get(item.moduleId);
    if (!module?.structureId) return item;
    const structure = structuresById.get(module.structureId);
    if (!structure) return item;
    return { ...item, structureRevisionPin: structureRevision(structure) };
  });
}
