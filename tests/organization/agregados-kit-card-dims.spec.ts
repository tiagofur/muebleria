/*
 * #1460 — browser proof de la pestaña Herrajes con el kit mandando:
 *
 *   El kit comercial (sólo unit 'set') se elige en el picker compartido con
 *   feedback de sus partes → los miembros cuya parte pertenece al juego se
 *   resumen en UNA tarjeta read-only (chips, sin controles, CTA Catálogos) →
 *   el herraje añadido a mano conserva su tarjeta editable con la posición
 *   X/Y/Z visible sin expandir, el preset «Centrar» (X: mínimo + PW/2) y el
 *   override de dimensiones mm|fórmula → el PUT lleva dimensionOverrides y el
 *   readback del servidor lo conserva (paridad UI→Go→JSONB) → reabrir el
 *   editor renderiza el estado persistido.
 *
 * Igual que #1451/#1418: sin archivos SKP, semillas por API con códigos fijos
 * (201 creado / 409 ya existía) y re-ejecución idempotente.
 */
import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const KIT_ID = '09690000-0000-4000-8000-000000001460';
const PART_L_ID = '09690000-0000-4000-8000-000000001461';
const OWN_HW_ID = '09690000-0000-4000-8000-000000001463';
const AGR_ID = '09690000-0000-4000-8000-000000001464';
const KIT_CODE = 'AUT-KIT-1460';
const AGR_CODE = 'AUT-AGR-1460';

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

async function pickCombobox(page: Page, testId: string, label: RegExp): Promise<void> {
  const picker = page.getByTestId(testId);
  await picker.getByRole('button').click();
  await picker.getByRole('option', { name: label }).first().click();
  await expect(picker.getByRole('option', { name: label })).toHaveCount(0);
}

