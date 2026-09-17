import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { allowLoggedOutSessionProbe, collectBrowserErrors } from './support/browserErrors';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #740 PR 2 — browser E2E of the OPERATIONAL physical work gate:
 *
 *   P1 → Ingeniería en proceso → physical action BLOCKED with the honest
 *   reason → complete Ingeniería → materials pending → STILL blocked →
 *   authorize materials (audited exception) → the physical advance SUCCEEDS.
 *
 * Every step re-reads the server truth: a blocked action must leave the
 * piece untouched, zero floor events and zero fake progress. Preparation
 * (generating the planned executions) keeps working before authorization
 * (#739 regression).
 *
 * Business actions run through the real UI; fixtures (catalog, obra, P1) are
 * prepared through the supported APIs, same convention as the sibling specs.
 */

const PROJECT_ID = 'aaaab1b1-cccc-4b1b-8b1b-1b1b1b1b1bf1';
const QUOTE_LINE_ID = 'aaaab2b2-cccc-4b2b-8b2b-2b2b2b2b2bf2';
const CUSTOMER_ID = 'b1b1c0c0-0000-4000-8000-0000000000f3';
const GATE_MAT = '7a0b0b0b-0000-4000-8000-0000000000f4';
const GATE_MAT_CODE = 'ENG-740G-BOARD';
const GATE_PANEL = '7a0b0b0b-0000-4000-8000-0000000000f5';
const GATE_STRUCT = '7a0b0b0b-0000-4000-8000-0000000000f6';
const GATE_BODY_ROLE = 'ENG-740G-BODY';
const GATE_CHOICES: Record<string, string> = {};

interface SeededGate {
  readonly projectId: string;
  readonly releaseId: string;
  readonly token: string;
  readonly apiBase: string;
}

let seeded!: SeededGate;
let firstPartId = '';

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

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * The engineering commands refresh the workspace read model; navigating to
 * the order screen right after can abort that in-flight refresh. Same benign
 * abort the sibling engineering-state spec allowlists — scoped to the exact
 * message, real load failures still fail the journey.
 */
function allowAbortedWorkspaceRefresh(message: string): boolean {
  return message.includes('Failed to load workspace: TypeError: Failed to fetch');
}

/**
 * The DELIBERATE blocked advance: the operational gate answers 409 on the
 * floor-status endpoint — the exact negative under test. Scoped to that
 * status AND endpoint so a real regression can never hide behind it.
 */
function allowExpectedPhysicalGateBlock(message: string, resourceUrl: string): boolean {
  return (
    message.includes('409') &&
    (resourceUrl.includes('/floor-status') ||
      resourceUrl.includes('/floor-scan') ||
      /\/parts\/[^/]+\/advance/.test(resourceUrl))
  );
}

async function expectItemFloorStatus(expected: string): Promise<void> {
  const detail = (await (
    await fetch(`${seeded.apiBase}/projects/${seeded.projectId}`, { headers: authHeaders(seeded.token) })
  ).json()) as {
    items?: Array<{ id: string; floor_status?: string }>;
  };
  const item = detail.items?.find((i) => i.id === QUOTE_LINE_ID);
  expect(item?.floor_status ?? 'pending').toBe(expected);
}

async function fetchFloorEventCount(): Promise<number> {
  const events = (await (
    await fetch(`${seeded.apiBase}/projects/${seeded.projectId}/floor-events`, { headers: authHeaders(seeded.token) })
  ).json()) as unknown[];
  return events.length;
}

/**
 * Opens the pinned engineering workspace and waits for the release context to
 * RESOLVE (the loading badge may legitimately show while the exact release is
 * verified). A single reload keeps the journey deterministic under a
 * heavily-populated org without masking a real fail-safe — the strip/status
 * assertions below still fail loudly if the release never resolves.
 */
async function openEngineeringWorkspace(page: Page): Promise<void> {
  await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
  const context = page.getByTestId('eng-release-context');
  const loading = page.getByTestId('eng-release-context-loading');
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(context.or(loading)).toBeVisible({ timeout: 45_000 });
    if (await context.isVisible().catch(() => false)) return;
    if (attempt === 0) await page.reload();
  }
  await expect(context).toBeVisible({ timeout: 45_000 });
}

async function fetchEngineeringStatus(): Promise<string> {
  const state = (await (
    await fetch(
      `${seeded.apiBase}/projects/${seeded.projectId}/production-releases/${seeded.releaseId}/engineering`,
      { headers: authHeaders(seeded.token) },
    )
  ).json()) as { status: string };
  return state.status;
}

