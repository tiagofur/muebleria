/*
 * #1412 — browser proof de la AUTORÍA de receta de agregado: desde el editor
 * (pestaña Receta) el owner añade miembros rígidos anclados min/max con kit y
 * guarda; el PUT crea una revisión versionada con readback exacto y la receta
 * persiste tras F5. Negativos: receta inválida se bloquea en el cliente con la
 * pestaña Receta a la vista (sin llamada al servidor) y una receta inválida
 * que llegue al servidor recibe 422 AGREGADO_RECIPE_INVALID sin persistir.
 *
 * Fixtures autocontenidas por API (la DB del gate es descartable): el POST
 * crea la fila SIN receta y la receta entra por la autoría en el browser —
 * exactamente el camino del owner, sin seeds de receta.
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const password = required('ORGANIZATION_GATE_PASSWORD');

const CORREDERA = '09690000-0000-4000-8000-000000000c05';
const KIT = '09690000-0000-4000-8000-000000000c06';
const AGREGADO_ID = '09690000-0000-4000-8000-000000001412';
const AGREGADO_CODE = 'AUT-CAJON';
const AGREGADO_NAME = 'Cajón autoría receta';
const KIT_CODE = 'AUT-KIT-50';
const CORREDERA_CODE = 'AUT-CORR-50';

type Json = Record<string, unknown>;

interface AgregadoWire {
  readonly id: string;
  readonly version: number;
  readonly commercial_kit_hardware_id?: string;
  readonly rigid_members?: readonly {
    readonly memberId: string;
    readonly role: string;
    readonly source: Json;
    readonly placement: Json;
    readonly bomRole: string;
    readonly actorMembership?: string;
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

async function seedFixtures(token: string): Promise<void> {
  const hardware: readonly [string, string, string][] = [
    [CORREDERA, CORREDERA_CODE, 'Corredera telescópica 500 (gate)'],
    [KIT, KIT_CODE, 'Kit cajón 500 (gate)'],
  ];
  for (const [id, code, name] of hardware) {
    const res = await api(token, 'POST', '/catalog/hardware', { id, code, name, unit: 'set', cost_per_unit: 90 });
    expect(res.status, `create hardware ${code}: ${JSON.stringify(res.body)}`).toBe(201);
  }
  // Fila SIN receta: la receta la autora el browser (camino del owner).
  const created = await api(token, 'POST', '/catalog/agregados', {
    id: AGREGADO_ID,
    code: AGREGADO_CODE,
    name: AGREGADO_NAME,
    description: 'Cajón para autoría de receta (#1412 browser gate)',
    width_mm: 400,
    height_mm: 150,
    depth_mm: 500,
    active: true,
  });
  expect(created.status, `create agregado: ${JSON.stringify(created.body)}`).toBe(201);
}

/** Login real en Chromium; devuelve el bearer de la sesión del browser. */
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

const recipeCard = (page: Page) => page.getByTestId('agregado-detail-recipe-card');
const authoring = (page: Page, part: string) => page.getByTestId(`agregado-tab-recipe-authoring-${part}`);

