import { expect, test } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

// #1534 — the gola profile editor v2 against the real backend: create
// «Gola L 8006» (discount 40 → the SERVER resolves «Mueble de 720: una
// puerta = 680»), create the «Italiana 70» (top + between, bevel of
// profundidad − 2, strip 70), and USE both from a grip style.

const HW_PROFILE_L = '71840000-0000-4000-8000-000000000003';
const HW_PROFILE_C = '71840000-0000-4000-8000-00000000000b';
const HW_SUPPORT = '71840000-0000-4000-8000-000000000004';
const HW_CAPS = '71840000-0000-4000-8000-000000000005';
const HW_STRIP = '71840000-0000-4000-8000-00000000000c';
const COMP_TIRA = '71840000-0000-4000-8000-00000000000d';
const STRUCT_TIRA = '71840000-0000-4000-8000-00000000000e';

async function uiClick(page: import('@playwright/test').Page, testId: string): Promise<void> {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await locator.evaluate((el) => (el as HTMLElement).click());
}

test('1534: el editor v2 crea Gola L (una puerta = 680), la Italiana 70 con bisel, y ambas se usan desde un estilo', async ({ page }) => {
  test.setTimeout(300_000);
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = owner.token;
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });

  // Catalog seed: the hardware the parts reference, the strip COMPONENT the
  // italiana mounts, and a structure wrapper for it (required by the save
  // validator).
  const catalog = await repository.getCatalog();
  const template = catalog.modules[0]!;
  await repository.saveCatalog({
    ...catalog,
    components: [
      ...(catalog.components ?? []).filter((c) => c.id !== COMP_TIRA),
      {
        id: COMP_TIRA,
        code: 'TIRA-1534',
        name: 'Tira italiana 70',
        placement: 'base' as const,
        geometry: { kind: 'rectangular_board' as const, lengthMm: 720, widthMm: 27, thicknessMm: 16 },
        defaultEdges: [],
        optionRoles: [],
        active: true,
      },
    ],
    structures: [
      ...(catalog.structures ?? []).filter((s) => s.id !== STRUCT_TIRA),
      {
        id: STRUCT_TIRA,
        code: 'EST-1534',
        name: 'Estructura tira',
        externalDims: { width: 600, height: 720, depth: 560 },
        components: [{ componentId: COMP_TIRA, quantity: 1 }],
        active: true,
      },
    ],
    hardware: [
      ...catalog.hardware.filter((h) => ![HW_PROFILE_L, HW_PROFILE_C, HW_SUPPORT, HW_CAPS, HW_STRIP].includes(h.id)),
      { id: HW_PROFILE_L, code: '8006-1534', name: 'Perfil GOLA L 8006', unit: 'meter' as const, costPerUnit: 100, active: true },
      { id: HW_PROFILE_C, code: '8007-1534', name: 'Perfil GOLA C 8007', unit: 'meter' as const, costPerUnit: 100, active: true },
      { id: HW_SUPPORT, code: 'SU116-1534', name: 'Soporte GOLA', unit: 'piece' as const, costPerUnit: 10, active: true },
      { id: HW_CAPS, code: 'CF8006TP-1534', name: 'Tapas GOLA', unit: 'piece' as const, costPerUnit: 5, active: true },
      { id: HW_STRIP, code: 'TIRA-1534', name: 'Tira italiana', unit: 'piece' as const, costPerUnit: 8, active: true },
    ],
  });

  // UI session.
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toBeVisible();
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();

  await page.goto('/catalogs/opening-profiles');

  // 1. «Gola L 8006»: material L, posición superior, descuento por la
  //    sugerencia del fabricante → la vista previa del SERVIDOR resuelve
  //    «Mueble de 720: una puerta = 680».
  await uiClick(page, 'opening-profile-create-btn');
  await page.getByTestId('gola-profile-code').fill('GOLA-L-8006-1534');
  await page.getByTestId('gola-profile-name').fill('Gola L 8006');
  await page.getByTestId('gola-profile-manufacturer').fill('SCILM');
  await uiClick(page, 'gola-material-l');
  await page.getByTestId('gola-profile-height').fill('56.5');
  await page.getByTestId('gola-profile-depth').fill('27.2');
  await uiClick(page, 'gola-discount-suggest-top');
  expect(await page.getByTestId('gola-discount-top').inputValue()).toBe('40');
  await expect(page.getByTestId('gola-profile-preview-una_puerta')).toContainText('Mueble de 720: una puerta = 680');
  await page.screenshot({ path: 'docs/demo/evidence/1534/editor-gola-l-preview.png', fullPage: true, animations: 'disabled' });

  // Piezas por rol.
  await uiClick(page, 'gola-part-profile');
  await page.getByRole('option', { name: /Perfil GOLA L 8006|8006-1534/ }).first().click();
  await uiClick(page, 'gola-part-supports');
  await page.getByRole('option', { name: /Soporte GOLA/ }).first().click();
  await page.getByTestId('gola-part-supports-spacing').fill('600');
  await uiClick(page, 'gola-part-endcaps');
  await page.getByRole('option', { name: /Tapas GOLA/ }).first().click();

  await uiClick(page, 'gola-profile-save');
  await expect(page.getByText('GOLA-L-8006-1534')).toBeVisible({ timeout: 15_000 });

  // 2. «Italiana 70»: melamina, superior + entre frentes, descuentos 36,
  //    efectos de fábrica, tira de componentes con alto 70 y bisel de
  //    profundidad − 2.
  await uiClick(page, 'opening-profile-create-btn');
  await page.getByTestId('gola-profile-code').fill('ITALIANA-70-1534');
  await page.getByTestId('gola-profile-name').fill('Italiana 70');
  await uiClick(page, 'gola-material-italiana');
  await expect(page.getByTestId('gola-position-top')).toBeChecked();
  await expect(page.getByTestId('gola-position-between')).toBeChecked();
  await expect(page.getByTestId('gola-discount-top')).toHaveValue('36');
  await expect(page.getByTestId('gola-discount-between')).toHaveValue('36');
  await expect(page.getByTestId('gola-effect-depth')).toBeChecked();
  await expect(page.getByTestId('gola-effect-notch')).toBeChecked();
  await expect(page.getByTestId('gola-effect-bevel')).toBeChecked();
  await page.getByTestId('gola-profile-depth').fill('27.2');
  await expect(page.getByTestId('gola-bevel-size')).toHaveValue('25.2'); // profundidad − 2
  await uiClick(page, 'gola-part-strip');
  await page.getByTestId('gola-part-strip').getByRole('textbox').fill('TIRA-1534');
  await page.getByTestId('gola-part-strip').getByRole('option', { name: /Tira/ }).first().click();
  await expect(page.getByTestId('gola-part-strip-height')).toHaveValue('70');

  await uiClick(page, 'gola-profile-save');
  await expect(page.getByText('ITALIANA-70-1534')).toBeVisible({ timeout: 15_000 });

  // 3. Ambos se usan desde un estilo: inferior = L arriba + Italiana entre
  //    frentes (creado por la API de #1533 que el editor de Ajustes usa).
  const list = await client.request<{ readonly id: string; readonly code: string }[]>('GET', '/catalog/opening-profiles', { token });
  const lId = list.find((p) => p.code === 'GOLA-L-8006-1534')!.id;
  const itId = list.find((p) => p.code === 'ITALIANA-70-1534')!.id;
  const style = await client.request<{ readonly id: string }>('POST', '/catalog/grip-styles', {
    token,
    body: {
      name: 'Estilo 1534',
      offered: true,
      isDefault: false,
      byFurnitureType: {
        inferior: { mode: 'gola', topProfileId: lId, betweenProfileId: itId },
        superior: { mode: 'handle' },
        alto: { mode: 'handle' },
      },
    },
  });
  expect(style.id).toBeTruthy();

  // Ajustes › Agarres muestra el estilo con ambos perfiles.
  await page.goto('/settings');
  await uiClick(page, 'settings-tab-tab-agarres');
  await expect(page.getByTestId('grip-styles-list')).toBeVisible({ timeout: 15_000 });
  const styleCard = page.locator('[data-testid^="grip-style-card-"]', { hasText: 'Estilo 1534' });
  await expect(styleCard).toBeVisible();
  const summary = await page
    .locator('[data-testid^="grip-style-summary-"]', { hasText: 'GOLA-L-8006-1534' })
    .first()
    .textContent();
  expect(summary).toContain('entre frentes');

  // Visual evidence (## Visual Evidence in the PR).
  await page.screenshot({ path: 'docs/demo/evidence/1534/agarres-estilo-1534.png', fullPage: true, animations: 'disabled' });
});
