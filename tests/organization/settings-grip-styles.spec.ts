import { expect, test } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required } from './support/api';

// #1533 — Ajustes › Agarres against the real backend: create «Gola negra»
// (L arriba + C entre cajones en inferiores, rebase 20 en alacenas), mark it
// default, see the summary + the SERVER-resolved preview, and prove that
// un-offering never touches an existing project's frozen values.

const HW_PROFILE_8006 = '71830000-0000-4000-8000-000000000003';
const HW_SUPPORT_SU116 = '71830000-0000-4000-8000-000000000004';
const HW_CAPS_CF8006TP = '71830000-0000-4000-8000-000000000005';
const PROFILE_L_ID = '71830000-0000-4000-8000-000000000006';
const PROFILE_C_ID = '71830000-0000-4000-8000-00000000000b';

interface ProjectGripResponse {
  readonly gripVersion: number;
}

interface GripStyleResponse {
  readonly id: string;
  readonly version: number;
  readonly isDefault: boolean;
}

/**
 * This app's overlays swallow synthetic Playwright clicks (ui-modal trap):
 * every interaction goes through the native DOM click.
 */
async function uiClick(page: import('@playwright/test').Page, testId: string): Promise<void> {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await locator.evaluate((el) => (el as HTMLElement).click());
}

