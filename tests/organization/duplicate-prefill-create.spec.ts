import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const COMP_ID = '5a161000-0000-4000-8000-000000000001';
const AGR_ID = '5a161000-0000-4000-8000-000000000002';
const MOD_ID = '5a161000-0000-4000-8000-000000000003';
const CUST_ID = '5a161000-0000-4000-8000-000000000004';
const PROJ_ID = '5a161000-0000-4000-8000-000000000005';
const ITEM_ID = '5a161000-0000-4000-8000-000000000006';

async function fetchOwnerToken(): Promise<string> {
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return aOwner.token;
}

async function loginOwnerA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', {
    timeout: 15_000,
  });
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) {
    await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  }
}

test.describe.serial('#1610 — duplicar como crear prellenado en navegador real', () => {
  test.beforeAll(async () => {
    const apiBase = required('ORGANIZATION_API_BASE');
    const token = await fetchOwnerToken();
    const repository = new APIWorkspaceRepository(apiBase, {
      getAccessToken: () => token,
    });
    const catalog = await repository.getCatalog();
    const boardRole =
      catalog.optionGroups.find((g) => g.kind === 'board')?.code ??
      catalog.optionGroups[0]?.code ??
      'FRENTE';

    await repository.saveCatalog({
      ...catalog,
      components: [
        ...(catalog.components ?? []).filter(
          (c) => c.id !== COMP_ID && c.code !== 'COM-1610-BASE' && c.code !== 'COM-1610-CUSTOM',
        ),
        {
          id: COMP_ID,
          code: 'COM-1610-BASE',
          name: 'Puerta Base 1610',
          placement: 'puerta',
          geometry: { kind: 'rectangular_board', lengthMm: 717, widthMm: 396, thicknessMm: 18 },
          defaultEdges: [
            { side: 'L1', enabled: true },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRoles: [boardRole],
          notes: 'Nota base 1610',
          active: true,
        },
      ],
      agregados: [
        ...(catalog.agregados ?? []).filter(
          (a) => a.id !== AGR_ID && a.code !== 'AGR-1610-BASE' && a.code !== 'AGR-1610-CUSTOM',
        ),
        {
          id: AGR_ID,
          code: 'AGR-1610-BASE',
          name: 'Cajón Base 1610',
          externalDims: { width: 500, height: 180, depth: 450 },
          components: [],
          hardwareLines: [],
          notes: 'Nota agregado 1610',
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter(
          (m) => m.id !== MOD_ID && m.code !== 'MOD-1610-BASE' && m.code !== 'MOD-1610-CUSTOM',
        ),
        {
          id: MOD_ID,
          code: 'MOD-1610-BASE',
          name: 'Mueble Base 1610',
          externalDims: { width: 600, height: 720, depth: 560 },
          hardwareLines: [],
          notes: 'Nota mueble 1610',
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUST_ID),
        { id: CUST_ID, name: 'Cliente 1610', active: true },
      ],
    });

    const now = new Date().toISOString();
    await repository.deleteProject(PROJ_ID).catch(() => undefined);
    await repository.createProject({
      id: PROJ_ID,
      name: 'Cotización Base 1610',
      customerId: CUST_ID,
      currency: 'MXN',
      marginFactor: 1.35,
      laborFixedCost: 100,
      status: 'draft',
      notes: 'Nota cotización 1610',
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: ITEM_ID,
          moduleId: MOD_ID,
          quantity: 2,
          optionChoices: {},
        },
      ],
    });

    const createProfileRes = await fetch(`${apiBase}/catalog/opening-profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: 'profile.gola-1610-base',
        code: 'GOLA-1610-BASE',
        name: 'Gola Base 1610',
        grip_type: 'gola',
        cross_section_shape: 'L',
        material: 'aluminum',
        compatible_placements: ['top'],
        front_discount_top_mm: 40,
        profile_height_mm: 56.5,
        profile_depth_mm: 27.2,
        datasheet_status: 'pending',
        body_modifiers: [{ role: 'horizontal', effect: 'depth_reduction' }],
        bom_members: {},
        active: true,
      }),
    });
    expect([201, 409]).toContain(createProfileRes.status);
  });

  test('Componentes: Duplicar abre /components/new/edit prellenado con -COPY editable y persiste', async ({ page }) => {
    test.setTimeout(90_000);
    await loginOwnerA(page);
    await page.goto('/components');

    await page.getByTestId('component-card-COM-1610-BASE').click();
    await page.getByRole('button', { name: /^Más$/i }).click();
    await page.getByRole('menuitem', { name: /^Duplicar$/i }).click();

    await expect(page).toHaveURL(/\/components\/new\/edit$/);
    const codeInput = page.getByTestId('input-code');
    await expect(codeInput).toBeEnabled();
    await expect(codeInput).toHaveValue('COM-1610-BASE-COPY');
    await expect(page.getByTestId('input-name')).toHaveValue('Puerta Base 1610 (copia)');

    await codeInput.fill('COM-1610-CUSTOM');
    await page.getByTestId('input-name').fill('Puerta Custom 1610');
    await page.getByTestId('save-btn').click();

    await expect(page.getByTestId('component-card-COM-1610-CUSTOM')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('component-card-COM-1610-CUSTOM')).toBeVisible({ timeout: 15_000 });
  });

  test('Agregados: Duplicar abre editor prellenado con -COPY editable y persiste', async ({ page }) => {
    test.setTimeout(90_000);
    await loginOwnerA(page);
    await page.goto('/add-ons');

    await page.getByTestId('agregado-card-AGR-1610-BASE').click();
    await page.getByRole('button', { name: /^Más$/i }).click();
    await page.getByRole('menuitem', { name: /^Duplicar$/i }).click();

    const codeInput = page.getByTestId('agregado-field-code');
    await expect(codeInput).toBeVisible();
    await expect(codeInput).toHaveValue('AGR-1610-BASE-COPY');
    await expect(page.getByTestId('agregado-field-name')).toHaveValue('Cajón Base 1610 (copia)');

    await codeInput.fill('AGR-1610-CUSTOM');
    await page.getByTestId('agregado-field-name').fill('Cajón Custom 1610');
    await page.getByTestId('agregado-save-btn').click();

    await expect(page.getByTestId('agregado-card-AGR-1610-CUSTOM')).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByTestId('agregado-card-AGR-1610-CUSTOM')).toBeVisible({ timeout: 15_000 });
  });

  test('Muebles: Duplicar abre /modules/new/edit prellenado con -COPY editable y persiste', async ({ page }) => {
    test.setTimeout(90_000);
    await loginOwnerA(page);
    await page.goto('/modules');

    await page.getByTestId(`module-card-${MOD_ID}`).click();
    await page.getByRole('button', { name: /^Más$/i }).click();
    await page.getByRole('menuitem', { name: /^Duplicar$/i }).click();

    await expect(page).toHaveURL(/\/modules\/new\/edit$/);
    const codeInput = page.getByTestId('input-code');
    await expect(codeInput).toBeEnabled();
    await expect(codeInput).toHaveValue('MOD-1610-BASE-COPY');

    await codeInput.fill('MOD-1610-CUSTOM');
    await page.getByLabel('Nombre').fill('Mueble Custom 1610');
    await page.getByTestId('module-editor-save').click();

    await expect(page.getByText('MOD-1610-CUSTOM').first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText('MOD-1610-CUSTOM').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Cotizaciones: Duplicar abre ventana previa editable y clona los ítems al guardar', async ({ page }) => {
    test.setTimeout(90_000);
    await loginOwnerA(page);
    await page.goto(`/quotes/${PROJ_ID}`);

    await page.getByRole('button', { name: /^Más$/i }).click();
    await page.getByRole('menuitem', { name: /^Duplicar$/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByLabel('Nombre');
    await expect(nameInput).toHaveValue('Cotización Base 1610 (copia)');
    await nameInput.fill('Cotización Custom 1610');
    await dialog.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.locator('.ui-modal-root')).toHaveCount(0, { timeout: 15_000 });
    await page.goto('/quotes');
    const customCard = page.getByRole('button', { name: /Cotización Custom 1610/i });
    await expect(customCard).toBeVisible({ timeout: 15_000 });
    await customCard.click();
    await expect(page.getByText('Mueble Base 1610').first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText('Mueble Base 1610').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Perfiles de apertura: Duplicar deriva id del código editado al guardar', async ({ page }) => {
    test.setTimeout(90_000);
    await loginOwnerA(page);
    await page.goto('/opening-profiles');

    const row = page.getByRole('row', { name: /GOLA-1610-BASE/ });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.hover();
    await row.getByRole('button', { name: 'Duplicar GOLA-1610-BASE' }).click();

    const codeInput = page.getByTestId('gola-profile-code');
    await expect(codeInput).toHaveValue('GOLA-1610-BASE-COPY');
    await codeInput.fill('GOLA-1610-CUSTOM');
    await page.getByTestId('gola-profile-save').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('.ui-modal-root')).toHaveCount(0, { timeout: 20_000 });

    await expect(page.getByRole('row', { name: /GOLA-1610-CUSTOM/ })).toBeVisible({ timeout: 15_000 });
    const verifyToken = await fetchOwnerToken();
    const listRes = await fetch(`${required('ORGANIZATION_API_BASE')}/catalog/opening-profiles`, {
      headers: { Authorization: `Bearer ${verifyToken}` },
    });
    expect(listRes.status).toBe(200);
    const profiles = (await listRes.json()) as Array<{ id: string; code: string }>;
    const created = profiles.find((p) => p.code === 'GOLA-1610-CUSTOM');
    expect(created?.id).toBe('profile.gola-1610-custom');
  });
});
