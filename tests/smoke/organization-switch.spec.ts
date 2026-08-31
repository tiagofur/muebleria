import { expect, test } from '@playwright/test';
import {
  ORG_B,
  TOKEN_A,
  TOKEN_B,
  installBroadcastRecorder,
  installOrganizationApi,
  seedBrowserSession,
} from '../fixtures/organizationSwitch';

test.describe('F199 mocked browser switch gates', () => {
  test('late tenant A data cannot replace tenant B shell, actions, token, or media', async ({ page }) => {
    await seedBrowserSession(page);
    const api = await installOrganizationApi(page, { delayTeamA: true });
    await page.goto('/users');
    const activeOrganization = page.locator('.app-topbar__organization-text strong');
    await expect(activeOrganization).toHaveText('Taller A');
    await api.teamAStarted;

    await page.getByLabel('Cambiar organización').selectOption(ORG_B);
    await expect(activeOrganization).toHaveText('Taller B');
    await expect(page.getByText('Bruno B')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspender membresía de Bruno B' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBe(TOKEN_B);

    api.releaseTeamA();
    await page.waitForTimeout(150);
    await expect(activeOrganization).toHaveText('Taller B');
    await expect(page.getByText('Ana A')).toHaveCount(0);
    await expect(page.getByText('Bruno B')).toBeVisible();

    await page.getByRole('link', { name: 'Muebles' }).click();
    await expect(page.getByTestId('module-card-module-b')).toBeVisible();
    const media = page.getByRole('img', { name: 'Mueble B' });
    await expect(media).toHaveAttribute('src', /token=browser-token-b/);
    expect(await media.getAttribute('src')).not.toContain(TOKEN_A);
    const firstB = api.requests.findIndex((request) => request.authorization === `Bearer ${TOKEN_B}`);
    expect(firstB).toBeGreaterThanOrEqual(0);
    expect(api.requests.slice(firstB).some((request) => request.authorization === `Bearer ${TOKEN_A}`)).toBe(false);
  });

  test('replaces a privileged tenant A route when tenant B lacks capability', async ({ page }) => {
    await seedBrowserSession(page);
    await installOrganizationApi(page, { rolesB: ['vendedor'] });
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();

    await page.getByLabel('Cambiar organización').selectOption(ORG_B);
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /Inicio/ })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'No tenés permiso' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toHaveCount(0);
  });

  test('shows Team 500 and never calls the legacy users endpoint', async ({ page }) => {
    await seedBrowserSession(page);
    const api = await installOrganizationApi(page, { failTeam: true });
    await page.goto('/users');

    await expect(page.getByRole('heading', { name: 'No se pudo cargar el equipo' })).toBeVisible();
    expect(api.requests.some((request) => request.path.endsWith('/org/memberships'))).toBe(true);
    expect(api.requests.some((request) => request.path.includes('/admin/users'))).toBe(false);
  });

  test('synchronizes two real tabs with only the opaque session signal', async ({ context }) => {
    await seedBrowserSession(context);
    await installBroadcastRecorder(context);
    const tab1 = await context.newPage();
    const tab2 = await context.newPage();
    await installOrganizationApi(tab1);
    await installOrganizationApi(tab2);
    await Promise.all([tab1.goto('/users'), tab2.goto('/users')]);
    await expect(tab1.getByText('Ana A')).toBeVisible();
    await expect(tab2.getByText('Ana A')).toBeVisible();

    await tab1.getByLabel('Cambiar organización').selectOption(ORG_B);
    await expect(tab1.getByText('Bruno B')).toBeVisible();
    await expect(tab2.getByText('Bruno B')).toBeVisible();
    await expect(tab2.getByText('Ana A')).toHaveCount(0);
    expect(await tab2.evaluate(() => localStorage.getItem('granete_token'))).toBe(TOKEN_B);

    const payloads = await tab1.evaluate(() => Reflect.get(window, '__sessionMessages'));
    expect(payloads).toEqual(['session-changed']);
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toMatch(/token|org-|owner|membership|Taller|browser-token/i);
  });
});
