import { createHash } from 'node:crypto';
import { expect, test, type Page, type Request, type Response } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #460 browser proof: the only synthetic response is the first exact quote
 * revision GET. Refresh and the replay remain real requests to Go/PostgreSQL.
 */
const PROJECT_ID = '46000000-0000-4000-8000-000000000460';
const QUOTE_LINE_ID = '46000000-0000-4000-8000-000000000461';
const CUSTOMER_ID = '46000000-0000-4000-8000-000000000462';
const PROJECT_NAME = 'Obra Refresh Quote E2E';

type RequestEvidence = {
  readonly ordinal: number;
  readonly method: string;
  readonly status: number;
  readonly authorizationPresent: boolean;
  readonly bearerFingerprint: string | null;
};

type BrowserTransportEvidence = {
  readonly url: string;
  readonly method: string;
  readonly authorizationPresent: boolean;
  readonly bearerJti: string | null;
};

function bearerFingerprint(request: Request): string | null {
  const authorization = request.headers().authorization;
  if (!authorization?.startsWith('Bearer ')) return null;
  // A short SHA-256 digest distinguishes rotations without emitting credentials.
  return createHash('sha256').update(authorization).digest('hex').slice(0, 12);
}

function quoteEndpoint(): string {
  return `${required('ORGANIZATION_API_BASE')}/projects/${PROJECT_ID}/quote-revisions`;
}

async function installSanitizedTransportProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type ProbeWindow = Window & {
      __graneteQuoteAuthTrace?: Array<{
        url: string;
        method: string;
        authorizationPresent: boolean;
        bearerJti: string | null;
      }>;
    };
    const probeWindow = window as ProbeWindow;
    (probeWindow as ProbeWindow & { __graneteBrowserTestSeam?: boolean }).__graneteBrowserTestSeam = true;
    const originalFetch = window.fetch.bind(window);
    probeWindow.__graneteQuoteAuthTrace = [];
    const readJti = (authorization: string | null): string | null => {
      if (!authorization?.startsWith('Bearer ')) return null;
      try {
        const payload = authorization.slice(7).split('.')[1];
        if (!payload) return null;
        return (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { jti?: unknown }).jti
          ?.toString() ?? null;
      } catch {
        return null;
      }
    };
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (/\/projects\/46000000-0000-4000-8000-000000000460\/quote-revisions$/.test(url) && method === 'GET') {
        const authorization = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('authorization');
        probeWindow.__graneteQuoteAuthTrace?.push({
          url,
          method,
          authorizationPresent: authorization !== null,
          bearerJti: readJti(authorization),
        });
      }
      return originalFetch(input, init);
    };
  });
}

async function readTransportProbe(page: Page): Promise<BrowserTransportEvidence[]> {
  return page.evaluate(() => (window as Window & { __graneteQuoteAuthTrace?: BrowserTransportEvidence[] }).__graneteQuoteAuthTrace ?? []);
}

async function resetTransportProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __graneteQuoteAuthTrace?: BrowserTransportEvidence[] }).__graneteQuoteAuthTrace = [];
  });
}

function observeQuoteRequests(
  page: Page,
  firstOrdinal = 1,
  ignoreRequest?: () => Request | null,
): RequestEvidence[] {
  const evidence: RequestEvidence[] = [];
  page.on('response', (response: Response) => {
    const request = response.request();
    if (request.url() !== quoteEndpoint() || request.method() !== 'GET') return;
    if (request === ignoreRequest?.()) return;
    evidence.push({
      ordinal: firstOrdinal + evidence.length,
      method: request.method(),
      status: response.status(),
      authorizationPresent: request.headers().authorization !== undefined,
      bearerFingerprint: bearerFingerprint(request),
    });
  });
  return evidence;
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

async function prepareQuoteFixture(): Promise<void> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });
  const catalog = await repository.getCatalog();
  const module = catalog.modules.find((candidate) => candidate.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  await repository.saveCatalog({
    ...catalog,
    customers: [
      ...(catalog.customers ?? []).filter((customer) => customer.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: 'Cliente Refresh Quote E2E', active: true },
    ],
  });
  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: PROJECT_NAME,
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    items: [{ id: QUOTE_LINE_ID, moduleId: module.id, quantity: 1, optionChoices: {} }],
  });
  await client.materializeQuoteLineFurniture(owner.token, PROJECT_ID, QUOTE_LINE_ID, 'gate-460-materialize');
  const q1 = await client.createInitialProjectQuoteRevision(
    owner.token,
    PROJECT_ID,
    { notes: 'Prueba E2E de refresh de lectura' },
    'gate-460-q1-create',
  );
  await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'gate-460-q1-publish');
  await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'gate-460-q1-accept');
}

