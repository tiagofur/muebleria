/*
 * #1369 — browser proof of «Simular cambio de receta»: simular → diff →
 * confirmar → aplicar atómico con If-Match, sobre el stack real del gate
 * (PostgreSQL desechable + Go + Chromium). Formaliza la verificación en vivo
 * del 2026-10-20 como regresión permanente e incluye los negativos que la
 * issue exige: variante que no cabe (rechazo, nunca clamp), corte de red al
 * aplicar (estado intacto + reintento), 412 stale con dos pestañas reales y
 * diff vacío.
 *
 * Fixtures autocontenidos por API (la DB del gate no tiene QA-VERIF-1369):
 * la receta se persiste con el PUT guardado — el POST sólo crea la fila sin
 * revisión — y vuelve hidratada en el GET (3bb9d271) con las reglas de los
 * tableros intactas tras el round-trip (265cf7bf).
 *
 * Receta: cajón 600×200×530, set `vs-depth` {450, 500, 550} con holgura 20 y
 * `max_fitting` ⇒ el resolver elige 500 (510 máx.). Un tablero con
 * lengthRule = variante − 16 (484) y correderas por SKU hacen visible el
 * impacto de pinear 450 (tablero, variante y herraje de ambos miembros).
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

// La DB del gate es descartable por corrida: UUIDs fijos son idempotentes.
const RUNNER_450 = '09690000-0000-4000-8000-000000000450';
const RUNNER_500 = '09690000-0000-4000-8000-000000000500';
const RUNNER_550 = '09690000-0000-4000-8000-000000000550';
const KIT_A = '09690000-0000-4000-8000-00000000000a';
const KIT_B = '09690000-0000-4000-8000-00000000000b';
const KIT_C = '09690000-0000-4000-8000-00000000000c';
const AGREGADO_ID = '09690000-0000-4000-8000-000000001369';
const COMPONENT_ID = '09690000-0000-4000-8000-0000000000f0';
const VARIANT_SET = 'vs-depth';
const AGREGADO_CODE = 'RCS-CAJON';
const AGREGADO_NAME = 'Cajón receta browser';
const KIT_CODES = { [KIT_A]: 'RCS-KIT-A', [KIT_B]: 'RCS-KIT-B', [KIT_C]: 'RCS-KIT-C' } as const;

type Json = Record<string, unknown>;

interface AgregadoWire {
  readonly id: string;
  readonly version: number;
  readonly commercial_kit_hardware_id?: string;
  readonly rigid_members?: readonly { readonly memberId: string }[];
  readonly variant_sets?: readonly {
    readonly id: string;
    readonly variants: readonly { readonly nominalDimensionMm: number; readonly hardwareId: string }[];
  }[];
  readonly components?: readonly {
    readonly componentId: string;
    readonly overrides?: Json;
  }[];
}

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

async function readAgregado(token: string): Promise<AgregadoWire> {
  const res = await api(token, 'GET', `/catalog/agregados/${AGREGADO_ID}`);
  expect(res.status, `GET agregado: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as AgregadoWire;
}

function recipeBody(kitId: string): Json {
  const anchor = (xRef: 'min' | 'max') => ({
    x: { ref: xRef, offsetMm: 0 },
    y: { ref: 'min', offsetMm: 0 },
    z: { ref: 'min', offsetMm: 0 },
  });
  return {
    id: AGREGADO_ID,
    code: AGREGADO_CODE,
    name: AGREGADO_NAME,
    description: 'Cajón con correderas por variante (#1369 browser gate)',
    notes: '',
    width_mm: 600,
    height_mm: 200,
    depth_mm: 530,
    components: [
      {
        componentId: COMPONENT_ID,
        quantity: 1,
        overrides: {
          widthRule: { source: 'assembly_width', offsetMm: -58 },
          lengthRule: { source: 'selected_variant', variantSetId: VARIANT_SET, offsetMm: -16 },
          placementRule: {
            x: { ref: 'min', offsetMm: 29 },
            y: { ref: 'min', offsetMm: 5 },
            z: { ref: 'min', offsetMm: 15 },
          },
        },
      },
    ],
    hardware_lines: [],
    commercial_kit_hardware_id: kitId,
    rigid_members: [
      {
        memberId: 'runner-left',
        role: 'runner_left',
        source: { kind: 'variant', variant: { variantSetId: VARIANT_SET } },
        placement: anchor('min'),
        bomRole: 'included_in_kit',
      },
      {
        memberId: 'runner-right',
        role: 'runner_right',
        source: { kind: 'variant', variant: { variantSetId: VARIANT_SET } },
        placement: anchor('max'),
        bomRole: 'included_in_kit',
      },
    ],
    variant_sets: [
      {
        id: VARIANT_SET,
        dimension: 'depth',
        variants: [
          { nominalDimensionMm: 450, hardwareId: RUNNER_450 },
          { nominalDimensionMm: 500, hardwareId: RUNNER_500 },
          { nominalDimensionMm: 550, hardwareId: RUNNER_550 },
        ],
      },
    ],
    compatibility_rules: [{ variantSetId: VARIANT_SET, clearanceMm: 20, selectionStrategy: 'max_fitting' }],
    active: true,
  };
}

async function seedFixtures(token: string): Promise<void> {
  const hardware: readonly [string, string, string][] = [
    [RUNNER_450, 'RCS-RUN-450', 'Corredera 450 (gate)'],
    [RUNNER_500, 'RCS-RUN-500', 'Corredera 500 (gate)'],
    [RUNNER_550, 'RCS-RUN-550', 'Corredera 550 (gate)'],
    [KIT_A, KIT_CODES[KIT_A], 'Kit cajón A (gate)'],
    [KIT_B, KIT_CODES[KIT_B], 'Kit cajón B (gate)'],
    [KIT_C, KIT_CODES[KIT_C], 'Kit cajón C (gate)'],
  ];
  for (const [id, code, name] of hardware) {
    const res = await api(token, 'POST', '/catalog/hardware', { id, code, name, unit: 'piece', cost_per_unit: 12 });
    expect(res.status, `create hardware ${code}: ${JSON.stringify(res.body)}`).toBe(201);
  }
  // El POST crea la fila (v1) sin revisión; la receta entra con el PUT
  // guardado (If-Match v1 ⇒ v2 + revisión 1), igual que desde el editor.
  const created = await api(token, 'POST', '/catalog/agregados', recipeBody(KIT_A));
  expect(created.status, `create agregado: ${JSON.stringify(created.body)}`).toBe(201);
  expect((created.body as AgregadoWire).version).toBe(1);
  const saved = await api(token, 'PUT', `/catalog/agregados/${AGREGADO_ID}`, recipeBody(KIT_A), { 'If-Match': '"v1"' });
  expect(saved.status, `save recipe: ${JSON.stringify(saved.body)}`).toBe(200);

  // Readback: el GET hidrata la receta desde la revisión actual.
  const read = await readAgregado(token);
  expect(read.version).toBe(2);
  expect(read.commercial_kit_hardware_id).toBe(KIT_A);
  expect(read.rigid_members?.map((m) => m.memberId)).toEqual(['runner-left', 'runner-right']);
  expect(read.variant_sets?.[0]?.variants.map((v) => v.nominalDimensionMm)).toEqual([450, 500, 550]);
  expect(read.components?.[0]?.overrides?.lengthRule).toEqual({
    source: 'selected_variant', variantSetId: VARIANT_SET, offsetMm: -16,
  });
}

/** Login real en Chromium; devuelve el bearer de la sesión del browser. */
async function loginAs(page: Page, email: string, pickOrganization?: string): Promise<string> {
  let browserToken: string | null = null;
  page.on('request', (req) => {
    const auth = req.headers().authorization;
    if (auth?.startsWith('Bearer ')) browserToken = auth.slice('Bearer '.length);
  });
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  if (pickOrganization) {
    await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(pickOrganization) }).click();
  }
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  if (!browserToken) {
    const authReq = await page.waitForRequest(
      (req) => Boolean(req.headers().authorization?.startsWith('Bearer ')),
      { timeout: 10_000 },
    ).catch(() => null);
    if (authReq) browserToken = authReq.headers().authorization!.slice('Bearer '.length);
  }
  expect(browserToken, 'browser session token').toBeTruthy();
  return browserToken ?? '';
}

