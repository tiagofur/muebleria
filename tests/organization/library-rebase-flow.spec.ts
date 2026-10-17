import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #958 — browser gate for the LIB releases → rebase → resolution journey
 * against real Go + PostgreSQL (disposable):
 *
 *   1. /seed guarantees a published current Standard release (real compiler).
 *   2. The factory saves a construction policy through the REAL settings
 *      surface (Ajustes → Ingeniería) — this CREATES the org overlay on the
 *      current release with its joint.* policy keys.
 *   3. A catalog change + a new draft → publish v2 → the settings screen
 *      shows the upstream-update banner and offers the rebase.
 *   4. Rebase from the UI → with today's release compiler the merge is clean
 *      (no upstream manifest value lives in a permitted custom namespace, so
 *      Case C collisions are structurally unreachable — see the PR) → the
 *      overlay lands on v2, status active, custom keys preserved, banner gone.
 *
 * The keep_custom/adopt_upstream CONFLICT branch is covered at application
 * level (overlay_service_test.go / library_rebase_test.go) — real-data
 * conflicts need a resource kind with a permitted-namespace parameter map,
 * which no release resource carries today.
 */

const apiBase = required('ORGANIZATION_API_BASE');

async function login(page: Page): Promise<void> {
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

test.describe.serial('LIB releases → rebase → resolución (#958)', () => {
  let token = '';
  let overlayId = '';
  let overlayBaseAtSave = '';

  test.beforeAll(async () => {
    const login = await new GraneteApiClient(apiBase).login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    token = login.token;

    // Real compiler publication of the Standard release: guarantees the
    // current release the overlay will pin to has a REAL manifest (the gate
    // bootstrap flips a placeholder release whose manifest does not exist —
    // pinning an overlay to it makes every later rebase 500).
    const seedResponse = await fetch(`${apiBase}/seed`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(seedResponse.ok, `/seed → ${seedResponse.status}: ${(await seedResponse.text()).slice(0, 200)}`).toBe(true);

    // The release compiler requires at least one active hardware profile
    // (#1102 publish gate). The catalog edits this spec makes (material +
    // hardware + profile) leave one behind; idempotent per code.
    const suffix = Date.now().toString(36);
    const hardwareResponse = await fetch(`${apiBase}/catalog/hardware`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `GATEHW-958-${suffix}`,
        name: 'Herraje rebase 958',
        unit: 'piece',
        cost_per_unit: 1,
      }),
    });
    expect(hardwareResponse.status).toBe(201);
    const hardware = (await hardwareResponse.json()) as { id: string };
    const profileResponse = await fetch(`${apiBase}/catalog/hardware-profiles`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `PERF-958-${suffix}`,
        name: 'Perfil rebase 958',
        revision: 'r1',
        items: [{ hardwareId: hardware.id, quantity: 2, applicationRole: 'screw' }],
      }),
    });
    expect(profileResponse.status).toBe(201);
  });

  test('la política guardada por la UI crea el overlay sobre el release vigente', async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    const section = page.getByTestId('settings-section-construction');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Real settings save (the same button the factory admin uses): creates
    // the overlay pinned to the current release, carrying joint.* keys.
    await page.getByTestId('floor-system-select').selectOption('minifix-dowel');
    // The floor rule starts in count mode; the demo policy language is
    // spacing mode (#1065) — switch and set the max spacing.
    await page.getByTestId('floor-pattern-select').selectOption('spacing');
    await page.getByTestId('floor-max-spacing-input').fill('300');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('settings-saved')).toBeVisible({ timeout: 10_000 });

    const client = new GraneteApiClient(apiBase);
    const active = await client.getActiveStandardLibraryOverlay(token);
    expect(active, 'la guardada de Ajustes debe crear el overlay').toBeTruthy();
    overlayId = active!.id;
    overlayBaseAtSave = active!.baseReleaseId;
    expect(Object.keys(active!.overrides ?? {})).toContain('joint.floorToSide.maxSpacingMm');
    expect(active!.status).toBe('active');
  });

  test('publicar v2 enciende el banner; el rebase desde la UI resuelve limpio', async ({ page }) => {
    test.setTimeout(120_000);
    const client = new GraneteApiClient(apiBase);

    // Upstream moves: a new material enters the catalog, then a new draft
    // gathers it and publishes as v_next.
    await fetch(`${apiBase}/catalog/materials`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `REBASE-958-${Date.now().toString(36)}`,
        name: 'Material rebase 958',
        manufacturer: 'Gate Materiales',
        thickness_mm: 15,
        width_mm: 2750,
        length_mm: 1850,
        cost_per_m2: 12,
        active: true,
      }),
    }).then(async (response) => {
      expect(response.status).toBe(201);
    });
    const draft = await client.createStandardLibraryRelease(token, {
      version: `0.rebase958.${Date.now().toString(36)}`,
    });
    const published = await client.publishStandardLibraryRelease(token, draft.id);
    expect(published.manifestHash).toMatch(/^sha256:/);

    await login(page);
    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    const section = page.getByTestId('settings-section-construction');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // The upstream-update banner appears and offers the rebase.
    const rebaseButton = page.getByTestId('rebase-library-btn');
    await expect(rebaseButton).toBeVisible();

    // Rebase from the UI → clean resolution: the overlay lands on v2 with
    // its custom keys preserved.
    await rebaseButton.click();
    const client2 = new GraneteApiClient(apiBase);
    await expect
      .poll(async () => {
        const active = await client2.getActiveStandardLibraryOverlay(token);
        return active?.baseReleaseId;
      }, { timeout: 15_000 })
      .not.toBe(overlayBaseAtSave);

    const rebased = await client2.getActiveStandardLibraryOverlay(token);
    expect(rebased!.status).toBe('active');
    expect(rebased!.baseReleaseId).toBe(draft.id);
    // The rebase stores the merged overrides NESTED (UnflattenMap) while the
    // settings save writes flat granular keys — same policy, different wire
    // shape. The factory keys must survive either way.
    const overridesJson = JSON.stringify(rebased!.overrides ?? {});
    expect(overridesJson).toContain('floorToSide');
    expect(overridesJson).toContain('maxSpacingMm');
    expect(await client2.listLibraryOverlayConflicts(token, overlayId)).toHaveLength(0);
  });
});
