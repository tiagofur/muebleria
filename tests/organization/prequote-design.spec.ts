import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

// Catalog-only prerequisite: the gate's generic module references a required
// ZOCLO choice. Keep the quote/customer/lines/Design path exclusively in UI.
async function preparePricedCatalogFixture(): Promise<void> {
  const apiBase = required('ORGANIZATION_API_BASE');
  const owner = await new GraneteApiClient(apiBase).login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => owner.token });
  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((module) => module.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  const structureId = '83100000-0000-4000-8000-000000000001';
  const hardwareId = '83100000-0000-4000-8000-000000000002';
  const dims = { width: 600, height: 720, depth: template.externalDims?.depth || 590 };
  await repository.saveCatalog({
    ...catalog,
    structures: [...(catalog.structures ?? []), { id: structureId, code: 'PREQUOTE-STRUCT', name: 'Prequote structure', externalDims: dims, components: [], active: true }],
    hardware: [...catalog.hardware, { id: hardwareId, code: 'PREQUOTE-HW', name: 'Prequote hardware', unit: 'piece', costPerUnit: 10, active: true }],
    modules: [{ ...template, id: GATE_MODULE_A_ID, structureId, baseMode: 'none', components: [], hardwareLines: [{ id: 'prequote-hardware-line', hardwareId, quantity: 1, optionRole: '' }], externalDims: dims }],
  });
}

async function loginOwner(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await tour.isVisible()) await tour.getByRole('button', { name: 'Omitir' }).click();
}

