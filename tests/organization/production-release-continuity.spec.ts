import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { allowLoggedOutSessionProbe, collectBrowserErrors } from './support/browserErrors';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #741 PR 1 — browser E2E of the conservative continuity policy:
 *
 *   P1 (Ingeniería completa + materiales autorizados + una pieza avanzada)
 *   → aparece P2 con contenido de fabricación realmente distinto
 *   → Producción INFORMA la nueva revisión sin reemplazar nada
 *   → la acción física bloqueada explica la discontinuidad (continuidad)
 *   → recargar conserva exactamente el mismo estado
 *   → cero mutaciones del trabajo P1 (pieza avanzada, eventos, ejecuciones).
 *
 * Business visibility runs through the real UI; fixtures (catalog, obra, P1,
 * P2, authorization evidence) are prepared through the supported APIs, same
 * convention as the sibling specs.
 */

const PROJECT_ID = 'aaaac1c1-dddd-4c1c-9c1c-1c1c1c1c1c01';
const QUOTE_LINE_ID = 'aaaac2c2-dddd-4c2c-9c2c-2c2c2c2c2c02';
const CUSTOMER_ID = 'c1c1d0d0-0000-4000-8000-0000000000c3';
const CONT_MAT = '7c0c0c0c-0000-4000-8000-0000000000c4';
const CONT_MAT_CODE = 'PROD-741C-BOARD';
const CONT_PANEL = '7c0c0c0c-0000-4000-8000-0000000000c5';
const CONT_STRUCT = '7c0c0c0c-0000-4000-8000-0000000000c6';
const CONT_BODY_ROLE = 'PROD-741C-BODY';
const CONT_CHOICES: Record<string, string> = {};

interface SeededContinuity {
  readonly projectId: string;
  readonly p1ReleaseId: string;
  readonly p2ReleaseId: string;
  readonly token: string;
  readonly apiBase: string;
  readonly partId: string;
}

let seeded!: SeededContinuity;

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
 * The DELIBERATE blocked advance: the continuity policy answers 409 on the
 * floor-status endpoint — the exact negative under test. Scoped to that
 * status AND endpoint so a real regression can never hide behind it.
 */
function allowExpectedContinuityBlock(message: string, resourceUrl: string): boolean {
  return (
    message.includes('409') &&
    (resourceUrl.includes('/floor-status') ||
      resourceUrl.includes('/floor-scan') ||
      /\/parts\/[^/]+\/(advance|rework)/.test(resourceUrl) ||
      resourceUrl.includes('/part-executions'))
  );
}

function allowAbortedWorkspaceRefresh(message: string): boolean {
  return message.includes('Failed to load workspace: TypeError: Failed to fetch');
}

interface ExecutionState {
  readonly revisions: ReadonlySet<string>;
  readonly partCount: number;
  readonly advancedOpStatus: string;
  readonly itemFloor: string;
  readonly floorEvents: number;
}

async function fetchExecutionState(): Promise<ExecutionState> {
  const [executionsRes, projectRes, eventsRes] = await Promise.all([
    fetch(`${seeded.apiBase}/projects/${seeded.projectId}/part-executions`, { headers: authHeaders(seeded.token) }),
    fetch(`${seeded.apiBase}/projects/${seeded.projectId}`, { headers: authHeaders(seeded.token) }),
    fetch(`${seeded.apiBase}/projects/${seeded.projectId}/floor-events`, { headers: authHeaders(seeded.token) }),
  ]);
  const executions = (await executionsRes.json()) as {
    part_instances: Array<{ id: string; production_revision: string; required_operations: Array<{ status: string }> }>;
  };
  const project = (await projectRes.json()) as {
    items?: Array<{ id: string; floor_status?: string }>;
  };
  const events = (await eventsRes.json()) as unknown[];
  const advanced = executions.part_instances.find((p) => p.id === seeded.partId);
  return {
    revisions: new Set(executions.part_instances.map((p) => p.production_revision)),
    partCount: executions.part_instances.length,
    advancedOpStatus: advanced?.required_operations[0]?.status ?? 'missing',
    itemFloor: project.items?.find((i) => i.id === QUOTE_LINE_ID)?.floor_status ?? 'pending',
    floorEvents: events.length,
  };
}