test.describe.serial('AGREGADOS — el kit manda + herraje propio paramétrico (#1460)', () => {
  test('tarjeta única de kit, miembros derivados read-only y dimensiones con fórmula', async ({ page }) => {
    test.setTimeout(180_000);
    const token = await loginOwner(page);

    // Semilla idempotente: kit (set) + 1 parte + herraje propio.
    const kit = await api(token, 'POST', '/catalog/hardware', {
      id: KIT_ID, code: KIT_CODE, name: 'Corredera juego (gate #1460)', unit: 'set', cost_per_unit: 250, active: true,
    });
    expect([201, 409], `seed kit: ${JSON.stringify(kit.body)}`).toContain(kit.status);
    const part = await api(token, 'POST', '/catalog/hardware', {
      id: PART_L_ID, code: 'AUT-KIT-1460-MOV-I', name: 'Corredera móvil izq (gate #1460)',
      unit: 'piece', cost_per_unit: 0, active: true, kit_hardware_id: KIT_ID,
    });
    expect([201, 409], `seed parte: ${JSON.stringify(part.body)}`).toContain(part.status);
    const own = await api(token, 'POST', '/catalog/hardware', {
      id: OWN_HW_ID, code: 'AUT-TIR-1460', name: 'Tirador gate #1460',
      unit: 'piece', cost_per_unit: 30, active: true,
      dimensions: { widthMm: 200, heightMm: 30, depthMm: 20 },
    });
    expect([201, 409], `seed propio: ${JSON.stringify(own.body)}`).toContain(own.status);

    // Limpieza + semilla del agregado por API (id fijo): editar desde el
    // detalle hace que el guardado sea PUT y el readback use el mismo id.
    const list = await api(token, 'GET', '/catalog/agregados');
    expect(list.status).toBe(200);
    const stale = ((list.body as readonly Json[]) ?? []).find((a) => a.code === AGR_CODE);
    if (stale) {
      const del = await api(token, 'DELETE', `/catalog/agregados/${stale.id as string}`);
      expect([200, 204, 404], `delete stale: ${del.status}`).toContain(del.status);
    }
    const created = await api(token, 'POST', '/catalog/agregados', {
      id: AGR_ID, code: AGR_CODE, name: 'Cajón Kit Manda',
      width_mm: 600, height_mm: 150, depth_mm: 500, active: true,
    });
    expect([201, 409], `seed agregado: ${JSON.stringify(created.body)}`).toContain(created.status);

    await page.goto(`/add-ons/${AGR_ID}`);
    await page.getByTestId('agregado-detail-edit').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('agregado-detail-edit').click();
    await page.getByTestId('agregado-editor-page').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: 'Herrajes' }).click();

    // El selector de kit sólo lista juegos: el tirador (piece) no aparece.
    const kitPicker = page.getByTestId('agregado-cajon-hardware-kit');
    await kitPicker.getByRole('button').click();
    await expect(kitPicker.getByRole('option', { name: new RegExp(KIT_CODE) })).toBeVisible();
    await expect(kitPicker.getByRole('option', { name: /TIR-1460/ })).toHaveCount(0);
    await kitPicker.getByRole('option', { name: new RegExp(KIT_CODE) }).click();
    await expect(page.getByTestId('agregado-cajon-hardware-kit-parts')).toContainText(
      'agrupa 1 herraje(s)',
    );

    // Miembro con parte del kit ⇒ se resume en la tarjeta única (sin tarjeta
    // editable para el subitem del juego). #1462: la sección es el punto de
    // entrada — sin chooser global.
    await page.getByTestId('agregado-cajon-hardware-add-member').click();
    await expect(page.getByTestId('agregado-cajon-hardware-member-0-identity-error')).toBeVisible();
    await pickCombobox(page, 'agregado-cajon-hardware-member-0-hardware', /MOV-I/);
    const kitCard = page.getByTestId('agregado-cajon-hardware-kit-card');
    await expect(kitCard).toContainText(KIT_CODE);
    await expect(kitCard).toContainText('1 herraje(s) incluido(s)');
    await expect(page.getByTestId('agregado-cajon-hardware-kit-member-0')).toContainText('MOV-I');
    await expect(page.getByTestId('agregado-cajon-hardware-member-0')).toHaveCount(0);

    // Herraje propio (fuera del juego): conserva tarjeta editable completa.
    await page.getByTestId('agregado-cajon-hardware-add-member').click();
    await pickCombobox(page, 'agregado-cajon-hardware-member-1-hardware', /TIR-1460/);
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-anchor-y-ref')).toBeVisible();
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-anchor-z-ref')).toBeVisible();

    // Preset «Centrar»: X desde mínimo + PW/2 (acompaña el ancho).
    await page.getByTestId('agregado-cajon-hardware-member-1-center-x').click();
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-anchor-x-offset')).toHaveValue('PW/2');

    // Dimensiones: mm en ancho, fórmula en fondo; el catálogo (200×30×20) es
    // el placeholder y el efectivo refleja el override con el envelope.
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-dim-width')).toHaveAttribute(
      'placeholder',
      /200/,
    );
    await page.getByTestId('agregado-cajon-hardware-member-1-dim-width').fill('120');
    await page.getByTestId('agregado-cajon-hardware-member-1-dim-depth').fill('PD/10');
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-dims-effective')).toContainText('120');
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-dims-effective')).toContainText('50');

    // Guardar: el PUT viaja con dimensionOverrides; el servidor lo valida y
    // conserva (recipe JSONB).
    let putBody: string | null = null;
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes(`/catalog/agregados/${AGR_ID}`)) {
        putBody = req.postData();
      }
    });
    await page.getByTestId('agregado-save-btn').click();
    await expect(page.getByTestId('agregado-editor-page')).toHaveCount(0);
    expect(putBody, 'el PUT lleva dimensionOverrides').toContain('dimensionOverrides');

    const readback = await api(token, 'GET', `/catalog/agregados/${AGR_ID}`);
    expect(readback.status).toBe(200);
    const members = (readback.body as Json).rigid_members as readonly Json[];
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({
      memberId: 'miembro-1',
      source: { kind: 'fixed', fixed: { hardwareId: PART_L_ID } },
    });
    expect(members[1]).toMatchObject({
      dimensionOverrides: { width: { mm: 120 }, depth: { formula: 'PD/10' } },
      placement: { x: { ref: 'min', offsetMm: 0, offsetFormula: 'PW/2' } },
    });

    // Reabrir el editor: el estado persistido se renderiza (dims y fórmula).
    await page.goto(`/add-ons/${AGR_ID}`);
    await page.getByTestId('agregado-detail-edit').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('agregado-detail-edit').click();
    await page.getByTestId('agregado-editor-page').waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: 'Herrajes' }).click();
    await expect(page.getByTestId('agregado-cajon-hardware-kit-card')).toContainText(KIT_CODE);
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-dim-width')).toHaveValue('120');
    await expect(page.getByTestId('agregado-cajon-hardware-member-1-anchor-x-offset')).toHaveValue('PW/2');
  });
});
