import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { required } from './support/api';
import { mailboxFor, waitForMessage } from './support/mailpit';

/**
 * #1650 — enviar la cotización exacta al cliente, navegador real sobre Go +
 * PostgreSQL descartable + buzón mailpit (sin interceptar rutas):
 *   - email: el adjunto que llega al buzón tiene el MISMO SHA-256 que el PDF
 *     descargado desde «Más → PDF listado Q1»; queda «Enviada» recién cuando
 *     el servidor SMTP lo aceptó, con quote_sent y estado comercial «enviada».
 *   - WhatsApp: el link wa.me trae el mensaje prellenado; sin confirmación no
 *     cuenta como enviada; «Ya lo envié» lo confirma.
 */
const PROJECT_ID = '16501650-0000-4000-8000-000000000001';
const QUOTE_LINE_ID = '16501650-0000-4000-8000-000000000002';
const CUSTOMER_ID = '16501650-0000-4000-8000-000000000003';
const MODULE_ID = '16501650-0000-4000-8000-000000000004';
const STRUCT_ID = '16501650-0000-4000-8000-000000000005';
const HW_ID = '16501650-0000-4000-8000-000000000006';
const CUSTOMER_EMAIL = 'browser-gate-quote-1650@example.com';

function apiBase(): string {
  return required('ORGANIZATION_API_BASE');
}

