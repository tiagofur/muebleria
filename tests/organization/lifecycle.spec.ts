import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import {
  LIFECYCLE_SUBJECT_EMAIL,
  type LifecycleSubject,
  prepareLifecycleSubject,
  required,
} from './support/api';

async function installSessionRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const messages: unknown[] = [];
    Object.defineProperty(window, '__organizationGateSessionMessages', { value: messages });
    const NativeChannel = window.BroadcastChannel;
    window.BroadcastChannel = class extends NativeChannel {
      override postMessage(message: unknown): void {
        messages.push(message);
        super.postMessage(message);
      }
    };
  });
}

async function loginLifecycleToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(LIFECYCLE_SUBJECT_EMAIL);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await tour.isVisible()) await tour.getByRole('button', { name: 'Omitir' }).click();
}

async function resetSessionMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const messages = Reflect.get(window, '__organizationGateSessionMessages');
    if (Array.isArray(messages)) messages.length = 0;
  });
}

test.describe.serial('F199 real lifecycle and synchronization gates', () => {
  let subject: LifecycleSubject;

  test.beforeAll(async () => { subject = await prepareLifecycleSubject(); });

  test('synchronizes two real pages with one opaque session signal', async ({ context }) => {
    await installSessionRecorder(context);
    const tab1 = await context.newPage();
    await loginLifecycleToA(tab1);
    const tab2 = await context.newPage();
    await tab2.goto('/');
    await tab2.evaluate(() => sessionStorage.setItem('granete_session', 'auth'));
    await tab2.reload();
    await expect(tab2.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A', { timeout: 20_000 });
    await expect(tab1.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
    await Promise.all([resetSessionMessages(tab1), resetSessionMessages(tab2)]);

    await tab1.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    await expect(tab1.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
    await expect(tab2.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
    await expect(tab2.locator('.app-topbar__identity-role')).toHaveText('Vendedor');
    await expect(tab2.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);

    const payloads = await tab1.evaluate(() => Reflect.get(window, '__organizationGateSessionMessages'));
    // #460 SEC-4B: la señal cross-tab es un evento { type } no-secreto; la
    // cookie (no el mensaje) es la fuente compartida del nuevo scope.
    expect(payloads).toEqual([{ type: 'scope-changed' }]);
    expect(JSON.stringify(payloads)).not.toMatch(/token|credential|organization|org-|user|membership|Browser Gate|mueble|cliente/i);
  });

  test('shows a client-only Team 500 with no legacy fallback and recovers', async ({ page }) => {
    const paths: string[] = [];
    page.on('request', (request) => paths.push(new URL(request.url()).pathname));
    await page.route('**/api/org/memberships', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'INTERNAL_ERROR', message: 'synthetic client fault', fieldErrors: {},
        requestId: 'organization-gate-team-500', retryable: false, details: {},
      }),
    }));
    await loginLifecycleToA(page);
    await page.getByRole('link', { name: 'Usuarios' }).click();
    await expect(page.getByRole('heading', { name: 'No se pudo cargar el equipo' })).toBeVisible();
    expect(paths.filter((path) => path.endsWith('/org/memberships')).length).toBeGreaterThanOrEqual(1);
    expect(paths.some((path) => path.includes('/admin/users'))).toBe(false);

    await page.unroute('**/api/org/memberships');
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByText('Browser Gate Lifecycle')).toBeVisible();
  });

  test('recovers a real stale B choice without leaving tenant A', async ({ page }) => {
    const api = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const requests: Array<{ path: string; authorization: string }> = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/')) requests.push({
        path: new URL(request.url()).pathname,
        authorization: request.headers().authorization ?? '',
      });
    });
    await loginLifecycleToA(page);
    await page.getByRole('link', { name: 'Usuarios' }).click();
    await expect(page.getByText('Browser Gate Lifecycle')).toBeVisible();
    const routeA = page.url();
    // #460 SEC-4B: el bearer vive en memoria — se captura el ACTIVO (scoped-A)
    // del header real; el primero del flujo es el org-less del select-org,
    // que el middleware niega para negocio.
    const tokenA = requests
      .map(({ authorization }) => authorization.replace('Bearer ', ''))
      .filter(Boolean)
      .at(-1);
    expect(tokenA).toBeTruthy();
    expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();
    const snapshotA = await api.getSession(tokenA ?? '');
    expect(snapshotA.session_scope.organization_id).toBe(subject.organizationAId);

    const suspended = await api.suspendMembership(
      subject.bOwnerToken,
      subject.membershipBId,
      subject.membershipBVersion,
      { reason: 'Real browser stale membership gate' },
      'browser-gate-lifecycle-b-suspend',
    );
    expect(suspended.status).toBe('suspended');
    expect(suspended.version).toBeGreaterThan(subject.membershipBVersion);

    const deniedResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/auth/select-org') && response.status() === 403);
    await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
    expect(await (await deniedResponse).json()).toMatchObject({ code: 'MEMBERSHIP_NOT_SELECTABLE' });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('acceso a este taller fue revocado');
    await expect(page).toHaveURL(routeA);
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
    await expect(page.getByText('Browser Gate Lifecycle')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('granete_token'))).toBeNull();
    expect((await api.getSession(tokenA ?? '')).session_scope.organization_id).toBe(subject.organizationAId);

    const beforeRefresh = requests.length;
    await alert.getByRole('button', { name: 'Actualizar talleres' }).click();
    await expect(page.getByLabel('Cambiar organización')).toHaveCount(0);
    await expect(alert).toHaveCount(0);
    await expect(page).toHaveURL(routeA);
    await expect(page.getByText('Browser Gate Lifecycle')).toBeVisible();
    const recoveryRequests = requests.slice(beforeRefresh);
    expect(recoveryRequests.some(({ path }) => path.endsWith('/auth/me'))).toBe(true);
    expect(recoveryRequests.every(({ authorization }) => authorization === `Bearer ${tokenA}`)).toBe(true);
  });
});
