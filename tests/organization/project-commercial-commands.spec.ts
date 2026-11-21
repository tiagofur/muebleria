import { expect, test, type Page, type Request } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #1647 browser proof: the deposit and the commercial status are recorded by
 * server-authored commands (POST /deposits, POST /commercial-status) with an
 * Idempotency-Key, never as client events inside the project PUT. Real Go +
 * disposable PostgreSQL; no route interception.
 */
const PROJECT_ID = '46000000-0000-4000-8000-000000001647';
const QUOTE_LINE_ID = '46000000-0000-4000-8000-000000001648';
const CUSTOMER_ID = '46000000-0000-4000-8000-000000001649';

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

async function prepareAcceptedQuote(): Promise<void> {
  const { client, token } = await ownerSession();
  const repository = new APIWorkspaceRepository(apiBase(), { getAccessToken: () => token });
  const catalog = await repository.getCatalog();
  const module = catalog.modules.find((candidate) => candidate.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  await repository.saveCatalog({
    ...catalog,
    customers: [
      ...(catalog.customers ?? []).filter((customer) => customer.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: 'Cliente Anticipo E2E', active: true },
    ],
  });
  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: 'Obra Anticipo E2E',
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    items: [{ id: QUOTE_LINE_ID, moduleId: module.id, quantity: 1, optionChoices: {} }],
  });
  await client.materializeQuoteLineFurniture(token, PROJECT_ID, QUOTE_LINE_ID, 'gate-1647-materialize');
  const q1 = await client.createInitialProjectQuoteRevision(token, PROJECT_ID, { notes: 'Anticipo E2E' }, 'gate-1647-q1-create');
  await client.publishProjectQuoteRevision(token, PROJECT_ID, q1.id, 'gate-1647-q1-publish');
  await client.acceptProjectQuoteRevision(token, PROJECT_ID, q1.id, {}, 'gate-1647-q1-accept');
}

async function readServerProject(): Promise<{ commercialStatus?: string; events: Array<{ type: string; by_user_id?: string | null; payload?: Record<string, unknown> }> }> {
  const { token } = await ownerSession();
  const headers = { Authorization: `Bearer ${token}` };
  const project = await (await fetch(`${apiBase()}/projects/${PROJECT_ID}`, { headers })).json() as { commercial_status?: string };
  const events = await (await fetch(`${apiBase()}/projects/${PROJECT_ID}/events`, { headers })).json() as Array<{ type: string; by_user_id?: string | null; payload?: Record<string, unknown> }>;
  return { commercialStatus: project.commercial_status, events };
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible();
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('#1647 server-authored deposit and commercial status', () => {
  test.beforeAll(async () => {
    await prepareAcceptedQuote();
  });

  test('deposit and commercial status go through their commands, never through the project PUT', async ({ page }) => {
    test.setTimeout(120_000);
    await loginToA(page);

    const commands: Array<{ path: string; status: number; idempotencyKey: string | undefined }> = [];
    const putBodies: string[] = [];
    page.on('requestfinished', async (request: Request) => {
      const url = request.url();
      if (url === `${apiBase()}/projects/${PROJECT_ID}` && request.method() === 'PUT') {
        putBodies.push(request.postData() ?? '');
        return;
      }
      if (request.method() !== 'POST') return;
      if (url === `${apiBase()}/projects/${PROJECT_ID}/deposits` || url === `${apiBase()}/projects/${PROJECT_ID}/commercial-status`) {
        const response = await request.response();
        commands.push({
          path: new URL(url).pathname.split('/').pop()!,
          status: response?.status() ?? 0,
          idempotencyKey: request.headers()['idempotency-key'],
        });
      }
    });

    await page.goto(`/quotes/${PROJECT_ID}`);
    await expect(page.getByTestId('project-detail')).toBeVisible();
    await page.getByTestId('project-tools-lifecycle').click();
    await expect(page.getByTestId('lifecycle-deposit-summary')).toContainText('Sin anticipo registrado');

    // Deposit through the UI.
    await page.getByTestId('btn-record-deposit').click();
    await page.getByLabel(/Monto/).fill('2500');
    await page.getByLabel(/Referencia/).fill('TRF-1647');
    await page.getByTestId('btn-confirm-deposit').click();
    await expect(page.getByTestId('lifecycle-deposit-summary')).toContainText('TRF-1647');
    await expect.poll(() => commands.filter((c) => c.path === 'deposits')).toEqual([
      expect.objectContaining({ status: 201, idempotencyKey: expect.stringMatching(/^[A-Za-z0-9._:-]{16,128}$/) }),
    ]);

    // Commercial status through the UI.
    await page.getByTestId('select-commercial-status').selectOption('sent');
    await expect.poll(() => commands.filter((c) => c.path === 'commercial-status')).toEqual([
      expect.objectContaining({ status: 200, idempotencyKey: expect.any(String) }),
    ]);
    await expect(page.getByTestId('select-commercial-status')).toHaveValue('sent');

    // Server readback: exactly one deposit, authored by the server-side actor.
    await expect.poll(async () => {
      const server = await readServerProject();
      return {
        commercialStatus: server.commercialStatus,
        deposits: server.events.filter((ev) => ev.type === 'deposit_received').map((ev) => ({
          authored: typeof ev.by_user_id === 'string' && ev.by_user_id.length > 0,
          amount: ev.payload?.amount,
          reference: ev.payload?.reference,
        })),
        sent: server.events.filter((ev) => ev.type === 'quote_sent').length,
      };
    }).toEqual({
      commercialStatus: 'sent',
      deposits: [{ authored: true, amount: 2500, reference: 'TRF-1647' }],
      sent: 1,
    });

    // No project PUT carried a new commercial fact.
    for (const body of putBodies) {
      expect(body).not.toContain('"commercial_status":"sent"');
    }

    // Reload: the deposit and the status are the server's, not local state.
    await page.reload();
    await expect(page.getByTestId('project-detail')).toBeVisible();
    // The tools panel may restore its open state across reloads.
    const lifecycleTab = page.getByTestId('project-tools-lifecycle');
    if ((await lifecycleTab.getAttribute('aria-pressed')) !== 'true') await lifecycleTab.click();
    await expect(page.getByTestId('lifecycle-deposit-summary')).toContainText('TRF-1647');
    await expect(page.getByTestId('select-commercial-status')).toHaveValue('sent');
  });
});