/** Opens the order's floor tab and clicks the first line's advance action
 * (the gated item-level floor writer — reachable for a canonical obra in ANY
 * preparation stage, unlike the fabric station cards). */
async function attemptFloorAdvance(page: Page): Promise<void> {
  await page.goto(`/orders/${PROJECT_ID}/floor`);
  const button = page.getByTestId(`prod-piso-advance-${QUOTE_LINE_ID}`);
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
}

test.describe.serial('Operational physical gate: Ingeniería → materiales → trabajo físico (#740 PR 2)', () => {
  test.beforeAll(async () => {
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
    const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
    const depthMm = template.externalDims?.depth || 590;
    GATE_CHOICES[GATE_BODY_ROLE] = GATE_MAT;
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials.filter((m) => m.id !== GATE_MAT),
        {
          id: GATE_MAT,
          code: GATE_MAT_CODE,
          name: 'Tablero Gate Físico',
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 18,
          grainDefault: true,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
      optionGroups: [
        ...catalog.optionGroups.filter((g) => g.code !== GATE_BODY_ROLE),
        { id: '7a0b0b0b-0000-4000-8000-0000000000f7', code: GATE_BODY_ROLE, name: 'Cuerpo 740 Gate', kind: 'board' as const, required: true, optionIds: [GATE_MAT] },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== GATE_STRUCT),
        {
          id: GATE_STRUCT,
          code: 'ENG-740G-STRUCT',
          name: 'Cuerpo Gate Físico',
          externalDims: { width: 600, height: 720, depth: depthMm },
          components: [{ componentId: GATE_PANEL, quantity: 1 }],
          active: true,
        },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== GATE_PANEL),
        {
          id: GATE_PANEL,
          code: 'ENG-740G-PANEL',
          name: 'Panel Gate Físico',
          placement: 'interno' as const,
          geometry: {
            kind: 'rectangular_board' as const,
            lengthMm: depthMm,
            widthMm: 600,
            thicknessMm: 18,
            lengthFormula: 'D',
            widthFormula: 'W',
          },
          defaultEdges: [
            { side: 'L1' as const, enabled: false },
            { side: 'L2' as const, enabled: false },
            { side: 'W1' as const, enabled: false },
            { side: 'W2' as const, enabled: false },
          ],
          optionRoles: [GATE_BODY_ROLE],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== template.id),
        { ...template, id: template.id, structureId: GATE_STRUCT, components: [], hardwareLines: [], externalDims: { width: 600, height: 720, depth: depthMm } },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente Gate Físico E2E', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra Gate Físico E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: GATE_MODULE_A_ID, quantity: 2, optionChoices: GATE_CHOICES }],
    });

    const mat = await client.materializeQuoteLineFurniture(
      owner.token,
      PROJECT_ID,
      QUOTE_LINE_ID,
      'gate-phys-materialize-line',
    );
    const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

    const design = await client.createProjectDesign(
      owner.token,
      PROJECT_ID,
      { name: 'Cocina Gate Físico' },
      'gate-phys-create-design',
    );
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: instanceIds.map((instanceId) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: template.id,
        parameters: { widthMm: 600, heightMm: 720, depthMm },
        material_choices: { [GATE_BODY_ROLE]: GATE_MAT },
      })),
    });
    const r1 = await client.publishDesignRevision(owner.token, design.id, {
      source_type: 'manual',
      base_revision_id: null,
    }, 'gate-phys-publish-r1');

    const q1 = await client.createInitialProjectQuoteRevision(owner.token, PROJECT_ID, {
      notes: 'Gate físico — revisión inicial',
    }, 'gate-phys-q1-create');
    await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'gate-phys-q1-publish');
    await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'gate-phys-q1-accept');

    const approved = await client.approveProjectDesignRevisionForProduction(
      owner.token,
      PROJECT_ID,
      design.id,
      r1.id,
      { quoteRevisionId: q1.id },
      'gate-phys-approve-r1-q1',
    );
    if (approved.status !== 'approved') throw new Error(`R1 not approved: ${approved.status}`);

    const release = await client.createProductionRelease(
      owner.token,
      PROJECT_ID,
      { design_revision_id: r1.id, quote_revision_id: q1.id },
      'gate-phys-release-p1',
    );

    // Preparation only (#739): the canonical planned executions generate
    // BEFORE any authorization — this is not physical work.
    const generation = await fetch(`${apiBase}/projects/${PROJECT_ID}/part-executions`, {
      method: 'PUT',
      headers: authHeaders(owner.token),
      body: JSON.stringify({}),
    });
    if (generation.status !== 200) throw new Error(`generation failed: ${await generation.text()}`);
    const generated = (await generation.json()) as { part_instances: Array<{ id: string }> };
    expect(generated.part_instances.length).toBeGreaterThan(0);
    firstPartId = generated.part_instances[0]!.id;

    seeded = { projectId: PROJECT_ID, releaseId: release.id, token: owner.token, apiBase };
  });

  test('Ingeniería en proceso → acción física bloqueada con motivo concreto', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, {
      allow: (message, resourceUrl) =>
        allowLoggedOutSessionProbe(message, resourceUrl) ||
        allowAbortedWorkspaceRefresh(message) ||
        allowExpectedPhysicalGateBlock(message, resourceUrl),
    });
    await loginToA(page);

    // Start engineering through the real UI (explicit user command).
    await openEngineeringWorkspace(page);
    await page.getByTestId('eng-start-engineering').click({ timeout: 45_000 });
    await expect(page.getByTestId('eng-entry-status')).toContainText('En proceso');
    expect(await fetchEngineeringStatus()).toBe('in_progress');

    // Physical attempt through the real station UI: blocked with the
    // actionable reason, not a generic failure.
    await attemptFloorAdvance(page);
    await expect(page.getByTestId('ui-toast')).toContainText('Ingeniería pendiente');

    // Server truth: zero progress, zero audit noise.
    await expectItemFloorStatus('pending');
    expect(await fetchFloorEventCount()).toBe(0);
    await browserErrors.assertEmpty('engineering pending blocks physical work');
  });

  test('Ingeniería completa → materiales pendientes → sigue bloqueada', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, {
      allow: (message, resourceUrl) =>
        allowLoggedOutSessionProbe(message, resourceUrl) ||
        allowAbortedWorkspaceRefresh(message) ||
        allowExpectedPhysicalGateBlock(message, resourceUrl),
    });
    await loginToA(page);

    await openEngineeringWorkspace(page);
    await page.getByTestId('eng-complete-engineering').click({ timeout: 45_000 });
    await expect(page.getByTestId('eng-entry-status')).toContainText('Completa');
    expect(await fetchEngineeringStatus()).toBe('completed');

    await attemptFloorAdvance(page);
    await expect(page.getByTestId('ui-toast')).toContainText('Material pendiente de autorización');

    await expectItemFloorStatus('pending');
    expect(await fetchFloorEventCount()).toBe(0);
    await browserErrors.assertEmpty('materials pending keeps blocking physical work');
  });

  test('Materiales autorizados → el avance físico tiene éxito', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await loginToA(page);

    // Materials authorization through the supported commands, pinned to the
    // exact release: server-frozen derive + the audited exception release
    // (no stock seeded in this org — the override keeps actor/reason/scope).
    const derive = await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}/materials/derive`, {
      method: 'POST',
      headers: authHeaders(seeded.token),
      body: JSON.stringify({ production_release_id: seeded.releaseId, lines: [] }),
    });
    if (derive.status !== 200) throw new Error(`derive failed: ${await derive.text()}`);
    const releaseMaterials = await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}/materials/release`, {
      method: 'POST',
      headers: authHeaders(seeded.token),
      body: JSON.stringify({
        production_release_id: seeded.releaseId,
        override_reason: 'E2E: producción autorizada con faltantes registrados',
      }),
    });
    if (releaseMaterials.status !== 200) throw new Error(`materials release failed: ${await releaseMaterials.text()}`);

    // Now the SAME physical action succeeds: the server records the real
    // transition (status + F092 audit event), no error toast appears.
    await attemptFloorAdvance(page);
    await expect
      .poll(async () => {
        const detail = (await (
          await fetch(`${seeded.apiBase}/projects/${seeded.projectId}`, { headers: authHeaders(seeded.token) })
        ).json()) as { items?: Array<{ id: string; floor_status?: string }> };
        return detail.items?.find((i) => i.id === QUOTE_LINE_ID)?.floor_status ?? 'missing';
      }, { timeout: 15_000 })
      .toBe('cut');
    expect(await fetchFloorEventCount()).toBeGreaterThanOrEqual(1);
    await browserErrors.assertEmpty('authorized materials unlock physical work');
  });
});
