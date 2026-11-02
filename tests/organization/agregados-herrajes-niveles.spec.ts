/*
 * #1451 — browser proof de la pestaña Herrajes del editor de agregados
 * reorganizada por nivel de anclaje:
 *
 *   «+ Añadir herraje» pregunta el nivel → «Del agregado» autoriza los
 *   rigidMembers del borrador con copy de taller (el caso solo-herraje del
 *   owner: el kit de correderas es del cajón, no de un costado) → el 3D del
 *   borrador lo refleja sin guardar → sin herraje el guardado no viaja →
 *   con herraje el PUT crea la revisión y la lectura agrupa por nivel sin
 *   doble conteo (subsume #1443: mixto piezas + miembros en una sola voz).
 *
 * Igual que #1416: sin archivos SKP; semilla de herraje por API con código
 * fijo (201 creado / 409 ya existía) y re-ejecución idempotente.
 */
import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const HW_CODE = 'AUT-HW-1451';
const AGR_CODE = 'AUT-AGR-1451';

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

async function findAgregadoByCode(token: string, code: string): Promise<Json | null> {
  const res = await api(token, 'GET', '/catalog/agregados');
  expect(res.status).toBe(200);
  return ((res.body as readonly Json[]) ?? []).find((a) => a.code === code) ?? null;
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

async function pickHardware(page: Page, pickerTestId: string): Promise<void> {
  const picker = page.getByTestId(pickerTestId);
  await picker.getByRole('button').click();
  // Scoped al popover del picker: el kit comercial (select nativo) también
  // lista options con el mismo nombre.
  await picker.getByRole('option', { name: new RegExp(HW_CODE) }).click();
  await expect(picker.getByRole('option', { name: new RegExp(HW_CODE) })).toHaveCount(0);
}

test.describe.serial('AGREGADOS — pestaña Herrajes por nivel de anclaje (#1451)', () => {
  test('solo-herraje: del agregado con par izq/der, 3D del borrador, guardado y lectura', async ({ page }) => {
    test.setTimeout(180_000);
    const token = await loginOwner(page);

    // Semilla idempotente + limpieza del agregado de una corrida previa.
    const seed = await api(token, 'POST', '/catalog/hardware', {
      code: HW_CODE,
      name: 'Corredera telescopica (seed #1451)',
      unit: 'piece',
      cost_per_unit: 90,
    });
    expect([201, 409], `seed hardware: ${await seed.body?.toString()}`).toContain(seed.status);
    const stale = await findAgregadoByCode(token, AGR_CODE);
    if (stale) {
      const del = await api(token, 'DELETE', `/catalog/agregados/${stale.id as string}`);
      expect([200, 204, 404], `delete stale agregado: ${del.status}`).toContain(del.status);
    }

    await page.goto('/add-ons');
    await page.getByTestId('create-agregado-btn').click();
    await expect(page.getByTestId('agregado-editor-page')).toBeVisible();
    await page.getByTestId('agregado-field-code').fill(AGR_CODE);
    await page.getByTestId('agregado-field-name').fill('Cajón Herrajes Niveles');
    await page.getByTestId('agregado-field-width').fill('564');
    await page.getByTestId('agregado-field-height').fill('150');
    await page.getByTestId('agregado-field-depth').fill('500');

    await page.getByRole('tab', { name: 'Herrajes' }).click();

    // #1443: el caso solo-herraje ya no miente — el empty de piezas enseña.
    await expect(page.getByTestId('agregado-hw-placements-empty')).toContainText(
      'Sin piezas en el agregado',
    );

    // El chooser pregunta el nivel; «Del agregado» agrega el primer miembro.
    await page.getByTestId('agregado-add-hardware').click();
    await expect(page.getByTestId('agregado-hw-chooser')).toBeVisible();
    await page.getByTestId('agregado-hw-chooser-cajon').click();
    await expect(
      page.getByTestId('agregado-cajon-hardware-member-0-identity-error'),
    ).toBeVisible();

    // La plantilla del taller reemplaza con confirmación: 4 miembros izq/der.
    await page.getByTestId('agregado-cajon-hardware-preset-pair').click();
    await page.getByTestId('agregado-cajon-hardware-preset-confirm-yes').click();
    await expect(page.getByTestId('agregado-cajon-hardware-member-3')).toBeVisible();

    // Badge por nivel: 4 posiciones, nunca la suma cruda.
    await expect(page.getByTestId('agregado-editor-tab-hardware')).toContainText('4 pos.');

    // Mientras los herrajes están vacíos, el 3D del borrador muestra el
    // diagnóstico honesto en vez de inventar geometría.
    await expect(page.getByTestId('agregado-editor-3d-preview')).toContainText(
      'fixed source requires non-empty hardwareId',
    );

    // Sin herraje el guardado NO viaja: fail-closed con error visible y el
    // editor redirige a la pestaña donde vive el problema (Receta).
    await page.getByTestId('agregado-save-btn').click();
    await expect(page.getByTestId('form-error')).toContainText('Receta inválida');

    // El autor elige el herraje real en cada tarjeta — sin default encubierto.
    await page.getByRole('tab', { name: 'Herrajes' }).click();
    for (let i = 0; i < 4; i += 1) {
      await pickHardware(page, `agregado-cajon-hardware-member-${i}-hardware`);
    }

    // Con herraje, el 3D del borrador proyecta la receta en vivo (sin guardar).
    const preview = page.getByTestId('agregado-editor-3d-preview');
    await expect(preview).toBeVisible();
    await expect(preview).not.toContainText('No se pudo proyectar');

    await page.getByTestId('agregado-save-btn').click();
    await expect(page.getByTestId('agregado-editor-page')).toHaveCount(0);

    // Lectura agrupada por nivel con vocabulario de taller (la lista ya está
    // en pantalla tras cerrar el editor — sin reload: el goto a mitad de
    // sesión re-disesiona el SPA).
    await page.getByTestId(`agregado-card-${AGR_CODE}`).click();
    await expect(page.getByTestId('agregado-detail-hw-group-cajon')).toContainText('Del agregado (4)');
    await expect(page.getByTestId('agregado-detail-hardware-members')).toContainText('borde izq. +10');
    await expect(page.getByTestId('agregado-detail-hardware-members')).toContainText('borde der. -10');
    // El conteo del chrome incluye a los miembros del cajón (antes invisibles).
    await expect(page.getByText('0 piezas · 4 herrajes')).toBeVisible();
  });

  test('mixto: por cantidad convive con del agregado sin doble conteo', async ({ page }) => {
    test.setTimeout(120_000);
    await loginOwner(page);

    await page.goto('/add-ons');
    await page.getByTestId(`agregado-card-${AGR_CODE}`).click();
    await page.getByTestId('agregado-detail-edit').click();
    await expect(page.getByTestId('agregado-editor-page')).toBeVisible();
    await page.getByRole('tab', { name: 'Herrajes' }).click();

    // Nivel «Solo cantidad»: línea sin posición, herraje elegido en picker.
    await page.getByTestId('agregado-add-hardware').click();
    await page.getByTestId('agregado-hw-chooser-cantidad').click();
    await pickHardware(page, 'agregado-hw-0-select');
    await page.getByTestId('agregado-hw-0-qty').fill('8');

    // Los 4 miembros del cajón siguen ahí — un hogar, sin duplicación.
    await expect(page.getByTestId('agregado-cajon-hardware-member-3')).toBeVisible();
    await expect(page.getByTestId('agregado-editor-tab-hardware')).toContainText('1 + 4 pos.');

    await page.getByTestId('agregado-save-btn').click();
    await expect(page.getByTestId('agregado-editor-page')).toHaveCount(0);

    // El editor se abrió desde el detalle: cierra de vuelta al detalle.
    await expect(page.getByText('0 piezas · 5 herrajes')).toBeVisible();
    await expect(page.getByTestId('agregado-detail-hw-group-cajon')).toContainText('Del agregado (4)');
    await expect(page.getByTestId('agregado-detail-bulk-hw-0')).toBeVisible();
    await expect(page.getByTestId('agregado-detail-hardware')).toContainText('× 8');
  });
});
