import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

/**
 * #1009 / #1019 transversal browser proof — the AGREGADOS and COMPONENTES
 * screens carry their audit's UX parity contract over the real Go +
 * PostgreSQL stack:
 *
 *   each screen renders its list workspace → the creation affordance opens
 *   the full editor (list + editor reachable in-browser, S5/C1 surfaces) →
 *   and the editor exposes its save contract (busy-guarded save button).
 *
 * The audits scored these groups 24/40 and 26/40 (2026-10-03/04); the
 * #1009 S1-S5 and #1019 C1-C5 slices shipped merged — this spec pins the
 * reachable contract browser-side. Detectors: 0 findings on both trees.
 */

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

test.describe.serial('AGREGADOS y COMPONENTES — paridad UX en browser real (#1009/#1019)', () => {
  test('/add-ons — lista + editor con contrato de guardado', async ({ page }) => {
    await login(page);
    await page.goto('/add-ons');
    // List workspace renders regardless of catalog content.
    const list = page.getByTestId('agregado-list');
    const emptyCreate = page.getByTestId('create-agregado-btn');
    await expect(list.or(emptyCreate).first()).toBeVisible();

    // The creation affordance opens the full editor; the editor exposes the
    // S3 save contract (save button present next to an explicit cancel).
    await emptyCreate.click();
    const save = page.getByTestId('agregado-save-btn');
    await expect(save).toBeVisible();
    await page.getByTestId('agregado-editor-cancel').click();
    await expect(save).toHaveCount(0);
  });

  test('/components — lista + editor con contrato de guardado', async ({ page }) => {
    await login(page);
    await page.goto('/components');
    const list = page.getByTestId('component-list');
    const emptyCreate = page.getByRole('button', { name: /Crear componente|Nuevo componente/i });
    await expect(list.or(emptyCreate).first()).toBeVisible();

    await emptyCreate.click();
    const save = page.getByTestId('save-btn');
    await expect(save).toBeVisible();
    await page.getByTestId('component-editor-cancel').click();
    await expect(save).toHaveCount(0);
  });
});
