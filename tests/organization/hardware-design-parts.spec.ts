/*
 * #1417 — browser proof de la AUTORÍA de partes de diseño en el editor de
 * herrajes: filas por nombre de componente SKP con membresía #1376, guardado
 * con readback exacto de design_parts por API, persistencia tras F5 y
 * bloqueo fail-closed de una membresía inválida (sin llamada al servidor).
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const HW_ID = '09690000-0000-4000-8000-000000001417';
const HW_CODE = 'AUT-CORR-PARTES';

type Json = Record<string, unknown>;

async function api(
  token: string,
  method: string,
  path: string,
  body?: Json,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(apiBase + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function readHardware(token: string): Promise<Json> {
  const res = await api(token, 'GET', `/catalog/hardware/${HW_ID}`);
  expect(res.status, `GET hardware: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as Json;
}

async function loginOwner(page: Page): Promise<string> {
  let browserToken: string | null = null;
  page.on('request', (req) => {
    const auth = req.headers().authorization;
    if (auth?.startsWith('Bearer ')) browserToken = auth.slice('Bearer '.length);
  });
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  expect(browserToken, 'browser session token').toBeTruthy();
  return browserToken ?? '';
}

test.describe.serial('Herrajes — partes de diseño (#1417)', () => {
  test('autora 2 partes en el editor → readback exacto → F5 persiste; inválida bloquea', async ({ page }) => {
    test.setTimeout(150_000);
    const token = await loginOwner(page);

    // Fixture autocontenida: herraje SIN partes (camino legacy).
    const created = await api(token, 'POST', '/catalog/hardware', {
      id: HW_ID,
      code: HW_CODE,
      name: 'Corredera izquierda con partes',
      unit: 'piece',
      cost_per_unit: 0,
      active: true,
    });
    expect([201, 409]).toContain(created.status); // 409 = corrida previa interrumpida
    const before = await readHardware(token);
    expect(before.design_parts ?? []).toEqual([]);

    await page.goto('/hardware');
    await page.getByTestId('hardware-kit-wizard-open').waitFor({ state: 'visible', timeout: 20_000 });
    // Buscar la fila y abrir el editor.
    const search = page.getByLabel('Buscar herrajes');
    await search.fill(HW_CODE);
    await page
      .getByRole('button', { name: `Editar ${HW_CODE}` })
      .evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByTestId('hardware-form-modal')).toBeVisible();

    // Autoría: 2 partes (fija + móvil).
    await page.getByTestId('hardware-design-parts-add').click();
    await page.getByTestId('hardware-design-part-0-name').fill('riel_fijo');
    await page.getByTestId('hardware-design-part-0-label').fill('Riel fijo');
    await page.getByTestId('hardware-design-parts-add').click();
    await page.getByTestId('hardware-design-part-1-name').fill('riel_movil');
    await page.getByTestId('hardware-design-part-1-membership').selectOption('actor:drawer');
    await page.getByTestId('hardware-design-part-1-finish').fill('body');

    await page.getByTestId('hardware-form-submit-btn').click();
    await expect(page.getByTestId('hardware-form-modal')).toBeHidden({ timeout: 20_000 });

    // Readback exacto por API.
    const after = await readHardware(token);
    const parts = (after.design_parts ?? []) as readonly Json[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ componentName: 'riel_fijo', actorMembership: 'body', label: 'Riel fijo' });
    expect(parts[1]).toMatchObject({
      componentName: 'riel_movil',
      actorMembership: 'actor:drawer',
      finishKey: 'body',
    });

    // F5: persiste (hidratado del servidor, no estado de pantalla).
    await page.reload();
    await page
      .getByRole('button', { name: `Editar ${HW_CODE}` })
      .evaluate((el) => (el as HTMLElement).click());
    await expect(page.getByTestId('hardware-design-part-0-name')).toHaveValue('riel_fijo', { timeout: 20_000 });
    await expect(page.getByTestId('hardware-design-part-1-membership')).toHaveValue('actor:drawer');

    // Negativo: membresía inválida tecleada directamente en el select no es
    // posible; la invalidez real llega por fila duplicada → el validador del
    // dominio bloquea en el submit sin llamada al servidor.
    await page.getByTestId('hardware-design-parts-add').click();
    await page.getByTestId('hardware-design-part-2-name').fill('riel_fijo');
    await page.getByTestId('hardware-design-part-2-membership').selectOption('body');
    let sawPut = false;
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes(`/catalog/hardware/${HW_ID}`)) sawPut = true;
    });
    await page.getByTestId('hardware-form-submit-btn').click();
    await expect(page.locator('.catalog-form__error')).toContainText('more than once', { timeout: 10_000 });
    expect(sawPut, 'el guardado inválido no debe llegar al servidor').toBe(false);
  });
});
