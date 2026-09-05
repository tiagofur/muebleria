import { expect, test, type Page } from '@playwright/test';
import type { Project } from '@granete/domain';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import {
  GATE_MODULE_A_ID,
  required,
} from './support/api';

const PROJECT_A_ID = '77777777-1111-4777-8777-111111111111';
const QUOTE_LINE_ID = '88888888-1111-4888-8888-111111111111';

interface SeededProjectFurniture {
  readonly projectId: string;
  readonly lineId: string;
  readonly instanceIds: readonly string[];
}

async function prepareProjectFurniture(): Promise<SeededProjectFurniture> {
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

  const customerId = 'c0000000-0000-4000-8000-000000000001';
  const catalog = await repository.getCatalog();
  await repository.saveCatalog({
    ...catalog,
    customers: [
      {
        id: customerId,
        name: 'Cliente Real A',
        active: true,
      },
    ],
  });

  // 1. Create Project in Org A with 1 QuoteLine of quantity=3
  const now = new Date().toISOString();
  const project: Project = {
    id: PROJECT_A_ID,
    name: 'Obra Cocina Muebles Gate',
    customerId,
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
        quantity: 3,
        optionChoices: {},
      },
    ],
  };
  await repository.saveProject(project);

  // 2. Materialize the QuoteLine into 3 distinct FurnitureInstances
  const mat = await client.materializeQuoteLineFurniture(
    aOwner.token,
    PROJECT_A_ID,
    QUOTE_LINE_ID,
    'gate-pf-mat-quote-line',
  );
  if (mat.instances.length !== 3) {
    throw new Error(`expected 3 materialized instances, got ${mat.instances.length}`);
  }
  const instanceIds = mat.instances.map((i) => i.furniture_instance_id);

  // 3. Create a Design and place only 2 of the 3 instances in the working copy (1 pending)
  const design = await client.createProjectDesign(
    aOwner.token,
    PROJECT_A_ID,
    { name: 'Cocina Principal' },
    'gate-pf-create-design',
  );

  await client.updateDesignWorkingCopy(aOwner.token, design.id, {
    items: [
      { furniture_instance_id: instanceIds[0]!, parameters: {}, material_choices: {} },
      { furniture_instance_id: instanceIds[1]!, parameters: {}, material_choices: {} },
    ],
  });

  return {
    projectId: PROJECT_A_ID,
    lineId: QUOTE_LINE_ID,
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

test.describe.serial('Project Furniture (#500 / WEB-DT-1) Browser E2E', () => {
  let seeded!: SeededProjectFurniture;

  test.beforeAll(async () => {
    seeded = await prepareProjectFurniture();
  });

  test('traceability: 3 units, Unidad i de 3, 2 placed / 1 pending, detail drawer, and tenant isolation', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // 1. Login to Org A
    await loginToA(page);

    // 2. Navigate to Project Furniture matrix
    await page.goto(`/quotes/${seeded.projectId}/muebles`);
    const table = page.getByTestId('pf-table');
    await expect(table).toBeVisible();

    // 3. Exactly 3 rows rendered, one per physical unit
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3);

    // 4. Verify distinct FurnitureInstance IDs (server-authoritative identity)
    for (const id of seeded.instanceIds) {
      await expect(page.getByTestId(`pf-row-${id}`)).toBeVisible();
    }

    // 5. Verify quantity grouping provenance: Unidad i de 3
    await expect(table.getByText('Unidad 1 de 3')).toBeVisible();
    await expect(table.getByText('Unidad 2 de 3')).toBeVisible();
    await expect(table.getByText('Unidad 3 de 3')).toBeVisible();

    // 6. Verify contextual presence: 2 placed in design, 1 pending
    const placedRows = table.locator('tbody tr', { hasText: 'En el diseño' });
    const pendingRows = table.locator('tbody tr', { hasText: 'Pendiente de colocar' });
    await expect(placedRows).toHaveCount(2);
    await expect(pendingRows).toHaveCount(1);

    // Summary cards reflect backend-projected counts
    await expect(page.getByTestId('pf-summary-active')).toContainText('3');
    await expect(page.getByTestId('pf-summary-placed')).toContainText('2');
    await expect(page.getByTestId('pf-summary-pending')).toContainText('1');
    await expect(page.getByTestId('pf-summary-attention')).toContainText('1');

    // 7. Open detail drawer for the pending physical unit (instanceIds[2])
    const pendingRow = page.getByTestId(`pf-row-${seeded.instanceIds[2]}`);
    await pendingRow.getByRole('button', { name: /detalle/i }).click();

    const drawer = page.getByTestId('pf-detail-modal');
    await expect(drawer).toBeVisible();
    // Physical identity and technical ID displayed
    await expect(drawer.locator('.pf-tech-id', { hasText: seeded.instanceIds[2] })).toBeVisible();
    // Provenance QuoteLine ID displayed
    await expect(drawer.locator('.pf-tech-id', { hasText: seeded.lineId })).toBeVisible();
    // Contextual presence
    await expect(drawer.getByText('Pendiente de colocar')).toBeVisible();

    // Close detail drawer
    await drawer.getByRole('button', { name: 'Cerrar' }).click();
    await expect(drawer).not.toBeVisible();

    // 8. Tenant isolation: switch to Organization B
    await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');

    // Navigate to Org A's project under Org B session
    await page.goto(`/quotes/${seeded.projectId}/muebles`);

    // Org B does not have access: uniform not-found / access denied, zero units leaked
    await expect(
      page.getByText('La obra no existe o no es accesible desde tu organización.'),
    ).toBeVisible();
    await expect(page.getByTestId('pf-table')).toHaveCount(0);
  });
});
