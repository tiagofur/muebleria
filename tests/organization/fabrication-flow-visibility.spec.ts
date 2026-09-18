import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { allowLoggedOutSessionProbe, collectBrowserErrors } from './support/browserErrors';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #768 — browser E2E of the compact "Preparación para fabricar" stepper:
 *
 *   P1 created (supported API, executions generated) → Ingeniería shows the
 *   full stepper with the single next action (Iniciar → En proceso) → the
 *   production hub shows the SAME semantics and navigates to Ingeniería →
 *   engineering completed + materials derived (Autorizar materiales →
 *   Almacén) → materials released (Listo para producción, no fake "iniciada")
 *   → one piece physically advanced (En producción) → 390/768/1280 render
 *   the stepper without horizontal overflow, with state + next action
 *   visible first. Project.status stays draft the whole journey — the
 *   stepper never reads it.
 *
 * The P1-works-on-P2 banner is owned by production-release-continuity.spec.
 */

const PROJECT_ID = 'aaa76868-0000-4000-8000-0000000007e1';
const QUOTE_LINE_ID = 'bbb76868-0000-4000-8000-0000000007e2';
const CUSTOMER_ID = 'ccc76868-0000-4000-8000-0000000007e3';
const FLOW_MAT = '7d0d0000-0000-4000-8000-0000000007e4';
const FLOW_PANEL = '7e0e0000-0000-4000-8000-0000000007e5';
const FLOW_STRUCT = '7f0f0000-0000-4000-8000-0000000007e6';
const FLOW_BODY_ROLE = 'FLOW-768-BODY';
const FLOW_CHOICES: Record<string, string> = {};

