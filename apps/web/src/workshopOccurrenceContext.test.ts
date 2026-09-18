/**
 * #781 micro-task #3 — release loading is fail-closed, never a live fallback.
 *
 * The hook itself (`useProjectWorkshopOccurrences`) is a thin adapter over
 * the pure `resolveWorkshopOccurrenceContext` decision table below (this repo
 * tests web logic as pure functions — no render harness in apps/web), so
 * these tests pin the exact authority semantics the hook executes:
 *
 *   no release context → idle → live allowed (pre-release/legacy)
 *   exact release + pending → loading → NOTHING live-derived
 *   exact release + error → fail-closed
 *   exact release + data → frozen projection
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Catalog,
  Module,
  Project,
  WorkshopOccurrenceProjection,
} from '@granete/domain';
import {
  deriveEngineeringBomItems,
  deriveEngineeringWorkshopOccurrenceView,
  fetchProjectWorkshopOccurrences,
  resolveEffectiveOccurrenceContext,
  resolveWorkshopOccurrenceContext,
  workshopOccurrenceQueryKey,
} from './workshopOccurrenceContext';

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const RELEASE_ID = '20000000-0000-4000-8000-000000000002';

function stubFetch(handler: (url: string) => { status: number; body: unknown } | undefined) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const routed = handler(url);
    if (routed) {
      return new Response(JSON.stringify(routed.body), {
        status: routed.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function liveProject(): Project {
  return {
    id: PROJECT_ID,
    name: 'Obra lab',
    customerId: 'cust-1',
    currency: 'ARS',
    marginFactor: 1,
    laborFixedCost: 0,
    status: 'accepted',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    items: [
      { id: 'line-a', moduleId: 'mod-1', quantity: 1, optionChoices: {} },
    ],
  };
}

function frozenProjection(): WorkshopOccurrenceProjection {
  return {
    releaseId: RELEASE_ID,
    releaseNumber: 3,
    coversAllCurrentInstances: true,
    assignments: [
      { furnitureInstanceId: 'fi-a', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
    ],
  };
}

describe('resolveWorkshopOccurrenceContext (#781 micro-task #3)', () => {
  it('A — pre-release (no release context): idle whatever the query does', () => {
    expect(
      resolveWorkshopOccurrenceContext({ hasReleaseContext: false, query: { status: 'pending' } }),
    ).toEqual({ kind: 'idle' });
    expect(
      resolveWorkshopOccurrenceContext({
        hasReleaseContext: false,
        query: { status: 'success', data: frozenProjection() },
      }),
    ).toEqual({ kind: 'idle' });
    // …and idle keeps the live working view allowed.
    const project = liveProject();
    expect(deriveEngineeringBomItems(project, { kind: 'idle' })).toBe(project.items);
  });

  it('B — exact release + pending: loading, NEVER idle', () => {
    const context = resolveWorkshopOccurrenceContext({
      hasReleaseContext: true,
      query: { status: 'pending' },
    });
    expect(context).toEqual({ kind: 'loading' });
    expect(context.kind).not.toBe('idle');
  });

  it('exact release + error: fail-closed with the caller message', () => {
    expect(
      resolveWorkshopOccurrenceContext({
        hasReleaseContext: true,
        query: { status: 'error', error: new Error('boom-403') },
      }),
    ).toEqual({ kind: 'error', message: 'boom-403' });
    expect(
      resolveWorkshopOccurrenceContext({
        hasReleaseContext: true,
        query: { status: 'error', error: 'opaque' },
      }).kind,
    ).toBe('error');
  });

  it('exact release + success without data: fail-closed, never ready', () => {
    expect(
      resolveWorkshopOccurrenceContext({
        hasReleaseContext: true,
        query: { status: 'success', data: null },
      }).kind,
    ).toBe('error');
  });

  it('exact release + data: ready with the frozen projection', () => {
    const projection = frozenProjection();
    expect(
      resolveWorkshopOccurrenceContext({
        hasReleaseContext: true,
        query: { status: 'success', data: projection },
      }),
    ).toEqual({ kind: 'ready', projection });
  });

  it('query keys stay release-scoped (no cross-release bleed)', () => {
    const key = workshopOccurrenceQueryKey(['session'], PROJECT_ID, RELEASE_ID);
    expect(key).toContain(RELEASE_ID);
    expect(workshopOccurrenceQueryKey(['session'], PROJECT_ID, 'other-release')).not.toEqual(key);
  });
});

describe('deriveEngineeringBomItems under loading/error (#781 micro-task #3)', () => {
  it('C — loading never derives live BOM items', () => {
    const project = liveProject();
    expect(() => deriveEngineeringBomItems(project, { kind: 'loading' })).toThrow(
      /Cargando ocurrencias congeladas/i,
    );
  });

  it('D — ready derives the frozen items', () => {
    const project = liveProject();
    const derived = deriveEngineeringBomItems(project, {
      kind: 'ready',
      projection: frozenProjection(),
    });
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      id: 'line-a',
      furnitureInstanceId: 'fi-a',
      quantity: 1,
      workshopOccurrenceOrdinal: 1,
    });
  });

  it('E — error never falls back to live items', () => {
    const project = liveProject();
    expect(() => deriveEngineeringBomItems(project, { kind: 'error', message: 'boom' })).toThrow(
      /projection failed: boom/,
    );
  });
});

describe('fetchProjectWorkshopOccurrences (#781)', () => {
  it('maps the exact-release payload onto the domain projection', async () => {
    stubFetch((url) => {
      if (url.endsWith(`/projects/${PROJECT_ID}/production-releases/${RELEASE_ID}/workshop-occurrences`)) {
        return {
          status: 200,
          body: {
            release_id: RELEASE_ID,
            release_number: 3,
            covers_all_current_instances: true,
            assignments: [
              {
                furniture_instance_id: 'fi-a',
                project_item_id: 'line-a',
                workshop_occurrence_ordinal: 1,
              },
            ],
          },
        };
      }
      return undefined;
    });
    const projection = await fetchProjectWorkshopOccurrences({
      baseUrl: 'http://api.test',
      token: 'token-1',
      projectId: PROJECT_ID,
      releaseId: RELEASE_ID,
    });
    expect(projection).toEqual(frozenProjection());
  });
});

describe('deriveEngineeringWorkshopOccurrenceView — no live rows/labels while loading (#781 micro-task #3 §9)', () => {
  it('loading: every derived surface is null, modules empty, flag set', () => {
    const view = deriveEngineeringWorkshopOccurrenceView({
      project: liveProject(),
      catalog: null,
      modules: [{ id: 'mod-1' } as Module],
      occurrenceContext: { kind: 'loading' },
      moduleLabelsMeta: { customerName: 'Lab', revision: undefined },
    });
    expect(view.occurrencesLoading).toBe(true);
    // The regression itself: no live BOM, no live cut rows, no live labels,
    // not even the live module list — the screen waits for the authority.
    expect(view.bomProject).toBeNull();
    expect(view.cutRows).toBeNull();
    expect(view.cutError).toBeNull();
    expect(view.labels).toBeNull();
    expect(view.labelsError).toBeNull();
    expect(view.modules).toEqual([]);
  });

  it('error: nothing derived, message surfaces as the cut error', () => {
    const view = deriveEngineeringWorkshopOccurrenceView({
      project: liveProject(),
      catalog: null,
      modules: [],
      occurrenceContext: { kind: 'error', message: 'boom-500' },
      moduleLabelsMeta: { customerName: 'Lab', revision: undefined },
    });
    expect(view.occurrencesLoading).toBe(false);
    expect(view.bomProject).toBeNull();
    expect(view.cutRows).toBeNull();
    expect(view.labels).toBeNull();
    expect(view.cutError).toContain('boom-500');
  });

  it('idle without catalog: live project flows, nothing frozen invented', () => {
    const project = liveProject();
    const view = deriveEngineeringWorkshopOccurrenceView({
      project,
      catalog: null,
      modules: [],
      occurrenceContext: { kind: 'idle' },
      moduleLabelsMeta: { customerName: 'Lab', revision: undefined },
    });
    expect(view.occurrencesLoading).toBe(false);
    expect(view.bomProject).not.toBeNull();
    expect(view.bomProject!.items).toBe(project.items);
    expect(view.cutRows).toBeNull();
    expect(view.cutError).toBeNull();
  });
});

describe('resolveEffectiveOccurrenceContext — closing the release-loading window (#781 micro-task #3B)', () => {
  const RELEASE_ID = '20000000-0000-4000-8000-000000000002';

  it('1 — route release + release loading → effective loading, view derives nothing live', () => {
    const effective = resolveEffectiveOccurrenceContext({
      routeReleaseId: RELEASE_ID,
      releaseContextKind: 'loading',
      occurrenceContext: { kind: 'idle' },
    });
    expect(effective).toEqual({ kind: 'loading' });
    const view = deriveEngineeringWorkshopOccurrenceView({
      project: liveProject(),
      catalog: null,
      modules: [{ id: 'mod-1' } as Module],
      occurrenceContext: effective,
      moduleLabelsMeta: { customerName: 'Lab', revision: undefined },
    });
    expect(view.occurrencesLoading).toBe(true);
    expect(view.bomProject).toBeNull();
    expect(view.cutRows).toBeNull();
    expect(view.labels).toBeNull();
    expect(view.moduleLabels).toBeNull();
  });

  it('2 — occurrence loading gates module labels (never attempted, no error either)', () => {
    const bogusCatalog = {} as Catalog;
    const loadingView = deriveEngineeringWorkshopOccurrenceView({
      project: liveProject(),
      catalog: bogusCatalog,
      modules: [],
      occurrenceContext: { kind: 'loading' },
      moduleLabelsMeta: { customerName: 'Lab', revision: undefined },
    });
    expect(loadingView.moduleLabels).toBeNull();
    expect(loadingView.moduleLabelsError).toBeNull();
    // Contrast: the SAME bogus catalog under idle IS attempted and fails
    // loudly — proving the loading nulls come from the gate, not the input.
    const idleView = deriveEngineeringWorkshopOccurrenceView({
      project: liveProject(),
      catalog: bogusCatalog,
      modules: [],
      occurrenceContext: { kind: 'idle' },
      moduleLabelsMeta: { customerName: 'Lab', revision: undefined },
    });
    expect(idleView.moduleLabels).toBeNull();
    // Attempted and failed loudly (bogus catalog) — proving the loading
    // nulls above come from the gate, not from the input.
    expect(idleView.moduleLabelsError).not.toBeNull();
  });

  it('3 — pre-release without releaseId: live behaviour intact', () => {
    const idle = { kind: 'idle' } as const;
    expect(
      resolveEffectiveOccurrenceContext({
        routeReleaseId: null,
        releaseContextKind: 'idle',
        occurrenceContext: idle,
      }),
    ).toBe(idle);
    const project = liveProject();
    expect(
      deriveEngineeringWorkshopOccurrenceView({
        project,
        catalog: null,
        modules: [],
        occurrenceContext: idle,
        moduleLabelsMeta: { customerName: 'Lab', revision: undefined },
      }).bomProject!.items,
    ).toBe(project.items);
  });

  it('4 — ready passes through untouched (current behaviour intact)', () => {
    const ready = { kind: 'ready', projection: frozenProjection() } as const;
    expect(
      resolveEffectiveOccurrenceContext({
        routeReleaseId: RELEASE_ID,
        releaseContextKind: 'ready',
        occurrenceContext: ready,
      }),
    ).toBe(ready);
    // Release-context error keeps its existing EmptyState upstream: the
    // effective context is NOT rewritten here.
    const errorOccurrence = { kind: 'error', message: 'boom' } as const;
    expect(
      resolveEffectiveOccurrenceContext({
        routeReleaseId: RELEASE_ID,
        releaseContextKind: 'error',
        occurrenceContext: errorOccurrence,
      }),
    ).toBe(errorOccurrence);
  });
});