const loginOwner = (page: Page) => loginAs(page, required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
const loginOtherPerson = (page: Page) => loginAs(page, required('ORGANIZATION_GATE_EMAIL'), 'Browser Gate A');

const recipeCard = (page: Page) => page.getByTestId('agregado-detail-recipe-card');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Simular cambio de receta' });
const consequence = (page: Page) => dialog(page).locator('.recipe-sim__consequence');
const sim = (page: Page, part: string) => page.getByTestId(`recipe-change-simulation-${part}`);
const diffGroup = (page: Page, title: string) => sim(page, 'diff').locator('details', { hasText: title });

async function openDetail(page: Page): Promise<void> {
  await page.goto(`/add-ons/${AGREGADO_ID}`);
  await expect(recipeCard(page)).toBeVisible({ timeout: 20_000 });
}

async function openModal(page: Page): Promise<void> {
  await page.getByTestId('agregado-detail-simulate').click();
  await expect(dialog(page)).toBeVisible();
  await expect(sim(page, 'subtitle')).toHaveText(`${AGREGADO_CODE} — ${AGREGADO_NAME}`);
  await expect(sim(page, 'primary')).toHaveText('Simular');
}

function putOnAgregado(page: Page): Promise<string | undefined> {
  return page
    .waitForRequest((req) => req.method() === 'PUT' && req.url().endsWith(`/catalog/agregados/${AGREGADO_ID}`))
    .then((req) => req.headers()['if-match']);
}

async function applyAndFinish(page: Page): Promise<void> {
  await expect(sim(page, 'primary')).toHaveText('Confirmar y aplicar');
  await expect(sim(page, 'primary')).toBeEnabled();
  await sim(page, 'primary').click();
  await expect(sim(page, 'applied')).toContainText('Receta actualizada ✓');
  await expect(consequence(page)).toHaveText('La receta quedó guardada en el servidor.');
  await expect(sim(page, 'primary')).toHaveText('Listo');
  await sim(page, 'primary').click();
  await expect(dialog(page)).toBeHidden();
}

test.describe.serial('Agregado — simular cambio de receta en browser real (#1369)', () => {
  test.beforeAll(async () => {
    const owner = await new GraneteApiClient(apiBase).login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password,
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    await seedFixtures(owner.token);
  });

  test('feliz: cambiar kit → 2 cambios → confirmar con If-Match → aplicado → F5 persiste', async ({ page }) => {
    test.setTimeout(120_000);
    const token = await loginOwner(page);
    const before = await readAgregado(token);

    await openDetail(page);
    await expect(recipeCard(page)).toContainText(`2 miembros · 1 set de variantes · Kit: ${KIT_CODES[KIT_A]}`);

    await openModal(page);
    await sim(page, 'kit-select').selectOption(KIT_B);
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 2 cambios');

    // El diff es el del servidor: el kit sale y entra en consumo; miembros y
    // tableros conservan identidad (sin grupo porque nada cambió en ellos).
    const consumo = diffGroup(page, 'Consumo comercial');
    await expect(consumo).toContainText('2 cambios');
    await expect(consumo).toContainText('Añadido');
    await expect(consumo).toContainText('Quitado');
    await expect(consumo).toContainText(KIT_B);
    await expect(consumo).toContainText(KIT_A);
    await expect(diffGroup(page, 'Miembros del agregado')).toHaveCount(0);
    await expect(diffGroup(page, 'Tableros fabricados')).toHaveCount(0);
    await expect(consequence(page)).toContainText('Se cambia la receta de este agregado.');

    // Aplicar = PUT con el If-Match congelado al simular (la versión leída).
    const ifMatch = putOnAgregado(page);
    await applyAndFinish(page);
    expect(await ifMatch).toBe(`"v${before.version}"`);

    // Readback detrás del modal y tras F5: lo guardado es lo confirmado.
    await expect(recipeCard(page)).toContainText(`Kit: ${KIT_CODES[KIT_B]}`);
    await page.reload();
    await expect(recipeCard(page)).toContainText(`Kit: ${KIT_CODES[KIT_B]}`, { timeout: 20_000 });

    const after = await readAgregado(token);
    expect(after.version).toBe(before.version + 1);
    expect(after.commercial_kit_hardware_id).toBe(KIT_B);
    expect(after.rigid_members?.map((m) => m.memberId)).toEqual(['runner-left', 'runner-right']);
    expect(after.variant_sets?.[0]?.variants.map((v) => v.nominalDimensionMm)).toEqual([450, 500, 550]);
    // 265cf7bf: las reglas de los tableros sobreviven el round-trip del apply
    // (sin ellas el candidato resolvía tableros a 0 × 0).
    expect(after.components?.[0]?.overrides).toEqual({
      widthRule: { source: 'assembly_width', offsetMm: -58 },
      lengthRule: { source: 'selected_variant', variantSetId: VARIANT_SET, offsetMm: -16 },
      placementRule: {
        x: { ref: 'min', offsetMm: 29 },
        y: { ref: 'min', offsetMm: 5 },
        z: { ref: 'min', offsetMm: 15 },
      },
    });
  });

  test('diff vacío: simular sin cambios → «Cerrar», nada que aplicar', async ({ page }) => {
    test.setTimeout(120_000);
    const token = await loginOwner(page);
    const before = await readAgregado(token);

    await openDetail(page);
    await openModal(page);
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 0 cambios');
    await expect(consequence(page)).toHaveText('Este cambio no altera miembros, tableros ni consumo.');
    await expect(sim(page, 'diff').locator('details')).toHaveCount(0);
    await expect(sim(page, 'primary')).toHaveText('Cerrar');
    await sim(page, 'primary').click();
    await expect(dialog(page)).toBeHidden();

    const after = await readAgregado(token);
    expect(after.version).toBe(before.version);
  });

  test('variante que no cabe: rechazo explícito sin clamp, confirmar bloqueado, volver a automático', async ({ page }) => {
    test.setTimeout(120_000);
    const token = await loginOwner(page);
    const before = await readAgregado(token);

    await openDetail(page);
    await openModal(page);
    // 550 > 530 − 20: el servidor rechaza la elección (nunca «nearest»); el
    // set estrechado a ese nominal no ofrece alternativa que quepa.
    await sim(page, `variant-${VARIANT_SET}`).selectOption('550');
    await expect(sim(page, 'primary')).toHaveText('Simular');
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 1 cambio');

    const variantes = diffGroup(page, 'Variantes');
    await expect(variantes).toContainText('Sin alternativa válida');
    await expect(variantes).toContainText('Rechazado');
    await expect(variantes).toContainText(VARIANT_SET);
    await expect(variantes).toContainText('sin variante para 530 mm');
    await expect(variantes).toContainText('Ninguna alternativa cabe con estas dimensiones.');
    await expect(variantes.getByRole('radio')).toHaveCount(0);
    await expect(sim(page, 'primary')).toHaveText('Confirmar y aplicar');
    await expect(sim(page, 'primary')).toBeDisabled();

    // Volver a «Automático» invalida el diff rechazado y permite re-simular.
    await sim(page, `variant-${VARIANT_SET}`).selectOption('auto');
    await expect(sim(page, 'diff')).toHaveCount(0);
    await expect(sim(page, 'primary')).toHaveText('Simular');
    await expect(sim(page, 'primary')).toBeEnabled();
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 0 cambios');
    await expect(sim(page, 'primary')).toHaveText('Cerrar');
    await sim(page, 'primary').click();
    await expect(dialog(page)).toBeHidden();

    // Simular nunca escribe: misma versión, mismo kit, set completo.
    const after = await readAgregado(token);
    expect(after.version).toBe(before.version);
    expect(after.commercial_kit_hardware_id).toBe(KIT_B);
    expect(after.variant_sets?.[0]?.variants.map((v) => v.nominalDimensionMm)).toEqual([450, 500, 550]);
  });

  test('red cortada al aplicar: el agregado queda como estaba, el diff sigue y el reintento aplica', async ({ page }) => {
    test.setTimeout(120_000);
    const token = await loginOwner(page);
    const before = await readAgregado(token);
    expect(before.commercial_kit_hardware_id).toBe(KIT_B);

    await openDetail(page);
    await openModal(page);
    await sim(page, 'kit-select').selectOption(KIT_A);
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 2 cambios');

    // El corte cae exactamente sobre el PUT de aplicar: el fetch rechaza
    // como una conexión caída (el resto del tráfico sigue vivo).
    let cuts = 0;
    const isApply = (url: URL) => url.pathname.endsWith(`/catalog/agregados/${AGREGADO_ID}`);
    const cutApply = async (route: import('@playwright/test').Route) => {
      if (route.request().method() === 'PUT') {
        cuts += 1;
        await route.abort('connectionfailed');
        return;
      }
      await route.fallback();
    };
    await page.route(isApply, cutApply);
    await expect(sim(page, 'primary')).toHaveText('Confirmar y aplicar');
    await sim(page, 'primary').click();
    await expect(sim(page, 'banner')).toHaveText('Se cortó la conexión al aplicar. El agregado quedó como estaba.');
    expect(cuts).toBe(1);

    // Estado previo intacto en la UI (diff y decisión siguen en pantalla)…
    await expect(sim(page, 'diff')).toBeVisible();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 2 cambios');
    await expect(sim(page, 'primary')).toHaveText('Confirmar y aplicar');
    await expect(sim(page, 'primary')).toBeEnabled();
    // …y en el servidor (nada parcial).
    const during = await readAgregado(token);
    expect(during.version).toBe(before.version);
    expect(during.commercial_kit_hardware_id).toBe(KIT_B);

    // Vuelve la red: el mismo botón reintenta con el mismo If-Match y aplica.
    await page.unroute(isApply, cutApply);
    const ifMatch = putOnAgregado(page);
    await applyAndFinish(page);
    expect(await ifMatch).toBe(`"v${before.version}"`);
    await expect(recipeCard(page)).toContainText(`Kit: ${KIT_CODES[KIT_A]}`);

    const after = await readAgregado(token);
    expect(after.version).toBe(before.version + 1);
    expect(after.commercial_kit_hardware_id).toBe(KIT_A);
  });

  test('412 stale con dos pestañas: otra persona guarda primero → conflicto sin aplicar → re-simular → aplicar', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const token = await loginOwner(page);
    const before = await readAgregado(token);
    expect(before.commercial_kit_hardware_id).toBe(KIT_A);

    // Pestaña A: simula A → B y se queda revisando el diff (If-Match v_before).
    await openDetail(page);
    await openModal(page);
    await sim(page, 'kit-select').selectOption(KIT_B);
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 2 cambios');

    // Pestaña B (otra persona, otro contexto): aplica A → C mientras tanto.
    const contextB = await browser.newContext();
    try {
      const pageB = await contextB.newPage();
      await loginOtherPerson(pageB);
      await openDetail(pageB);
      await openModal(pageB);
      await sim(pageB, 'kit-select').selectOption(KIT_C);
      await sim(pageB, 'primary').click();
      await expect(sim(pageB, 'live')).toHaveText('Simulación lista: 2 cambios');
      await applyAndFinish(pageB);
      await expect(recipeCard(pageB)).toContainText(`Kit: ${KIT_CODES[KIT_C]}`);
    } finally {
      await contextB.close();
    }
    const afterB = await readAgregado(token);
    expect(afterB.version).toBe(before.version + 1);
    expect(afterB.commercial_kit_hardware_id).toBe(KIT_C);

    // A confirma con el If-Match viejo: 412 tipado ⇒ conflicto, nada aplicado.
    const staleIfMatch = putOnAgregado(page);
    await expect(sim(page, 'primary')).toHaveText('Confirmar y aplicar');
    await sim(page, 'primary').click();
    expect(await staleIfMatch).toBe(`"v${before.version}"`);
    await expect(consequence(page)).toHaveText(
      'Otra persona modificó esta receta mientras la revisabas. No se aplicó ningún cambio.',
    );
    await expect(sim(page, 'live')).toHaveText('El diff mostrado corresponde a la simulación anterior.');
    await expect(sim(page, 'primary')).toHaveText('Volver a simular');

    // El cambio de B sigue intacto y el de A no se coló por detrás.
    const after412 = await readAgregado(token);
    expect(after412.version).toBe(afterB.version);
    expect(after412.commercial_kit_hardware_id).toBe(KIT_C);

    // Re-simular parte de la receta vigente (C) y recién entonces aplica.
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 2 cambios');
    const consumo = diffGroup(page, 'Consumo comercial');
    await expect(consumo).toContainText(KIT_C);
    await expect(consumo).toContainText(KIT_B);
    const freshIfMatch = putOnAgregado(page);
    await applyAndFinish(page);
    expect(await freshIfMatch).toBe(`"v${afterB.version}"`);

    const final = await readAgregado(token);
    expect(final.version).toBe(afterB.version + 1);
    expect(final.commercial_kit_hardware_id).toBe(KIT_B);
  });

  test('pin de variante que cabe: el tablero se redimensiona y lo guardado es el set estrechado', async ({ page }) => {
    test.setTimeout(120_000);
    const token = await loginOwner(page);
    const before = await readAgregado(token);
    expect(before.variant_sets?.[0]?.variants.map((v) => v.nominalDimensionMm)).toEqual([450, 500, 550]);

    await openDetail(page);
    await openModal(page);
    // Automático elige 500; pinear 450 cambia la variante, acorta el fondo y
    // cambia el herraje de ambas correderas (cada nominal es un SKU distinto).
    await sim(page, `variant-${VARIANT_SET}`).selectOption('450');
    await sim(page, 'primary').click();
    await expect(sim(page, 'live')).toHaveText('Simulación lista: 4 cambios');
    const miembros = diffGroup(page, 'Miembros del agregado');
    await expect(miembros).toContainText('2 cambios');
    await expect(miembros).toContainText('runner-left');
    await expect(miembros).toContainText('runner-right');
    await expect(miembros).toContainText('RCS-RUN-500 · Corredera 500 (gate) → RCS-RUN-450 · Corredera 450 (gate)');
    await expect(miembros.getByText('Cambiado')).toHaveCount(2);
    const tableros = diffGroup(page, 'Tableros fabricados');
    await expect(tableros).toContainText('1 cambio');
    await expect(tableros).toContainText('Redimensionado');
    await expect(tableros).toContainText(COMPONENT_ID);
    await expect(tableros).toContainText('542 × 484 → 542 × 434 mm');
    await expect(diffGroup(page, 'Consumo comercial')).toHaveCount(0);

    await applyAndFinish(page);

    // Lo confirmado es lo guardado: el set queda estrechado al nominal
    // elegido (no el set completo que el resolver volvería a decidir).
    const after = await readAgregado(token);
    expect(after.version).toBe(before.version + 1);
    expect(after.commercial_kit_hardware_id).toBe(KIT_B);
    expect(after.variant_sets?.[0]?.variants).toEqual([{ nominalDimensionMm: 450, hardwareId: RUNNER_450 }]);
    expect(after.rigid_members?.map((m) => m.memberId)).toEqual(['runner-left', 'runner-right']);
    await page.reload();
    await expect(recipeCard(page)).toContainText(`2 miembros · 1 set de variantes · Kit: ${KIT_CODES[KIT_B]}`, {
      timeout: 20_000,
    });
  });
});
