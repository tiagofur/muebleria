/**
 * #1534 browser proof: the gola profile editor v2 — create an in-progress
 * profile (material without datasheet: disponible ≠ válido), edit it into a
 * full v2 declaration (discount by suggestion, derived depth reduction,
 * notch with explicit depth, origin) and read back the exact plain-workshop
 * declaration; the derived datasheet goes VERIFICADA — the state the design
 * opening authoring gate consumes.
 * @vitest-environment jsdom
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

async function uiClick(page: Page, testId: string): Promise<void> {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await locator.evaluate((el) => (el as HTMLElement).click());
}

async function uiClickAndWaitClosed(page: Page, testId: string): Promise<void> {
  await uiClick(page, testId);
  // The modal's exit timer (350ms) is throttled in the gate's hidden window:
  // wait for the unmount before touching row actions, or its overlay keeps
  // intercepting pointer events.
  await expect(page.locator('.ui-modal-root')).toHaveCount(0, { timeout: 30_000 });
}

test('gola profile v2: in-progress create → full declaration edit → derived verified datasheet → plain-language readback', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000);
  await loginToA(page);

  await page.goto('/opening-profiles');

  // Create the in-progress profile through the real form: the material is
  // REQUIRED (a material-less write would fall to the legacy bridge and
  // silently drop the discounts), the datasheet stays PENDING without the
  // full envelope + origin (disponible ≠ válido; no id field: the editor
  // derives it from the code on submit).
  await expect(page.getByTestId('opening-profile-create-btn')).toBeVisible();
  await page.getByTestId('opening-profile-create-btn').click();
  await page.getByTestId('gola-profile-code').fill('GOLA-E2E-1325');
  await page.getByTestId('gola-profile-name').fill('Gola E2E #1325');
  await page.getByTestId('gola-profile-manufacturer').fill('SCILM');
  await uiClick(page, 'gola-material-l');
  // The L preset brings the 40 from the server suggestion: cleared to keep
  // the profile honestly pending at creation.
  await page.getByTestId('gola-discount-top').fill('');
  await page.getByTestId('gola-profile-height').fill('56.5');
  await page.getByTestId('gola-profile-depth').fill('27.2');
  await expect(page.getByTestId('gola-profile-ficha')).toContainText('Ficha: pendiente');
  await uiClickAndWaitClosed(page, 'gola-profile-save');

  const row = page.getByRole('row', { name: /GOLA-E2E-1325/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Pendiente');

  // Edit into a full v2 declaration: discount by suggestion, derived depth
  // reduction, notch with EXPLICIT depth and the datasheet origin — the
  // derived rule marks the ficha VERIFICADA (dims + descuento + origen).
  await row.hover();
  await row.getByRole('button', { name: 'Editar GOLA-E2E-1325' }).click();
  await uiClick(page, 'gola-discount-suggest-top');
  await expect(page.getByTestId('gola-discount-top')).toHaveValue('40');
  await page.getByTestId('gola-effect-notch').click();
  await page.getByTestId('gola-notch-height').fill('56.5');
  await page.getByTestId('gola-notch-depth').fill('27.2');
  // The derived depth reduction («deriva de la ficha») rides as the second
  // declared effect — the L preset may already carry it from the create.
  const depthEffect = page.getByTestId('gola-effect-depth');
  if (!(await depthEffect.isChecked())) await depthEffect.click();
  await expect(depthEffect).toBeChecked();
  await page.getByTestId('gola-profile-origin-input').fill('Ficha SCILM 2022-04-01 pp. 42-45 (E2E #1325)');
  await expect(page.getByTestId('gola-profile-ficha')).toContainText('Ficha: verificada');
  await uiClick(page, 'gola-profile-save');
  await uiClickAndWaitClosed(page, 'gola-profile-save');

  // The derived datasheet is LIVE in the list: the authoring gate state.
  await expect(row).toContainText('Verificada');

  // Readback: the exact plain-workshop declaration on the row detail.
  await row.click();
  const detail = page.locator('.catalog-row-detail');
  await expect(detail).toContainText('SCILM');
  await expect(detail).toContainText('56.5 alto × 27.2 profundo');
  await expect(detail).toContainText('Descuento de puerta');
  await expect(detail).toContainText('40 mm');
  await expect(detail).toContainText('Descuento de profundidad: deriva de la ficha (27.2 mm)');
  await expect(detail).toContainText('Muesca en costados: 56.5 × 27.2 mm');
  await expect(detail).toContainText('Ficha SCILM 2022-04-01 pp. 42-45 (E2E #1325)');
});
