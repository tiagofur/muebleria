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
  generateCutRows,
  generateModuleLabels,
  generatePieceLabels,
  type Catalog,
  type Module,
  type ModuleLabel,
  type Project,
  type ProjectItem,
  type WorkshopOccurrenceProjection,
} from '@granete/domain';
import type { EngineeringReleaseContext } from './engineeringReleaseContext';

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
 * #781 — idle means no release context exists (pre-release project: live
 * order governs). loading means an exact release IS open and its frozen
 * authority is still resolving: NO live fallback may be derived meanwhile
 * (micro-task #3). error means the release IS open but the projection
 * failed (fail closed).
 */
export type ProjectWorkshopOccurrenceContext =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly projection: WorkshopOccurrenceProjection };

/**
 * Pure status resolution for the workshop-occurrence authority (#781
 * micro-task #3): the hook's entire decision table, unit-testable without
 * React. `hasReleaseContext` (token + projectId + releaseId present) is the
 * ONLY gate for leaving idle — a resolving query under an open release is
 * loading, never idle, so no caller can mistake "still fetching the frozen
 * authority" for "no release exists, live order is fine".
 */
export type WorkshopOccurrenceQuerySnapshot =
  | { readonly status: 'pending' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'success'; readonly data: WorkshopOccurrenceProjection | null | undefined };

export function resolveWorkshopOccurrenceContext(args: {
  readonly hasReleaseContext: boolean;
  readonly query: WorkshopOccurrenceQuerySnapshot;
}): ProjectWorkshopOccurrenceContext {
  if (!args.hasReleaseContext) return { kind: 'idle' };
  switch (args.query.status) {
    case 'pending':
      return { kind: 'loading' };
    case 'error': {
      const message =
        args.query.error instanceof Error
          ? args.query.error.message
          : 'Error al proyectar ocurrencias de fabricación';
      return { kind: 'error', message };
    }
    case 'success':
      if (!args.query.data) {
        // Should not happen — fetchProjectWorkshopOccurrences always returns or throws.
        return { kind: 'error', message: 'Proyección de ocurrencias vacía' };
      }
      return { kind: 'ready', projection: args.query.data };
  }
}

export function useProjectWorkshopOccurrences(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly projectId: string | null;
  readonly releaseId: string | null;
  readonly queryKey: QueryKey;
}): ProjectWorkshopOccurrenceContext {
  // #781 FIX — query is only enabled when a release context is ready
  // (projectId + releaseId both present). No release = idle (pre-release).
  const hasReleaseContext = Boolean(args.token && args.projectId && args.releaseId);
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
    enabled: hasReleaseContext,
    retry: false,
  });
  return resolveWorkshopOccurrenceContext({
    hasReleaseContext,
    query: query.isPending
      ? { status: 'pending' }
      : query.isError
        ? { status: 'error', error: query.error }
        : { status: 'success', data: query.data ?? null },
  });
}

/**
 * Effective occurrence authority for the Engineering screen (#781 micro-task
 * #3B): the workshop-occurrences query only starts AFTER the exact release
 * is verified, so while the URL already pins a releaseId but the release
 * context is still loading, the occurrence context would read `idle` — and
 * `idle` means "live allowed". That window must read `loading` instead, so
 * no live BOM/labels are derived before either authority resolves. This
 * never starts the fetch early: it only combines already-held states for
 * the view. Release-context `error` keeps its existing EmptyState (the
 * caller short-circuits before deriving), and pre-release (no releaseId)
 * keeps the legitimate live working view.
 */
