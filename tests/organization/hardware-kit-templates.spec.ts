/*
 * #1422 slice 2 — browser proof de las plantillas de juego: el asistente
 * «Bisagra» arma kit + 2 partes (copa fija body / brazo móvil actor:door)
 * + agregado PUERTA con motion rotate; readback exacto por API.
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const KIT_ID = '09690000-0000-4000-8000-000000001427';
const KIT_CODE = 'AUT-BIS-HINGE';

type Json = Record<string, unknown>;

async function api(
  token: string,
  method: string,
  path: string,
  body?: Json,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(apiBase + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
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

test.describe.serial('Herrajes — plantilla bisagra (#1422 slice 2)', () => {
  test('asistente bisagra → kit + copa + brazo + puerta con rotate', async ({ page }) => {
    test.setTimeout(150_000);
    const token = await loginOwner(page);

    await page.goto('/hardware');
    await page.getByTestId('hardware-kit-wizard-open').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('hardware-kit-wizard-open').click();
    await page.getByTestId('hardware-kit-wizard-template-select').selectOption('hinge');
    await page.getByTestId('hardware-kit-wizard-code').fill(KIT_CODE);
    await page.getByTestId('hardware-kit-wizard-name').fill('Bisagra Clip Top');
    await page.getByTestId('hardware-kit-wizard-price').fill('85');

    const preview = page.getByTestId('hardware-kit-wizard-preview');
    await expect(preview).toContainText(`${KIT_CODE}-COPA`);
    await expect(preview).toContainText(`${KIT_CODE}-BRAZO`);

    await page.getByTestId('hardware-kit-wizard-submit').click();
    await expect(page.getByTestId('hardware-kit-wizard-result')).toBeVisible({ timeout: 30_000 });

    // Readback: agregado puerta con motion rotate y membresías de plantilla.
    const res = await api(token, 'GET', '/catalog/agregados');
    expect(res.status).toBe(200);
    const agregados = res.body as readonly Json[];
    const puerta = agregados.find((a) => a.code === `${KIT_CODE}-PUERTA`);
    expect(puerta, 'agregado puerta creado').toBeTruthy();
    expect(puerta!.presentation_motion).toMatchObject({ kind: 'rotate', pivot: 'left' });
    const members = (puerta!.rigid_members ?? []) as readonly Json[];
    expect(members.map((m) => m.memberId)).toEqual(['hinge_cup', 'hinge_arm']);
    expect(members[0]).toMatchObject({ actorMembership: 'body' });
    expect(members[1]).toMatchObject({ actorMembership: 'actor:door' });

    // Las 2 partes quedaron vinculadas al kit (slice 1).
    const hw = await api(token, 'GET', '/catalog/hardware');
    const rows = hw.body as readonly Json[];
    const kit = rows.find((h) => h.code === KIT_CODE);
    const copa = rows.find((h) => h.code === `${KIT_CODE}-COPA`);
    const brazo = rows.find((h) => h.code === `${KIT_CODE}-BRAZO`);
    // El id del kit lo genera el asistente: el link apunta a ESE id.
    expect(copa?.kit_hardware_id).toBe(kit?.id);
    expect(brazo?.kit_hardware_id).toBe(kit?.id);
  });
});