async function createDraftProjectViaUI(page: Page, name: string) {
  await page.goto('/quotes');
  await page.getByRole('button', { name: 'Nueva cotización' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Nueva cotización' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Nombre').fill(name);
  await modal.getByLabel('Nuevo cliente').check();
  await modal.getByRole('textbox', { name: 'Cliente', exact: true }).fill(`Cliente ${name}`);
  const response = page.waitForResponse((r) =>
    r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/api/projects'));
  await modal.getByRole('button', { name: 'Guardar' }).click();
  const created = await response;
  expect(created.status()).toBe(201);
  const project = await created.json() as { id: string; organization_id: string };
  expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(project.organization_id).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByTestId(`project-card-${project.id}`).click();
  return project;
}

async function addDraftLineViaUI(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Agregar mueble' }).click();
  const modal = page.getByRole('dialog', { name: 'Agregar mueble' });
  await modal.getByLabel('Mueble').click();
  await modal.getByRole('option', { name: /GATE-A/ }).click();
  await modal.getByLabel('Cantidad').fill('1');
  await modal.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(modal).not.toBeVisible();
}

async function appRoleRead(projectId: string, organizationId: string) {
  const client = new Client({ connectionString: required('DATABASE_URL') });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(
      `SELECT set_config('app.organization_id', $1, true),
              set_config('app.authorized_organization_ids', $1, true),
              set_config('row_security', 'on', true)`, [organizationId],
    );
    const project = await client.query<{ snapshot: string }>(
      'SELECT to_jsonb(p)::text AS snapshot FROM projects p WHERE id=$1', [projectId],
    );
    const lines = await client.query<{ id: string; quantity: number; module_id: string; snapshot: string }>(
      'SELECT id::text, quantity, module_id::text, to_jsonb(pi)::text AS snapshot FROM project_items pi WHERE project_id=$1 ORDER BY id', [projectId],
    );
    const units = await client.query<{ id: string; lifecycle_status: string }>(
      'SELECT id::text, lifecycle_status FROM furniture_instances WHERE project_id=$1 ORDER BY id', [projectId],
    );
    const links = await client.query<{ quote_line_id: string; furniture_instance_id: string }>(
      'SELECT quote_line_id::text, furniture_instance_id::text FROM quote_line_furniture_instances WHERE project_id=$1 ORDER BY quote_line_id', [projectId],
    );
    const quotes = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM quote_revisions WHERE project_id=$1', [projectId],
    );
    const working = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM design_working_items i
       JOIN designs d ON d.id=i.design_id WHERE d.project_id=$1`, [projectId],
    );
    return { project: project.rows[0]?.snapshot, lines: lines.rows, units: units.rows, links: links.rows, quotes: Number(quotes.rows[0]?.count), modeled: Number(working.rows[0]?.count) };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

test.beforeAll(preparePricedCatalogFixture);

test('#831 React-first creates draft units before Q1 through normal browser actions', async ({ page }) => {
  test.setTimeout(150_000);
  await loginOwner(page);
  const project = await createDraftProjectViaUI(page, 'Prequote UI E2E');
  await addDraftLineViaUI(page);
  await addDraftLineViaUI(page);

  const before = await appRoleRead(project.id, project.organization_id);
  expect(before.lines).toHaveLength(2);
  expect(before.lines.map((line) => line.quantity)).toEqual([1, 1]);
  expect(before.units).toHaveLength(0);
  expect(before.quotes).toBe(0);

  await page.goto(`/quotes/${project.id}/disenos`);
  await expect(page.getByTestId('project-designs-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Crear primer diseño' }).click();
  await page.getByLabel(/Nombre de la alternativa/i).fill('Diseño prequote UI');
  const designResponse = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `/api/projects/${project.id}/designs`);
  await page.getByTestId('submit-create-design').click();
  const createdDesign = await designResponse;
  expect(createdDesign.status()).toBe(201);
  const design = await createdDesign.json() as { id: string; project_id: string };
  expect(design.project_id).toBe(project.id);
  await expect(page.getByRole('tab', { name: /Diseño prequote UI/ })).toBeVisible();
  console.log(`[prequote-ui] POST designs 201 project=${project.id} design=${design.id}`);

  const after = await appRoleRead(project.id, project.organization_id);
  expect(after.project).toBe(before.project);
  expect(after.lines).toEqual(before.lines);
  expect(after.units).toHaveLength(2);
  expect(after.units.every((unit) => unit.lifecycle_status === 'active')).toBe(true);
  expect(new Set(after.units.map((unit) => unit.id)).size).toBe(2);
  expect(after.links).toHaveLength(2);
  expect(new Set(after.links.map((link) => link.quote_line_id)).size).toBe(2);
  expect(after.quotes).toBe(0);
  expect(after.modeled).toBe(0);

  const designsReadback = page.waitForResponse((r) => r.request().method() === 'GET' &&
    new URL(r.url()).pathname === `/api/projects/${project.id}/designs`);
  await page.goto(`/quotes/${project.id}/disenos`);
  const getDesigns = await designsReadback;
  expect(getDesigns.status()).toBe(200);
  expect((await getDesigns.json() as Array<{ id: string }>).some((item) => item.id === design.id)).toBe(true);
  console.log(`[prequote-ui] GET designs 200 project=${project.id} design=${design.id}`);

  const workspaceResponse = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `/api/projects/${project.id}/furniture-workspace` &&
    (r.request().postDataJSON() as { designId?: string }).designId === design.id);
  await page.goto(`/quotes/${project.id}/muebles`);
  const workspace = await workspaceResponse;
  expect(workspace.status()).toBe(200);
  const workspaceBody = await workspace.json() as { summary: { activeUnits: number; pending: number; placed: number } };
  expect(workspaceBody.summary).toMatchObject({ activeUnits: 2, pending: 2, placed: 0 });
  await expect(page.getByTestId('pf-summary-active')).toContainText('2');
  await expect(page.getByTestId('pf-summary-pending')).toContainText('2');
  await expect(page.getByTestId('pf-summary-placed')).toContainText('0');
  await page.reload();
  for (const unit of after.units) await expect(page.getByTestId(`pf-row-${unit.id}`)).toBeVisible();
  expect((await appRoleRead(project.id, project.organization_id)).units).toEqual(after.units);

  await page.goto(`/quotes/${project.id}/reconciliacion`);
  await expect(page.getByTestId('create-initial-quote-btn')).toBeVisible();
  const q1Response = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname === `/api/projects/${project.id}/quote-revisions`);
  await page.getByTestId('create-initial-quote-btn').click();
  const q1 = await q1Response;
  if (q1.status() !== 201) {
    const error = await q1.json() as { code?: string; message?: string; details?: { reason?: string } };
    throw new Error(`Q1 status=${q1.status()} code=${error.code ?? 'missing'} reason=${error.details?.reason ?? 'missing'}`);
  }
  const withQ1 = await appRoleRead(project.id, project.organization_id);
  expect(withQ1.quotes).toBe(1);
  expect(withQ1.units).toEqual(after.units);
  expect(withQ1.links).toEqual(after.links);
  expect(withQ1.lines).toEqual(before.lines);
  expect(withQ1.project).toBe(before.project);
});

test('#831 existing Design handoff recovers a lost preparation response without duplicate units', async ({ page }) => {
  test.setTimeout(150_000);
  await loginOwner(page);
  const project = await createDraftProjectViaUI(page, 'Prequote handoff UI E2E');
  await page.goto(`/quotes/${project.id}/disenos`);
  await page.getByRole('button', { name: 'Crear primer diseño' }).click();
  await page.getByTestId('submit-create-design').click();
  await expect(page.getByTestId('open-in-sketchup-btn')).toBeVisible();

  await page.goto('/quotes');
  await page.getByTestId(`project-card-${project.id}`).click();
  await addDraftLineViaUI(page);
  await addDraftLineViaUI(page);
  const before = await appRoleRead(project.id, project.organization_id);
  expect(before.lines).toHaveLength(2);
  expect(before.units).toHaveLength(0);
  expect(before.quotes).toBe(0);

  await page.goto(`/quotes/${project.id}/disenos`);
  const endpoint = `**/api/projects/${project.id}/designs/*/draft-units:prepare`;
  let serverResponseStatus = 0;
  await page.route(endpoint, async (route) => {
    const response = await route.fetch();
    serverResponseStatus = response.status();
    await route.abort('failed'); // The server committed, but Chromium lost the response.
  });
  await page.getByTestId('open-in-sketchup-btn').click();
  await expect(page.getByTestId('prepare-draft-units-error')).toBeVisible();
  expect(serverResponseStatus).toBe(200);
  await expect(page.getByTestId('sketchup-pairing-modal')).toHaveCount(0);
  const afterLostResponse = await appRoleRead(project.id, project.organization_id);
  expect(afterLostResponse.units).toHaveLength(2);
  expect(afterLostResponse.links).toHaveLength(2);
  expect(afterLostResponse.project).toBe(before.project);
  expect(afterLostResponse.lines).toEqual(before.lines);
  expect(afterLostResponse.quotes).toBe(0);

  await page.unroute(endpoint);
  const retryResponse = page.waitForResponse((r) => r.request().method() === 'POST' &&
    new URL(r.url()).pathname.endsWith('/draft-units:prepare'));
  await page.getByTestId('open-in-sketchup-btn').click();
  expect((await retryResponse).status()).toBe(200);
  await expect(page.getByTestId('sketchup-pairing-modal')).toBeVisible();
  console.log(`[prequote-ui] POST draft-units:prepare 200 after lost response project=${project.id}`);
  await page.goto(`/quotes/${project.id}/muebles`);
  await expect(page.getByTestId('pf-summary-pending')).toContainText('2');
  await page.reload();
  for (const unit of afterLostResponse.units) await expect(page.getByTestId(`pf-row-${unit.id}`)).toBeVisible();
  const afterRetry = await appRoleRead(project.id, project.organization_id);
  expect(afterRetry.units).toEqual(afterLostResponse.units);
  expect(afterRetry.links).toEqual(afterLostResponse.links);
  expect(afterRetry.modeled).toBe(0);
  expect(afterRetry.quotes).toBe(0);
});
