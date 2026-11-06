/*
 * #1546 M4 S2 — browser proof del asistente de sistema: «Nuevo sistema»
 * crea un kit multi-diseño POR ALTURA (M y E), el herraje accesorio del E,
 * el grupo de accesorios vinculado al kit E y UN agregado con variantes de
 * altura SIN miembros de kit fijos (el sync por bahía materializa). Readback
 * exacto por API.
 */
import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const SYS_CODE = 'AUT-SYS-MBOX';

type Json = Record<string, unknown>;

async function api(
  token: string,
  method: string,
  path: string,
  body?: Json,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(required('ORGANIZATION_API_BASE') + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
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
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  expect(browserToken, 'browser session token').toBeTruthy();
  return browserToken ?? '';
}

test.describe.serial('Herrajes — sistema generador (#1546 M4)', () => {
  test('asistente de sistema → kits por altura + accesorio + grupo + agregado con variantes', async ({ page }) => {
    test.setTimeout(180_000);
    const token = await loginOwner(page);

    // Seed: un herraje mínimo por API — el catálogo del org del gate empieza
    // vacío y el toolbar (donde vive «Nuevo sistema») no renderiza en el
    // estado truly-empty (el EmptyState ofrece el kit wizard como acción).
    const seed = await api(token, 'POST', '/catalog/hardware', {
      code: `${SYS_CODE}-SEED`,
      name: 'Seed herraje',
      unit: 'piece',
      cost_per_unit: 1,
    });
    expect([200, 201]).toContain(seed.status);

    await page.goto('/hardware');
    try {
      await page.getByTestId('hardware-system-wizard-open').waitFor({ state: 'visible', timeout: 20_000 });
    } catch {
      // #1519 debug: dump del estado del header para diagnosticar el botón ausente
      const debug = await page.evaluate(`(() => ({
        systemBtn: !!document.querySelector('[data-testid="hardware-system-wizard-open"]'),
        kitBtn: !!document.querySelector('[data-testid="hardware-kit-wizard-open"]'),
        hwCount: document.querySelectorAll('.catalog-table tbody tr, [data-testid*="hardware-kit"]').length,
        bodyClasses: document.body.className,
        url: location.href,
      }))()`);
      console.log('SYSTEM-BUTTON-DEBUG:', JSON.stringify(debug));
      throw new Error(`system-wizard-open no visible: ${JSON.stringify(debug)}`);
    }
    await page.getByTestId('hardware-system-wizard-open').click();
    await page.getByTestId('hardware-system-wizard-code').fill(SYS_CODE);
    await page.getByTestId('hardware-system-wizard-name').fill('Merivobox Sistema QA');
    await page.getByTestId('hardware-system-wizard-price').fill('420');

    // Alturas: M (default) + E (checkbox).
    await page.getByTestId('hardware-system-height-E').check();

    // Accesorio del E: galería.
    await page.getByTestId('hardware-system-accessory-add').click();
    await page.getByTestId('hardware-system-accessory-0-name').fill('Galería Gris Iridium');

    // Preview agrupa: 2 juegos + 1 accesorio + ensamble con variantes M/E.
    const preview = page.getByTestId('hardware-system-wizard-preview');
    await expect(preview).toContainText('2 juego(s)');
    await expect(preview).toContainText(`${SYS_CODE}-M`);
    await expect(preview).toContainText(`${SYS_CODE}-E`);
    await expect(preview).toContainText(`${SYS_CODE}-E-GALERIA`); // el preview muestra el sufijo derivado del nombre
    await expect(preview).toContainText(`${SYS_CODE}-CAJON`);

    await page.getByTestId('hardware-system-wizard-submit').click();
    await expect(page.getByTestId('hardware-system-wizard-result')).toBeVisible({ timeout: 30_000 });

    // ── Readback catálogo: kits por altura (unit set) + filas multi-diseño.
    const hw = await api(token, 'GET', '/catalog/hardware');
    expect(hw.status).toBe(200);
    const rows = hw.body as readonly Json[];
    const kitM = rows.find((h) => h.code === `${SYS_CODE}-M`);
    const kitE = rows.find((h) => h.code === `${SYS_CODE}-E`);
    expect(kitM, 'kit M creado').toBeTruthy();
    expect(kitE, 'kit E creado').toBeTruthy();
    // 4 filas multi-diseño (FIJ/MOV por altura), ninguna legacy -I/-D.
    for (const suffix of ['-M-FIJ', '-M-MOV', '-E-FIJ', '-E-MOV']) {
      const row = rows.find((h) => h.code === `${SYS_CODE}${suffix}`);
      expect(row, `fila ${suffix}`).toBeTruthy();
      expect(row!.kit_hardware_id).toBe(kitM && suffix.startsWith('-M') ? kitM!.id : kitE!.id);
    }
    expect(rows.some((h) => h.code === `${SYS_CODE}-M-FIJ-I`)).toBe(false);

    // Accesorio del E creado (sin SKPs → sin pieces, fail-honesto). El
    // sufijo deriva del nombre completo («GALERIA-GRIS-IRIDIUM»).
    const galeria = rows.find((h) => h.code.startsWith(`${SYS_CODE}-E-GALERIA`));
    if (!galeria) {
      const codes = rows.map((h) => h.code).join(', ');
      throw new Error(`accesorio galería creado — códigos en catálogo: ${codes}`);
    }
    expect(galeria).toBeTruthy();
    expect(galeria!.pieces).toBeUndefined();

    // ── Readback grupos: LATERAL_E vinculado al kit E con la galería como opción.
    const ogRes = await api(token, 'GET', '/catalog/option-groups');
    expect(ogRes.status).toBe(200);
    const groups = ogRes.body as readonly Json[];
    const lateral = groups.find((g) => g.code === `${SYS_CODE}_LATERAL_E`);
    expect(lateral, 'grupo LATERAL_E creado').toBeTruthy();
    expect(lateral!.kind).toBe('hardware');
    expect(lateral!.kit_hardware_id).toBe(kitE!.id);
    expect(lateral!.option_ids).toEqual([galeria!.id]);

    // ── Readback agregado: variantes de altura M/E apuntando a sus kits, SIN miembros fijos.
    const agRes = await api(token, 'GET', '/catalog/agregados');
    expect(agRes.status).toBe(200);
    const agregados = agRes.body as readonly Json[];
    const cajon = agregados.find((a) => a.code === `${SYS_CODE}-CAJON`);
    expect(cajon, 'agregado del sistema creado').toBeTruthy();
    expect(cajon!.commercial_kit_hardware_id).toBe(kitM!.id);
    const variantSets = (cajon!.variant_sets ?? []) as readonly {
      dimension?: string;
      variants?: readonly { nominalDimensionMm?: number; commercialKitHardwareId?: string }[];
    }[];
    const heightSet = variantSets.find((vs) => vs.dimension === 'height');
    expect(heightSet, 'variant set de alturas').toBeTruthy();
    expect(heightSet!.variants!.map((v) => v.commercialKitHardwareId)).toEqual([
      kitM!.id,
      kitE!.id,
    ]);
    expect(heightSet!.variants!.map((v) => v.nominalDimensionMm)).toEqual([108, 209]);
    // Sin miembros de kit fijos: el sync por bahía materializa (#1493).
    expect((cajon!.rigid_members ?? []).length).toBe(0);
  });
});
