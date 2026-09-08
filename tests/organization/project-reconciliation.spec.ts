import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
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
const REC_HW = '71000000-0000-4000-8000-000000000011';
const REC_STRUCT = '71000000-0000-4000-8000-000000000012';
// Q1 snapshots dimensions, not material choices. Use genuine hardware demand
// here so the original reconciliation classifications stay exact; OPS below
// separately exercises board materials and frozen material planning.
const REC_CHOICES = {};


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
    structures: [...(catalog.structures ?? []), { id: REC_STRUCT, code: 'REC-STRUCT', name: 'Cuerpo', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
    hardware: [...catalog.hardware, { id: REC_HW, code: 'REC-HW', name: 'Herraje', unit: 'piece', costPerUnit: 10, active: true }],
    modules: [
      {
        ...template,
        id: GATE_MODULE_A_ID,
        structureId: REC_STRUCT,
        components: [],
        hardwareLines: [{ id: 'rec-hardware-line', hardwareId: REC_HW, quantity: 1, optionRole: '' }],
        parameterDefinitions: [],
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
        optionChoices: REC_CHOICES,
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
      { furniture_instance_id: instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600, heightMm: 720, depthMm }, material_choices: REC_CHOICES },
      { furniture_instance_id: instanceIds[1], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 650, heightMm: 720, depthMm }, material_choices: REC_CHOICES },
      { furniture_instance_id: designFirst.id, furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 700, heightMm: 720, depthMm }, material_choices: REC_CHOICES },
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

// A production queue is not proof by itself: physical work is authorized by
// the FROZEN routing evidence (#577). Schema-v2 P1 froze the neutral routing
// program, so exact server-derived PartExecutions are allowed — while client
// payloads stay refused and the legacy blob stays null.
async function assertFrozenRoutingExecution(page: Page, apiBase: string, token: string, projectId: string, releaseId: string, revisionNumber: number): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await page.goto('/production');
  await expect(page.getByTestId(`fabric-card-${projectId}`)).toBeVisible();
  await expect(page.getByTestId(`fabric-release-${projectId}`)).toContainText(`Diseño R${revisionNumber}`);
  // Schema-v2 evidence: no routing blocker, generation enabled.
  await expect(page.getByTestId(`fabric-routing-blocker-${projectId}`)).toHaveCount(0);
  await expect(page.getByTestId(`fabric-generate-parts-${projectId}`)).toBeEnabled();
  await expect(page.getByRole('button', { name: /enviar a producción/i })).toHaveCount(0);
  // A direct client still cannot bypass the server with claimed routes.
  for (let retry = 0; retry < 2; retry++) {
    const result = await fetch(`${apiBase}/projects/${projectId}/part-executions`, {
      method: 'PUT', headers,
      body: JSON.stringify({
        force: true,
        part_instances: [{ id: 'forged-part', project_id: projectId, production_revision: releaseId, required_operations: [{ type: 'cut' }] }],
        module_units: [{ id: 'forged-unit', project_id: projectId, production_revision: releaseId }],
      }),
    });
    expect(result.status).toBe(409);
    expect(await result.text()).toContain('se derivan de la liberación congelada');
  }
  // Golden path: exact PartExecutions derived exclusively from the frozen
  // snapshot + routing program (empty request body), stamped with the exact
  // release id and per-FurnitureInstance identity. Physical PIECES come from
  // frozen board parts — a hardware-only frozen BOM honestly derives units
  // without pieces.
  const generation = await fetch(`${apiBase}/projects/${projectId}/part-executions`, {
    method: 'PUT', headers,
    body: JSON.stringify({}),
  });
  expect(generation.status).toBe(200);
  const generated = (await generation.json()) as {
    part_instances: Array<{ id: string; production_revision: string; required_operations: Array<{ type: string; status: string }> }>;
    module_units: Array<{ id: string; production_revision: string }>;
  };
  const planning = await (await fetch(`${apiBase}/projects/${projectId}/materials`, { headers })).json();
  const hasBoards = (planning.planning?.requirements?.lines ?? []).some(
    (line: { kind: string }) => line.kind === 'tableros',
  );
  expect(generated.module_units.length).toBeGreaterThan(0);
  if (hasBoards) {
    expect(generated.part_instances.length).toBeGreaterThan(0);
  } else {
    expect(generated.part_instances).toEqual([]);
  }
  for (const part of generated.part_instances) {
    expect(part.production_revision).toBe(releaseId);
    expect(part.id.startsWith(`${releaseId}:`)).toBe(true);
    expect(part.required_operations[0].type).toBe('cut');
    expect(part.required_operations.every((op) => op.status === 'queued')).toBe(true);
  }
  for (const unit of generated.module_units) {
    expect(unit.production_revision).toBe(releaseId);
  }
  // Retry is idempotent: the same derived content, no duplicate artifacts.
  const retry = await fetch(`${apiBase}/projects/${projectId}/part-executions`, {
    method: 'PUT', headers,
    body: JSON.stringify({}),
  });
  expect(retry.status).toBe(200);
  const retried = (await retry.json()) as typeof generated;
  expect(retried.part_instances.length).toBe(generated.part_instances.length);
  expect(retried.module_units.length).toBe(generated.module_units.length);
  // Readback: executions persisted, readiness honest (no routing blocker),
  // projection exposes frozen_routing, legacy blob stays null.
  const executions = await (await fetch(`${apiBase}/projects/${projectId}/part-executions`, { headers })).json();
  expect(executions.part_instances.length).toBe(generated.part_instances.length);
  expect(executions.module_units.length).toBe(generated.module_units.length);
  expect(JSON.stringify(executions.assembly_readiness)).not.toContain('rutas y maquinados');
  const detail = await (await fetch(`${apiBase}/projects/${projectId}`, { headers })).json();
  expect(detail.production_release ?? null).toBeNull();
  expect(detail.resolved_production_release.release_id).toBe(releaseId);
  expect(detail.resolved_production_release.frozen_routing).toBe(true);
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
          material_choices: REC_CHOICES,
        }
      : {
          furniture_instance_id: seeded.instanceIds[selector]!,
          furniture_definition_id: GATE_MODULE_A_ID,
          parameters: { widthMm: widthOf(selector), heightMm: 720, depthMm: seeded.depthMm },
          material_choices: REC_CHOICES,
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


  test('quote-first path: Q1 → Q2/R2 → P1 → warehouse → frozen routing → exact part executions', async ({
    page,
  }) => {
    test.setTimeout(180_000);

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
    //    the fixture accepts it.
    // 5b. Lifecycle negative proofs through the generated client: a DRAFT
    //     revision cannot be accepted directly (typed 409, no mutation) and
    //     a revision reached through another project's path is a uniform 404
    //     (no existence oracle, no data leak).
    // ------------------------------------------------------------------
    const q2DraftValue = await quoteSelect
      .locator('option', { hasText: 'Q2 ·' })
      .first()
      .getAttribute('value');
    expect(q2DraftValue).toBeTruthy();
    const lifecycleClient = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const lifecycleOwner = await lifecycleClient.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    let draftAcceptRejected = false;
    try {
      await lifecycleClient.acceptProjectQuoteRevision(
        lifecycleOwner.token,
        seeded.projectId,
        q2DraftValue!,
        'gate-pr-accept-draft-negative',
      );
    } catch (err) {
      draftAcceptRejected = (err as { status?: number }).status === 409;
    }
    expect(draftAcceptRejected).toBe(true);

    let foreignProjectAcceptRejected = false;
    try {
      await lifecycleClient.acceptProjectQuoteRevision(
        lifecycleOwner.token,
        '99999999-9999-4999-9999-999999999999',
        q2DraftValue!,
        'gate-pr-accept-foreign-negative',
      );
    } catch (err) {
      foreignProjectAcceptRejected = (err as { status?: number }).status === 404;
    }
    expect(foreignProjectAcceptRejected).toBe(true);
    // The failed commands mutated nothing: the Q2 option still reads Draft
    // (the workspace may legitimately be displaying Q1 after step 4).
    await expect(quoteSelect.locator('option', { hasText: 'Q2 ·' })).toContainText('Borrador');

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

    // 7b. Double-accept negative: a retry with a NEW idempotency key hits
    //     the typed same-status conflict — never a second transition and
    //     never a second accepted revision (the HTTP receipt already covers
    //     same-key idempotent replay).
    let doubleAcceptRejected = false;
    try {
      await lifecycleClient.acceptProjectQuoteRevision(
        lifecycleOwner.token,
        seeded.projectId,
        q2DraftValue!,
        'gate-pr-accept-double-negative',
      );
    } catch (err) {
      doubleAcceptRejected = (err as { status?: number }).status === 409;
    }
    expect(doubleAcceptRejected).toBe(true);

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
    const releaseResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().endsWith('/production-releases'),
    );
    await page.getByTestId('submit-release').click();
    const releaseResponse = await releaseResponsePromise;
    expect(releaseResponse.status(), await releaseResponse.text()).toBe(201);
    const releasedP1 = await releaseResponse.json();
    expect(releasedP1.design_revision_id).toBe(seeded.r2Id);
    expect(releasedP1.quote_revision_id).toBe(q2DraftValue);

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

    // One real fixture continues the SAME accepted Q2/R2/P1 into warehouse.
    // Hardware demand is genuine; this is explicitly not a complete physical
    // golden path and does not manufacture a no-CNC receipt for the fixture.
    const apiBase = required('ORGANIZATION_API_BASE');
    const authHeaders = { Authorization: `Bearer ${lifecycleOwner.token}`, 'Content-Type': 'application/json' };
    // Project operational acceptance remains a distinct supported command;
    // accepting a QuoteRevision does not silently rewrite project lifecycle.
    const operationsRepository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => lifecycleOwner.token });
    const operationalProject = (await operationsRepository.getProjects()).find((project) => project.id === seeded.projectId)!;
    await operationsRepository.saveProject({ ...operationalProject, status: 'accepted' });
    await page.goto('/warehouse');
    await page.getByRole('tab', { name: 'Herrajes' }).click();
    await page.getByTestId(`purch-release-${seeded.projectId}`).click();
    await page.getByTestId(`purch-plan-derive-${seeded.projectId}`).click();
    await expect(page.getByTestId(`purch-plan-provenance-${seeded.projectId}`)).toContainText('Diseño R2');
    const readPlanning = async () => (await (await fetch(`${apiBase}/projects/${seeded.projectId}/materials`, { headers: authHeaders })).json()).planning;
    const planning = await readPlanning();
    expect(planning.requirements.release_id).toBe(releasedP1.id);
    expect(planning.requirements.source_design_revision_id).toBe(seeded.r2Id);
    expect(planning.requirements.bom_fingerprint).toBe(releasedP1.manufacturing_fingerprint);
    expect(planning.requirements.lines).toEqual([{ kind: 'herrajes', material_id: REC_HW, quantity: 4 }]);
    const stock = await fetch(`${apiBase}/stock/movements`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ kind: 'herrajes', material_id: REC_HW, type: 'entrada', quantity: 4 }),
    });
    expect(stock.status).toBe(201);
    await page.reload();
    await page.getByRole('tab', { name: 'Herrajes' }).click();
    await page.getByTestId(`purch-release-${seeded.projectId}`).click();
    const reserve = page.waitForRequest((request) => request.url().endsWith(`/projects/${seeded.projectId}/materials/reserve`));
    await page.getByTestId(`purch-plan-reserve-${seeded.projectId}`).click();
    expect((await reserve).postDataJSON().production_release_id).toBe(releasedP1.id);
    await expect(page.getByTestId(`purch-plan-reserve-${seeded.projectId}`)).toHaveCount(0);
    const reserved = await readPlanning();
    expect(reserved.requirements).toEqual(planning.requirements);
    expect(reserved.reservations).toHaveLength(1);
    expect(reserved.reservations[0].quantity).toBe(4);
    const releaseMaterials = page.waitForRequest((request) => request.url().endsWith(`/projects/${seeded.projectId}/materials/release`));
    await page.getByTestId(`purch-plan-release-${seeded.projectId}`).click();
    expect((await releaseMaterials).postDataJSON().production_release_id).toBe(releasedP1.id);
    await expect(page.getByTestId(`purch-release-${seeded.projectId}`)).toHaveCount(0);
    await assertFrozenRoutingExecution(page, apiBase, lifecycleOwner.token, seeded.projectId, releasedP1.id, 2);
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

  // ------------------------------------------------------------------
  // OPS-DT-1 (#577): the canonical ProductionRelease drives the whole
  // operational leg — almacén derive FROM the exact release snapshot,
  // provenance readback, mutable-quote independence and explicit routing
  // blockage before physical production — while the legacy
  // OC-022 blob stays null the entire time (no second liberation).
  // ------------------------------------------------------------------
  test('OPS-DT-1 (#577): frozen demand reaches warehouse; frozen routing authorizes exact part executions', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const OPS_PROJECT_ID = '77777777-3333-4777-8777-555555555555';
    const OPS_LINE_ID = '88888888-3333-4888-8888-555555555555';
    const apiBase = required('ORGANIZATION_API_BASE');
    const step = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
      console.log(`[opsdt1] ${label}…`);
      try {
        const out = await run();
        console.log(`[opsdt1] ${label} ok`);
        return out;
      } catch (err) {
        console.error(`[opsdt1] ${label} FAILED:`, err);
        throw err;
      }
    };
    const client = new GraneteApiClient(apiBase);
    const owner = await step('login', () =>
      client.login({
        email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
        password: required('ORGANIZATION_GATE_PASSWORD'),
        transport: 'web',
        org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
      }),
    );
    const authHeaders = { Authorization: `Bearer ${owner.token}` } as const;
    const repository = new APIWorkspaceRepository(apiBase, {
      getAccessToken: () => owner.token,
    });

    // Fixture: a self-sufficient catalog module (the gate org starts with an
    // empty catalog — the golden path seeds a bare module), an accepted obra
    // whose quoted units carry real material choices, and a design revision
    // pinning the SAME choices per instance — released design-first
    // (canonical P1, no legacy blob anywhere).
    const OPS_MAT_ID = 'a5150000-0000-4000-8000-000000000001';
    const OPS_OG_ID = 'a5150000-0000-4000-8000-000000000002';
    const OPS_STRUCT_ID = 'a5150000-0000-4000-8000-000000000003';
    const OPS_COMP_ID = 'a5150000-0000-4000-8000-000000000004';
    const OPS_MODULE_ID = 'a5150000-0000-4000-8000-000000000005';
    const catalog = await step('getCatalog', () => repository.getCatalog());
    await step('saveCatalog', () => repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials,
        {
          id: OPS_MAT_ID,
          code: 'OPS-TAB-1',
          name: 'Tablero Operaciones',
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 18,
          grainDefault: false,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
      optionGroups: [
        ...catalog.optionGroups,
        { id: OPS_OG_ID, code: 'INTERIOR', name: 'Interior', kind: 'board', required: true, optionIds: [OPS_MAT_ID] },
      ],
      structures: [
        ...(catalog.structures ?? []),
        {
          id: OPS_STRUCT_ID,
          code: 'OPS-EST-1',
          name: 'Estructura Operaciones',
          externalDims: { width: 600, height: 720, depth: 560 },
          components: [{ componentId: OPS_COMP_ID, quantity: 2 }],
          active: true,
        },
      ],
      components: [
        ...(catalog.components ?? []),
        {
          id: OPS_COMP_ID,
          code: 'OPS-COMP-1',
          name: 'Panel',
          placement: 'interno',
          geometry: { kind: 'rectangular_board', lengthMm: 720, widthMm: 560, thicknessMm: 18 },
          // The engine requires exactly 4 edge assignments (L1/L2/W1/W2);
          // all disabled keeps the module free of edge-band requirements.
          defaultEdges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRoles: ['INTERIOR'],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules,
        {
          id: OPS_MODULE_ID,
          code: 'OPS-MOD-1',
          name: 'Mueble Operaciones E2E',
          externalDims: { width: 600, height: 720, depth: 560 },
          widthMm: 600,
          heightMm: 720,
          depthMm: 560,
          structureId: OPS_STRUCT_ID,
          components: [],
          hardwareLines: [],
        },
      ],
    }));
    const choices = { INTERIOR: OPS_MAT_ID };

    const now = new Date().toISOString();
    // Draft first: quote materialization is immutable once accepted (I3).
    await step('saveProject draft', () => repository.saveProject({
      id: OPS_PROJECT_ID,
      name: 'Obra Continuidad Operacional E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.2,
      laborFixedCost: 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [
        { id: OPS_LINE_ID, moduleId: OPS_MODULE_ID, quantity: 2, optionChoices: choices },
      ],
    }));
    const mat = await step('materialize', () =>
      client.materializeQuoteLineFurniture(
      owner.token,
      OPS_PROJECT_ID,
        OPS_LINE_ID,
        'gate-ops-mat-quote-line',
      ),
    );
    if (mat.instances.length !== 2) {
      throw new Error(`expected 2 materialized instances, got ${mat.instances.length}`);
    }
    // Close commercially: the operational stages only see accepted/produced.
    const draft = (await step('getProjects', () => repository.getProjects())).find(
      (p) => p.id === OPS_PROJECT_ID,
    )!;
    await step('saveProject accepted', () => repository.saveProject({ ...draft, status: 'accepted' }));
    const design = await step('createDesign', () =>
      client.createProjectDesign(
        owner.token,
        OPS_PROJECT_ID,
        { name: 'Cocina Operaciones' },
        'gate-ops-create-design',
      ),
    );
    await step('updateWorkingCopy', () => client.updateDesignWorkingCopy(owner.token, design.id, {
      items: mat.instances.map((instance) => ({
        furniture_instance_id: instance.furniture_instance_id,
        furniture_definition_id: OPS_MODULE_ID,
        parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
        material_choices: choices,
      })),
    }));
    const r1 = await step('publishR1', () =>
      client.publishDesignRevision(
        owner.token,
        design.id,
        { source_type: 'manual', base_revision_id: null },
        'gate-ops-publish-r1',
      ),
    );
    await step('approveR1', () =>
      client.approveDesignRevision(owner.token, design.id, r1.id, 'gate-ops-approve-r1'),
    );
    const release = await step('createRelease', () =>
      client.createProductionRelease(
        owner.token,
        OPS_PROJECT_ID,
        { design_revision_id: r1.id },
        'gate-ops-release-p1',
      ),
    );
    expect(release.release_number).toBe(1);
    expect(release.design_revision_id).toBe(r1.id);

    // 1. Server-owned projection readback: canonical authority exposed on
    //    the project read model; the legacy blob was NEVER written.
    const detail = (await (
      await fetch(`${apiBase}/projects/${OPS_PROJECT_ID}`, { headers: authHeaders })
    ).json()) as {
      resolved_production_release?: { source: string; release_id: string; design_revision_id: string; release_number: number };
      production_release?: unknown;
    };
    expect(detail.resolved_production_release?.source).toBe('canonical');
    expect(detail.resolved_production_release?.release_id).toBe(release.id);
    expect(detail.resolved_production_release?.design_revision_id).toBe(r1.id);
    expect(detail.resolved_production_release?.release_number).toBe(1);
    expect(detail.production_release ?? null).toBeNull();

    // 2. Negative proofs through the real API: a canonical project rejects
    //    the implicit-latest derive (no exact id) and a foreign release id —
    //    and leaves no partial planning behind.
    const deriveLine = { kind: 'tableros', material_id: OPS_MAT_ID, quantity: 1 };
    const derive = (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${apiBase}/projects/${OPS_PROJECT_ID}/materials/derive`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await derive({ lines: [deriveLine] })).status).toBe(409);
    expect(
      (
        await derive({
          production_release_id: '99999999-9999-4999-9999-999999999999',
          lines: [deriveLine],
        })
      ).status,
    ).toBe(409);
    const materialsBefore = (await (
      await fetch(`${apiBase}/projects/${OPS_PROJECT_ID}/materials`, { headers: authHeaders })
    ).json()) as { planning?: unknown };
    expect(materialsBefore.planning ?? null).toBeNull();

    // 3. UI — Compras y Almacén: the canonical release alone unlocked the
    //    almacén stage (no legacy engineering handshake, no legacy release).
    //    The derive button is enabled and derives from the release snapshot.
    await loginToA(page);
    await page.goto('/warehouse');
    // The obra's module has board parts only: its picking card lives under
    // the Tableros tab. The card offers the planning panel (stage unlocked
    // by the canonical release — no engineering handshake happened).
    await page.getByRole('tab', { name: 'Tableros' }).click();
    await page.getByTestId(`purch-release-${OPS_PROJECT_ID}`).click();
    const deriveBtn = page.getByTestId(`purch-plan-derive-${OPS_PROJECT_ID}`);
    await expect(deriveBtn).toBeVisible();
    await deriveBtn.click();

    // 4. Human-readable provenance: derived from the exact release + revision.
    const provenance = page.getByTestId(`purch-plan-provenance-${OPS_PROJECT_ID}`);
    await expect(provenance).toContainText('Liberación #1');
    await expect(provenance).toContainText('Diseño R1');

    // Forged client demand cannot override the server-frozen collection.
    expect((await derive({ production_release_id: release.id, lines: [{ ...deriveLine, quantity: 999 }] })).status).toBe(200);
    const frozenPlanning = await (await fetch(`${apiBase}/projects/${OPS_PROJECT_ID}/materials`, { headers: authHeaders })).json();
    expect(frozenPlanning.planning.requirements.lines).toEqual([{ kind: 'tableros', material_id: OPS_MAT_ID, quantity: 1 }]);

    // 5. Server readback: requirements pinned to the exact release pins.
    const materials = (await (
      await fetch(`${apiBase}/projects/${OPS_PROJECT_ID}/materials`, { headers: authHeaders })
    ).json()) as {
      planning: {
        requirements: {
          release_id: string;
          source_release_number: number;
          source_design_revision_id: string;
          bom_fingerprint: string;
          lines: readonly { kind: string }[];
        };
      };
    };
    const requirements = materials.planning.requirements;
    expect(requirements.release_id).toBe(release.id);
    expect(requirements.source_release_number).toBe(1);
    expect(requirements.source_design_revision_id).toBe(r1.id);
    expect(requirements.bom_fingerprint).toMatch(/^sha256-/);
    expect(requirements.lines.length).toBeGreaterThan(0);

    // 6. Mutable-quote independence: a late project.items edit never
    //    changes the derived plan (the snapshot is release-owned).
    const stored = (await repository.getProjects()).find((p) => p.id === OPS_PROJECT_ID)!;
    await repository.saveProject({
      ...stored,
      items: [
        {
          id: OPS_LINE_ID,
          moduleId: OPS_MODULE_ID,
          quantity: 9,
          optionChoices: choices,
          customDims: { widthMm: 999, heightMm: 999, depthMm: 999 },
        },
      ],
    });
    expect((await derive({ production_release_id: release.id, lines: [] })).status).toBe(200);
    const materialsAfterMutation = (await (
      await fetch(`${apiBase}/projects/${OPS_PROJECT_ID}/materials`, { headers: authHeaders })
    ).json()) as typeof materials;
    expect(materialsAfterMutation.planning.requirements.lines).toEqual(requirements.lines);
    expect(materialsAfterMutation.planning.requirements.source_design_revision_id).toBe(r1.id);

    // #577 bounded warehouse continuity: actual server reservation uses the
    // stored exact P1 plan after the newer design and catalog mutations above.
    const stockResponse = await fetch(`${apiBase}/stock/movements`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ kind: 'tableros', material_id: OPS_MAT_ID, type: 'entrada', quantity: 1 }),
    });
    expect(stockResponse.status).toBe(201);
    await page.goto('/warehouse');
    await page.getByRole('tab', { name: 'Tableros' }).click();
    await page.getByTestId(`purch-release-${OPS_PROJECT_ID}`).click();
    await expect(page.getByTestId(`purch-plan-provenance-${OPS_PROJECT_ID}`)).toContainText('Liberación #1');
    // Responsive QA uses the actual synthetic fixture and existing controls.
    const originalViewport = page.viewportSize();
    const visualDirectory = process.env.WAREHOUSE_VISUAL_DIR;
    if (visualDirectory) {
      if (!isAbsolute(visualDirectory)) throw new Error('WAREHOUSE_VISUAL_DIR must be absolute');
      await mkdir(visualDirectory, { recursive: true });
    }
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const card = page.getByTestId(`purch-project-${OPS_PROJECT_ID}`);
      const reserve = page.getByTestId(`purch-plan-reserve-${OPS_PROJECT_ID}`);
      await expect(card).toBeVisible();
      await expect(page.getByTestId(`purch-plan-provenance-${OPS_PROJECT_ID}`)).toContainText('Liberación #1');
      await expect(page.getByText('Sin tableros por despachar')).toHaveCount(0);
      await expect(reserve).toBeVisible();
      await expect(reserve).toBeEnabled();
      await reserve.focus();
      await expect(reserve).toBeFocused();
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity).map((animation) => animation.finished.catch(() => undefined)));
      });
      const coverageRegion = card.getByRole('region', { name: 'Cobertura de materiales: desplazamiento horizontal' });
      await coverageRegion.focus();
      await expect(coverageRegion).toBeFocused();
      const geometry = await coverageRegion.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
      if (width === 390) expect(geometry.scroll).toBeGreaterThan(geometry.client);
      for (const heading of await coverageRegion.getByRole('columnheader').all()) {
        await expect.poll(async () => {
          const regionBounds = await coverageRegion.boundingBox();
          const headingBounds = await heading.boundingBox();
          if (!regionBounds || !headingBounds) return false;
          const reachable = headingBounds.x >= regionBounds.x - 1 && headingBounds.x + headingBounds.width <= regionBounds.x + regionBounds.width + 1;
          if (!reachable) await coverageRegion.press('ArrowRight');
          return reachable;
        }).toBe(true);
      }
      // The final shortage column and its actual cell are reachable by keyboard.
      const lastCell = coverageRegion.getByRole('cell').last();
      await expect(lastCell).toBeVisible();
      expect(await coverageRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThanOrEqual(0);
      const bounds = await card.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.width).toBeLessThanOrEqual(width);
      if (visualDirectory) await page.screenshot({ path: join(visualDirectory, `warehouse-${width}.png`), fullPage: true });
    }
    if (originalViewport) await page.setViewportSize(originalViewport);
    const reserveRequest = page.waitForRequest((request) => request.url().endsWith(`/projects/${OPS_PROJECT_ID}/materials/reserve`));
    await page.getByTestId(`purch-plan-reserve-${OPS_PROJECT_ID}`).click();
    expect((await reserveRequest).postDataJSON().production_release_id).toBe(release.id);
    await expect(page.getByTestId(`purch-plan-reserve-${OPS_PROJECT_ID}`)).toHaveCount(0);
    const reserved = await (await fetch(`${apiBase}/projects/${OPS_PROJECT_ID}/materials`, { headers: authHeaders })).json();
    expect(reserved.planning.requirements.lines).toEqual(requirements.lines);
    expect(reserved.planning.reservations).toHaveLength(1);
    expect(reserved.planning.reservations[0].quantity).toBe(1);

    // 7. Almacén releases the exact reserved materials.

    await page.goto('/warehouse');
    await page.getByRole('tab', { name: 'Tableros' }).click();
    await page.getByTestId(`purch-release-${OPS_PROJECT_ID}`).click();
    await page.getByTestId(`purch-plan-release-${OPS_PROJECT_ID}`).click();
    // Released material moves the obra past Almacén: the card leaves the
    // almacén queue (never to appear in two queues at once).
    await expect(page.getByTestId(`purch-release-${OPS_PROJECT_ID}`)).toHaveCount(0, {
      timeout: 15_000,
    });

    // Queue entry preserves P1, but cannot authorize physical manufacture.
    // The old client-derived route expectation was not frozen-content proof.
    await assertFrozenRoutingExecution(page, apiBase, owner.token, OPS_PROJECT_ID, release.id, 1);
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