test('1533: el taller crea «Gola negra», la marca predeterminada y la vista previa la resuelve el servidor', async ({ page }) => {
  test.setTimeout(300_000);
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = owner.token;

  // The usable v2 profiles the editor picks: L at the top (40), C between (36).
  const spacingMm = 400;
  const profileBodies = [
    {
      id: PROFILE_L_ID,
      code: 'GOLA-L-8006-1533',
      name: 'Gola L Cymisa 8006',
      grip_type: 'gola',
      cross_section_shape: 'L',
      material: 'aluminum',
      positions: ['top'],
      front_discount_top_mm: 40,
      profile_height_mm: 56.5,
      profile_depth_mm: 27.2,
      datasheet_status: 'verified',
      body_modifiers: [],
      bom_members: {
        profile: { hardware_id: HW_PROFILE_8006, rule: 'interior_width', unit: 'meter' },
        supports: { hardware_id: HW_SUPPORT_SU116, rule: 'per_length', spacing_mm: spacingMm },
        endCaps: { hardware_id: HW_CAPS_CF8006TP, rule: 'per_exposed_end' },
      },
      active: true,
    },
    {
      id: PROFILE_C_ID,
      code: 'GOLA-C-8007-1533',
      name: 'Gola C 8007',
      grip_type: 'gola',
      cross_section_shape: 'C',
      material: 'aluminum',
      positions: ['between'],
      front_discount_between_mm: 36,
      profile_height_mm: 36.5,
      profile_depth_mm: 27.2,
      datasheet_status: 'verified',
      body_modifiers: [],
      bom_members: {
        profile: { hardware_id: HW_PROFILE_8006, rule: 'interior_width', unit: 'meter' },
        supports: { hardware_id: HW_SUPPORT_SU116, rule: 'per_length', spacing_mm: spacingMm },
        endCaps: { hardware_id: HW_CAPS_CF8006TP, rule: 'per_exposed_end' },
      },
      active: true,
    },
  ];
  // The hardware the BOM members reference (idempotent seed).
  await client.request<unknown>('POST', '/catalog/hardware', {
    token,
    body: { id: HW_PROFILE_8006, code: '8006-1533', name: 'Perfil GOLA L 8006', unit: 'meter', cost_per_unit: 100, active: true },
  }).catch(() => null);
  await client.request<unknown>('POST', '/catalog/hardware', {
    token,
    body: { id: HW_SUPPORT_SU116, code: 'SU116-1533', name: 'Soporte GOLA', unit: 'piece', cost_per_unit: 10, active: true },
  }).catch(() => null);
  await client.request<unknown>('POST', '/catalog/hardware', {
    token,
    body: { id: HW_CAPS_CF8006TP, code: 'CF8006TP-1533', name: 'Tapas GOLA', unit: 'piece', cost_per_unit: 5, active: true },
  }).catch(() => null);
  for (const body of profileBodies) {
    await client.request<unknown>('POST', '/catalog/opening-profiles', { token, body });
  }

  // UI session.
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toBeVisible();
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();

  await page.goto('/settings');
  await uiClick(page, 'settings-tab-tab-agarres');
  await expect(page.getByTestId('grip-styles-list')).toBeVisible({ timeout: 15_000 });

  // Create «Gola negra»: gola L arriba + C entre cajones en inferiores,
  // rebase 20 en alacenas.
  await uiClick(page, 'grip-styles-create');
  await page.getByTestId('grip-style-name').fill('Gola negra');
  await page.getByTestId('grip-style-mode-inferior').selectOption('gola');
  await page.getByTestId('grip-style-top-profile-inferior').selectOption(PROFILE_L_ID);
  await page.getByTestId('grip-style-between-profile-inferior').selectOption(PROFILE_C_ID);
  await page.getByTestId('grip-style-mode-superior').selectOption('bottom_overhang');
  await expect(page.getByTestId('grip-style-overhang-superior')).toHaveValue(/^2\d$/);

  // The preview is the SERVER's sentence, rendered verbatim.
  await expect(page.getByTestId('grip-style-preview-inferior')).toContainText('Mueble de 720 → puerta de 680');
  await expect(page.getByTestId('grip-style-preview-inferior')).toContainText('322');

  await uiClick(page, 'grip-style-editor-save');
  const created = page.locator('[data-testid^="grip-style-card-"]', { hasText: 'Gola negra' });
  await expect(created).toBeVisible({ timeout: 15_000 });
  const createdId = (await created.getAttribute('data-testid'))!.replace('grip-style-card-', '');
  expect(await page.getByTestId(`grip-style-summary-${createdId}`).textContent()).toContain('gola GOLA-L-8006-1533 arriba');
  expect(await page.getByTestId(`grip-style-summary-${createdId}`).textContent()).toContain('rebase 20 mm');

  // Mark it the workshop default; exactly one badge remains.
  await uiClick(page, `grip-style-make-default-${createdId}`);
  await expect(page.getByTestId(`grip-style-default-${createdId}`)).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId('grip-styles-list').locator('[data-testid^="grip-style-default-"]').count()).toBe(1);

  // Visual evidence (## Visual Evidence in the PR): the list with the new
  // default and the editor's server preview.
  await page.screenshot({ path: 'docs/demo/evidence/1533/agarres-list-default.png', fullPage: true, animations: 'disabled' });
  await uiClick(page, `grip-style-edit-${createdId}`);
  await expect(page.getByTestId('grip-style-preview-inferior')).toContainText('680');
  await page.screenshot({ path: 'docs/demo/evidence/1533/agarres-editor-preview.png', fullPage: true, animations: 'disabled' });
  await uiClick(page, 'grip-style-editor-cancel');

  // The old #1531 notice in the «diseño» tab is gone.
  await uiClick(page, 'settings-tab-tab-diseno');
  await expect(page.getByTestId('settings-grip-notice')).toHaveCount(0);
  await uiClick(page, 'settings-tab-tab-agarres');

  // Desactivar «Ofrecer»: the toggle flips; an EXISTING project that uses
  // the style keeps its frozen values — proven on the furniture card below.
  // First: a project whose grip is «Gola negra» (applied through the API,
  // the #1532 surface the Inspector will use).
  const bootstrapped = await client.bootstrapProjectDesign(token, {
    projectName: 'Obra Agarres E2E',
    designName: 'Diseño agarres',
    newCustomer: { name: 'Cliente Agarres E2E' },
  }, 'gate-1533-bootstrap');
  const projectId = bootstrapped.binding.project.id;
  const grip = await client.request<{ readonly gripVersion: number }>('GET', `/projects/${projectId}/grip`, { token });
  await client.request<ProjectGripResponse>('PUT', `/projects/${projectId}/grip`, {
    token,
    body: { gripStyleId: createdId },
    ifMatch: grip.gripVersion,
  });

  // The DEFAULT style's switch is disabled with its explanation (the
  // workshop invariant: the default is always offered).
  await expect(page.getByTestId(`grip-style-offered-${createdId}`)).toBeDisabled();

  // Un-offering applies to a NON-default style: create a throwaway rebase
  // style, flip its switch, and the project above keeps Gola negra frozen.
  await uiClick(page, 'grip-styles-create');
  await page.getByTestId('grip-style-name').fill('Rebase alto 1533');
  await page.getByTestId('grip-style-mode-alto').selectOption('bottom_overhang');
  await uiClick(page, 'grip-style-editor-save');
  const thrownaway = page.locator('[data-testid^="grip-style-card-"]', { hasText: 'Rebase alto 1533' });
  await expect(thrownaway).toBeVisible({ timeout: 15_000 });
  const throwawayId = (await thrownaway.getAttribute('data-testid'))!.replace('grip-style-card-', '');
  await uiClick(page, `grip-style-offered-${throwawayId}`);
  await expect(page.getByTestId(`grip-style-offered-${throwawayId}`)).not.toBeChecked({ timeout: 15_000 });

  // The furniture card shows the frozen values: style, no exception, the
  // frozen discount — unchanged by the un-offer.
  const furniture = await client.createProjectFurnitureInstance(
    token,
    projectId,
    { furniture_definition_id: GATE_MODULE_A_ID },
    'gate-1533-furniture',
  );
  // Bind the furniture to the design's working copy so the matrix marks it
  // «placed» (the drawer's grip block renders for placed furniture).
  await putWorkingCopyCurrent(client, token, bootstrapped.binding.design.id, {
    items: [
      {
        furniture_instance_id: furniture.id,
        furniture_definition_id: GATE_MODULE_A_ID,
        parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
        material_choices: {},
      },
    ],
  });
  await page.goto(`/quotes/${projectId}/muebles`);
  const row = page.getByTestId(`pf-row-${furniture.id}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: /detalle/i }).click();
  const drawer = page.getByTestId('pf-detail-modal');
  await expect(drawer).toBeVisible();
  const lines = page.getByTestId('pf-detail-grip-lines');
  await expect(lines).toContainText('Estilo: Gola negra', { timeout: 15_000 });
  expect(await lines.textContent()).not.toContain('Excepción:');
  await page.screenshot({ path: 'docs/demo/evidence/1533/mueble-grip-provenance.png', fullPage: true, animations: 'disabled' });
});
