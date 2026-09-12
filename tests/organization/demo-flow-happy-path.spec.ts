import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #642 demo flow — browser E2E of the SIMPLIFIED happy path UX:
 *
 *   Q1 (UI) → publish (UI) → accept (UI) → design change → banner verdict →
 *   requote Q2 (UI) → publish Q2 (UI) → accept Q2 (UI) → approve R2 for Q2
 *   (UI) → release P1 (UI) → Abrir en Producción (UI).
 *
 * Critical transitions run through the real React UI over Go + PostgreSQL.
 * SketchUp authoring stays out of scope (licensed host): the design revisions
 * are published through the supported API exactly like the neighboring
 * #502/#644 gates do.
 *
 * UX regressions pinned here (demo acceptance):
 * - NO "Aceptar Obra (Flujo Clásico)" and NO duplicated accept/release paths
 *   visible anywhere on the visited surfaces;
 * - an incompatible Q/R pair (Q1 + commercial-changed R2) is blocked
 *   pre-emptively with the server's own classification, never discovered
 *   via a late 409;
 * - selecting Q2 pins its origin design revision (exact linkage);
 * - after P1 exists, the contextual "Abrir en Producción" exit appears —
 *   with Project.status still `draft`.
 */

const PROJECT_ID = '77777777-6666-4777-8777-666666666666';
const QUOTE_LINE_ID = '88888888-6666-4888-8888-666666666666';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000066';
const HAPPY_HW = '71000000-0000-4000-8000-000000000066';
const HAPPY_STRUCT = '71000000-0000-4000-8000-000000000067';
const HAPPY_CHOICES = {};

