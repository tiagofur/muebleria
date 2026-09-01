import { expect, test, type Page } from '@playwright/test';
import {
  GATE_MEDIA_A_URL,
  GATE_MEDIA_B_URL,
  GATE_MODULE_A_ID,
  GATE_MODULE_B_ID,
  required,
} from './support/api';

async function loginToA(page: Page): Promise<void> {
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

test('real delayed A media cannot replace the B shell, card, action, token, or headers', async ({ page }) => {
  let releaseA = () => undefined;
  let markAStarted = () => undefined;
  const aStarted = new Promise<void>((resolve) => { markAStarted = resolve; });
  const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
  const requests: Array<{ url: string; authorization: string }> = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push({
      url: request.url(), authorization: request.headers().authorization ?? '',
    });
  });
  // #460 SEC-3: A's media now travels as a short-lived signed grant URL —
  // delay the file GET itself so a late A response cannot pollute B.
  await page.route(`**${GATE_MEDIA_A_URL}*`, async (route) => {
    const response = await route.fetch();
    markAStarted();
    await aGate;
    await route.fulfill({ response }).catch(() => undefined);
  });

  await loginToA(page);
  await page.getByRole('link', { name: 'Vitrina' }).click();
  await page.getByRole('tab', { name: /Catálogo de Módulos/ }).click();
  await expect(page.getByTestId(`showcase-card-${GATE_MODULE_A_ID}`)).toBeVisible();
  await aStarted;
  const tokenA = await page.evaluate(() => localStorage.getItem('granete_token'));

  await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
  await page.getByRole('tab', { name: /Catálogo de Módulos/ }).click();
  const cardB = page.getByTestId(`showcase-card-${GATE_MODULE_B_ID}`);
  await expect(cardB).toBeVisible();
  const tokenB = await page.evaluate(() => localStorage.getItem('granete_token'));
  expect(tokenB).toBeTruthy();
  expect(tokenB).not.toBe(tokenA);
  const imageB = page.getByRole('img', { name: 'Mueble real B' });
  // Signed grant URL for exactly org B's file — never a session JWT in the URL.
  await expect(imageB).toHaveAttribute('src', new RegExp(`${GATE_MEDIA_B_URL.slice('/api/media/'.length)}\\?grant=`));
  await expect(imageB).toHaveAttribute('src', /grant=/);
  await expect(imageB).not.toHaveAttribute('src', /token=/);

  releaseA();
  await page.waitForTimeout(150);
  await expect(cardB).toBeVisible();
  await expect(page.getByTestId(`showcase-card-${GATE_MODULE_A_ID}`)).toHaveCount(0);
  await page.getByTestId(`showcase-card-open-${GATE_MODULE_B_ID}`).click();
  await expect(page.getByTestId('showcase-detail-use')).toBeVisible();
  const firstB = requests.findIndex(({ authorization }) => authorization === `Bearer ${tokenB}`);
  expect(firstB).toBeGreaterThanOrEqual(0);
  const afterB = requests.slice(firstB);
  expect(afterB.some(({ url }) => url.includes(GATE_MEDIA_B_URL))).toBe(true);
  expect(afterB.some(({ url }) => url.includes(GATE_MEDIA_A_URL))).toBe(false);
  expect(afterB.some(({ authorization }) => authorization === `Bearer ${tokenA}`)).toBe(false);
});

test('real B vendedor replaces the privileged A route', async ({ page }) => {
  await loginToA(page);
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();

  await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: /Inicio/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'No tenés permiso' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
});

test('real dirty A editor cancels safely and purges only after authoritative B commit', async ({ page }) => {
  const selectRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/auth/select-org')) selectRequests.push(request.url());
  });
  await loginToA(page);
  await page.getByRole('link', { name: 'Muebles' }).click();
  await page.getByTestId(`module-card-${GATE_MODULE_A_ID}`).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const name = page.getByLabel('Nombre');
  await expect(name).toHaveValue('Mueble real A');
  await name.fill('Tenant A real unsaved');
  const urlA = page.url();
  const selectionBaseline = selectRequests.length;

  await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
  const dialog = page.getByRole('dialog', { name: 'Cambiar de organización' });
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page).toHaveURL(urlA);
  await expect(name).toHaveValue('Tenant A real unsaved');
  expect(selectRequests).toHaveLength(selectionBaseline);

  await page.getByLabel('Cambiar organización').selectOption({ label: 'Browser Gate B' });
  await dialog.getByRole('button', { name: 'Descartar y cambiar' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
  await expect(page).toHaveURL('/');
  expect(selectRequests).toHaveLength(selectionBaseline + 1);
  expect(await page.evaluate(() => Object.values(sessionStorage).join(' '))).not.toContain('Tenant A real unsaved');

  await page.getByRole('link', { name: 'Vitrina' }).click();
  await page.getByRole('tab', { name: /Catálogo de Módulos/ }).click();
  await expect(page.getByTestId(`showcase-card-${GATE_MODULE_B_ID}`)).toBeVisible();
  expect(await page.locator('input').evaluateAll((inputs) => inputs.every((input) =>
    !(input instanceof HTMLInputElement) || input.value !== 'Tenant A real unsaved'))).toBe(true);
});
