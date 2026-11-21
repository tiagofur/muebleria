import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

/**
 * #1649 browser proof: cobros y cuenta corriente sobre Go + PostgreSQL
 * descartable, sin interceptar rutas. Anticipo → pago → saldo calculado por el
 * servidor contra la Q aceptada exacta → anulación con motivo → «Por cobrar»
 * en el tablero de ventas → cuenta corriente del cliente → recarga.
 */
const PROJECT_ID = '46000000-0000-4000-8000-000000001650';
const QUOTE_LINE_ID = '46000000-0000-4000-8000-000000001651';
const CUSTOMER_ID = '46000000-0000-4000-8000-000000001652';
const PROJECT_NAME = 'Obra Cobros E2E';
const CUSTOMER_NAME = 'Cliente Cobros E2E';

function apiBase(): string {
  return required('ORGANIZATION_API_BASE');
}

async function prepareAcceptedQuote(): Promise<void> {
  const client = new GraneteApiClient(apiBase());
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const repository = new APIWorkspaceRepository(apiBase(), { getAccessToken: () => owner.token });
  const catalog = await repository.getCatalog();
  const module = catalog.modules.find((candidate) => candidate.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  await repository.saveCatalog({
    ...catalog,
    customers: [
      ...(catalog.customers ?? []).filter((customer) => customer.id !== CUSTOMER_ID),
      { id: CUSTOMER_ID, name: CUSTOMER_NAME, active: true },
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
    items: [{ id: QUOTE_LINE_ID, moduleId: module.id, quantity: 1, optionChoices: {} }],
  });
  await client.materializeQuoteLineFurniture(owner.token, PROJECT_ID, QUOTE_LINE_ID, 'gate-1649-materialize');
  const q1 = await client.createInitialProjectQuoteRevision(owner.token, PROJECT_ID, { notes: 'Cobros E2E' }, 'gate-1649-q1-create');
  await client.publishProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, 'gate-1649-q1-publish');
  await client.acceptProjectQuoteRevision(owner.token, PROJECT_ID, q1.id, {}, 'gate-1649-q1-accept');
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

async function openTool(page: Page, testId: string): Promise<void> {
  const tab = page.getByTestId(testId);
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
}

function money(text: string | null): number {
  return Number((text ?? '').replace(/[^0-9.-]/g, ''));
}

test.describe.serial('#1649 cobros y cuenta corriente', () => {
  test.beforeAll(async () => {
    await prepareAcceptedQuote();
  });

  test('anticipo, pago, anulación, saldo, Por cobrar y cuenta corriente', async ({ page }) => {
    test.setTimeout(150_000);
    await loginToA(page);
    await page.goto(`/quotes/${PROJECT_ID}`);
    await expect(page.getByTestId('project-detail')).toBeVisible();

    // Anticipo por el ciclo de vida (#1647): queda también en el ledger.
    await openTool(page, 'project-tools-lifecycle');
    await page.getByTestId('btn-record-deposit').click();
    await page.getByLabel(/Monto/).fill('100');
    await page.getByLabel(/Referencia/).fill('ANT-1649');
    await page.getByTestId('btn-confirm-deposit').click();
    await expect(page.getByTestId('lifecycle-deposit-summary')).toContainText('ANT-1649');

    // Cobros: total congelado de la Q aceptada, cobrado y saldo del servidor.
    await openTool(page, 'project-tools-payments');
    const panel = page.getByTestId('payments-panel');
    await expect(panel.getByTestId('payments-quote-total')).toContainText('(Q1)');
    await expect(panel.getByTestId('payments-paid-total')).toContainText('100.00 MXN');
    const saleTotal = money(await panel.getByTestId('payments-quote-total').textContent());
    expect(saleTotal).toBeGreaterThan(0);

    // Pago a cuenta.
    await panel.getByTestId('btn-record-payment').click();
    await panel.getByLabel(/Monto/).fill('50.5');
    await panel.getByLabel('Medio de pago').selectOption('cash');
    await panel.getByLabel('Referencia').fill('PAGO-1649');
    await panel.getByTestId('btn-confirm-payment').click();
    await expect(panel.getByTestId('payments-paid-total')).toContainText('150.50 MXN');
    await expect(panel.getByTestId('payments-table')).toContainText('PAGO-1649');

    // Anulación con motivo: el pago queda en el historial, deja de sumar.
    const paymentRow = panel.getByTestId('payments-table').locator('tr', { hasText: 'PAGO-1649' });
    await paymentRow.getByRole('button', { name: 'Anular' }).click();
    await panel.getByLabel(/Motivo/).fill('cargado dos veces');
    await panel.getByTestId('btn-confirm-void').click();
    await expect(paymentRow).toContainText('Anulado: cargado dos veces');
    await expect(panel.getByTestId('payments-paid-total')).toContainText('100.00 MXN');
    const expectedBalance = Math.round((saleTotal - 100) * 100) / 100;
    expect(Math.abs(money(await panel.getByTestId('payments-balance').textContent()))).toBeCloseTo(Math.abs(expectedBalance), 2);

    // Recarga: todo viene del servidor.
    await page.reload();
    await expect(page.getByTestId('project-detail')).toBeVisible();
    await openTool(page, 'project-tools-payments');
    await expect(page.getByTestId('payments-table')).toContainText('Anulado: cargado dos veces');
    await expect(page.getByTestId('payments-paid-total')).toContainText('100.00 MXN');

    // Por cobrar en el tablero de ventas (si el saldo es positivo).
    await page.goto('/sales-dashboard');
    const receivables = page.getByTestId('sales-receivables');
    await expect(receivables).toBeVisible();
    if (expectedBalance > 0) {
      await expect(receivables.getByTestId(`receivable-row-${PROJECT_ID}`)).toContainText(PROJECT_NAME);
    }

    // Cuenta corriente del cliente.
    await page.goto(`/customers/${CUSTOMER_ID}`);
    const account = page.getByTestId('customer-account');
    await expect(account).toBeVisible();
    await expect(account.getByTestId(`receivable-row-${PROJECT_ID}`)).toContainText(PROJECT_NAME);
  });
});
