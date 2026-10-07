import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #1215: a hardware pinned by live references cannot be deactivated from the
 * catalog UI. Against the real Go backend + PostgreSQL container:
 *
 * 1. Seed (API): an unreferenced hardware and a hardware pinned by a module
 *    template hardware line.
 * 2. Browser: deactivating the in-use hardware resolves the confirm dialog
 *    and the server refuses with 409 — the toast carries the server's
 *    reference counts (not a generic connection error) and the row stays
 *    active under the default Activos filter.
 * 3. Browser: the unreferenced hardware deactivates normally and comes back
 *    through the Inactivos filter's Reactivar action.
 */

// Fixture ids must be well-formed UUIDs: the catalog endpoints take uuid
// path parameters, and a malformed id aborts the request's tenant transaction.
const HW_IN_USE_ID = 'c1111111-1111-4111-8111-111111111101';
const HW_IN_USE_CODE = 'HW-INUSE-GUARD-E2E';
const HW_FREE_ID = 'c1111111-1111-4111-8111-111111111102';
const HW_FREE_CODE = 'HW-FREE-GUARD-E2E';
const MODULE_ID = 'c1111111-1111-4111-8111-111111111103';
const MODULE_LINE_ID = 'c1111111-1111-4111-8111-111111111104';

async function getApi() {
  const base = required('ORGANIZATION_API_BASE');
  const loginResponse = await new GraneteApiClient(base).login({
    email: required('ORGANIZATION_GATE_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return {
    repository: new APIWorkspaceRepository(base, {
      getAccessToken: () => loginResponse.token,
    }),
  };
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
}

test.describe.serial('Hardware in-use deactivation guard (#1215) browser E2E', () => {
  test('refuses deactivation of a referenced hardware and allows the free cycle', async ({ page }) => {
    test.setTimeout(120_000);

    const { repository } = await getApi();
    const catalog = await repository.getCatalog();
    const template = catalog.modules[0]!;
    await repository.saveCatalog({
      ...catalog,
      hardware: [
        ...catalog.hardware.filter((h) => h.id !== HW_IN_USE_ID && h.id !== HW_FREE_ID),
        {
          id: HW_IN_USE_ID,
          code: HW_IN_USE_CODE,
          name: 'Herraje en uso guard',
          unit: 'piece',
          costPerUnit: 10,
          active: true,
        },
        {
          id: HW_FREE_ID,
          code: HW_FREE_CODE,
          name: 'Herraje libre guard',
          unit: 'piece',
          costPerUnit: 10,
          active: true,
        },
      ],
      modules: [
        ...catalog.modules.filter((m) => m.id !== MODULE_ID),
        {
          ...template,
          id: MODULE_ID,
          code: 'MOD-HW-INUSE-GUARD',
          name: 'Módulo guard in-use',
          components: [],
          hardwareLines: [
            { id: MODULE_LINE_ID, hardwareId: HW_IN_USE_ID, quantity: 1, optionRole: '' },
          ],
        },
      ],
    });

    await loginToA(page);
    await page.goto('/hardware');
    await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();

    // In-use hardware: the server refuses with 409 and the toast shows the
    // reference counts instead of a generic connection error. Row actions
    // reveal on hover, so hover the row before clicking.
    const inUseRow = page.getByRole('row', { name: new RegExp(HW_IN_USE_CODE) });
    await inUseRow.hover();
    await page.getByRole('button', { name: `Desactivar ${HW_IN_USE_CODE}` }).click();
    const confirmDialog = page.getByTestId('hardware-deactivate-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Desactivar', exact: true }).click();
    // Toasts stack; assert against the one carrying the refusal.
    const refusalToast = page.getByTestId('ui-toast').filter({ hasText: 'herraje en uso' });
    await expect(refusalToast).toContainText('1 línea');
    // The optimistic toggle rolled back: the row is still active (visible
    // under the default Activos filter with its Desactivar action).
    await expect(page.getByRole('button', { name: `Desactivar ${HW_IN_USE_CODE}` })).toBeVisible();

    // Unreferenced hardware: deactivates, then comes back via the Inactivos
    // filter's Reactivar action.
    const freeRow = page.getByRole('row', { name: new RegExp(HW_FREE_CODE) });
    await freeRow.hover();
    await page.getByRole('button', { name: `Desactivar ${HW_FREE_CODE}` }).click();
    await page
      .getByTestId('hardware-deactivate-confirm')
      .getByRole('button', { name: 'Desactivar', exact: true })
      .click();
    await expect(page.getByTestId('ui-toast').filter({ hasText: 'desactivado' })).toBeVisible();
    await expect(page.getByRole('button', { name: `Reactivar ${HW_FREE_CODE}` })).toHaveCount(0);

    await page.getByRole('button', { name: 'Inactivos', exact: true }).click();
    await page.getByRole('row', { name: new RegExp(HW_FREE_CODE) }).hover();
    await page.getByRole('button', { name: `Reactivar ${HW_FREE_CODE}` }).click();
    await expect(page.getByTestId('ui-toast').filter({ hasText: 'reactivado' })).toBeVisible();

    await page.getByRole('button', { name: 'Activos', exact: true }).click();
    await expect(page.getByRole('button', { name: `Desactivar ${HW_FREE_CODE}` })).toBeVisible();
  });
});
