// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MaterialBoard } from '@granete/domain';
import { GraneteApiClient, GraneteApiError } from '@granete/storage';
import {
  DesignWorkingMaterialsPanel,
} from './DesignWorkingMaterialsPanel';
import { projectDesignsQueryKeys } from './ProjectDesignsScreen';

const API = 'http://api.test/api';
const PROJECT_ID = '11111111-0000-4000-8000-000000000001';
const DESIGN_ID = '22222222-0000-4000-8000-000000000001';
const UNIT_ID = '77777777-0000-4000-8000-000000000001';
const AUTHORED_ONLY_UNIT_ID = '77777777-0000-4000-8000-000000000002';
const MATERIAL_A_ID = 'c0000000-0000-4000-8000-0000000000aa';
const MATERIAL_B_ID = 'c0000000-0000-4000-8000-0000000000bb';
const WORKING_UPDATED_AT = '2026-09-14T10:00:00.123456Z';

function board(id: string, name: string, code: string): MaterialBoard {
  return {
    id,
    code,
    name,
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: false,
    boardPrice: 1000,
    wastePercent: 10,
    costPerM2: 223.88,
    active: true,
  };
}

const CATALOG_MATERIALS = [board(MATERIAL_A_ID, 'Melamina blanca', 'MAT-A'), board(MATERIAL_B_ID, 'Roble natural', 'MAT-B')];

function provenancePayload(items: unknown[], updatedAt: string | null = WORKING_UPDATED_AT) {
  return {
    design_id: DESIGN_ID,
    project_id: PROJECT_ID,
    working_copy_updated_at: updatedAt,
    items,
  };
}

// One candidate unit (FRENTES quoted, missing from working; INTERIOR authored)
// plus one fully authored unit that is NOT a candidate.
const CANDIDATE_ITEM = {
  furniture_instance_id: UNIT_ID,
  furniture_definition_id: null,
  reconcilable: true,
  roles: [
    {
      role: 'FRENTES',
      quoted_choice: MATERIAL_B_ID,
      provenance: 'quoted_missing_from_working',
    },
    {
      role: 'INTERIOR',
      working_choice: MATERIAL_A_ID,
      effective_choice: MATERIAL_A_ID,
      provenance: 'authored',
    },
  ],
};

const AUTHORED_ONLY_ITEM = {
  furniture_instance_id: AUTHORED_ONLY_UNIT_ID,
  furniture_definition_id: null,
  reconcilable: false,
  roles: [
    {
      role: 'FRENTES',
      working_choice: MATERIAL_B_ID,
      effective_choice: MATERIAL_B_ID,
      provenance: 'authored',
    },
  ],
};

const FURNITURE_INSTANCES = [
  {
    id: UNIT_ID,
    project_id: PROJECT_ID,
    furniture_definition_id: null,
    origin: 'quote',
    lifecycle_status: 'active',
    version: 1,
    created_at: '2026-09-14T09:00:00Z',
    updated_at: '2026-09-14T09:00:00Z',
    display: { name: 'Bajo 600' },
  },
  {
    id: AUTHORED_ONLY_UNIT_ID,
    project_id: PROJECT_ID,
    furniture_definition_id: null,
    origin: 'quote',
    lifecycle_status: 'active',
    version: 1,
    created_at: '2026-09-14T09:00:00Z',
    updated_at: '2026-09-14T09:00:00Z',
    display: { name: 'Alacena 900' },
  },
];

interface MockOptions {
  provenance?: () => unknown;
  provenanceFail?: () => boolean;
  instances?: unknown[];
  reconcile?: (body: Record<string, unknown>, key: string | null) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
}

