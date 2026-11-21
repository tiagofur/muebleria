/*
 * #1659 — browser proof (Go + disposable PostgreSQL, no route interception):
 * deleting an agregado the server refuses to drop (a structure created by
 * another session AFTER this page loaded uses it — «agregado in use») keeps
 * the agregado on screen and on the server, with no «Agregado eliminado».
 * Before #1659 the client removed it locally first and it only came back on
 * reload. The happy path (no references) deletes under If-Match and the
 * server readback is 404.
 */
import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');
const AGR_REFUSED = '16590000-0000-4000-8000-000000000001';
const AGR_FREE = '16590000-0000-4000-8000-000000000002';
const STRUCTURE_ID = '16590000-0000-4000-8000-000000000003';

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

test('#1659 agregado: borrado correcto con If-Match y, si el servidor lo rechaza por estar en uso, no desaparece', async ({ page }) => {
  test.setTimeout(120_000);
  const token = await login(page);
  const api = (path: string, init?: RequestInit) =>
    fetch(apiBase + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  for (const [id, code, name] of [
    [AGR_REFUSED, 'AGR-1659-USO', 'Agregado 1659 en uso'],
    [AGR_FREE, 'AGR-1659-LIBRE', 'Agregado 1659 libre'],
  ] as const) {
    if ((await api(`/catalog/agregados/${id}`)).status === 404) {
      const res = await api('/catalog/agregados', {
        method: 'POST',
        body: JSON.stringify({ id, code, name, active: true, components: [] }),
      });
      expect(res.ok, `seed ${code}: ${res.status} ${await res.text()}`).toBe(true);
    }
  }

  await page.reload();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  await page.getByRole('link', { name: 'Agregados', exact: true }).first().click();
  await expect(page.getByTestId('agregados-screen')).toBeVisible();

  const deleteFromUi = async (name: string, id: string) => {
    await page.getByText(name, { exact: false }).first().click();
    await page.getByRole('button', { name: /^Más$/i }).click();
    await page.getByRole('menuitem', { name: /Eliminar/i }).click();
    const response = page.waitForResponse(
      (res) => res.request().method() === 'DELETE' && res.url().endsWith(`/api/catalog/agregados/${id}`),
    );
    await page.getByTestId('agregado-delete-confirm-confirm').click();
    return response;
  };

  // 1. Happy path.
  const ok = await deleteFromUi('Agregado 1659 libre', AGR_FREE);
  expect(ok.ok(), `DELETE ${ok.status()}`).toBe(true);
  expect(ok.request().headers()['if-match']).toMatch(/^"v\d+"$/);
  await expect(page.getByText('Agregado 1659 libre')).toHaveCount(0);
  expect((await api(`/catalog/agregados/${AGR_FREE}`)).status).toBe(404);

  // 2. Another session starts using the agregado after this page loaded.
  if ((await api(`/catalog/structures/${STRUCTURE_ID}`)).status === 404) {
    const res = await api('/catalog/structures', {
      method: 'POST',
      body: JSON.stringify({
        id: STRUCTURE_ID,
        code: 'EST-1659',
        name: 'Estructura 1659',
        components: [],
        agregados: [{ agregado_id: AGR_REFUSED, quantity: 1 }],
      }),
    });
    expect(res.ok, `structure seed: ${res.status} ${await res.text()}`).toBe(true);
  }
  const refused = await deleteFromUi('Agregado 1659 en uso', AGR_REFUSED);
  expect(refused.ok(), `server must refuse: ${refused.status()}`).toBe(false);
  expect(refused.status()).toBe(409);
  await expect(page.getByText('No se puede eliminar: está en uso.', { exact: false })).toBeVisible();
  await expect(page.getByText('Agregado 1659 en uso').first()).toBeVisible();
  await expect(page.getByText('Agregado eliminado')).toHaveCount(0);
  expect((await api(`/catalog/agregados/${AGR_REFUSED}`)).status).toBe(200);
  await page.screenshot({ path: 'test-results/1659-agregado-refused.png' });
});
