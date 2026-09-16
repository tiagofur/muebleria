import { expect, test, type Download, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { allowLoggedOutSessionProbe, collectBrowserErrors } from './support/browserErrors';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #740 PR 1 — browser E2E of the DURABLE per-release Engineering state:
 *
 *   P1 created (supported API) → workspace shows Pendiente → user starts
 *   Engineering (explicit CTA) → En proceso → preparing the frozen plan and
 *   downloading PDF/PTX does NOT complete anything → user completes
 *   Engineering (explicit CTA, final) → Completa with the honest next stage →
 *   reload keeps the durable fact → zero material authorization, zero
 *   physical work, Project.status stays draft.
 *
 * The physical gate itself is the SECOND delivery of #740; this spec pins the
 * durable state lifecycle and the read/export neutrality only.
 */

const PROJECT_ID = '99997777-cccc-4777-8777-7777777777f0';
const QUOTE_LINE_ID = '99998888-cccc-4888-8888-8888888888f0';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-0000000000f0';
const STATE_MAT = '73000000-0000-4000-8000-0000000000f3';
const STATE_MAT_CODE = 'ENG-740-BOARD';
const STATE_PANEL = '74000000-0000-4000-8000-0000000000f4';
const STATE_STRUCT = '72000000-0000-4000-8000-0000000000f2';
const STATE_BODY_ROLE = 'ENG-740-BODY';
const STATE_CHOICES: Record<string, string> = {};

interface SeededEngineeringState {
  readonly projectId: string;
  readonly releaseId: string;
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

async function fetchEngineeringState(seeded: SeededEngineeringState): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${seeded.apiBase}/projects/${seeded.projectId}/production-releases/${seeded.releaseId}/engineering`,
    { headers: { Authorization: `Bearer ${seeded.token}` } },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function fetchProjectTruth(seeded: SeededEngineeringState): Promise<Record<string, unknown>> {
  const response = await fetch(`${seeded.apiBase}/projects/${seeded.projectId}`, {
    headers: { Authorization: `Bearer ${seeded.token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

test.describe.serial('Engineering durable state: P1 → start → prepare/download → complete (#740 PR 1)', () => {
  let seeded!: SeededEngineeringState;

  test.beforeAll(async () => {
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
    STATE_CHOICES[STATE_BODY_ROLE] = STATE_MAT;
    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials.filter((m) => m.id !== STATE_MAT),
        {
          id: STATE_MAT,
          code: STATE_MAT_CODE,
          name: 'Tablero Estado Ingeniería',
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
        ...catalog.optionGroups.filter((g) => g.code !== STATE_BODY_ROLE),
        { id: 'aaa77740-0000-4000-8000-0000000000f5', code: STATE_BODY_ROLE, name: 'Cuerpo 740', kind: 'board' as const, required: true, optionIds: [STATE_MAT] },
      ],
      structures: [
        ...(catalog.structures ?? []).filter((s) => s.id !== STATE_STRUCT),
        {
          id: STATE_STRUCT,
          code: 'ENG-740-STRUCT',
          name: 'Cuerpo Estado Ingeniería',
          externalDims: { width: 600, height: 720, depth: depthMm },
          components: [{ componentId: STATE_PANEL, quantity: 1 }],
          active: true,
        },
      ],
      components: [
        ...(catalog.components ?? []).filter((c) => c.id !== STATE_PANEL),
        {
          id: STATE_PANEL,
          code: 'ENG-740-PANEL',
          name: 'Panel Estado Ingeniería',
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
          optionRoles: [STATE_BODY_ROLE],
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== template.id),
        {
          ...template,
          id: template.id,
          structureId: STATE_STRUCT,
          components: [],
          hardwareLines: [],
          externalDims: { width: 600, height: 720, depth: depthMm },
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente Estado Ingeniería E2E', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra Estado Ingeniería E2E',
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
          optionChoices: STATE_CHOICES,
        },
      ],
    });

    const mat = await client.materializeQuoteLineFurniture(
      owner.token,
      PROJECT_ID,
      QUOTE_LINE_ID,
      'eng-state-materialize-line',
    );
    const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

    const design = await client.createProjectDesign(
      owner.token,
      PROJECT_ID,
      { name: 'Cocina Estado Ingeniería' },
      'eng-state-create-design',
    );
    await client.updateDesignWorkingCopy(owner.token, design.id, {
      items: instanceIds.map((instanceId) => ({
        furniture_instance_id: instanceId,
        furniture_definition_id: template.id,
        parameters: { widthMm: 600, heightMm: 720, depthMm },
        material_choices: { [STATE_BODY_ROLE]: STATE_MAT },
      })),
    });
    const r1 = await client.publishDesignRevision(owner.token, design.id, {
      source_type: 'manual',
      base_revision_id: null,
    }, 'eng-state-publish-r1');

    const q1 = await client.createInitialProjectQuoteRevision(owner.token, PROJECT_ID, {
      notes: 'Estado de Ingeniería — revisión inicial',
    }, 'eng-state-q1-create');
    await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'eng-state-q1-publish');
    await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'eng-state-q1-accept');

    const approved = await client.approveProjectDesignRevisionForProduction(
      owner.token,
      PROJECT_ID,
      design.id,
      r1.id,
      { quoteRevisionId: q1.id },
      'eng-state-approve-r1-q1',
    );
    if (approved.status !== 'approved') throw new Error(`R1 not approved: ${approved.status}`);

    // P1 through the supported release command (the release UI flow is pinned
    // by engineering-entry.spec.ts; this spec owns the engineering state).
    const release = await client.createProductionRelease(
      owner.token,
      PROJECT_ID,
      { design_revision_id: r1.id, quote_revision_id: q1.id },
      'eng-state-release-p1',
    );

    seeded = { projectId: PROJECT_ID, releaseId: release.id, token: owner.token, apiBase };
  });

  test('P1 creado → Ingeniería aparece Pendiente con CTA Iniciar', async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await loginToA(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);

    await expect(page.getByTestId('eng-release-context')).toContainText('Liberación #1');
    await expect(page.getByTestId('eng-entry-status')).toContainText('Pendiente');
    const start = page.getByTestId('eng-start-engineering');
    await expect(start).toBeVisible();
    await expect(start).toContainText('Iniciar Ingeniería');
    await expect(page.getByTestId('eng-complete-engineering')).toHaveCount(0);
    // The durable read itself wrote nothing.
    const state = await fetchEngineeringState(seeded);
    expect(state['status']).toBe('pending');
    expect(state['version']).toBe(0);
    await browserErrors.assertEmpty('engineering pending journey');
  });

  test('Iniciar Ingeniería → En proceso durable que sobrevive recarga', async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await loginToA(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);

    await page.getByTestId('eng-start-engineering').click();
    await expect(page.getByTestId('eng-entry-status')).toContainText('En proceso');
    await expect(page.getByTestId('eng-start-engineering')).toHaveCount(0);
    const complete = page.getByTestId('eng-complete-engineering');
    await expect(complete).toBeVisible();
    await expect(complete).toContainText('Completar Ingeniería');
    // The command also refreshes the workspace read model (queue/dashboard
    // chip). Let it settle before navigating: an in-flight refresh aborted by
    // the reload is console noise, not part of the journey.
    await page.waitForLoadState('networkidle');

    // Server truth: durable in_progress with the server actor.
    const state = await fetchEngineeringState(seeded);
    expect(state['status']).toBe('in_progress');
    expect(state['version']).toBe(1);
    expect(state['started_by']).toBeTruthy();

    // Reload keeps the durable state; the queue card shows it too.
    await page.reload();
    await expect(page.getByTestId('eng-entry-status')).toContainText('En proceso');
    await page.goto('/engineering');
    const card = page.getByTestId('eng-project-' + PROJECT_ID);
    await expect(card).toBeVisible();
    await expect(card).toContainText('En proceso');

    // Starting changed ONLY the engineering fact: no acceptance, no produced
    // stamp, no materials release, no physical executions.
    const truth = await fetchProjectTruth(seeded);
    expect(truth['status']).toBe('draft');
    expect(truth['materials_release']).toBeFalsy();
    expect(truth['part_instances']).toBeFalsy();
    await browserErrors.assertEmpty('engineering start journey');
  });

  test('descargar PDF/PTX del plan NO completa Ingeniería automáticamente', async ({ page }) => {
    test.setTimeout(180_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await loginToA(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);
    await page.getByTestId('eng-tab-optimizacion').click();

    // Prepare the frozen plan (#739 stays available while in progress).
    await page.getByRole('button', { name: /Generar Plan de Corte 2D/i }).click();
    await expect(page.getByTestId('prod-opt-summary')).toContainText('tablero');
    await page.getByRole('button', { name: /Guardar Plan/i }).click();
    await expect(page.getByTestId('prod-opt-save-ok')).toBeVisible();

    const downloads: Download[] = [];
    const capture = (download: Download): void => { downloads.push(download); };
    page.on('download', capture);
    await page.getByTestId('prod-opt-export-pdf-manual').click();
    await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(1);
    await page.getByTestId('prod-opt-export-ptx').click();
    await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(2);
    page.off('download', capture);
    const pdfName = downloads[0]!.suggestedFilename();
    expect(pdfName.endsWith('.pdf')).toBe(true);
    expect(downloads[1]!.suggestedFilename().endsWith('.ptx')).toBe(true);

    // Exports are preparation: the durable state is still in_progress.
    await expect(page.getByTestId('eng-entry-status')).toContainText('En proceso');
    const state = await fetchEngineeringState(seeded);
    expect(state['status']).toBe('in_progress');
    expect(state['completed_at']).toBeFalsy();
    await browserErrors.assertEmpty('pdf/ptx neutrality journey');
  });

  test('Completar Ingeniería → Completa final con siguiente etapa honesta; recarga conserva', async ({ page }) => {
    test.setTimeout(120_000);
    const browserErrors = collectBrowserErrors(page, { allow: allowLoggedOutSessionProbe });
    await loginToA(page);
    await page.goto(`/engineering/${PROJECT_ID}?release=${seeded.releaseId}`);

    await page.getByTestId('eng-complete-engineering').click();
    await expect(page.getByTestId('eng-entry-status')).toContainText('Completa');
    // Same pacing as the start command: let the workspace refresh settle.
    await page.waitForLoadState('networkidle');
    const fact = page.getByTestId('eng-engineering-completed');
    await expect(fact).toContainText('Ingeniería completa');
    await expect(fact).toContainText('autorización de materiales (pendiente)');
    // Completion is final: no further engineering CTAs.
    await expect(page.getByTestId('eng-start-engineering')).toHaveCount(0);
    await expect(page.getByTestId('eng-complete-engineering')).toHaveCount(0);

    // Server truth: final completion with actor + timestamp, version bumped.
    const state = await fetchEngineeringState(seeded);
    expect(state['status']).toBe('completed');
    expect(state['version']).toBe(2);
    expect(state['completed_by']).toBeTruthy();
    expect(state['completed_at']).toBeTruthy();

    // Reload keeps the durable fact; the queue shows the obra still in
    // Engineering (materials are a separate, still-pending authority).
    await page.reload();
    await expect(page.getByTestId('eng-entry-status')).toContainText('Completa');
    await expect(page.getByTestId('eng-engineering-completed')).toContainText('Ingeniería completa');
    await page.goto('/engineering');
    await expect(page.getByTestId('eng-project-' + PROJECT_ID)).toContainText('Completa');

    // Completion authorized NOTHING else: no materials, no physical work, no
    // produced stamp, no stock, no part executions.
    const truth = await fetchProjectTruth(seeded);
    expect(truth['status']).toBe('draft');
    expect(truth['materials_release']).toBeFalsy();
    expect(truth['material_planning']).toBeFalsy();
    expect(truth['part_instances']).toBeFalsy();
    await browserErrors.assertEmpty('engineering complete journey');
  });
});
