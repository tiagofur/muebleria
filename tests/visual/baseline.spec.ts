import { test, expect, type Page } from '@playwright/test';

/**
 * Visual regression baselines for the UI Judgment Day (F052).
 *
 * These do NOT assert on markup/classnames (the unit suite already covers that
 * via source-string matching). They capture pixels so the token + spacing
 * refactor can be diffed visually. Guest mode (no backend) via sessionStorage.
 *
 * Update baselines after an intentional visual change:
 *   pnpm visual -- --update-snapshots
 */

/** Enter the app as guest (local seed workspace) before first navigation. */
async function enterAsGuest(page: Page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('muebles_session', 'guest');
    } catch {
      /* sessionStorage unavailable */
    }
  });
}

/** Wait for the workspace shell to be ready (sidebar rendered). */
async function waitForShell(page: Page) {
  await page.waitForSelector('.app-sidebar', { timeout: 30_000 });
  // Let any layout/seed async settle before capturing.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

test.describe('UI Judgment Day visual baseline', () => {
  test('login screen', async ({ page }) => {
    // No guest session → login screen renders.
    await page.goto('/');
    await page.waitForSelector('[data-testid="login-screen"], .login-card, form', {
      timeout: 20_000,
    });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('dashboard / home', async ({ page }) => {
    await enterAsGuest(page);
    await page.goto('/');
    await waitForShell(page);
    await expect(page).toHaveScreenshot('home.png', { fullPage: true });
  });

  test('materials catalog', async ({ page }) => {
    await enterAsGuest(page);
    await page.goto('/materials');
    await waitForShell(page);
    await page.waitForSelector('.catalog-table, .catalog-empty, .empty-state', {
      timeout: 20_000,
    });
    await expect(page).toHaveScreenshot('materials.png', { fullPage: true });
  });

  test('quotes (projects) list', async ({ page }) => {
    await enterAsGuest(page);
    await page.goto('/projects');
    await waitForShell(page);
    await page.waitForSelector(
      '.project-card-grid, .project-card, .empty-state, .catalog-empty',
      { timeout: 20_000 },
    );
    await expect(page).toHaveScreenshot('projects-list.png', { fullPage: true });
  });

  test('modules (muebles) list', async ({ page }) => {
    await enterAsGuest(page);
    await page.goto('/modules');
    await waitForShell(page);
    await page.waitForSelector(
      '.module-card-grid, .module-card, .empty-state, .catalog-empty',
      { timeout: 20_000 },
    );
    await expect(page).toHaveScreenshot('modules-list.png', { fullPage: true });
  });

  test('project detail (first card)', async ({ page }) => {
    await enterAsGuest(page);
    await page.goto('/projects');
    await waitForShell(page);
    // Click the first project card to open the read-only detail view.
    const firstCard = page.locator('.project-card').first();
    const hasCard = await firstCard.count();
    test.skip(hasCard === 0, 'no seed projects to open detail for');
    await firstCard.click();
    await page.waitForSelector('.project-detail, .workspace-chrome', {
      timeout: 20_000,
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('project-detail.png', { fullPage: true });
  });
});
