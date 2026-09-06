// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GraneteApiError, type ApiError } from '@granete/storage';
import type {
  Design,
  DesignRevision,
  ManufacturingPreflightResult,
  ProductionRelease,
  ProjectDesignReconciliationResult,
  QuoteRevisionDetail,
} from '@granete/storage';
import {
  ProjectReconciliationScreen,
  projectReconciliationQueryKeys,
  type ProjectReconciliationContextState,
} from './ProjectReconciliationScreen';
import {
  findContextualRelease,
  formatDifferencePath,
  isHistoricalComparison,
  isIncorporableChange,
} from './reconciliationWorkspace';
import { describeCommandError } from './ReconciliationCommandPanels';

export const API = 'http://api.test';
export const PROJECT_ID = '11111111-0000-4000-8000-000000000001';
export const DESIGN_1_ID = '22222222-0000-4000-8000-000000000001';
const DESIGN_2_ID = '22222222-0000-4000-8000-000000000002';
export const REV_1_ID = '33333333-0000-4000-8000-000000000001';
const REV_2_ID = '33333333-0000-4000-8000-000000000002';
export const QUOTE_1_ID = 'aaaaaaa1-0000-4000-8000-000000000001';
const QUOTE_2_ID = 'aaaaaaa2-0000-4000-8000-000000000002';
const FI_SYNCED = '77777777-0000-4000-8000-000000000001';
const FI_MODIFIED = '77777777-0000-4000-8000-000000000002';
const FI_SPATIAL = '77777777-0000-4000-8000-000000000003';
const FI_QUOTED_NOT_MODELED = '77777777-0000-4000-8000-000000000004';
const FI_MODELED_NOT_QUOTED = '77777777-0000-4000-8000-000000000005';
const FI_CONFLICT = '77777777-0000-4000-8000-000000000006';
const RELEASE_1_ID = '99999999-0000-4000-8000-000000000001';

const FINGERPRINT = 'sha256-4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce';

export const mockDesigns: Design[] = [
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
    name: 'Closet Alternativa',
    status: 'archived',
    created_at: '2026-09-02T11:00:00Z',
    updated_at: '2026-09-02T11:00:00Z',
  },
];

export const mockQuoteRevisions: QuoteRevisionDetail[] = [
  {
    id: QUOTE_1_ID,
    projectId: PROJECT_ID,
    revisionNumber: 1,
    status: 'accepted',
    sourceType: 'manual',
    baseQuoteRevisionId: null,
    sourceDesignRevisionId: null,
    createdBy: '66666666-0000-4000-8000-000000000001',
    createdAt: '2026-09-01T09:00:00Z',
    items: [],
  },
  {
    id: QUOTE_2_ID,
    projectId: PROJECT_ID,
    revisionNumber: 2,
    status: 'draft',
    sourceType: 'requote',
    baseQuoteRevisionId: QUOTE_1_ID,
    sourceDesignRevisionId: REV_1_ID,
    createdBy: '66666666-0000-4000-8000-000000000001',
    createdAt: '2026-09-04T09:00:00Z',
    items: [],
  },
];

export const mockRevision1: DesignRevision = {
  id: REV_1_ID,
  design_id: DESIGN_1_ID,
  revision_number: 1,
  parent_revision_id: null,
  source_type: 'manual',
  status: 'published',
  created_by: '66666666-0000-4000-8000-000000000001',
  created_at: '2026-09-01T10:00:00Z',
  items: [],
};

const mockRevision2: DesignRevision = {
  ...mockRevision1,
  id: REV_2_ID,
  revision_number: 2,
  parent_revision_id: REV_1_ID,
  status: 'approved',
  approved_by: '66666666-0000-4000-8000-000000000001',
  approved_at: '2026-09-03T15:00:00Z',
  created_at: '2026-09-02T12:00:00Z',
};

const noImpact = { commercial: false, manufacturing: false, spatial: false };

export const mockReconciliation: ProjectDesignReconciliationResult = {
  projectId: PROJECT_ID,
  quoteRevisionId: QUOTE_1_ID,
  designRevisionId: REV_1_ID,
  summary: {
    total: 6,
    synced: 1,
    quotedNotModeled: 1,
    modeledNotQuoted: 1,
    modified: 3,
    removed: 0,
    conflict: 1,
  },
  items: [
    {
      furnitureInstanceId: FI_SYNCED,
      status: 'synced',
      differences: [],
      impact: noImpact,
    },
    {
      furnitureInstanceId: FI_MODIFIED,
      status: 'modified',
      differences: [
        {
          path: 'parameters.widthMm',
          quoteValue: 600,
          designValue: 650,
          impact: { commercial: true, manufacturing: true, spatial: false },
        },
      ],
      impact: { commercial: true, manufacturing: true, spatial: false },
    },
    {
      furnitureInstanceId: FI_SPATIAL,
      status: 'modified',
      differences: [
        {
          path: 'transform.translationMm',
          quoteValue: [0, 0, 0],
          designValue: [120, 0, 0],
          impact: { commercial: false, manufacturing: false, spatial: true },
        },
      ],
      impact: { commercial: false, manufacturing: false, spatial: true },
    },
    {
      furnitureInstanceId: FI_QUOTED_NOT_MODELED,
      status: 'quoted_not_modeled',
      differences: [],
      impact: noImpact,
    },
    {
      furnitureInstanceId: FI_MODELED_NOT_QUOTED,
      status: 'modeled_not_quoted',
      differences: [],
      impact: { commercial: true, manufacturing: true, spatial: false },
    },
    {
      furnitureInstanceId: FI_CONFLICT,
      status: 'conflict',
      differences: [],
      impact: { commercial: true, manufacturing: true, spatial: false },
    },
  ],
  impact: {
    requiresRequote: true,
    requiresResolution: true,
    canRequote: false,
    commercialChanges: 3,
    manufacturingChanges: 3,
    spatialChanges: 1,
  },
};

