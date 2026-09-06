import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import {
  GATE_MODULE_A_ID,
  required,
} from './support/api';

const PROJECT_ID = '77777777-2222-4777-8777-222222222222';
const QUOTE_LINE_ID = '88888888-2222-4888-8888-222222222222';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000002';

interface SeededProjectDesigns {
  readonly projectId: string;
  readonly designId: string;
  readonly r1Id: string;
  readonly r2Id: string;
  readonly instanceIds: readonly [string, string, string];
}

async function prepareProjectDesigns(): Promise<SeededProjectDesigns> {
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
  await repository.saveCatalog({
    ...catalog,
    customers: [
      {
        id: CUSTOMER_ID,
        name: 'Cliente Diseños E2E',
        active: true,
      },
    ],
  });

  // 1. Create Project in Org A with 1 QuoteLine of quantity=3
  const now = new Date().toISOString();
  const project = {
    id: PROJECT_ID,
    name: 'Obra Diseños e Historial E2E',
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

  // 2. Materialize the QuoteLine into 3 distinct FurnitureInstances (FI-A, FI-B, FI-C)
  const mat = await client.materializeQuoteLineFurniture(
    aOwner.token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-pd-mat-quote-line',
  );
  if (mat.instances.length !== 3) {
    throw new Error(`expected 3 materialized instances, got ${mat.instances.length}`);
  }
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id) as [string, string, string];

  // 3. Create Design A
  const design = await client.createProjectDesign(
    aOwner.token,
    PROJECT_ID,
    { name: 'Cocina Integral' },
    'gate-pd-create-design',
  );

  // 4. Update Working Copy with FI-A and FI-B
  await client.updateDesignWorkingCopy(aOwner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0], parameters: { width: 600 }, material_choices: {} },
      { furniture_instance_id: instanceIds[1], parameters: { width: 800 }, material_choices: {} },
    ],
  });

  // 5. Authoritatively publish R1 (contains FI-A and FI-B)
  const r1 = await client.publishDesignRevision(
    aOwner.token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-pd-publish-r1',
  );

  // 6. Update Working Copy after R1 to add FI-C (now 3 items)
  await client.updateDesignWorkingCopy(aOwner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0], parameters: { width: 600 }, material_choices: {} },
      { furniture_instance_id: instanceIds[1], parameters: { width: 800 }, material_choices: {} },
      { furniture_instance_id: instanceIds[2], parameters: { width: 900 }, material_choices: {} },
    ],
  });

  // 7. Authoritatively publish R2 (contains FI-A, FI-B, and FI-C)
  const r2 = await client.publishDesignRevision(
    aOwner.token,
    design.id,
    { source_type: 'manual', base_revision_id: r1.id },
    'gate-pd-publish-r2',
  );

  return {
    projectId: PROJECT_ID,
    designId: design.id,
    r1Id: r1.id,
    r2Id: r2.id,
    instanceIds,
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

test.describe.serial('Project Designs & Immutable Revisions (#501 / WEB-DT-2) Browser E2E', () => {
  let seeded!: SeededProjectDesigns;

  test.beforeAll(async () => {
    seeded = await prepareProjectDesigns();
  });

  test('lineage R1->R2, pinned historical snapshot R1 vs R2, reload stability, and tenant isolation', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // 1. Login to Org A
    await loginToA(page);

    // 2. Navigate to Project Designs workspace
    await page.goto(`/quotes/${seeded.projectId}/disenos`);
    await expect(page.getByTestId('project-designs-workspace')).toBeVisible();

    // 3. Alternatives switcher displays Cocina Integral
    await expect(page.getByRole('tab', { name: 'Cocina Integral' })).toBeVisible();

    // 4. Lineage timeline displays R1 and R2
    const timeline = page.getByTestId('design-lineage-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.getByTestId('revision-node-R1')).toBeVisible();
    await expect(timeline.getByTestId('revision-node-R2')).toBeVisible();

    // 5. Select R1 explicitly
    await timeline.getByTestId('revision-node-R1').click();
    await expect(page).toHaveURL(new RegExp(`design=${seeded.designId}`));
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r1Id}`));

    const inspector = page.getByTestId('revision-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { level: 2, name: /Revisión R1/i })).toBeVisible();

    // R1 exactness: exactly 2 items (FI-A and FI-B), FI-C absent
    const itemsTable = inspector.getByTestId('revision-items-table');
    await expect(itemsTable.locator('tbody tr')).toHaveCount(2);
    await expect(itemsTable.getByTitle(seeded.instanceIds[0])).toBeVisible();
    await expect(itemsTable.getByTitle(seeded.instanceIds[1])).toBeVisible();
    await expect(itemsTable.getByTitle(seeded.instanceIds[2])).toHaveCount(0);

    // 6. Select R2 explicitly
    await timeline.getByTestId('revision-node-R2').click();
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r2Id}`));
    await expect(inspector.getByRole('heading', { level: 2, name: /Revisión R2/i })).toBeVisible();

    // R2 exactness: exactly 3 items (FI-A, FI-B, and FI-C)
    await expect(itemsTable.locator('tbody tr')).toHaveCount(3);
    await expect(itemsTable.getByTitle(seeded.instanceIds[0])).toBeVisible();
    await expect(itemsTable.getByTitle(seeded.instanceIds[1])).toBeVisible();
    await expect(itemsTable.getByTitle(seeded.instanceIds[2])).toBeVisible();

    // 7. Select R1 again and verify historical reload stability
    await timeline.getByTestId('revision-node-R1').click();
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r1Id}`));
    await expect(itemsTable.locator('tbody tr')).toHaveCount(2);

    // Reload browser page
    await page.reload();

    // Post-reload: R1 remains pinned, URL still contains rev=r1Id, item count is 2, FI-C absent
    await expect(page).toHaveURL(new RegExp(`rev=${seeded.r1Id}`));
    await expect(page.getByRole('heading', { level: 2, name: /Revisión R1/i })).toBeVisible();
    const reloadedTable = page.getByTestId('revision-items-table');
    await expect(reloadedTable.locator('tbody tr')).toHaveCount(2);
    await expect(reloadedTable.getByTitle(seeded.instanceIds[0])).toBeVisible();
    await expect(reloadedTable.getByTitle(seeded.instanceIds[1])).toBeVisible();
    await expect(reloadedTable.getByTitle(seeded.instanceIds[2])).toHaveCount(0);

    // 8. Tenant isolation: switch to Organization B
    await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');

    // Navigate to Org A's Project Design URL under Org B session
    await page.goto(`/quotes/${seeded.projectId}/disenos?design=${seeded.designId}&rev=${seeded.r1Id}`);

    // Org B does not have access. The RLS-enforced tenant context prevents data from Org A
    // from being returned. The UI must show an error, empty state, or no workspace at all —
    // never the actual design names, revision lineage, or item data from Org A.
    // We wait for the page to stabilize (5s), then verify the invariants.
    await page.waitForTimeout(5000);

    // Core negative proofs: zero Org A data ever appears in the Org B session
    await expect(page.getByText('Cocina Integral')).toHaveCount(0);
    await expect(page.getByTestId('design-lineage-timeline')).toHaveCount(0);
    await expect(page.getByTestId('revision-items-table')).toHaveCount(0);

    // Positive proof: the workspace renders an accessible state (error or empty — not Org A data)
    const workspaceOrError = page.locator(
      '[data-testid="project-designs-workspace"], .pd-error-container',
    );
    // Either the workspace is absent (another nav guard caught it) or it shows an error/empty state.
    // The absence of Org A data is the enforcement boundary.
    const workspaceCount = await workspaceOrError.count();
    if (workspaceCount > 0) {
      // If a workspace rendered, it must be in an error or empty state — NOT showing Org A data
      await expect(page.getByTestId('revision-inspector')).toHaveCount(0);
      await expect(page.getByTestId('revision-items-table')).toHaveCount(0);
    }
  });
});
