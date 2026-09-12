import { mkdir } from 'node:fs/promises';
import { expect, test, type Page, type Request } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #642 / 2A browser E2E against the real Go backend + PostgreSQL (no mocks
 * for the pass criteria; network interception is used ONLY to inject the
 * summaries request failure in the error case).
 *
 * Proves the Cotizaciones LIST consumes the batch commercial-summaries read
 * model as the sole commercial authority:
 *   - Q1 lifecycle executed through the Web UI (create → publish → accept)
 *     invalidates the summaries cache and the list shows `Q1 · Aceptada`
 *     without a manual browser reload;
 *   - Project.status stays `draft` while the card says Aceptada (no second
 *     commercial truth is written);
 *   - the batch is ONE request per dataset lifecycle and the list performs
 *     NO per-card quote-revisions fetch (no N+1);
 *   - Q2 accepted (API lifecycle, project untouched) wins the badge, and the
 *     identity stays FROZEN after mutating the project/customer rows;
 *   - a newer Q3 draft shows as "Q3 en borrador" without becoming authority;
 *   - a failed summaries request shows the error banner — never "Sin
 *     cotización" — and recovers on retry with the real backend;
 *   - badge/total/identity/flow hold at 390 / 768 / 1280 without overflow.
 */

const PROJECT_ID = '77777777-6666-4777-8777-666666666666';
const QUOTE_LINE_ID = '88888888-6666-4888-8888-666666666666';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000066';
const REC_HW = '71000000-0000-4000-8000-000000000061';
const REC_STRUCT = '71000000-0000-4000-8000-000000000062';
const ORIGINAL_PROJECT_NAME = 'Obra Autoridad Lista E2E';
const RENAMED_PROJECT_NAME = 'Obra RENOMBRADA E2E';
const FROZEN_CUSTOMER_NAME = 'Cliente Autoridad Lista E2E';
const RENAMED_CUSTOMER_NAME = 'Cliente RENOMBRADO E2E';
const REC_CHOICES = {};

interface SeedListFixture {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  readonly instanceId: string;
  readonly depthMm: number;
  q1Id: string;
  q2Id: string;
  readonly token: string;
}

let seeded: SeedListFixture;