export const mockPreflightReady: ManufacturingPreflightResult = {
  designRevisionId: REV_1_ID,
  scope: 'production-release-v1',
  status: 'ready',
  message: 'El preflight de fabricación valida todas las unidades de la revisión contra el catálogo: listo.',
  includesDetail: true,
  blockedItemCount: 0,
  items: [
    {
      furnitureInstanceId: FI_SYNCED,
      furnitureDefinitionId: '88888888-0000-4000-8000-000000000001',
      status: 'ok',
      issues: [],
    },
  ],
  issues: [],
};

const mockPreflightBlocked: ManufacturingPreflightResult = {
  designRevisionId: REV_1_ID,
  scope: 'production-release-v1',
  status: 'blocked',
  message: 'El preflight de fabricación bloquea la revisión: 1 unidad con problemas de fabricación.',
  includesDetail: true,
  blockedItemCount: 1,
  items: [
    {
      furnitureInstanceId: FI_MODIFIED,
      furnitureDefinitionId: '88888888-0000-4000-8000-000000000002',
      status: 'blocked',
      issues: [
        {
          code: 'invalid_parameters',
          furnitureInstanceId: FI_MODIFIED,
          furnitureDefinitionId: '88888888-0000-4000-8000-000000000002',
          parameter: 'widthMm',
          message: 'type: expected number',
        },
      ],
    },
  ],
  issues: [
    {
      code: 'invalid_parameters',
      furnitureInstanceId: FI_MODIFIED,
      furnitureDefinitionId: '88888888-0000-4000-8000-000000000002',
      parameter: 'widthMm',
      message: 'type: expected number',
    },
  ],
};

export const mockReleases: ProductionRelease[] = [
  {
    id: RELEASE_1_ID,
    project_id: PROJECT_ID,
    release_number: 1,
    design_revision_id: REV_1_ID,
    design_revision_number: 1,
    quote_revision_id: QUOTE_2_ID,
    manufacturing_fingerprint: FINGERPRINT,
    status: 'active',
    released_by: '66666666-0000-4000-8000-000000000001',
    released_at: '2026-09-04T16:00:00Z',
    staleness: {
      manufacturing_stale: true,
      current_design_revision_id: REV_2_ID,
      current_design_revision_number: 2,
    },
  },
];

interface FetchMockOptions {
  quoteRevisions?: QuoteRevisionDetail[];
  designs?: Design[];
  revisionsByDesign?: Record<string, DesignRevision[]>;
  reconciliation?: Record<string, ProjectDesignReconciliationResult>;
  reconciliationFail?: boolean;
  preflight?: Record<string, ManufacturingPreflightResult>;
  releases?: ProductionRelease[];
  requoteResponse?: () => Response;
  approveResponse?: () => Response;
  releaseResponse?: () => Response;
  createInitialQuoteResponse?: () => Response;
  publishQuoteResponse?: () => Response;
  acceptQuoteResponse?: () => Response;
}

