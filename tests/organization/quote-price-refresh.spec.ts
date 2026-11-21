import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { putWorkingCopyCurrent, required } from './support/api';

/**
 * #1662 — price-only requote, real browser on Go + disposable PostgreSQL (no
 * route interception): after a catalog price change, «Actualizar precios»
 * previews the previous vs current total WITHOUT writing, and the explicit
 * confirm freezes Q2 (draft, price_refresh, base Q1) with the same units and
 * the new prices; Q1 stays byte-identical and the command is audited.
 */
const PROJECT_ID = '16621662-0000-4000-8000-000000000001';
const QUOTE_LINE_ID = '16621662-0000-4000-8000-000000000002';
const CUSTOMER_ID = '16621662-0000-4000-8000-000000000003';
const MODULE_ID = '16621662-0000-4000-8000-000000000004';
const STRUCT_ID = '16621662-0000-4000-8000-000000000005';
const HW_ID = '16621662-0000-4000-8000-000000000006';

let quoteRevisionId = '';
let designId = '';
let designRevisionId = '';

function apiBase(): string {
  return required('ORGANIZATION_API_BASE');
}

async function ownerToken(): Promise<{ client: GraneteApiClient; token: string }> {
  const client = new GraneteApiClient(apiBase());
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return { client, token: owner.token };
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('#1662 re-cotizar por precios', () => {
  test.beforeAll(async () => {
    const { client, token } = await ownerToken();
    const repository = new APIWorkspaceRepository(apiBase(), { getAccessToken: () => token });
    const catalog = await repository.getCatalog();
    const depthMm = catalog.modules[0]?.externalDims?.depth || 590;
    await repository.saveCatalog({
      ...catalog,
      structures: [...(catalog.structures ?? []).filter((s) => s.id !== STRUCT_ID), { id: STRUCT_ID, code: 'PRF-STRUCT', name: 'Cuerpo precios', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
      hardware: [...catalog.hardware.filter((h) => h.id !== HW_ID), { id: HW_ID, code: 'PRF-HW', name: 'Herraje precios', unit: 'piece', costPerUnit: 10, active: true }],
      modules: [
        ...catalog.modules.filter((m) => m.id !== MODULE_ID),
        {
          id: MODULE_ID,
          code: 'PRF-MOD-1',
          name: 'Bajo precios E2E',
          externalDims: { width: 600, height: 720, depth: depthMm },
          structureId: STRUCT_ID,
          components: [],
          hardwareLines: [{ id: 'prf-hardware-line', hardwareId: HW_ID, quantity: 1, optionRole: '' }],
        },
      ],
      customers: [...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID), { id: CUSTOMER_ID, name: 'Cliente precios E2E', active: true }],
    });
    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra precios E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: MODULE_ID, quantity: 1, optionChoices: {} }],
    });
    const mat = await client.materializeQuoteLineFurniture(token, PROJECT_ID, QUOTE_LINE_ID, 'gate-1662-prices-materialize');
    const instanceId = mat.instances[0]!.furniture_instance_id;
    const q1 = await client.createInitialProjectQuoteRevision(token, PROJECT_ID, { notes: 'Precios E2E' }, 'gate-1662-prices-q1-create');
    quoteRevisionId = q1.id;
    // The reconciliation workspace needs a published design revision.
    const design = await client.createProjectDesign(token, PROJECT_ID, { name: 'Diseño precios E2E' }, 'gate-1662-prices-design');
    designId = design.id;
    await putWorkingCopyCurrent(client, token, design.id, {
      items: [
        { furniture_instance_id: instanceId, furniture_definition_id: MODULE_ID, parameters: { widthMm: 600, heightMm: 720, depthMm }, material_choices: {} },
      ],
    });
    const r1 = await client.publishDesignRevision(token, design.id, { source_type: 'manual', base_revision_id: null }, 'gate-1662-prices-r1');
    designRevisionId = r1.id;
    await client.publishProjectQuoteRevision(token, PROJECT_ID, q1.id, 'gate-1662-prices-q1-publish');
  });

  test('actualizar precios: vista previa sin escribir y Q2 con los precios de hoy', async ({ page }) => {
    test.setTimeout(150_000);
    const { client, token } = await ownerToken();
    const before = await client.listProjectQuoteRevisions(token, PROJECT_ID);
    const q1Before = before.find((r) => r.id === quoteRevisionId) as { commercialSnapshot?: { breakdown: { salePrice: number } } };
    const q1Total = q1Before.commercialSnapshot!.breakdown.salePrice;

    // The hardware price goes up in the catalog (real catalog save).
    const repository = new APIWorkspaceRepository(apiBase(), { getAccessToken: () => token });
    const catalog = await repository.getCatalog();
    await repository.saveCatalog({
      ...catalog,
      hardware: catalog.hardware.map((h) => (h.id === HW_ID ? { ...h, costPerUnit: 250 } : h)),
    });

    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}/reconciliacion?qrev=${quoteRevisionId}&design=${designId}&rev=${designRevisionId}`);
    const panel = page.getByTestId('quote-lifecycle-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('quote-price-refresh-btn').click();
    const modal = page.getByTestId('price-refresh-modal');
    await expect(modal.getByTestId('price-refresh-preview')).toBeVisible();
    await expect(modal.getByTestId('price-refresh-delta')).toContainText('+');
    // Preview wrote nothing.
    expect((await client.listProjectQuoteRevisions(token, PROJECT_ID)).length).toBe(before.length);
    await modal.screenshot({ path: 'test-results/1662-price-refresh-preview.png' });

    const command = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().endsWith(`/quote-revisions/${quoteRevisionId}:price-refresh`),
    );
    await modal.getByTestId('confirm-price-refresh-btn').click();
    const response = await command;
    expect(response.status()).toBe(201);
    expect(response.request().headers()['idempotency-key']).toBeTruthy();
    await expect(page.getByText(/creada en borrador con los precios de hoy/)).toBeVisible();

    const after = await client.listProjectQuoteRevisions(token, PROJECT_ID);
    const q2 = after.find((r) => r.revisionNumber === 2) as {
      id: string; status: string; sourceType: string; baseQuoteRevisionId?: string;
      commercialSnapshot?: { breakdown: { salePrice: number }; units: Array<{ furnitureInstanceId: string; quoteLineId: string }> };
    };
    expect(q2).toMatchObject({ status: 'draft', sourceType: 'price_refresh', baseQuoteRevisionId: quoteRevisionId });
    expect(q2.commercialSnapshot!.breakdown.salePrice).toBeGreaterThan(q1Total);
    const q1After = after.find((r) => r.id === quoteRevisionId) as typeof q1Before & { status: string };
    expect(q1After.status).toBe('published');
    expect(q1After.commercialSnapshot!.breakdown.salePrice).toBe(q1Total);

    const pool = new Pool({ connectionString: required('ORGANIZATION_TEST_DATABASE_URL') });
    try {
      const audit = await pool.query(
        `SELECT details->>'source_quote_revision_id' AS source, actor_user_id
           FROM security_audit_events
          WHERE event_type = 'quote_revision_created_price_refresh' AND details->>'quote_revision_id' = $1`,
        [q2.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({ source: quoteRevisionId });
      expect(audit.rows[0].actor_user_id).toBeTruthy();
    } finally {
      await pool.end();
    }
  });
});