test.describe.serial('#460 generated quote read refresh replay', () => {
  test.beforeAll(async () => {
    await prepareQuoteFixture();
  });

  test('natural read is classified before a deterministic 401 proves one real refresh and replay', async ({ page }) => {
    test.setTimeout(120_000);
    await installSanitizedTransportProbe(page);
    await loginToA(page);

    // Natural observation: no interception and no induced expiry/race.
    const natural = observeQuoteRequests(page);
    await page.goto(`/quotes/${PROJECT_ID}`);
    await expect(page.getByTestId('project-detail')).toBeVisible();
    await expect(page.getByTestId('quote-revision-badge')).toContainText('Q1');
    await expect.poll(() => natural.length).toBe(1);
    expect(natural).toEqual([
      expect.objectContaining({ ordinal: 1, method: 'GET', status: 200, authorizationPresent: true }),
    ]);
    const naturalTransport = await readTransportProbe(page);
    expect(naturalTransport).toContainEqual(expect.objectContaining({ authorizationPresent: true, bearerJti: expect.any(String) }));

    // Deterministic transport barrier: only this exact first GET is synthetic.
    // /auth/refresh and the retry stay un-routed and therefore hit Go + the
    // gate's disposable PostgreSQL database.
    await resetTransportProbe(page);
    let controlledFirstGet: RequestEvidence | null = null;
    let controlledRequest: Request | null = null;
    let controlledRequestFailure: string | null = null;
    const replayBackendResponses = observeQuoteRequests(page, 2, () => controlledRequest);
    let refreshCount = 0;
    const refreshStatuses: number[] = [];
    let refreshedBearerFingerprint: string | null = null;
    page.on('response', (response: Response) => {
      const request = response.request();
      if (request.url() !== `${required('ORGANIZATION_API_BASE')}/auth/refresh` || request.method() !== 'POST') return;
      refreshCount += 1;
      refreshStatuses.push(response.status());
      void response.json().then((body: { token?: string }) => {
        refreshedBearerFingerprint = body.token
          ? createHash('sha256').update(`Bearer ${body.token}`).digest('hex').slice(0, 12)
          : null;
      });
    });
    await page.route(quoteEndpoint(), async (route) => {
      const request = route.request();
      expect(request.method()).toBe('GET');
      controlledRequest = request;
      controlledFirstGet = {
        ordinal: 1,
        method: request.method(),
        status: 401,
        authorizationPresent: request.headers().authorization !== undefined,
        bearerFingerprint: bearerFingerprint(request),
      };
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'controlled first quote read' }),
      });
      controlledRequestFailure = request.failure()?.errorText ?? null;
    }, { times: 1 });

    await expect.poll(() => page.evaluate(() =>
      typeof (window as Window & { __graneteRefetchQuoteRevisionsForTest?: unknown })
        .__graneteRefetchQuoteRevisionsForTest,
    )).toBe('function');
    await page.evaluate(() =>
      (window as Window & { __graneteRefetchQuoteRevisionsForTest: () => Promise<unknown> })
        .__graneteRefetchQuoteRevisionsForTest(),
    );
    await expect(page.getByTestId('project-detail')).toBeVisible();
    await expect(page.getByTestId('quote-revision-badge')).toContainText('Q1');
    await expect.poll(
      () => ({ quoteRequests: controlledFirstGet ? [controlledFirstGet, ...replayBackendResponses] : [], refreshCount, refreshStatuses, refreshedBearerFingerprint }),
      { message: 'sanitized quote refresh trace' },
    ).toEqual({
      quoteRequests: expect.arrayContaining([
        expect.objectContaining({ ordinal: 1, status: 401 }),
        expect.objectContaining({ ordinal: 2, status: 200 }),
      ]),
      refreshCount: 1,
      refreshStatuses: [200],
      refreshedBearerFingerprint: expect.any(String),
    });
    if (controlledFirstGet === null) throw new Error('controlled first quote GET was not observed');
    expect(controlledRequestFailure).toBeNull();
    const replay = [controlledFirstGet, ...replayBackendResponses];
    expect(replay).toEqual([
      expect.objectContaining({ ordinal: 1, method: 'GET', status: 401, authorizationPresent: true }),
      expect.objectContaining({ ordinal: 2, method: 'GET', status: 200, authorizationPresent: true }),
    ]);
    expect(refreshCount).toBe(1);
    expect(refreshStatuses).toEqual([200]);
    expect(replay[0]!.bearerFingerprint).not.toBeNull();
    const transport = await readTransportProbe(page);
    expect(transport).toEqual([
      expect.objectContaining({ method: 'GET', authorizationPresent: true, bearerJti: expect.any(String) }),
      expect.objectContaining({ method: 'GET', authorizationPresent: true, bearerJti: expect.any(String) }),
    ]);
    expect(transport[1]!.bearerJti).not.toBe(transport[0]!.bearerJti);
    expect(replay).toHaveLength(2); // no third replay
    await expect(page.getByRole('button', { name: 'Iniciar Sesión' })).toHaveCount(0);
    await expect(page.getByText('controlled first quote read')).toHaveCount(0);
  });
});
