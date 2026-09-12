import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #642 / Delivery 3 — exact commercial PDF/XLSX exports, real browser E2E
 * (Chromium + Go + PostgreSQL, no mocks for the commercial authority).
 *
 * Proves the client exports are generated from the EXACT QuoteRevision:
 *   - Q1 freezes 600 mm, Q2 (requote with a real 650 mm design change)
 *     freezes 650 mm — both snapshots stay byte-stable after the obra,
 *     customer and catalog are deliberately mutated;
 *   - the visible authority (Q2 · Aceptada) is what the export buttons act
 *     on, the filename identifies QN, and the downloaded XLSX reproduces the
 *     frozen Q2 identity/lines/totals — never the renamed mutable rows;
 *   - the PDF download identifies the same Q2;
 *   - a legacy snapshot-less revision fails closed in the UI with the
 *     actionable "create a new revision" CTA — never an approximated PDF.
 */

const PROJECT_ID = '77777777-5555-4777-8777-555555555555';
const QUOTE_LINE_ID = '88888888-5555-4888-8888-555555555555';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000055';
const REC_HW = '71000000-0000-4000-8000-000000000071';
const REC_STRUCT = '71000000-0000-4000-8000-000000000072';
const EXPORT_MODULE_ID = '71000000-0000-4000-8000-000000000073';
const LEGACY_MODULE_ID = '71000000-0000-4000-8000-000000000074';
const FROZEN_MODULE_NAME = 'Bajo Export E2E';
const RENAMED_MODULE_NAME = 'Bajo RENOMBRADO actual';
const FROZEN_PROJECT_NAME = 'Cocina Export E2E';
const RENAMED_PROJECT_NAME = 'Cocina RENOMBRADA E2E';
const FROZEN_CUSTOMER_NAME = 'Cliente Export E2E';
const RENAMED_CUSTOMER_NAME = 'Cliente RENOMBRADO E2E';
const EXPECTED_XLSX_NAME = 'Cotizacion-Cocina-Export-E2E-Cliente-Export-E2E-Q2.xlsx';
const EXPECTED_PDF_NAME = 'Cotizacion-Cocina-Export-E2E-Cliente-Export-E2E-Q2-listado.pdf';
const REC_CHOICES = {};

const LEGACY_PROJECT_ID = '77777777-4444-4777-8777-444444444444';
const LEGACY_LINE_ID = '88888888-4444-4888-8888-444444444444';
const LEGACY_CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000044';
const LEGACY_REVISION_ID = '99999999-4444-4888-8888-444444444444';

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

/**
 * Fixture upserts occasionally hit a transient 500 (retryable per contract)
 * when the shared gate backend is serving many specs back to back. Retry a
 * couple of times before letting the fixture failure fail the test.
 */
