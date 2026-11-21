import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { putWorkingCopyCurrent, required } from './support/api';

/**
 * #1648 (part 2) — quote validity, real browser on Go + disposable PostgreSQL
 * (no route interception):
 *   - the factory default (Ajustes) is frozen into valid_until when the quote
 *     is published from the UI, and the screen shows «Vigente hasta …»;
 *   - once expired, the screen warns, the accept modal blocks until the
 *     explicit acknowledgement, and the server records it in the audit.
 * The only non-product write is rewinding valid_until into the past (the
 * passage of time), done with user triggers disabled on the disposable DB.
 */
const PROJECT_ID = '16481648-0000-4000-8000-000000000001';
const QUOTE_LINE_ID = '16481648-0000-4000-8000-000000000002';
const CUSTOMER_ID = '16481648-0000-4000-8000-000000000003';
const MODULE_ID = '16481648-0000-4000-8000-000000000004';
const STRUCT_ID = '16481648-0000-4000-8000-000000000005';
const HW_ID = '16481648-0000-4000-8000-000000000006';
const VALIDITY_DAYS = 12;
const TIME_ZONE = 'America/Mexico_City';

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

/** dd/mm/aaaa of the factory's calendar day + offset (never the UTC day). */
function factoryDay(days: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const d = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days));
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
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

