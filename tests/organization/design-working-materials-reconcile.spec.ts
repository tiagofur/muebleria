import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #658 browser proof — reconciliar materiales pendientes del Design Working
 * Copy desde React contra Go + PostgreSQL reales.
 *
 * Fixture: un Project con una quote line cuyas option choices cotizan
 * FRENTES/INTERIOR; tres unidades materializadas. La working copy define
 * INTERIOR (authored) pero omite FRENTES en dos unidades (candidates) y
 * define todo en la tercera (authored-only, nunca reparable).
 *
 * Negativos: conflicto stale real (el borrador cambia entre lectura y
 * confirmación → 409 → recargar, nunca sobrescribir) y tenant denial
 * cross-org contra la API real.
 */

const PROJECT_ID = '77777777-4658-4777-8777-333333333358';
const QUOTE_LINE_ID = '88888888-4658-4888-8888-333333333358';
const CUSTOMER_ID = 'c0000000-4658-4000-8000-0000000000d3';
const QUOTED_MATERIAL_ID = 'c0000000-0000-4000-8000-0000000000d4';
const AUTHORED_MATERIAL_ID = 'c0000000-0000-4000-8000-0000000000d5';

interface SeededWorkingMaterials {
  readonly projectId: string;
  readonly designId: string;
  readonly instanceIds: readonly [string, string, string];
  readonly quotedMaterialName: string;
  readonly authoredMaterialName: string;
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

async function seedWorkingMaterials(): Promise<SeededWorkingMaterials> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });

  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => aOwner.token });
  const catalog = await repository.getCatalog();
  const quotedMaterial = {
    id: QUOTED_MATERIAL_ID,
    code: 'GATE-MAT-QUOTE',
    name: 'Roble cotizado E2E',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: false,
    boardPrice: 1000,
    wastePercent: 10,
    costPerM2: 223.88,
    active: true,
  };
  const authoredMaterial = {
    ...quotedMaterial,
    id: AUTHORED_MATERIAL_ID,
    code: 'GATE-MAT-AUTH',
    name: 'Melamina interior E2E',
  };
  await repository.saveCatalog({
    ...catalog,
    materials: [quotedMaterial, authoredMaterial],
    customers: [
      ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: 'Cliente Materiales E2E', active: true },
    ],
  });

  // Quote line carries the commercial truth for BOTH roles.
  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: 'Obra Materiales Pendientes E2E',
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
        optionChoices: {
          FRENTES: QUOTED_MATERIAL_ID,
          INTERIOR: AUTHORED_MATERIAL_ID,
        },
      },
    ],
  });

  const mat = await client.materializeQuoteLineFurniture(
    aOwner.token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-658-materialize-quote-line',
  );
  if (mat.instances.length !== 3) {
    throw new Error(`expected 3 materialized instances, got ${mat.instances.length}`);
  }
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id) as [string, string, string];

  const design = await client.createProjectDesign(
    aOwner.token,
    PROJECT_ID,
    { name: 'Cocina materiales pendientes' },
    'gate-658-create-design',
  );

  // Unit 1: INTERIOR authored, FRENTES missing → candidate.
  // Unit 2: nothing authored → both roles candidates.
  // Unit 3: fully authored → never offered repair.
  await client.updateDesignWorkingCopy(aOwner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600 }, material_choices: { INTERIOR: AUTHORED_MATERIAL_ID } },
      { furniture_instance_id: instanceIds[1], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 800 }, material_choices: {} },
      { furniture_instance_id: instanceIds[2], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 900 }, material_choices: { INTERIOR: AUTHORED_MATERIAL_ID, FRENTES: QUOTED_MATERIAL_ID } },
    ],
  });

  return {
    projectId: PROJECT_ID,
    designId: design.id,
    instanceIds,
    quotedMaterialName: quotedMaterial.name,
    authoredMaterialName: authoredMaterial.name,
  };
}

