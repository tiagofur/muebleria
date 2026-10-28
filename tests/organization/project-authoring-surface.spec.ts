import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000075';

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

async function seedCustomer(): Promise<{ apiBase: string; token: string }> {
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
  const cat = await repository.getCatalog();
  await repository.saveCatalog({
    ...cat,
    customers: [
      ...(cat.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: 'Cliente Superficie E2E', active: true },
    ],
  });
  return { apiBase, token: aOwner.token };
}

test.describe.serial('Project authoring surface (#1375) Browser E2E', () => {
  let apiBase!: string;
  let authToken!: string;
  let proyectarProjectId: string | null = null;
  let proyectarDesignId: string | null = null;

  test.beforeAll(async () => {
    const seeded = await seedCustomer();
    apiBase = seeded.apiBase;
    authToken = seeded.token;
  });

  test('React creates a project with default sketchup authoring surface', async ({ page }) => {
    test.setTimeout(90_000);
    await loginToA(page);
    await page.goto('/quotes');

    await page.getByRole('button', { name: /Nueva cotización/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Nueva cotización' })).toBeVisible();

    const surfaceSelect = page.getByTestId('project-authoring-surface');
    await expect(surfaceSelect).toBeVisible();
    await expect(surfaceSelect).toHaveValue('sketchup');

    // Inline customer
    await page.getByLabel('Nuevo cliente').check();
    await page.getByPlaceholder('Nombre del nuevo cliente').fill('Cliente Superficie E2E');

    await page.getByLabel('Nombre').fill('Obra Superficie SketchUp E2E');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

    // Open project detail from list
    await page.locator('.project-card__name', { hasText: 'Obra Superficie SketchUp E2E' }).click();
    await expect(page.getByTestId('project-authoring-surface-badge')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('project-authoring-surface-badge')).toHaveText('Autoría: SketchUp');
  });

  test('React creates a project with proyectar authoring surface', async ({ page }) => {
    test.setTimeout(90_000);
    await loginToA(page);
    await page.goto('/quotes');

    await page.getByRole('button', { name: /Nueva cotización/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Nueva cotización' })).toBeVisible();

    const surfaceSelect = page.getByTestId('project-authoring-surface');
    await surfaceSelect.selectOption('proyectar');
    await expect(surfaceSelect).toHaveValue('proyectar');

    // Inline customer
    await page.getByLabel('Nuevo cliente').check();
    await page.getByPlaceholder('Nombre del nuevo cliente').fill('Cliente Superficie Proyectar E2E');

    await page.getByLabel('Nombre').fill('Obra Superficie Proyectar E2E');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

    // Open project detail from list
    await page.locator('.project-card__name', { hasText: 'Obra Superficie Proyectar E2E' }).click();
    await expect(page.getByTestId('project-authoring-surface-badge')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('project-authoring-surface-badge')).toHaveText('Autoría: Proyectar');

    // Extract project ID from current URL (/quotes/:id)
    const url = page.url();
    const match = url.match(/\/quotes\/([a-f0-9-]+)/);
    expect(match).toBeTruthy();
    proyectarProjectId = match![1];

    // API readback confirms persistence of authoring_surface
    const res = await fetch(`${apiBase}/projects/${proyectarProjectId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.ok).toBeTruthy();
    const data = await res.json();
    expect(data.authoring_surface).toBe('proyectar');
  });

  test('server authority rejects SketchUp mutations on proyectar project', async () => {
    expect(proyectarProjectId).toBeTruthy();

    const client = new GraneteApiClient(apiBase);
    // Create a design for this project
    const design = await client.createProjectDesign(
      authToken,
      proyectarProjectId!,
      { name: 'Diseño Proyectar E2E' },
      'gate-1375-create-design',
    );
    proyectarDesignId = design.id;

    // Login as SketchUp extension client
    const sketchupSession = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'sketchup',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });

    // 1. Model binding validation returns capabilities: can_edit_working_copy = false
    const validateRes = await fetch(
      `${apiBase}/projects/${proyectarProjectId}/designs/${proyectarDesignId}/binding:validate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sketchupSession.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ client_schema_version: 1 }),
      },
    );
    expect(validateRes.ok).toBeTruthy();
    const validateData = await validateRes.json();
    expect(validateData.capabilities.can_edit_working_copy).toBe(false);
    expect(validateData.capabilities.can_publish_revision).toBe(false);
    expect(validateData.project.authoring_surface).toBe('proyectar');

    // 2. SketchUp extension attempting to update working copy is rejected with 403 Forbidden
    const putRes = await fetch(`${apiBase}/designs/${proyectarDesignId}/working-copy`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${sketchupSession.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_type: 'sketchup',
        items: [],
      }),
    });
    expect(putRes.status).toBe(403);
    const putError = await putRes.json();
    expect(putError.message).toContain('Proyectar');
  });
});
