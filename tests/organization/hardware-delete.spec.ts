/*
 * #1615 — browser proof of the physical hardware delete (Go + disposable
 * PostgreSQL, no route interception):
 *   - a hardware that only belongs to an option group is deleted from the UI:
 *     the page's DELETE carries If-Match, the server readback is 404 and the
 *     group no longer lists it;
 *   - a hardware referenced by an agregado line is refused with the server's
 *     Spanish reason and stays on screen and on the server.
 */
import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const HW_FREE = '16150000-0000-4000-8000-000000000001';
const HW_BUSY = '16150000-0000-4000-8000-000000000002';
const GROUP_ID = '16150000-0000-4000-8000-000000000003';
const AGREGADO_ID = '16150000-0000-4000-8000-000000000004';

async function login(page: Page): Promise<string> {
  let token = '';
  page.on('request', (req) => {
    const auth = req.headers().authorization;
    if (auth?.startsWith('Bearer ')) token = auth.slice('Bearer '.length);
  });
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
  await expect.poll(() => token, { timeout: 10_000 }).not.toBe('');
  return token;
}

test('#1615 eliminar herraje: libre se borra y sale del grupo; en uso se rechaza con el motivo', async ({ page }) => {
  test.setTimeout(120_000);
  const token = await login(page);
  const api = (path: string, init?: RequestInit) =>
    fetch(apiBase + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  for (const [id, code, name] of [
    [HW_FREE, 'HW-1615-LIBRE', 'Herraje 1615 libre'],
    [HW_BUSY, 'HW-1615-USO', 'Herraje 1615 en uso'],
  ] as const) {
    if ((await api(`/catalog/hardware/${id}`)).status === 404) {
      const res = await api('/catalog/hardware', { method: 'POST', body: JSON.stringify({ id, code, name, unit: 'piece', cost_per_unit: 12 }) });
      expect(res.ok, `seed ${code}: ${res.status} ${await res.text()}`).toBe(true);
    }
  }
  if ((await api(`/catalog/option-groups/${GROUP_ID}`)).status === 404) {
    const res = await api('/catalog/option-groups', {
      method: 'POST',
      body: JSON.stringify({ id: GROUP_ID, code: 'G-1615', name: 'Grupo 1615', kind: 'hardware', required: false, option_ids: [HW_FREE] }),
    });
    expect(res.ok, `group seed: ${res.status} ${await res.text()}`).toBe(true);
  }
  if ((await api(`/catalog/agregados/${AGREGADO_ID}`)).status === 404) {
    const res = await api('/catalog/agregados', {
      method: 'POST',
      body: JSON.stringify({ id: AGREGADO_ID, code: 'AGR-1615', name: 'Agregado 1615', active: true, components: [], hardware_lines: [{ hardwareId: HW_BUSY, quantity: 2 }] }),
    });
    expect(res.ok, `agregado seed: ${res.status} ${await res.text()}`).toBe(true);
  }

  await page.reload();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  await page.goto('/hardware');
  await expect(page.getByRole('heading', { name: 'Herrajes', exact: true })).toBeVisible();

  // 1. Free hardware (only in a group): deleted.
  await page.getByRole('row', { name: /HW-1615-LIBRE/ }).hover();
  await page.getByTestId(`hardware-delete-${HW_FREE}`).click();
  await expect(page.getByTestId('hardware-delete-groups')).toContainText('Grupo 1615');
  const freeResponse = page.waitForResponse(
    (res) => res.request().method() === 'DELETE' && res.url().endsWith(`/api/catalog/hardware/${HW_FREE}`),
  );
  await page.getByTestId('hardware-delete-confirm-confirm').click();
  const freeRes = await freeResponse;
  expect(freeRes.status()).toBe(200);
  expect(freeRes.request().headers()['if-match']).toMatch(/^"v\d+"$/);
  await expect(page.getByTestId(`hardware-delete-${HW_FREE}`)).toHaveCount(0);
  expect((await api(`/catalog/hardware/${HW_FREE}`)).status).toBe(404);
  const group = (await (await api(`/catalog/option-groups/${GROUP_ID}`)).json()) as { option_ids?: string[]; optionIds?: string[] };
  expect(group.option_ids ?? group.optionIds ?? []).not.toContain(HW_FREE);

  // 2. Hardware used by an agregado: refused with the reason, stays.
  await page.getByRole('row', { name: /HW-1615-USO/ }).hover();
  await page.getByTestId(`hardware-delete-${HW_BUSY}`).click();
  const busyResponse = page.waitForResponse(
    (res) => res.request().method() === 'DELETE' && res.url().endsWith(`/api/catalog/hardware/${HW_BUSY}`),
  );
  await page.getByTestId('hardware-delete-confirm-confirm').click();
  expect((await busyResponse).status()).toBe(409);
  await expect(page.getByText(/está en uso en 1 agregado/)).toBeVisible();
  await expect(page.getByRole('row', { name: /HW-1615-USO/ })).toBeVisible();
  expect((await api(`/catalog/hardware/${HW_BUSY}`)).status).toBe(200);
  await page.screenshot({ path: 'test-results/1615-hardware-delete-refused.png' });
});
