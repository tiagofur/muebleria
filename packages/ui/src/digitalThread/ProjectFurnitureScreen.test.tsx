// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ProjectFurnitureScreen,
  projectFurnitureQueryKeys,
  type ProjectFurnitureContextState,
} from './ProjectFurnitureScreen';

const here = dirname(fileURLToPath(import.meta.url));

interface FetchRoutes {
  furniture: unknown[];
  quoteRevisions?: unknown[];
  designs?: unknown[];
  releases?: unknown[];
  workingCopy?: Record<string, unknown> | null;
  designRevisions?: unknown[];
  reconciliation?: Record<string, unknown>;
}

const API = 'http://api.test';
const PROJECT = '11111111-0000-4000-8000-000000000001';
const FINGERPRINT = `sha256-${'a'.repeat(64)}`;

function apiErrorEnvelope(code: string, message: string): string {
  return JSON.stringify({
    code,
    message,
    fieldErrors: {},
    requestId: 'req-test',
    retryable: false,
    details: {},
  });
}

function stubFetch(
  routes: FetchRoutes,
  overrides: Record<string, { status: number; body: string }> = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    for (const [prefix, override] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) {
        return new Response(override.body, {
          status: override.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    if (path === `/projects/${PROJECT}/furniture-instances` && method === 'GET') {
      return json(routes.furniture);
    }
    if (path === `/projects/${PROJECT}/quote-revisions` && method === 'GET') {
      return json(routes.quoteRevisions ?? []);
    }
    if (path === `/projects/${PROJECT}/designs` && method === 'GET') {
      return json(routes.designs ?? []);
    }
    if (path === `/projects/${PROJECT}/production-releases` && method === 'GET') {
      return json(routes.releases ?? []);
    }
    if (path === '/designs/d-1/working-copy' && method === 'GET') {
      return json(
        routes.workingCopy ?? {
          design_id: 'd-1',
          project_id: PROJECT,
          source_type: 'sketchup',
          items: [],
          updated_at: '2026-09-01T12:00:00Z',
        },
      );
    }
    if (path === '/designs/d-1/revisions' && method === 'GET') {
      return json(routes.designRevisions ?? []);
    }
    if (path === `/projects/${PROJECT}/reconciliation` && method === 'POST') {
      return json(routes.reconciliation ?? {});
    }
    return new Response(apiErrorEnvelope('NOT_FOUND', `unrouted ${method} ${path}`), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function instance(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    project_id: PROJECT,
    origin: 'quote',
    lifecycle_status: 'active',
    version: 1,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    furniture_definition_id: 'd1000000-0000-4000-8000-000000000001',
    display: { name: 'Gabinete Base 600', dimensions_mm: { width: 600, height: 720, depth: 560 } },
    ...overrides,
  };
}

function quoteRevision(id: string, revisionNumber: number, items: unknown[]): Record<string, unknown> {
  return {
    id,
    projectId: PROJECT,
    revisionNumber,
    status: 'accepted',
    sourceType: 'manual',
    createdAt: '2026-09-01T11:00:00Z',
    items,
  };
}

const design = {
  id: 'd-1',
  project_id: PROJECT,
  name: 'Cocina principal',
  status: 'active',
  created_at: '2026-09-01T09:00:00Z',
  updated_at: '2026-09-01T09:00:00Z',
};

function renderScreen(options: {
  initialContext?: ProjectFurnitureContextState | null;
  onContextChange?: (context: ProjectFurnitureContextState) => void;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys = projectFurnitureQueryKeys(['session', 'scope-a'], PROJECT);
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectFurnitureScreen
        baseUrl={API}
        token="t"
        projectId={PROJECT}
        queryKeys={keys}
        initialContext={options.initialContext ?? null}
        onContextChange={options.onContextChange}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectFurnitureScreen — generated contract & tenant scope', () => {
  it('consumes only generated client reads (no handwritten fetch/DTO)', () => {
    const src = readFileSync(join(here, 'ProjectFurnitureScreen.tsx'), 'utf8');
    expect(src).toContain('api.listProjectFurnitureInstances');
    expect(src).toContain('api.listProjectQuoteRevisions');
    expect(src).toContain('api.reconcileProjectDesign');
    // Pending/placed and reconciliation derive from the pure view-model over
    // server projections; the screen holds no status policy of its own.
    expect(src).toContain("from './furnitureMatrix'");
    expect(src).not.toContain('fetch(');
    // Design tokens only in the stylesheet (no hardcoded hex).
    const css = readFileSync(join(here, 'digitalThread.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('query keys carry the session scope and the project id (tenant isolation)', () => {
    const keys = projectFurnitureQueryKeys(['session', 'scope-a'], PROJECT);
    expect(keys.furniture).toEqual([
      'project-furniture',
      'session',
      'scope-a',
      PROJECT,
      'furniture-instances',
    ]);
    expect(keys.reconciliation('q', 'd')).toContain('reconciliation');
    expect(JSON.stringify(keys.root)).toContain(PROJECT);
  });
});

describe('ProjectFurnitureScreen — matrix behavior (#500 acceptance)', () => {
  it('renders quantity=3 as three independently traceable units (Unidad i de N)', async () => {
    stubFetch({ furniture: [instance('fi-1'), instance('fi-2'), instance('fi-3')] });
    renderScreen({});

    expect(await screen.findByTestId('pf-table')).toBeTruthy();
    const rows = screen.getAllByTestId(/^pf-row-/);
    expect(rows).toHaveLength(3);
    expect(screen.getByText('Unidad 1 de 3')).toBeTruthy();
    expect(screen.getByText('Unidad 2 de 3')).toBeTruthy();
    expect(screen.getByText('Unidad 3 de 3')).toBeTruthy();
    // Server-derived summary counts.
    expect(screen.getByTestId('pf-summary-active').textContent).toContain('3');
    // No design context yet: honest "Sin diseño" per unit, nobody pending.
    expect(within(screen.getByTestId('pf-row-fi-1')).getByText('Sin diseño')).toBeTruthy();
    expect(screen.getByTestId('pf-summary-pending').textContent).toContain('0');
  });

  it('derives placed/pending from the working copy of the selected design', async () => {
    stubFetch({
      furniture: [instance('fi-1'), instance('fi-2'), instance('fi-3')],
      designs: [design],
      workingCopy: {
        design_id: 'd-1',
        project_id: PROJECT,
        source_type: 'sketchup',
        updated_at: '2026-09-01T12:00:00Z',
        items: [
          { id: 'w-1', design_id: 'd-1', furniture_instance_id: 'fi-1', parameters: {}, material_choices: {}, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z' },
          { id: 'w-2', design_id: 'd-1', furniture_instance_id: 'fi-2', parameters: {}, material_choices: {}, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z' },
        ],
      },
    });
    renderScreen({});

    await screen.findByTestId('pf-table');
    await waitFor(() => {
      expect(within(screen.getByTestId('pf-row-fi-1')).getByText('En el diseño')).toBeTruthy();
    });
    expect(within(screen.getByTestId('pf-row-fi-2')).getByText('En el diseño')).toBeTruthy();
    expect(within(screen.getByTestId('pf-row-fi-3')).getByText('Pendiente de colocar')).toBeTruthy();
    expect(screen.getByTestId('pf-summary-placed').textContent).toContain('2');
    expect(screen.getByTestId('pf-summary-pending').textContent).toContain('1');
  });

  it('shows the exact QuoteRevision context and pins the selected revision through onContextChange', async () => {
    const fetchMock = stubFetch({
      furniture: [instance('fi-1')],
      quoteRevisions: [
        quoteRevision('qr-1', 1, [
          { furnitureInstanceId: 'fi-1', parameters: {}, materialChoices: {}, lifecycleStatus: 'active' },
        ]),
        quoteRevision('qr-2', 2, []),
      ],
    });
    const onContextChange = vi.fn();
    renderScreen({ onContextChange });

    const select = await screen.findByTestId('pf-quote-revision-select');
    // View default = newest revision, pinned once selected.
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('qr-2'));
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ quoteRevisionId: 'qr-2' }),
      ),
    );
    // The commercial column derives from the exact selected snapshot.
    expect(screen.getByTestId('pf-cell-quote-fi-1').textContent).toContain('—');

    // The user explicitly selects the historical revision: the view retargets
    // through the pinned URL context, never silently.
    await userEvent.selectOptions(select, 'qr-1');
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ quoteRevisionId: 'qr-1' }),
      ),
    );
    expect(screen.getByTestId('pf-cell-quote-fi-1').textContent).toContain('En Q1');
    // Reconciliation is never called without an exact published design revision.
    const calls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes('/reconciliation'))).toBe(false);
  });

  it('mirrors reconciliation statuses from the server for exact revisions', async () => {
    stubFetch({
      furniture: [instance('fi-1'), instance('fi-2')],
      quoteRevisions: [quoteRevision('qr-1', 1, [])],
      designs: [design],
      designRevisions: [
        {
          id: 'dr-1',
          design_id: 'd-1',
          revision_number: 1,
          source_type: 'sketchup',
          status: 'published',
          created_at: '2026-09-01T13:00:00Z',
          items: [
            { id: 'dri-1', design_revision_id: 'dr-1', furniture_instance_id: 'fi-1', parameters: {}, material_choices: {}, created_at: '2026-09-01T13:00:00Z' },
          ],
        },
      ],
      reconciliation: {
        projectId: PROJECT,
        quoteRevisionId: 'qr-1',
        designRevisionId: 'dr-1',
        summary: { total: 2, synced: 0, quotedNotModeled: 1, modeledNotQuoted: 0, modified: 0, removed: 1, conflict: 0 },
        items: [
          { furnitureInstanceId: 'fi-1', status: 'quoted_not_modeled', differences: [], impact: { commercial: false, manufacturing: false, spatial: false } },
          { furnitureInstanceId: 'fi-2', status: 'removed', differences: [], impact: { commercial: false, manufacturing: false, spatial: false } },
        ],
        impact: { requiresRequote: false, requiresResolution: false, canRequote: true, commercialChanges: 0, manufacturingChanges: 0, spatialChanges: 0 },
      },
    });
    renderScreen({});

    const contextSelect = await screen.findByTestId('pf-design-context-select');
    // The revision options arrive asynchronously; wait for the exact R1
    // option to exist before selecting it.
    await waitFor(() => {
      const option = (contextSelect as HTMLSelectElement).querySelector('option[value="dr-1"]');
      expect(option).not.toBeNull();
    });
    await userEvent.selectOptions(contextSelect, 'dr-1');
    await waitFor(() => {
      expect(within(screen.getByTestId('pf-row-fi-1')).getByText('Cotizada sin modelar')).toBeTruthy();
    });
    expect(within(screen.getByTestId('pf-row-fi-2')).getByText('Retirada del diseño')).toBeTruthy();
    expect(screen.getByTestId('pf-summary-attention').textContent).toContain('2');
  });

  it('keeps a FurnitureInstance visible before any Design exists (no-design empty context)', async () => {
    stubFetch({
      furniture: [instance('fi-1', { origin: 'manual', furniture_definition_id: null, display: undefined })],
    });
    renderScreen({});

    await screen.findByTestId('pf-table');
    expect(screen.getByText('Mueble del proyecto')).toBeTruthy();
    expect(within(screen.getByTestId('pf-row-fi-1')).getByText('Manual')).toBeTruthy();
    // The design selector answers honestly without inventing a design.
    expect((screen.getByTestId('pf-design-select') as HTMLSelectElement).value).toBe('');
  });

  it('distinguishes empty, no-results, forbidden and error states', async () => {
    // Empty: visible project, zero units.
    stubFetch({ furniture: [] });
    const { unmount } = renderScreen({});
    expect(await screen.findByText('Esta obra todavía no tiene muebles físicos')).toBeTruthy();
    unmount();
    cleanup();
    vi.unstubAllGlobals();

    // No-results: filters hide everything, a clear action exists.
    stubFetch({ furniture: [instance('fi-1')] });
    renderScreen({});
    await screen.findByTestId('pf-table');
    await userEvent.type(screen.getByLabelText('Buscar muebles'), 'no-existe');
    expect(await screen.findByText('Ningún mueble coincide con los filtros')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await screen.findByTestId('pf-table');
  });

  it('surfaces a forbidden projection with a distinct message', async () => {
    stubFetch({ furniture: [] }, {
      [`/projects/${PROJECT}/furniture-instances`]: {
        status: 403,
        body: apiErrorEnvelope('FORBIDDEN', 'no tenés permiso para ver los muebles del proyecto'),
      },
    });
    renderScreen({});

    expect(await screen.findByText('No se pudo cargar la matriz de muebles')).toBeTruthy();
    expect(screen.getByText('No tenés permiso para ver los muebles de esta obra.')).toBeTruthy();
  });

  it('surfaces a cross-tenant project as a uniform not-found', async () => {
    stubFetch({ furniture: [] }, {
      [`/projects/${PROJECT}/furniture-instances`]: {
        status: 404,
        body: apiErrorEnvelope('NOT_FOUND', 'proyecto no encontrado'),
      },
    });
    renderScreen({});

    expect(await screen.findByText('La obra no existe o no es accesible desde tu organización.')).toBeTruthy();
  });

  it('shows the release reference pinned to the exact revisions', async () => {
    stubFetch({
      furniture: [instance('fi-1')],
      releases: [
        {
          id: 'rel-1',
          project_id: PROJECT,
          release_number: 1,
          design_revision_id: 'dr-1',
          design_revision_number: 1,
          quote_revision_id: 'qr-1',
          manufacturing_fingerprint: FINGERPRINT,
          status: 'active',
          released_by: 'u-1',
          released_at: '2026-09-01T10:00:00Z',
          staleness: {
            manufacturing_stale: false,
            current_design_revision_id: null,
            current_design_revision_number: null,
          },
        },
      ],
    });
    renderScreen({});

    const reference = await screen.findByTestId('pf-release-reference');
    expect(reference.textContent).toContain('Release #1 fijado a R1');
  });
});