function apiError(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(
    JSON.stringify({
      code,
      message,
      fieldErrors: {},
      requestId: 'req-test',
      retryable: false,
      details: details ?? {},
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function setupFetchMock(options: FetchMockOptions = {}) {
  const quoteRevisions = options.quoteRevisions ?? mockQuoteRevisions;
  const designs = options.designs ?? mockDesigns;
  const revisionsByDesign =
    options.revisionsByDesign ?? { [DESIGN_1_ID]: [mockRevision1, mockRevision2], [DESIGN_2_ID]: [] };
  const reconciliation = options.reconciliation ?? {
    [`${QUOTE_1_ID}:${REV_1_ID}`]: mockReconciliation,
    [`${QUOTE_2_ID}:${REV_1_ID}`]: mockReconciliation,
    [`${QUOTE_2_ID}:${REV_2_ID}`]: mockReconciliation,
  };
  const preflight = options.preflight ?? { [REV_1_ID]: mockPreflightReady, [REV_2_ID]: mockPreflightReady };
  const releases = options.releases ?? mockReleases;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

    if (path === `/projects/${PROJECT_ID}/quote-revisions` && method === 'GET') {
      return json(quoteRevisions);
    }

    if (path === `/projects/${PROJECT_ID}/designs` && method === 'GET') {
      return json(designs);
    }

    for (const [dId, revs] of Object.entries(revisionsByDesign)) {
      if (path === `/designs/${dId}/revisions` && method === 'GET') {
        return json(revs);
      }
    }

    if (path === `/projects/${PROJECT_ID}/reconciliation` && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        quoteRevisionId: string;
        designRevisionId: string;
      };
      if (options.reconciliationFail) {
        return apiError(500, 'INTERNAL_ERROR', 'reconciliation failed');
      }
      const result = reconciliation[`${body.quoteRevisionId}:${body.designRevisionId}`];
      if (!result) {
        return apiError(404, 'NOT_FOUND', 'revisions not found');
      }
      return json(result);
    }

    const preflightRegex = /^\/designs\/([^/]+)\/revisions\/([^/]+)\/preflight$/;
    const preflightMatch = path.match(preflightRegex);
    if (preflightMatch && method === 'POST') {
      const result = preflight[preflightMatch[2]!];
      if (!result) {
        return apiError(404, 'NOT_FOUND', 'revision not found');
      }
      return json(result);
    }

    if (path === `/projects/${PROJECT_ID}/production-releases` && method === 'GET') {
      return json(releases);
    }

    if (path === `/projects/${PROJECT_ID}/quote-revisions:requote` && method === 'POST') {
      if (options.requoteResponse) return options.requoteResponse();
      const created = {
        quoteRevision: {
          id: QUOTE_2_ID,
          projectId: PROJECT_ID,
          revisionNumber: 2,
          status: 'draft',
          sourceType: 'requote',
        },
        impact: mockReconciliation.impact,
      };
      return json(created, 201);
    }

    const approveForProductionRegex =
      /^\/projects\/([^/]+)\/designs\/([^/]+)\/revisions\/([^/]+):approve-for-production$/;
    if (approveForProductionRegex.test(path) && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { quoteRevisionId?: string };
      if (!body.quoteRevisionId) {
        return apiError(400, 'BAD_REQUEST', 'quoteRevisionId exacto es obligatorio');
      }
      if (options.approveResponse) return options.approveResponse();
      return json({ ...mockRevision1, status: 'approved', approved_at: '2026-09-05T10:00:00Z' });
    }
    // The generic lifecycle approve must NEVER be called by this workspace.
    const approveRegex = /^\/designs\/([^/]+)\/revisions\/([^/]+):approve$/;
    if (approveRegex.test(path) && method === 'POST') {
      return apiError(404, 'NOT_FOUND', 'generic approve must not be used by #502');
    }

    if (path === `/projects/${PROJECT_ID}/production-releases` && method === 'POST') {
      if (options.releaseResponse) return options.releaseResponse();
      const created: ProductionRelease = {
        ...mockReleases[0]!,
        id: '99999999-0000-4000-8000-000000000002',
        release_number: releases.length + 1,
      };
      return json(created, 201);
    }

    if (path === `/projects/${PROJECT_ID}/quote-revisions` && method === 'POST') {
      if (options.createInitialQuoteResponse) return options.createInitialQuoteResponse();
      const created = {
        id: QUOTE_1_ID,
        projectId: PROJECT_ID,
        revisionNumber: 1,
        status: 'draft',
        sourceType: 'manual',
        createdBy: '66666666-0000-4000-8000-000000000001',
      };
      return json(created, 201);
    }

    const publishQuoteRegex = /^\/projects\/([^/]+)\/quote-revisions\/([^/]+):publish$/;
    const publishQuoteMatch = path.match(publishQuoteRegex);
    if (publishQuoteMatch && method === 'POST') {
      if (options.publishQuoteResponse) return options.publishQuoteResponse();
      const revId = publishQuoteMatch[2]!;
      return json({
        id: revId,
        projectId: PROJECT_ID,
        revisionNumber: 1,
        status: 'published',
        sourceType: 'manual',
        createdBy: '66666666-0000-4000-8000-000000000001',
      });
    }

    const acceptQuoteRegex = /^\/projects\/([^/]+)\/quote-revisions\/([^/]+):accept$/;
    const acceptQuoteMatch = path.match(acceptQuoteRegex);
    if (acceptQuoteMatch && method === 'POST') {
      if (options.acceptQuoteResponse) return options.acceptQuoteResponse();
      const revId = acceptQuoteMatch[2]!;
      return json({
        id: revId,
        projectId: PROJECT_ID,
        revisionNumber: 2,
        status: 'accepted',
        sourceType: 'requote',
        createdBy: '66666666-0000-4000-8000-000000000001',
      });
    }

    return apiError(404, 'NOT_FOUND', `Unhandled ${method} ${path}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderScreen(props: {
  initialContext?: ProjectReconciliationContextState | null;
  onContextChange?: (ctx: ProjectReconciliationContextState) => void;
  canRequote?: boolean;
  canApprove?: boolean;
  canRelease?: boolean;
  canMutateQuote?: boolean;
  canAcceptQuote?: boolean;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const keys = projectReconciliationQueryKeys(['session', 'scope-a'], PROJECT_ID);

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectReconciliationScreen
        baseUrl={API}
        token="test-jwt-token"
        projectId={PROJECT_ID}
        queryKeys={keys}
        initialContext={props.initialContext}
        onContextChange={props.onContextChange}
        canRequote={props.canRequote ?? true}
        canApprove={props.canApprove ?? true}
        canRelease={props.canRelease ?? true}
        canMutateQuote={props.canMutateQuote ?? true}
        canAcceptQuote={props.canAcceptQuote ?? true}
      />
    </QueryClientProvider>,
  );
}

describe('ProjectReconciliationScreen (#502 / WEB-DT-3)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('query keys carry session scope, project and exact Q/R context', () => {
    const keys = projectReconciliationQueryKeys(['session', 'gen-1', 'org-1'], PROJECT_ID);
    expect(keys.root).toEqual(['project-reconciliation', 'session', 'gen-1', 'org-1', PROJECT_ID]);
    expect(keys.reconciliation('q1', 'r1')).not.toEqual(keys.reconciliation('q2', 'r1'));
    expect(keys.reconciliation('q1', 'r1')).not.toEqual(keys.reconciliation('q1', 'r2'));
  });

  it('renders exact Q1/R1 header with server statuses and contextual release badge', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('exact-context-header')).toHaveTextContent('R1');
    });
    expect(screen.getByTestId('exact-context-header')).toHaveTextContent('Q1');
    expect(screen.getByTestId('exact-context-header')).toHaveTextContent('Aceptada');
    expect(screen.getByTestId('exact-context-header')).toHaveTextContent('R1');
    // Contextual release only matches the exact Q2+R1 pins of the fixture.
    expect(screen.queryByTestId('contextual-release-badge')).toBeNull();
  });

  it('shows the contextual release badge when pins match exactly', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_2_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('contextual-release-badge')).toBeVisible();
    });
    expect(screen.getByTestId('contextual-release-badge')).toHaveTextContent('#1');
  });

  it('renders server reconciliation summary and unit rows keyed by furnitureInstanceId without reclassifying', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('reconciliation-items-table')).toBeVisible();
    });

    // Summary counts are server-owned and rendered verbatim.
    expect(screen.getByTestId('summary-synced')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-modified')).toHaveTextContent('3');
    expect(screen.getByTestId('summary-quoted-not-modeled')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-modeled-not-quoted')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-conflict')).toHaveTextContent('1');

    // One row per physical unit identity, never per difference.
    const rows = screen.getAllByTestId(/^reconciliation-item-/);
    expect(rows).toHaveLength(6);
    expect(screen.getByTestId(`reconciliation-item-${FI_SYNCED}`)).toHaveTextContent('Sincronizado');
    expect(screen.getByTestId(`reconciliation-item-${FI_QUOTED_NOT_MODELED}`)).toHaveTextContent('Cotizado no modelado');
    expect(screen.getByTestId(`reconciliation-item-${FI_MODELED_NOT_QUOTED}`)).toHaveTextContent('Modelado no cotizado');
    expect(screen.getByTestId(`reconciliation-item-${FI_CONFLICT}`)).toHaveTextContent('Conflicto');

    // Impact chips mirror the server booleans verbatim (no client inference):
    // commercial+manufacturing, spatial-only.
    expect(screen.getByTestId(`impact-${FI_MODIFIED}`).textContent).toBe('Comercial + Fabricación');
    expect(screen.getByTestId(`impact-${FI_SPATIAL}`).textContent).toBe('Espacial');

    // Differences: friendly label + values + canonical path kept for audit.
    const modifiedRow = screen.getByTestId(`reconciliation-item-${FI_MODIFIED}`);
    expect(modifiedRow).toHaveTextContent('Parámetro widthMm');
    expect(modifiedRow).toHaveTextContent('600 → 650');
    expect(modifiedRow).toHaveTextContent('parameters.widthMm');
  });

  it('marks a historical comparison when either pinned revision is superseded', async () => {
    setupFetchMock({
      quoteRevisions: [
        { ...mockQuoteRevisions[0]!, status: 'superseded' },
      ],
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('historical-comparison-note')).toBeVisible();
    });
  });

  it('fails closed on an explicit quote revision that does not exist (never retargets)', async () => {
    setupFetchMock();
    renderScreen({
      initialContext: {
        quoteRevisionId: 'eeeeeeee-0000-4000-8000-00000000000e',
        designId: DESIGN_1_ID,
        designRevisionId: REV_1_ID,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('invalid-quote-notice')).toBeVisible();
    });
    expect(screen.queryByTestId('reconciliation-items-table')).toBeNull();
  });

  it('fails closed on an explicit design that does not exist', async () => {
    setupFetchMock();
    renderScreen({
      initialContext: {
        quoteRevisionId: QUOTE_1_ID,
        designId: 'dddddddd-0000-4000-8000-00000000000d',
        designRevisionId: REV_1_ID,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('invalid-design-notice')).toBeVisible();
    });
  });

  it('fails closed on a revision that belongs to another design', async () => {
    setupFetchMock({
      revisionsByDesign: {
        // R1 exists only under DESIGN_2 — pinning it under DESIGN_1 must fail.
        [DESIGN_1_ID]: [mockRevision2],
        [DESIGN_2_ID]: [mockRevision1],
      },
    });
    renderScreen({
      initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID },
    });

    await waitFor(() => {
      expect(screen.getByTestId('invalid-revision-notice')).toBeVisible();
    });
    expect(screen.queryByTestId('reconciliation-items-table')).toBeNull();
  });

  it('shows an honest empty state when the project has no quote revisions', async () => {
    setupFetchMock({ quoteRevisions: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Falta contexto para reconciliar')).toBeVisible();
    });
  });

  it('distinguishes reconciliation loading and error states with retry', async () => {
    // Error path with retry available.
    const fetchMock = setupFetchMock({ reconciliationFail: true });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('reconciliation-error')).toBeVisible();
    });
    expect(screen.getByTestId('reconciliation-error')).toHaveTextContent('Error al reconciliar');

    // Retry hits the same authoritative endpoint again.
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input, init]) => {
          const url = String(input instanceof Request ? input.url : input);
          return url.includes('/reconciliation') && init?.method === 'POST';
        }).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it('requote modal offers only server-incorporable units and submits exact base/design ids', async () => {
    const fetchMock = setupFetchMock();
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('reconciliation-items-table')).toBeVisible();
    });

    // canRequote=false in server summary (conflicts) hides the requote button.
    expect(screen.queryByTestId('open-requote-btn')).toBeNull();
  });

  it('requote flow: selection, review copy, success banner and Q1 immutability copy', async () => {
    const cleanReconciliation: ProjectDesignReconciliationResult = {
      ...mockReconciliation,
      summary: { ...mockReconciliation.summary, conflict: 0 },
      items: mockReconciliation.items.filter((i) => i.status !== 'conflict'),
      impact: { ...mockReconciliation.impact, requiresResolution: false, canRequote: true },
    };
    const fetchMock = setupFetchMock({
      reconciliation: { [`${QUOTE_1_ID}:${REV_1_ID}`]: cleanReconciliation },
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('open-requote-btn')).toBeVisible();
    });
    await userEvent.click(screen.getByTestId('open-requote-btn'));

    const modal = screen.getByTestId('requote-review-modal');
    expect(modal).toHaveTextContent('La cotización Q1 (Aceptada) no será modificada');
    expect(modal).toHaveTextContent('Se creará');

    // Only incorporable units are offered (modified+commercial, modeled_not_quoted).
    expect(screen.getByTestId(`requote-select-${FI_MODIFIED}`)).toBeInTheDocument();
    expect(screen.getByTestId(`requote-select-${FI_MODELED_NOT_QUOTED}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`requote-select-${FI_SPATIAL}`)).toBeNull();
    expect(screen.queryByTestId(`requote-select-${FI_SYNCED}`)).toBeNull();
    expect(screen.queryByTestId(`requote-select-${FI_QUOTED_NOT_MODELED}`)).toBeNull();

    // Unselect one incorporable unit — selection is explicit user intent.
    await userEvent.click(screen.getByTestId(`requote-select-${FI_MODELED_NOT_QUOTED}`));

    await userEvent.click(screen.getByTestId('submit-requote'));

    // Command sends exact base + design revision and only the selected unit.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => {
        const url = String(input instanceof Request ? input.url : input);
        return url.includes(':requote') && init?.method === 'POST';
      });
      expect(call).toBeDefined();
      const body = JSON.parse(String(call![1]!.body)) as {
        baseQuoteRevisionId: string;
        designRevisionId: string;
        includeFurnitureInstanceIds?: string[];
      };
      expect(body.baseQuoteRevisionId).toBe(QUOTE_1_ID);
      expect(body.designRevisionId).toBe(REV_1_ID);
      expect(body.includeFurnitureInstanceIds).toEqual([FI_MODIFIED]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('requote-success')).toBeVisible();
    });
    expect(screen.getByTestId('requote-success')).toHaveTextContent('Q2 creada como borrador');
    expect(screen.getByTestId('requote-success')).toHaveTextContent('permanece intacta');
  });

  it('requote stale conflict shows an actionable typed error, never success', async () => {
    const cleanReconciliation: ProjectDesignReconciliationResult = {
      ...mockReconciliation,
      summary: { ...mockReconciliation.summary, conflict: 0 },
      items: mockReconciliation.items.filter((i) => i.status !== 'conflict'),
      impact: { ...mockReconciliation.impact, requiresResolution: false, canRequote: true },
    };
    setupFetchMock({
      reconciliation: { [`${QUOTE_1_ID}:${REV_1_ID}`]: cleanReconciliation },
      requoteResponse: () =>
        apiError(409, 'VERSION_CONFLICT', 'La cotización base quedó desactualizada (hay una revisión más nueva)'),
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('open-requote-btn')).toBeVisible();
    });
    await userEvent.click(screen.getByTestId('open-requote-btn'));
    await userEvent.click(screen.getByTestId('submit-requote'));

    await waitFor(() => {
      expect(screen.getByTestId('command-error-alert')).toBeVisible();
    });
    expect(screen.getByTestId('command-error-alert')).toHaveTextContent('desactualizada');
    expect(screen.queryByTestId('requote-success')).toBeNull();
  });

  it('preflight panel renders the authoritative ready/blocked verdicts with canonical codes', async () => {
    setupFetchMock({
      preflight: { [REV_1_ID]: mockPreflightBlocked, [REV_2_ID]: mockPreflightReady },
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('preflight-status')).toBeVisible();
    });
    expect(screen.getByTestId('preflight-status')).toHaveTextContent('Bloqueado');
    expect(screen.getByTestId('preflight-issues')).toHaveTextContent('invalid_parameters');

    // Switch to R2 (approved, ready preflight).
    await userEvent.selectOptions(screen.getByTestId('design-revision-select'), REV_2_ID);
    await waitFor(() => {
      expect(screen.getByTestId('preflight-status')).toHaveTextContent('Listo para fabricación');
    });
  });

  it('approval: unavailable before published, success only after response, honest failure', async () => {
    const fetchMock = setupFetchMock({
      approveResponse: () => apiError(409, 'CONFLICT', 'la revisión no puede aprobarse desde su estado actual'),
    });
    // R2 is already approved → approval unavailable with explanation.
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_2_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('approval-done')).toBeVisible();
    });
    expect(screen.getByTestId('approve-revision-btn')).toBeDisabled();

    // Switch to R1 (published) → approval available.
    await userEvent.selectOptions(screen.getByTestId('design-revision-select'), REV_1_ID);
    await waitFor(() => {
      expect(screen.getByTestId('approval-pending')).toBeVisible();
    });
    expect(screen.getByTestId('approve-revision-btn')).toBeEnabled();

    // Server rejects → honest failure, no success banner, UI stays unapproved.
    await userEvent.click(screen.getByTestId('approve-revision-btn'));
    await waitFor(() => {
      expect(screen.getAllByTestId('command-error-alert').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('approval-success')).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('approval success renders only after the authoritative response', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('approve-revision-btn')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('approve-revision-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('approval-success')).toBeVisible();
    });
    expect(screen.getByTestId('approval-success')).toHaveTextContent('R1 aprobada');
  });

  it('release: gated until approval + review modal + success pins, and blocked preflight surfaces issues', async () => {
    const fetchMock = setupFetchMock({
      preflight: { [REV_1_ID]: mockPreflightReady, [REV_2_ID]: mockPreflightReady },
    });
    // R1 published → release unavailable with reason.
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('release-approval-hint')).toBeVisible();
    });
    expect(screen.getByTestId('open-release-review-btn')).toBeDisabled();

    // Revisions must be loaded (header shows the pinned R1) before switching.
    await waitFor(() => {
      expect(screen.getByTestId('exact-context-header')).toHaveTextContent('R1');
    });
    // Switch to approved R2 → release review available.
    await userEvent.selectOptions(screen.getByTestId('design-revision-select'), REV_2_ID);
    await waitFor(() => {
      expect(screen.getByTestId('open-release-review-btn')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('open-release-review-btn'));

    const modal = screen.getByTestId('release-review-modal');
    expect(modal).toHaveTextContent('quedará fijada para siempre');
    expect(modal).toHaveTextContent('Q1 · Aceptada');
    expect(modal).toHaveTextContent('R2');

    await userEvent.click(screen.getByTestId('submit-release'));

    const call = fetchMock.mock.calls.find(([input, init]) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.endsWith('/production-releases') && init?.method === 'POST';
    });
    expect(call).toBeDefined();
    const body = JSON.parse(String(call![1]!.body)) as {
      design_revision_id: string;
      quote_revision_id: string | null;
    };
    expect(body.design_revision_id).toBe(REV_2_ID);
    expect(body.quote_revision_id).toBe(QUOTE_1_ID);

    await waitFor(() => {
      expect(screen.getByTestId('release-success')).toBeVisible();
    });
    expect(screen.getByTestId('release-success')).toHaveTextContent('Liberación #2 creada');
  });

  it('release failure shows the typed preflight blocker issues, never a fake release', async () => {
    setupFetchMock({
      preflight: { [REV_1_ID]: mockPreflightReady, [REV_2_ID]: mockPreflightReady },
      releaseResponse: () =>
        apiError(409, 'CONFLICT', 'el preflight de fabricación bloqueó el release', {
          blocker: 'manufacturing_preflight_blocked',
          issues: [
            {
              code: 'invalid_parameters',
              furnitureInstanceId: FI_MODIFIED,
              furnitureDefinitionId: '88888888-0000-4000-8000-000000000002',
              parameter: 'widthMm',
              message: 'type: expected number',
            },
          ],
        }),
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_2_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('open-release-review-btn')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('open-release-review-btn'));
    await userEvent.click(screen.getByTestId('submit-release'));

    await waitFor(() => {
      expect(screen.getByTestId('release-preflight-issues')).toBeVisible();
    });
    expect(screen.getByTestId('release-preflight-issues')).toHaveTextContent('invalid_parameters');
    expect(screen.queryByTestId('release-success')).toBeNull();
  });

  it('release panel is blocked client-side when the authoritative preflight is blocked', async () => {
    setupFetchMock({
      preflight: { [REV_1_ID]: mockPreflightReady, [REV_2_ID]: mockPreflightBlocked },
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_2_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('preflight-status')).toHaveTextContent('Bloqueado');
    });
    expect(screen.getByTestId('open-release-review-btn')).toBeDisabled();
    expect(screen.getByTestId('release-hint')).toHaveTextContent('bloquea');
  });

  it('preflight renders the server summary projection without manufacturing detail for non-manufacturing roles', async () => {
    setupFetchMock({
      preflight: {
        [REV_1_ID]: {
          ...mockPreflightBlocked,
          includesDetail: false,
          items: [],
          issues: [],
        },
        [REV_2_ID]: mockPreflightReady,
      },
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('preflight-status')).toHaveTextContent('Bloqueado');
    });
    // Business-safe server message + count; NO manufacturing internals leak.
    expect(screen.getByTestId('preflight-message')).toHaveTextContent(/bloquea la revisión/);
    expect(screen.getByTestId('preflight-detail-restricted')).toHaveTextContent(/roles de fabricación/);
    expect(screen.queryByTestId('preflight-issues')).toBeNull();
    expect(screen.queryByText('invalid_parameters')).toBeNull();
  });

  it('approval shows the exact-quote gate context and blocks on a non-accepted baseline hint', async () => {
    setupFetchMock({
      quoteRevisions: [
        { ...mockQuoteRevisions[0]!, status: 'draft' },
        { ...mockQuoteRevisions[1]! },
      ],
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('exact-context-header')).toHaveTextContent('R1');
    });
    await expect(screen.getByTestId('exact-context-header')).toHaveTextContent(/Borrador/);
    await expect(screen.getByTestId('approval-quote-hint')).toBeVisible();
    // The approve command still runs (server authority); the hint explains
    // the typed rejection that is coming — no client-side eligibility
    // invention.
    await expect(screen.getByTestId('approval-pending')).toHaveTextContent(/Q1/);
  });

  it('approval is disabled when the authoritative preflight is blocked', async () => {
    setupFetchMock({
      preflight: { [REV_1_ID]: mockPreflightBlocked, [REV_2_ID]: mockPreflightReady },
    });
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('preflight-status')).toHaveTextContent('Bloqueado');
    });
    await waitFor(() => {
      expect(screen.getByTestId('exact-context-header')).toHaveTextContent('R1');
    });
    expect(screen.getByTestId('approve-revision-btn')).toBeDisabled();
    await expect(screen.getByTestId('approval-preflight-hint')).toBeVisible();
  });

  it('release requires an accepted commercial baseline (mandatory exact pin)', async () => {
    setupFetchMock({
      quoteRevisions: [
        { ...mockQuoteRevisions[0]!, status: 'draft' },
      ],
    });
    // R2 is already approved, but the selected quote is a draft: the release
    // must stay unavailable with the exact-baseline reason.
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_2_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('exact-context-header')).toHaveTextContent('R2');
    });
    expect(screen.getByTestId('open-release-review-btn')).toBeDisabled();
    await expect(screen.getByTestId('release-quote-hint')).toBeVisible();
    await expect(screen.getByTestId('release-quote-pin-note')).toHaveTextContent(/no aceptada/);
  });

  it('release history keeps historical pins visible with server staleness, never collapsing to latest', async () => {
    setupFetchMock();
    renderScreen({ initialContext: { quoteRevisionId: QUOTE_2_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID } });

    await waitFor(() => {
      expect(screen.getByTestId('release-history-table')).toBeVisible();
    });

    // P1 stays pinned to Q2+R1 (exact pins) and shows server staleness vs R2.
    const row = screen.getByTestId('release-row-1');
    expect(row).toHaveTextContent('Q2 + R1');
    expect(row).toHaveTextContent('Stale');
    expect(row).toHaveTextContent('R2');

    // Latest note is informational only, contextual badge is the exact match.
    expect(screen.getByTestId('latest-release-note')).toHaveTextContent('informativo');
    expect(screen.getByTestId('contextual-release-badge')).toHaveTextContent('#1');
  });

  it('permission hints disable approve/release for roles without the capability', async () => {
    setupFetchMock();
    renderScreen({
      initialContext: { quoteRevisionId: QUOTE_1_ID, designId: DESIGN_1_ID, designRevisionId: REV_1_ID },
      canApprove: false,
      canRelease: false,
    });

    await waitFor(() => {
      expect(screen.getByTestId('exact-context-header')).toHaveTextContent('R1');
    });
    expect(screen.getByTestId('approval-pending')).toBeVisible();
    expect(screen.getByTestId('approve-revision-btn')).toBeDisabled();
    expect(screen.getByTestId('approval-permission-hint')).toBeVisible();
    expect(screen.getByTestId('release-permission-hint').textContent ?? '').toMatch(/no incluye/);
  });

  it('forbidden project load renders an explicit permission error', async () => {
    setupFetchMock();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => apiError(403, 'FORBIDDEN', 'no tenés permiso')),
    );
    renderScreen();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeVisible();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('No tenés permiso');
  });
});

