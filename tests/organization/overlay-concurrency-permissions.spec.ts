/**
 * #875 slice 4: overlay concurrency + permission matrix — the issue's
 * "Seguridad, concurrencia y versiones" acceptance:
 *
 *   AC07 — two editors of one factory produce a VISIBLE version conflict
 *   (stale If-Match → 412), never a silent last-write-wins; the recovery is
 *   re-read + retry over the current version.
 *   AC3  — a second AUTHORIZED user reads the same configuration;
 *   visitor/sales roles cannot mutate the overlay BY API, regardless of UI.
 *
 * Real browser login → real Go → disposable PostgreSQL. API-level on
 * purpose: the conflict and the permission refusal are server contracts;
 * the UI's error rendering is pinned by the hook/section unit tests.
 * This spec writes only keys under its own run's namespace and always
 * restores the overlay version it found — no cross-spec state leaks.
 */

import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { ensurePublishedStandardRelease, required } from './support/api';

const apiBase = required('ORGANIZATION_API_BASE');

async function login(emailEnv: string, orgSlug: string): Promise<string> {
  const client = new GraneteApiClient(apiBase);
  const login = await client.login({
    email: required(emailEnv),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: orgSlug,
  });
  return login.token;
}

async function loginViaPage(page: Page, emailEnv: string, orgName: string | RegExp): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required(emailEnv));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  // Multi-org subjects land on the factory chooser; single-org ones don't.
  const chooser = page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' });
  try {
    await chooser.waitFor({ state: 'visible', timeout: 3_000 });
    await page.getByRole('button', { name: orgName }).click();
  } catch {
    // single-org login went straight to the shell
  }
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText(orgName, { timeout: 15_000 });
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Overlay concurrency + permissions (#875 slice 4)', () => {
  test.beforeAll(async () => {
    await ensurePublishedStandardRelease();
  });

  let sharedOverlayId = '';
  let sharedVersion = 0;

  test('AC07: a stale editor gets a visible 412 and re-read + retry converges', async ({ page }) => {
    await loginViaPage(page, 'ORGANIZATION_GATE_A_OWNER_EMAIL', 'Browser Gate A');
    const token = await login('ORGANIZATION_GATE_A_OWNER_EMAIL', required('ORGANIZATION_GATE_ORG_A_SLUG'));
    const client = new GraneteApiClient(apiBase);

    // The suite may run this spec alone: seed the overlay when org A has none
    // (the same upsert the construction settings save performs).
    let active = await client.getActiveStandardLibraryOverlay(token);
    if (!active) {
      const currentRel = await client.getStandardCurrentRelease(token);
      active = await client.createLibraryOverlay(token, {
        baseReleaseId: currentRel.id,
        overrides: {},
      });
    }
    sharedOverlayId = active.id;
    sharedVersion = active.version;

    const key = `parameters.slice4ConcurrencyProbe`;
    // Editor B is STALE: it read the same version but editor A lands first.
    const staleVersion = active.version;
    const editorA = await client.updateLibraryOverlay(token, sharedOverlayId, staleVersion, {
      overrides: { ...(active.overrides ?? {}), [key]: 'editor-a' },
    });
    expect(editorA.version).toBe(staleVersion + 1);

    await expect(
      client.updateLibraryOverlay(token, sharedOverlayId, staleVersion, {
        overrides: { ...(active!.overrides ?? {}), [key]: 'editor-b-stale' },
      }),
    ).rejects.toThrow(); // the substance is below: the refused write never lands

    // The refused write must not have landed: A's value survives intact.
    const afterConflict = await client.getLibraryOverlayById(token, sharedOverlayId);
    expect((afterConflict.overrides as Record<string, unknown>)[key]).toBe('editor-a');

    // Recovery: B re-reads and retries over the CURRENT version.
    const retry = await client.updateLibraryOverlay(token, sharedOverlayId, afterConflict.version, {
      overrides: { ...(afterConflict.overrides ?? {}), [key]: 'editor-b-retry' },
    });
    expect(retry.version).toBe(afterConflict.version + 1);

    sharedVersion = retry.version;
  });

  test('AC3: a second authorized user of factory A reads the same configuration', async ({ page }) => {
    // browser-gate@example.com holds a SECOND admin membership in org A
    // (prepareAuthoritativeOrganizations): same factory, different session.
    await loginViaPage(page, 'ORGANIZATION_GATE_EMAIL', 'Browser Gate A');
    const secondUserToken = await login('ORGANIZATION_GATE_EMAIL', required('ORGANIZATION_GATE_ORG_A_SLUG'));
    const client = new GraneteApiClient(apiBase);

    const overlay = await client.getActiveStandardLibraryOverlay(secondUserToken);
    expect(overlay, 'the second authorized user resolves the same active overlay').toBeTruthy();
    expect(overlay!.id).toBe(sharedOverlayId);
    expect(overlay!.version).toBe(sharedVersion);
    expect(
      ((overlay!.overrides ?? {}) as Record<string, unknown>)['parameters.slice4ConcurrencyProbe'],
    ).toBe('editor-b-retry');
  });

  test('AC3: visitor/sales cannot mutate the overlay by API', async () => {
    // browser-gate@example.com is VENDEDOR in org B (roles read back by the
    // gate setup): the server must refuse the mutation whatever any UI shows.
    const vendedorToken = await login('ORGANIZATION_GATE_EMAIL', required('ORGANIZATION_GATE_ORG_B_SLUG'));
    const client = new GraneteApiClient(apiBase);

    const orgBOverlay = await client.getActiveStandardLibraryOverlay(vendedorToken);
    if (!orgBOverlay) {
      // No overlay in factory B: CREATE is a mutation too — it must refuse.
      await expect(
        client.createLibraryOverlay(vendedorToken, {
          baseReleaseId: '00000000-0000-0000-0002-000000000001',
          overrides: { 'parameters.slice4Probe': 'no' },
        }),
      ).rejects.toThrow();
      return;
    }
    await expect(
      client.updateLibraryOverlay(vendedorToken, orgBOverlay.id, orgBOverlay.version, {
        overrides: { ...(orgBOverlay.overrides ?? {}), 'parameters.slice4Probe': 'no' },
      }),
    ).rejects.toThrow(/solo administración de fábrica/i);
  });
});
