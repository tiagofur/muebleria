// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  Design,
  DesignArtifactGrant,
  DesignRevision,
  DesignRevisionArtifact,
  DesignWorkingCopy,
  ProductionRelease,
} from '@granete/storage';
import {
  ProjectDesignsScreen,
  projectDesignsQueryKeys,
  type ProjectDesignsContextState,
} from './ProjectDesignsScreen';

const API = 'http://api.test/api';
const PROJECT_ID = '11111111-0000-4000-8000-000000000001';
const DESIGN_1_ID = '22222222-0000-4000-8000-000000000001';
const DESIGN_2_ID = '22222222-0000-4000-8000-000000000002';
const REV_1_ID = '33333333-0000-4000-8000-000000000001';
const REV_2_ID = '33333333-0000-4000-8000-000000000002';
const REV_3_ID = '33333333-0000-4000-8000-000000000003';
const INSTANCE_1_ID = '77777777-0000-4000-8000-000000000001';

function presentation(name: string, code: string, width: number, material: string) {
  return {
    schema_version: 1 as const,
    unit: { label: `${name} 1 de 1`, index: 1, total: 1 },
    definition: { name, code },
    parameters: [{ key: 'width', label: 'Ancho', type: 'number', value: width, unit: 'mm', state: 'available' as const }],
    materials: [{ role: 'estructura', role_label: 'Estructura', name: material, code: 'MAT-01', effective_thickness_mm: 18, provenance: 'authored' as const }],
    room: { label: 'Cocina', state: 'available' as const },
  };
}

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
  created_by: '66666666-0000-4000-8000-000000000001',
      created_by_display_name: 'Arquitecto Juan',
  created_at: '2026-09-01T10:00:00Z',
  items: [
    {
      id: '44444444-0000-4000-8000-000000000011',
      design_revision_id: REV_1_ID,
      furniture_instance_id: INSTANCE_1_ID,
      furniture_definition_id: '88888888-0000-4000-8000-000000000001',
      parameters: { width: 600, height: 720, depth: 560 },
      material_choices: { estructura: 'Blanco 18mm' },
      descriptor_state: 'available',
      presentation_snapshot: presentation('Gabinete bajo', 'MOD-GAB-01', 600, 'Blanco 18mm'),
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
      health: { status: 'available', checked_at: '2026-09-01T10:00:00Z' },
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
  created_by: '66666666-0000-4000-8000-000000000001',
  created_by_display_name: 'Arquitecto Juan',
  created_at: '2026-09-02T12:00:00Z',
  items: [
    {
      id: '44444444-0000-4000-8000-000000000021',
      design_revision_id: REV_2_ID,
      furniture_instance_id: INSTANCE_1_ID,
      furniture_definition_id: '88888888-0000-4000-8000-000000000002',
      parameters: { width: 700, height: 720, depth: 560 },
      material_choices: { estructura: 'Gris Grafito 18mm' },
      descriptor_state: 'available',
      presentation_snapshot: presentation('Gabinete bajo', 'MOD-GAB-02', 700, 'Gris Grafito 18mm'),
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
  created_by: '66666666-0000-4000-8000-000000000002',
  created_by_display_name: 'Diseñadora Sofía',
  approved_by_display_name: 'Gerente Ana',
  created_at: '2026-09-03T14:00:00Z',
  items: [
    {
      id: '44444444-0000-4000-8000-000000000031',
      design_revision_id: REV_3_ID,
      furniture_instance_id: INSTANCE_1_ID,
      furniture_definition_id: '88888888-0000-4000-8000-000000000003',
      parameters: { width: 900, height: 720, depth: 560 },
      material_choices: { estructura: 'Roble Nebraska 18mm' },
      descriptor_state: 'available',
      presentation_snapshot: presentation('Gabinete bajo', 'MOD-GAB-03', 900, 'Roble Nebraska 18mm'),
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
      health: { status: 'available', checked_at: '2026-09-03T14:00:00Z' },
    },
    {
      id: '55555555-0000-4000-8000-000000000032',
      design_revision_id: REV_3_ID,
      kind: 'manifest',
      content_type: 'application/json',
      size_bytes: 3500,
      sha256: 'sha256-ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      created_at: '2026-09-03T14:00:00Z',
      health: { status: 'available', checked_at: '2026-09-03T14:00:00Z' },
    },
    {
      id: '55555555-0000-4000-8000-000000000033',
      design_revision_id: REV_3_ID,
      kind: 'preview',
      content_type: 'image/png',
      size_bytes: 185000,
      sha256: 'sha256-4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce',
      created_at: '2026-09-03T14:00:00Z',
      health: { status: 'available', checked_at: '2026-09-03T14:00:00Z' },
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
  revisionsFail?: boolean | (() => boolean); // #641: list-level request failure
  revisionDetailOverride?: Record<string, Record<string, DesignRevision>>; // designId → revisionId → revision
  revisionDetailFail?: boolean | ((designId: string, revId: string) => boolean);
  revisionDetailPending?: boolean;
  workingCopyByDesign?: Record<string, DesignWorkingCopy | null>;
  workingCopyFail?: boolean | (() => boolean); // #641: non-404 working-copy failure
  workingCopyFailStatus?: number;
  workingCopyPending?: boolean;
  releases?: ProductionRelease[];
  releasesFail?: boolean | (() => boolean); // #641: release linkage request failure
  artifactsFail?: boolean;
  grantUrlByKind?: Partial<Record<'model' | 'manifest' | 'preview', string>>;
  artifactAuthorizationFailKind?: 'model' | 'manifest' | 'preview';
  // #499 pairing handoff
  pairingStatusFail?: boolean;
  pairingStatus?: 'pending' | 'exchanged' | 'cancelled' | 'expired';
}

function setupFetchMock(options: FetchMockOptions = {}) {
  // Copy: POST below appends the created row, and the default mockDesigns must
  // not leak across tests.
  const designs = [...(options.designs ?? mockDesigns)];
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
    const path = parsed.pathname.replace(/^\/api(?=\/)/, '');
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
      // The server persists the row: the invalidated list refetch (and only
      // it) must observe the new design — mirror that in the mock.
      designs.push(created);
      (fetchMock as any).lastDesignCreate = body;
      return json(created, 201);
    }

    // 3. List revisions: GET /designs/:id/revisions
    for (const dId of Object.keys(revisionsByDesign)) {
      if (path === `/designs/${dId}/revisions` && method === 'GET') {
        if (options.revisionsFail === true || (typeof options.revisionsFail === 'function' && options.revisionsFail())) {
          return new Response(JSON.stringify({ code: 'INTERNAL', message: 'revisions list failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
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
        if (options.workingCopyPending) {
          return new Promise(() => {});
        }
        if (
          options.workingCopyFail === true ||
          (typeof options.workingCopyFail === 'function' && options.workingCopyFail())
        ) {
          const status = options.workingCopyFailStatus ?? 500;
          return new Response(
            JSON.stringify({
              code: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'INTERNAL',
              message: 'working copy request failed',
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const wc = workingCopies[dId];
        if (!wc) {
          return new Response('Not Found', { status: 404 });
        }
        return json(wc);
      }
    }

    // 5. Production releases: GET /projects/:id/production-releases
    if (path === `/projects/${PROJECT_ID}/production-releases` && method === 'GET') {
      if (options.releasesFail === true || (typeof options.releasesFail === 'function' && options.releasesFail())) {
        return new Response(JSON.stringify({ code: 'INTERNAL', message: 'releases failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return json(releases);
    }

    // 6. Artifact authorization: POST /designs/:id/revisions/:revId/artifacts/:kind:authorize
    const authRegex = /^\/designs\/([^/]+)\/revisions\/([^/]+)\/artifacts\/(model|manifest|preview):authorize$/;
    const authMatch = path.match(authRegex);
    if (authMatch && method === 'POST') {
      const [, designId, revId, kind] = authMatch;
      if (kind === options.artifactAuthorizationFailKind) {
        return json({ code: 'FORBIDDEN', message: 'artifact access rejected' }, 403);
      }
      const grant: DesignArtifactGrant = {
        kind: kind as any,
        url:
          options.grantUrlByKind?.[kind as 'model' | 'manifest' | 'preview'] ??
          `/api/design-artifacts/storage/${designId}/${revId}/${kind}.bin?grant=signed-token-xyz`,
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

    // 8. #499 pairing grants: create / status / cancel
    if (method === 'POST' && /\/pairing-grants$/.test(path)) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const created = {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        action: body.action ?? 'open_design',
        status: 'pending',
        base_revision_id: body.base_revision_id ?? null,
        code: 'ABCD234EFGH5',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };
      (fetchMock as any).lastPairingCreate = body;
      return json(created, 201);
    }
    const pairingStatusMatch = path.match(/\/pairing-grants\/([0-9a-f-]+)$/);
    if (pairingStatusMatch && method === 'GET') {
      if (options.pairingStatusFail) {
        return new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'poll failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return json({
        id: pairingStatusMatch[1],
        action: 'open_design',
        status: options.pairingStatus ?? 'pending',
        base_revision_id: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        exchanged_at: options.pairingStatus === 'exchanged' ? new Date().toISOString() : null,
      });
    }
    const pairingCancelMatch = path.match(/\/pairing-grants\/([0-9a-f-]+):cancel$/);
    if (pairingCancelMatch && method === 'POST') {
      (fetchMock as any).lastPairingCancel = pairingCancelMatch[1];
      return json({
        id: pairingCancelMatch[1],
        action: 'open_design',
        status: 'cancelled',
        base_revision_id: null,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        exchanged_at: null,
      });
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
  onOpenReconciliation?: (ctx: { designId: string | null; revisionId: string | null }) => void;
  onBack?: () => void;
  canMutate?: boolean;
  seedRevisionDetail?: DesignRevision;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const keys = projectDesignsQueryKeys(['test-scope'], PROJECT_ID);

  if (props.seedRevisionDetail) {
    queryClient.setQueryData(
      keys.designRevisionDetail(DESIGN_1_ID, props.seedRevisionDetail.id),
      props.seedRevisionDetail,
    );
  }

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <ProjectDesignsScreen
          baseUrl={API}
          token="test-jwt-token"
          projectId={PROJECT_ID}
          queryKeys={keys}
          initialContext={props.initialContext}
          onContextChange={props.onContextChange}
          onOpenFurnitureMatrix={props.onOpenFurnitureMatrix}
          onOpenReconciliation={props.onOpenReconciliation}
          onBack={props.onBack}
          canMutate={props.canMutate}
        />
      </QueryClientProvider>,
    ),
    queryClient,
    keys,
  };
}

describe('ProjectDesignsScreen (#501 / WEB-DT-2)', () => {
  let windowOpenSpy: any;
  let popupReplaceSpy: ReturnType<typeof vi.fn>;
  let popupCloseSpy: ReturnType<typeof vi.fn>;
  let popupWindow: Window;

  beforeEach(() => {
    popupReplaceSpy = vi.fn();
    popupCloseSpy = vi.fn();
    popupWindow = {
      opener: window,
      closed: false,
      location: { replace: popupReplaceSpy },
      close: popupCloseSpy,
    } as unknown as Window;
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => popupWindow);
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
    expect(screen.getByText(/600 mm/i)).toBeInTheDocument();
    expect(screen.queryByText(/Roble Nebraska 18mm/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/900 mm/i)).not.toBeInTheDocument();

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
    expect(previewImg.getAttribute('src')).toBe(
      `http://api.test/api/design-artifacts/storage/${DESIGN_1_ID}/${REV_3_ID}/preview.bin?grant=signed-token-xyz`,
    );
    expect(previewImg.getAttribute('src')).not.toContain('/api/api/');
    expect(previewImg.getAttribute('src')).toContain('grant=signed-token-xyz');

    // Verify authorize was called for preview
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/designs/${DESIGN_1_ID}/revisions/${REV_3_ID}/artifacts/preview:authorize`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('authorizes the selected artifact and navigates a synchronously reserved tab to its exact URL', async () => {
    const fetchMock = setupFetchMock();
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
      expect(popupReplaceSpy).toHaveBeenCalledTimes(1);
    });

    expect(windowOpenSpy).toHaveBeenCalledWith('', '_blank');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/designs/${DESIGN_1_ID}/revisions/${REV_3_ID}/artifacts/model:authorize`,
      ),
      expect.objectContaining({ method: 'POST' }),
    );
    const openedUrl = popupReplaceSpy.mock.calls[0]![0] as string;
    expect(openedUrl).toBe(
      `http://api.test/api/design-artifacts/storage/${DESIGN_1_ID}/${REV_3_ID}/model.bin?grant=signed-token-xyz`,
    );
    expect(openedUrl).not.toContain('/api/api/');
    expect(openedUrl).toContain('grant=signed-token-xyz');
    expect(openedUrl).not.toContain('test-jwt-token'); // Negative proof: raw token never passed in URL
  });

  it('turns preview byte-load failure into a recoverable state and retries authorization', async () => {
    const fetchMock = setupFetchMock();
    const user = userEvent.setup();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
    });

    const previewImg = await screen.findByTestId('preview-image');
    fireEvent.error(previewImg);

    expect(await screen.findByTestId('preview-load-error')).toHaveTextContent(
      'No se pudo cargar la imagen de vista previa.',
    );
    expect(screen.queryByTestId('preview-image')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar vista previa' }));

    expect(await screen.findByTestId('preview-image')).toBeInTheDocument();
    await waitFor(() => {
      const previewAuthorizations = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/artifacts/preview:authorize'),
      );
      expect(previewAuthorizations).toHaveLength(2);
    });
  });

  it('fails closed when the backend returns a cross-origin preview grant', async () => {
    setupFetchMock({
      grantUrlByKind: {
        preview: 'https://attacker.test/api/design-artifacts/model.skp?grant=stolen',
      },
    });

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
    });

    expect(await screen.findByTestId('preview-grant-error')).toHaveTextContent(
      'El servidor devolvió un enlace no válido para la vista previa.',
    );
    expect(screen.queryByTestId('preview-image')).not.toBeInTheDocument();
  });

  it('reports a blocked popup instead of silently authorizing an artifact', async () => {
    const fetchMock = setupFetchMock();
    windowOpenSpy.mockReturnValueOnce(null);
    const user = userEvent.setup();

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
    });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });
    await user.click(screen.getByTestId('download-artifact-manifest'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El navegador bloqueó la nueva pestaña.',
    );
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/artifacts/manifest:authorize')),
    ).toBe(false);
    expect(popupCloseSpy).not.toHaveBeenCalled();
  });

  it('closes the reserved tab and reports authorization rejection separately', async () => {
    setupFetchMock({ artifactAuthorizationFailKind: 'model' });
    const user = userEvent.setup();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });
    await user.click(screen.getByTestId('download-artifact-model'));

    expect(await screen.findByTestId('artifact-access-error-authorization')).toHaveTextContent(
      'El servidor rechazó el acceso al artefacto.',
    );
    expect(popupCloseSpy).toHaveBeenCalledTimes(1);
    expect(popupReplaceSpy).not.toHaveBeenCalled();
  });

  it('closes the reserved tab and fails closed for an invalid artifact grant', async () => {
    setupFetchMock({ grantUrlByKind: { manifest: 'https://attacker.test/artifact.json' } });
    const user = userEvent.setup();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });
    await user.click(screen.getByTestId('download-artifact-manifest'));

    expect(await screen.findByTestId('artifact-access-error-invalid-grant')).toHaveTextContent(
      'El servidor devolvió un enlace de acceso no válido.',
    );
    expect(popupCloseSpy).toHaveBeenCalledTimes(1);
    expect(popupReplaceSpy).not.toHaveBeenCalled();
  });

  it('reports a tab closed while authorization was pending without relabeling it as auth failure', async () => {
    setupFetchMock();
    Object.defineProperty(popupWindow, 'closed', { value: true });
    const user = userEvent.setup();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });
    await user.click(screen.getByTestId('download-artifact-preview'));

    expect(await screen.findByTestId('artifact-access-error-popup-closed')).toHaveTextContent(
      'La pestaña del artefacto se cerró antes de abrirlo.',
    );
    expect(popupCloseSpy).not.toHaveBeenCalled();
    expect(popupReplaceSpy).not.toHaveBeenCalled();
  });

  it('closes the reserved tab and reports navigation failure when replace throws', async () => {
    setupFetchMock();
    popupReplaceSpy.mockImplementationOnce(() => {
      throw new Error('navigation rejected');
    });
    const user = userEvent.setup();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });
    await user.click(screen.getByTestId('download-artifact-model'));

    expect(await screen.findByTestId('artifact-access-error-navigation')).toHaveTextContent(
      'No se pudo abrir el artefacto en la nueva pestaña.',
    );
    expect(popupCloseSpy).toHaveBeenCalledTimes(1);
    expect(popupReplaceSpy).toHaveBeenCalledTimes(1);
  });

  it('#499 handoff: CTA exists but never launches a custom URI and never shows tokens', async () => {
    setupFetchMock();
    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
    });

    await screen.findByText('Cocina Principal');

    // The Slice 2 CTA exists (it opens the pairing sheet only)...
    expect(screen.getByTestId('open-in-sketchup-btn')).toBeInTheDocument();

    // ...but nothing may attempt a custom URI scheme, and no session token or
    // secret may ever reach the DOM — the pairing code is the only manual datum.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-in-sketchup-btn'));
    const modal = await screen.findByTestId('sketchup-pairing-modal');
    expect(modal).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sketchup:\/\//i);
    expect(document.body.textContent).not.toContain('test-jwt-token');
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
      screen.getByText('No se pudo verificar el estado de los artefactos de la revisión.'),
    ).toBeInTheDocument();
    // #640: a failed health request keeps its retry, never an empty collapse.
    expect(screen.getByTestId('retry-artifacts-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('no-artifacts-hint')).not.toBeInTheDocument();
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
      created_by: '66666666-0000-4000-8000-000000000001',
  created_by_display_name: 'Arquitecto Juan',
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


describe('ProjectDesignsScreen — #499 SketchUp pairing handoff (Slice 2)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows create-design actions only for authorized users (canMutate wiring)', async () => {
    setupFetchMock();
    const { rerender } = renderScreen({ canMutate: false });

    // Read-only: the mutation CTA is hidden; pairing CTA still available for
    // the selected design (handoff is read-scoped, backend stays authority).
    await screen.findByRole('tab', { name: /Cocina Principal/i });
    expect(screen.queryByTestId('create-design-btn')).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ProjectDesignsScreen
          baseUrl={API}
          token="test-jwt-token"
          projectId={PROJECT_ID}
          queryKeys={projectDesignsQueryKeys(['test-scope'], PROJECT_ID)}
          canMutate
        />
      </QueryClientProvider>,
    );
    await screen.findByTestId('create-design-btn');
    expect(screen.getByTestId('open-in-sketchup-btn')).toBeInTheDocument();
  });

  it('creates the grant with the EXACT selected revision (R1), not implicit latest', async () => {
    const fetchMock = setupFetchMock();
    renderScreen();

    await screen.findByTestId('revision-node-R1');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('revision-node-R1'));
    await screen.findByTestId('revision-inspector');

    await user.click(screen.getByTestId('open-in-sketchup-btn'));

    expect(await screen.findByTestId('sketchup-pairing-modal')).toBeInTheDocument();
    await waitFor(() => {
      expect((fetchMock as any).lastPairingCreate).toEqual({
        action: 'open_design',
        base_revision_id: REV_1_ID,
      });
    });
    // The frozen label shows the exact pinned revision.
    expect(screen.getByTestId('pairing-base-label')).toHaveTextContent('Base: R1');
  });

  it('creates the grant with base_revision_id omitted when the design has no published revision', async () => {
    const fetchMock = setupFetchMock({
      designs: [
        {
          id: DESIGN_2_ID,
          project_id: PROJECT_ID,
          name: 'Isla & Comedor',
          status: 'active',
          created_at: '2026-09-02T11:00:00Z',
          updated_at: '2026-09-02T11:00:00Z',
        },
      ],
      revisionsByDesign: { [DESIGN_2_ID]: [] },
      workingCopyByDesign: { [DESIGN_2_ID]: null },
    });
    renderScreen({ initialContext: { designId: DESIGN_2_ID, revisionId: null } });

    const cta = await screen.findByTestId('no-revisions-open-sketchup-btn');
    expect(cta).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(cta);

    expect(await screen.findByTestId('sketchup-pairing-modal')).toBeInTheDocument();
    await waitFor(() => {
      expect((fetchMock as any).lastPairingCreate).toEqual({ action: 'open_design' });
    });
    expect(screen.getByTestId('pairing-base-label')).toHaveTextContent(
      'Base: Sin revisión publicada',
    );
  });

  it('keeps the modal pinned to R1 when the timeline selection moves to R2 (stale-base freeze)', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID } });

    await screen.findByTestId('revision-node-R1');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-in-sketchup-btn'));
    expect(await screen.findByTestId('sketchup-pairing-modal')).toBeInTheDocument();
    expect(screen.getByTestId('pairing-base-label')).toHaveTextContent('Base: R1');

    // The user moves the timeline selection to R2 while the sheet is open:
    // the sheet keeps the grant's own frozen pin — never silently R2.
    await user.click(screen.getByTestId('revision-node-R2'));
    await screen.findByTestId('revision-inspector');
    expect(screen.getByTestId('pairing-base-label')).toHaveTextContent('Base: R1');
  });

  it('reports code accepted (not falsely opened) when the grant is exchanged', async () => {
    setupFetchMock({ pairingStatus: 'exchanged' });
    renderScreen();

    await screen.findByTestId('revision-node-R1');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-in-sketchup-btn'));

    expect(await screen.findByTestId('pairing-exchanged')).toHaveTextContent(
      /Código aceptado por SketchUp/,
    );
    expect(screen.queryByText(/abierto correctamente/i)).not.toBeInTheDocument();
  });
});

