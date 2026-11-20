import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

/**
 * #1447 browser proof (Go + disposable PostgreSQL, no route interception):
 * when the HttpOnly `granete_web_refresh` cookie is gone, a bodyless refresh
 * answers the refresh contract's own terminal `REFRESH_INVALID` (never the
 * bearer bridge's «missing authorization header»), and the app's scheduled
 * refresh then ends THIS tab's session explicitly — login with «Tu sesión
 * expiró» — instead of leaving a silently dead session on screen.
 */
const API_BASE = required('ORGANIZATION_API_BASE');

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

test('sin cookie de refresh: REFRESH_INVALID terminal y la pestaña vuelve al login con el motivo', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.clock.install();
  await login(page);

  const refreshResponses: Array<{ status: number; body: string }> = [];
  page.on('response', async (res) => {
    if (res.url() === `${API_BASE}/auth/refresh`) {
      refreshResponses.push({ status: res.status(), body: await res.text().catch(() => '') });
    }
  });

  // The browser lost the HttpOnly refresh cookie (expired, cleared, blocked).
  const before = await context.cookies();
  expect(before.some((c) => c.name === 'granete_web_refresh')).toBe(true);
  await context.clearCookies({ name: 'granete_web_refresh' });
  expect((await context.cookies()).some((c) => c.name === 'granete_web_refresh')).toBe(false);

  // 1. Server contract: bodyless, no cookie, no bearer → terminal REFRESH_INVALID.
  const raw = await page.evaluate(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Granete-CSRF': '1' },
    });
    return { status: response.status, body: await response.text() };
  }, API_BASE);
  expect(raw.status).toBe(401);
  expect(JSON.parse(raw.body)).toMatchObject({ code: 'REFRESH_INVALID' });
  expect(raw.body).not.toContain('missing authorization header');

  // 2. App: the scheduled refresh (~2 min before the 15-min access expiry)
  // comes back terminal and ends the session in THIS tab right away.
  await page.clock.fastForward('14:00');
  await expect(page.getByText('Tu sesión expiró. Volvé a iniciar sesión para continuar donde estabas.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  const scheduled = refreshResponses.filter((r) => r.status === 401);
  expect(scheduled.length).toBeGreaterThanOrEqual(1);
  for (const r of scheduled) {
    expect(r.body).toContain('REFRESH_INVALID');
    expect(r.body).not.toContain('missing authorization header');
  }
  await page.screenshot({ path: 'test-results/1447-session-ended.png' });
});