describe('reconciliationWorkspace pure model (#502)', () => {
  it('isIncorporableChange mirrors the generated contract rule from server booleans only', () => {
    expect(isIncorporableChange({ status: 'modeled_not_quoted', impact: noImpact, differences: [] } as never)).toBe(
      true,
    );
    expect(
      isIncorporableChange({
        status: 'modified',
        impact: { commercial: true, manufacturing: true, spatial: false },
        differences: [],
      } as never),
    ).toBe(true);
    expect(
      isIncorporableChange({
        status: 'modified',
        impact: { commercial: false, manufacturing: false, spatial: true },
        differences: [],
      } as never),
    ).toBe(false);
    expect(isIncorporableChange({ status: 'synced', impact: noImpact, differences: [] } as never)).toBe(false);
    expect(isIncorporableChange({ status: 'conflict', impact: noImpact, differences: [] } as never)).toBe(false);
  });

  it('findContextualRelease matches exact pins only — no latest fallback', () => {
    const release = mockReleases[0]!;
    expect(findContextualRelease([release], QUOTE_2_ID, REV_1_ID)?.id).toBe(release.id);
    expect(findContextualRelease([release], QUOTE_1_ID, REV_1_ID)).toBeNull();
    expect(findContextualRelease([release], QUOTE_2_ID, REV_2_ID)).toBeNull();
    expect(findContextualRelease([], QUOTE_2_ID, REV_1_ID)).toBeNull();
  });

  it('formatDifferencePath is copy-only and keeps the canonical path for audit', () => {
    expect(formatDifferencePath('parameters.widthMm')).toBe('Parámetro widthMm');
    expect(formatDifferencePath('materialChoices.BODY')).toBe('Material (BODY)');
    expect(formatDifferencePath('transform.translationMm')).toBe('Posición (translationMm)');
    expect(formatDifferencePath('furnitureDefinitionId')).toBe('Definición de mueble');
    expect(formatDifferencePath('some.unknown.path')).toBe('some.unknown.path');
  });

  it('isHistoricalComparison reads server statuses only', () => {
    expect(isHistoricalComparison('superseded', 'published')).toBe(true);
    expect(isHistoricalComparison('accepted', 'superseded')).toBe(true);
    expect(isHistoricalComparison('accepted', 'published')).toBe(false);
  });

  it('maps typed command errors without a generic catch-all', () => {
    const apiErrorOf = (code: ApiError['code'], details: unknown): GraneteApiError =>
      new GraneteApiError(403, {
        code,
        message: code,
        fieldErrors: {},
        requestId: 'r',
        retryable: false,
        details: details as Record<string, unknown>,
      });

    expect(describeCommandError(apiErrorOf('FORBIDDEN', {})).kind).toBe('forbidden');
    expect(describeCommandError(apiErrorOf('STEP_UP_REQUIRED', { scope: 'design.approve' })).message).toContain(
      'step-up',
    );
    expect(describeCommandError(new TypeError('fetch failed')).kind).toBe('network');
  });
});

