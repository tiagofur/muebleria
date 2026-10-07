import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #1046 S1 aceptación #5 — real browser E2E (Chromium + Go + PostgreSQL, sin
 * mocks): una puerta con bisagras POR GRUPO de opciones, la elección Blum
 * hecha EN EL PROYECTO (picker de la línea, pre-Q1) y, congelada la Q1,
 * demanda y precio EXACTOS visibles en el detalle.
 *
 * Números del navegador (módulo sin MO modular): 2 unidades × 2 bisagras
 * Blum $40 → herrajes 160, venta 160*1.5 + 100 (MO fija) = 340. El delta
 * Blum↔económica con montos exactos (160/728 vs 48/560 con MO modular 100)
 * está probado en PostgreSQL real en quote_commercial_snapshot_test.go.
 *
 * Verdades del producto respetadas (#642/#1124): sin Q1 el aside muestra la
 * autoridad ("Creá Q1") y el picker de la línea es editable; con Q1 el
 * picker se congela (canEditContent exige autoridad vacía) y los totales
 * visibles son la autoridad congelada — nunca un preview que estime.
 */

const HWG_PROJECT = '66666666-1111-4777-8777-111111111111';
const HWG_LINE = '66666666-2222-4777-8777-222222222222';
const HWG_CUSTOMER = 'c0000000-0000-4000-8000-000000006666';
const HWG_BLUM = '66666666-3333-4777-8777-333333333333';
const HWG_ECO = '66666666-4444-4777-8777-444444444444';
const HWG_GROUP = '66666666-5555-4777-8777-555555555555';
const HWG_MODULE = '66666666-6666-4777-8777-666666666666';

async function loginOwner(): Promise<{ token: string }> {
  return new GraneteApiClient(required('ORGANIZATION_API_BASE')).login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('#1046 — bisagra por grupo: elección en proyecto con demanda y precio exactos', () => {
  let owner!: { token: string };
  let client!: GraneteApiClient;

  test.beforeAll(async () => {
    client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    owner = await loginOwner();
  });

  test('elegir Blum en el proyecto y ver demanda y precio exactos congelados en Q1', async ({ page }) => {
    test.setTimeout(180_000);
    const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
      getAccessToken: () => owner.token,
    });
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      hardware: [
        ...(catalog.hardware ?? []).filter((h) => h.id !== HWG_BLUM && h.id !== HWG_ECO),
        { id: HWG_BLUM, code: 'HWG-BLUM', name: 'Bisagra Blum CL', unit: 'piece', costPerUnit: 40, active: true },
        { id: HWG_ECO, code: 'HWG-ECO', name: 'Bisagra económica', unit: 'piece', costPerUnit: 12, active: true },
      ],
      optionGroups: [
        ...catalog.optionGroups.filter((g) => g.id !== HWG_GROUP),
        {
          id: HWG_GROUP,
          code: 'BISAGRA',
          name: 'Bisagras',
          kind: 'hardware',
          required: true,
          optionIds: [HWG_BLUM, HWG_ECO],
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== HWG_MODULE),
        {
          id: HWG_MODULE,
          code: 'HWG-MOD',
          name: 'Puerta HWG E2E',
          externalDims: { width: 700, height: 400, depth: 18 },
          components: [],
          hardwareLines: [{ id: 'hwg-line-1', quantity: 2, optionRole: 'BISAGRA' }],
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== HWG_CUSTOMER),
        { id: HWG_CUSTOMER, name: 'Cliente HWG E2E', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.saveProject({
      id: HWG_PROJECT,
      name: 'Puertas HWG E2E',
      customerId: HWG_CUSTOMER,
      currency: 'MXN',
      marginFactor: 1.5,
      laborFixedCost: 100,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [{ id: HWG_LINE, moduleId: HWG_MODULE, quantity: 2, optionChoices: {} }],
    });

    await loginToA(page);
    await page.goto(`/quotes/${HWG_PROJECT}`);

    // Sin elección y sin Q1: el picker del grupo ofrece el default por
    // heredar y a ambos miembros — elegir en el proyecto es un gesto real.
    const choice = page.getByTestId(`item-choice-${HWG_LINE}-BISAGRA`);
    await expect(choice).toBeVisible({ timeout: 20_000 });
    await expect(choice.locator('option')).toHaveCount(3); // heredar + 2 miembros

    // La elección Blum hecha EN EL PROYECTO, desde la UI.
    await choice.selectOption(HWG_BLUM);
    await expect(choice).toHaveValue(HWG_BLUM);

    // Q1 congela la verdad comercial con esa elección.
    const q1 = await client.createInitialProjectQuoteRevision(owner.token, HWG_PROJECT, {
      notes: 'HWG — revisión inicial con Blum',
    }, 'hwg-q1-create-2026');
    expect(q1.revisionNumber).toBe(1);

    // Demanda y precio EXACTOS visibles, congelados en la autoridad.
    await page.reload();
    const totals = page.locator('.project-totals');
    await expect(totals).toContainText('$340.00', { timeout: 20_000 });
    // Herrajes: la demanda exacta de la elección (2 uds × 2 bisagras × $40).
    await expect(totals).toContainText('Herrajes$160.00 MXN');

    // La verdad congelada lleva la elección por grupo en cada unidad.
    const revisions = await client.listProjectQuoteRevisions(owner.token, HWG_PROJECT);
    const frozen = revisions.find((r) => r.id === q1.id);
    expect(frozen?.status).toBe('draft');
    for (const item of frozen?.items ?? []) {
      expect(item.materialChoices['BISAGRA']).toBe(HWG_BLUM);
    }
  });
});
