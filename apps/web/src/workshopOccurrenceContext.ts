/**
 * #781 — the project's frozen manufacturing occurrence authority, consumed
 * by the Engineering/BOM context.
 *
 * `GET /projects/{projectId}/workshop-occurrences` projects the LATEST
 * production release's frozen unit order (ordinal = snapshot position,
 * decided when the work was liberated, never recomputed) onto the CURRENT
 * quote-line↔instance links. The BOM/Engineering view derives its item
 * context from it (`applyFrozenWorkshopOccurrenceOrdinals`) so the same
 * physical occurrence keeps the same workshop code from preview to
 * PTX/CNC — the frontend never re-derives ordinals and never re-sorts by id.
 *
 * A project without a liberation has NO frozen authority (404 → idle): the
 * live canonical order governs, exactly as before.
 */

import { useQuery, type QueryKey } from '@tanstack/react-query';
import {
  GraneteApiClient,
  type ProjectWorkshopOccurrences,
} from '@granete/storage';
import {
  applyFrozenWorkshopOccurrenceOrdinals,
  type Project,
  type ProjectItem,
  type WorkshopOccurrenceProjection,
} from '@granete/domain';

export function workshopOccurrenceQueryKey(
  scope: readonly unknown[],
  projectId: string,
): QueryKey {
  return [...scope, 'projects', projectId, 'workshop-occurrences'];
}

function toProjection(
  raw: ProjectWorkshopOccurrences,
): WorkshopOccurrenceProjection {
  return {
    releaseId: raw.release_id,
    releaseNumber: raw.release_number,
    coversAllCurrentInstances: raw.covers_all_current_instances,
    assignments: raw.assignments.map((assignment) => ({
      furnitureInstanceId: assignment.furniture_instance_id,
      projectItemId: assignment.project_item_id,
      workshopOccurrenceOrdinal: assignment.workshop_occurrence_ordinal,
    })),
  };
}

export async function fetchProjectWorkshopOccurrences(args: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly signal?: AbortSignal;
}): Promise<WorkshopOccurrenceProjection | null> {
  const client = new GraneteApiClient(args.baseUrl);
  try {
    return toProjection(
      await client.getProjectWorkshopOccurrences(
        args.token,
        args.projectId,
        args.signal,
      ),
    );
  } catch (err) {
    // A 404 means no liberation exists yet — the project has no frozen
    // occurrence authority. Return null so the hook degrades to the live
    // canonical order without surfacing a console error (#781 §11).
    if (
      err instanceof Error
      && /404/i.test(err.message)
    ) {
      return null;
    }
    throw err;
  }
}

export type ProjectWorkshopOccurrenceContext =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ready'; readonly projection: WorkshopOccurrenceProjection };

export function useProjectWorkshopOccurrences(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly projectId: string | null;
  readonly queryKey: QueryKey;
}): ProjectWorkshopOccurrenceContext {
  const query = useQuery({
    queryKey: args.queryKey,
    queryFn: ({ signal }) =>
      fetchProjectWorkshopOccurrences({
        baseUrl: args.baseUrl,
        token: args.token as string,
        projectId: args.projectId as string,
        signal,
      }),
    enabled: Boolean(args.token && args.projectId),
    retry: false,
  });
  if (!args.projectId || !args.token) return { kind: 'idle' };
  if (query.isPending) return { kind: 'idle' };
  if (query.isError || !query.data) {
    // null data means no liberation exists (404 caught above). A missing
    // liberation is not an error surface: no frozen authority means the live
    // canonical order governs. Anything else (network, permissions) also
    // degrades to live rather than blocking engineering.
    return { kind: 'idle' };
  }
  return { kind: 'ready', projection: query.data };
}

/**
 * Derives the Engineering/BOM item context from the frozen occurrence
 * authority. Freeze applies ONLY when the release covers every current
 * instance (a drifted project keeps the live view — never a silent mix of
 * frozen and unfrozen occurrences). The persisted Project is never mutated.
 */
export function deriveEngineeringBomItems(
  project: Project,
  context: ProjectWorkshopOccurrenceContext,
): readonly ProjectItem[] {
  if (context.kind !== 'ready') return project.items;
  if (!context.projection.coversAllCurrentInstances) return project.items;
  try {
    return applyFrozenWorkshopOccurrenceOrdinals(
      project.items,
      context.projection,
    );
  } catch {
    // Defense in depth: a malformed projection degrades to the live order
    // instead of breaking the engineering screen; the release lane keeps
    // failing closed on its own contract.
    return project.items;
  }
}