interface SeededFlow {
  readonly projectId: string;
  readonly releaseId: string;
  readonly partId: string;
  readonly token: string;
  readonly apiBase: string;
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

function allowAbortedWorkspaceRefresh(message: string): boolean {
  return message.includes('Failed to load workspace: TypeError: Failed to fetch');
}

test.describe.serial('Preparación para fabricar: stepper compacto Ingeniería/Producción (#768)', () => {
  let seeded!: SeededFlow;

  test.beforeAll(async () => {
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const authHeaders = { Authorization: `Bearer ${owner.token}` };

    const repository = new APIWorkspaceRepository(apiBase, {
      getAccessToken: () => owner.token,
    });
    const catalog = await repository.getCatalog();
    const template = catalog.modules.find((m) => m.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
    const depthMm = template.externalDims?.depth || 590;
    FLOW_CHOICES[FLOW_BODY_ROLE] = FLOW_MAT;
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials.filter((m) => m.id !== FLOW_MAT),
        {
          id: FLOW_MAT,
          code: 'FLOW-768-BOARD',
          name: 'Tablero Flujo 768',
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
        ...catalog.optionGroups.filter((g) => g.code !== FLOW_BODY_ROLE),
        { id: '7a0a0000-0000-4000-8000-0000000007e7', code: FLOW_BODY_ROLE, name: 'Cuerpo 768', kind: 'board' as const, required: true, optionIds: [FLOW_MAT] },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== FLOW_STRUCT),
        {
          id: FLOW_STRUCT,
          code: 'FLOW-768-STRUCT',
          name: 'Cuerpo Flujo 768',
          externalDims: { width: 600, height: 720, depth: depthMm },
          components: [{ componentId: FLOW_PANEL, quantity: 1 }],
          active: true,
        },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== FLOW_PANEL),
        {
          id: FLOW_PANEL,
          code: 'FLOW-768-PANEL',
          name: 'Panel Flujo 768',
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
          optionRoles: [FLOW_BODY_ROLE],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== template.id),
        { ...template, id: template.id, structureId: FLOW_STRUCT, components: [], hardwareLines: [], externalDims: { width: 600, height: 720, depth: depthMm } },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente Flujo E2E', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra Flujo Fabricación E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: GATE_MODULE_A_ID, quantity: 2, optionChoices: FLOW_CHOICES }],
    });

    const mat = await client.materializeQuoteLineFurniture(
      owner.token,
      PROJECT_ID,
      QUOTE_LINE_ID,
      'flow-768-materialize-line',
    );
    const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

    const design = await client.createProjectDesign(
      owner.token,
      PROJECT_ID,
      { name: 'Cocina Flujo 768' },
      'flow-768-create-design',
    );
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: instanceIds.map((instanceId) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: template.id,
        parameters: { widthMm: 600, heightMm: 720, depthMm },
        material_choices: { [FLOW_BODY_ROLE]: FLOW_MAT },
      })),
    });
    const r1 = await client.publishDesignRevision(owner.token, design.id, {
      source_type: 'manual',
      base_revision_id: null,
    }, 'flow-768-publish-r1');

    const q1 = await client.createInitialProjectQuoteRevision(owner.token, PROJECT_ID, {
      notes: 'Flujo de fabricación — revisión inicial',
    }, 'flow-768-q1-create');
    await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'flow-768-q1-publish');
    await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'flow-768-q1-accept');

    const approved = await client.approveProjectDesignRevisionForProduction(
      owner.token,
      PROJECT_ID,
      design.id,
      r1.id,
      { quoteRevisionId: q1.id },
      'flow-768-approve-r1-q1',
    );
    if (approved.status !== 'approved') throw new Error(`R1 not approved: ${approved.status}`);

    const release = await client.createProductionRelease(
      owner.token,
      PROJECT_ID,
      { design_revision_id: r1.id, quote_revision_id: q1.id },
      'flow-768-release-p1',
    );

    // Planned executions for the exact P1 (same order as the continuity
    // fixture: generation precedes any material commitment).
    const generation = await fetch(`${apiBase}/projects/${PROJECT_ID}/part-executions`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    if (generation.status !== 200) throw new Error(`generation failed: ${await generation.text()}`);
    const generated = (await generation.json()) as { part_instances: Array<{ id: string }> };
    expect(generated.part_instances.length).toBeGreaterThan(0);

    seeded = {
      projectId: PROJECT_ID,
      releaseId: release.id,
      partId: generated.part_instances[0]!.id,
      token: owner.token,
      apiBase,
    };
  });

  test('Ingeniería: stepper A→B con única acción siguiente; hub navega a Ingeniería', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, {
      allow: (message, resourceUrl) =>
        allowLoggedOutSessionProbe(message, resourceUrl) || allowAbortedWorkspaceRefresh(message),
    });
    await loginToA(page);

    // Caso A — the whole flow on one compact surface.
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
    const flow = page.getByTestId('eng-fab-flow');
    await expect(flow).toBeVisible({ timeout: 45_000 });
    await expect(flow).toHaveAttribute('aria-label', 'Preparación para fabricar');
    await expect(page.getByTestId('eng-fab-step-design')).toContainText('Diseño aprobado');
    await expect(page.getByTestId('eng-fab-step-release')).toContainText('Liberado a Ingeniería');
    await expect(page.getByTestId('eng-fab-step-release')).toContainText('Liberación #1 · Diseño R1');
    const engineeringStep = page.getByTestId('eng-fab-step-engineering');
    await expect(engineeringStep).toContainText('Pendiente');
    await expect(engineeringStep).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('eng-fab-step-materials')).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('eng-fab-step-production')).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('eng-start-engineering')).toContainText('Iniciar Ingeniería');

    // Caso B — the explicit durable command from the stepper.
    await page.getByTestId('eng-start-engineering').click();
    await expect(engineeringStep).toContainText('En proceso');
    await expect(page.getByTestId('eng-complete-engineering')).toContainText('Completar Ingeniería');
    await expect(page.getByTestId('eng-start-engineering')).toHaveCount(0);

    // The hub shows the SAME semantics and navigates (never commands).
    await page.goto(`/orders/${PROJECT_ID}`);
    const hubFlow = page.getByTestId('prod-fab-flow');
    await expect(hubFlow).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('prod-fab-step-engineering')).toContainText('En proceso');
    await expect(page.getByTestId('prod-fab-open-engineering')).toContainText('Abrir Ingeniería');
    await page.getByTestId('prod-fab-open-engineering').click();
    await expect(page).toHaveURL(new RegExp(`/engineering/${PROJECT_ID}\\?release=${seeded.releaseId}$`));
    await browserErrors.assertEmpty('stepper cases A/B journey');
  });

  test('Producción: C materiales pendientes → D listo → E en producción, todo desde autoridad', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, {
      allow: allowLoggedOutSessionProbe,
    });
    await loginToA(page);
    const headers = { Authorization: `Bearer ${seeded.token}`, 'Content-Type': 'application/json' };

    // Complete the engineering preparation through the durable command.
    const complete = await fetch(
      `${seeded.apiBase}/projects/${PROJECT_ID}/production-releases/${seeded.releaseId}/engineering:complete`,
      {
        method: 'POST',
        headers: { ...headers, 'If-Match': '"v1"', 'Idempotency-Key': 'flow-768-eng-complete-0001' },
      },
    );
    if (complete.status !== 200) throw new Error(`engineering complete failed: ${await complete.text()}`);

    // Caso C — materials derived for the exact release, not yet authorized.
    const derive = await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}/materials/derive`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ production_release_id: seeded.releaseId, lines: [] }),
    });
    if (derive.status !== 200) throw new Error(`derive failed: ${await derive.text()}`);

    await page.goto(`/orders/${PROJECT_ID}`);
    const materials = page.getByTestId('prod-fab-step-materials');
    await expect(materials).toBeVisible({ timeout: 45_000 });
    await expect(materials).toContainText('Materiales pendientes');
    await expect(materials).toHaveAttribute('aria-current', 'step');
    await expect(page.getByTestId('prod-fab-step-engineering')).toContainText('Completa');
    await expect(page.getByTestId('prod-fab-step-production')).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('prod-fab-authorize-materials')).toContainText('Autorizar materiales');
    // The CTA navigates to the EXISTING surface (Almacén), it does not
    // authorize anything from here.
    await page.getByTestId('prod-fab-authorize-materials').click();
    await expect(page).toHaveURL(/\/warehouse/);

    // Caso D — audited material authorization: ready, never "iniciada".
    const releaseMaterials = await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}/materials/release`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        production_release_id: seeded.releaseId,
        override_reason: 'E2E 768: materiales autorizados con faltantes registrados',
      }),
    });
    if (releaseMaterials.status !== 200) throw new Error(`materials release failed: ${await releaseMaterials.text()}`);

    await page.goto(`/orders/${PROJECT_ID}`);
    await expect(page.getByTestId('prod-fab-step-materials')).toContainText('Materiales autorizados', { timeout: 45_000 });
    const production = page.getByTestId('prod-fab-step-production');
    await expect(production).toContainText('Listo para producción');
    await expect(production).not.toContainText('En producción');
    await expect(page.getByTestId('prod-fab-next-text')).toHaveCount(0);

    // Caso E — ONE real physical fact flips the step; Project.status stays
    // draft the whole time.
    const advance = await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}/parts/${seeded.partId}/advance`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ operation_type: 'cut', operator_name: 'E2E 768' }),
    });
    if (advance.status !== 200) throw new Error(`advance failed: ${await advance.text()}`);

    await page.goto(`/orders/${PROJECT_ID}`);
    await expect(page.getByTestId('prod-fab-step-production')).toContainText('En producción', { timeout: 45_000 });

    const truth = await fetch(`${seeded.apiBase}/projects/${PROJECT_ID}`, { headers });
    const project = (await truth.json()) as { status: string };
    expect(project.status).toBe('draft');
    await browserErrors.assertEmpty('stepper cases C/D/E journey');
  });

  test('390/768/1280: el stepper no genera scroll lateral y el estado se ve primero', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await loginToA(page);

    const viewports = [
      { name: 'compact', width: 390, height: 844 },
      { name: 'medium', width: 768, height: 900 },
      { name: 'expanded', width: 1280, height: 800 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
      const engFlow = page.getByTestId('eng-fab-flow');
      await expect(engFlow).toBeVisible({ timeout: 45_000 });
      const engGeometry = await engFlow.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(engGeometry.scrollWidth).toBeLessThanOrEqual(engGeometry.clientWidth);

      await page.goto(`/orders/${PROJECT_ID}`);
      const hubFlow = page.getByTestId('prod-fab-flow');
      await expect(hubFlow).toBeVisible({ timeout: 45_000 });
      const hubGeometry = await hubFlow.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(hubGeometry.scrollWidth).toBeLessThanOrEqual(hubGeometry.clientWidth);

      // Document-level: no horizontal scroll forced by the surfaces.
      const documentOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(documentOverflow).toBeLessThanOrEqual(0);
    }
    await browserErrors.assertEmpty('stepper viewports journey');
  });
});
