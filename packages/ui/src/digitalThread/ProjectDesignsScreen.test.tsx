// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  Design,
  DesignArtifactGrant,
  DesignRevision,
  DesignWorkingCopy,
  ProductionRelease,
} from '@granete/storage';
import {
  ProjectDesignsScreen,
  projectDesignsQueryKeys,
  type ProjectDesignsContextState,
} from './ProjectDesignsScreen';

const API = 'http://api.test';
const PROJECT_ID = '11111111-0000-4000-8000-000000000001';
const DESIGN_1_ID = '22222222-0000-4000-8000-000000000001';
const DESIGN_2_ID = '22222222-0000-4000-8000-000000000002';
const REV_1_ID = '33333333-0000-4000-8000-000000000001';
const REV_2_ID = '33333333-0000-4000-8000-000000000002';
const REV_3_ID = '33333333-0000-4000-8000-000000000003';
const INSTANCE_1_ID = '77777777-0000-4000-8000-000000000001';

const mockDesigns: Design[] = [
  {
    id: DESIGN_1_ID,
    project_id: PROJECT_ID,
    name: 'Cocina Principal',
    status: 'active',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-03T15:00:00Z',
  },
  {
    id: DESIGN_2_ID,
    project_id: PROJECT_ID,
    name: 'Isla & Comedor',
    status: 'active',
    created_at: '2026-09-02T11:00:00Z',
    updated_at: '2026-09-02T11:00:00Z',
  },
];

const mockWorkingCopy: DesignWorkingCopy = {
  design_id: DESIGN_1_ID,
  project_id: PROJECT_ID,
  base_revision_id: REV_3_ID,
  source_type: 'sketchup',
  updated_at: '2026-09-04T09:00:00Z',
  items: [
    {
      id: '44444444-0000-4000-8000-000000000001',
      design_id: DESIGN_1_ID,
      furniture_instance_id: INSTANCE_1_ID,
      parameters: { width: 950 },
      material_choices: {},
      created_at: '2026-09-04T09:00:00Z',
      updated_at: '2026-09-04T09:00:00Z',
    },
  ],
};

const mockRevision1: DesignRevision = {
  id: REV_1_ID,
  design_id: DESIGN_1_ID,
  revision_number: 1,
  parent_revision_id: null,
  source_type: 'sketchup',
  status: 'superseded',
  created_by: 'Arquitecto Juan',
  created_at: '2026-09-01T10:00:00Z',
  items: [
    {
      id: '44444444-0000-4000-8000-000000000011',
      design_revision_id: REV_1_ID,
      furniture_instance_id: INSTANCE_1_ID,
      furniture_definition_id: '88888888-0000-4000-8000-000000000001',
      parameters: { width: 600, height: 720, depth: 560 },
      material_choices: { estructura: 'Blanco 18mm' },
      room_id: 'cocina',
      created_at: '2026-09-01T10:00:00Z',
    },
  ],
  artifacts: [
    {
      id: '55555555-0000-4000-8000-000000000001',
      design_revision_id: REV_1_ID,
      kind: 'manifest',
      content_type: 'application/json',
      size_bytes: 1240,
      sha256: 'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      created_at: '2026-09-01T10:00:00Z',
    },
  ],
};

const mockRevision2: DesignRevision = {
  id: REV_2_ID,
  design_id: DESIGN_1_ID,
  revision_number: 2,
  parent_revision_id: REV_1_ID,
  source_type: 'sketchup',
  status: 'superseded',
  created_by: 'Arquitecto Juan',
  created_at: '2026-09-02T12:00:00Z',
  items: [
    {
      id: '44444444-0000-4000-8000-000000000021',
      design_revision_id: REV_2_ID,
      furniture_instance_id: INSTANCE_1_ID,
      furniture_definition_id: '88888888-0000-4000-8000-000000000002',
      parameters: { width: 700, height: 720, depth: 560 },
      material_choices: { estructura: 'Gris Grafito 18mm' },
      room_id: 'cocina',
      created_at: '2026-09-02T12:00:00Z',
    },
  ],
  artifacts: [],
};

