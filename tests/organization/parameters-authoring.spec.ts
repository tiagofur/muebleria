/**
 * #497 T8 — cross-surface browser proof on the REAL web app over a
 * disposable PostgreSQL: a workshop administrator authors a typed parameter
 * (with a semantic binding) from the React editor, the catalog revision
 * advances, the authored definition is served back, React reads it again
 * after a reload, and another organization never sees it (RLS isolation).
 */

import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const COMPONENT_ID = 'd1111111-3333-4d44-8555-666666666601';
const MODULE_ID = 'd1111111-3333-4d44-8555-666666666602';

const apiBase = required('ORGANIZATION_API_BASE');

async function apiLogin(email: string, slug: string): Promise<string> {
  const response = await new GraneteApiClient(apiBase).login({
    email,
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: slug,
  });
  return response.token;
}

async function apiGet(token: string, path: string): Promise<Response> {
  return fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Request-ID': crypto.randomUUID() },
  });
}

/**
 * Upsert exactly like the web catalog store: PUT by id; fall back to POST
 * when the server answers missing (404/405, or the legacy 500 "no rows").
 */
async function upsert(token: string, pathById: string, pathCollection: string, body: unknown): Promise<void> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Request-ID': crypto.randomUUID(),
  };
  // #1096 (#443 slice 3): guarded catalog writes — learn the server version
  // first (404/405/legacy-500 keeps the POST-create fallback), then PUT
  // under If-Match.
  const learn = await fetch(`${apiBase}${pathById}`, { method: 'GET', headers });
  if (learn.ok) {
    const current = (await learn.json()) as { version?: number };
    const put = await fetch(`${apiBase}${pathById}`, {
      method: 'PUT',
      headers: { ...headers, 'If-Match': `"v${current.version}"` },
      body: JSON.stringify(body),
    });
    if (put.ok) return;
    throw new Error(`PUT ${pathById}: ${put.status} ${await put.text().catch(() => '')}`);
  }
  const learnText = await learn.text().catch(() => '');
  if (learn.status !== 404 && learn.status !== 405 && !(learn.status === 500 && /not found|no rows/i.test(learnText))) {
    throw new Error(`GET ${pathById}: ${learn.status} ${learnText}`);
  }
  const created = await fetch(`${apiBase}${pathCollection}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!created.ok) {
    throw new Error(`POST ${pathCollection}: ${created.status} ${await created.text().catch(() => '')}`);
  }
}

async function seedCatalogModule(token: string): Promise<void> {
  await upsert(token, `/catalog/components/${COMPONENT_ID}`, '/catalog/components', {
    id: COMPONENT_ID,
    code: 'XSURF-BROWSER-EST',
    name: 'Estante browser',
    placement: 'interno',
    geometry_kind: 'rectangular_board',
    length_mm: 590,
    width_mm: 600,
    thickness_mm: 18,
    length_formula: '',
    width_formula: '',
    x_formula: '',
    y_formula: '',
    z_formula: '',
    rotate_x: null,
    rotate_y: null,
    rotate_z: null,
    default_edges: [],
    option_roles: ['INTERIOR'],
    notes: '',
    active: true,
  });
  await upsert(token, `/catalog/modules/${MODULE_ID}`, '/catalog/modules', {
    id: MODULE_ID,
    code: 'MOD-XSURF-BROWSER',
    name: 'Mueble cross-surface browser',
    base_labor_cost: 0,
    width_mm: 600,
    height_mm: 720,
    depth_mm: 590,
    categoryId: '',
    structure_id: '',
    furniture_type: 'inferior',
    base_mode: '',
    presets: [],
    parameter_definitions: [],
    components: [{ componentId: COMPONENT_ID, quantity: 1 }],
    agregados: [],
    image_url: '',
    notes: '',
    hardware_lines: [],
  });
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Furniture parameter authoring (#497) Browser E2E', () => {
  let tokenA!: string;
  let revisionBefore!: string;

  test.beforeAll(async () => {
    tokenA = await apiLogin(required('ORGANIZATION_GATE_EMAIL'), required('ORGANIZATION_GATE_ORG_A_SLUG'));
    await seedCatalogModule(tokenA);
    const definitions = await apiGet(tokenA, '/furniture/definitions');
    expect(definitions.ok).toBeTruthy();
    revisionBefore = (await definitions.json()).revisionId as string;
    expect(revisionBefore).toMatch(/^workshop-/);
  });

  test('React authors a typed parameter with a binding and the catalog advances', async ({ page }) => {
    test.setTimeout(90_000);
    await loginToA(page);
    await page.goto(`/modules/${MODULE_ID}/edit`);

    await page.getByTestId('module-editor-tab-parameters').click();
    await page.getByTestId('parameter-add').click();

    await page.getByTestId('parameter-name').fill('shelfCount');
    await page.getByTestId('parameter-label').fill('Cantidad de estantes');
    await page.getByTestId('parameter-type').selectOption('number');
    await page.getByTestId('parameter-category').selectOption('configuration');
    await page.getByTestId('parameter-min').fill('0');
    await page.getByTestId('parameter-max').fill('8');
    await page.getByTestId('parameter-integer').check();
    await page.getByTestId('parameter-unit').selectOption('count');
    await page.getByTestId('parameter-binding-kind').selectOption('componentQuantity');
    await page.getByTestId('parameter-binding-component').selectOption(COMPONENT_ID);
    await page.getByTestId('parameter-save').click();

    await expect(page.getByTestId('parameter-row')).toContainText('shelfCount');

    await page.getByRole('button', { name: /^Guardar/i }).click();
    // T7: the editor only closes after the save settles — a stale rejection
    // would keep it open, so reaching a closed editor means the server
    // accepted the authored definition.
    await expect(page.getByTestId('module-editor-page')).toHaveCount(0, { timeout: 20_000 });

    // API readback: the authored definition persisted with its binding.
    const modulesResponse = await apiGet(tokenA, '/catalog/modules');
    expect(modulesResponse.ok).toBeTruthy();
    const modules = (await modulesResponse.json()) as ReadonlyArray<{
      id: string;
      parameter_definitions?: ReadonlyArray<{ name: string; binding?: { kind: string; componentId: string } }>;
    }>;
    const authored = modules.find((m) => m.id === MODULE_ID);
    expect(authored?.parameter_definitions?.length).toBe(1);
    expect(authored?.parameter_definitions?.[0]?.name).toBe('shelfCount');
    expect(authored?.parameter_definitions?.[0]?.binding?.kind).toBe('componentQuantity');
    expect(authored?.parameter_definitions?.[0]?.binding?.componentId).toBe(COMPONENT_ID);

    // The published catalog advanced and serves the definition + hash.
    const definitionsResponse = await apiGet(tokenA, '/furniture/definitions');
    const catalog = (await definitionsResponse.json()) as {
      revisionId: string;
      definitions: Record<string, { definitionHash: string; parameters: ReadonlyArray<{ name: string }> }>;
    };
    expect(catalog.revisionId).not.toBe(revisionBefore);
    expect(catalog.definitions[MODULE_ID]?.definitionHash).toMatch(/^sha256-/);
    expect(
      catalog.definitions[MODULE_ID]?.parameters.some((p) => p.name === 'shelfCount'),
    ).toBeTruthy();
  });

  test('React reads the authored definition back after a reload', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);
    await page.goto(`/modules/${MODULE_ID}/edit`);
    await page.getByTestId('module-editor-tab-parameters').click();
    await expect(page.getByTestId('parameter-row')).toContainText('shelfCount');
    await expect(page.getByTestId('parameter-row')).toContainText('cantidad de componente');
  });

  test('tenant isolation: organization B never sees the authored parameters', async () => {
    const tokenB = await apiLogin(
      required('ORGANIZATION_GATE_B_OWNER_EMAIL'),
      required('ORGANIZATION_GATE_ORG_B_SLUG'),
    );
    const modulesResponse = await apiGet(tokenB, '/catalog/modules');
    expect(modulesResponse.ok).toBeTruthy();
    const modules = (await modulesResponse.json()) as ReadonlyArray<{ id: string }>;
    expect(modules.some((m) => m.id === MODULE_ID)).toBeFalsy();

    const definitionsResponse = await apiGet(tokenB, '/furniture/definitions');
    const catalog = (await definitionsResponse.json()) as {
      definitions: Record<string, unknown>;
    };
    expect(catalog.definitions[MODULE_ID]).toBeUndefined();
  });
});
