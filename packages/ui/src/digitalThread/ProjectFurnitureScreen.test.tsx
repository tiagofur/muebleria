// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  FurnitureWorkspaceUnit,
  ProjectFurnitureWorkspace,
  ProjectFurnitureWorkspaceRequest,
} from '@granete/storage';
import {
  ProjectFurnitureScreen,
  projectFurnitureQueryKeys,
  type ProjectFurnitureContextState,
} from './ProjectFurnitureScreen';

const here = dirname(fileURLToPath(import.meta.url));

interface FetchRoutes {
  workspace?: ProjectFurnitureWorkspace;
  workspaceHandler?: (body: ProjectFurnitureWorkspaceRequest) => ProjectFurnitureWorkspace;
  furniture?: unknown[];
  quoteRevisions?: unknown[];
  designs?: unknown[];
  designRevisions?: unknown[];
}

const API = 'http://api.test';
const PROJECT = '11111111-0000-4000-8000-000000000001';

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

function defaultWorkspaceFromFurniture(
  furniture: unknown[],
  body: ProjectFurnitureWorkspaceRequest = {},
): ProjectFurnitureWorkspace {
  const units: FurnitureWorkspaceUnit[] = (furniture as any[]).map((f, idx) => ({
    furnitureInstance: f,
    commercial: {
      present: body.quoteRevisionId !== null && body.quoteRevisionId !== undefined,
      lifecycleStatus: f.lifecycle_status,
    },
    commercialGrouping:
      f.origin === 'quote'
        ? {
            quoteLineId: '00000000-0000-4000-8000-000000000001',
            unitIndex: idx + 1,
            unitTotal: furniture.length,
            quoteRevisionId: body.quoteRevisionId ?? null,
          }
        : undefined,
    design: {
      presence: body.designContextKind === 'none' || !body.designContextKind ? 'none' : 'pending',
      contextKind: body.designContextKind ?? 'none',
      designId: body.designId ?? null,
      designRevisionId: body.designRevisionId ?? null,
    },
  }));

  return {
    projectId: PROJECT,
    designContext: {
      kind: body.designContextKind ?? 'none',
      designId: body.designId ?? null,
      designRevisionId: body.designRevisionId ?? null,
    },
    summary: {
      total: units.length,
      activeUnits: units.filter((u) => u.furnitureInstance.lifecycle_status === 'active').length,
      quoted: units.filter((u) => u.commercial.present).length,
      placed: units.filter((u) => u.design.presence === 'placed').length,
      pending: units.filter((u) => u.design.presence === 'pending').length,
      actionRequired: units.filter((u) => u.actionRequired !== undefined).length,
      removed: units.filter((u) => u.furnitureInstance.lifecycle_status === 'removed').length,
      cancelled: units.filter((u) => u.furnitureInstance.lifecycle_status === 'cancelled').length,
    },
    units,
  };
}