describe('Quote revision lifecycle UI (#571 / WEB-DT-4)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders create-initial-quote-btn when project has no quote revisions and creates Q1', async () => {
    const fetchMock = setupFetchMock({ quoteRevisions: [] });
    renderScreen({ canMutateQuote: true });

    await waitFor(() => {
      expect(screen.getByTestId('create-initial-quote-btn')).toBeVisible();
    });
    expect(screen.getByText('Esta obra no tiene revisiones de cotización todavía.')).toBeVisible();

    await userEvent.click(screen.getByTestId('create-initial-quote-btn'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/projects/${PROJECT_ID}/quote-revisions`),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('disables create-initial-quote-btn with permission hint when canMutateQuote is false', async () => {
    setupFetchMock({ quoteRevisions: [] });
    renderScreen({ canMutateQuote: false });

    await waitFor(() => {
      expect(screen.getByTestId('create-initial-quote-btn')).toBeDisabled();
    });
    expect(screen.getByTestId('create-quote-permission-hint')).toBeVisible();
  });

  it('renders QuoteLifecyclePanel with publish button for draft revision and publishes it', async () => {
    const draftQuote: QuoteRevisionDetail = {
      ...mockQuoteRevisions[1]!,
      revisionNumber: 2,
      status: 'draft',
    };
    const fetchMock = setupFetchMock({ quoteRevisions: [mockQuoteRevisions[0]!, draftQuote] });
    renderScreen({
      initialContext: { quoteRevisionId: draftQuote.id, designId: DESIGN_1_ID, designRevisionId: REV_1_ID },
      canMutateQuote: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId('quote-lifecycle-panel')).toBeVisible();
    });
    expect(screen.getByTestId('quote-draft-hint')).toBeVisible();
    expect(screen.getByTestId('publish-quote-btn')).toBeEnabled();

    await userEvent.click(screen.getByTestId('publish-quote-btn'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/projects/${PROJECT_ID}/quote-revisions/${draftQuote.id}:publish`),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('renders accept button for published revision, opens confirmation modal, and accepts', async () => {
    const publishedQuote: QuoteRevisionDetail = {
      ...mockQuoteRevisions[1]!,
      revisionNumber: 2,
      status: 'published',
    };
    const fetchMock = setupFetchMock({ quoteRevisions: [mockQuoteRevisions[0]!, publishedQuote] });
    renderScreen({
      initialContext: { quoteRevisionId: publishedQuote.id, designId: DESIGN_1_ID, designRevisionId: REV_1_ID },
      canAcceptQuote: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId('quote-lifecycle-panel')).toBeVisible();
    });
    expect(screen.getByTestId('quote-published-hint')).toBeVisible();
    expect(screen.getByTestId('accept-quote-btn')).toBeEnabled();

    // Open confirmation modal
    await userEvent.click(screen.getByTestId('accept-quote-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('accept-quote-modal')).toBeVisible();
    });
    expect(screen.getByTestId('accept-quote-supersede-warning')).toHaveTextContent('Q1');

    // Confirm acceptance
    await userEvent.click(screen.getByTestId('confirm-accept-quote-btn'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/projects/${PROJECT_ID}/quote-revisions/${publishedQuote.id}:accept`),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows permission hint when role cannot accept quote revisions', async () => {
    const publishedQuote: QuoteRevisionDetail = {
      ...mockQuoteRevisions[1]!,
      revisionNumber: 2,
      status: 'published',
    };
    setupFetchMock({ quoteRevisions: [mockQuoteRevisions[0]!, publishedQuote] });
    renderScreen({
      initialContext: { quoteRevisionId: publishedQuote.id, designId: DESIGN_1_ID, designRevisionId: REV_1_ID },
      canAcceptQuote: false,
    });

    await waitFor(() => {
      expect(screen.getByTestId('accept-quote-btn')).toBeDisabled();
    });
    expect(screen.getByTestId('quote-accept-forbidden-hint')).toBeVisible();
  });
});