async function withFixtureRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = aOwner.token;
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });

  const catalog = await repository.getCatalog();
  const template = catalog.modules[0]!;
  const depthMm = template.externalDims?.depth || 590;
  await withFixtureRetry(() => repository.saveCatalog({
    ...catalog,
    structures: [...(catalog.structures ?? []).filter((s) => s.id !== REC_STRUCT), { id: REC_STRUCT, code: 'EXPORT-STRUCT', name: 'Cuerpo', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
    hardware: [...catalog.hardware.filter((h) => h.id !== REC_HW), { id: REC_HW, code: 'EXPORT-HW', name: 'Herraje export', unit: 'piece', costPerUnit: 10, active: true }],
    // The gate fixture module (GATE_MODULE_A_ID) is SHARED by other specs
    // (switch.spec pins its name): this spec only ever mutates its OWN
    // module/structure/hardware/customer/project fixtures. New modules are
    // CLEAN literals — the POST /catalog/modules path rejects spreads of
    // existing modules.
    modules: [
      ...catalog.modules.filter((m) => m.id !== EXPORT_MODULE_ID),
      {
        id: EXPORT_MODULE_ID,
        code: 'EXPORT-MOD-1',
        name: FROZEN_MODULE_NAME,
        externalDims: { width: 600, height: 720, depth: depthMm },
        structureId: REC_STRUCT,
        components: [],
        hardwareLines: [{ id: 'export-hardware-line', hardwareId: REC_HW, quantity: 1, optionRole: '' }],
      },
    ],
    customers: [
      ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: FROZEN_CUSTOMER_NAME, active: true },
    ],
  }));

  const now = new Date().toISOString();
  await withFixtureRetry(() => repository.saveProject({
    id: PROJECT_ID,
    name: FROZEN_PROJECT_NAME,
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft' as const,
    createdAt: now,
    updatedAt: now,
    items: [{ id: QUOTE_LINE_ID, moduleId: EXPORT_MODULE_ID, quantity: 1, optionChoices: REC_CHOICES }],
  }));

  const mat = await client.materializeQuoteLineFurniture(
    token,
    PROJECT_ID,
    QUOTE_LINE_ID,
    'gate-exact-export-materialize',
  );
  const instanceId = mat.instances[0]!.furniture_instance_id;

  // Q1 (600 mm) through the exact commands: draft → published → accepted.
  const q1 = await client.createInitialProjectQuoteRevision(token, PROJECT_ID, {
    notes: 'Export exacto — revisión inicial',
  }, 'gate-exact-export-q1-create');
  await client.publishProjectQuoteRevision(token, PROJECT_ID, q1.id, 'gate-exact-export-q1-publish');
  await client.acceptProjectQuoteRevision(token, PROJECT_ID, q1.id, 'gate-exact-export-q1-accept');

  // Real commercial change 600 → 650 through design provenance (R1), then
  // the Q2 requote that incorporates it.
  const design = await client.createProjectDesign(
    token,
    PROJECT_ID,
    { name: 'Cocina Export Exacto' },
    'gate-exact-export-design',
  );
  await client.updateDesignWorkingCopy(token, design.id, {
    items: [
      { furniture_instance_id: instanceId, furniture_definition_id: EXPORT_MODULE_ID, parameters: { widthMm: 650, heightMm: 720, depthMm }, material_choices: REC_CHOICES },
    ],
  });
  const r1 = await client.publishDesignRevision(
    token,
    design.id,
    { source_type: 'manual', base_revision_id: null },
    'gate-exact-export-r1',
  );
  const requote = await client.requoteProjectQuote(token, PROJECT_ID, {
    baseQuoteRevisionId: q1.id,
    designRevisionId: r1.id,
  }, 'gate-exact-export-requote-q2');
  await client.publishProjectQuoteRevision(token, PROJECT_ID, requote.quoteRevision.id, 'gate-exact-export-q2-publish');
  await client.acceptProjectQuoteRevision(token, PROJECT_ID, requote.quoteRevision.id, 'gate-exact-export-q2-accept');

  // Deliberate post-freeze mutations (#642 §13): obra, cliente y catálogo
  // cambian DESPUÉS de congelar Q2. The exports must keep using the frozen
  // identities.
  const projects = await repository.getProjects();
  const stored = projects.find((p) => p.id === PROJECT_ID);
  if (!stored) throw new Error('fixture project vanished');
  await withFixtureRetry(() => repository.saveProject({ ...stored, name: RENAMED_PROJECT_NAME, status: 'draft' as const }));
  const catalogAfter = await repository.getCatalog();
  await withFixtureRetry(() => repository.saveCatalog({
    ...catalogAfter,
    customers: (catalogAfter.customers ?? []).map((c) =>
      c.id === CUSTOMER_ID ? { ...c, name: RENAMED_CUSTOMER_NAME } : c,
    ),
    // Live catalog mutation: the module's current label no longer matches the
    // frozen commercial truth.
    modules: catalogAfter.modules.map((m) =>
      m.id === EXPORT_MODULE_ID ? { ...m, name: RENAMED_MODULE_NAME } : m,
    ),
  }));

  // Frozen-truth readback after the mutations: Q1 keeps 600 mm and Q2 keeps
  // 650 mm with the original identity — the exact data the exports consume.
  const revisions = await client.listProjectQuoteRevisions(token, PROJECT_ID);
  const q1After = revisions.find((r) => r.revisionNumber === 1);
  const q2After = revisions.find((r) => r.revisionNumber === 2);
  expect(q1After?.status).toBe('superseded');
  expect(q1After?.commercialSnapshot?.project.name).toBe(FROZEN_PROJECT_NAME);
  expect(q1After?.commercialSnapshot?.customer.name).toBe(FROZEN_CUSTOMER_NAME);
  expect(q1After?.items[0]?.parameters.widthMm).toBe(600);
  expect(q2After?.status).toBe('accepted');
  expect(q2After?.commercialSnapshot?.project.name).toBe(FROZEN_PROJECT_NAME);
  expect(q2After?.commercialSnapshot?.customer.name).toBe(FROZEN_CUSTOMER_NAME);
  expect(q2After?.commercialSnapshot?.currency).toBe('MXN');
  expect(q2After?.items[0]?.parameters.widthMm).toBe(650);
});

