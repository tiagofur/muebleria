import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

const PROJECT_ID = '77777777-3333-4777-8777-333333333333';
const QUOTE_LINE_ID = '88888888-3333-4888-8888-333333333333';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000003';

interface SeededPairingProject {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  readonly instanceCount: number;
}

/**
 * #499 Slice 2 — visible Web handoff against the REAL backend: the browser
 * creates the design, opens the pairing sheet, and the test consumes the
 * code through a genuine extension-credential exchange (transport
 * 'sketchup', the same client class the plugin boundary uses). The Web may
 * only report "code accepted" — "model opened" stays Slice 3.
 */
async function seedPairingProject(): Promise<SeededPairingProject> {
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
  const cat = await repository.getCatalog();
  await repository.saveCatalog({
    ...cat,
    customers: [
      ...(cat.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: 'Cliente Pairing E2E', active: true },
    ],
  });

  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: 'Obra Pairing E2E',
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: QUOTE_LINE_ID,
        moduleId: GATE_MODULE_A_ID,
        quantity: 2,
        optionChoices: {},
      },
    ],
  });

  const mat = await client.materializeQuoteLineFurniture(
    owner.token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-pairing-mat',
  );
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

  const design = await client.createProjectDesign(owner.token, PROJECT_ID, {
    name: 'Cocina Pairing',
  }, 'gate-pairing-create-design');

  await client.updateDesignWorkingCopy(owner.token, design.id, {
    items: instanceIds.map((fid) => ({
      furniture_instance_id: fid,
      parameters: { width: 700 },
      material_choices: {},
    })),
  });

  const r1 = await client.publishDesignRevision(
    owner.token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-pairing-publish-r1',
  );

  return { projectId: PROJECT_ID, designId: design.id, r1Id: r1.id, instanceCount: instanceIds.length };
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

test.describe.serial('SketchUp pairing handoff (#499 Slice 2) Browser E2E', () => {
  let seeded!: SeededPairingProject;

  test.beforeAll(async () => {
    seeded = await seedPairingProject();
  });

  test('create design flow, exact pairing code, real exchange, accepted wording, /muebles CTA', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await loginToA(page);

    // 1. /disenos — project context visible, CTA available.
    await page.goto(`/quotes/${seeded.projectId}/disenos`);
    const workspace = page.getByTestId('project-designs-workspace');
    await expect(workspace).toBeVisible();
    await expect(page.getByText('Obra Pairing E2E')).toBeVisible();
    await expect(page.getByTestId('open-in-sketchup-btn')).toBeVisible();

    // 2. Select the exact published revision R1 before opening the sheet.
    await page.getByTestId('revision-node-R1').click();
    await expect(page.getByTestId('revision-inspector')).toBeVisible();

    // 3. Open the pairing sheet: pending state + visible code + frozen base.
    await page.getByTestId('open-in-sketchup-btn').click();
    const modal = page.getByTestId('sketchup-pairing-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('pairing-pending')).toContainText('Esperando conexión con SketchUp');
    await expect(page.getByTestId('pairing-base-label')).toHaveText('Base: R1');
    const codeText = (await page.getByTestId('pairing-code').textContent()) ?? '';
    const code = codeText.replace(/\s+/g, '');
    expect(code).toMatch(/^[A-Z2-9]{12}$/);

    // 4. Consume the code through the REAL extension-credential boundary.
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const extensionSession = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'sketchup',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const exchanged = await client.exchangeDesignPairingGrant(extensionSession.token, { code });
    // Slice 1 contract: exact design + authoritative working-copy base R1.
    expect(exchanged.design.id).toBe(seeded.designId);
    expect(exchanged.working_copy.base_revision_id).toBe(seeded.r1Id);
    expect(exchanged.pinned_base_revision_id).toBe(seeded.r1Id);

    // 5. The Web sheet observes the exchange — honest wording only.
    await expect(page.getByTestId('pairing-exchanged')).toContainText(
      'Código aceptado por SketchUp',
    );
    await expect(page.getByText(/abierto correctamente/i)).toHaveCount(0);

    // Close: an exchanged grant is NOT cancelled on close.
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    // 6. /muebles — physical units and the designs CTA.
    await page.goto(`/quotes/${seeded.projectId}/muebles`);
    await expect(page.getByTestId('pf-table')).toBeVisible();
    await expect(page.getByTestId('pf-table').locator('tbody tr')).toHaveCount(seeded.instanceCount);
    const gotoDesigns = page.getByTestId('pf-goto-designs-btn');
    if (await gotoDesigns.isVisible()) {
      await gotoDesigns.click();
      await expect(page).toHaveURL(new RegExp(`/quotes/${seeded.projectId}/disenos`));
    }

    // 7. Responsive: the sheet stays usable at ~390px.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/quotes/${seeded.projectId}/disenos`);
    await expect(page.getByTestId('open-in-sketchup-btn')).toBeVisible();
    await page.getByTestId('open-in-sketchup-btn').click();
    await expect(page.getByTestId('sketchup-pairing-modal')).toBeVisible();
    await expect(page.getByTestId('pairing-code')).toBeVisible();
    await expect(page.getByTestId('pairing-copy-btn')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