test.describe.serial('#1648 vigencia de cotizaciones', () => {
  test.beforeAll(async () => {
    const { client, token } = await ownerToken();
    // Factory default validity through the real settings endpoint.
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const current = (await (await fetch(`${apiBase()}/settings`, { headers })).json()) as Record<string, unknown>;
    const saved = await fetch(`${apiBase()}/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ ...current, quote_validity_days: VALIDITY_DAYS, time_zone: TIME_ZONE }),
    });
    expect(saved.ok, `settings PUT ${saved.status}`).toBe(true);
    expect(((await saved.json()) as { quote_validity_days: number }).quote_validity_days).toBe(VALIDITY_DAYS);

    const repository = new APIWorkspaceRepository(apiBase(), { getAccessToken: () => token });
    const catalog = await repository.getCatalog();
    const depthMm = catalog.modules[0]?.externalDims?.depth || 590;
    await repository.saveCatalog({
      ...catalog,
      structures: [...(catalog.structures ?? []).filter((s) => s.id !== STRUCT_ID), { id: STRUCT_ID, code: 'VIG-STRUCT', name: 'Cuerpo vigencia', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
      hardware: [...catalog.hardware.filter((h) => h.id !== HW_ID), { id: HW_ID, code: 'VIG-HW', name: 'Herraje vigencia', unit: 'piece', costPerUnit: 10, active: true }],
      modules: [
        ...catalog.modules.filter((m) => m.id !== MODULE_ID),
        {
          id: MODULE_ID,
          code: 'VIG-MOD-1',
          name: 'Bajo vigencia E2E',
          externalDims: { width: 600, height: 720, depth: depthMm },
          structureId: STRUCT_ID,
          components: [],
          hardwareLines: [{ id: 'vig-hardware-line', hardwareId: HW_ID, quantity: 1, optionRole: '' }],
        },
      ],
      customers: [...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID), { id: CUSTOMER_ID, name: 'Cliente vigencia E2E', active: true }],
    });
    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID,
      name: 'Obra vigencia E2E',
      customerId: CUSTOMER_ID,
      currency: 'MXN',
      marginFactor: 1.3,
      laborFixedCost: 0,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: MODULE_ID, quantity: 1, optionChoices: {} }],
    });
    const mat = await client.materializeQuoteLineFurniture(token, PROJECT_ID, QUOTE_LINE_ID, 'gate-1648v-materialize');
    const instanceId = mat.instances[0]!.furniture_instance_id;
    const q1 = await client.createInitialProjectQuoteRevision(token, PROJECT_ID, { notes: 'Vigencia E2E' }, 'gate-1648-validity-q1-create');
    quoteRevisionId = q1.id;
    // The reconciliation workspace needs a published design revision.
    const design = await client.createProjectDesign(token, PROJECT_ID, { name: 'Diseño vigencia E2E' }, 'gate-1648-validity-design');
    designId = design.id;
    await putWorkingCopyCurrent(client, token, design.id, {
      items: [
        { furniture_instance_id: instanceId, furniture_definition_id: MODULE_ID, parameters: { widthMm: 600, heightMm: 720, depthMm }, material_choices: {} },
      ],
    });
    const r1 = await client.publishDesignRevision(token, design.id, { source_type: 'manual', base_revision_id: null }, 'gate-1648-validity-r1');
    designRevisionId = r1.id;
  });

  test('publicar fija la vigencia; vencida, aceptar exige y registra la confirmación', async ({ page }) => {
    test.setTimeout(150_000);
    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}/reconciliacion?qrev=${quoteRevisionId}&design=${designId}&rev=${designRevisionId}`);
    const panel = page.getByTestId('quote-lifecycle-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('quote-validity')).toContainText(`queda vigente ${VALIDITY_DAYS} días`);

    // 1. Publish from the UI: the server freezes today + 12.
    await panel.getByTestId('publish-quote-btn').click();
    await expect(panel.getByTestId('quote-validity')).toContainText(`Vigente hasta el ${factoryDay(VALIDITY_DAYS)}`);
    const { client, token } = await ownerToken();
    const revisions = await client.listProjectQuoteRevisions(token, PROJECT_ID);
    const published = revisions.find((r) => r.id === quoteRevisionId) as { status: string; validUntil?: string | null };
    expect(published.status).toBe('published');
    expect(published.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 2. Time passes: the quote expired two days ago.
    const pool = new Pool({ connectionString: required('ORGANIZATION_TEST_DATABASE_URL') });
    try {
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        await conn.query('ALTER TABLE quote_revisions DISABLE TRIGGER USER');
        await conn.query(`UPDATE quote_revisions SET valid_until = (NOW() AT TIME ZONE $2::text)::date - 2 WHERE id = $1`, [quoteRevisionId, TIME_ZONE]);
        await conn.query('ALTER TABLE quote_revisions ENABLE TRIGGER USER');
        await conn.query('COMMIT');
      } finally {
        conn.release();
      }

      await page.reload();
      await expect(panel.getByTestId('quote-validity')).toHaveAttribute('data-status', 'expired');
      await expect(panel.getByTestId('quote-validity')).toContainText(`Vencida el ${factoryDay(-2)}`);
      await panel.screenshot({ path: 'test-results/1648-quote-expired-panel.png' });

      // 3. Accept: blocked until the explicit acknowledgement.
      await panel.getByTestId('accept-quote-btn').click();
      const modal = page.getByTestId('accept-quote-modal');
      await expect(modal.getByTestId('accept-quote-expired-warning')).toContainText(`venció el ${factoryDay(-2)}`);
      await expect(modal.getByTestId('confirm-accept-quote-btn')).toBeDisabled();
      await modal.getByTestId('accept-quote-expired-ack').check();
      await modal.screenshot({ path: 'test-results/1648-quote-expired-accept.png' });
      const acceptRequest = page.waitForRequest(
        (req) => req.method() === 'POST' && req.url().endsWith(`/quote-revisions/${quoteRevisionId}:accept`),
      );
      await modal.getByTestId('confirm-accept-quote-btn').click();
      expect((await acceptRequest).postDataJSON()).toEqual({ acknowledgeExpired: true });
      await expect(panel.getByTestId('quote-lifecycle-status')).toHaveText(/Aceptada/);

      const audit = await pool.query(
        `SELECT details->>'accepted_expired' AS expired, details->>'expired_acknowledged' AS ack, actor_user_id
           FROM security_audit_events
          WHERE event_type = 'quote_revision_accepted' AND details->>'quote_revision_id' = $1`,
        [quoteRevisionId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({ expired: 'true', ack: 'true' });
      expect(audit.rows[0].actor_user_id).toBeTruthy();
    } finally {
      await pool.end();
    }
  });
});