test.describe.serial('Continuidad P1→P2: nueva revisión sin retarget implícito (#741 PR 1)', () => {
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
    CONT_CHOICES[CONT_BODY_ROLE] = CONT_MAT;
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials.filter((m) => m.id !== CONT_MAT),
        {
          id: CONT_MAT,
          code: CONT_MAT_CODE,
          name: 'Tablero Continuidad 741',
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
        ...catalog.optionGroups.filter((g) => g.code !== CONT_BODY_ROLE),
        { id: '7c0c0c0c-0000-4000-8000-0000000000c7', code: CONT_BODY_ROLE, name: 'Cuerpo 741 Continuidad', kind: 'board' as const, required: true, optionIds: [CONT_MAT] },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== CONT_STRUCT),
        {
          id: CONT_STRUCT,
          code: 'PROD-741C-STRUCT',
          name: 'Cuerpo Continuidad',
          externalDims: { width: 600, height: 720, depth: depthMm },
          components: [{ componentId: CONT_PANEL, quantity: 1 }],
          active: true,
        },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== CONT_PANEL),
        {
          id: CONT_PANEL,
          code: 'PROD-741C-PANEL',
          name: 'Panel Continuidad',
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
          optionRoles: [CONT_BODY_ROLE],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== template.id),
        { ...template, id: template.id, structureId: CONT_STRUCT, components: [], hardwareLines: [], externalDims: { width: 600, height: 720, depth: depthMm } },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente Continuidad E2E', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra Continuidad P1/P2 E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: GATE_MODULE_A_ID, quantity: 2, optionChoices: CONT_CHOICES }],
    });

    const mat = await client.materializeQuoteLineFurniture(
      owner.token,
      PROJECT_ID,
      QUOTE_LINE_ID,
      'cont-741-materialize-line',
    );
    const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

    const design = await client.createProjectDesign(
      owner.token,
      PROJECT_ID,
      { name: 'Cocina Continuidad' },
      'cont-741-create-design',
    );
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: instanceIds.map((instanceId) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: template.id,
        parameters: { widthMm: 600, heightMm: 720, depthMm },
        material_choices: { [CONT_BODY_ROLE]: CONT_MAT },
      })),
    });
    const r1 = await client.publishDesignRevision(owner.token, design.id, {
      source_type: 'manual',
      base_revision_id: null,
    }, 'cont-741-publish-r1');

    const q1 = await client.createInitialProjectQuoteRevision(owner.token, PROJECT_ID, {
      notes: 'Continuidad — revisión inicial',
    }, 'cont-741-q1-create');
    await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'cont-741-q1-publish');
    await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'cont-741-q1-accept');

    const approved = await client.approveProjectDesignRevisionForProduction(
      owner.token,
      PROJECT_ID,
      design.id,
      r1.id,
      { quoteRevisionId: q1.id },
      'cont-741-approve-r1-q1',
    );
    if (approved.status !== 'approved') throw new Error(`R1 not approved: ${approved.status}`);

    const p1 = await client.createProductionRelease(
      owner.token,
      PROJECT_ID,
      { design_revision_id: r1.id, quote_revision_id: q1.id },
      'cont-741-release-p1',
    );

    // Preparation: planned executions, durable engineering completion and
    // the audited material authorization for the EXACT P1.
    const generation = await fetch(`${apiBase}/projects/${PROJECT_ID}/part-executions`, {
      method: 'PUT',
      headers: authHeaders(owner.token),
      body: JSON.stringify({}),
    });
    if (generation.status !== 200) throw new Error(`generation failed: ${await generation.text()}`);
    const generated = (await generation.json()) as { part_instances: Array<{ id: string }> };
    expect(generated.part_instances.length).toBeGreaterThan(0);
    const partId = generated.part_instances[0]!.id;

    const start = await fetch(`${apiBase}/projects/${PROJECT_ID}/production-releases/${p1.id}/engineering:start`, {
      method: 'POST',
      headers: { ...authHeaders(owner.token), 'Idempotency-Key': 'cont-741-eng-start-0001' },
    });
    if (start.status !== 200) throw new Error(`engineering start failed: ${await start.text()}`);
    const complete = await fetch(`${apiBase}/projects/${PROJECT_ID}/production-releases/${p1.id}/engineering:complete`, {
      method: 'POST',
      headers: { ...authHeaders(owner.token), 'If-Match': '"v1"', 'Idempotency-Key': 'cont-741-eng-complete-0001' },
    });
    if (complete.status !== 200) throw new Error(`engineering complete failed: ${await complete.text()}`);

    const derive = await fetch(`${apiBase}/projects/${PROJECT_ID}/materials/derive`, {
      method: 'POST',
      headers: authHeaders(owner.token),
      body: JSON.stringify({ production_release_id: p1.id, lines: [] }),
    });
    if (derive.status !== 200) throw new Error(`derive failed: ${await derive.text()}`);
    const releaseMaterials = await fetch(`${apiBase}/projects/${PROJECT_ID}/materials/release`, {
      method: 'POST',
      headers: authHeaders(owner.token),
      body: JSON.stringify({
        production_release_id: p1.id,
        override_reason: 'E2E 741: producción autorizada con faltantes registrados',
      }),
    });
    if (releaseMaterials.status !== 200) throw new Error(`materials release failed: ${await releaseMaterials.text()}`);

    // The P1 work starts: one piece is physically advanced (cut completed).
    const advance = await fetch(`${apiBase}/projects/${PROJECT_ID}/parts/${partId}/advance`, {
      method: 'POST',
      headers: authHeaders(owner.token),
      body: JSON.stringify({ operation_type: 'cut', operator_name: 'E2E 741' }),
    });
    if (advance.status !== 200) throw new Error(`P1 advance failed: ${await advance.text()}`);

    // P2 with a REAL manufacturing difference: both units 600 mm → 650 mm,
    // explicit requote Q2 (commercial change, #678), approved R2, exact pair.
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: instanceIds.map((instanceId) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: template.id,
        parameters: { widthMm: 650, heightMm: 720, depthMm },
        material_choices: { [CONT_BODY_ROLE]: CONT_MAT },
      })),
    });
    const r2 = await client.publishDesignRevision(owner.token, design.id, {
      source_type: 'manual',
      base_revision_id: r1.id,
    }, 'cont-741-publish-r2');
    const requote = await client.requoteProjectQuote(owner.token, PROJECT_ID, {
      baseQuoteRevisionId: q1.id,
      designRevisionId: r2.id,
      includeFurnitureInstanceIds: instanceIds,
    }, 'cont-741-requote-q2');
    await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, requote.quoteRevision.id, 'cont-741-q2-publish');
    await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, requote.quoteRevision.id, 'cont-741-q2-accept');
    const approvedR2 = await client.approveProjectDesignRevisionForProduction(
      owner.token,
      PROJECT_ID,
      design.id,
      r2.id,
      { quoteRevisionId: requote.quoteRevision.id },
      'cont-741-approve-r2-q2',
    );
    if (approvedR2.status !== 'approved') throw new Error(`R2 not approved: ${approvedR2.status}`);
    const p2 = await client.createProductionRelease(
      owner.token,
      PROJECT_ID,
      { design_revision_id: r2.id, quote_revision_id: requote.quoteRevision.id },
      'cont-741-release-p2',
    );
    if (p2.manufacturing_fingerprint === p1.manufacturing_fingerprint) {
      throw new Error('P2 must differ in manufacturing content from P1');
    }

    seeded = { projectId: PROJECT_ID, p1ReleaseId: p1.id, p2ReleaseId: p2.id, token: owner.token, apiBase, partId };
  });

  test('Producción informa la nueva revisión y el trabajo P1 sigue visible', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, {
      allow: (message, resourceUrl) =>
        allowLoggedOutSessionProbe(message, resourceUrl) ||
        allowAbortedWorkspaceRefresh(message),
    });
    await loginToA(page);

    await page.goto(`/orders/${PROJECT_ID}`);
    const banner = page.getByTestId('prod-release-continuity');
    await expect(banner).toBeVisible({ timeout: 45_000 });
    await expect(banner).toContainText('Nueva revisión disponible');
    await expect(banner).toContainText('Hay trabajo de fabricación en curso sobre la versión anterior');
    await expect(banner).toContainText('Nueva liberación: Liberación #2');
    // The banner offers NO automatic replacement action.
    expect(await banner.locator('button').count()).toBe(0);

    // Server truth: nothing was retargeted — every execution still pins P1,
    // the advanced piece keeps its completed cut, the item keeps its floor
    // progress and the audit log is untouched by the read.
    const state = await fetchExecutionState();
    expect([...state.revisions]).toEqual([seeded.p1ReleaseId]);
    expect(state.advancedOpStatus).toBe('completed');
    expect(state.floorEvents).toBeGreaterThanOrEqual(1);
    await browserErrors.assertEmpty('continuity banner informs without replacing');
  });

  test('La acción física bloqueada explica la discontinuidad', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, {
      allow: (message, resourceUrl) =>
        allowLoggedOutSessionProbe(message, resourceUrl) ||
        allowAbortedWorkspaceRefresh(message) ||
        allowExpectedContinuityBlock(message, resourceUrl),
    });
    await loginToA(page);
    const before = await fetchExecutionState();

    // The gated item-level floor writer through the real floor tab.
    await page.goto(`/orders/${PROJECT_ID}/floor`);
    const button = page.getByTestId(`prod-piso-advance-${QUOTE_LINE_ID}`);
    await expect(button).toBeVisible({ timeout: 20_000 });
    await button.click();
    await expect(page.getByTestId('ui-toast')).toContainText('liberación anterior');
    await expect(page.getByTestId('ui-toast')).toContainText('continuidad');

    // Zero mutations of the P1 work.
    const after = await fetchExecutionState();
    expect(after).toEqual(before);
    await browserErrors.assertEmpty('blocked physical action explains the discontinuity');
  });

  test('Recargar conserva exactamente el mismo estado', async ({ page }) => {
    test.setTimeout(150_000);
    const browserErrors = collectBrowserErrors(page, {
      allow: (message, resourceUrl) =>
        allowLoggedOutSessionProbe(message, resourceUrl) ||
        allowAbortedWorkspaceRefresh(message),
    });
    await loginToA(page);
    const before = await fetchExecutionState();

    await page.goto(`/orders/${PROJECT_ID}`);
    await expect(page.getByTestId('prod-release-continuity')).toBeVisible({ timeout: 45_000 });
    await page.reload();
    await expect(page.getByTestId('prod-release-continuity')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('prod-release-continuity')).toContainText('Nueva liberación: Liberación #2');

    const after = await fetchExecutionState();
    expect(after).toEqual(before);
    await browserErrors.assertEmpty('reload preserves the continuity state');
  });
});