export function resolveEffectiveOccurrenceContext(args: {
  readonly routeReleaseId: string | null | undefined;
  readonly releaseContextKind: EngineeringReleaseContext['kind'];
  readonly occurrenceContext: ProjectWorkshopOccurrenceContext;
}): ProjectWorkshopOccurrenceContext {
  if (args.routeReleaseId && args.releaseContextKind === 'loading') {
    return { kind: 'loading' };
  }
  return args.occurrenceContext;
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
 *
 * #781 micro-task #3 — when context.kind === 'loading', this function
 * throws instead of returning project.items: deriving a live BOM while the
 * frozen authority is still resolving is the exact leak this closes. The
 * throw is a backstop — callers branch on the context kind first and render
 * an explicit loading state instead of ever reaching it.
 */
export function deriveEngineeringBomItems(
  project: Project,
  context: ProjectWorkshopOccurrenceContext,
): readonly ProjectItem[] {
  if (context.kind === 'idle') return project.items;
  if (context.kind === 'loading') {
    throw new Error('Cargando ocurrencias congeladas de la liberación…');
  }
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

/**
 * The occurrence-gated slice of the Engineering workspace view (#781
 * micro-task #3): the exact derivation ShellView renders, extracted as a
 * pure function so the loading gate is unit-testable.
 *
 * - `idle` (genuinely no release): live project items flow through, exactly
 *   as the pre-release/legacy working view always behaved.
 * - `loading` (exact release open, authority resolving): NOTHING is
 *   derived — bomProject/cutRows/labels are all null and `occurrencesLoading`
 *   is true, so the screen waits instead of flashing live content.
 * - `error`: nothing derived; the message surfaces as the cut error.
 * - `ready`: frozen BOM context, cut rows and labels derived from it.
 */
export interface EngineeringWorkshopOccurrenceView {
  readonly occurrencesLoading: boolean;
  readonly bomProject: Project | null;
  readonly modules: readonly Module[];
  readonly cutRows: ReturnType<typeof generateCutRows> | null;
  readonly cutError: string | null;
  readonly labels: ReturnType<typeof generatePieceLabels> | null;
  readonly labelsError: string | null;
  readonly moduleLabels: ModuleLabel[] | null;
  readonly moduleLabelsError: string | null;
}

export function deriveEngineeringWorkshopOccurrenceView(args: {
  readonly project: Project;
  readonly catalog: Catalog | null;
  readonly modules: readonly Module[];
  readonly occurrenceContext: ProjectWorkshopOccurrenceContext;
  readonly moduleLabelsMeta: { readonly customerName: string; readonly revision: string | undefined };
}): EngineeringWorkshopOccurrenceView {
  const authorityLoading = args.occurrenceContext.kind === 'loading';
  if (authorityLoading) {
    return {
      occurrencesLoading: true,
      bomProject: null,
      modules: [],
      cutRows: null,
      cutError: null,
      labels: null,
      labelsError: null,
      moduleLabels: null,
      moduleLabelsError: null,
    };
  }
  let bomProject: Project | null = null;
  let workshopError: string | null = null;
  try {
    bomProject = {
      ...args.project,
      items: deriveEngineeringBomItems(args.project, args.occurrenceContext),
    };
  } catch (err) {
    workshopError = err instanceof Error ? err.message : 'Error al proyectar ocurrencias de fabricación';
  }
  const modules = bomProject
    ? args.modules.filter((m) => bomProject!.items.some((item) => item.moduleId === m.id))
    : [];
  let cutRows: ReturnType<typeof generateCutRows> | null = null;
  let cutError: string | null = null;
  if (args.catalog && bomProject) {
    try {
      cutRows = generateCutRows(bomProject, args.catalog);
    } catch (err) {
      cutError = err instanceof Error ? err.message : 'Error al resolver despiece';
    }
  }
  let labels: ReturnType<typeof generatePieceLabels> | null = null;
  let labelsError: string | null = null;
  if (args.catalog && bomProject) {
    try {
      labels = generatePieceLabels(bomProject, args.catalog);
    } catch (err) {
      labelsError = err instanceof Error ? err.message : 'Error al resolver etiquetas';
    }
  }
  // #781 micro-task #3B — module labels also derive from the live project,
  // so they get the SAME authority gate (never live labels while any release
  // authority loads). Ready/pre-release behavior is unchanged: they keep
  // deriving from the live project, exactly as before.
  let moduleLabels: ModuleLabel[] | null = null;
  let moduleLabelsError: string | null = null;
  if (args.catalog && !authorityLoading) {
    try {
      moduleLabels = generateModuleLabels(args.project, args.catalog, {
        customerName: args.moduleLabelsMeta.customerName,
        revision: args.moduleLabelsMeta.revision,
      });
    } catch (err) {
      moduleLabelsError = err instanceof Error ? err.message : 'Error al resolver etiquetas de módulo';
    }
  }
  return {
    occurrencesLoading: false,
    bomProject,
    modules,
    cutRows,
    cutError: workshopError ?? cutError,
    labels,
    labelsError,
    moduleLabels,
    moduleLabelsError,
  };
}
