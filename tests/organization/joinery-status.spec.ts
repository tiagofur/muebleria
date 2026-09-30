/**
 * #875 joinery live panel browser proof: a REAL browser on the REAL Vite web
 * app resolves the construction state of a REAL design through the Go
 * authoring-resolve endpoint over a disposable PostgreSQL. The catalog
 * declares the floor-side relationship server-side (structureRelationship
 * binding); the web only sends parameter values and renders the response.
 */

import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { putWorkingCopyCurrent, required } from './support/api';

const MODULE_ID = 'b1111111-2222-4333-8444-555555555501';
const STRUCTURE_ID = 'b1111111-2222-4333-8444-555555555502';
const PROJECT_ID = 'b1111111-2222-4333-8444-555555555503';
const QUOTE_LINE_ID = 'b1111111-2222-4333-8444-555555555504';
const CUSTOMER_ID = 'b1111111-2222-4333-8444-555555555505';

const apiBase = required('ORGANIZATION_API_BASE');

interface SeededJoinery {
  readonly projectId: string;
  readonly designAId: string;
  readonly designBId: string;
}

async function upsertCatalog(token: string, pathById: string, pathCollection: string, body: unknown): Promise<void> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Request-ID': crypto.randomUUID(),
  };
  const put = await fetch(`${apiBase}${pathById}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (put.ok) return;
  const putText = await put.text().catch(() => '');
  // #497: a module PUT without If-Match answers 428 once the row exists —
  // learn the current version and retry the write under If-Match (still
  // version-guarded; a mid-seed change answers 412).
  if (put.status === 428 && pathById.startsWith('/catalog/modules/')) {
    const current = await fetch(`${apiBase}${pathById}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-Request-ID': crypto.randomUUID() },
    });
    const etag = current.headers.get('ETag');
    if (current.ok && etag) {
      const retry = await fetch(`${apiBase}${pathById}`, {
        method: 'PUT',
        headers: { ...headers, 'If-Match': etag },
        body: JSON.stringify(body),
      });
      if (retry.ok) return;
      throw new Error(`PUT ${pathById} (If-Match ${etag}): ${retry.status} ${await retry.text().catch(() => '')}`);
    }
  }
  // The legacy Go update path answers an opaque 500 for a missing row; any
  // 404/405/500 falls through to the create endpoint (a real conflict
  // surfaces there as 409).
  if (put.status !== 404 && put.status !== 405 && put.status !== 500) {
    throw new Error(`PUT ${pathById}: ${put.status} ${putText}`);
  }
  const created = await fetch(`${apiBase}${pathCollection}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!created.ok) {
    throw new Error(`POST ${pathCollection}: ${created.status} ${await created.text().catch(() => '')}`);
  }
}

async function putCatalog(token: string, path: string, collection: string, body: unknown): Promise<void> {
  await upsertCatalog(token, path, collection, body);
}

/** Seed the construction-declared cabinet catalog (components → structure → module). */
async function seedJoineryCatalog(token: string): Promise<void> {
  // Catalog columns are UUID-keyed with positive dimension CHECKs; the
  // formulas drive the real layout at resolve time.
  const sideId = 'b1111111-2222-4333-8444-555555555511';
  const sideRId = 'b1111111-2222-4333-8444-555555555512';
  const floorId = 'b1111111-2222-4333-8444-555555555513';
  const board = (extra: Record<string, unknown>) => ({
    length_mm: 684, width_mm: 560, length_formula: '', width_formula: '',
    x_formula: '', y_formula: '', z_formula: '',
    rotate_x: null, rotate_y: null, rotate_z: null,
    default_edges: [], option_roles: [], notes: '', active: true,
    ...extra,
  });
  await putCatalog(token, `/catalog/components/${sideId}`, '/catalog/components', board({
    id: sideId, code: 'JS-LAT', name: 'Lateral JS', placement: 'lateral_izquierdo',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await putCatalog(token, `/catalog/components/${sideRId}`, '/catalog/components', board({
    id: sideRId, code: 'JS-LATD', name: 'Lateral Derecho JS', placement: 'lateral_derecho',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PH - 2*T', width_formula: 'PD', option_roles: ['LATERAL'],
  }));
  await putCatalog(token, `/catalog/components/${floorId}`, '/catalog/components', board({
    id: floorId, code: 'JS-PISO', name: 'Piso JS', placement: 'base',
    geometry_kind: 'rectangular_board', thickness_mm: 18,
    length_formula: 'PW - 2*T', width_formula: 'PD - T', option_roles: ['INTERIOR'],
  }));
  await putCatalog(token, `/catalog/structures/${STRUCTURE_ID}`, '/catalog/structures', {
    id: STRUCTURE_ID, code: 'JS-CUERPO', name: 'Cuerpo JS',
    components: [
      { componentId: sideId, quantity: 1 },
      { componentId: sideRId, quantity: 1 },
      { componentId: floorId, quantity: 1 },
    ],
  });
  // The construction declaration lives in the versioned catalog: the
  // structureRelationship binding's parameter value IS the station count.
  await putCatalog(token, `/catalog/modules/${MODULE_ID}`, '/catalog/modules', {
    id: MODULE_ID, code: 'JS-GAB-600', name: 'Gabinete JS 600',
    base_labor_cost: 0, width_mm: 600, height_mm: 720, depth_mm: 560,
    categoryId: '', structure_id: STRUCTURE_ID, furniture_type: '', base_mode: '',
    base_clearance_mm: null, components: [], agregados: [], presets: [],
    image_url: '', notes: '', hardware_lines: [],
    parameter_definitions: [{
      name: 'baseJointStations', label: 'Fijaciones base por unión', sortOrder: 10,
      type: 'number', defaultValue: 3, required: true, unit: 'count',
      category: 'configuration', integer: true,
      binding: {
        version: 1, kind: 'structureRelationship', componentId: floorId,
        relationship: {
          kind: 'floor-side', sourceRole: 'floor-edge',
          targets: [
            { componentId: sideId, role: 'inside-face', face: 'front' },
            { componentId: sideRId, role: 'inside-face', face: 'back' },
          ],
          station: { startMarginMm: 40, endMarginMm: 40 },
        },
      },
    }],
  });
}

async function seedProjectAndDesigns(): Promise<SeededJoinery> {
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  await seedJoineryCatalog(owner.token);

  // Readback regression guard: the construction declaration must survive
  // persistence exactly (the storage workspace mapper drops
  // parameter_definitions — this seed never round-trips the module through
  // it, and this assertion pins that invariant).
  const readback = await fetch(`${apiBase}/catalog/modules/${MODULE_ID}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  const moduleJson = (await readback.json()) as { parameter_definitions?: { name: string; binding?: { kind?: string } }[] };
  const persisted = moduleJson.parameter_definitions?.find((d) => d.name === 'baseJointStations');
  if (!persisted || persisted.binding?.kind !== 'structureRelationship') {
    throw new Error(`module readback lost the structureRelationship binding: ${JSON.stringify(moduleJson).slice(0, 400)}`);
  }

  // The customer goes in through a direct upsert: repository.saveCatalog
  // round-trips every module through the storage mapper, which does not
  // carry parameter_definitions and would silently strip the construction
  // declaration this proof depends on.
  await upsertCatalog(owner.token, `/customers/${CUSTOMER_ID}`, '/customers', {
    id: CUSTOMER_ID, name: 'Cliente JS', active: true,
  });
  const repository = new APIWorkspaceRepository(apiBase, {
    getAccessToken: () => owner.token,
  });

  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: 'Obra Joinery Gate',
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft' as const,
    createdAt: now,
    updatedAt: now,
    items: [{ id: QUOTE_LINE_ID, moduleId: MODULE_ID, quantity: 2, optionChoices: {} }],
  });

  const materialized = await client.materializeQuoteLineFurniture(owner.token, PROJECT_ID, QUOTE_LINE_ID, 'gate-js-materialize');
  if (materialized.instances.length !== 2) {
    throw new Error(`expected 2 materialized instances, got ${materialized.instances.length}`);
  }

  const designA = await client.createProjectDesign(owner.token, PROJECT_ID, { name: 'Joinery A' }, 'gate-js-design-a');
  const designB = await client.createProjectDesign(owner.token, PROJECT_ID, { name: 'Joinery B' }, 'gate-js-design-b');
  await putWorkingCopyCurrent(client, owner.token, designA.id, {
    items: [
      {
        furniture_instance_id: materialized.instances[0]!.furniture_instance_id,
        furniture_definition_id: MODULE_ID,
        parameters: { baseJointStations: 4 },
        material_choices: {},
      },
    ],
  });
  await putWorkingCopyCurrent(client, owner.token, designB.id, {
    items: [
      {
        furniture_instance_id: materialized.instances[1]!.furniture_instance_id,
        furniture_definition_id: MODULE_ID,
        parameters: { baseJointStations: 3 },
        material_choices: {},
      },
    ],
  });
  return { projectId: PROJECT_ID, designAId: designA.id, designBId: designB.id };
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

