/*
 * #1418 — browser proof de presets de receta y anclas con fórmula: el preset
 * «cajón con correderas» arma 4 miembros (fijas body + móviles actor:drawer,
 * anclajes min/max); el preset «riel centrado» arma 1 miembro con
 * offsetFormula PW/2; guardar crea la revisión con readback exacto y la
 * fórmula resuelve contra el ancho en el servidor (resolver Go).
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const HW_ID = '09690000-0000-4000-8000-000000001418';
const HW_CODE = 'AUT-CORR-FORM';
const AGREGADO_ID = '09690000-0000-4000-8000-000000001419';
const AGREGADO_CODE = 'AUT-CAJON-FORM';

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

async function readAgregado(token: string): Promise<Json> {
  const res = await api(token, 'GET', `/catalog/agregados/${AGREGADO_ID}`);
  expect(res.status, `GET agregado: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as Json;
}

/** Espera el PUT del guardado: el readback exige commit del servidor. */
async function saveAndAwaitPut(page: Page): Promise<number | null> {
  const done = page
    .waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes(`/catalog/agregados/${AGREGADO_ID}`),
      { timeout: 20_000 },
    )
    .then((res) => res.status())
    .catch(() => null);
  await page.getByTestId('agregado-save-btn').click();
  const status = await done;
  await page.getByTestId('agregado-editor-page').waitFor({ state: 'hidden', timeout: 20_000 });
  return status;
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

test.describe.serial('Agregado — presets y anclas con fórmula (#1418)', () => {
  test('preset cajón → 4 miembros; preset centrado → offsetFormula PW/2; readback y resolución server', async ({ page }) => {
    test.setTimeout(150_000);
    const token = await loginOwner(page);

    // Fixture autocontenida: herraje + agregado SIN receta (camino del owner).
    const hw = await api(token, 'POST', '/catalog/hardware', {
      id: HW_ID, code: HW_CODE, name: 'Corredera para fórmulas', unit: 'piece', cost_per_unit: 0, active: true,
    });
    expect([201, 409]).toContain(hw.status);
    const created = await api(token, 'POST', '/catalog/agregados', {
      id: AGREGADO_ID, code: AGREGADO_CODE, name: 'Cajón fórmulas',
      width_mm: 400, height_mm: 150, depth_mm: 500, active: true,
    });
    expect([201, 409]).toContain(created.status);

    await page.goto(`/add-ons/${AGREGADO_ID}`);
    await page.getByTestId('agregado-detail-edit').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('agregado-detail-edit').click();
    await page.getByTestId('agregado-editor-page').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: 'Receta' }).click();

    // Kit + preset «cajón con correderas».
    await page
      .getByTestId('agregado-tab-recipe-authoring-kit')
      .selectOption({ label: `${HW_CODE} — Corredera para fórmulas` });
    await page.getByTestId('agregado-tab-recipe-authoring-preset-drawer-slides').click();
    await saveAndAwaitPut(page);
    // Readback exacto: 4 miembros con membresías y anclajes del preset.
    const afterPreset = await readAgregado(token);
    const members = (afterPreset.rigid_members ?? []) as readonly Json[];
    expect(members.map((m) => m.memberId)).toEqual([
      'fixed_rail_left', 'fixed_rail_right', 'moving_rail_left', 'moving_rail_right',
    ]);
    expect(members[0]).toMatchObject({
      actorMembership: 'body',
      placement: { x: { ref: 'min', offsetMm: 10 } },
    });
    expect(members[3]).toMatchObject({
      actorMembership: 'actor:drawer',
      placement: { x: { ref: 'max', offsetMm: -10 } },
    });

    // Reeditar: preset «riel centrado» reemplaza los miembros con 1 fórmula.
    // Esperar a que el refetch del detalle termine (el GET del hidratado) ANTES
    // de abrir el editor: si el estado llega tarde, pisa el preset.
    let formulaPutBody: string | null = null;
    page.on('request', (req) => {
      if (
        req.method() === 'PUT' &&
        req.url().includes(`/catalog/agregados/${AGREGADO_ID}`)
      ) {
        formulaPutBody = req.postData() ?? null;
      }
    });
    await page.waitForTimeout(1_500);
    await page.getByTestId('agregado-detail-edit').click();
    await page.getByTestId('agregado-editor-page').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: 'Receta' }).click();
    await page
      .getByTestId('agregado-tab-recipe-authoring-member-3')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('agregado-tab-recipe-authoring-preset-center-rail').click();
    // Con miembros existentes el preset pide confirmación (#1422 perfección,
    // sin pérdida silenciosa de autoría): aceptar el reemplazo.
    await page
      .getByTestId('agregado-tab-recipe-authoring-preset-confirm-yes')
      .click({ timeout: 5_000 });
    // El panel debe mostrar EXACTAMENTE 1 miembro antes de guardar; si una
    // hidratación tardía lo pisó, falla acá y no en el readback.
    await expect(
      page.getByText('Miembros rígidos (1)', { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    const status = await saveAndAwaitPut(page);
    expect(status, 'PUT del segundo guardado').toBe(200);
    expect(formulaPutBody, 'el PUT del segundo guardado').toContain('offsetFormula');

    const afterFormula = await readAgregado(token);
    const fMembers = (afterFormula.rigid_members ?? []) as readonly Json[];
    expect(fMembers).toHaveLength(1);
    expect(fMembers[0]).toMatchObject({
      memberId: 'rail_center',
      placement: { x: { ref: 'min', offsetMm: 0, offsetFormula: 'PW/2' } },
    });

    // La receta con fórmula es VÁLIDA en el servidor (el PUT validó fail-closed)
    // y el agregado sigue resolviendo: la simulación de receta del servidor
    // evalúa la fórmula con las dims del agregado (400/2 = 200).
    const sim = await api(token, 'POST', `/catalog/agregados/${AGREGADO_ID}/recipe-change/simulate`, {
      candidate: afterFormula,
      params: { widthMm: 400, heightMm: 150, depthMm: 500 },
    });
    expect(sim.status, `simulate: ${JSON.stringify(sim.body)}`).toBe(200);
  });
});
