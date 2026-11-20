import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #1651 browser proof on Go + disposable PostgreSQL, no route interception:
 * «Actualizar precios» in Materiales (percent, server preview, all-or-nothing
 * apply, catalog reload, price history in the row detail) and in Cantos
 * (supplier CSV with decimal comma, exact-code matching, unknown codes never
 * created).
 */
const BOARD_CODE = 'BULK-1651-MEL';
const EDGE_CODE = 'BULK-1651-CANTO';

function apiBase(): string {
  return required('ORGANIZATION_API_BASE');
}

async function ownerToken(): Promise<string> {
  const client = new GraneteApiClient(apiBase());
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return owner.token;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await ownerToken();
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type Board = { id: string; code: string; board_price: number };
type Edge = { id: string; code: string; cost_per_ml: number };

async function boardByCode(code: string): Promise<Board | undefined> {
  return (await api<Board[]>('/catalog/materials')).find((b) => b.code === code);
}

async function edgeByCode(code: string): Promise<Edge | undefined> {
  return (await api<Edge[]>('/catalog/edges')).find((e) => e.code === code);
}

async function seedCatalog(): Promise<void> {
  if (!(await boardByCode(BOARD_CODE))) {
    await api('/catalog/materials', {
      method: 'POST',
      body: JSON.stringify({ code: BOARD_CODE, name: 'Melamina bulk 1651', manufacturer: 'Fabricante 1651', width_mm: 1830, length_mm: 2440, thickness_mm: 18, board_price: 1000, waste_percent: 10, active: true }),
    });
  }
  if (!(await edgeByCode(EDGE_CODE))) {
    await api('/catalog/edges', {
      method: 'POST',
      body: JSON.stringify({ code: EDGE_CODE, name: 'Canto bulk 1651', thickness_mm: 0.45, cost_per_ml: 10, active: true }),
    });
  }
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

test.describe.serial('#1651 actualización masiva de precios', () => {
  test.beforeAll(async () => {
    await seedCatalog();
  });

  test('ajuste por % en Materiales e importación CSV en Cantos', async ({ page }) => {
    test.setTimeout(150_000);
    const boardBefore = (await boardByCode(BOARD_CODE))!;
    await loginToA(page);

    // Materiales: +10% filtrado por fabricante.
    await page.goto('/materials');
    await page.getByTestId('btn-bulk-prices-material').click();
    const dialog = page.getByTestId('bulk-prices-dialog');
    await dialog.getByLabel('Porcentaje', { exact: true }).fill('10');
    await dialog.getByLabel('Fabricante').selectOption('Fabricante 1651');
    await dialog.getByTestId('btn-preview-prices').click();
    const row = dialog.getByTestId(`price-change-${BOARD_CODE}`);
    await expect(row).toContainText('+10.0%');
    await expect(dialog.getByTestId('count-changed')).toContainText('1');
    await dialog.getByLabel('Nota (opcional)').fill('lista E2E 1651');
    await dialog.getByTestId('btn-apply-prices').click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await boardByCode(BOARD_CODE))?.board_price).toBe(Math.round(boardBefore.board_price * 110) / 100);

    // Historial en el detalle de la fila (tras la recarga del catálogo).
    await page.getByRole('row', { name: new RegExp(BOARD_CODE) }).first().click();
    const history = page.getByTestId('price-history');
    await expect(history).toContainText('lista E2E 1651');
    await expect(history).toContainText('Ajuste %');

    // Cantos: lista CSV con coma decimal, un código desconocido y una fila inválida.
    const edgeBefore = (await edgeByCode(EDGE_CODE))!;
    await page.goto('/edges');
    await page.getByTestId('btn-bulk-prices-edge').click();
    const edgeDialog = page.getByTestId('bulk-prices-dialog');
    await edgeDialog.getByLabel(/Importar lista del proveedor/).check();
    await edgeDialog.getByLabel('Archivo').setInputFiles({
      name: 'lista-cantos.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`Código;Descripción;Precio\n${EDGE_CODE};Canto;12,75\nNO-EXISTE-1651;Nada;5\n;Sin código;3\n`, 'utf-8'),
    });
    await expect(edgeDialog.getByLabel('Columna de código')).toHaveValue('0');
    await edgeDialog.getByTestId('btn-preview-prices').click();
    await expect(edgeDialog.getByTestId('count-changed')).toContainText('1');
    await expect(edgeDialog.getByTestId('count-not-found')).toContainText('1');
    await expect(edgeDialog.getByTestId('count-invalid')).toContainText('1');
    await edgeDialog.getByTestId('btn-apply-prices').click();
    await expect(edgeDialog).toBeHidden();

    await expect.poll(async () => (await edgeByCode(EDGE_CODE))?.cost_per_ml).toBe(12.75);
    expect(edgeBefore.cost_per_ml).not.toBe(12.75);
    expect(await edgeByCode('NO-EXISTE-1651')).toBeUndefined();
  });
});
