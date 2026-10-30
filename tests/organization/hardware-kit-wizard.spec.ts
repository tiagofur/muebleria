/*
 * #1416 — browser proof del asistente «Juego de herraje»: desde CATÁLOGOS →
 * Herrajes, UNA pantalla produce kit comercial + 4 herrajes de diseño + cajón
 * con receta (anclajes min/max, membresías body/actor:drawer, kit como única
 * compra, cinemática translate, sin hardwareLines). Re-ejecutar sobre códigos
 * existentes reutiliza sin duplicar. Sin archivos SKP en el spec (no hay
 * fixture SKP válida; el camino con archivo está cubierto por los tests
 * unitarios del helper con servicio falso).
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const KIT = '09690000-0000-4000-8000-000000001416';
const KIT_CODE = 'AUT-KIT-WIZ';

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

async function readAgregadoByCode(token: string, code: string): Promise<Json | null> {
  const res = await api(token, 'GET', '/catalog/agregados');
  expect(res.status).toBe(200);
  const list = res.body as readonly Json[];
  const found = list.find(
    (a) => (a.code as string) === code || (a.code as string) === undefined,
  );
  const byCode = (res.body as readonly Json[]).find((a) => a.code === code);
  return byCode ?? found ?? null;
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

test.describe.serial('Herrajes — asistente Juego de herraje (#1416)', () => {
  test('una pantalla → kit + 4 diseños + cajón con receta; re-ejecución reutiliza', async ({ page }) => {
    test.setTimeout(150_000);
    const token = await loginOwner(page);

    // Limpieza defensiva de corridas previas interrumpidas (DB del gate es
    // desechable, pero el spec puede re-correr sobre la misma base). Partes
    // PRIMERO (un kit con partes vinculadas responde 409 al desactivarse —
    // #1422 perfección) y el kit tolera 409 defensivamente.
    const staleAgr = await readAgregadoByCode(token, `${KIT_CODE}-CAJON`);
    if (staleAgr) {
      const del = await api(token, 'DELETE', `/catalog/agregados/${staleAgr.id as string}`);
      expect([200, 204]).toContain(del.status);
    }
    for (const suffix of ['-FIJ-I', '-FIJ-D', '-MOV-I', '-MOV-D']) {
      const stale = await readHardwareByCode(token, `${KIT_CODE}${suffix}`);
      if (stale) {
        const del = await api(token, 'DELETE', `/catalog/hardware/${stale.id as string}`);
        expect([200, 204]).toContain(del.status);
      }
    }
    const staleKit = await readHardwareByCode(token, KIT_CODE);
    if (staleKit) {
      const del = await api(token, 'DELETE', `/catalog/hardware/${staleKit.id as string}`);
      expect([200, 204, 409]).toContain(del.status);
    }

    await page.goto('/hardware');
    await page.getByTestId('hardware-kit-wizard-open').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('hardware-kit-wizard-open').click();
    await expect(page.getByTestId('hardware-kit-wizard')).toBeVisible();

    await page.getByTestId('hardware-kit-wizard-code').fill(KIT_CODE);
    await page.getByTestId('hardware-kit-wizard-name').fill('Corredera telescopica wizard');
    await page.getByTestId('hardware-kit-wizard-price').fill('420');

    // Preview en vivo con los códigos derivados antes de crear.
    const preview = page.getByTestId('hardware-kit-wizard-preview');
    await expect(preview).toContainText(`${KIT_CODE}-CAJON`);
    await expect(preview).toContainText(`${KIT_CODE}-FIJ-I`);

    await page.getByTestId('hardware-kit-wizard-submit').click();
    await expect(page.getByTestId('hardware-kit-wizard-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('hardware-kit-wizard-result')).toContainText(`${KIT_CODE}-CAJON`);

    // --- Readback exacto por API ---
    const agr = await readAgregadoByCode(token, `${KIT_CODE}-CAJON`);
    expect(agr, 'agregado creado por el wizard').not.toBeNull();
    expect(agr!.hardware_lines ?? []).toEqual([]);
    expect(agr!.presentation_motion).toMatchObject({ kind: 'translate' });

    const members = (agr!.rigid_members ?? []) as readonly Json[];
    expect(members.map((m) => m.memberId)).toEqual([
      'fixed_rail_left',
      'fixed_rail_right',
      'moving_rail_left',
      'moving_rail_right',
    ]);
    const byId = new Map(members.map((m) => [m.memberId as string, m]));
    expect(byId.get('fixed_rail_left')).toMatchObject({
      actorMembership: 'body',
      bomRole: 'included_in_kit',
      placement: { x: { ref: 'min', offsetMm: 10 } },
    });
    expect(byId.get('fixed_rail_right')).toMatchObject({
      actorMembership: 'body',
      placement: { x: { ref: 'max', offsetMm: -10 } },
    });
    expect(byId.get('moving_rail_left')).toMatchObject({ actorMembership: 'actor:drawer' });
    expect(byId.get('moving_rail_right')).toMatchObject({ actorMembership: 'actor:drawer' });

    const kitRow = await readHardwareByCode(token, KIT_CODE);
    expect(kitRow).toMatchObject({ unit: 'set', cost_per_unit: 420 });
    expect(agr!.commercial_kit_hardware_id).toBe(kitRow!.id as string);

    const designLeft = await readHardwareByCode(token, `${KIT_CODE}-FIJ-I`);
    expect(designLeft).toMatchObject({ unit: 'piece', cost_per_unit: 0, preview_shape: 'slide' });
    // #1423 rev: el link kit↔parte también en ALTA NUEVA (no solo reuso
    // legacy) — las 4 partes nacen vinculadas al kit generado.
    for (const suffix of ['-FIJ-I', '-FIJ-D', '-MOV-I', '-MOV-D']) {
      const part = await readHardwareByCode(token, `${KIT_CODE}${suffix}`);
      expect(part?.kit_hardware_id, `${KIT_CODE}${suffix}`).toBe(kitRow!.id as string);
    }
    expect(byId.get('fixed_rail_left')!.source).toMatchObject({
      kind: 'fixed',
      fixed: { hardwareId: designLeft!.id },
    });

    // --- Re-ejecución: reutiliza herrajes, fail-closed en el cajón ---
    await page.getByTestId('hardware-kit-wizard-close').click();
    await page.getByTestId('hardware-kit-wizard-open').click();
    await page.getByTestId('hardware-kit-wizard-code').fill(KIT_CODE);
    await page.getByTestId('hardware-kit-wizard-name').fill('Corredera telescopica wizard');
    await page.getByTestId('hardware-kit-wizard-price').fill('420');
    // La preview marca el cajón existente y bloquea el submit.
    await expect(preview).toContainText('ya existe');
    await expect(page.getByTestId('hardware-kit-wizard-submit')).toBeDisabled();
  });
});