const mockRevision3: DesignRevision = {
  id: REV_3_ID,
  design_id: DESIGN_1_ID,
  revision_number: 3,
  parent_revision_id: REV_2_ID,
  source_type: 'sketchup',
  status: 'approved',
  approved_by: '66666666-0000-4000-8000-000000000001',
  approved_at: '2026-09-03T15:00:00Z',
  created_by: 'Diseñadora Sofía',
  created_at: '2026-09-03T14:00:00Z',
  items: [
    {
      id: '44444444-0000-4000-8000-000000000031',
      design_revision_id: REV_3_ID,
      furniture_instance_id: INSTANCE_1_ID,
      furniture_definition_id: '88888888-0000-4000-8000-000000000003',
      parameters: { width: 900, height: 720, depth: 560 },
      material_choices: { estructura: 'Roble Nebraska 18mm' },
      room_id: 'cocina',
      created_at: '2026-09-03T14:00:00Z',
    },
  ],
  artifacts: [
    {
      id: '55555555-0000-4000-8000-000000000031',
      design_revision_id: REV_3_ID,
      kind: 'model',
      content_type: 'application/octet-stream',
      size_bytes: 4520000,
      sha256: 'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      created_at: '2026-09-03T14:00:00Z',
    },
    {
      id: '55555555-0000-4000-8000-000000000032',
      design_revision_id: REV_3_ID,
      kind: 'manifest',
      content_type: 'application/json',
      size_bytes: 3500,
      sha256: 'sha256-ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      created_at: '2026-09-03T14:00:00Z',
    },
    {
      id: '55555555-0000-4000-8000-000000000033',
      design_revision_id: REV_3_ID,
      kind: 'preview',
      content_type: 'image/png',
      size_bytes: 185000,
      sha256: 'sha256-4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce',
      created_at: '2026-09-03T14:00:00Z',
    },
  ],
};

const mockReleases: ProductionRelease[] = [
  {
    id: '99999999-0000-4000-8000-000000000001',
    project_id: PROJECT_ID,
    release_number: 1,
    design_revision_id: REV_3_ID,
    design_revision_number: 3,
    quote_revision_id: null,
    manufacturing_fingerprint: 'sha256-4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce',
    status: 'active',
    released_by: '66666666-0000-4000-8000-000000000001',
    released_at: '2026-09-03T16:00:00Z',
    staleness: {
      manufacturing_stale: false,
      current_design_revision_id: REV_3_ID,
      current_design_revision_number: 3,
    },
  },
];

interface FetchMockOptions {
  designs?: Design[];
  revisionsByDesign?: Record<string, DesignRevision[]>;
  revisionDetailOverride?: Record<string, Record<string, DesignRevision>>; // designId → revisionId → revision
  revisionDetailFail?: boolean | ((designId: string, revId: string) => boolean);
  revisionDetailPending?: boolean;
  workingCopyByDesign?: Record<string, DesignWorkingCopy | null>;
  releases?: ProductionRelease[];
  artifactsFail?: boolean;
}

