/**
 * #1325 Opening profiles catalog browser proof (#1317 activation UX):
 * real browser against the Go backend & disposable PostgreSQL.
 *
 * 1. A pending profile is created through the catalog UI (id, grip, section).
 * 2. The datasheet is completed and verified through the edit modal
 *    (four measures + auditable origin), declaring the side notch and the
 *    DEPTH REDUCTION as DERIVED («deriva de la ficha») — the #1317 contract
 *    surfaced as UI copy, never a typed constant.
 * 3. The expanded row reads back the exact plain-workshop declaration.
 */

import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test('opening profile: pending → verified datasheet with derived depth reduction → plain-language readback', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000);
  await loginToA(page);

  await page.goto('/opening-profiles');

  // Create the pending profile through the real form.
  await expect(page.getByTestId('opening-profile-create-btn')).toBeVisible();
  await page.getByTestId('opening-profile-create-btn').click();
  await page.getByTestId('opening-profile-id-input').fill('profile.gola-e2e-1325');
  await page.getByTestId('opening-profile-code-input').fill('GOLA-E2E-1325');
  await page.getByTestId('opening-profile-name-input').fill('Gola E2E #1325');
  await page.getByTestId('opening-profile-form-submit-btn').click();

  // The modal's exit timer (350ms) is throttled in the gate's hidden window:
  // wait for the unmount before touching row actions, or its overlay keeps
  // intercepting pointer events.
  await expect(page.locator('.ui-modal-root')).toHaveCount(0, { timeout: 30_000 });

  const row = page.getByRole('row', { name: /GOLA-E2E-1325/ });
  await expect(row).toBeVisible();

  // Complete the datasheet: hover row to reveal action buttons (.catalog-table__actions has pointer-events: none until :hover).
  await row.hover();
  await row.getByRole('button', { name: 'Editar GOLA-E2E-1325' }).click();
  await page.getByTestId('opening-profile-status-select').selectOption('verified');
  await page.getByTestId('opening-profile-front-reduction').fill('38');
  await page.getByTestId('opening-profile-clearance').fill('2');
  await page.getByTestId('opening-profile-height').fill('56.5');
  await page.getByTestId('opening-profile-depth').fill('27.2');
  await page.getByTestId('opening-profile-origin-input').fill('Ficha SCILM 2022-04-01 pp. 42-45 (E2E #1325)');
  await page.getByTestId('opening-profile-notch-toggle').check();
  await page.getByTestId('opening-profile-notch-height').fill('56.5');
  await page.getByTestId('opening-profile-notch-depth').fill('27.2');
  await page.getByTestId('opening-profile-reduction-toggle').check();
  // The derived source is the DEFAULT and names the datasheet value.
  await expect(page.getByTestId('opening-profile-reduction-derived')).toBeChecked();
  await expect(page.getByText(/Deriva de la ficha \(27\.2 mm\)/)).toBeVisible();
  await page.getByTestId('opening-profile-form-submit-btn').click();
  await expect(page.locator('.ui-modal-root')).toHaveCount(0, { timeout: 30_000 });

  // Readback: verified badge + the exact derived declaration on the row detail.
  await row.click();
  const detail = page.locator('.catalog-row-detail');
  await expect(detail).toContainText('v2');
  await expect(detail).toContainText('Verificada');
  await expect(detail).toContainText('56.5 alto × 27.2 profundo');
  await expect(detail).toContainText('Descuento de profundidad: deriva de la ficha (27.2 mm)');
  await expect(detail).toContainText('Muesca en costados: 56.5 × 27.2 mm');
  await expect(detail).toContainText('Ficha SCILM 2022-04-01 pp. 42-45 (E2E #1325)');
});
