/*
 * #1096 / #443 slice 3 — browser proof of per-entity optimistic concurrency.
 *
 * Runs in Browser Gate A (disposable PostgreSQL + real Go + real browser
 * login). Two independent API clients (the "two tabs" of #443) edit the same
 * catalog material:
 *   1. both read the entity at its current version;
 *   2. client A writes first (If-Match v1) → 200 and the version bumps;
 *   3. client B's stale write (If-Match v1) → 412 VERSION_CONFLICT typed
 *      envelope, and A's change is NOT reverted;
 *   4. B reconciles (re-reads), retries with the fresh version → 200.
 * This is the acceptance #443 demanded in a real browser-backed gate: a
 * stale editor fails explicitly and never silently overwrites.
 */
import { expect, test } from '@playwright/test';
import { required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');

async function authedFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiBase + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

interface MaterialWire {
  id: string;
  code: string;
  name: string;
  version: number;
}

test.describe.serial('Catalog If-Match concurrency browser proof (#443 slice 3)', () => {
  test('two clients, stale write fails 412, nothing reverts', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
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

    // Create the shared entity (client-neutral seed): create starts at v1.
    // La DB del gate es descartable por corrida: un UUID fijo es idempotente.
    const entityId = '09600000-0000-4000-8000-000000000001';
    const unique = 'S3-IFMATCH';
    const createRes = await authedFetch(token, '/catalog/materials', {
      method: 'POST',
      body: JSON.stringify({
        id: entityId,
        code: unique,
        name: 'Tablero concurrencia S3',
        manufacturer: 'Fábrica Gate A',
        width_mm: 100,
        length_mm: 200,
        thickness_mm: 15,
        grain_default: false,
        board_price: 10,
        waste_percent: 0,
        cost_per_m2: 20,
        active: true,
      }),
    });
    const created = (await createRes.json().catch(() => null)) as MaterialWire | null;
    expect(createRes.ok, `create: ${createRes.status} ${JSON.stringify(created)}`).toBe(true);
    expect(created?.version, `created version: ${JSON.stringify(created)}`).toBe(1);

    const readEntity = async (who: string): Promise<MaterialWire> => {
      const res = await authedFetch(token, `/catalog/materials/${entityId}`);
      expect(res.status, `read (${who})`).toBe(200);
      const body = (await res.json()) as MaterialWire;
      // #443/#448: la versión del wire es la misma fuente del ETag fuerte.
      expect(body.version, `version (${who})`).toBeGreaterThan(0);
      return body;
    };
    const putWithVersion = async (
      who: string,
      version: number,
      name: string,
    ): Promise<{ status: number; body: Record<string, unknown> }> => {
      const res = await authedFetch(token, `/catalog/materials/${entityId}`, {
        method: 'PUT',
        headers: { 'If-Match': `"v${version}"` },
        body: JSON.stringify({
          id: entityId,
          code: unique,
          name,
          manufacturer: 'Fábrica Gate A',
          width_mm: 100,
          length_mm: 200,
          thickness_mm: 15,
          grain_default: false,
          board_price: 10,
          waste_percent: 0,
          cost_per_m2: 20,
          active: true,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, body };
    };

    // Tab A y tab B leen la misma versión.
    const viewA = await readEntity('A');
    const viewB = await readEntity('B');
    expect(viewA.version).toBe(viewB.version);

    // A escribe primero: 200, la versión del servidor avanza.
    const writeA = await putWithVersion('A', viewA.version, 'Editado por A');
    expect(writeA.status, 'A write').toBe(200);

    // B (todavía en la versión vieja) intenta escribir: 412 tipado, y el
    // cambio de A NO se revierte.
    const writeB = await putWithVersion('B', viewB.version, 'Editado por B');
    expect(writeB.status, 'B stale write').toBe(412);
    expect(writeB.body.code, 'typed envelope').toBe('VERSION_CONFLICT');

    const afterStale = await readEntity('B');
    expect(afterStale.name).toBe('Editado por A');
    expect(afterStale.version).toBe(viewA.version + 1);

    // B reconcilia (relee) y reintenta con la versión fresca: 200.
    const writeB2 = await putWithVersion('B', afterStale.version, 'Editado por B (reconciliado)');
    expect(writeB2.status, 'B reconciled write').toBe(200);
    const final = await readEntity('final');
    expect(final.name).toBe('Editado por B (reconciliado)');
    expect(final.version).toBe(afterStale.version + 1);
  });
});