test.describe.serial('Joinery live panel (#875) Browser E2E', () => {
  let seeded!: SeededJoinery;

  test.beforeAll(async () => {
    seeded = await seedProjectAndDesigns();
  });

  test('live panel shows the real Go floor-side diagnosis for a design', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);
    await page.goto(`/quotes/${seeded.projectId}/disenos?design=${seeded.designAId}`);

    const panel = page.getByTestId('joinery-status-panel');
    // The resolved backend state: 2 valid contacts, stations from the
    // parameter (4), honest TECHNICAL_PROFILE_REQUIRED blocker, zero ops.
    await expect(panel.getByTestId('joinery-relationships')).toBeVisible({ timeout: 20_000 });
    const text = await panel.getByTestId('joinery-relationships').textContent();
    expect(text).toContain('floor-side');
    expect(text).toContain('válido');
    expect(text).toContain('Estaciones: 4');
    expect(text).toContain('Perfil técnico: requerido');
    expect(text).toContain('Producción bloqueada');
    expect(text).toContain('TECHNICAL_PROFILE_REQUIRED');
  });

  test('switching designs repaints from the new context, never the old one', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);
    await page.goto(`/quotes/${seeded.projectId}/disenos?design=${seeded.designAId}`);
    const panel = page.getByTestId('joinery-status-panel');
    await expect(panel.getByTestId('joinery-relationships')).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByTestId('joinery-relationships')).toContainText('Estaciones: 4');

    // Switch to design B (3 stations): the panel must converge on B's
    // resolved context and never fall back to A's.
    await page.goto(`/quotes/${seeded.projectId}/disenos?design=${seeded.designBId}`);
    await expect(panel.getByTestId('joinery-relationships')).toContainText('Estaciones: 3', { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    await expect(panel.getByTestId('joinery-relationships')).toContainText('Estaciones: 3');
    await expect(panel.getByTestId('joinery-relationships')).not.toContainText('Estaciones: 4');
  });
});
