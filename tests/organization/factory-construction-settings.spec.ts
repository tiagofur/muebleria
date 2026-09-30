/**
 * #875 Factory self-service construction settings and component connection editor proof.
 *
 * Exercises real browser against Go backend & disposable PostgreSQL:
 * 1. Factory A configures floor joinery policy on top of Granete Standard without mutating Standard.
 * 2. Component editor reflects factory policy inheritance and permits local overrides with provenance badges.
 * 3. Restoring inheritance deletes the override without leaving orphaned keys.
 * 4. Factory B remains strictly isolated from Factory A's manufacturing overlay.
 */

import { expect, test, type Page } from '@playwright/test';
import { ensurePublishedStandardRelease, required } from './support/api';

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

async function loginToB(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_B_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  const chooser = page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' });
  try {
    await chooser.waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: /Browser Gate B/ }).click();
  } catch {
    // Single-org owner logs in directly
  }
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Factory Construction Settings (#875) Browser E2E', () => {
  test.beforeAll(async () => {
    await ensurePublishedStandardRelease();
  });
  test('Factory A configures self-service construction policy and persists to overlay', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);

    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    const section = page.getByTestId('settings-section-construction');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Initial state: standard inheritance
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');

    // Customize floor joinery: screw-only with 4 stations
    await page.getByTestId('floor-system-select').selectOption('screw-only');
    await page.getByTestId('floor-stations-input').fill('4');

    // Provenance updates immediately to factory overlay
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Fábrica');
    await expect(page.getByTestId('restore-floor-inheritance')).toBeVisible();

    // Save preferences
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('settings-saved')).toBeVisible({ timeout: 10_000 });

    // Reload page to verify persistence in PostgreSQL overlay
    await page.reload();
    await page.getByRole('tab', { name: /Ingeniería/ }).click();
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Fábrica');
    await expect(page.getByTestId('floor-stations-input')).toHaveValue('4');
    await expect(page.getByTestId('floor-system-select')).toHaveValue('screw-only');
  });

  test('Component editor reflects factory policy and allows component-level override & restore', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);

    // Open new component editor and select base placement to test floor joinery inheritance
    await page.goto('/components/new/edit');
    await page.getByTestId('input-placement').selectOption('base');
    await expect(page.getByRole('tab', { name: 'Construcción' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Construcción' }).click();

    // Verify inheritance from factory policy
    const provenanceBadge = page.getByTestId('component-provenance-badge');
    await expect(provenanceBadge).toContainText('Fábrica');
    await expect(page.getByTestId('component-restore-inheritance-btn')).toHaveCount(0);

    // Apply local component override: minifix-only with 5 stations
    await page.getByTestId('component-joinery-system-select').selectOption('minifix-only');
    await page.getByTestId('component-stations-count-input').fill('5');

    // Provenance transitions to Component exception
    await expect(provenanceBadge).toContainText('Componente (Excepción)');
    await expect(page.getByTestId('component-restore-inheritance-btn')).toBeVisible();

    // Restore inheritance
    await page.getByTestId('component-restore-inheritance-btn').click();
    await expect(provenanceBadge).toContainText('Fábrica');
    await expect(page.getByTestId('component-restore-inheritance-btn')).toHaveCount(0);
  });

  test('Factory B remains isolated from Factory A manufacturing overlay', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToB(page);

    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    const section = page.getByTestId('settings-section-construction');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Factory B must NOT see Factory A's overrides
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');
    await expect(page.getByTestId('floor-stations-input')).toHaveValue('2');
    await expect(page.getByTestId('floor-system-select')).toHaveValue('minifix-dowel');
    await expect(page.getByTestId('restore-floor-inheritance')).toHaveCount(0);
  });

  test('Factory A can restore inheritance back to Granete Standard cleanly', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);

    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Fábrica');
    await page.getByTestId('restore-floor-inheritance').click();

    // Reverts to Standard
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');

    // Save restored state
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('settings-saved')).toBeVisible({ timeout: 10_000 });

    // Reload and verify
    await page.reload();
    await page.getByRole('tab', { name: /Ingeniería/ }).click();
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');
    await expect(page.getByTestId('floor-stations-input')).toHaveValue('2');
  });
});
