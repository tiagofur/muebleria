import { expect, test } from '@playwright/test';
import {
  ORG_B,
  TOKEN_A,
  TOKEN_B,
  createMockOrganizationCookieState,
  installBroadcastRecorder,
  installOrganizationApi,
  seedBrowserSession,
} from '../fixtures/organizationSwitch';

test.describe('F199 mocked browser switch gates', () => {
  test('requires confirmation for a real dirty editor and purges A only after commit', async ({ page }) => {
    await seedBrowserSession(page);
    const api = await installOrganizationApi(page);
    await page.goto('/modules/module-a/edit');
    const name = page.getByLabel('Nombre');
    await expect(name).toHaveValue('Mueble A');
    await name.fill('Tenant A unsaved');
    const urlA = page.url();

    await page.getByLabel('Cambiar organización').selectOption(ORG_B);
    const confirmation = page.getByRole('dialog', { name: 'Cambiar de organización' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(urlA);
    await expect(name).toHaveValue('Tenant A unsaved');
    expect(api.requests.some(({ path }) => path.endsWith('/auth/select-org'))).toBe(false);
    // SEC-4B: sin bearer en storage; el access sigue vivo sólo en memoria.
    expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();

    await page.getByLabel('Cambiar organización').selectOption(ORG_B);
    await confirmation.getByRole('button', { name: 'Descartar y cambiar' }).click();
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Taller B');
    await expect(page.getByTestId('module-card-module-b')).toBeVisible();
    expect(await page.evaluate(() => [...Array(sessionStorage.length)].map((_, index) =>
      sessionStorage.getItem(sessionStorage.key(index) ?? '')).join(' '))).not.toContain('Tenant A unsaved');

    await page.reload();
    await expect(page.getByTestId('module-card-module-b')).toBeVisible();
    expect(await page.locator('input').evaluateAll((inputs) => inputs.every((input) =>
      !(input instanceof HTMLInputElement) || input.value !== 'Tenant A unsaved'))).toBe(true);
  });

  test('recovers a stale revoked choice without leaving tenant A', async ({ page }) => {
    await seedBrowserSession(page);
    const api = await installOrganizationApi(page, { selectFailure: 'revoked' });
    await page.goto('/users');
    await expect(page.getByText('Ana A')).toBeVisible();
    const routeA = page.url();

    await page.getByLabel('Cambiar organización').selectOption(ORG_B);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('acceso a este taller fue revocado');
    await expect(alert.getByRole('button', { name: 'Actualizar talleres' })).toBeVisible();
    await expect(page).toHaveURL(routeA);
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Taller A');
    await expect(page.getByText('Ana A')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();

    await alert.getByRole('button', { name: 'Actualizar talleres' }).click();
    await expect(page.getByLabel('Cambiar organización')).toHaveCount(0);
    await expect(alert).toHaveCount(0);
    await expect(page.getByText('Ana A')).toBeVisible();
    expect(api.requests.filter(({ path }) => path.endsWith('/auth/select-org'))).toHaveLength(1);
  });

  for (const [failure, message] of [
    ['forbidden', 'No se pudo cambiar de taller. Verificá tus permisos'],
    ['network', 'No se pudo conectar para cambiar de taller'],
  ] as const) {
    test(`keeps unknown ${failure} distinct from revoked membership`, async ({ page }) => {
      await seedBrowserSession(page);
      await installOrganizationApi(page, { selectFailure: failure });
      await page.goto('/users');

      await page.getByLabel('Cambiar organización').selectOption(ORG_B);
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(message);
      await expect(alert).not.toContainText('revocado');
      await expect(alert.getByRole('button', { name: 'Actualizar talleres' })).toHaveCount(0);
      await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Taller A');
      expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();
    });
  }

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
    expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();

    api.releaseTeamA();
    await page.waitForTimeout(150);
    await expect(activeOrganization).toHaveText('Taller B');
    await expect(page.getByText('Ana A')).toHaveCount(0);
    await expect(page.getByText('Bruno B')).toBeVisible();

    await page.getByRole('link', { name: 'Muebles' }).click();
    await expect(page.getByTestId('module-card-module-b')).toBeVisible();
    // #460 SEC-3: media renders through a signed grant URL scoped to B —
    // never a session JWT in the URL.
    const media = page.getByRole('img', { name: 'Mueble B' });
    await expect(media).toHaveAttribute('src', /grant=mock-grant-b/);
    expect(await media.getAttribute('src')).not.toContain(TOKEN_A);
    expect(await media.getAttribute('src')).not.toContain('token=');
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
    // SEC-4B: la cookie-session es compartida por el context — el estado del
    // mock también debe serlo para que el bootstrap de tab2 vea el scope B.
    const cookieState = createMockOrganizationCookieState();
    const tab1 = await context.newPage();
    const tab2 = await context.newPage();
    await installOrganizationApi(tab1, { cookieState });
    await installOrganizationApi(tab2, { cookieState });
    await Promise.all([tab1.goto('/users'), tab2.goto('/users')]);
    await expect(tab1.getByText('Ana A')).toBeVisible();
    await expect(tab2.getByText('Ana A')).toBeVisible();

    await tab1.getByLabel('Cambiar organización').selectOption(ORG_B);
    await expect(tab1.getByText('Bruno B')).toBeVisible();
    await expect(tab2.getByText('Bruno B')).toBeVisible({ timeout: 15_000 });
    await expect(tab2.getByText('Ana A')).toHaveCount(0);
    expect(await tab2.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();

    // La señal cross-tab es { type }-only; tab2 re-derivó su sesión desde la
    // cookie (bootstrap), nunca desde un token broadcasteado.
    const payloads = await tab1.evaluate(() => Reflect.get(window, '__sessionMessages'));
    expect(payloads).toEqual([{ type: 'scope-changed' }]);
    const serialized = JSON.stringify(payloads);
    expect(serialized).not.toMatch(/token|org-|owner|membership|Taller|browser-token/i);
  });
});