test('exports XLSX + PDF of the exact Q2 with frozen identity after mutations', async ({ page }) => {
  test.setTimeout(120_000);
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const revisions = await client.listProjectQuoteRevisions(aOwner.token, PROJECT_ID);
  const q2 = revisions.find((r) => r.revisionNumber === 2)!;
  const snapshot = q2.commercialSnapshot!;
  const depthMm = q2.items[0]!.parameters.depthMm as number;

  await loginToA(page);
  await page.goto(`/quotes/${PROJECT_ID}`);
  const detail = page.getByTestId('project-detail');
  await expect(detail.getByTestId('quote-revision-badge')).toContainText('Q2 · Solo lectura', { timeout: 20_000 });

  // The commercial buttons name the exact visible revision.
  await page.getByRole('button', { name: /^Más$/i }).click();
  await expect(page.getByRole('menuitem', { name: /Exportar cotización Q2/ })).toBeVisible();

  // ── XLSX Q2: download, filename and semantic workbook readback ──
  const [xlsxDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Exportar cotización Q2/ }).click(),
  ]);
  expect(xlsxDownload.suggestedFilename()).toBe(EXPECTED_XLSX_NAME);
  const xlsxPath = await xlsxDownload.path();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.getWorksheet('Cotización')!;

  expect(sheet.getCell('A1').value).toBe('Cotización Q2');
  expect(sheet.getCell('B5').value).toBe('Q2');
  expect(sheet.getCell('D5').value).toBe('Aceptada');
  // Frozen identity — NOT the renamed mutable rows.
  expect(sheet.getCell('B3').value).toBe(FROZEN_PROJECT_NAME);
  expect(sheet.getCell('B4').value).toBe(FROZEN_CUSTOMER_NAME);
  expect(sheet.getCell('D4').value).toBe('MXN');
  expect(sheet.getCell('B6').value).toBe('Congelados (revisión Q2)');
  // Exact frozen line: module descriptor + 650 mm dimensions of Q2.
  expect(sheet.getCell('A9').value).toBe(snapshot.units[0]!.moduleCode);
  expect(sheet.getCell('B9').value).toBe(snapshot.units[0]!.moduleName);
  expect(sheet.getCell('C9').value).toBe(1);
  expect(sheet.getCell('D9').value).toBe(`650×720×${depthMm} mm`);
  // Authorized sale amounts: frozen line price + total, from the snapshot.
  let totalCell: ExcelJS.Cell | undefined;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === 'Total (precio de venta)') totalCell = row.getCell(2);
  });
  expect(totalCell?.value).toBe(snapshot.breakdown.salePrice);
  // The mutated present must not leak into the frozen document.
  const cellTexts: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cellTexts.push(String(cell.value ?? ''));
    });
  });
  const sharedText = cellTexts.join('\n');
  for (const mutated of [RENAMED_PROJECT_NAME, RENAMED_CUSTOMER_NAME, 'Bajo RENOMBRADO actual', '600×720']) {
    expect(sharedText).not.toContain(mutated);
  }
  await expect(page.getByText(`✓ ${EXPECTED_XLSX_NAME} descargado`)).toBeVisible({ timeout: 10_000 });

  // ── PDF Q2: same exact revision, filename identifies QN ──
  await page.getByRole('button', { name: /^Más$/i }).click();
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /PDF listado Q2/ }).click(),
  ]);
  expect(pdfDownload.suggestedFilename()).toBe(EXPECTED_PDF_NAME);
  const pdfBytes = Buffer.from(readFileSync(await pdfDownload.path()));
  const pdfDoc = await PDFDocument.load(pdfBytes);
  expect(pdfDoc.getTitle()).toBe(`Cotización Q2 — ${FROZEN_PROJECT_NAME} — ${FROZEN_CUSTOMER_NAME}`);
});

