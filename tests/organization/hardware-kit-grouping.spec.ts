/*
 * #1422 slice 1 — browser proof de la agrupación kit↔partes: un juego legacy
 * (partes sin link, como las creadas antes de la migración) queda vinculado
 * al RE-ejecutar el asistente; la lista muestra el kit como una fila con
 * badge y las partes OCULTAS por defecto (el chip las muestra; el search
 * siempre las encuentra); editar una parte NO borra su link.
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const KIT_ID = '09690000-0000-4000-8000-000000001422';
const KIT_CODE = 'AUT-KIT-GRUPO';
const PART_CODES = [`${KIT_CODE}-FIJ-I`, `${KIT_CODE}-FIJ-D`, `${KIT_CODE}-MOV-I`, `${KIT_CODE}-MOV-D`];

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

async function readHardwareByCode(token: string, code: string): Promise<Json | null> {
  const res = await api(token, 'GET', '/catalog/hardware');
  expect(res.status).toBe(200);
  return ((res.body as readonly Json[]) ?? []).find((h) => h.code === code) ?? null;
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

test.describe.serial('Herrajes — agrupación kit↔partes (#1422 slice 1)', () => {
  test('legacy sin link → re-ejecutar asistente vincula → lista agrupa → edición conserva', async ({ page }) => {
    test.setTimeout(180_000);
    const token = await loginOwner(page);

    // Limpieza defensiva de corridas previas (hijos primero).
    for (const code of PART_CODES) {
      const stale = await readHardwareByCode(token, code);
      if (stale) expect((await api(token, 'DELETE', `/catalog/hardware/${stale.id as string}`)).status).toBe(200);
    }
    const staleKit = await readHardwareByCode(token, KIT_CODE);
    if (staleKit) expect((await api(token, 'DELETE', `/catalog/hardware/${staleKit.id as string}`)).status).toBe(200);

    // Simular LEGADO: kit + 4 partes SIN kit_hardware_id (como antes de la
    // migración — exactamente el caso 49402645 del owner).
    const mk = await api(token, 'POST', '/catalog/hardware', {
      id: KIT_ID, code: KIT_CODE, name: 'Corredera agrupada', unit: 'set', cost_per_unit: 150, active: true,
    });
    expect([201, 409]).toContain(mk.status);
    const partIds = [
      '09690000-0000-4000-8000-000000001423',
      '09690000-0000-4000-8000-000000001424',
      '09690000-0000-4000-8000-000000001425',
      '09690000-0000-4000-8000-000000001426',
    ];
    let i = 0;
    for (const [suffix, name] of [
      ['-FIJ-I', 'Guía fija izquierda'], ['-FIJ-D', 'Guía fija derecha'],
      ['-MOV-I', 'Corredera móvil izquierda'], ['-MOV-D', 'Corredera móvil derecha'],
    ] as const) {
      const part = await api(token, 'POST', '/catalog/hardware', {
        id: partIds[i], code: KIT_CODE + suffix, name: `Corredera agrupada — ${name}`,
        unit: 'piece', cost_per_unit: 0, active: true,
      });
      expect([201, 409]).toContain(part.status);
      i += 1;
    }
    for (const code of PART_CODES) {
      expect((await readHardwareByCode(token, code))?.kit_hardware_id ?? null).toBeNull();
    }

    // Re-ejecutar el asistente sobre los códigos existentes → reutiliza y
    // VINCULA (sin UI extra, misma mutación).
    await page.goto('/hardware');
    await page.getByTestId('hardware-kit-wizard-open').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('hardware-kit-wizard-open').click();
    await page.getByTestId('hardware-kit-wizard-code').fill(KIT_CODE);
    await page.getByTestId('hardware-kit-wizard-name').fill('Corredera agrupada');
    await page.getByTestId('hardware-kit-wizard-price').fill('150');
    await page.getByTestId('hardware-kit-wizard-submit').click();
    await expect(page.getByTestId('hardware-kit-wizard-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('hardware-kit-wizard-result')).toContainText('Reutilizados');
    await page.getByTestId('hardware-kit-wizard-close').click();

    // Readback: las 4 partes quedaron vinculadas al kit.
    for (const code of PART_CODES) {
      const part = await readHardwareByCode(token, code);
      expect(part?.kit_hardware_id, code).toBe(KIT_ID);
    }

    // Lista SIN búsqueda: las partes NUNCA son filas planas (#1422 owner) —
    // viven anidadas dentro del card expandido del kit, con badge de
    // membresía (fija/móvil) y acciones propias.
    await page.goto('/hardware');
    await expect(page.getByTestId(`hardware-kit-parts-badge-${KIT_CODE}`)).toContainText('4 partes');
    await expect(page.getByText(`${KIT_CODE}-FIJ-I`)).toHaveCount(0);

    // Expandir el kit (click en el badge, burbujea a la fila) → los cards
    // anidados con el badge de membresía de la receta.
    await page.getByTestId(`hardware-kit-parts-badge-${KIT_CODE}`).click();
    await expect(page.getByTestId(`hardware-kit-parts-${KIT_CODE}`)).toBeVisible();
    await expect(page.getByTestId(`hardware-kit-part-card-${KIT_CODE}-FIJ-I`)).toBeVisible();
    await expect(
      page.getByTestId(`hardware-kit-part-membership-${KIT_CODE}-FIJ-I`),
    ).toContainText('Fija al mueble');

    // Colapsar el kit: su detalle expandido taparía los clicks de las filas
    // de abajo (con búsqueda, kit y partes conviven en la lista).
    await page.getByTestId(`hardware-kit-parts-badge-${KIT_CODE}`).click();
    await expect(page.getByTestId(`hardware-kit-parts-${KIT_CODE}`)).toHaveCount(0);

    // Editar una parte desde su fila (búsqueda activa) → el link SOBREVIVE.
    await page.getByLabel('Buscar herrajes').fill(KIT_CODE);
    await page
      .getByRole('button', { name: `Editar ${KIT_CODE}-FIJ-I` })
      .first()
      .click();
    await page.getByTestId('hardware-form-modal').waitFor({ state: 'visible' });
    const nameInput = page.getByLabel('Nombre');
    await nameInput.fill('Corredera agrupada — Guía fija izquierda (editada)');
    await page.getByTestId('hardware-form-submit-btn').click();
    await expect(page.getByTestId('hardware-form-modal')).toBeHidden({ timeout: 20_000 });
    const edited = await readHardwareByCode(token, `${KIT_CODE}-FIJ-I`);
    expect(edited?.kit_hardware_id).toBe(KIT_ID);
    expect(edited?.name).toContain('editada');
  });
});
