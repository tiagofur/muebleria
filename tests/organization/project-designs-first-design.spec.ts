import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

const PROJECT_ID = '77777777-5555-4777-8777-555555555555';
const QUOTE_LINE_ID = '88888888-5555-4888-8888-555555555555';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000005';
const PLATFORM_PROJECT_ID = '77777777-6666-4777-8777-666666666666';
const PLATFORM_QUOTE_LINE_ID = '88888888-6666-4888-8888-666666666666';
const PLATFORM_CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000006';

/**
 * Regression: the first-Design DEMO path (Project → Create Design → Open in
 * SketchUp). An authenticated Admin (active workshop) on a Project with ZERO
 * designs must see "Crear primer diseño", create the Design through the
 * canonical API, get it selected and see "Abrir en SketchUp" — without a page
 * reload and without any injected canMutate flag (the real permission
 * derivation decides). Covers the workshop-Admin shapes observed manually:
 * the multi-membership admin and the platform Admin with an active workshop
 * (#616 authority model).
 */
async function seedZeroDesignProject(
  projectId: string,
  quoteLineId: string,
  customerId: string,
  projectName: string,
): Promise<void> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });
  const cat = await repository.getCatalog();
  await repository.saveCatalog({
    ...cat,
    customers: [
      ...(cat.customers ?? []).filter((c) => c.id !== customerId),
      { id: customerId, name: `Cliente ${projectName}`, active: true },
    ],
  });
  const now = new Date().toISOString();
  await repository.saveProject({
    id: projectId,
    name: projectName,
    customerId,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    items: [{ id: quoteLineId, moduleId: GATE_MODULE_A_ID, quantity: 1, optionChoices: {} }],
  });
}

async function loginMultiMembershipAdmin(page: Page): Promise<void> {
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

async function loginPlatformAdminWorkshopOwner(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('First Design creation from /disenos (zero-design Admin path)', () => {
  test.beforeAll(async () => {
    await seedZeroDesignProject(PROJECT_ID, QUOTE_LINE_ID, CUSTOMER_ID, 'Obra Primer Diseño E2E');
    await seedZeroDesignProject(
      PLATFORM_PROJECT_ID,
      PLATFORM_QUOTE_LINE_ID,
      PLATFORM_CUSTOMER_ID,
      'Obra Primer Diseño Platform E2E',
    );
  });

  test('multi-membership Admin: CTA visible, canonical create, selection and SketchUp handoff — no reload', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginMultiMembershipAdmin(page);

    await page.goto(`/quotes/${PROJECT_ID}/disenos`);
    await expect(page.getByTestId('project-designs-workspace')).toBeVisible();
    await expect(page.getByText('No hay diseños en esta obra')).toBeVisible();

    // Authorized Admin sees the creation CTA (the real permission derivation).
    const cta = page.getByRole('button', { name: 'Crear primer diseño' });
    await expect(cta).toBeVisible();
    // Zero designs: reconciliation dead-ends at #502's "Falta contexto" — hidden.
    await expect(page.getByTestId('open-reconciliation-btn')).toHaveCount(0);

    await cta.click();
    const nameInput = page.getByLabel(/Nombre de la alternativa/i);
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Diseño principal');
    await page.getByTestId('submit-create-design').click();

    // Server POST → refetch → the new Design is selected and the handoff CTA
    // appears. No reload, no local fabrication.
    await expect(page.getByRole('tab', { name: /Diseño principal/i })).toBeVisible();
    await expect(page.getByTestId('open-in-sketchup-btn')).toBeVisible();
    await expect(page.getByText('No hay diseños en esta obra')).toHaveCount(0);
  });

  test('platform Admin with active workshop keeps first-Design authority (#616 model)', async ({ page }) => {
    test.setTimeout(90_000);
    await loginPlatformAdminWorkshopOwner(page);

    await page.goto(`/quotes/${PLATFORM_PROJECT_ID}/disenos`);
    await expect(page.getByTestId('project-designs-workspace')).toBeVisible();
    await expect(page.getByText('No hay diseños en esta obra')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear primer diseño' })).toBeVisible();
  });
});
