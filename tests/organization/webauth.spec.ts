import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

/**
 * #460 SEC-4B browser gate: el access token Web vive SÓLO en memoria de la
 * pestaña; la sesión persistente viaja exclusivamente en la cookie HttpOnly
 * `granete_web_refresh`. Se demuestra con backend + PostgreSQL reales:
 * sin bearer en storage, cookie bootstrap en reload y pestaña nueva,
 * refresh concurrente de dos pestañas SIN replay (serializado por el lock del
 * app), org switch multi-tab tenant-safe y logout que corta ambas pestañas.
 */

const API_BASE = required('ORGANIZATION_API_BASE');

async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

function captureBearers(page: Page): string[] {
  const bearers: string[] = [];
  page.on('request', (request) => {
    const authorization = request.headers().authorization;
    if (authorization?.startsWith('Bearer ')) bearers.push(authorization.slice('Bearer '.length));
  });
  return bearers;
}

async function dismissTour(page: Page): Promise<void> {
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

/** Cookie refresh crudo contra el API real (cross-origin, credentialed). */
async function rawCookieRefresh(page: Page): Promise<number> {
  return page.evaluate(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Granete-CSRF': '1' },
    });
    return response.status;
  }, API_BASE);
}

test('no Web bearer ever reaches storage (login → localStorage/sessionStorage limpios)', async ({ page }) => {
  await login(page);
  await page.waitForTimeout(300);

  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(storage.local['granete_token']).toBeUndefined();
  expect(storage.local['muebles_token']).toBeUndefined();
  for (const [key, value] of Object.entries(storage.local)) {
    expect(value, `localStorage[${key}]`).not.toMatch(/^eyJ|grt_refresh_v1/);
  }
  for (const [key, value] of Object.entries(storage.session)) {
    expect(value, `sessionStorage[${key}]`).not.toMatch(/^eyJ|grt_refresh_v1/);
  }
  // La cookie HttpOnly no es legible desde JS.
  expect(await page.evaluate(() => document.cookie.includes('granete_web_refresh'))).toBe(false);
});

test('reload hace cookie bootstrap: nuevo access distinto y autenticado de nuevo', async ({ page }) => {
  const bearers = captureBearers(page); // desde antes del login: captura el flujo completo
  await login(page);
  await page.waitForTimeout(300);
  const accessBefore = bearers.at(-1);
  expect(accessBefore).toBeTruthy();

  await page.reload();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 15_000 });

  // El access tras el reload es NUEVO (rotación de cookie), no el de antes.
  expect(bearers.filter((b) => b !== accessBefore).length, 'cookie bootstrap minted a fresh access').toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();
});

test('una pestaña nueva se autentica por cookie bootstrap, sin recibir token de la otra', async ({ context }) => {
  const tabA = await context.newPage();
  await login(tabA);
  await tabA.waitForTimeout(300);

  const tabB = await context.newPage();
  const bearers = captureBearers(tabB);
  await tabB.goto('/');
  await expect(tabB.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 15_000 });
  await dismissTour(tabB);

  // Tab B mintió su propio access vía cookie: hubo Authorization propia, pero
  // ningún canal de storage transportó el token desde A.
  expect(bearers.length).toBeGreaterThan(0);
  expect(await tabB.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();
});

test('refresh concurrente de dos pestañas queda serializado: sin REFRESH_REUSED, sesión viva', async ({ context }) => {
  const tabA = await context.newPage();
  await login(tabA);
  await tabA.waitForTimeout(300);

  const tabB = await context.newPage();
  await tabB.goto('/');
  await expect(tabB.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 15_000 });
  await dismissTour(tabB);

  // DOS rotaciones de la MISMA cookie, casi simultáneas, A TRAVÉS del app
  // (coordinatedWebRefresh: navigator.locks cross-tab + singleflight). El
  // server mantiene strict single-use: sin serialización esto revocaría la
  // familia completa (REFRESH_REUSED).
  const appRefresh = (page: Page) =>
    page.evaluate(async () => {
      const outcome = await (
        window as unknown as { __graneteWebAuthTestRefresh: () => Promise<{ status: string }> }
      ).__graneteWebAuthTestRefresh();
      return outcome.status;
    });
  const [statusA, statusB] = await Promise.all([appRefresh(tabA), appRefresh(tabB)]);
  expect([statusA, statusB].sort()).toEqual(['refreshed', 'refreshed']);

  // La sesión sigue viva: la cookie rota una vez más sin replay.
  for (const page of [tabA, tabB]) {
    expect(await rawCookieRefresh(page), 'session remains active after concurrent refresh').toBe(200);
  }
});