async function ownerSession(): Promise<{ client: GraneteApiClient; token: string }> {
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

async function openSendTool(page: Page): Promise<void> {
  await page.goto(`/quotes/${PROJECT_ID}`);
  await expect(page.getByTestId('project-detail')).toBeVisible();
  const tab = page.getByTestId('project-tools-send');
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
  await expect(page.getByTestId('quote-send-panel')).toBeVisible();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function dbRow<T>(sql: string, params: unknown[]): Promise<T> {
  const pool = new Pool({ connectionString: required('ORGANIZATION_TEST_DATABASE_URL') });
  try {
    const result = await pool.query(sql, params);
    return result.rows[0] as T;
  } finally {
    await pool.end();
  }
}

test.describe.serial('#1650 enviar la cotización exacta', () => {
  test.beforeAll(async () => {
    const { client, token } = await ownerSession();
    const repository = new APIWorkspaceRepository(apiBase(), { getAccessToken: () => token });
    const catalog = await repository.getCatalog();
    const depthMm = catalog.modules[0]?.externalDims?.depth || 590;
    await repository.saveCatalog({
      ...catalog,
      structures: [...(catalog.structures ?? []).filter((s) => s.id !== STRUCT_ID), { id: STRUCT_ID, code: 'SND-STRUCT', name: 'Cuerpo envío', externalDims: { width: 600, height: 720, depth: depthMm }, components: [], active: true }],
      hardware: [...catalog.hardware.filter((h) => h.id !== HW_ID), { id: HW_ID, code: 'SND-HW', name: 'Herraje envío', unit: 'piece', costPerUnit: 40, active: true }],
      modules: [
        ...catalog.modules.filter((m) => m.id !== MODULE_ID),
        {
          id: MODULE_ID, code: 'SND-MOD-1', name: 'Bajo envío E2E',
          externalDims: { width: 600, height: 720, depth: depthMm }, structureId: STRUCT_ID, components: [],
          hardwareLines: [{ id: 'snd-hardware-line', hardwareId: HW_ID, quantity: 1, optionRole: '' }],
        },
      ],
      customers: [
        ...(catalog.customers ?? []).filter((c) => c.id !== CUSTOMER_ID),
        { id: CUSTOMER_ID, name: 'Cliente Envío', email: CUSTOMER_EMAIL, phone: '+52 55 1234 5678', active: true },
      ],
    });
    const now = new Date().toISOString();
    await repository.saveProject({
      id: PROJECT_ID, name: 'Obra Envío E2E', customerId: CUSTOMER_ID, currency: 'MXN', marginFactor: 1.3,
      laborFixedCost: 0, status: 'draft', createdAt: now, updatedAt: now,
      items: [{ id: QUOTE_LINE_ID, moduleId: MODULE_ID, quantity: 1, optionChoices: {} }],
    });
    await client.materializeQuoteLineFurniture(token, PROJECT_ID, QUOTE_LINE_ID, 'gate-1650-materialize');
    const q1 = await client.createInitialProjectQuoteRevision(token, PROJECT_ID, { notes: 'Envío E2E' }, 'gate-1650-q1-create');
    await client.publishProjectQuoteRevision(token, PROJECT_ID, q1.id, 'gate-1650-q1-publish');
  });

  test('email: el adjunto recibido es el mismo PDF que la descarga y queda enviada al aceptarlo SMTP', async ({ page }) => {
    test.setTimeout(150_000);
    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}`);
    await expect(page.getByTestId('project-detail')).toBeVisible();

    // The download the seller would attach by hand.
    await page.getByRole('button', { name: /^Más$/i }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /PDF listado Q1/ }).click(),
    ]);
    const downloaded = readFileSync(await download.path());
    const downloadedHash = sha256(downloaded);

    await openSendTool(page);
    const panel = page.getByTestId('quote-send-panel');
    await expect(panel.getByTestId('quote-send-recipient')).toHaveText(`Se envía a ${CUSTOMER_EMAIL}.`);
    await panel.getByLabel('Mensaje para el cliente (opcional)').fill('Quedo atento a tus comentarios.');
    await panel.getByRole('button', { name: 'Enviar por email' }).click();
    await expect(panel.getByTestId('quote-send-notice')).toContainText('en cola');

    // The real mailbox: one email with the exact PDF attached.
    const message = await waitForMessage(CUSTOMER_EMAIL, /^Cotización Q1 — /);
    expect(message.Text).toContain('Quedo atento a tus comentarios.');
    const attachments = (message as unknown as { Attachments: { PartID: string; FileName: string }[] }).Attachments;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.FileName).toBe(download.suggestedFilename());
    const partResponse = await fetch(`${required('ORGANIZATION_MAILPIT_API')}/api/v1/message/${message.ID}/part/${attachments[0]!.PartID}`);
    const received = Buffer.from(await partResponse.arrayBuffer());
    expect(sha256(received)).toBe(downloadedHash);

    // «Enviada» only after the SMTP acceptance; the history pins the hash.
    await expect(panel.getByTestId('quote-delivery-sent')).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('.quote-send__hash')).toHaveAttribute('title', new RegExp(downloadedHash));
    const facts = await dbRow<{ events: string; status: string; sha: string }>(
      `SELECT (SELECT count(*) FROM project_events WHERE project_id = $1 AND type = 'quote_sent')::text AS events,
              (SELECT commercial_status FROM projects WHERE id = $1) AS status,
              (SELECT pdf_sha256 FROM quote_deliveries WHERE project_id = $1 AND channel = 'email') AS sha`,
      [PROJECT_ID],
    );
    expect(facts).toEqual({ events: '1', status: 'sent', sha: downloadedHash });
  });

  test('WhatsApp: mensaje prellenado; sin confirmar no cuenta como enviada', async ({ page }) => {
    test.setTimeout(120_000);
    await loginToA(page);
    await openSendTool(page);
    const panel = page.getByTestId('quote-send-panel');
    await panel.getByRole('button', { name: 'Preparar WhatsApp' }).click();
    const link = panel.getByRole('link', { name: 'Abrir WhatsApp' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    const url = new URL(href!);
    expect(url.host).toBe('wa.me');
    expect(url.pathname).toBe('/525512345678');
    expect(url.searchParams.get('text')).toContain('Q1');
    await expect(panel.getByTestId('quote-delivery-prepared')).toBeVisible();

    const pending = await dbRow<{ status: string; sent_at: string | null }>(
      `SELECT status, sent_at FROM quote_deliveries WHERE project_id = $1 AND channel = 'whatsapp'`,
      [PROJECT_ID],
    );
    expect(pending).toEqual({ status: 'prepared', sent_at: null });

    await panel.getByRole('button', { name: 'Ya lo envié' }).click();
    await expect(panel.getByTestId('quote-delivery-confirmed')).toBeVisible();
    const confirmed = await dbRow<{ status: string; has_sent_at: boolean }>(
      `SELECT status, sent_at IS NOT NULL AS has_sent_at FROM quote_deliveries WHERE project_id = $1 AND channel = 'whatsapp'`,
      [PROJECT_ID],
    );
    expect(confirmed).toEqual({ status: 'confirmed', has_sent_at: true });
    // Nothing was emailed for WhatsApp.
    expect((await mailboxFor(CUSTOMER_EMAIL)).length).toBe(1);
  });
});