function setupFetchMock(options: FetchMockOptions = {}) {
  const designs = options.designs ?? mockDesigns;
  const revisionsByDesign = options.revisionsByDesign ?? {
    [DESIGN_1_ID]: [mockRevision1, mockRevision2, mockRevision3],
    [DESIGN_2_ID]: [],
  };
  // Build a detail map from the list map (GET /designs/:id/revisions/:revId)
  const revisionDetailByDesign: Record<string, Record<string, DesignRevision>> = {};
  for (const [dId, revs] of Object.entries(revisionsByDesign)) {
    revisionDetailByDesign[dId] = {};
    for (const rev of revs) {
      revisionDetailByDesign[dId]![rev.id] = rev;
    }
  }
  // Merge any explicit overrides (useful when tests need specific items/artifacts per revision)
  if (options.revisionDetailOverride) {
    for (const [dId, revMap] of Object.entries(options.revisionDetailOverride)) {
      revisionDetailByDesign[dId] = { ...(revisionDetailByDesign[dId] ?? {}), ...revMap };
    }
  }
  const workingCopies = options.workingCopyByDesign ?? {
    [DESIGN_1_ID]: mockWorkingCopy,
    [DESIGN_2_ID]: null,
  };
  const releases = options.releases ?? mockReleases;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    // 1. List designs: GET /projects/:id/designs
    if (path === `/projects/${PROJECT_ID}/designs` && method === 'GET') {
      return json(designs);
    }

    // 2. Create design: POST /projects/:id/designs
    if (path === `/projects/${PROJECT_ID}/designs` && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const created: Design = {
        id: '99999999-0000-4000-8000-000000000099',
        project_id: PROJECT_ID,
        name: body.name ?? 'Nuevo diseño',
        status: 'active',
        created_at: '2026-09-05T12:00:00Z',
        updated_at: '2026-09-05T12:00:00Z',
      };
      return json(created, 201);
    }

    // 3. List revisions: GET /designs/:id/revisions
    for (const dId of Object.keys(revisionsByDesign)) {
      if (path === `/designs/${dId}/revisions` && method === 'GET') {
        return json(revisionsByDesign[dId] ?? []);
      }
    }

    // 3b. Revision detail: GET /designs/:id/revisions/:revId (includes items + artifacts)
    const revDetailRegex = /^\/designs\/([^/]+)\/revisions\/([^/]+)$/;
    const revDetailMatch = path.match(revDetailRegex);
    if (revDetailMatch && method === 'GET') {
      const [, dId, revId] = revDetailMatch;
      if (options.revisionDetailPending) {
        return new Promise(() => {}); // hangs/pending
      }
      if (
        options.revisionDetailFail === true ||
        (typeof options.revisionDetailFail === 'function' && options.revisionDetailFail(dId!, revId!))
      ) {
        return new Response(JSON.stringify({ code: 'INTERNAL', message: 'revision detail failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const rev = revisionDetailByDesign[dId!]?.[revId!];
      if (!rev) {
        return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'revision not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return json(rev);
    }

    // 4. Working copy: GET /designs/:id/working-copy
    for (const dId of Object.keys(workingCopies)) {
      if (path === `/designs/${dId}/working-copy` && method === 'GET') {
        const wc = workingCopies[dId];
        if (!wc) {
          return new Response('Not Found', { status: 404 });
        }
        return json(wc);
      }
    }

    // 5. Production releases: GET /projects/:id/production-releases
    if (path === `/projects/${PROJECT_ID}/production-releases` && method === 'GET') {
      return json(releases);
    }

    // 6. Artifact authorization: POST /designs/:id/revisions/:revId/artifacts/:kind:authorize
    const authRegex = /^\/designs\/([^/]+)\/revisions\/([^/]+)\/artifacts\/(model|manifest|preview):authorize$/;
    const authMatch = path.match(authRegex);
    if (authMatch && method === 'POST') {
      const [, designId, revId, kind] = authMatch;
      const grant: DesignArtifactGrant = {
        kind: kind as any,
        url: `/api/design-artifacts/storage/${designId}/${revId}/${kind}.bin?grant=signed-token-xyz`,
        expires_at: '2026-09-05T20:00:00Z',
      };
      return json(grant);
    }

    // 7. List artifacts: GET /designs/:id/revisions/:revId/artifacts
    const artListRegex = /^\/designs\/([^/]+)\/revisions\/([^/]+)\/artifacts$/;
    if (artListRegex.test(path) && method === 'GET') {
      if (options.artifactsFail) {
        return new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Failed to list artifacts' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return json([]);
    }

    return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderScreen(props: {
  initialContext?: ProjectDesignsContextState | null;
  onContextChange?: (ctx: ProjectDesignsContextState) => void;
  onOpenFurnitureMatrix?: (ctx: { designId: string | null; revisionId: string | null }) => void;
  onBack?: () => void;
  canMutate?: boolean;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const keys = projectDesignsQueryKeys(['test-scope'], PROJECT_ID);

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectDesignsScreen
        baseUrl={API}
        token="test-jwt-token"
        projectId={PROJECT_ID}
        queryKeys={keys}
        initialContext={props.initialContext}
        onContextChange={props.onContextChange}
        onOpenFurnitureMatrix={props.onOpenFurnitureMatrix}
        onBack={props.onBack}
        canMutate={props.canMutate}
      />
    </QueryClientProvider>,
  );
}

describe('ProjectDesignsScreen (#501 / WEB-DT-2)', () => {
  let windowOpenSpy: any;

  beforeEach(() => {
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders design alternatives and switches between them', async () => {
    setupFetchMock();
    const handleContextChange = vi.fn();

    renderScreen({ onContextChange: handleContextChange });

    // Both designs appear in the alternative switcher
    expect(await screen.findByText('Cocina Principal')).toBeInTheDocument();
    expect(screen.getByText('Isla & Comedor')).toBeInTheDocument();

    // Default selection is Cocina Principal
    expect(screen.getByRole('tab', { name: /Cocina Principal/i })).toHaveClass('tabs__tab--active');

    // Click on second design
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Isla & Comedor/i }));

    expect(handleContextChange).toHaveBeenCalledWith({
      designId: DESIGN_2_ID,
      revisionId: null,
    });
  });

  it('displays immutable revision lineage track (R1 → R2 → R3) with status and author', async () => {
    setupFetchMock();
    renderScreen();

    // Revisions appear in lineage track
    expect(await screen.findByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
    expect(screen.getByText('R3')).toBeInTheDocument();

    // Metadata is rendered honestly
    expect(screen.getAllByText('Diseñadora Sofía').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Arquitecto Juan').length).toBeGreaterThanOrEqual(1);

    // Badges reflect exact statuses
    expect(screen.getAllByText('Aprobada').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Reemplazada').length).toBeGreaterThanOrEqual(1);
  });

  it('negative proof: selecting historical revision R1 stays pinned strictly to R1 data and never silently defaults to latest', async () => {
    setupFetchMock();
    const handleContextChange = vi.fn();

    // Explicitly pin to R1
    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID },
      onContextChange: handleContextChange,
    });

    // Wait for screen to load and verify title shows R1
    expect(await screen.findByRole('heading', { level: 2, name: /Revisión R1/i })).toBeInTheDocument();

    // Historical status badge must be displayed
    expect(screen.getByText(/Reemplazada \(Histórica\)/i)).toBeInTheDocument();

    // Snapshot items MUST be R1 items (600mm, Blanco 18mm), NOT R3 items (900mm, Roble Nebraska)
    expect(screen.getByText(/Blanco 18mm/i)).toBeInTheDocument();
    expect(screen.getByText(/width: 600/i)).toBeInTheDocument();
    expect(screen.queryByText(/Roble Nebraska 18mm/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/width: 900/i)).not.toBeInTheDocument();

    // Artifacts table must show R1 artifacts (only Manifest), NOT 3D model or Preview
    const table = screen.getByTestId('artifacts-table');
    expect(within(table).getByText('Manifest (.json)')).toBeInTheDocument();
    expect(within(table).queryByText('Modelo 3D (.skp)')).not.toBeInTheDocument();
    expect(within(table).queryByText('Vista previa (.png)')).not.toBeInTheDocument();
  });

  it('authorizes and displays 3D preview image via signed grant on active revision', async () => {
    const fetchMock = setupFetchMock();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
    });

    // Expect preview image to be fetched and rendered
    const previewImg = await screen.findByAltText(/Vista previa 3D R3/i);
    expect(previewImg).toBeInTheDocument();
    expect(previewImg.getAttribute('src')).toContain('/api/design-artifacts/storage/');
    expect(previewImg.getAttribute('src')).toContain('grant=signed-token-xyz');

    // Verify authorize was called for preview
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/designs/${DESIGN_1_ID}/revisions/${REV_3_ID}/artifacts/preview:authorize`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('authorizes artifact download on button click without leaking raw auth token in query', async () => {
    setupFetchMock();
    const user = userEvent.setup();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
    });

    expect(await screen.findByRole('heading', { level: 2, name: /Revisión R3/i })).toBeInTheDocument();

    // Find the download button for 3D model
    const downloadButton = screen.getByTestId('download-artifact-model');
    expect(downloadButton).toBeInTheDocument();

    // Click download on first artifact (Model 3D)
    await user.click(downloadButton);

    await waitFor(() => {
      expect(windowOpenSpy).toHaveBeenCalledTimes(1);
    });

    const openedUrl = windowOpenSpy.mock.calls[0]![0] as string;
    expect(openedUrl).toContain('grant=signed-token-xyz');
    expect(openedUrl).not.toContain('test-jwt-token'); // Negative proof: raw token never passed in URL
  });

  it('negative proof: #499 Web↔SketchUp handoff is omitted and deferred', async () => {
    setupFetchMock();
    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
    });

    await screen.findByText('Cocina Principal');

    // Negative proof: No "Abrir en SketchUp" button or custom URI scheme
    expect(screen.queryByText(/abrir en sketchup/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sketchup:\/\//i)).not.toBeInTheDocument();
    expect(screen.queryByText(/código de emparejamiento/i)).not.toBeInTheDocument();
  });

  it('renders honest empty state when project has 0 designs', async () => {
    setupFetchMock({ designs: [] });
    renderScreen();

    expect(await screen.findByText('No hay diseños en esta obra')).toBeInTheDocument();
  });

  it('renders honest empty state when design has 0 published revisions', async () => {
    setupFetchMock({
      designs: [mockDesigns[0]!],
      revisionsByDesign: { [DESIGN_1_ID]: [] },
    });
    renderScreen();

    expect(await screen.findByTestId('no-revisions-notice')).toBeInTheDocument();
    expect(
      screen.getByText(/Este diseño no cuenta con revisiones inmutables publicadas todavía/i),
    ).toBeInTheDocument();
  });

  it('navigates to furniture matrix when clicking Ver matriz de muebles', async () => {
    setupFetchMock();
    const handleOpenMatrix = vi.fn();
    const user = userEvent.setup();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
      onOpenFurnitureMatrix: handleOpenMatrix,
    });

    const matrixButton = await screen.findByRole('button', { name: /ver matriz de muebles/i });
    await user.click(matrixButton);

    expect(handleOpenMatrix).toHaveBeenCalledWith({
      designId: DESIGN_1_ID,
      revisionId: REV_3_ID,
    });
  });

  it('negative proof: invalid explicit design does not silently retarget or rewrite context', async () => {
    setupFetchMock();
    const handleContextChange = vi.fn();
    const user = userEvent.setup();

    renderScreen({
      initialContext: { designId: '00000000-0000-4000-8000-000000000999', revisionId: null },
      onContextChange: handleContextChange,
    });

    // Honest notice must be rendered
    expect(await screen.findByTestId('invalid-design-notice')).toBeInTheDocument();
    expect(
      screen.getByText('El diseño seleccionado ya no está disponible en este proyecto.'),
    ).toBeInTheDocument();

    // Neither Design 1 nor Design 2 is automatically active
    expect(screen.queryByTestId('working-copy-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('revision-inspector')).not.toBeInTheDocument();

    // Context must NOT be silently rewritten on mount
    expect(handleContextChange).not.toHaveBeenCalled();

    // Explicit recovery button enables explicit user choice
    const viewAvailableBtn = screen.getByTestId('view-available-designs-btn');
    await user.click(viewAvailableBtn);
    expect(handleContextChange).toHaveBeenCalledWith({ designId: DESIGN_1_ID, revisionId: null });
  });

  it('negative proof: cross-design revision fails closed and does not silently substitute', async () => {
    setupFetchMock();
    const handleContextChange = vi.fn();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: '33333333-0000-4000-8000-000000000099' },
      onContextChange: handleContextChange,
    });

    // Design 1 remains selected
    expect(await screen.findByText('Cocina Principal')).toBeInTheDocument();

    // Honest cross-design notice rendered
    expect(await screen.findByTestId('invalid-revision-notice')).toBeInTheDocument();
    expect(
      screen.getByText('La revisión seleccionada no pertenece a este diseño o ya no está disponible.'),
    ).toBeInTheDocument();

    // Neither R1 nor R3 is silently substituted into the inspector
    expect(screen.queryByTestId('revision-inspector')).not.toBeInTheDocument();
    expect(handleContextChange).not.toHaveBeenCalled();
  });

  it('handles missing working copy (404) gracefully without page error', async () => {
    setupFetchMock({
      workingCopyByDesign: {
        [DESIGN_1_ID]: null, // triggers 404 in fetchMock
      },
    });

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID },
    });

    // Screen loads normally without error
    expect(await screen.findByText('Cocina Principal')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: /Revisión R1/i })).toBeInTheDocument();
    // Working copy banner is omitted honestly
    expect(screen.queryByTestId('working-copy-banner')).not.toBeInTheDocument();
  });

  it('displays error notice when artifact list query fails', async () => {
    setupFetchMock({
      revisionsByDesign: {
        [DESIGN_1_ID]: [{ ...mockRevision1, artifacts: [] }],
      },
      artifactsFail: true,
    });

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID },
    });

    expect(await screen.findByTestId('artifacts-error-hint')).toBeInTheDocument();
    expect(
      screen.getByText('No se pudieron cargar los artefactos de la revisión.'),
    ).toBeInTheDocument();
  });

  it('shows loading indicator and prevents premature inspector render while revision detail is loading', async () => {
    setupFetchMock({
      revisionDetailPending: true,
    });

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID },
    });

    expect(await screen.findByTestId('revision-node-R1')).toBeInTheDocument();
    expect(await screen.findByTestId('revision-detail-loading')).toBeInTheDocument();
    expect(screen.getByText(/Cargando snapshot exacto de R1/i)).toBeInTheDocument();
    expect(screen.queryByTestId('revision-inspector')).not.toBeInTheDocument();
  });

  it('shows error notice and retry button when revision detail fails, never falling back to header', async () => {
    let shouldFail = true;
    setupFetchMock({
      revisionDetailFail: () => shouldFail,
    });
    const user = userEvent.setup();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID },
    });

    expect(await screen.findByTestId('revision-node-R1')).toBeInTheDocument();
    expect(await screen.findByTestId('revision-detail-error')).toBeInTheDocument();
    expect(screen.getByText(/No se pudo cargar el snapshot exacto de R1/i)).toBeInTheDocument();
    expect(screen.queryByTestId('revision-inspector')).not.toBeInTheDocument();

    shouldFail = false;
    const retryBtn = screen.getByTestId('retry-revision-detail-btn');
    await user.click(retryBtn);

    expect(await screen.findByTestId('revision-inspector')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Revisión R1/i })).toBeInTheDocument();
  });

  it('renders orphan lineage connector when a revision has an unknown parent revision id', async () => {
    const orphanRevision: DesignRevision = {
      id: '33333333-0000-4000-8000-000000000088',
      design_id: DESIGN_1_ID,
      revision_number: 2,
      parent_revision_id: '99999999-9999-4999-8999-999999999999',
      source_type: 'sketchup',
      status: 'published',
      created_by: 'Arquitecto Juan',
      created_at: '2026-09-02T12:00:00Z',
      items: [],
      artifacts: [],
    };

    setupFetchMock({
      revisionsByDesign: {
        [DESIGN_1_ID]: [mockRevision1, orphanRevision],
      },
    });

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: null },
    });

    expect(await screen.findByTestId('revision-node-R1')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R2')).toBeInTheDocument();

    const orphanConnector = document.querySelector('.pd-lineage-connector--orphan');
    expect(orphanConnector).toBeInTheDocument();
    expect(orphanConnector).toHaveAttribute('title', 'Parent no disponible');
  });

  it('renders normal authoritative connectors for linear lineage chain R1->R2->R3', async () => {
    // Linear mock: R1 (parent: null), R2 (parent: R1), R3 (parent: R2)
    setupFetchMock();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: null },
    });

    expect(await screen.findByTestId('revision-node-R1')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R2')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R3')).toBeInTheDocument();

    const connectors = document.querySelectorAll('.pd-lineage-connector');
    expect(connectors).toHaveLength(2);
    expect(connectors[0]).not.toHaveClass('pd-lineage-connector--orphan');
    expect(connectors[1]).not.toHaveClass('pd-lineage-connector--orphan');
    expect(document.querySelector('.pd-lineage-connector--orphan')).toBeNull();
  });

  it('renders non-authoritative connector when revision parent branches or skips chronological predecessor', async () => {
    // Branch mock: R1 (parent: null), R2 (parent: R1), R3 (parent: R1 instead of R2)
    const branchedR3: DesignRevision = {
      ...mockRevision3,
      parent_revision_id: REV_1_ID,
    };

    setupFetchMock({
      revisionsByDesign: {
        [DESIGN_1_ID]: [mockRevision1, mockRevision2, branchedR3],
      },
    });

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: null },
    });

    expect(await screen.findByTestId('revision-node-R1')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R2')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R3')).toBeInTheDocument();

    const connectors = document.querySelectorAll('.pd-lineage-connector');
    expect(connectors).toHaveLength(2);

    // R1 -> R2 connector is authoritative (R2 parent is R1)
    expect(connectors[0]).not.toHaveClass('pd-lineage-connector--orphan');

    // R2 -> R3 connector is NOT authoritative (R3 parent is R1, not R2)
    expect(connectors[1]).toHaveClass('pd-lineage-connector--orphan');
    expect(connectors[1]).toHaveAttribute('title', 'Parent no disponible');
  });
});

