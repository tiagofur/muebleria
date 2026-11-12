/*
 * #1512 S2b — browser proof del asistente multi-diseño: la plantilla
 * «drawer-hands» crea 2 filas de catálogo (perfiles fijo y móvil, cada uno
 * con hands por lado) en vez de 4 filas legacy, y el agregado lleva un
 * miembro POR MANO apuntando a la fila compartida con `hand` declarado y el
 * par I/D compartiendo hardwareId. Readback exacto por API.
 */
import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const KIT_CODE = 'AUT-HANDS-MBOX';

type Json = Record<string, unknown>;

async function api(
  token: string,
  method: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(required('ORGANIZATION_API_BASE') + path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
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
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  expect(browserToken, 'browser session token').toBeTruthy();
  return browserToken ?? '';
}

test.describe.serial('Herrajes — plantilla drawer-hands (#1512 S2b)', () => {
  test('asistente multi-diseño → 2 filas con hands + 4 miembros con hand compartiendo fila', async ({ page }) => {
    test.setTimeout(150_000);
    const token = await loginOwner(page);

    await page.goto('/hardware');
    await page.getByTestId('hardware-new-typed').waitFor({ state: 'visible', timeout: 20_000 });
    // #1596: el asistente de juego se abre por el picker (Juego → juego simple).
    await page.getByTestId('hardware-new-typed').click();
    await page.getByTestId('hardware-type-pick-kit').click();
    await page.getByTestId('hardware-type-pick-kit-simple').click();
    await page.getByTestId('hardware-kit-wizard-template-select').selectOption('drawer-hands');
    await page.getByTestId('hardware-kit-wizard-code').fill(KIT_CODE);
    await page.getByTestId('hardware-kit-wizard-name').fill('MERIVOBOX M multi-diseño');
    await page.getByTestId('hardware-kit-wizard-price').fill('420');

    // El preview agrupa: 2 piezas (FIJ, MOV), no 4 slots.
    const preview = page.getByTestId('hardware-kit-wizard-preview');
    await expect(preview).toContainText('2 piezas');
    await expect(preview).toContainText(`${KIT_CODE}-FIJ`);
    await expect(preview).toContainText(`${KIT_CODE}-MOV`);
    await expect(preview).not.toContainText(`${KIT_CODE}-FIJ-I`);

    await page.getByTestId('hardware-kit-wizard-submit').click();
    await expect(page.getByTestId('hardware-kit-wizard-result')).toBeVisible({ timeout: 30_000 });

    // Readback catálogo: 2 filas de diseño vinculadas al kit, NINGUNA fila
    // legacy -I/-D. Sin uploads, las manos no fabrican facts (fail-honest).
    const hw = await api(token, 'GET', '/catalog/hardware');
    expect(hw.status).toBe(200);
    const rows = hw.body as readonly Json[];
    const kit = rows.find((h) => h.code === KIT_CODE);
    expect(kit, 'kit creado').toBeTruthy();
    const fij = rows.find((h) => h.code === `${KIT_CODE}-FIJ`);
    const mov = rows.find((h) => h.code === `${KIT_CODE}-MOV`);
    expect(fij?.kit_hardware_id).toBe(kit?.id);
    expect(mov?.kit_hardware_id).toBe(kit?.id);
    expect(rows.some((h) => h.code === `${KIT_CODE}-FIJ-I`)).toBe(false);
    expect(rows.some((h) => h.code === `${KIT_CODE}-MOV-D`)).toBe(false);

    // Readback agregado: un miembro por mano compartiendo la fila, con la
    // membresía #1376 por rol y el vocabulario cerrado de mano.
    const res = await api(token, 'GET', '/catalog/agregados');
    expect(res.status).toBe(200);
    const agregados = res.body as readonly Json[];
    const cajon = agregados.find((a) => a.code === `${KIT_CODE}-CAJON`);
    expect(cajon, 'agregado cajón creado').toBeTruthy();
    expect(cajon!.presentation_motion).toMatchObject({ kind: 'translate' });
    const members = (cajon!.rigid_members ?? []) as readonly Json[];
    expect(members.map((m) => m.memberId)).toEqual([
      'fixed_rail_left',
      'fixed_rail_right',
      'moving_rail_left',
      'moving_rail_right',
    ]);
    const [fijL, fijR, movL, movR] = members as readonly {
      hand?: string;
      actorMembership?: string;
      source?: { fixed?: { hardwareId?: string } };
    }[];
    expect(fijL!.hand).toBe('left');
    expect(fijR!.hand).toBe('right');
    expect(movL!.hand).toBe('left');
    expect(movR!.hand).toBe('right');
    expect(fijL!.actorMembership).toBe('body');
    expect(movL!.actorMembership).toBe('actor:drawer');
    // El par comparte la fila multi-diseño: mismo hardwareId por grupo.
    expect(fijR!.source!.fixed!.hardwareId).toBe(fijL!.source!.fixed!.hardwareId);
    expect(movR!.source!.fixed!.hardwareId).toBe(movL!.source!.fixed!.hardwareId);
    expect(fijL!.source!.fixed!.hardwareId).not.toBe(movL!.source!.fixed!.hardwareId);
  });
});