function setupMock(options: MockOptions = {}) {
  const calls: { method: string; path: string; body: unknown; idempotencyKey: string | null }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/api(?=\/)/, '');
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const key = init?.headers instanceof Headers ? init.headers.get('Idempotency-Key') : null;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, idempotencyKey: key });

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    const provenanceMatch = path.match(/^\/designs\/([^/]+)\/working-copy\/material-provenance$/);
    if (method === 'GET' && provenanceMatch) {
      if (options.provenanceFail?.()) {
        return json({ code: 'INTERNAL', message: 'provenance failed' }, 500);
      }
      return json((options.provenance ?? (() => provenancePayload([CANDIDATE_ITEM, AUTHORED_ONLY_ITEM])))());
    }
    if (method === 'GET' && /^\/projects\/([^/]+)\/furniture-instances$/.test(path)) {
      return json(options.instances ?? FURNITURE_INSTANCES);
    }
    const reconcileMatch = path.match(/^\/designs\/([^/]+)\/working-copy\/material-choices:reconcile$/);
    if (method === 'POST' && reconcileMatch) {
      const result = await (options.reconcile
        ? options.reconcile(body as Record<string, unknown>, key)
        : Promise.resolve({
            status: 200,
            body: {
              design_id: DESIGN_ID,
              project_id: PROJECT_ID,
              furniture_instance_id: (body as { furniture_instance_id: string }).furniture_instance_id,
              filled_choices: { FRENTES: MATERIAL_B_ID },
              preserved_choices: { INTERIOR: MATERIAL_A_ID },
              working_copy_updated_at: '2026-09-14T10:05:00.654321Z',
            },
          }));
      return json(result.body, result.status);
    }
    return json({ code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function renderPanel(props: {
  designId?: string;
  canMutate?: boolean;
  catalogMaterials?: readonly MaterialBoard[];
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys = projectDesignsQueryKeys(['test-scope'], PROJECT_ID);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DesignWorkingMaterialsPanel
        api={new GraneteApiClient(API)}
        token="test-jwt"
        projectId={PROJECT_ID}
        designId={props.designId ?? DESIGN_ID}
        canMutate={props.canMutate ?? true}
        queryKeys={keys}
        catalogMaterials={props.catalogMaterials ?? CATALOG_MATERIALS}
      />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, keys };
}

async function openReviewModal() {
  await screen.findByTestId('pending-materials-strip');
  await userEvent.click(screen.getByTestId('review-pending-materials-btn'));
  return screen.getByTestId('pending-materials-modal');
}

describe('DesignWorkingMaterialsPanel (#658)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the candidate with its role, honest provenance and a repair action', async () => {
    setupMock();
    renderPanel();

    const strip = await screen.findByTestId('pending-materials-strip');
    expect(strip).toHaveTextContent('1 mueble tiene materiales cotizados que faltan en el borrador');

    const modal = await openReviewModal();
    const unit = within(modal).getByTestId(`pending-unit-${UNIT_ID}`);
    expect(unit).toBeVisible();

    const candidateRole = within(modal).getByTestId(`pending-role-${UNIT_ID}-FRENTES`);
    expect(candidateRole).toHaveTextContent('Cotizado, falta en el borrador');
    expect(candidateRole).toHaveTextContent('Material cotizado actual: Roble natural');
    expect(candidateRole).not.toHaveTextContent('Q2');
    expect(candidateRole).not.toHaveTextContent(MATERIAL_B_ID); // UUIDs nunca primarios

    const repair = within(modal).getByTestId(`repair-unit-${UNIT_ID}`);
    expect(repair).toBeVisible();
  });

  it('an authored-only unit is never offered repair', async () => {
    setupMock();
    renderPanel();

    const modal = await openReviewModal();
    // The authored-only unit is not a candidate: it does not appear at all.
    expect(within(modal).queryByTestId(`pending-unit-${AUTHORED_ONLY_UNIT_ID}`)).not.toBeInTheDocument();
    // Authored roles inside the candidate unit are context, never repairable.
    const authoredRole = within(modal).getByTestId(`pending-role-${UNIT_ID}-INTERIOR`);
    expect(authoredRole).toHaveTextContent('Elegido en el diseño');
    expect(authoredRole).toHaveTextContent('Melamina blanca');
    expect(within(authoredRole).queryByRole('button')).not.toBeInTheDocument();
  });

  it('a successful read with zero candidates renders no strip and no error', async () => {
    setupMock({ provenance: () => provenancePayload([], null) });
    renderPanel();

    // First settle the read, then assert the honest absence of every state.
    await waitFor(() => {
      expect(screen.queryByTestId('materials-provenance-loading')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('pending-materials-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('materials-provenance-error')).not.toBeInTheDocument();
  });

  it('a failed read is an explicit error, never "no pending materials"', async () => {
    let failing = true;
    setupMock({
      provenanceFail: () => failing,
      provenance: () => provenancePayload([]),
    });
    renderPanel();

    const error = await screen.findByTestId('materials-provenance-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent('No se pudo revisar los materiales del borrador');
    expect(screen.queryByTestId('pending-materials-strip')).not.toBeInTheDocument();

    // Retry recovers to the honest empty read.
    failing = false;
    fireEvent.click(screen.getByTestId('retry-materials-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('materials-provenance-error')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('pending-materials-strip')).not.toBeInTheDocument();
  });

  it('confirm sends the canonical command once with the exact concurrency token and key', async () => {
    const { calls } = setupMock();
    renderPanel();

    const modal = await openReviewModal();
    await userEvent.click(within(modal).getByTestId(`repair-unit-${UNIT_ID}`));

    const confirm = within(modal).getByTestId(`repair-confirm-${UNIT_ID}`);
    expect(confirm).toHaveTextContent('Se añadirá al borrador de Bajo 600');
    expect(confirm).toHaveTextContent('FRENTES');
    expect(confirm).toHaveTextContent('Roble natural');
    expect(confirm).toHaveTextContent('Las elecciones ya definidas no se modifican.');
    expect(modal).toHaveTextContent('no modifica las elecciones ya definidas ni las revisiones publicadas');
    expect(modal).toHaveTextContent('Publicar una nueva revisión es una acción aparte');

    await userEvent.click(within(modal).getByTestId(`confirm-repair-${UNIT_ID}`));

    const success = await within(modal).findByTestId(`repair-success-${UNIT_ID}`);
    expect(success).toHaveTextContent('Reparación aplicada: 1 elección añadida al borrador');

    const posts = calls.filter((c) => c.method === 'POST' && c.path.endsWith(':reconcile'));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      furniture_instance_id: UNIT_ID,
      expected_updated_at: WORKING_UPDATED_AT,
    });
    expect(posts[0]!.idempotencyKey).toMatch(/^web:/);
  });

  it('read-back: after success the candidate disappears from the refreshed projection', async () => {
    let repaired = false;
    setupMock({
      provenance: () =>
        repaired ? provenancePayload([{ ...AUTHORED_ONLY_ITEM }], '2026-09-14T10:05:00.654321Z') : provenancePayload([CANDIDATE_ITEM, AUTHORED_ONLY_ITEM]),
      reconcile: () => {
        repaired = true;
        return {
          status: 200,
          body: {
            design_id: DESIGN_ID,
            project_id: PROJECT_ID,
            furniture_instance_id: UNIT_ID,
            filled_choices: { FRENTES: MATERIAL_B_ID },
            preserved_choices: {},
            working_copy_updated_at: '2026-09-14T10:05:00.654321Z',
          },
        };
      },
    });
    renderPanel();

    const modal = await openReviewModal();
    await userEvent.click(within(modal).getByTestId(`repair-unit-${UNIT_ID}`));
    await userEvent.click(within(modal).getByTestId(`confirm-repair-${UNIT_ID}`));

    await waitFor(() => {
      expect(within(modal).queryByTestId(`pending-unit-${UNIT_ID}`)).not.toBeInTheDocument();
    });
    await within(modal).findByTestId('pending-materials-empty');
  });

  it('double click produces exactly one command (single intention)', async () => {
    const { calls } = setupMock({
      reconcile: () => new Promise(() => {}), // hangs: state stays submitting
    });
    renderPanel();

    const modal = await openReviewModal();
    await userEvent.click(within(modal).getByTestId(`repair-unit-${UNIT_ID}`));
    const confirmBtn = within(modal).getByTestId(`confirm-repair-${UNIT_ID}`);
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    const posts = calls.filter((c) => c.method === 'POST' && c.path.endsWith(':reconcile'));
    expect(posts).toHaveLength(1);
    expect(confirmBtn).toBeDisabled();
  });

  it('409 conflict: no success, no overwrite; reload restores review with fresh state', async () => {
    const { calls } = setupMock({
      reconcile: () => ({
        status: 409,
        body: { code: 'CONFLICT', message: 'El borrador de trabajo cambió; volvé a leer su estado antes de reconciliar', fieldErrors: {}, requestId: 'r', retryable: false, details: {} },
      }),
    });
    renderPanel();

    const modal = await openReviewModal();
    await userEvent.click(within(modal).getByTestId(`repair-unit-${UNIT_ID}`));
    await userEvent.click(within(modal).getByTestId(`confirm-repair-${UNIT_ID}`));

    const conflict = await within(modal).findByTestId(`repair-conflict-${UNIT_ID}`);
    expect(conflict).toHaveAttribute('role', 'alert');
    expect(conflict).toHaveTextContent('El diseño cambió mientras revisabas los materiales');
    expect(within(modal).queryByTestId(`repair-success-${UNIT_ID}`)).not.toBeInTheDocument();

    // No retry storm: exactly the one rejected command so far.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);

    await userEvent.click(within(modal).getByTestId('reload-materials-btn'));
    await waitFor(() => {
      expect(within(modal).queryByTestId(`repair-conflict-${UNIT_ID}`)).not.toBeInTheDocument();
    });
    // Fresh review state: the repair action is offered again over re-read data.
    await within(modal).findByTestId(`repair-unit-${UNIT_ID}`);
  });

  // #658 review — context receipt regressions. Each intention captures the
  // receipt (session scope via query keys + projectId + designId); success,
  // error and conflict responses from a previous context are discarded whole.

  function rerenderWithContext(
    rerender: (node: React.ReactElement) => void,
    context: { projectId?: string; designId?: string; scopeKey?: readonly unknown[] },
  ) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = projectDesignsQueryKeys(context.scopeKey ?? ['test-scope-B'], context.projectId ?? PROJECT_ID);
    rerender(
      <QueryClientProvider client={queryClient}>
        <DesignWorkingMaterialsPanel
          api={new GraneteApiClient(API)}
          token="test-jwt"
          projectId={context.projectId ?? PROJECT_ID}
          designId={context.designId ?? DESIGN_ID}
          canMutate
          queryKeys={keys}
          catalogMaterials={CATALOG_MATERIALS}
        />
      </QueryClientProvider>,
    );
  }

  async function assertForeignResponseDiscarded() {
    // No variant of the old context's outcome ever renders…
    await waitFor(() => {
      expect(screen.queryByTestId(`repair-success-${UNIT_ID}`)).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId(`repair-conflict-${UNIT_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`repair-error-${UNIT_ID}`)).not.toBeInTheDocument();
    // …and the old context's modal is gone.
    expect(screen.queryByTestId('pending-materials-modal')).not.toBeInTheDocument();
  }

  it('a late response from design A never mutates the state of design B', async () => {
    let resolveReconcile: ((value: { status: number; body: unknown }) => void) | null = null;
    const { calls } = setupMock({
      reconcile: () => new Promise((resolve) => { resolveReconcile = resolve; }),
    });
    const { rerender } = renderPanel();

    await openReviewModal();
    await userEvent.click(screen.getByTestId(`repair-unit-${UNIT_ID}`));
    await userEvent.click(screen.getByTestId(`confirm-repair-${UNIT_ID}`));

    // Switch to Design B while A's command is in flight.
    rerenderWithContext(rerender, { designId: '22222222-0000-4000-8000-000000000002' });

    // A's success response arrives late: discarded whole.
    expect(resolveReconcile).toBeTruthy();
    resolveReconcile!({
      status: 200,
      body: {
        design_id: DESIGN_ID,
        project_id: PROJECT_ID,
        furniture_instance_id: UNIT_ID,
        filled_choices: { FRENTES: MATERIAL_B_ID },
        preserved_choices: {},
        working_copy_updated_at: '2026-09-14T10:05:00.654321Z',
      },
    });

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });
    await assertForeignResponseDiscarded();
  });

  it('late response from project A never mutates the state of project B', async () => {
    let resolveReconcile: ((value: { status: number; body: unknown }) => void) | null = null;
    setupMock({
      reconcile: () => new Promise((resolve) => { resolveReconcile = resolve; }),
    });
    const { rerender } = renderPanel();

    await openReviewModal();
    await userEvent.click(screen.getByTestId(`repair-unit-${UNIT_ID}`));
    await userEvent.click(screen.getByTestId(`confirm-repair-${UNIT_ID}`));

    // Switch to Project B (same session scope, same design id) mid-flight.
    rerenderWithContext(rerender, { projectId: '11111111-0000-4000-8000-00000000009b' });

    expect(resolveReconcile).toBeTruthy();
    resolveReconcile!({
      status: 200,
      body: {
        design_id: DESIGN_ID,
        project_id: PROJECT_ID,
        furniture_instance_id: UNIT_ID,
        filled_choices: { FRENTES: MATERIAL_B_ID },
        preserved_choices: {},
        working_copy_updated_at: '2026-09-14T10:05:00.654321Z',
      },
    });

    await assertForeignResponseDiscarded();

    // B's own surface is untouched and fully operable: fresh review state
    // (idle — not A's submitting), no leftover intention from A.
    await screen.findByTestId('pending-materials-strip');
    await userEvent.click(screen.getByTestId('review-pending-materials-btn'));
    await waitFor(() => {
      expect(screen.getByTestId(`repair-unit-${UNIT_ID}`)).toBeVisible();
    });
  });

  it('late response from a previous session/org scope is discarded', async () => {
    let resolveReconcile: ((value: { status: number; body: unknown }) => void) | null = null;
    setupMock({
      reconcile: () => new Promise((resolve) => { resolveReconcile = resolve; }),
    });
    const { rerender } = renderPanel();

    await openReviewModal();
    await userEvent.click(screen.getByTestId(`repair-unit-${UNIT_ID}`));
    await userEvent.click(screen.getByTestId(`confirm-repair-${UNIT_ID}`));

    // Same project and design, but a different session/tenant scope: the
    // receipt must differ because the query-key scope identity changed.
    rerenderWithContext(rerender, { scopeKey: ['session', 'other-generation', 'other-user'] });

    expect(resolveReconcile).toBeTruthy();
    resolveReconcile!({
      status: 200,
      body: {
        design_id: DESIGN_ID,
        project_id: PROJECT_ID,
        furniture_instance_id: UNIT_ID,
        filled_choices: { FRENTES: MATERIAL_B_ID },
        preserved_choices: {},
        working_copy_updated_at: '2026-09-14T10:05:00.654321Z',
      },
    });

    await assertForeignResponseDiscarded();
  });

  it('a late 409 conflict from a previous context never reaches the new surface', async () => {
    let rejectReconcile: ((reason: unknown) => void) | null = null;
    setupMock({
      reconcile: () =>
        new Promise((_, reject) => { rejectReconcile = reject; }),
    });
    const { rerender } = renderPanel();

    await openReviewModal();
    await userEvent.click(screen.getByTestId(`repair-unit-${UNIT_ID}`));
    await userEvent.click(screen.getByTestId(`confirm-repair-${UNIT_ID}`));

    rerenderWithContext(rerender, { designId: '22222222-0000-4000-8000-000000000003' });

    expect(rejectReconcile).toBeTruthy();
    rejectReconcile!(
      new GraneteApiError(409, {
        code: 'CONFLICT',
        message: 'El borrador de trabajo cambió',
        fieldErrors: {},
        requestId: 'r',
        retryable: false,
        details: {},
      }),
    );

    await assertForeignResponseDiscarded();
  });

  it('read-only: candidates are visible but no mutation is offered', async () => {
    setupMock();
    renderPanel({ canMutate: false });

    const modal = await openReviewModal();
    const unit = within(modal).getByTestId(`pending-unit-${UNIT_ID}`);
    expect(within(unit).queryByTestId(`repair-unit-${UNIT_ID}`)).not.toBeInTheDocument();
    expect(within(unit).getByText('Necesitás permisos de edición para reparar este mueble.')).toBeVisible();
    // The backend stays the authority: no command was ever issued from this surface.
  });

  it('retry after failure reuses the same idempotency key (same intention)', async () => {
    let fail = true;
    const { calls } = setupMock({
      reconcile: () =>
        fail
          ? { status: 500, body: { code: 'INTERNAL', message: 'boom', fieldErrors: {}, requestId: 'r', retryable: true, details: {} } }
          : {
              status: 200,
              body: {
                design_id: DESIGN_ID,
                project_id: PROJECT_ID,
                furniture_instance_id: UNIT_ID,
                filled_choices: {},
                preserved_choices: {},
                working_copy_updated_at: WORKING_UPDATED_AT,
              },
            },
    });
    renderPanel();

    const modal = await openReviewModal();
    await userEvent.click(within(modal).getByTestId(`repair-unit-${UNIT_ID}`));
    await userEvent.click(within(modal).getByTestId(`confirm-repair-${UNIT_ID}`));

    const error = await within(modal).findByTestId(`repair-error-${UNIT_ID}`);
    expect(error).toHaveAttribute('role', 'alert');

    fail = false;
    await userEvent.click(within(modal).getByTestId(`retry-repair-${UNIT_ID}`));

    await within(modal).findByTestId(`repair-success-${UNIT_ID}`);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]!.idempotencyKey).toBe(posts[1]!.idempotencyKey);
  });
});
