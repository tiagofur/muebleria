/*
 * #1149 — browser proof that editing an EXISTING material category through
 * the real client save path goes out under If-Match.
 *
 * Regression: saveCatalog still used the unguarded upsert for
 * material-categories and ambient-materials, so every edit of an existing
 * category sent a bare PUT and the server answered 428
 * ("If-Match es obligatorio"), failing the whole catalog autosave. Creating
 * worked (POST needs no If-Match), which is why create-only coverage never
 * caught it.
 *
 * Runs in Browser Gate A (disposable PostgreSQL + real Go + real browser
 * login). Seeds a category through the API, edits it through the UI, and
 * asserts the page's own PUT carried If-Match, got 200, and the server
 * version advanced.
 */
import { expect, test } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');

// La DB del gate es descartable por corrida: un UUID fijo es idempotente.
const categoryId = '09600000-0000-4000-8000-000000001149';
const editedName = 'Subgrupos 1149 editada';

interface CategoryWire {
  id: string;
  name: string;
  version: number;
}

test.describe.serial('Material category edit under If-Match browser proof (#1149)', () => {
  test('editing a seeded category through the UI PUTs with If-Match and persists', async ({ page }) => {
    test.setTimeout(120_000);

    // Real browser session in Browser Gate A using the platform-admin owner.
    let browserToken: string | null = null;
    page.on('request', (req) => {
      const auth = req.headers().authorization;
      if (auth?.startsWith('Bearer ')) {
        browserToken = auth.slice('Bearer '.length);
      }
    });

    await page.goto('/');
    await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
    await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
    const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
    if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();

    if (!browserToken) {
      const authReq = await page.waitForRequest(
        (req) => Boolean(req.headers().authorization?.startsWith('Bearer ')),
        { timeout: 10_000 },
      ).catch(() => null);
      if (authReq) {
        browserToken = authReq.headers().authorization!.slice('Bearer '.length);
      }
    }
    const token = browserToken ?? '';
    expect(token, 'browser session token').toBeTruthy();

    const authedFetch = (path: string, init?: RequestInit): Promise<Response> =>
      fetch(apiBase + path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });

    // Seed (or reuse) the category the UI will edit. POST needs no If-Match;
    // the fixed UUID keeps reruns idempotent on the disposable gate DB.
    let seeded = await authedFetch(`/catalog/material-categories/${categoryId}`);
    if (seeded.status === 404) {
      seeded = await authedFetch('/catalog/material-categories', {
        method: 'POST',
        body: JSON.stringify({ id: categoryId, name: 'Subgrupos 1149', sort_order: 0 }),
      });
    }
    expect(seeded.ok, `seed: ${seeded.status}`).toBe(true);
    const before = (await seeded.json()) as CategoryWire;
    expect(before.version, 'seeded version').toBeGreaterThan(0);

    // Fresh load so the client seeds its session version cache from the wire.
    await page.reload();
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');

    // Catálogos → Materiales → administrar categorías → editar la nuestra.
    await page.getByRole('link', { name: 'Materiales' }).click();
    await expect(page.getByTestId('category-filter-edit')).toBeVisible();
    await page.getByTestId('category-filter-edit').click();
    const manage = page.getByTestId('material-category-manage-modal');
    await expect(manage).toBeVisible();
    await manage.getByTestId(`manage-category-edit-${categoryId}`).click();

    const form = page.getByTestId('material-category-form-modal');
    await expect(form).toBeVisible();
    await form.getByTestId('material-category-name-input').fill(editedName);
    const putPromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'PUT' &&
        res.url().includes(`/api/catalog/material-categories/${categoryId}`),
      { timeout: 20_000 },
    );
    await form.getByTestId('material-category-submit').click();

    // The autosave PUT for THIS category must carry If-Match and succeed —
    // a bare PUT here is exactly the #1149 regression (server answers 428).
    const put = await putPromise;
    expect(put.status(), 'edit PUT status').toBe(200);
    expect(put.request().headers()['if-match'], 'edit PUT carried If-Match').toBeTruthy();

    const saved = (await put.json()) as CategoryWire;
    expect(saved.name).toBe(editedName);
    expect(saved.version).toBeGreaterThan(before.version);

    // Server readback: the edit survived.
    const readback = await authedFetch(`/catalog/material-categories/${categoryId}`);
    expect(readback.status).toBe(200);
    const after = (await readback.json()) as CategoryWire;
    expect(after.name).toBe(editedName);
    expect(after.version).toBe(saved.version);
  });
});
