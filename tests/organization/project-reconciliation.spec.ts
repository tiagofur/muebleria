import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #502 / WEB-DT-3 browser E2E against the real Go backend + PostgreSQL:
 * the quote-first golden path with quantity > 1 and a design-first
 * (modeled_not_quoted) unit, explicit requote, Q2/R1 reconciliation,
 * approval, authoritative preflight, exact ProductionRelease and release
 * durability after R2 exists.
 *
 * #571 / WEB-DT-4: complete server-authoritative QuoteRevision commercial
 * lifecycle executed through supported Web UI and APIs — creating Q1 draft,
 * publishing Q1, accepting Q1, requoting Q2, publishing Q2, and accepting Q2
 * (with atomic supersede of Q1) WITHOUT direct SQL mutations or fixture bypass.
 */

const PROJECT_ID = '77777777-3333-4777-8777-333333333333';
const QUOTE_LINE_ID = '88888888-3333-4888-8888-333333333333';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000003';

interface SeededReconciliation {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  r2Id: string;
  r3Id: string;
  readonly instanceIds: readonly [string, string, string];
  readonly designFirstInstanceId: string;
  q1Id: string;
  readonly orgId: string;
  readonly depthMm: number;
}

async function prepareReconciliationFixture(): Promise<SeededReconciliation> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });

  const repository = new APIWorkspaceRepository(apiBase, {
    getAccessToken: () => aOwner.token,
  });
  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  const depthMm = template.depthMm || 590;
  await repository.saveCatalog({
    ...catalog,
    modules: [
      {
        ...template,
        id: GATE_MODULE_A_ID,
        externalDims: { width: 600, height: 720, depth: depthMm },
        widthMm: 600,
        heightMm: 720,
        depthMm,
      },
    ],
    customers: [
      {
        id: CUSTOMER_ID,
        name: 'Cliente Reconciliación E2E',
        active: true,
      },
    ],
  });

  // 1. Project with one QuoteLine of quantity=3 → three physical units.
  const now = new Date().toISOString();
  const project = {
    id: PROJECT_ID,
    name: 'Obra Reconciliación y Liberación E2E',
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
        quantity: 3,
        optionChoices: {},
      },
    ],
  };
  await repository.saveProject(project);

  const mat = await client.materializeQuoteLineFurniture(
    aOwner.token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-pr-mat-quote-line',
  );
  if (mat.instances.length !== 3) {
    throw new Error(`expected 3 materialized instances, got ${mat.instances.length}`);
  }
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id) as [string, string, string];

  // 2. Design-first leg: an extra unit created through the public API (no
  // quote line behind it) → reconciliation must report modeled_not_quoted
  // and the requote must incorporate it with the SAME identity.
  const designFirst = await client.createProjectFurnitureInstance(
    aOwner.token,
    PROJECT_ID,
    { furniture_definition_id: GATE_MODULE_A_ID },
    'gate-pr-create-design-first',
  );

  // 3. Organization context (from authenticated session, no direct DB lookup)
  const orgId = aOwner.organization.id;

  // 4. Design + working copy: FI-A synced (600), FI-B modified (650),
  // design-first unit added (700). FI-C deliberately not modeled.
  const design = await client.createProjectDesign(
    aOwner.token,
    PROJECT_ID,
    { name: 'Cocina Reconciliación' },
    'gate-pr-create-design',
  );
  await client.updateDesignWorkingCopy(aOwner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600, heightMm: 720, depthMm }, material_choices: {} },
      { furniture_instance_id: instanceIds[1], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 650, heightMm: 720, depthMm }, material_choices: {} },
      { furniture_instance_id: designFirst.id, furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 700, heightMm: 720, depthMm }, material_choices: {} },
    ],
  });
  const r1 = await client.publishDesignRevision(
    aOwner.token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-pr-publish-r1',
  );

  return {
    projectId: PROJECT_ID,
    designId: design.id,
    r1Id: r1.id,
    r2Id: '',
    r3Id: '',
    instanceIds,
    designFirstInstanceId: designFirst.id,
    q1Id: '',
    orgId,
    depthMm,
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

test.describe.serial('Reconciliation, approval and exact ProductionRelease (#502 / WEB-DT-3) Browser E2E', () => {
  let seeded!: SeededReconciliation;

  test.beforeAll(async () => {
    seeded = await prepareReconciliationFixture();
  });
/**
 * Publishes a new revision of the fixture design with the requested physical
 * units. `items` selects instance indexes (and 'design-first' for the
 * API-created unit); widthOverrides tweaks specific widths by index.
 */
async function publishRevisionWithItemIds(options: {
  readonly items: readonly (number | 'design-first')[];
  readonly widthOverrides: Readonly<Record<number, number>>;
  readonly baseRevisionId: string;
  readonly idempotencyKey: string;
}): Promise<{ readonly id: string }> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  // FI-B keeps the modified 650 from R1; every other unit matches Q2 (600 /
  // 700 for the design-first unit) so R2 reconciles clean against Q2.
  const widthOf = (index: number): number => options.widthOverrides[index] ?? (index === 1 ? 650 : 600);
  const itemOf = (selector: number | 'design-first') =>
    selector === 'design-first'
      ? {
          furniture_instance_id: seeded.designFirstInstanceId,
          furniture_definition_id: GATE_MODULE_A_ID,
          parameters: { widthMm: 700, heightMm: 720, depthMm: seeded.depthMm },
          material_choices: {},
        }
      : {
          furniture_instance_id: seeded.instanceIds[selector]!,
          furniture_definition_id: GATE_MODULE_A_ID,
          parameters: { widthMm: widthOf(selector), heightMm: 720, depthMm: seeded.depthMm },
          material_choices: {},
        };
  await client.updateDesignWorkingCopy(
    owner.token,
    seeded.designId,
    { items: options.items.map(itemOf) },
  );
  return client.publishDesignRevision(
    owner.token,
    seeded.designId,
    { source_type: 'manual', base_revision_id: options.baseRevisionId },
    options.idempotencyKey,
  );
}


  test('quote-first golden path: exact Q1/R1, requote → Q2, approval, release P1, durability after R2', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // ------------------------------------------------------------------
    // 1. Initial State: Open reconciliation workspace for the project.
    //    No quote revisions exist yet. The workspace offers the explicit
    //    "Crear revisión de cotización (Q1)" action.
    // ------------------------------------------------------------------
    await loginToA(page);
    await page.goto(`/quotes/${seeded.projectId}/reconciliacion`);

    const workspace = page.getByTestId('project-reconciliation-workspace');
    await expect(workspace).toBeVisible();
    await expect(page.getByTestId('create-initial-quote-btn')).toBeVisible();

    // ------------------------------------------------------------------
    // 1b. Create, publish and accept Q1 through supported UI/API (no SQL).
    // ------------------------------------------------------------------
    await page.getByTestId('create-initial-quote-btn').click();
    await expect(page.getByTestId('quote-lifecycle-panel')).toBeVisible();
    await expect(page.getByTestId('quote-draft-hint')).toBeVisible();

    const quoteSelect = page.getByTestId('quote-revision-select');
    await expect(quoteSelect.locator('option')).toHaveCount(1);
    const q1OptionValue = await quoteSelect.locator('option').first().getAttribute('value');
    expect(q1OptionValue).toBeTruthy();
    seeded.q1Id = q1OptionValue!;

    // Header shows Q1 Draft
    const header = page.getByTestId('exact-context-header');
    await expect(header).toContainText('Q1');
    await expect(header).toContainText('Borrador');

    // Publish Q1
    await expect(page.getByTestId('publish-quote-btn')).toBeEnabled();
    await page.getByTestId('publish-quote-btn').click();
    await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q1 publicada');
    await expect(header).toContainText('Publicada');

    // Accept Q1
    await expect(page.getByTestId('accept-quote-btn')).toBeEnabled();
    await page.getByTestId('accept-quote-btn').click();
    const acceptModal = page.getByTestId('accept-quote-modal');
    await expect(acceptModal).toBeVisible();
    await page.getByTestId('confirm-accept-quote-btn').click();
    await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q1 aceptada');
    await expect(header).toContainText('Aceptada');

    // Select R1
    await page.getByTestId('design-select').selectOption(seeded.designId);
    await page.getByTestId('design-revision-select').selectOption(seeded.r1Id);
    await expect(header).toContainText('R1');

    // Backend classification, rendered verbatim: 1 synced, 1 modified
    // (commercial+manufacturing), 1 quoted_not_modeled (qty>1 partial
    // placement), 1 modeled_not_quoted (design-first), 0 conflicts.
    await expect(page.getByTestId('reconciliation-items-table')).toBeVisible();
    await expect(page.getByTestId('summary-synced')).toHaveText('1');
    await expect(page.getByTestId('summary-modified')).toHaveText('1');
    await expect(page.getByTestId('summary-quoted-not-modeled')).toHaveText('1');
    await expect(page.getByTestId('summary-modeled-not-quoted')).toHaveText('1');
    await expect(page.getByTestId('summary-conflict')).toHaveText('0');

    // Physical unit identity: distinct rows per furnitureInstanceId (qty>1
    // never collapses) and the modified unit shows the exact diff + impact.
    const modifiedRow = page.getByTestId(`reconciliation-item-${seeded.instanceIds[1]}`);
    await expect(modifiedRow).toContainText('Modificado');
    await expect(modifiedRow).toContainText('Parámetro widthMm');
    await expect(modifiedRow).toContainText('600 → 650');
    await expect(page.getByTestId(`impact-${seeded.instanceIds[1]}`)).toHaveText('Comercial + Fabricación');
    await expect(page.getByTestId(`reconciliation-item-${seeded.instanceIds[0]}`)).toContainText('Sincronizado');
    await expect(page.getByTestId(`reconciliation-item-${seeded.instanceIds[2]}`)).toContainText('Cotizado no modelado');
    await expect(page.getByTestId(`reconciliation-item-${seeded.designFirstInstanceId}`)).toContainText('Modelado no cotizado');

    // Authoritative preflight over the exact revision is ready.
    await expect(page.getByTestId('preflight-status')).toContainText('Listo para fabricación');

    // ------------------------------------------------------------------
    // 2. Explicit requote: select the commercial change + design-first unit.
    // ------------------------------------------------------------------
    await page.getByTestId('open-requote-btn').click();
    const modal = page.getByTestId('requote-review-modal');
    await expect(modal).toContainText('La cotización Q1 (Aceptada) no será modificada');
    // Pre-selected incorporable units; the spatial/synced ones are absent.
    await expect(modal.getByTestId(`requote-select-${seeded.instanceIds[1]}`)).toBeAttached();
    await expect(modal.getByTestId(`requote-select-${seeded.designFirstInstanceId}`)).toBeAttached();
    await expect(modal.getByTestId(`requote-select-${seeded.instanceIds[0]}`)).toHaveCount(0);

    await page.getByTestId('submit-requote').click();
    await expect(page.getByTestId('requote-success')).toBeVisible();
    await expect(page.getByTestId('requote-success')).toContainText('Q2 creada como borrador');
    await expect(page.getByTestId('requote-success')).toContainText('permanece intacta');

    // Explicit retarget to compare Q2 with R1 (no silent auto-retarget): the
    // URL pins the server-generated Q2 id, never "latest".
    await page.getByTestId('compare-new-quote-btn').click();
    await expect(page.getByTestId('exact-context-header')).toContainText('Q2');
    await expect(page.getByTestId('exact-context-header')).toContainText('Borrador');
    await expect(page).not.toHaveURL(new RegExp(`qrev=${seeded.q1Id}`));

    // Q1 remains in the revision list, untouched (server-owned status).
    await expect(quoteSelect.locator('option')).toHaveCount(2);
    await expect(quoteSelect).toContainText('Q1');

    // ------------------------------------------------------------------
    // 3. Reconcile Q2/R1: the incorporated changes are gone.
    // ------------------------------------------------------------------
    await expect(page.getByTestId('summary-synced')).toHaveText('3');
    await expect(page.getByTestId('summary-modified')).toHaveText('0');
    await expect(page.getByTestId('summary-modeled-not-quoted')).toHaveText('0');
    await expect(page.getByTestId('summary-quoted-not-modeled')).toHaveText('1');

    // ------------------------------------------------------------------
    // 4. Stale-source concurrency proof: browser A holds the Q1/R1
    //    comparison while Q2 already exists; re-quoting from the stale Q1
    //    base must fail with the typed VERSION_CONFLICT (server-side
    //    optimistic concurrency, no silent Q3 from stale assumptions).
    // ------------------------------------------------------------------
    await quoteSelect.selectOption(seeded.q1Id);
    await expect(page.getByTestId('exact-context-header')).toContainText('Q1');
    await page.getByTestId('open-requote-btn').click();
    await page.getByTestId('submit-requote').click();
    await expect(page.getByTestId('command-error-alert')).toContainText('desactualizada');
    await expect(page.getByTestId('requote-success')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    // No Q3 was created: the revision list still holds exactly Q1 and Q2.
    await expect(quoteSelect.locator('option')).toHaveCount(2);

    // ------------------------------------------------------------------
    // 5. Q2 stays DRAFT at this point on purpose: step 6b proves the
    //    production-approval gate rejects a non-accepted baseline before
    //    the fixture accepts it (no HTTP accept surface exists yet —
    //    documented demo limitation).

    // ------------------------------------------------------------------
    // 6. Complete the modeling: publish R2 with FI-C modeled too (qty>1
    //    fully placed). The requote source stays R1; Q2/R2 reconciles clean
    //    so the commercial gate allows the approval/release.
    // ------------------------------------------------------------------
    const r2 = await publishRevisionWithItemIds({
      items: [0, 1, 2, 'design-first'],
      widthOverrides: {},
      baseRevisionId: seeded.r1Id,
      idempotencyKey: 'gate-pr-publish-r2',
    });
    seeded.r2Id = r2.id;
    await page.reload();
    // Reload keeps the pinned Q2/R1 comparison (historical snapshot).
    await expect(page.getByTestId('exact-context-header')).toContainText('R1');

    // Select the still-DRAFT Q2 + R2: everything incorporated/placed — the
    // commercial content is complete even before acceptance.
    const q2ValueDraft = await quoteSelect
      .locator('option', { hasText: 'Q2 ·' })
      .first()
      .getAttribute('value');
    await quoteSelect.selectOption(q2ValueDraft!);
    await page.getByTestId('design-revision-select').selectOption(seeded.r2Id);
    await expect(page.getByTestId('exact-context-header')).toContainText('R2');
    await expect(page.getByTestId('summary-synced')).toHaveText('4');
    await expect(page.getByTestId('summary-modified')).toHaveText('0');
    await expect(page.getByTestId('summary-quoted-not-modeled')).toHaveText('0');
    await expect(page.getByTestId('summary-modeled-not-quoted')).toHaveText('0');

    // ------------------------------------------------------------------
    // 6b. Production-approval gate negative proof: with Q2 still DRAFT, the
    //     server must reject the approval with the typed quote-not-accepted
    //     409 — proving the exact quote pin travels with the command (the
    //     body-less legacy path would have approved it).
    // ------------------------------------------------------------------
    await expect(page.getByTestId('approval-pending')).toBeVisible();
    await expect(page.getByTestId('exact-context-header')).toContainText('Borrador');
    await expect(page.getByTestId('approval-quote-hint')).toBeVisible();
    await page.getByTestId('approve-revision-btn').click();
    await expect(page.getByTestId('command-error-alert')).toContainText('aceptada');
    await expect(page.getByTestId('approval-success')).toHaveCount(0);

    // ------------------------------------------------------------------
    // 7. Commercial lifecycle: publish and accept Q2 through Web action,
    //    atomically superseding Q1 server-side in one transaction (no SQL!).
    // ------------------------------------------------------------------
    await expect(page.getByTestId('quote-lifecycle-panel')).toBeVisible();
    await expect(page.getByTestId('publish-quote-btn')).toBeEnabled();
    await page.getByTestId('publish-quote-btn').click();
    await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q2 publicada');
    await expect(page.getByTestId('exact-context-header')).toContainText('Publicada');

    // Accept Q2: opens confirmation modal warning that Q1 will be superseded
    await expect(page.getByTestId('accept-quote-btn')).toBeEnabled();
    await page.getByTestId('accept-quote-btn').click();
    const acceptQ2Modal = page.getByTestId('accept-quote-modal');
    await expect(acceptQ2Modal).toBeVisible();
    await expect(page.getByTestId('accept-quote-supersede-warning')).toContainText('Q1');
    await page.getByTestId('confirm-accept-quote-btn').click();

    await expect(page.getByTestId('quote-lifecycle-success')).toContainText('Revisión Q2 aceptada');
    await expect(page.getByTestId('exact-context-header')).toContainText('Q2');
    await expect(page.getByTestId('exact-context-header')).toContainText('Aceptada');

    // Verify Q1 in the select is now marked Superseded
    await expect(quoteSelect.locator('option', { hasText: 'Q1' })).toContainText('Reemplazada');

    // Now approve exact R2 against accepted Q2:
    await page.getByTestId('design-revision-select').selectOption(seeded.r2Id);
    await expect(page.getByTestId('approval-pending')).toBeVisible();
    await page.getByTestId('approve-revision-btn').click();
    await expect(page.getByTestId('approval-success')).toBeVisible();
    await expect(page.getByTestId('approval-success')).toContainText('R2 aprobada');

    // ------------------------------------------------------------------
    // 8. Release P1 pinned to Q2 + R2 through the review modal.
    // ------------------------------------------------------------------
    await expect(page.getByTestId('open-release-review-btn')).toBeEnabled();
    await page.getByTestId('open-release-review-btn').click();
    const releaseModal = page.getByTestId('release-review-modal');
    await expect(releaseModal).toContainText('base comercial exacta');
    await expect(releaseModal).toContainText('Q2');
    await expect(releaseModal).toContainText('R2');
    await page.getByTestId('submit-release').click();

    await expect(page.getByTestId('release-success')).toBeVisible();
    await expect(page.getByTestId('release-success')).toContainText('Liberación #1 creada');
    await expect(page.getByTestId('release-success')).toContainText('R2');

    const releaseRow = page.getByTestId('release-row-1');
    await expect(releaseRow).toContainText('Q2 + R2', { timeout: 15000 });
    await expect(releaseRow).toContainText('sha256-');

    // Contextual release badge for the exact Q2+R2 pins.
    await expect(page.getByTestId('contextual-release-badge')).toContainText('#1');

    // ------------------------------------------------------------------
    // 9. Release durability: publish R3 with a different fingerprint, then
    //    P1 still pins R2 (never retargets to the latest revision).
    // ------------------------------------------------------------------
    const r3 = await publishRevisionWithItemIds({
      items: [0, 1, 2, 'design-first'],
      widthOverrides: { 2: 650 },
      baseRevisionId: seeded.r2Id,
      idempotencyKey: 'gate-pr-publish-r3',
    });
    seeded.r3Id = r3.id;

    // Reload the workspace pinned to Q2/R2: P1 stays pinned to R2 and the
    // server staleness projection surfaces R3 without retargeting anything.
    await page.reload();
    await expect(page.getByTestId('exact-context-header')).toContainText('R2');
    const durableRow = page.getByTestId('release-row-1');
    await expect(durableRow).toContainText('Q2 + R2');
    await expect(durableRow).toContainText('Stale');
    await expect(durableRow).toContainText('R3');

    // Selecting R3 shows NO contextual release (P1 belongs to R2 only).
    await page.getByTestId('design-revision-select').selectOption(seeded.r3Id);
    await expect(page.getByTestId('contextual-release-badge')).toHaveCount(0);
  });

  test('failure rollback: release before approval is rejected server-side, no release row, no false success', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await loginToA(page);
    await page.goto(`/quotes/${seeded.projectId}/reconciliacion`);

    // Wait for the workspace to settle; R3 exists and is NOT approved.
    await expect(page.getByTestId('project-reconciliation-workspace')).toBeVisible();

    // Server-side negative proof through the generated client: the release
    // command on the unapproved R2 must fail with a typed 409 and leave no
    // ProductionRelease row behind.
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    let conflicted = false;
    try {
      await client.createProductionRelease(
        owner.token,
        seeded.projectId,
        { design_revision_id: seeded.r3Id },
        'gate-pr-release-failure-probe',
      );
    } catch (err) {
      conflicted = (err as { status?: number }).status === 409;
    }
    expect(conflicted).toBe(true);

    const releases = await client.listProjectProductionReleases(owner.token, seeded.projectId);
    expect(releases).toHaveLength(1); // only P1 from the golden path
    expect(releases[0]!.design_revision_id).toBe(seeded.r2Id);

    // UI honesty: no release success banner is ever rendered from a failed
    // command, and the history keeps the single exact release.
    await page.reload();
    await expect(page.getByTestId('release-success')).toHaveCount(0);
    await expect(page.getByTestId('release-row-2')).toHaveCount(0);
    await expect(page.getByTestId('release-row-1')).toBeVisible();
  });

  test('tenant isolation: Org B never sees Org A reconciliation data', async ({ page }) => {
    test.setTimeout(60_000);

    await loginToA(page);
    await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');

    await page.goto(
      `/quotes/${seeded.projectId}/reconciliacion?qrev=${seeded.q1Id}&design=${seeded.designId}&rev=${seeded.r1Id}`,
    );

    // RLS-enforced tenant context: no Org A reconciliation data may leak.
    await page.waitForTimeout(5000);
    await expect(page.getByText('Cocina Reconciliación')).toHaveCount(0);
    await expect(page.getByTestId('reconciliation-items-table')).toHaveCount(0);
    await expect(page.getByTestId('release-history-table')).toHaveCount(0);
  });
});