describe('ProjectDesignsScreen — zero-design empty state (first Design DEMO path)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('authorized user (canMutate) sees "Crear primer diseño", creates via canonical POST, selection and SketchUp CTA follow', async () => {
    const fetchMock = setupFetchMock({ designs: [] });
    renderScreen({
      canMutate: true,
      onOpenReconciliation: vi.fn(),
      onOpenFurnitureMatrix: vi.fn(),
    });

    // Empty state with the mutation CTA for authorized users.
    expect(await screen.findByText('No hay diseños en esta obra')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear primer diseño' })).toBeInTheDocument();

    // Reconciliation dead-ends without a DesignRevision (#502) — hidden.
    // The furniture matrix stays: it is useful independently of designs.
    expect(screen.queryByTestId('open-reconciliation-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('open-furniture-matrix-btn')).toBeInTheDocument();

    // CTA opens the modal with the suggested name prefilled.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Crear primer diseño' }));
    const nameInput = await screen.findByLabelText(/Nombre de la alternativa/i);
    expect(nameInput).toHaveValue('Diseño Principal');

    await user.clear(nameInput);
    await user.type(nameInput, 'Diseño principal');
    await user.click(screen.getByTestId('submit-create-design'));

    // Canonical API create → refetch → the new design is selected and the
    // SketchUp handoff becomes available (no local fabrication).
    expect(await screen.findByRole('tab', { name: /Diseño principal/i })).toBeInTheDocument();
    expect(screen.getByTestId('open-in-sketchup-btn')).toBeInTheDocument();
    expect((fetchMock as any).lastDesignCreate).toEqual({ name: 'Diseño principal' });
    expect(screen.queryByText('No hay diseños en esta obra')).not.toBeInTheDocument();
  });

  it('read-only user sees the read-only empty state without the creation CTA', async () => {
    setupFetchMock({ designs: [] });
    renderScreen({ canMutate: false });

    expect(await screen.findByText('No hay diseños en esta obra')).toBeInTheDocument();
    expect(
      screen.getByText('Aún no se ha creado ninguna alternativa de diseño para el proyecto.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear primer diseño' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-design-btn')).not.toBeInTheDocument();
  });

  it('reconciliation CTA stays available once a design exists', async () => {
    setupFetchMock();
    renderScreen({ onOpenReconciliation: vi.fn() });

    await screen.findByRole('tab', { name: /Cocina Principal/i });
    expect(screen.getByTestId('open-reconciliation-btn')).toBeInTheDocument();
  });
});

describe('ProjectDesignsScreen — #640 authoritative artifact health', () => {
  type HealthStatus = 'available' | 'missing' | 'integrity_mismatch';

  const revision3WithHealth = (
    healthByKind: Partial<Record<'model' | 'manifest' | 'preview', HealthStatus>>,
  ): DesignRevision => ({
    ...mockRevision3,
    artifacts: (mockRevision3.artifacts ?? []).map((art) => ({
      ...art,
      health: {
        status: healthByKind[art.kind as 'model' | 'manifest' | 'preview'] ?? 'available',
        checked_at: '2026-09-03T14:00:05Z',
      },
    })),
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders available artifacts with working access and kind-specific accessible labels', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });

    for (const kind of ['model', 'manifest', 'preview'] as const) {
      const badge = screen.getByTestId(`artifact-health-${kind}`);
      expect(badge).toHaveTextContent('Disponible');
      expect(screen.getByTestId(`download-artifact-${kind}`)).toBeEnabled();
    }
    expect(
      screen.getByTestId('download-artifact-model'),
    ).toHaveAccessibleName('Descargar modelo SKP');
    expect(
      screen.getByTestId('download-artifact-manifest'),
    ).toHaveAccessibleName('Descargar manifest JSON');
    expect(
      screen.getByTestId('download-artifact-preview'),
    ).toHaveAccessibleName('Abrir vista previa PNG');
    // Healthy revision: no recovery alert.
    expect(screen.queryByTestId('artifact-health-recovery')).not.toBeInTheDocument();
  });

  it('missing bytes show an honest preview state, disabled access and a republish recovery path', async () => {
    const fetchMock = setupFetchMock({
      revisionDetailOverride: {
        [DESIGN_1_ID]: { [REV_3_ID]: revision3WithHealth({ preview: 'missing' }) },
      },
    });
    const user = userEvent.setup();
    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
      canMutate: true,
    });

    const missing = await screen.findByTestId('preview-health-missing');
    expect(missing).toHaveTextContent(
      'sus bytes ya no están disponibles en el almacenamiento',
    );
    // Immutable-revision honesty: recovery names republishing, never in-place repair.
    expect(missing).toHaveTextContent('no se repara en el lugar');
    expect(screen.queryByTestId('preview-image')).not.toBeInTheDocument();

    // No authorize round-trip is attempted for a known-missing artifact.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes('/artifacts/preview:authorize')),
      ).toBe(false);
    });

    expect(screen.getByTestId('download-artifact-preview')).toBeDisabled();
    expect(screen.getByTestId('download-artifact-model')).toBeEnabled();
    expect(screen.getByTestId('artifact-health-preview')).toHaveTextContent(
      'Bytes no disponibles',
    );

    // Recovery is actionable: it opens the executable republish continuation.
    const recovery = screen.getByTestId('artifact-health-recovery');
    expect(recovery).toHaveTextContent('publicá una nueva revisión');
    await user.click(screen.getByTestId('preview-recovery-open-sketchup-btn'));
    expect(await screen.findByTestId('sketchup-pairing-modal')).toBeInTheDocument();
  });

  it('integrity_mismatch shows a stronger warning and never grants access', async () => {
    setupFetchMock({
      revisionDetailOverride: {
        [DESIGN_1_ID]: { [REV_3_ID]: revision3WithHealth({ model: 'integrity_mismatch' }) },
      },
    });
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    expect(await screen.findByTestId('artifact-health-model')).toHaveTextContent(
      'Integridad comprometida',
    );
    expect(screen.getByTestId('download-artifact-model')).toBeDisabled();
    expect(screen.getByTestId('artifact-health-recovery')).toHaveTextContent(
      'no coinciden con lo publicado',
    );
    // The healthy preview keeps its normal flow: mismatch is per artifact.
    expect(await screen.findByTestId('preview-image')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-health-preview')).toHaveTextContent('Disponible');
  });

  it('fails closed when preview health is absent and exposes the unknown state accessibly', async () => {
    const revisionWithoutPreviewHealth: DesignRevision = {
      ...mockRevision3,
      artifacts: (mockRevision3.artifacts ?? []).map((artifact) =>
        artifact.kind === 'preview' ? { ...artifact, health: undefined } : artifact,
      ) as unknown as readonly DesignRevisionArtifact[],
    };
    const fetchMock = setupFetchMock({ revisionDetailPending: true });
    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
      seedRevisionDetail: revisionWithoutPreviewHealth,
    });

    const unknown = await screen.findByTestId('preview-health-unknown');
    expect(unknown).toHaveAttribute('role', 'alert');
    expect(unknown).toHaveTextContent('no informó un estado verificable');
    expect(screen.queryByTestId('preview-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('download-artifact-preview')).toBeDisabled();
    expect(screen.getByTestId('artifact-health-preview')).toHaveTextContent('Estado no informado');
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/artifacts/preview:authorize')),
    ).toBe(false);
  });

  it('keeps health loading distinct from loaded states', async () => {
    setupFetchMock({ revisionDetailPending: true });
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    expect(await screen.findByTestId('revision-detail-loading')).toBeVisible();
    expect(screen.queryByTestId('artifacts-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('no-artifacts-hint')).not.toBeInTheDocument();
  });

  it('reports artifact health request failure with retry and never an empty-list collapse', async () => {
    const fetchMock = setupFetchMock({
      revisionDetailOverride: {
        [DESIGN_1_ID]: {
          [REV_3_ID]: { ...mockRevision3, artifacts: [] },
        },
      },
      artifactsFail: true,
    });
    const user = userEvent.setup();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    const error = await screen.findByTestId('artifacts-error-hint');
    expect(error).toHaveTextContent('No se pudo verificar el estado de los artefactos');
    // A failed health request is NOT "sin artefactos".
    expect(screen.queryByTestId('no-artifacts-hint')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('retry-artifacts-btn'));
    await waitFor(() => {
      const artifactListCalls = fetchMock.mock.calls.filter(
        ([input]) => /\/artifacts$/.test(String(input)),
      );
      expect(artifactListCalls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByTestId('artifacts-error-hint')).toBeInTheDocument();
  });

  it('exposes the full canonical digest once, copyable with an accessible label', async () => {
    // userEvent.setup() installs its own navigator.clipboard stub, so the
    // spy must land after setup to observe the copy.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setupFetchMock();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });

    // Compact badge: one canonical prefix, never duplicated.
    const badge = screen.getByTestId('artifact-row-model').querySelector('.pd-hash-badge');
    expect(badge?.textContent).toBe('sha256-e3b0c442…');
    expect(screen.queryByText(/sha256-sha256/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sha256:sha256/)).not.toBeInTheDocument();
    expect(screen.getByTestId('artifact-row-model').querySelector('.pd-hash-badge')).toHaveAccessibleName(
      'SHA-256 del artefacto Modelo 3D (.skp)',
    );

    await user.click(screen.getByTestId('toggle-technical-audit'));
    const modelDigest = await screen.findByTestId('artifact-digest-model');
    expect(modelDigest).toHaveTextContent(
      'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    // Exactly one occurrence of the full digest (compact + full differ).
    expect(screen.getAllByText('sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toHaveLength(1);

    const copyButton = screen.getByTestId('copy-sha256-model');
    expect(copyButton).toHaveAccessibleName('Copiar SHA-256 de Modelo 3D (.skp)');
    await user.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ));
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // #641 — honest async states, exact pinning across background refetches and
  // accessibility. A request failure must never masquerade as business
  // absence ("no revisions", "no release", "no working copy").
  // ---------------------------------------------------------------------------

  it('#641 revision list request failure is an explicit error with retry, never "no revisions"', async () => {
    let shouldFail = true;
    setupFetchMock({ revisionsFail: () => shouldFail });
    const user = userEvent.setup();

    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: null } });

    const error = await screen.findByTestId('revisions-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent('No se pudo cargar el linaje de revisiones');
    expect(screen.queryByTestId('no-revisions-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('revision-node-R1')).not.toBeInTheDocument();
    // Independent queries keep their truth: the working copy is unaffected.
    expect(await screen.findByTestId('working-copy-banner')).toBeInTheDocument();

    shouldFail = false;
    const retry = screen.getByTestId('retry-revisions-btn');
    retry.focus();
    await user.keyboard('{Enter}'); // keyboard-reachable retry
    expect(await screen.findByTestId('revision-node-R1')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R3')).toBeInTheDocument();
    expect(screen.queryByTestId('revisions-error')).not.toBeInTheDocument();
  });

  it('#641 working copy 404 is honest absence, not an error', async () => {
    setupFetchMock({ workingCopyByDesign: { [DESIGN_1_ID]: null } });

    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID } });

    expect(await screen.findByTestId('no-working-copy-notice')).toHaveTextContent(
      'No hay borrador de trabajo',
    );
    expect(screen.queryByTestId('working-copy-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('working-copy-banner')).not.toBeInTheDocument();
  });

  it('#641 working copy initial load exposes a status instead of disappearing', async () => {
    setupFetchMock({ workingCopyPending: true });

    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID } });

    const loading = await screen.findByTestId('working-copy-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveTextContent('Consultando borrador de trabajo');
    expect(screen.queryByTestId('no-working-copy-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('working-copy-error')).not.toBeInTheDocument();
  });

  it('#641 working copy request failure is actionable with retry, never collapsed into absence', async () => {
    let shouldFail = true;
    setupFetchMock({ workingCopyFail: () => shouldFail });
    const user = userEvent.setup();

    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID } });

    const error = await screen.findByTestId('working-copy-error');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveTextContent('No se pudo verificar el borrador de trabajo');
    // Failure != 404 absence: neither the banner nor the absence notice may render.
    expect(screen.queryByTestId('working-copy-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('no-working-copy-notice')).not.toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByTestId('retry-working-copy-btn'));
    expect(await screen.findByTestId('working-copy-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('working-copy-error')).not.toBeInTheDocument();
  });

  it('#641 failed working-copy background refresh marks cached data stale and provides retry', async () => {
    let shouldFail = false;
    setupFetchMock({ workingCopyFail: () => shouldFail });
    const user = userEvent.setup();

    const { queryClient, keys } = renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID },
    });
    expect(await screen.findByTestId('working-copy-banner')).toBeInTheDocument();

    shouldFail = true;
    await queryClient.invalidateQueries({ queryKey: keys.designWorkingCopy(DESIGN_1_ID) });

    const stale = await screen.findByTestId('working-copy-stale-error');
    expect(stale).toHaveAttribute('role', 'alert');
    expect(stale).toHaveTextContent('última versión conocida');
    expect(screen.getByTestId('working-copy-banner')).toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByTestId('retry-working-copy-btn'));
    await waitFor(() => expect(screen.queryByTestId('working-copy-stale-error')).not.toBeInTheDocument());
    expect(screen.getByTestId('working-copy-banner')).toBeInTheDocument();
  });

  it('#641 cached empty revision list with failed refetch is stale/error, never business empty', async () => {
    let shouldFail = false;
    setupFetchMock({
      revisionsByDesign: { [DESIGN_1_ID]: [] },
      revisionsFail: () => shouldFail,
    });

    const { queryClient, keys } = renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: null },
    });
    expect(await screen.findByTestId('no-revisions-notice')).toBeInTheDocument();

    shouldFail = true;
    await queryClient.invalidateQueries({ queryKey: keys.designRevisions(DESIGN_1_ID) });

    const stale = await screen.findByTestId('revisions-stale-error');
    expect(stale).toHaveAttribute('role', 'alert');
    expect(stale).toHaveTextContent('última respuesta conocida estaba vacía');
    expect(screen.queryByTestId('no-revisions-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('retry-revisions-btn')).toBeEnabled();
  });

  it('#641 distinguishes session (401) from permission (403) working copy failures', async () => {
    setupFetchMock({ workingCopyFail: true, workingCopyFailStatus: 403 });
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID } });

    expect(await screen.findByTestId('working-copy-error')).toHaveTextContent(
      'No tenés permiso para consultar esta información',
    );
    expect(screen.queryByTestId('no-working-copy-notice')).not.toBeInTheDocument();

    cleanup();

    setupFetchMock({ workingCopyFail: true, workingCopyFailStatus: 401 });
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID } });

    expect(await screen.findByTestId('working-copy-error')).toHaveTextContent(
      'Tu sesión no es válida o expiró',
    );
    expect(screen.queryByTestId('no-working-copy-notice')).not.toBeInTheDocument();
  });

  it('#641 production release request failure shows an unavailable state with retry, never silent "no release"', async () => {
    let shouldFail = true;
    setupFetchMock({ releasesFail: () => shouldFail });
    const user = userEvent.setup();

    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    expect(await screen.findByRole('heading', { level: 2, name: /Revisión R3/i })).toBeInTheDocument();
    const unavailable = await screen.findByTestId('release-status-error');
    expect(unavailable).toHaveAttribute('role', 'alert');
    expect(unavailable).toHaveTextContent('Estado de liberación no disponible');
    // The release area is NOT silently removed.
    expect(screen.queryByTestId('linked-release-badge')).not.toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByTestId('retry-releases-btn'));
    expect(await screen.findByTestId('linked-release-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('release-status-error')).not.toBeInTheDocument();
  });

  it('#641 failed background refresh of the exact snapshot keeps pinned data visible with an honest error', async () => {
    setupFetchMock({ revisionDetailFail: true });

    renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID },
      seedRevisionDetail: mockRevision3,
    });

    // Seeded exact data stays visible; the failed refresh is explicit, never a blank.
    const staleError = await screen.findByTestId('revision-detail-stale-error');
    expect(staleError).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('revision-inspector')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Revisión R3/i })).toBeInTheDocument();
    // No substitution: the failed refresh never swaps in another revision.
    expect(screen.queryByTestId('revision-detail-error')).not.toBeInTheDocument();
  });

  it('#641 background refetch keeps exact R2 pinned even when the fresh list adds R3', async () => {
    const revisions = [mockRevision1, mockRevision2];
    setupFetchMock({ revisionsByDesign: { [DESIGN_1_ID]: revisions } });

    const { queryClient, keys } = renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_2_ID },
    });
    expect(await screen.findByRole('heading', { level: 2, name: /Revisión R2/i })).toBeInTheDocument();

    // The server now has R3 as the latest published revision.
    revisions.push(mockRevision3);
    await queryClient.invalidateQueries({ queryKey: keys.designRevisions(DESIGN_1_ID) });

    // The fresh timeline includes R3, but the explicit selection stays R2.
    expect(await screen.findByTestId('revision-node-R3')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R2')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('revision-node-R3')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 2, name: /Revisión R2/i })).toBeInTheDocument();
    expect(screen.queryByTestId('invalid-revision-notice')).not.toBeInTheDocument();
  });

  it('#641 marks an in-flight background refresh without clearing the pinned timeline', async () => {
    const fetchMock = setupFetchMock();
    let blockRevisions = false;
    // Holder object: TS control-flow analysis can't track closure assignments
    // on a bare `let`, which types the resolver as `never` at the call site.
    const blocked: { resolve: ((response: Response) => void) | null } = { resolve: null };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (blockRevisions && /\/revisions$/.test(new URL(url).pathname)) {
        return new Promise<Response>((resolve) => {
          blocked.resolve = resolve;
        });
      }
      return fetchMock(input as RequestInfo, init);
    });

    const { queryClient, keys } = renderScreen({
      initialContext: { designId: DESIGN_1_ID, revisionId: REV_2_ID },
    });
    expect(await screen.findByRole('heading', { level: 2, name: /Revisión R2/i })).toBeInTheDocument();

    blockRevisions = true;
    void queryClient.invalidateQueries({ queryKey: keys.designRevisions(DESIGN_1_ID) });

    // While refetching: exact timeline + pinned selection stay, marked as refreshing.
    const mark = await screen.findByTestId('revisions-refreshing');
    expect(mark).toHaveAttribute('aria-hidden', 'true'); // no polling noise for assistive tech
    expect(screen.getByTestId('revision-node-R1')).toBeInTheDocument();
    expect(screen.getByTestId('revision-node-R2')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { level: 2, name: /Revisión R2/i })).toBeInTheDocument();

    const freshList = (await fetchMock(`${API}/designs/${DESIGN_1_ID}/revisions`)) as Response;
    blocked.resolve?.(freshList);
    await waitFor(() =>
      expect(screen.queryByTestId('revisions-refreshing')).not.toBeInTheDocument(),
    );
    // After the refresh the pinned revision is still exactly R2.
    expect(screen.getByRole('heading', { level: 2, name: /Revisión R2/i })).toBeInTheDocument();
  });

  it('#641 a11y: no generic "Acceder" accessible names remain on artifact actions', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });
    expect(screen.queryAllByRole('button', { name: 'Acceder' })).toHaveLength(0);
    const artifactButtons = [
      screen.getByTestId('download-artifact-model'),
      screen.getByTestId('download-artifact-manifest'),
      screen.getByTestId('download-artifact-preview'),
    ];
    const names = artifactButtons.map((button) => button.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(artifactButtons.length); // unique per artifact
  });

  it('#641 a11y: technical audit disclosure exposes expanded/controls and stays keyboard operable', async () => {
    const user = userEvent.setup();
    setupFetchMock();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });

    const toggle = screen.getByTestId('toggle-technical-audit');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    const panel = document.getElementById(controlsId as string);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('hidden'); // stable id, mounted while collapsed

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('technical-audit-details')).toBeVisible();
    // Focus stays on the disclosure button: no forced focus move.
    expect(toggle).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('technical-audit-details')).not.toBeVisible();
  });

  it('#641 a11y: loading surfaces use status semantics', async () => {
    setupFetchMock({ revisionDetailPending: true });
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_1_ID } });

    expect(await screen.findByTestId('revision-detail-loading')).toHaveAttribute('role', 'status');
  });

  it('#641 a11y: full IDs are exposed through a focusable, copyable technical path', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setupFetchMock();
    renderScreen({ initialContext: { designId: DESIGN_1_ID, revisionId: REV_3_ID } });

    await screen.findByRole('heading', { level: 2, name: /Revisión R3/i });
    await user.click(screen.getByTestId('toggle-technical-audit'));

    const copyRevision = screen.getByTestId('copy-revision-id');
    expect(copyRevision).toHaveAccessibleName('Copiar Revision ID completo');
    expect(copyRevision).toBeEnabled(); // focusable + operable
    await user.click(copyRevision);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(REV_3_ID));

    // The full ID is selectable text inside the technical path only; primary
    // product copy (working copy banner) keeps the truncated form.
    const panel = screen.getByTestId('technical-audit-details');
    expect(within(panel).getAllByText(REV_3_ID).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('working-copy-banner')).toHaveTextContent('33333333…');
    expect(screen.getByTestId('working-copy-banner')).not.toHaveTextContent(REV_3_ID);
  });
});