test.describe.serial('Design Working Copy materials reconciliation UI (#658) Browser E2E', () => {
  let seeded!: SeededWorkingMaterials;

  test.beforeAll(async () => {
    seeded = await seedWorkingMaterials();
  });

  test('detect → review provenance → repair unit → real read-back; authored unit never offered', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginToA(page);
    await page.goto(`/quotes/${seeded.projectId}/disenos?design=${seeded.designId}`);

    // 1. Contextual detection over the real projection.
    const strip = page.getByTestId('pending-materials-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('2 muebles tienen materiales cotizados que faltan en el borrador');

    // 2. Review: units, roles and honest provenance (current quote line, no
    //    invented historical revision).
    await page.getByTestId('review-pending-materials-btn').click();
    const modal = page.getByTestId('pending-materials-modal');
    await expect(modal).toBeVisible();

    const unit1 = modal.getByTestId(`pending-unit-${seeded.instanceIds[0]}`);
    await expect(unit1).toBeVisible();
    await expect(unit1.getByTestId(`pending-role-${seeded.instanceIds[0]}-FRENTES`)).toContainText(
      'Cotizado, falta en el borrador',
    );
    await expect(unit1.getByTestId(`pending-role-${seeded.instanceIds[0]}-FRENTES`)).toContainText(
      `Material cotizado actual: ${seeded.quotedMaterialName}`,
    );
    // Authored context travels with the unit but never gets a repair affordance.
    await expect(unit1.getByTestId(`pending-role-${seeded.instanceIds[0]}-INTERIOR`)).toContainText(
      'Elegido en el diseño',
    );
    await expect(unit1.getByTestId(`pending-role-${seeded.instanceIds[0]}-INTERIOR`)).toContainText(
      seeded.authoredMaterialName,
    );
    await expect(unit1.getByTestId(`pending-role-${seeded.instanceIds[0]}-INTERIOR`).getByRole('button')).toHaveCount(0);

    // The authored-only unit is not a candidate and never appears.
    await expect(modal.getByTestId(`pending-unit-${seeded.instanceIds[2]}`)).toHaveCount(0);

    // 3. Explicit confirmation of unit 1 (single-unit scope).
    await unit1.getByTestId(`repair-unit-${seeded.instanceIds[0]}`).click();
    const confirm = unit1.getByTestId(`repair-confirm-${seeded.instanceIds[0]}`);
    await expect(confirm).toContainText(`FRENTES → ${seeded.quotedMaterialName} (material cotizado actual)`);
    await expect(confirm).toContainText('Las elecciones ya definidas no se modifican.');
    await confirm.getByTestId(`confirm-repair-${seeded.instanceIds[0]}`).click();

    // 4. Server-authoritative success + real read-back through the same
    //    projection: the unit leaves the pending list (the transient success
    //    note may already be replaced by the refetch — disappearance IS the
    //    read-back proof).
    await expect(modal.getByTestId(`pending-unit-${seeded.instanceIds[0]}`)).toHaveCount(0, { timeout: 15_000 });
    await expect(strip).toContainText('1 mueble tiene materiales cotizados que faltan en el borrador');

    // 5. Repair the second unit and close the loop: honest empty state.
    const unit2 = modal.getByTestId(`pending-unit-${seeded.instanceIds[1]}`);
    await unit2.getByTestId(`repair-unit-${seeded.instanceIds[1]}`).click();
    await unit2.getByTestId(`confirm-repair-${seeded.instanceIds[1]}`).click();
    await expect(modal.getByTestId('pending-materials-empty')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('pending-materials-strip')).toHaveCount(0);

    // 6. The working copy really carries the reconciled choices (server truth,
    //    not local fabrication): the quoted role is now authored provenance.
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const aOwner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const provenance = await client.getDesignWorkingCopyMaterialProvenance(aOwner.token, seeded.designId);
    expect(provenance.items.filter((item) => item.reconcilable)).toHaveLength(0);
    for (const item of provenance.items) {
      const frentes = item.roles.find((role) => role.role === 'FRENTES');
      expect(frentes?.provenance).toBe('authored');
      expect(frentes?.working_choice).toBe(QUOTED_MATERIAL_ID);
    }

    // 7. Responsive smoke of the review surface at the three operational widths.
    await page.goto(`/quotes/${seeded.projectId}/disenos?design=${seeded.designId}`);
    await expect(page.getByTestId('pending-materials-strip')).toHaveCount(0);
    const originalViewport = page.viewportSize();
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `document overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
    if (originalViewport) await page.setViewportSize(originalViewport);
  });

  test('stale conflict: the working copy changed → 409 → reload offers review again, never overwrites', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const aOwner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });

    // Fresh design with one candidate unit.
    const design = await client.createProjectDesign(
      aOwner.token,
      PROJECT_ID,
      { name: 'Conflicto stale 658' },
      'gate-658-conflict-design',
    );
    await client.updateDesignWorkingCopy(aOwner.token, design.id, {
      items: [
        { furniture_instance_id: seeded.instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 600 }, material_choices: {} },
      ],
    });

    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}/disenos?design=${design.id}`);
    await page.getByTestId('review-pending-materials-btn').click();
    const modal = page.getByTestId('pending-materials-modal');
    const unit = modal.getByTestId(`pending-unit-${seeded.instanceIds[0]}`);
    await unit.getByTestId(`repair-unit-${seeded.instanceIds[0]}`).click();

    // Concurrent authoring save between the read and the confirm: the real
    // backend bumps the working-copy version the UI pinned.
    await client.updateDesignWorkingCopy(aOwner.token, design.id, {
      items: [
        { furniture_instance_id: seeded.instanceIds[0], furniture_definition_id: GATE_MODULE_A_ID, parameters: { widthMm: 610 }, material_choices: {} },
      ],
    });

    await unit.getByTestId(`confirm-repair-${seeded.instanceIds[0]}`).click();
    const conflict = unit.getByTestId(`repair-conflict-${seeded.instanceIds[0]}`);
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText('El diseño cambió mientras revisabas los materiales');
    await expect(unit.getByTestId(`repair-success-${seeded.instanceIds[0]}`)).toHaveCount(0);

    // No blind overwrite happened: the working copy keeps the concurrent
    // parameter (610) and the role is still missing server-side.
    let provenance = await client.getDesignWorkingCopyMaterialProvenance(aOwner.token, design.id);
    expect(provenance.items[0]!.reconcilable).toBe(true);
    const workingCopy = await client.getDesignWorkingCopy(aOwner.token, design.id);
    expect(workingCopy.items[0]!.parameters.widthMm).toBe(610);

    // Reload over the fresh projection → the repair is offered again and the
    // second confirmation (fresh token) succeeds against the real backend.
    await modal.getByTestId('reload-materials-btn').click();
    await expect(conflict).toHaveCount(0);
    await unit.getByTestId(`repair-unit-${seeded.instanceIds[0]}`).click();
    await unit.getByTestId(`confirm-repair-${seeded.instanceIds[0]}`).click();
    await expect(modal.getByTestId('pending-materials-empty')).toBeVisible({ timeout: 15_000 });

    provenance = await client.getDesignWorkingCopyMaterialProvenance(aOwner.token, design.id);
    expect(provenance.items[0]!.reconcilable).toBe(false);
    // The concurrent authored parameters survived the late repair.
    const workingCopyAfter = await client.getDesignWorkingCopy(aOwner.token, design.id);
    expect(workingCopyAfter.items[0]!.parameters.widthMm).toBe(610);
  });

  test('tenant denial: Org B cannot read or reconcile Org A working materials', async () => {
    test.setTimeout(60_000);
    const apiBase = required('ORGANIZATION_API_BASE');
    const bClient = new GraneteApiClient(apiBase);
    const bOwner = await bClient.login({
      email: required('ORGANIZATION_GATE_B_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_B_SLUG'),
    });

    const provenanceResponse = await fetch(
      `${apiBase}/designs/${seeded.designId}/working-copy/material-provenance`,
      { headers: { Authorization: `Bearer ${bOwner.token}` } },
    );
    expect(provenanceResponse.status).toBe(404);

    const reconcileResponse = await fetch(
      `${apiBase}/designs/${seeded.designId}/working-copy/material-choices:reconcile`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bOwner.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'gate-658-tenant-denial',
        },
        body: JSON.stringify({
          furniture_instance_id: seeded.instanceIds[0],
          expected_updated_at: null,
        }),
      },
    );
    expect(reconcileResponse.status).toBe(404);
    const payload = (await reconcileResponse.json()) as { code?: string };
    expect(payload.code).not.toBe('OK');
  });
});
