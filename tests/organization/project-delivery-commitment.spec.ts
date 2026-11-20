import { expect, test, type Page, type Request } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { localIsoDate } from '@granete/domain';
import { required } from './support/api';

/**
 * #1648 browser proof on Go + disposable PostgreSQL, no route interception:
 * the committed delivery date is set and moved through the server command
 * (POST /delivery-commitment with Idempotency-Key, never the project PUT); a
 * change requires a reason that lands in the lifecycle log; the late order
 * shows as «Atrasado» in the obra, in Cotizaciones (chip + «Entregas en
 * riesgo») and in «Necesita atención» on the home dashboard, whose «Pedidos
 * atrasados» count opens Cotizaciones already filtered.
 */
const PROJECT_ID = '46000000-0000-4000-8000-000000016480';
const CUSTOMER_ID = '46000000-0000-4000-8000-000000016481';
const PROJECT_NAME = 'Obra Entrega E2E 1648';

function apiBase(): string {
  return required('ORGANIZATION_API_BASE');
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
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

async function prepareProject(): Promise<void> {
  const { token } = await ownerSession();
  const repository = new APIWorkspaceRepository(apiBase(), { getAccessToken: () => token });
  const catalog = await repository.getCatalog();
  await repository.saveCatalog({
    ...catalog,
    customers: [
      ...(catalog.customers ?? []).filter((customer) => customer.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: 'Cliente Entrega E2E', active: true },
    ],
  });
  const now = new Date().toISOString();
  await repository.saveProject({
    id: PROJECT_ID,
    name: PROJECT_NAME,
    customerId: CUSTOMER_ID,
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 0,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    items: [],
  });
}

async function readServer(): Promise<{ committed?: string; events: Array<{ type: string; by_user_id?: string | null; payload?: Record<string, unknown> }> }> {
  const { token } = await ownerSession();
  const headers = { Authorization: `Bearer ${token}` };
  const project = (await (await fetch(`${apiBase()}/projects/${PROJECT_ID}`, { headers })).json()) as { committed_delivery_date?: string };
  const events = (await (await fetch(`${apiBase()}/projects/${PROJECT_ID}/events`, { headers })).json()) as Array<{ type: string; by_user_id?: string | null; payload?: Record<string, unknown> }>;
  return { committed: project.committed_delivery_date, events };
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

test.describe.serial('#1648 entrega comprometida', () => {
  test.beforeAll(async () => {
    await prepareProject();
  });

  test('comprometer, mover con motivo y ver el atraso en obra, lista y dashboard', async ({ page }) => {
    test.setTimeout(150_000);
    await loginToA(page);

    const commands: Array<{ status: number; idempotencyKey: string | undefined }> = [];
    const putBodies: string[] = [];
    page.on('requestfinished', async (request: Request) => {
      const url = request.url();
      if (url === `${apiBase()}/projects/${PROJECT_ID}` && request.method() === 'PUT') {
        putBodies.push(request.postData() ?? '');
        return;
      }
      if (request.method() === 'POST' && url === `${apiBase()}/projects/${PROJECT_ID}/delivery-commitment`) {
        const response = await request.response();
        commands.push({ status: response?.status() ?? 0, idempotencyKey: request.headers()['idempotency-key'] });
      }
    });

    const late = dayOffset(-2);
    const moved = dayOffset(3);

    await page.goto(`/quotes/${PROJECT_ID}`);
    await expect(page.getByTestId('project-detail')).toBeVisible();
    await page.getByTestId('project-tools-overview').click();
    const card = page.getByTestId('delivery-commitment-card');
    await expect(card.getByTestId('delivery-committed-date')).toHaveText('Sin fecha comprometida');

    // 1. First commitment: date only.
    await card.getByTestId('btn-commit-delivery').click();
    await expect(card.getByLabel('Motivo del cambio')).toHaveCount(0);
    await card.getByLabel('Fecha de entrega').fill(late);
    await card.getByTestId('btn-save-delivery').click();
    await expect(card.getByTestId('delivery-card-status')).toHaveText('Atrasado 2 días');
    await expect.poll(async () => (await readServer()).committed).toBe(late);

    // 2. Change without reason is blocked before the request; with reason it lands.
    await card.getByTestId('btn-commit-delivery').click();
    await card.getByLabel('Fecha de entrega').fill(moved);
    await card.getByTestId('btn-save-delivery').click();
    await expect(card.getByTestId('delivery-commitment-error')).toContainText('motivo');
    expect(commands).toHaveLength(1);
    await card.getByLabel('Motivo del cambio').fill('El proveedor atrasó la placa');
    await card.getByTestId('btn-save-delivery').click();
    await expect(card.getByTestId('delivery-card-status')).toHaveText('Faltan 3 días');
    await expect(card.getByTestId('delivery-last-change')).toContainText('El proveedor atrasó la placa');
    await card.screenshot({ path: 'test-results/1648-delivery-card.png' });

    const server = await readServer();
    expect(server.committed).toBe(moved);
    const delivery = server.events.filter((ev) => ev.type.startsWith('delivery_date_'));
    expect(delivery.map((ev) => ev.type)).toEqual(['delivery_date_committed', 'delivery_date_changed']);
    expect(delivery[1]?.payload).toMatchObject({ date: moved, previousDate: late, reason: 'El proveedor atrasó la placa' });
    expect(delivery.every((ev) => Boolean(ev.by_user_id))).toBe(true);
    expect(commands.map((c) => c.status)).toEqual([200, 200]);
    expect(commands.every((c) => Boolean(c.idempotencyKey))).toBe(true);
    expect(commands[0]?.idempotencyKey).not.toBe(commands[1]?.idempotencyKey);
    for (const body of putBodies) expect(body).not.toContain('committed_delivery_date');

    // 3. Back to late (server-side via the same command) to prove the lists.
    const { client, token } = await ownerSession();
    await client.commitProjectDeliveryDate(token, PROJECT_ID, { date: late, reason: 'Corrección E2E: era la fecha original' }, 'gate-1648-back-to-late');

    await page.goto('/quotes');
    const listCard = page.getByTestId(`project-card-delivery-${PROJECT_ID}`);
    await expect(listCard).toContainText('Atrasado 2 días');
    await page.getByTestId('projects-delivery-risk-toggle').click();
    await expect(page.getByTestId('projects-delivery-risk-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`project-card-${PROJECT_ID}`)).toBeVisible();
    await page.screenshot({ path: 'test-results/1648-quotes-delivery-risk.png', fullPage: false });

    await page.goto('/');
    const alerts = page.getByTestId('ops-exceptions-panel');
    await expect(alerts).toContainText(PROJECT_NAME);
    await expect(alerts).toContainText('atrasada (2 días)');

    // 4. Dashboard count (#1648 scope item 4) deep-links to the filtered list.
    const overdueCard = page.getByTestId('stat-delivery-overdue');
    await expect(overdueCard).toBeVisible();
    const overdueCount = Number(await page.getByTestId('stat-delivery-overdue-value').textContent());
    expect(overdueCount).toBeGreaterThanOrEqual(1);
    await page.getByTestId('dashboard-delivery-risk').screenshot({ path: 'test-results/1648-dashboard-overdue.png' });
    await overdueCard.click();
    await expect(page).toHaveURL(/\/quotes\?entregas=riesgo$/);
    await expect(page.getByTestId('projects-delivery-risk-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`project-card-${PROJECT_ID}`)).toBeVisible();
  });
});
