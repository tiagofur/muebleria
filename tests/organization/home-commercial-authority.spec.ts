import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required } from './support/api';

/**
 * #642 first delivery — browser E2E against the real Go backend +
 * PostgreSQL (no mocks for the pass criteria; network interception only
 * injects the summaries request failure in the error case).
 *
 * Proves the INICIO recent cards consume the same batch
 * commercial-summaries authority the Cotizaciones list already uses:
 *   - Q1 accepted through canonical API commands (Project stays `draft`)
 *     shows `Q1 · Aceptada` + the exact frozen total on BOTH surfaces —
 *     never the operative Project.status, a live-catalog estimate or
 *     priceSnapshot;
 *   - the recent card navigates to the project detail (no promise of a
 *     specific revision);
 *   - mutable project/customer rows keep being ignored (frozen identity)
 *     and a Q2 accepted afterwards wins on Inicio exactly as on the list;
 *   - a failed summaries request is an error state with retry on Inicio —
 *     never "Sin cotización" — and the visible Reintentar button performs the
 *     real recovery (no reload/navigation/re-login);
 *   - the recovered state restores Q2 and its authoritative exact total.
 */

const PROJECT_ID = '99999999-6666-4699-8999-666666666666';
const QUOTE_LINE_ID = 'aaaa8888-6666-48aa-8aaa-666666666666';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000099';
const REC_HW = '72000000-0000-4000-8000-000000000071';
const REC_STRUCT = '72000000-0000-4000-8000-000000000072';
const ORIGINAL_PROJECT_NAME = 'Obra Autoridad Inicio E2E';
const RENAMED_PROJECT_NAME = 'Obra RENOMBRADA Inicio E2E';
const FROZEN_CUSTOMER_NAME = 'Cliente Autoridad Inicio E2E';
const RENAMED_CUSTOMER_NAME = 'Cliente RENOMBRADO Inicio E2E';
const SCREENSHOT_DIR = 'test-results/issue-642-home';
const REC_CHOICES = {};

interface HomeFixture {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  readonly instanceId: string;
  readonly depthMm: number;
  q1Id: string;
  q2Id: string;
  readonly token: string;
}

let seeded: HomeFixture;
/** Authoritative Q2 total as displayed — set by test 2, reused by test 3. */
let authoritativeQ2Price = '';

async function prepareHomeFixture(): Promise<HomeFixture> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = aOwner.token;

  const repository = new APIWorkspaceRepository(apiBase, {
    getAccessToken: () => token,
  });
  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  const depthMm = template.externalDims?.depth || 590;
  await repository.saveCatalog({
    ...catalog,
    structures: [...(catalog.structures ?? []), { id: REC_STRUCT, code: 'HOME-STRUCT', name: 'Cuerpo', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
    hardware: [...catalog.hardware, { id: REC_HW, code: 'HOME-HW', name: 'Herraje', unit: 'piece', costPerUnit: 10, active: true }],
    modules: [
      {
        ...template,
        id: GATE_MODULE_A_ID,
        structureId: REC_STRUCT,
        components: [],
        hardwareLines: [{ id: 'home-hardware-line', hardwareId: REC_HW, quantity: 1, optionRole: '' }],
        externalDims: { width: 600, height: 720, depth: depthMm },
      },
    ],
    customers: [
      {
        id: CUSTOMER_ID,
        name: FROZEN_CUSTOMER_NAME,
        active: true,
      },
    ],
  });

  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: ORIGINAL_PROJECT_NAME,
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft' as const,
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: QUOTE_LINE_ID,
        moduleId: GATE_MODULE_A_ID,
        quantity: 1,
        optionChoices: REC_CHOICES,
      },
    ],
  });

  const mat = await client.materializeQuoteLineFurniture(
    token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-hca-mat-quote-line',
  );
  const instanceId = mat.instances[0]!.furniture_instance_id;

  // Design + R1 with a REAL commercial change (600 → 650) so the later Q2
  // requote has a delta the server accepts.
  const design = await client.createProjectDesign(
    token,
    PROJECT_ID,
    { name: 'Cocina Autoridad Inicio' },
    'gate-hca-create-design',
  );
  await putWorkingCopyCurrent(client, token, design.id, {
    items: [
      { furniture_instance_id: instanceId, furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 650, heightMm: 720, depthMm }, material_choices: REC_CHOICES },
    ],
  });
  const r1 = await client.publishDesignRevision(
    token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-hca-publish-r1',
  );

  return {
    projectId: PROJECT_ID,
    designId: design.id,
    r1Id: r1.id,
    instanceId,
    depthMm,
    q1Id: '',
    q2Id: '',
    token,
  };
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.configure({ mode: 'serial' });

