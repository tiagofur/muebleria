/**
 * #1559 — visual proof that `.btn--small` buttons render compact in a real
 * browser. The dead class `.btn--sm` made ~30 buttons render full-size; the
 * rename to the canonical `.btn--small` is asserted here on COMPUTED STYLES
 * (padding + font-size), not just class presence — a click passes either
 * way, which is exactly the defect this pins. Screenshot artifacts land in
 * the gate's output dir.
 */

import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

async function loginToGateA(page: Page): Promise<void> {
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

async function smallButtonMetrics(page: Page, testId: string): Promise<{ paddingY: number; fontSize: number; height: number }> {
  return page.evaluate((id) => {
    const button = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!button) throw new Error(`button ${id} not found`);
    const style = getComputedStyle(button);
    return {
      paddingY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      fontSize: parseFloat(style.fontSize),
      height: button.getBoundingClientRect().height,
    };
  }, testId);
}

async function regularButtonMetrics(page: Page, selector: string): Promise<{ paddingY: number; fontSize: number; height: number }> {
  return page.evaluate((sel) => {
    const button = document.querySelector(sel) as HTMLElement | null;
    if (!button) throw new Error(`regular button ${sel} not found`);
    const style = getComputedStyle(button);
    return {
      paddingY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      fontSize: parseFloat(style.fontSize),
      height: button.getBoundingClientRect().height,
    };
  }, selector);
}

test('#1559: Ajustes renders compact .btn--small buttons (computed styles + capture)', async ({ page }: { page: Page }) => {
  test.setTimeout(60_000);
  await loginToGateA(page);

  await page.goto('/settings');
  // The construction settings section (Ingeniería tab) carries several
  // renamed .btn--small buttons; its "restaurar" action is one of them.
  await page.getByRole('tab', { name: /Ingeniería/ }).click();
  const section = page.getByTestId('settings-section-construction');
  await expect(section).toBeVisible({ timeout: 15_000 });

  // Grab the FIRST renamed button on the settings screen and prove it is
  // actually compact — computed, not just the class attribute.
  const compactButtons = page.locator('.btn.btn--small:visible');
  const count = await compactButtons.count();
  expect(count, 'compact .btn--small buttons visible on Ajustes').toBeGreaterThan(0);

  const first = compactButtons.first();
  const testId = (await first.getAttribute('data-testid')) ?? '';
  const metrics = testId
    ? await smallButtonMetrics(page, testId)
    : await first.evaluate((button: HTMLElement) => {
        const style = getComputedStyle(button);
        return {
          paddingY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
          fontSize: parseFloat(style.fontSize),
          height: button.getBoundingClientRect().height,
        };
      });

  // The canonical .btn--small compacts vertical padding and font size —
  // assert both against the base .btn scale on the same screen.
  const regular = page.locator('.btn:not(.btn--small):visible').first();
  const regularMetrics = (await regular.count()) > 0
    ? await regularButtonMetrics(page, (await regular.getAttribute('data-testid'))
        ? `[data-testid="${await regular.getAttribute('data-testid')}"]`
        : '.btn:not(.btn--small):visible')
    : null;

  expect(metrics.paddingY, 'compact vertical padding').toBeLessThan(24);
  expect(metrics.fontSize, 'compact font size').toBeLessThanOrEqual(14);
  if (regularMetrics) {
    expect(metrics.paddingY, 'compact padding < regular padding').toBeLessThanOrEqual(regularMetrics.paddingY);
    expect(metrics.fontSize, 'compact font <= regular font').toBeLessThanOrEqual(regularMetrics.fontSize);
    expect(metrics.height, 'compact height < regular height').toBeLessThan(regularMetrics.height);
  }

  await page.screenshot({ path: 'test-results/btn-small-settings.png', fullPage: false });
});
