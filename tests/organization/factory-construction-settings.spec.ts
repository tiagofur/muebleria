/**
 * #875 Factory self-service construction settings and component connection editor proof.
 *
 * Exercises real browser against Go backend & disposable PostgreSQL:
 * 1. Factory A configures floor joinery policy on top of Granete Standard without mutating Standard.
 * 2. Component editor reflects factory policy inheritance and permits local overrides with provenance badges.
 * 3. Restoring inheritance deletes the override without leaving orphaned keys.
 * 4. Factory B remains strictly isolated from Factory A's manufacturing overlay.
 */

import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { ensurePublishedStandardRelease, required } from './support/api';

const EXCEPTION_COMPONENT_ID = 'b3333333-8755-4333-8444-0000000000c1';

async function apiTokenForA(): Promise<string> {
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  const login = await client.login({
    email: required('ORGANIZATION_GATE_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return login.token;
}

async function ensureExceptionComponent(token: string): Promise<void> {
  const base = required('ORGANIZATION_API_BASE');
  const body = JSON.stringify({
    id: EXCEPTION_COMPONENT_ID,
    code: 'SET-COMP-EXC',
    name: 'Base Excepción Construcción',
    placement: 'base',
    geometry_kind: 'rectangular_board',
    length_mm: 564,
    width_mm: 560,
    thickness_mm: 18,
    length_formula: '',
    width_formula: '',
    x_formula: '',
    y_formula: '',
    z_formula: '',
    default_edges: [],
    option_roles: ['INTERIOR'],
    active: true,
  });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Request-ID': crypto.randomUUID() };
  // #1096 (#443 slice 3): guarded component writes — learn first, PUT under
  // If-Match; missing rows fall through to POST-create.
  const learn = await fetch(`${base}/catalog/components/${EXCEPTION_COMPONENT_ID}`, { method: 'GET', headers });
  if (learn.ok) {
    const current = (await learn.json()) as { version?: number };
    const put = await fetch(`${base}/catalog/components/${EXCEPTION_COMPONENT_ID}`, {
      method: 'PUT',
      headers: { ...headers, 'If-Match': `"v${current.version}"` },
      body,
    });
    expect(put.ok, `component upsert (If-Match): ${put.status} ${await put.text().catch(() => '')}`).toBe(true);
    return;
  }
  const created = await fetch(`${base}/catalog/components`, { method: 'POST', headers, body });
  expect(created.ok, `component upsert: ${created.status} ${await created.text().catch(() => '')}`).toBe(true);
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Browser Gate A/ }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

async function loginToB(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_B_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  const chooser = page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' });
  try {
    await chooser.waitFor({ state: 'visible', timeout: 3000 });
    await page.getByRole('button', { name: /Browser Gate B/ }).click();
  } catch {
    // Single-org owner logs in directly
  }
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate B');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Factory Construction Settings (#875) Browser E2E', () => {
  test.beforeAll(async () => {
    await ensurePublishedStandardRelease();
  });
  test('Factory A configures self-service construction policy and persists to overlay', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);

    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    const section = page.getByTestId('settings-section-construction');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Initial state: standard inheritance
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');

    // Customize floor joinery: screw-only with 4 stations
    await page.getByTestId('floor-system-select').selectOption('screw-only');
    await page.getByTestId('floor-stations-input').fill('4');

    // Provenance updates immediately to factory overlay
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Fábrica');
    await expect(page.getByTestId('restore-floor-inheritance')).toBeVisible();

    // Save preferences
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('settings-saved')).toBeVisible({ timeout: 10_000 });

    // Reload page to verify persistence in PostgreSQL overlay
    await page.reload();
    await page.getByRole('tab', { name: /Ingeniería/ }).click();
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Fábrica');
    await expect(page.getByTestId('floor-stations-input')).toHaveValue('4');
    await expect(page.getByTestId('floor-system-select')).toHaveValue('screw-only');
  });

  test('Component editor persists a per-component exception to the overlay; restore deletes it (#875 slice 3)', async ({ page }) => {
    test.setTimeout(60_000);
    await ensureExceptionComponent(await apiTokenForA());
    await loginToA(page);

    // The exception keys on the SAVED component's catalog id.
    await page.goto(`/components/${EXCEPTION_COMPONENT_ID}/edit`);
    await page.getByRole('tab', { name: 'Construcción' }).click();

    // Inheritance: no stored exception yet — the badge shows the factory
    // policy (floor screw-only/4 from the first test) and no restore action.
    const provenanceBadge = page.getByTestId('component-provenance-badge');
    await expect(provenanceBadge).toContainText('Fábrica');
    await expect(page.getByTestId('component-restore-inheritance-btn')).toHaveCount(0);

    // The exception is explicit overlay truth: set the station pattern and
    // save it through the panel's own action.
    await page.getByTestId('component-stations-count-input').fill('5');
    await page.getByTestId('component-save-exception-btn').click();
    await expect(provenanceBadge).toContainText('Componente · excepción');

    // The exception is overlay truth: it survives a full reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Construcción' }).click();
    await expect(provenanceBadge).toContainText('Componente · excepción');

    // «Restaurar herencia» deletes the stored intent — after a reload the
    // component inherits the factory policy again, with no orphan state.
    await page.getByTestId('component-restore-inheritance-btn').click();
    await expect(provenanceBadge).toContainText('Fábrica');
    await page.reload();
    await page.getByRole('tab', { name: 'Construcción' }).click();
    await expect(provenanceBadge).toContainText('Fábrica');
    await expect(page.getByTestId('component-restore-inheritance-btn')).toHaveCount(0);
    await expect(page.getByTestId('component-save-exception-btn')).toHaveCount(0);
  });

  test('Factory B remains isolated from Factory A manufacturing overlay', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToB(page);

    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    const section = page.getByTestId('settings-section-construction');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Factory B must NOT see Factory A's overrides
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');
    await expect(page.getByTestId('floor-stations-input')).toHaveValue('2');
    await expect(page.getByTestId('floor-system-select')).toHaveValue('minifix-dowel');
    await expect(page.getByTestId('restore-floor-inheritance')).toHaveCount(0);
  });

  test('Factory A can restore inheritance back to Granete Standard cleanly', async ({ page }) => {
    test.setTimeout(60_000);
    await loginToA(page);

    await page.goto('/settings');
    await page.getByRole('tab', { name: /Ingeniería/ }).click();

    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Fábrica');
    await page.getByTestId('restore-floor-inheritance').click();

    // Reverts to Standard
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');

    // Save restored state
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('settings-saved')).toBeVisible({ timeout: 10_000 });

    // Reload and verify
    await page.reload();
    await page.getByRole('tab', { name: /Ingeniería/ }).click();
    await expect(page.getByTestId('floor-provenance-badge')).toHaveText('Estándar');
    await expect(page.getByTestId('floor-stations-input')).toHaveValue('2');
  });
});