test('Inicio matches the Cotizaciones authority for an accepted Q1 (Project stays draft)', async ({ page }) => {
  seeded = await prepareHomeFixture();

  // Canonical commercial lifecycle through the generated API: create →
  // publish → accept Q1. Project.status is never touched.
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  const q1 = await client.createInitialProjectQuoteRevision(seeded.token, seeded.projectId, {}, 'gate-hca-create-q1');
  seeded.q1Id = q1.id;
  await client.publishProjectQuoteRevision(seeded.token, seeded.projectId, seeded.q1Id, 'gate-hca-publish-q1');
  await client.acceptProjectQuoteRevision(seeded.token, seeded.projectId, seeded.q1Id, 'gate-hca-accept-q1');

  await loginToA(page);

  // Authority on the Cotizaciones list…
  await page.goto('/quotes');
  const listCard = page.getByTestId(`project-card-${seeded.projectId}`);
  await expect(listCard).toBeVisible();
  await expect(listCard.getByTestId('commercial-status-badge')).toContainText('Q1 · Aceptada');
  const listPrice = await listCard.locator('.project-card__price-value').textContent();

  // …must be the SAME authority on the Inicio recent card.
  await page.goto('/');
  const homeCard = page.getByTestId(`dashboard-recent-${seeded.projectId}`);
  await expect(homeCard).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/inicio-q1-aceptada.png`, fullPage: false });
  await expect(homeCard.getByTestId('commercial-status-badge')).toContainText('Q1 · Aceptada');
  // The operative Project.status (draft) never labels the commercial card.
  await expect(homeCard.textContent()).resolves.not.toContain('Borrador');
  // Exact frozen total — identical string on both surfaces, with currency.
  await expect(homeCard.locator('.dashboard-recent-card__price')).toHaveText(listPrice ?? '');
  expect(listPrice).toMatch(/\$/);
  await expect(homeCard).toContainText(ORIGINAL_PROJECT_NAME);
  await expect(homeCard).toContainText(FROZEN_CUSTOMER_NAME);

  // The card navigates to the project detail (server resolves the authority
  // there; the route never promises a specific revision).
  await homeCard.click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${seeded.projectId}`));

  // Negative proof (#642): commercial acceptance did NOT write
  // Project.status='accepted' — the client readback keeps draft.
  const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
    getAccessToken: () => seeded.token,
  });
  const projects = await repository.getProjects();
  const stored = projects.find((p) => p.id === seeded.projectId);
  expect(stored?.status).toBe('draft');
});