test('legacy snapshot-less revision fails closed with the actionable CTA', async ({ page }) => {
  test.setTimeout(120_000);
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const aOwner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = aOwner.token;
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });

  // A second obra whose only revision is the pre-congelado legacy shape. The
  // row shape predates migration 000130 — no API can produce it, so the gate
  // DSN seeds it (fixture only; the verified flow is pure UI).
  const catalog = await repository.getCatalog();
  const depthMm = catalog.modules[0]?.externalDims?.depth || 590;
  await withFixtureRetry(() => repository.saveCatalog({
    ...catalog,
    modules: [
      ...catalog.modules.filter((m) => m.id !== LEGACY_MODULE_ID),
      {
        id: LEGACY_MODULE_ID,
        code: 'EXPORT-LEG-1',
        name: 'Bajo Legacy Export E2E',
        externalDims: { width: 600, height: 720, depth: depthMm },
        structureId: REC_STRUCT,
        components: [],
        hardwareLines: [],
      },
    ],
    customers: [
      ...(catalog.customers ?? []).filter((c) => c.id !== LEGACY_CUSTOMER_ID),
      { id: LEGACY_CUSTOMER_ID, name: 'Cliente Legacy Export E2E', active: true },
    ],
  }));
  const now = new Date().toISOString();
  await withFixtureRetry(() => repository.saveProject({
    id: LEGACY_PROJECT_ID,
    name: 'Obra Legacy Export E2E',
    customerId: LEGACY_CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft' as const,
    createdAt: now,
    updatedAt: now,
    items: [{ id: LEGACY_LINE_ID, moduleId: LEGACY_MODULE_ID, quantity: 1, optionChoices: {} }],
  }));
  const legacyMat = await client.materializeQuoteLineFurniture(
    token,
    LEGACY_PROJECT_ID,
    LEGACY_LINE_ID,
    'gate-exact-export-legacy-materialize',
  );
  const legacyInstanceId = legacyMat.instances[0]!.furniture_instance_id;

  const pool = new Pool({ connectionString: required('ORGANIZATION_TEST_DATABASE_URL') });
  try {
    await pool.query('BEGIN');
    await pool.query('ALTER TABLE quote_revisions DISABLE TRIGGER protect_quote_revisions_immutable');
    const org = await pool.query<{ organization_id: string }>(
      'SELECT organization_id::text AS organization_id FROM projects WHERE id = $1',
      [LEGACY_PROJECT_ID],
    );
    const organizationId = org.rows[0]!.organization_id;
    await pool.query(
      `INSERT INTO quote_revisions
         (id, organization_id, project_id, revision_number, status, source_type, notes,
          created_at, published_at, accepted_at, commercial_snapshot)
       VALUES ($1, $2, $3, 1, 'accepted', 'manual', 'Presupuesto anterior (pre-congelado)',
               NOW() - INTERVAL '30 days', NOW() - INTERVAL '29 days', NOW() - INTERVAL '28 days', NULL)`,
      [LEGACY_REVISION_ID, organizationId, LEGACY_PROJECT_ID],
    );
    await pool.query(
      `INSERT INTO quote_revision_items
         (quote_revision_id, organization_id, project_id, furniture_instance_id,
          furniture_definition_id, parameters, material_choices, lifecycle_status)
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 'active')`,
      [
        LEGACY_REVISION_ID,
        organizationId,
        LEGACY_PROJECT_ID,
        legacyInstanceId,
        LEGACY_MODULE_ID,
        JSON.stringify({ widthMm: 600, heightMm: 720, depthMm }),
      ],
    );
    await pool.query('ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable');
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined);
    await pool.query('ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable').catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }

  await loginToA(page);
  await page.goto(`/quotes/${LEGACY_PROJECT_ID}`);
  const detail = page.getByTestId('project-detail');
  await expect(detail.getByTestId('quote-legacy-badge')).toContainText('Q1 · Cotización anterior', { timeout: 20_000 });

  // The export button EXISTS (discoverable) and fails closed with the honest
  // CTA — no approximated PDF, no Project fallback, no download.
  await page.getByRole('button', { name: /^Más$/i }).click();
  await page.getByRole('menuitem', { name: /Exportar cotización Q1/ }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('no tiene historial comercial congelado');
  await expect(alert).toContainText('Creá una nueva revisión actualizada');
});
