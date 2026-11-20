/*
 * #1511 — browser proof of the category DELETE happy path and its failure
 * path (Go + disposable PostgreSQL, no route interception).
 *
 * Seeds a category through the API, deletes it from the UI and asserts:
 * the page's own DELETE carried If-Match and got 2xx, the server readback is
 * 404, and the row left the list. Failure path: a subcategory created on the
 * server after the page loaded makes the server refuse to drop the parent;
 * the DELETE fails and the parent stays on screen and on the server — never
 * removed «sólo en pantalla».
 */
import { expect, test, type Page } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');

type Family = {
  readonly name: string;
  readonly link: string;
  readonly path: string;
  readonly filterEdit: string;
  readonly manageModal: string;
  readonly confirmDelete: string;
  readonly ids: { readonly target: string; readonly parent: string; readonly child: string };
};

const families: readonly Family[] = [
  {
    name: 'tableros',
    link: 'Materiales',
    path: 'material-categories',
    filterEdit: 'category-filter-edit',
    manageModal: 'material-category-manage-modal',
    confirmDelete: 'material-category-confirm-delete',
    ids: {
      target: '15110000-0000-4000-8000-000000000001',
      parent: '15110000-0000-4000-8000-000000000002',
      child: '15110000-0000-4000-8000-000000000003',
    },
  },
  {
    name: 'herrajes',
    link: 'Herrajes',
    path: 'hardware-categories',
    filterEdit: 'hardware-category-filter-edit',
    manageModal: 'hardware-category-manage-modal',
    confirmDelete: 'hardware-category-confirm-delete',
    ids: {
      target: '15110000-0000-4000-8000-000000000011',
      parent: '15110000-0000-4000-8000-000000000012',
      child: '15110000-0000-4000-8000-000000000013',
    },
  },
];

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

test.describe.serial('#1511 borrado de categorías desde la UI', () => {
  for (const family of families) {
    test(`${family.name}: borra con If-Match y, si el servidor rechaza, la categoría no desaparece`, async ({ page }) => {
      test.setTimeout(120_000);
      const token = await login(page);
      const api = (path: string, init?: RequestInit) =>
        fetch(apiBase + path, {
          ...init,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        });
      const seed = async (id: string, name: string) => {
        const existing = await api(`/catalog/${family.path}/${id}`);
        if (existing.status === 200) return;
        const res = await api(`/catalog/${family.path}`, {
          method: 'POST',
          body: JSON.stringify({ id, name, sort_order: 0 }),
        });
        expect(res.ok, `seed ${name}: ${res.status} ${await res.text()}`).toBe(true);
      };
      await seed(family.ids.target, `Borrar 1511 ${family.name}`);
      await seed(family.ids.parent, `Padre 1511 ${family.name}`);

      await page.reload();
      await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
      await page.getByRole('link', { name: family.link, exact: true }).first().click();
      await page.getByTestId(family.filterEdit).click();
      const manage = page.getByTestId(family.manageModal);
      await expect(manage).toBeVisible();

      // 1. Happy path: DELETE under If-Match, server readback 404, row gone.
      await manage.getByTestId(`manage-category-delete-${family.ids.target}`).click();
      const deleteResponse = page.waitForResponse(
        (res) => res.request().method() === 'DELETE' && res.url().endsWith(`/api/catalog/${family.path}/${family.ids.target}`),
      );
      await page.getByTestId(family.confirmDelete).click();
      const del = await deleteResponse;
      expect(del.ok(), `DELETE status ${del.status()}`).toBe(true);
      expect(del.request().headers()['if-match']).toMatch(/^"v\d+"$/);
      await expect(manage.getByTestId(`manage-category-delete-${family.ids.target}`)).toHaveCount(0);
      expect((await api(`/catalog/${family.path}/${family.ids.target}`)).status).toBe(404);

      // 2. Failure path: a subcategory appears on the server AFTER this page
      // loaded (another user), so the local «tiene subcategorías» guard
      // passes but the server refuses to drop the parent. The parent must
      // stay on screen and on the server — never removed only locally.
      const childRes = await api(`/catalog/${family.path}`, {
        method: 'POST',
        body: JSON.stringify({ id: family.ids.child, name: `Hija 1511 ${family.name}`, sort_order: 0, parent_id: family.ids.parent }),
      });
      expect(childRes.ok, `child seed ${childRes.status}`).toBe(true);
      await manage.getByTestId(`manage-category-delete-${family.ids.parent}`).click();
      const refused = page.waitForResponse(
        (res) => res.request().method() === 'DELETE' && res.url().endsWith(`/api/catalog/${family.path}/${family.ids.parent}`),
      );
      await page.getByTestId(family.confirmDelete).click();
      const refusedRes = await refused;
      expect(refusedRes.ok(), `server must refuse: ${refusedRes.status()}`).toBe(false);
      await expect(manage.getByTestId(`manage-category-delete-${family.ids.parent}`)).toBeVisible();
      await expect(page.getByText('Categoría eliminada')).toHaveCount(0);
      expect((await api(`/catalog/${family.path}/${family.ids.parent}`)).status).toBe(200);
      await page.screenshot({ path: `test-results/1511-${family.path}-refused.png` });
    });
  }
});
