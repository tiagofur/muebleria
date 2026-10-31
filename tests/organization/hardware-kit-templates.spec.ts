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

test.describe.serial('Herrajes — plantillas del taller editables (#1422 slice 2)', () => {
  test('editor: alta de plantilla del taller → el asistente la consume y el readback coincide', async ({ page }) => {
    test.setTimeout(180_000);
    const token = await loginOwner(page);
    const run = Date.now().toString(36);
    const templateCode = `AUT-PLANT-${run}`;
    const kitCode = `AUT-LEV-${run}`;

    await page.goto('/hardware');
    await page.getByTestId('hardware-kit-wizard-open').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('hardware-kit-wizard-open').click();
    await page.getByTestId('hardware-kit-wizard-manage-templates').click();

    await page.getByTestId('kit-template-editor-code').fill(templateCode);
    await page.getByTestId('kit-template-editor-label').fill('Levantadza del taller');
    await page.getByTestId('kit-template-editor-agregado').fill('Frente');
    await page.getByTestId('kit-template-editor-motion').selectOption('none');
    await page.getByTestId('kit-template-slot-key-0').fill('lift_arm');
    await page.getByTestId('kit-template-slot-label-0').fill('Brazo levantadza');
    await page.getByTestId('kit-template-slot-suffix-0').fill('-BRAZO');
    await page.getByTestId('kit-template-slot-membership-0').fill('body');
    await page.getByTestId('kit-template-slot-add').click();
    await page.getByTestId('kit-template-slot-key-1').fill('lift_spring');
    await page.getByTestId('kit-template-slot-label-1').fill('Resorte');
    await page.getByTestId('kit-template-slot-suffix-1').fill('-RESORTE');
    await page.getByTestId('kit-template-slot-membership-1').fill('actor:door');
    await page.getByTestId('kit-template-slot-anchor-1').selectOption('center');
    await page.getByTestId('kit-template-slot-offset-1').fill('24');
    await page.getByTestId('kit-template-editor-save').click();
    await expect(page.getByTestId('kit-template-editor')).not.toBeVisible({ timeout: 15_000 });

    // Readback por API: la plantilla quedó persistida con sus slots.
    const tplRes = await api(token, 'GET', '/catalog/kit-templates');
    expect(tplRes.status).toBe(200);
    const templates = tplRes.body as readonly Json[];
    const saved = templates.find((t) => t.code === templateCode);
    expect(saved, 'plantilla persistida').toBeTruthy();
    const savedSlots = (saved!.slots ?? []) as readonly Json[];
    expect(savedSlots.map((sl) => sl.slot)).toEqual(['lift_arm', 'lift_spring']);
    expect(savedSlots[1]).toMatchObject({ membership: 'actor:door', anchorXRef: 'center', defaultOffsetMm: 24 });

    // El asistente ofrece la plantilla del taller y arma desde ella.
    await page.getByTestId('hardware-kit-wizard-open').click();
    const select = page.getByTestId('hardware-kit-wizard-template-select');
    await select.selectOption({ label: 'Levantadza del taller' });
    await page.getByTestId('hardware-kit-wizard-code').fill(kitCode);
    await page.getByTestId('hardware-kit-wizard-name').fill('Levantadza 900');
    await page.getByTestId('hardware-kit-wizard-price').fill('150');
    const preview = page.getByTestId('hardware-kit-wizard-preview');
    await expect(preview).toContainText(`${kitCode}-BRAZO`);
    await expect(preview).toContainText(`${kitCode}-RESORTE`);
    await page.getByTestId('hardware-kit-wizard-submit').click();
    await expect(page.getByTestId('hardware-kit-wizard-result')).toBeVisible({ timeout: 30_000 });

    // Readback del juego: 2 partes + agregado «Frente» sin motion.
    const hwRes = await api(token, 'GET', '/catalog/hardware');
    const rows = hwRes.body as readonly Json[];
    expect(rows.find((h) => h.code === `${kitCode}-BRAZO`)).toBeTruthy();
    expect(rows.find((h) => h.code === `${kitCode}-RESORTE`)).toBeTruthy();
    const agrRes = await api(token, 'GET', '/catalog/agregados');
    const agregados = agrRes.body as readonly Json[];
    const frente = agregados.find((a) => a.code === `${kitCode}-FRENTE`);
    expect(frente, 'agregado frente creado').toBeTruthy();
    const members = (frente!.rigid_members ?? []) as readonly Json[];
    expect(members.map((m) => m.memberId)).toEqual(['lift_arm', 'lift_spring']);
    expect(members[0]).toMatchObject({ actorMembership: 'body' });
    expect(members[1]).toMatchObject({ actorMembership: 'actor:door' });
  });

  test('editor: validación inválida no persiste (membership inventada)', async ({ page }) => {
    test.setTimeout(120_000);
    const token = await loginOwner(page);
    const run = Date.now().toString(36);

    await page.goto('/hardware');
    await page.getByTestId('hardware-kit-wizard-open').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('hardware-kit-wizard-open').click();
    await page.getByTestId('hardware-kit-wizard-manage-templates').click();
    await page.getByTestId('kit-template-editor-code').fill(`AUT-BAD-${run}`);
    await page.getByTestId('kit-template-editor-label').fill('Plantilla inválida');
    await page.getByTestId('kit-template-editor-agregado').fill('Puerta');
    await page.getByTestId('kit-template-slot-key-0').fill('a');
    await page.getByTestId('kit-template-slot-label-0').fill('A');
    await page.getByTestId('kit-template-slot-membership-0').fill('puerta');
    await page.getByTestId('kit-template-editor-save').click();
    await expect(page.getByTestId('kit-template-editor-error')).toBeVisible();

    // La plantilla inválida NO está en el catálogo: la validación gemela la
    // corta en el cliente y el servidor la rechazaría igual (422).
    const tplRes = await api(token, 'GET', '/catalog/kit-templates');
    const templates = tplRes.body as readonly Json[];
    expect(templates.find((t) => t.code === `AUT-BAD-${run}`)).toBeFalsy();
  });
});