async function openEditorOnRecipeTab(page: Page): Promise<void> {
  await page.goto(`/add-ons/${AGREGADO_ID}`);
  await expect(recipeCard(page)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('agregado-detail-edit').click();
  await expect(page.getByTestId('agregado-editor-page')).toBeVisible();
  await page.getByRole('tab', { name: 'Receta' }).click();
  await expect(authoring(page, 'add-member')).toBeVisible();
}

test.describe.serial('Agregado — autoría de receta en browser real (#1412)', () => {
  test.beforeAll(async () => {
    const owner = await new GraneteApiClient(apiBase).login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password,
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    await seedFixtures(owner.token);
  });

  test('feliz: 2 miembros anclados min/max + kit → guardar → revisión con readback exacto → F5 persiste', async ({ page }) => {
    test.setTimeout(120_000);
    const token = await loginOwner(page);
    const before = await readAgregado(token);
    expect(before.rigid_members ?? []).toEqual([]);

    await openEditorOnRecipeTab(page);

    // Kit comercial.
    await authoring(page, 'kit').selectOption({ label: `${KIT_CODE} — Kit cajón 500 (gate)` });

    // Miembro 1: guía izquierda anclada al mínimo (defaults + nombre).
    await authoring(page, 'add-member').click();
    await authoring(page, 'member-0-id').fill('guia-izq');

    // Miembro 2: guía derecha anclada al MÁXIMO — el ancho la separa sola.
    await authoring(page, 'add-member').click();
    await authoring(page, 'member-1-id').fill('guia-der');
    await authoring(page, 'member-1-anchor-x-ref').selectOption({ label: 'Máximo' });

    // Esperar el PUT explícitamente: el readback de version exige que el
    // guardado haya COMMITTEADO (una carrera del optimista vs el servidor
    // daría version sin incrementar aunque la receta esté guardada).
    const putDone = page
      .waitForResponse(
        (res) => res.request().method() === 'PUT' && res.url().includes(`/catalog/agregados/${AGREGADO_ID}`),
        { timeout: 20_000 },
      )
      .then((res) => res.status())
      .catch(() => null);
    await page.getByTestId('agregado-save-btn').click();
    expect(await putDone, 'PUT del guardado').toBe(200);
    await expect(page.getByTestId('agregado-editor-page')).toBeHidden();

    // La tarjeta de detalle refleja la receta guardada.
    await expect(recipeCard(page)).toContainText('2 miembros', { timeout: 20_000 });
    await expect(recipeCard(page)).toContainText(KIT_CODE);

    // Readback exacto por API: anclajes min/max y revisión creada.
    const read = await readAgregado(token);
    expect(read.version).toBe(before.version + 1);
    expect(read.commercial_kit_hardware_id).toBe(KIT);
    expect(read.rigid_members).toHaveLength(2);
    const [izq, der] = read.rigid_members ?? [];
    expect(izq?.memberId).toBe('guia-izq');
    expect(izq?.placement).toEqual({
      x: { ref: 'min', offsetMm: 0 },
      y: { ref: 'min', offsetMm: 0 },
      z: { ref: 'min', offsetMm: 0 },
    });
    expect(der?.memberId).toBe('guia-der');
    expect((der?.placement as Json).x).toEqual({ ref: 'max', offsetMm: 0 });
    expect(izq?.bomRole).toBe('included_in_kit');

    // F5: la receta persiste (revisión hidratada, no estado de pantalla).
    await page.reload();
    await expect(recipeCard(page)).toContainText('2 miembros', { timeout: 20_000 });
  });

  test('receta inválida en el editor: bloqueo con pestaña Receta y sin llamada al servidor', async ({ page }) => {
    test.setTimeout(120_000);
    await loginOwner(page);
    await openEditorOnRecipeTab(page);

    await authoring(page, 'add-member').click();
    await authoring(page, 'member-0-id').fill('');

    let sawPut = false;
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes(`/catalog/agregados/${AGREGADO_ID}`)) sawPut = true;
    });

    await page.getByTestId('agregado-save-btn').click();

    await expect(page.getByTestId('form-error')).toContainText('Receta inválida');
    await expect(page.getByTestId('agregado-editor-page')).toBeVisible();
    expect(sawPut, 'el guardado inválido no debe llegar al servidor').toBe(false);

    // Cancelar con borrador sucio pide confirmación de descarte.
    await page.getByTestId('agregado-editor-cancel').click();
    await page.getByTestId('agregado-editor-discard-confirm').click();
    await expect(page.getByTestId('agregado-editor-page')).toBeHidden();
  });

  test('receta inválida vía API: 422 AGREGADO_RECIPE_INVALID y sin revisión', async () => {
    const owner = await new GraneteApiClient(apiBase).login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password,
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const current = await readAgregado(owner.token);

    const invalid = await api(
      owner.token,
      'PUT',
      `/catalog/agregados/${AGREGADO_ID}`,
      {
        id: AGREGADO_ID,
        code: AGREGADO_CODE,
        name: AGREGADO_NAME,
        width_mm: 400,
        height_mm: 150,
        depth_mm: 500,
        rigid_members: [
          {
            memberId: 'mala',
            role: 'runner_left',
            source: { kind: 'fixed', fixed: { hardwareId: CORREDERA } },
            placement: {
              x: { ref: 'min', offsetMm: 0 },
              y: { ref: 'min', offsetMm: 0 },
              z: { ref: 'min', offsetMm: 0 },
            },
            bomRole: 'included_in_kit',
            actorMembership: 'no-es-actor',
          },
        ],
      },
      { 'If-Match': `"v${current.version}"` },
    );
    expect(invalid.status).toBe(422);
    expect((invalid.body as Json).code).toBe('AGREGADO_RECIPE_INVALID');

    // La receta guardada sigue intacta (la revisión es inmutable y no se tocó).
    const read = await readAgregado(owner.token);
    expect(read.version).toBe(current.version);
    expect(read.rigid_members?.map((m) => m.memberId)).toEqual(['guia-izq', 'guia-der']);
  });
});
