import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #1032 transversal browser proof — the 5 CATÁLOGOS routes carry the audit's
 * UX parity contract over the real Go + PostgreSQL stack:
 *
 *   each route renders its list with a seeded row → the row's Editar action
 *   opens the IDENTITY modal («Editar <tipo> — CODE · NAME», K4) → and on
 *   edges the Desactivar action asks first (K2 ConfirmDialog, sampled live).
 *
 * The audit scored this group 19/40 (2026-10-04); K1-K5 shipped across
 * merged slices — this spec pins the visible contract browser-side.
 */

const MAT_ID = '5a170000-0000-4000-8000-000000001032';
const EDGE_ID = '5a170000-0000-4000-8000-000000001033';
const HW_ID = '5a170000-0000-4000-8000-000000001034';
const FIN_ID = '5a170000-0000-4000-8000-000000001035';
const FIN_CAT_ID = '5a170000-0000-4000-8000-000000001036';
const MAT_CODE = 'CAT-1032-TAB';
const EDGE_CODE = 'CAT-1032-CAN';
const HW_CODE = 'CAT-1032-HER';
const FIN_CODE = 'CAT-1032-ACA';

async function login(page: Page): Promise<void> {
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

/** Open the row's edit action and assert the K4 identity title. */
async function editFirstRowAndAssertIdentity(
  page: Page,
  code: string,
  expectedTitlePattern: RegExp,
): Promise<void> {
  // The row actions render on row hover — hover before clicking.
  await page.getByRole('row', { name: new RegExp(code) }).hover();
  await page.getByLabel(`Editar ${code}`, { exact: true }).click();
  const heading = page.getByRole('heading', { name: expectedTitlePattern });
  await expect(heading).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(heading).toHaveCount(0);
}

test.describe.serial('CATÁLOGOS — paridad UX en browser real (#1032)', () => {
  let seeded = false;

  test.beforeAll(async () => {
    const apiBase = required('ORGANIZATION_API_BASE');
    const client = new GraneteApiClient(apiBase);
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });
    const catalog = await repository.getCatalog();

    const ambientCategories = (catalog.ambientCategories ?? []).filter((c) => c.id !== FIN_CAT_ID);
    ambientCategories.push({ id: FIN_CAT_ID, name: 'Acabados 1032', sortOrder: 900 });

    await repository.saveCatalog({
      ...catalog,
      materials: [
        ...catalog.materials.filter((m) => m.id !== MAT_ID),
        {
          id: MAT_ID,
          code: MAT_CODE,
          name: 'Tablero paridad 1032',
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 18,
          grainDefault: true,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
      edges: [
        ...catalog.edges.filter((e) => e.id !== EDGE_ID),
        { id: EDGE_ID, code: EDGE_CODE, name: 'Canto paridad 1032', thicknessMm: 1, costPerMl: 3, active: true },
      ],
      hardware: [
        ...catalog.hardware.filter((h) => h.id !== HW_ID),
        { id: HW_ID, code: HW_CODE, name: 'Herraje paridad 1032', unit: 'piece' as const, costPerUnit: 10, active: true },
      ],
      ambientCategories,
      ambientMaterials: [
        ...(catalog.ambientMaterials ?? []).filter((m) => m.id !== FIN_ID),
        {
          id: FIN_ID,
          code: FIN_CODE,
          name: 'Acabado paridad 1032',
          categoryId: FIN_CAT_ID,
          active: true,
        },
      ],
    });
    seeded = true;
  });

  test('/materials — el editor abre con identidad código · nombre', async ({ page }) => {
    expect(seeded).toBe(true);
    await login(page);
    await page.goto('/materials');
    await expect(page.getByText(MAT_CODE).first()).toBeVisible();
    await editFirstRowAndAssertIdentity(page, MAT_CODE, /Editar material — CAT-1032-TAB · Tablero paridad 1032/);
  });

  test('/edges — identidad + Desactivar pide confirmación antes de actuar', async ({ page }) => {
    await login(page);
    await page.goto('/edges');
    await expect(page.getByText(EDGE_CODE).first()).toBeVisible();
    await editFirstRowAndAssertIdentity(page, EDGE_CODE, /Editar canto — CAT-1032-CAN · Canto paridad 1032/);
    // K2: the destructive action asks first — the modal stays open under the
    // dialog and nothing deactivates until confirmed.
    await page.getByRole('row', { name: new RegExp(EDGE_CODE) }).hover();
    await page.getByLabel(`Desactivar ${EDGE_CODE}`, { exact: true }).click();
    const dialog = page.getByTestId('edge-deactivate-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Canto paridad 1032')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(EDGE_CODE).first()).toBeVisible();
  });

  test('/hardware — el editor abre con identidad código · nombre', async ({ page }) => {
    await login(page);
    await page.goto('/hardware');
    await expect(page.getByText(HW_CODE).first()).toBeVisible();
    await editFirstRowAndAssertIdentity(page, HW_CODE, /Editar herraje — CAT-1032-HER · Herraje paridad 1032/);
  });

  test('/hardware-profiles — estado vacío con UN solo CTA de creación (K5)', async ({ page }) => {
    await login(page);
    await page.goto('/hardware-profiles');
    // The gate org ships no profiles: the truly-empty state owns the action
    // and the header must NOT duplicate it (K5, live).
    await expect(page.getByTestId('page-header').getByRole('heading', { name: 'Perfiles de herrajes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No hay perfiles de herrajes' })).toBeVisible();
    expect(await page.getByTestId('hardware-profile-create-btn').count()).toBe(0);
    await expect(page.getByRole('button', { name: 'Crear perfil' })).toBeVisible();
  });

  test('/finishes — el editor abre con identidad código · nombre', async ({ page }) => {
    await login(page);
    await page.goto('/finishes');
    await expect(page.getByText(FIN_CODE).first()).toBeVisible();
    await editFirstRowAndAssertIdentity(page, FIN_CODE, /Editar acabado — CAT-1032-ACA · Acabado paridad 1032/);
  });
});
