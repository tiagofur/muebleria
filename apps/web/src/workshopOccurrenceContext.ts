/**
 * #781 — the project's frozen manufacturing occurrence authority, consumed
 * by the Engineering/BOM context.
 *
 * `GET /projects/{projectId}/production-releases/{releaseId}/workshop-occurrences`
 * projects the EXACT release's frozen unit order (ordinal = snapshot
 * position, decided when the work was liberated, never recomputed) onto
 * the CURRENT quote-line↔instance links. The BOM/Engineering view derives
 * its item context from it (`applyFrozenWorkshopOccurrenceOrdinals`) so the
 * same physical occurrence keeps the same workshop code from preview to
 * PTX/CNC — the frontend never re-derives ordinals and never re-sorts by id.
 *
 * #781 FIX — uses EXACT releaseId from the engineering release context;
 * never falls back to "latest release". The query is only enabled when a
 * release context is ready. Errors when a release IS open are blockers
 * (fail closed), not silent degradations to live order.
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
  releaseId: string,
): QueryKey {
  return [...scope, 'projects', projectId, 'releases', releaseId, 'workshop-occurrences'];
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
  readonly releaseId: string;
  readonly signal?: AbortSignal;
}): Promise<WorkshopOccurrenceProjection> {
  const client = new GraneteApiClient(args.baseUrl);
  return toProjection(
    await client.getProjectWorkshopOccurrences(
      args.token,
      args.projectId,
      args.releaseId,
      args.signal,
    ),
  );
}

/**
 * #781 — idle means no release context exists (pre-release project).
 * error means the release IS open but the projection failed (fail closed).
 */
export type ProjectWorkshopOccurrenceContext =
  | { readonly kind: 'idle' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly projection: WorkshopOccurrenceProjection };

export function useProjectWorkshopOccurrences(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly projectId: string | null;
  readonly releaseId: string | null;
  readonly queryKey: QueryKey;
}): ProjectWorkshopOccurrenceContext {
  // #781 FIX — query is only enabled when a release context is ready
  // (projectId + releaseId both present). No release = idle (pre-release).
  const enabled = Boolean(args.token && args.projectId && args.releaseId);
  const query = useQuery({
    queryKey: args.queryKey,
    queryFn: ({ signal }) =>
      fetchProjectWorkshopOccurrences({
        baseUrl: args.baseUrl,
        token: args.token as string,
        projectId: args.projectId as string,
        releaseId: args.releaseId as string,
        signal,
      }),
    enabled,
    retry: false,
  });
  if (!args.projectId || !args.token || !args.releaseId) return { kind: 'idle' };
  if (query.isPending) return { kind: 'idle' };
  if (query.isError) {
    // #781 FIX — fail closed: when a release IS open, any projection error
    // (network, permissions, 403, 500, mismatch) is a BLOCKER, not a silent
    // degradation to live order. The caller must surface this as an error.
    const message = query.error instanceof Error ? query.error.message : 'Error al proyectar ocurrencias de fabricación';
    return { kind: 'error', message };
  }
  if (!query.data) {
    // Should not happen — fetchProjectWorkshopOccurrences always returns or throws.
    return { kind: 'error', message: 'Proyección de ocurrencias vacía' };
  }
  return { kind: 'ready', projection: query.data };
}

/**
 * Derives the Engineering/BOM item context from the frozen occurrence
 * authority. Freeze applies ONLY when the release covers every current
 * instance (a drifted project keeps the live view — never a silent mix of
 * frozen and unfrozen occurrences). The persisted Project is never mutated.
 *
 * #781 FIX — when context.kind === 'error', this function throws instead
 * of silently returning project.items. A released project that can't
 * project its occurrences MUST NOT fall back to live order.
 */
export function deriveEngineeringBomItems(
  project: Project,
  context: ProjectWorkshopOccurrenceContext,
): readonly ProjectItem[] {
  if (context.kind === 'idle') return project.items;
  if (context.kind === 'error') {
    // #781 FIX — fail closed: a released project with a projection error
    // must not silently fall back to live order. Surface the error.
    throw new Error(`Workshop occurrence projection failed: ${context.message}`);
  }
  // context.kind === 'ready'
  if (!context.projection.coversAllCurrentInstances) {
    // #781 FIX — fail closed: partial coverage is a blocker, not a silent
    // degradation. The project drifted from the release.
    throw new Error(
      `La liberación congelada no cubre todas las instancias actuales — el proyecto se desplazó de la release #${context.projection.releaseNumber}`,
    );
  }
  return applyFrozenWorkshopOccurrenceOrdinals(
    project.items,
    context.projection,
  );
}