test('mutable rows stay invisible and an accepted Q2 wins on Inicio exactly as on the list', async ({ page }) => {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);

  // Q2 from Q1 + R1 (design provenance, real delta), then publish/accept.
  const requote = await client.requoteProjectQuote(seeded.token, seeded.projectId, {
    baseQuoteRevisionId: seeded.q1Id,
    designRevisionId: seeded.r1Id,
  }, 'gate-hca-requote-q2');
  seeded.q2Id = requote.quoteRevision.id;
  await client.publishProjectQuoteRevision(seeded.token, seeded.projectId, seeded.q2Id, 'gate-hca-publish-q2');
  await client.acceptProjectQuoteRevision(seeded.token, seeded.projectId, seeded.q2Id, 'gate-hca-accept-q2');

  // Deliberate mutable mutation AFTER Q2: the Inicio card must keep the
  // frozen commercial identity, and its updatedAt bump must not relabel
  // or reprice the card.
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => seeded.token });
  const projects = await repository.getProjects();
  const stored = projects.find((p) => p.id === seeded.projectId);
  if (!stored) throw new Error('fixture project vanished');
  await repository.saveProject({
    ...stored,
    name: RENAMED_PROJECT_NAME,
    status: 'draft' as const,
  });
  const catalog = await repository.getCatalog();
  await repository.saveCatalog({
    ...catalog,
    customers: (catalog.customers ?? []).map((c) =>
      c.id === CUSTOMER_ID ? { ...c, name: RENAMED_CUSTOMER_NAME } : c,
    ),
  });

  await loginToA(page);

  // Inicio follows the new authority…
  await page.goto('/');
  const homeCard = page.getByTestId(`dashboard-recent-${seeded.projectId}`);
  await expect(homeCard).toBeVisible();
  await expect(homeCard.getByTestId('commercial-status-badge')).toContainText('Q2 · Aceptada');
  // …with the frozen identity, not the renamed mutable rows.
  await expect(homeCard).toContainText(ORIGINAL_PROJECT_NAME);
  await expect(homeCard.textContent()).resolves.not.toContain(RENAMED_PROJECT_NAME);
  await expect(homeCard).toContainText(FROZEN_CUSTOMER_NAME);
  await expect(homeCard.textContent()).resolves.not.toContain(RENAMED_CUSTOMER_NAME);

  // List ↔ Inicio parity under the same Q2 authority.
  await page.goto('/quotes');
  const listCard = page.getByTestId(`project-card-${seeded.projectId}`);
  await expect(listCard.getByTestId('commercial-status-badge')).toContainText('Q2 · Aceptada');
  const listPrice = await listCard.locator('.project-card__price-value').textContent();
  authoritativeQ2Price = listPrice ?? '';
  await page.goto('/');
  await expect(
    page.getByTestId(`dashboard-recent-${seeded.projectId}`).locator('.dashboard-recent-card__price'),
  ).toHaveText(authoritativeQ2Price);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/inicio-q2-aceptada.png`, fullPage: false });
});

test('a failed summaries request is an error state on Inicio, never "Sin cotización", and recovers', async ({ page }) => {
  // Network interception ONLY for the failure injection.
  await page.route('**/api/projects/commercial-summaries', (route) => route.abort());
  await loginToA(page);
  await page.goto('/');

  await expect(page.getByTestId('commercial-summaries-error')).toContainText(
    'No se pudo cargar la información comercial.',
  );
  const homeCard = page.getByTestId(`dashboard-recent-${seeded.projectId}`);
  await expect(homeCard).toBeVisible();
  await expect(homeCard.getByTestId('commercial-status-badge-error')).toBeVisible();
  await expect(homeCard.textContent()).resolves.not.toContain('Sin cotización');
  await expect(homeCard.locator('.dashboard-recent-card__price')).toHaveText('—');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/inicio-error-batch.png`, fullPage: false });

  // Recovery THROUGH THE BUTTON: after removing the interception, the visible
  // Reintentar fires the real batch request — no reload, no navigation, no
  // re-login. The response restores the authoritative state on the SAME
  // screen (error state gone, Q2 and its exact total back).
  await page.unroute('**/api/projects/commercial-summaries');
  const summariesResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/projects/commercial-summaries') &&
      response.request().method() === 'GET',
  );
  await page
    .getByTestId('commercial-summaries-error')
    .getByRole('button', { name: 'Reintentar' })
    .click();
  const response = await summariesResponse;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('commercial-summaries-error')).toHaveCount(0);
  const recovered = page.getByTestId(`dashboard-recent-${seeded.projectId}`);
  await expect(recovered.getByTestId('commercial-status-badge')).toContainText('Q2 · Aceptada');
  await expect(recovered.locator('.dashboard-recent-card__price')).toHaveText(authoritativeQ2Price);
});