interface SeededHappyPath {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  r2Id: string;
  readonly instanceIds: readonly [string, string];
  readonly token: string;
  readonly apiBase: string;
  readonly depthMm: number;
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

test.describe.serial('Demo happy path UX: Q1 → cambios → Q2/R2 → P1 → Producción (#642)', () => {
  let seeded!: SeededHappyPath;

  test.beforeAll(async () => {
    seeded = await seedHappyPathFixtureReal();
  });

  test('happy path completo por UI real, sin caminos legacy visibles', async ({ page }) => {
    test.setTimeout(240_000);
    const { projectId, designId, instanceIds, apiBase, token } = seeded;

    await loginToA(page);

    // ------------------------------------------------------------------
    // 1. Reconciliation workspace: no quotes yet → explicit Q1 creation.
    // ------------------------------------------------------------------
    await page.goto(`/quotes/${projectId}/reconciliacion`);
    await expect(page.getByTestId('project-reconciliation-workspace')).toBeVisible();
    await expect(page.getByTestId('create-initial-quote-btn')).toBeVisible();

    // UX: the classic-flow accept never existed on this surface — pin it.
    await expect(page.getByText(/Flujo Clásico/i)).toHaveCount(0);
    await expect(page.getByText(/Aceptar Obra/i)).toHaveCount(0);

    // ------------------------------------------------------------------
    // 2. Create Q1 → publish → accept, all through the UI commands.
    // ------------------------------------------------------------------
    await page.getByTestId('create-initial-quote-btn').click();
    await expect(page.getByTestId('quote-draft-hint')).toBeVisible();

    // ONE primary commercial action per state: draft → Publicar Q1.
    await expect(page.getByTestId('publish-quote-btn')).toBeEnabled();
    await expect(page.getByTestId('accept-quote-btn')).toHaveCount(0);
    await page.getByTestId('publish-quote-btn').click();
    await expect(page.getByTestId('quote-published-hint')).toBeVisible();

    // published → Aceptar Q1 (the only accept action).
    await expect(page.getByTestId('accept-quote-btn')).toBeEnabled();
    await page.getByTestId('accept-quote-btn').click();
    await expect(page.getByTestId('accept-quote-modal')).toBeVisible();
    await page.getByTestId('confirm-accept-quote-btn').click();
    await expect(page.getByTestId('quote-accepted-hint')).toBeVisible();

    // R1 matches Q1 exactly → synced verdict, approval available and named.
    await expect(page.getByTestId('reconciliation-next-action')).toContainText(
      'comercialmente sincronizado con Q1',
    );
    await expect(page.getByTestId('approve-revision-btn')).toBeEnabled();
    await expect(page.getByTestId('approve-revision-btn')).toContainText('Aprobar R1 para Q1');

    // ------------------------------------------------------------------
    // 3. Commercial design change (R2 wider) → the banner states the
    //    commercial impact, approval is blocked pre-emptively and the
    //    single next action offered is the updated quote.
    // ------------------------------------------------------------------
    const client = new GraneteApiClient(apiBase);
    await client.updateDesignWorkingCopy(token, designId, {
      items: [
        { furniture_instance_id: instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 650, heightMm: 720, depthMm: seeded.depthMm }, material_choices: HAPPY_CHOICES },
        { furniture_instance_id: instanceIds[1], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600, heightMm: 720, depthMm: seeded.depthMm }, material_choices: HAPPY_CHOICES },
      ],
    });
    const r2 = await client.publishDesignRevision(
      token,
      designId,
      { source_type: 'manual', base_revision_id: seeded.r1Id },
      'happy-path-publish-r2',
    );
    seeded.r2Id = r2.id;

    // Pin R2 explicitly (the newest-revision default is R2 here anyway — we
    // select it so the assertion is about the exact pair, not the default).
    await page.getByTestId('design-revision-select').selectOption(r2.id);
    await expect(page.getByTestId('reconciliation-next-action')).toContainText(
      'afecta el precio o la configuración comercial',
    );
    // The incompatible pair Q1+R2 never offers approval: blocked with the
    // server's own truth instead of a late 409.
    await expect(page.getByTestId('approve-revision-btn')).toBeDisabled();
    await expect(page.getByTestId('approval-pair-commercial-hint')).toBeVisible();

    // ------------------------------------------------------------------
    // 4. Requote Q2 from the banner's single next action.
    // ------------------------------------------------------------------
    await expect(page.getByTestId('next-action-requote-btn')).toBeEnabled();
    await page.getByTestId('next-action-requote-btn').click();
    await expect(page.getByTestId('requote-review-modal')).toBeVisible();
    await page.getByTestId('submit-requote').click();
    await expect(page.getByTestId('requote-success')).toBeVisible();

    // Exact linkage: Q2 declares R2 as its origin — the selector follows the
    // data, and the option says so.
    await expect(page.getByTestId('quote-revision-select')).toHaveValue(
      (await page.getByTestId('quote-revision-select').locator('option', { hasText: 'Q2' }).getAttribute('value')) ?? '',
    );
    await expect(page.getByTestId('design-revision-select')).toHaveValue(r2.id);
    await expect(
      page.getByTestId('design-revision-select').locator('option', { hasText: 'origen de esta cotización' }),
    ).toHaveValue(r2.id);

    // ------------------------------------------------------------------
    // 5. Publish + accept Q2 (atomic supersede of Q1).
    // ------------------------------------------------------------------
    await expect(page.getByTestId('publish-quote-btn')).toBeEnabled();
    await page.getByTestId('publish-quote-btn').click();
    await expect(page.getByTestId('quote-published-hint')).toBeVisible();
    await expect(page.getByTestId('quote-will-supersede-hint')).toContainText('Q1');
    await page.getByTestId('accept-quote-btn').click();
    await page.getByTestId('confirm-accept-quote-btn').click();
    await expect(page.getByTestId('quote-accepted-hint')).toBeVisible();

    // Pair is compatible again → approval named for the exact pair.
    await expect(page.getByTestId('reconciliation-next-action')).toContainText(
      'comercialmente sincronizado con Q2',
    );
    await expect(page.getByTestId('approve-revision-btn')).toBeEnabled();
    await expect(page.getByTestId('approve-revision-btn')).toContainText('Aprobar R2 para Q2');

    // ------------------------------------------------------------------
    // 6. Approve R2 → release P1 → contextual Abrir en Producción.
    // ------------------------------------------------------------------
    await page.getByTestId('approve-revision-btn').click();
    await expect(page.getByTestId('approval-success')).toBeVisible();

    await expect(page.getByTestId('open-release-review-btn')).toBeEnabled();
    await page.getByTestId('open-release-review-btn').click();
    await expect(page.getByTestId('release-review-modal')).toBeVisible();
    await page.getByTestId('submit-release').click();
    await expect(page.getByTestId('release-success')).toBeVisible();

    // UX: no duplicated release path on this surface.
    await expect(page.getByText(/Re-evaluar Liberación/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Enviar a Producción/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Marcar en producción/i })).toHaveCount(0);

    // The contextual exit exists and navigates to the factory order.
    await expect(page.getByTestId('release-success-open-production')).toBeVisible();
    await page.getByTestId('release-success-open-production').click();
    await expect(page).toHaveURL(new RegExp(`/orders/${projectId}`));
    await expect(page.getByTestId(`fabric-card-${projectId}`)).toBeVisible();

    // ------------------------------------------------------------------
    // 7. Back on the Cotizaciones detail: the manufacturing authority
    //    (P1) drives the chrome with Project.status still draft — and no
    //    legacy lifecycle actions are offered.
    // ------------------------------------------------------------------
    await page.goto(`/quotes/${projectId}`);
    await expect(page.getByTestId('project-detail-chrome')).toBeVisible();
    await expect(page.getByTestId('project-open-in-production')).toBeVisible();
    await expect(page.getByTestId('project-mark-produced')).toHaveCount(0);
    await expect(page.getByText(/Flujo Clásico|Aceptar Obra|Marcar en producción/i)).toHaveCount(0);
    // Floor progress follows the release authority, not Project.status.
    await expect(page.getByTestId('project-floor-strip')).toBeVisible();

    // Server truth: the release pins the exact Q2/R2 pair.
    const projectDetail = await (
      await fetch(`${apiBase}/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    expect(projectDetail.status).toBe('draft');
    expect(projectDetail.resolved_production_release.source).toBe('canonical');
    expect(projectDetail.resolved_production_release.design_revision_id).toBe(r2.id);
    expect(projectDetail.resolved_production_release.quote_revision_id).toBeTruthy();
  });
});

/** Real seed (kept below the describe for readability). */
async function seedHappyPathFixtureReal(): Promise<SeededHappyPath> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });

  const repository = new APIWorkspaceRepository(apiBase, {
    getAccessToken: () => owner.token,
  });
  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  const depthMm = template.externalDims?.depth || 590;
  await repository.saveCatalog({
    ...catalog,
    structures: [...(catalog.structures ?? []), { id: HAPPY_STRUCT, code: 'HAPPY-STRUCT', name: 'Cuerpo', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
    hardware: [...catalog.hardware, { id: HAPPY_HW, code: 'HAPPY-HW', name: 'Herraje', unit: 'piece', costPerUnit: 10, active: true }],
    modules: [
      {
        ...template,
        id: GATE_MODULE_A_ID,
        structureId: HAPPY_STRUCT,
        components: [],
        hardwareLines: [{ id: 'happy-hardware-line', hardwareId: HAPPY_HW, quantity: 1, optionRole: '' }],
        externalDims: { width: 600, height: 720, depth: depthMm },
      },
    ],
    customers: [
      {
        id: CUSTOMER_ID,
        name: 'Cliente Happy Path E2E',
        active: true,
      },
    ],
  });

  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: 'Obra Happy Path Demo E2E',
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
        quantity: 2,
        optionChoices: HAPPY_CHOICES,
      },
    ],
  });

  const mat = await client.materializeQuoteLineFurniture(
    owner.token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'happy-path-materialize-line',
  );
  if (mat.instances.length !== 2) {
    throw new Error(`expected 2 materialized instances, got ${mat.instances.length}`);
  }
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id) as [string, string];

  const design = await client.createProjectDesign(
    owner.token,
    PROJECT_ID,
    { name: 'Cocina Happy Path' },
    'happy-path-create-design',
  );
  await client.updateDesignWorkingCopy(owner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600, heightMm: 720, depthMm }, material_choices: HAPPY_CHOICES },
      { furniture_instance_id: instanceIds[1], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600, heightMm: 720, depthMm }, material_choices: HAPPY_CHOICES },
    ],
  });
  const r1 = await client.publishDesignRevision(
    owner.token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'happy-path-publish-r1',
  );

  return {
    projectId: PROJECT_ID,
    designId: design.id,
    r1Id: r1.id,
    r2Id: '',
    instanceIds,
    token: owner.token,
    apiBase,
    depthMm,
  };
}
