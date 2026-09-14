import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const PROJECT_ID = '71400000-0000-4000-8000-000000000001';
const BASE_CUSTOMER_ID = '71400000-0000-4000-8000-000000000002';
const BASE_CUSTOMER_NAME = 'Cliente base 714';
const INLINE_CUSTOMER_NAME = 'Ana López 714';

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page
    .getByRole('textbox', { name: 'Contraseña', exact: true })
    .fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(
    page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText(
    'Browser Gate A',
  );
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await tour.isVisible()) {
    await tour.getByRole('button', { name: 'Omitir' }).click();
  }
}

test.describe.serial('#714 inline customer project update', () => {
  let repository: APIWorkspaceRepository;

  test.beforeAll(async () => {
    const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const session = await client.login({
      email: required('ORGANIZATION_GATE_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
      getAccessToken: () => session.token,
    });
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      customers: [
        ...(catalog.customers ?? []).filter(
          (customer) => customer.id !== BASE_CUSTOMER_ID,
        ),
        { id: BASE_CUSTOMER_ID, name: BASE_CUSTOMER_NAME, active: true },
      ],
    });
    const now = new Date().toISOString();
    await repository.createProject({
      id: PROJECT_ID,
      name: 'Cotización editable 714',
      customerId: BASE_CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [],
      createdAt: now,
      updatedAt: now,
    });
  });

  test('edits a draft with one new customer and keeps the persisted relation after refresh', async ({ page }) => {
    await loginToA(page);
    await page.goto('/quotes');
    const card = page.getByTestId(`project-card-${PROJECT_ID}`);
    await expect(card).toBeVisible();
    await card.click();
    await page.getByRole('button', { name: /^Editar$/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Editar cotización' }),
    ).toBeVisible();
    await page.getByLabel('Nuevo cliente').check();
    await page
      .getByRole('textbox', { name: 'Cliente', exact: true })
      .fill(INLINE_CUSTOMER_NAME);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('✓ Cambios guardados')).toBeVisible();

    await page.reload();
    await page.goto('/quotes');
    await page.getByTestId(`project-card-${PROJECT_ID}`).click();
    await expect(page.getByText(INLINE_CUSTOMER_NAME).first()).toBeVisible();

    const [projects, catalog] = await Promise.all([
      repository.getProjects(),
      repository.getCatalog(),
    ]);
    const project = projects.find((candidate) => candidate.id === PROJECT_ID);
    const matches = (catalog.customers ?? []).filter(
      (customer) => customer.name === INLINE_CUSTOMER_NAME,
    );
    expect(matches).toHaveLength(1);
    expect(project?.customerId).toBe(matches[0]!.id);
  });
});