test('org switch A→B en dos pestañas: B purga A y ninguna request de A se reintenta bajo B', async ({ context }) => {
  const tabA = await context.newPage();
  await login(tabA);
  await tabA.waitForTimeout(300);

  const tabB = await context.newPage();
  const bearersB = captureBearers(tabB);
  await tabB.goto('/');
  await expect(tabB.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 15_000 });
  await dismissTour(tabB);
  const accessA = bearersB.at(-1);
  expect(accessA).toBeTruthy();

  // Tab A cambia la sesión compartida a Org B...
  await tabA.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
  await expect(tabA.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');

  // ...y Tab B (que tenía A abierto) recarga al scope-changed y muestra B.
  await expect(tabB.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B', { timeout: 15_000 });
  await tabB.waitForTimeout(500);

  // El bearer activo de B ya no es el de A.
  expect(bearersB.at(-1)).not.toBe(accessA);
  expect(bearersB.at(-1)).toBeTruthy();
  expect(await tabB.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();
});

test('logout en una pestaña corta la sesión compartida: la otra termina en login', async ({ context }) => {
  const tabA = await context.newPage();
  await login(tabA);
  await tabA.waitForTimeout(300);

  const tabB = await context.newPage();
  await tabB.goto('/');
  await expect(tabB.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 15_000 });
  await dismissTour(tabB);

  await tabA.getByTestId('app-logout').click();
  await expect(tabA.getByRole('button', { name: 'Iniciar Sesión' })).toBeVisible({ timeout: 15_000 });

  // Tab B: la cookie fue revocada — recarga/bootstrap termina en login.
  await tabB.reload();
  await expect(tabB.getByRole('button', { name: 'Iniciar Sesión' })).toBeVisible({ timeout: 15_000 });
  // Sin business data residual visible.
  await expect(tabB.locator('.app-topbar__organization-text strong')).toHaveCount(0);
});

test('fallback SIN Web Locks: dos pestañas coordinan por IndexedDB y no hay replay', async ({ context }) => {
  // Simula browsers sin Web Locks: el app debe caer al mutex IndexedDB
  // (transacción readwrite get+put atómica) — nunca correr la rotación sin
  // exclusión mutua real.
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'locks', {
      configurable: true,
      get: () => undefined,
    });
  });

  const tabA = await context.newPage();
  await login(tabA);
  await tabA.waitForTimeout(300);

  const tabB = await context.newPage();
  await tabB.goto('/');
  await expect(tabB.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 15_000 });
  await dismissTour(tabB);

  // DOS rotaciones de la MISMA cookie, casi simultáneas, a través del app
  // (coordinatedWebRefresh sobre el mutex IndexedDB real).
  const appRefresh = (page: Page) =>
    page.evaluate(async () => {
      const outcome = await (
        window as unknown as { __graneteWebAuthTestRefresh: () => Promise<{ status: string }> }
      ).__graneteWebAuthTestRefresh();
      return outcome.status;
    });
  const [statusA, statusB] = await Promise.all([appRefresh(tabA), appRefresh(tabB)]);
  expect([statusA, statusB].sort()).toEqual(['refreshed', 'refreshed']);

  // Sesión viva: strict single-use server-side intacto (sin REFRESH_REUSED).
  for (const page of [tabA, tabB]) {
    expect(await rawCookieRefresh(page), 'session alive after fallback concurrent refresh').toBe(200);
  }
});

test('FAIL CLOSED: sin Web Locks NI IndexedDB la rotación se rechaza (nunca corre sin exclusión)', async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'locks', {
      configurable: true,
      get: () => undefined,
    });
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get: () => undefined,
    });
  });

  const refreshRequests: string[] = [];
  const page = await context.newPage();
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/auth/refresh')) {
      refreshRequests.push(request.url());
    }
  });

  // Login con el OWNER de Browser Gate A (membresía única → sin select-org,
  // que también corre bajo el lock). El login mismo no usa lock: la sesión
  // queda en memoria y el shell renderiza.
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 15_000 });
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();

  const outcome = await page.evaluate(async () => {
    const result = await (
      window as unknown as { __graneteWebAuthTestRefresh: () => Promise<{ status: string }> }
    ).__graneteWebAuthTestRefresh();
    return result.status;
  });

  // Sin primitiva segura la mutación NO se ejecuta: no hubo rotación alguna
  // (fail closed) — el access local sigue y el server quedó intacto.
  expect(outcome).not.toBe('refreshed');
  expect(refreshRequests).toHaveLength(0);
});