function stubFetch(
  routes: FetchRoutes,
  overrides: Record<string, { status: number; body: string }> = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

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

    if (path === `/projects/${PROJECT}/furniture-workspace` && method === 'POST') {
      const body: ProjectFurnitureWorkspaceRequest = init?.body
        ? JSON.parse(String(init.body))
        : {};
      if (routes.workspaceHandler) {
        return json(routes.workspaceHandler(body));
      }
      if (routes.workspace) {
        return json(routes.workspace);
      }
      return json(defaultWorkspaceFromFurniture(routes.furniture ?? [], body));
    }
    if (path === `/projects/${PROJECT}/quote-revisions` && method === 'GET') {
      return json(routes.quoteRevisions ?? []);
    }
    if (path === `/projects/${PROJECT}/designs` && method === 'GET') {
      return json(routes.designs ?? []);
    }
    if (path === '/designs/d-1/revisions' && method === 'GET') {
      return json(routes.designRevisions ?? []);
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
    expect(src).toContain('api.getProjectFurnitureWorkspace');
    expect(src).toContain('api.listProjectQuoteRevisions');
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
    const testContext: ProjectFurnitureContextState = {
      quoteRevisionId: 'qr-1',
      designId: 'd-1',
      designContextKind: 'working',
      designRevisionId: null,
    };
    expect(keys.workspace(testContext)).toEqual([
      'project-furniture',
      'session',
      'scope-a',
      PROJECT,
      'workspace',
      'qr-1',
      'd-1',
      'working',
      null,
    ]);
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

  it('projects placed/pending and actionRequired verbatim from backend workspace read model', async () => {
    const workspace: ProjectFurnitureWorkspace = {
      projectId: PROJECT,
      designContext: { kind: 'working', designId: 'd-1' },
      summary: {
        total: 3,
        activeUnits: 3,
        quoted: 3,
        placed: 2,
        pending: 1,
        actionRequired: 1,
        removed: 0,
        cancelled: 0,
      },
      units: [
        {
          furnitureInstance: instance('fi-1') as any,
          commercial: { present: true, lifecycleStatus: 'active' },
          commercialGrouping: { quoteLineId: 'ql-1', unitIndex: 1, unitTotal: 3 },
          design: { presence: 'placed', contextKind: 'working', designId: 'd-1' },
        },
        {
          furnitureInstance: instance('fi-2') as any,
          commercial: { present: true, lifecycleStatus: 'active' },
          commercialGrouping: { quoteLineId: 'ql-1', unitIndex: 2, unitTotal: 3 },
          design: { presence: 'placed', contextKind: 'working', designId: 'd-1' },
        },
        {
          furnitureInstance: instance('fi-3') as any,
          commercial: { present: true, lifecycleStatus: 'active' },
          commercialGrouping: { quoteLineId: 'ql-1', unitIndex: 3, unitTotal: 3 },
          design: { presence: 'pending', contextKind: 'working', designId: 'd-1' },
          actionRequired: {
            code: 'pending_placement',
            message: 'Pendiente de colocar en el diseño',
            remediation: 'Colocá la unidad desde el panel de muebles',
          },
        },
      ],
    };

    stubFetch({
      designs: [design],
      workspace,
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
    stubFetch({
      quoteRevisions: [
        quoteRevision('qr-1', 1, []),
        quoteRevision('qr-2', 2, []),
      ],
      workspaceHandler: (body) => {
        const isQr1 = body.quoteRevisionId === 'qr-1';
        return {
          projectId: PROJECT,
          designContext: { kind: 'none' },
          summary: {
            total: 1,
            activeUnits: 1,
            quoted: isQr1 ? 1 : 0,
            placed: 0,
            pending: 0,
            actionRequired: 0,
            removed: 0,
            cancelled: 0,
          },
          units: [
            {
              furnitureInstance: instance('fi-1') as any,
              commercial: { present: isQr1, lifecycleStatus: 'active' },
              commercialGrouping: isQr1
                ? { quoteLineId: 'ql-1', unitIndex: 1, unitTotal: 1, quoteRevisionId: 'qr-1' }
                : undefined,
              design: { presence: 'none', contextKind: 'none' },
            },
          ],
        };
      },
    });
    const onContextChange = vi.fn();
    renderScreen({ onContextChange });

    const select = await screen.findByTestId('pf-quote-revision-select');
    // View default = newest revision, pinned once selected.
    await waitFor(() =>
      expect(
        (screen.getByTestId('pf-quote-revision-select') as HTMLSelectElement).value,
      ).toBe('qr-2'),
    );
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ quoteRevisionId: 'qr-2' }),
      ),
    );
    // The commercial column derives from the exact selected snapshot.
    expect(screen.getByTestId('pf-cell-quote-fi-1').textContent).toContain('—');

    // The user explicitly selects the historical revision: the view retargets
    // through the pinned URL context, never silently.
    await userEvent.selectOptions(screen.getByTestId('pf-quote-revision-select'), 'qr-1');
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ quoteRevisionId: 'qr-1' }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('pf-cell-quote-fi-1').textContent).toContain('En Q1');
    });
  });

  it('mirrors reconciliation statuses from the server for exact revisions', async () => {
    stubFetch({
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
          items: [],
        },
      ],
      workspaceHandler: (body) => {
        const isRevisionContext = body.designContextKind === 'revision';
        return {
          projectId: PROJECT,
          designContext: {
            kind: body.designContextKind ?? 'none',
            designId: body.designId ?? null,
            designRevisionId: body.designRevisionId ?? null,
          },
          summary: {
            total: 2,
            activeUnits: 2,
            quoted: 2,
            placed: 2,
            pending: 0,
            actionRequired: isRevisionContext ? 2 : 0,
            removed: 0,
            cancelled: 0,
          },
          units: [
            {
              furnitureInstance: instance('fi-1') as any,
              commercial: { present: true },
              design: { presence: 'placed', contextKind: body.designContextKind ?? 'none' },
              reconciliation: isRevisionContext
                ? {
                    furnitureInstanceId: 'fi-1',
                    status: 'quoted_not_modeled',
                    differences: [],
                    impact: { commercial: false, manufacturing: false, spatial: false },
                  }
                : undefined,
              actionRequired: isRevisionContext
                ? {
                    code: 'quoted_not_modeled',
                    message: 'Cotizada sin modelar',
                    remediation: 'Colocá la unidad en el diseño',
                  }
                : undefined,
            },
            {
              furnitureInstance: instance('fi-2') as any,
              commercial: { present: true },
              design: { presence: 'placed', contextKind: body.designContextKind ?? 'none' },
              reconciliation: isRevisionContext
                ? {
                    furnitureInstanceId: 'fi-2',
                    status: 'removed',
                    differences: [],
                    impact: { commercial: false, manufacturing: false, spatial: false },
                  }
                : undefined,
              actionRequired: isRevisionContext
                ? {
                    code: 'removed',
                    message: 'Retirada del diseño',
                    remediation: 'Confirmá la baja o reincorporá la unidad',
                  }
                : undefined,
            },
          ],
        };
      },
    });
    renderScreen({});

    // The revision options arrive asynchronously; wait for the exact R1
    // option to exist before selecting it.
    await waitFor(() => {
      const select = screen.getByTestId('pf-design-context-select') as HTMLSelectElement;
      const option = select.querySelector('option[value="dr-1"]');
      expect(option).not.toBeNull();
    });
    await userEvent.selectOptions(screen.getByTestId('pf-design-context-select'), 'dr-1');
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
    stubFetch(
      { furniture: [] },
      {
        [`/projects/${PROJECT}/furniture-workspace`]: {
          status: 403,
          body: apiErrorEnvelope('FORBIDDEN', 'no tenés permiso para ver los muebles del proyecto'),
        },
      },
    );
    renderScreen({});

    expect(await screen.findByText('No se pudo cargar la matriz de muebles')).toBeTruthy();
    expect(screen.getByText('No tenés permiso para ver los muebles de esta obra.')).toBeTruthy();
  });

  it('surfaces a cross-tenant project as a uniform not-found', async () => {
    stubFetch(
      { furniture: [] },
      {
        [`/projects/${PROJECT}/furniture-workspace`]: {
          status: 404,
          body: apiErrorEnvelope('NOT_FOUND', 'proyecto no encontrado'),
        },
      },
    );
    renderScreen({});

    expect(
      await screen.findByText('La obra no existe o no es accesible desde tu organización.'),
    ).toBeTruthy();
  });

  it('shows the release reference pinned to the exact revisions and distinguishes working copy', async () => {
    const workspaceWithRelease: ProjectFurnitureWorkspace = {
      projectId: PROJECT,
      designContext: { kind: 'revision', designRevisionId: 'dr-1' },
      release: {
        id: 'rel-1',
        releaseNumber: 1,
        designRevisionId: 'dr-1',
        designRevisionNumber: 1,
        quoteRevisionId: 'qr-1',
        manufacturingStale: false,
      },
      latestProjectRelease: {
        id: 'rel-1',
        releaseNumber: 1,
        designRevisionId: 'dr-1',
        designRevisionNumber: 1,
        quoteRevisionId: 'qr-1',
        manufacturingStale: false,
      },
      summary: {
        total: 1,
        activeUnits: 1,
        quoted: 1,
        placed: 1,
        pending: 0,
        actionRequired: 0,
        removed: 0,
        cancelled: 0,
      },
      units: [
        {
          furnitureInstance: instance('fi-1') as any,
          commercial: { present: true },
          design: { presence: 'placed', contextKind: 'revision' },
        },
      ],
    };

    stubFetch({
      quoteRevisions: [quoteRevision('qr-1', 1, [])],
      workspace: workspaceWithRelease,
    });
    renderScreen({});

    const reference = await screen.findByTestId('pf-release-reference');
    expect(reference.textContent).toContain('Release #1 fijado a R1 y Q1');
  });
});