async function prepareListFixture(): Promise<SeedListFixture> {
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
    structures: [...(catalog.structures ?? []), { id: REC_STRUCT, code: 'LIST-STRUCT', name: 'Cuerpo', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
    hardware: [...catalog.hardware, { id: REC_HW, code: 'LIST-HW', name: 'Herraje', unit: 'piece', costPerUnit: 10, active: true }],
    modules: [
      {
        ...template,
        id: GATE_MODULE_A_ID,
        structureId: REC_STRUCT,
        components: [],
        hardwareLines: [{ id: 'list-hardware-line', hardwareId: REC_HW, quantity: 1, optionRole: '' }],
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
    'gate-qla-mat-quote-line',
  );
  const instanceId = mat.instances[0]!.furniture_instance_id;

  // Design + R1 so the Q2 requote (which requires design provenance) is
  // available to the second act of the story.
  const design = await client.createProjectDesign(
    token,
    PROJECT_ID,
    { name: 'Cocina Autoridad Lista' },
    'gate-qla-create-design',
  );
  // R1 carries a REAL commercial change (unit width 600 → 650) so the Q2
  // requote has something to incorporate: the server refuses requotes with
  // zero commercial delta ("no se crea una nueva cotización").
  await client.updateDesignWorkingCopy(token, design.id, {
    items: [
      { furniture_instance_id: instanceId, furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 650, heightMm: 720, depthMm }, material_choices: REC_CHOICES },
    ],
  });
  const r1 = await client.publishDesignRevision(
    token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-qla-publish-r1',
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
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

function trackRequests(page: Page, patterns: readonly string[]): Map<string, number> {
  const regexes = patterns.map((pattern) => ({ pattern, regex: new RegExp(pattern) }));
  const counts = new Map<string, number>(patterns.map((p) => [p, 0]));
  page.on('request', (request) => {
    for (const { pattern, regex } of regexes) {
      if (regex.test(request.url())) counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    }
  });
  return counts;
}

test.describe.configure({ mode: 'serial' });

test('2A: Q1 accepted through the Web UI lands on the list as the commercial authority', async ({ page }) => {
  seeded = await prepareListFixture();

  await loginToA(page);
  await page.goto(`/quotes/${seeded.projectId}/reconciliacion`);

  // Create → publish → accept Q1 through supported UI commands; each of them
  // invalidates the summaries dataset (create/publish/accept share the
  // invalidation pass with the Cotizaciones list key).
  await page.getByTestId('create-initial-quote-btn').click();
  await expect(page.getByTestId('quote-lifecycle-panel')).toBeVisible();
  await expect(page.getByTestId('publish-quote-btn')).toBeEnabled();
  await page.getByTestId('publish-quote-btn').click();
  await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q1 publicada');
  await expect(page.getByTestId('accept-quote-btn')).toBeEnabled();
  await page.getByTestId('accept-quote-btn').click();
  await page.getByTestId('confirm-accept-quote-btn').click();
  await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q1 aceptada');

  const quoteSelect = page.getByTestId('quote-revision-select');
  seeded.q1Id = (await quoteSelect.locator('option').first().getAttribute('value'))!;

  // SPA navigation to the list WITHOUT a reload: the accept command already
  // invalidated the summaries dataset, so the card must show the accepted
  // authority immediately (no stale Q-draft, no manual browser refresh).
  await page.getByRole('link', { name: 'Cotizaciones' }).first().click();
  const card = page.getByTestId(`project-card-${seeded.projectId}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('commercial-status-badge')).toContainText('Q1 · Aceptada');
  await expect(card).toContainText(ORIGINAL_PROJECT_NAME);
  await expect(card).toContainText(FROZEN_CUSTOMER_NAME);
  const price = card.locator('.project-card__price-value');
  await expect(price).not.toHaveText('—');

  // Batch, not N+1 (#642 §35): a fresh list load consumes the batch endpoint
  // (initial fetch plus at most one session-scope refresh) and performs ZERO
  // per-card quote-revisions reads — including while filtering the list.
  const counts = trackRequests(page, [
    '/projects/commercial-summaries',
    '/projects/[0-9a-f-]+/quote-revisions',
  ]);
  await page.goto('/quotes');
  const freshCard = page.getByTestId(`project-card-${seeded.projectId}`);
  await expect(freshCard).toBeVisible();
  await expect(freshCard.getByTestId('commercial-status-badge')).toContainText('Q1 · Aceptada');
  // Filtering across the list must never trigger per-card revision fetches
  // (an N+1 design would issue one quote-revisions request per card).
  await page.getByLabel('Buscar cotizaciones').fill('Autoridad');
  await expect(freshCard).toBeVisible();
  await page.getByLabel('Buscar cotizaciones').fill('');
  await expect(freshCard).toBeVisible();
  await page.waitForTimeout(1500);
  expect(counts.get('/projects/[0-9a-f-]+/quote-revisions')).toBe(0);
  const summariesRequests = counts.get('/projects/commercial-summaries') ?? 0;
  expect(summariesRequests).toBeGreaterThanOrEqual(1);
  expect(summariesRequests).toBeLessThanOrEqual(2);

  // The negative proof (#642 §27): accepting a QuoteRevision did NOT write
  // Project.status='accepted' — the client readback confirms draft.
  const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
    getAccessToken: () => seeded.token,
  });
  const projects = await repository.getProjects();
  const stored = projects.find((p) => p.id === seeded.projectId);
  expect(stored?.status).toBe('draft');

  // #642 review: commercial acceptance is NOT manufacturing authority. Q1 is
  // accepted and the project is draft, but NO ProductionRelease exists — the
  // Cotizaciones chrome must not offer production surfaces.
  await page.goto(`/quotes/${seeded.projectId}`);
  await expect(page.getByTestId('project-detail-chrome')).toBeVisible();
  await expect(page.getByTestId('project-open-in-production')).toHaveCount(0);
  await expect(page.getByTestId('project-chrome-export')).toHaveCount(0);
});

test('2A: Q2 accepted wins, identity stays frozen, Q3 draft stays secondary, viewports hold', async ({ page }) => {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);

  // Q2: requote from Q1 with design provenance, publish and accept through
  // the generated client. The Project row is NEVER touched from here on.
  const requote = await client.requoteProjectQuote(seeded.token, seeded.projectId, {
    baseQuoteRevisionId: seeded.q1Id,
    designRevisionId: seeded.r1Id,
  }, 'gate-qla-requote-q2');
  seeded.q2Id = requote.quoteRevision.id;
  await client.publishProjectQuoteRevision(seeded.token, seeded.projectId, seeded.q2Id, 'gate-qla-publish-q2');
  await client.acceptProjectQuoteRevision(seeded.token, seeded.projectId, seeded.q2Id, 'gate-qla-accept-q2');

  // Deliberate historical mutation AFTER Q2: mutable identity changes must
  // not relabel the frozen commercial history.
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

  // Q3 draft: newer than the accepted Q2 → secondary "en borrador" line.
  // R2 carries another real commercial change (650 → 700) so the requote
  // from Q2 is accepted by the server.
  await client.updateDesignWorkingCopy(seeded.token, seeded.designId, {
    items: [
      { furniture_instance_id: seeded.instanceId, furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 700, heightMm: 720, depthMm: seeded.depthMm }, material_choices: REC_CHOICES },
    ],
  });
  const r2 = await client.publishDesignRevision(
    seeded.token,
    seeded.designId,
    { source_type: 'manual', base_revision_id: seeded.r1Id },
    'gate-qla-publish-r2',
  );
  const requoteQ3 = await client.requoteProjectQuote(seeded.token, seeded.projectId, {
    baseQuoteRevisionId: seeded.q2Id,
    designRevisionId: r2.id,
  }, 'gate-qla-requote-q3');

  await loginToA(page);
  await page.goto('/quotes');
  const card = page.getByTestId(`project-card-${seeded.projectId}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('commercial-status-badge')).toContainText('Q2 · Aceptada');
  // Frozen identity, not the renamed mutable rows.
  await expect(card).toContainText(ORIGINAL_PROJECT_NAME);
  await expect(card).not.toContainText(RENAMED_PROJECT_NAME);
  await expect(card).toContainText(FROZEN_CUSTOMER_NAME);
  await expect(card).not.toContainText(RENAMED_CUSTOMER_NAME);
  // Accepted Q2 wins over the newer draft; the draft is secondary.
  await expect(card).toContainText('Q3 en borrador');
  await expect(card.getByTestId('commercial-status-badge')).not.toContainText('Borrador');

  // List ↔ detail parity: opening the card keeps the SAME exact authority.
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${seeded.projectId}`));
  await expect(page.getByText(/Q2 · Aceptada/).first()).toBeVisible();

  // Responsive: 390 / 768 / 1280 — badge, identity, total, navigation and
  // no horizontal overflow. Screenshots are real artifacts for review.
  const screenshotDir = 'test-results/issue-642-2a-list-viewports';
  await mkdir(screenshotDir, { recursive: true });
  for (const [width, height] of [[390, 844], [768, 900], [1280, 800]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/quotes');
    const viewportCard = page.getByTestId(`project-card-${seeded.projectId}`);
    await expect(viewportCard).toBeVisible();
    await expect(viewportCard.getByTestId('commercial-status-badge')).toContainText('Q2 · Aceptada');
    await expect(viewportCard).toContainText(ORIGINAL_PROJECT_NAME);
    const overflow = await page.evaluate(
      () =>
        (document.scrollingElement?.scrollWidth ?? 0) -
        (document.scrollingElement?.clientWidth ?? 0),
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${screenshotDir}/cotizaciones-${width}.png`, fullPage: false });
    await viewportCard.click();
    await expect(page).toHaveURL(new RegExp(`/quotes/${seeded.projectId}`));
    await page.goto('/quotes');
  }

  // Sanity: Q3 really is a draft revision of this project.
  const revisions = await client.listProjectQuoteRevisions(seeded.token, seeded.projectId);
  const q3 = revisions.find((r) => r.id === requoteQ3.quoteRevision.id);
  expect(q3?.status).toBe('draft');
});

test('2A: a failed summaries request is an error state, never "Sin cotización", and recovers', async ({ page }) => {
  // Network interception ONLY for the failure injection — the pass criteria
  // before and after run against the real backend without interception.
  await page.route('**/api/projects/commercial-summaries', (route) => route.abort());
  await loginToA(page);
  await page.goto('/quotes');

  await expect(page.getByTestId('commercial-summaries-error')).toContainText('No se pudo cargar la información comercial.');
  await mkdir('test-results/issue-642-2a-list-viewports', { recursive: true });
  await page.screenshot({ path: 'test-results/issue-642-2a-list-viewports/error-banner.png', fullPage: false });
  const grid = page.getByLabel('Lista de cotizaciones');
  const failedCard = grid.getByTestId(`project-card-${seeded.projectId}`);
  await expect(failedCard).toBeVisible();
  // No per-card "Sin cotización" verdict and no legacy price as truth.
  await expect(grid.getByText('Sin cotización')).toHaveCount(0);
  await expect(failedCard.getByTestId('commercial-status-badge-error')).toBeVisible();
  await expect(failedCard.locator('.project-card__price-value')).toHaveText('—');
  await expect(failedCard.locator('.project-card__client')).toHaveCount(0);

  // Commercial filters are disabled while the dataset failed.
  const chips = page.getByTestId('project-status-chips');
  for (const chip of await chips.getByRole('button').all()) {
    await expect(chip).toBeDisabled();
  }

  // Recovery with the real backend: retry lands on the authoritative state.
  await page.unroute('**/api/projects/commercial-summaries');
  await page.goto('/quotes');
  const card = page.getByTestId(`project-card-${seeded.projectId}`);
  await expect(card.getByTestId('commercial-status-badge')).toContainText('Q2 · Aceptada');
});
