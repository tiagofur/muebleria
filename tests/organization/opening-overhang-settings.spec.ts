/**
 * #1525 browser proof: Configuración → Diseño e Ingeniería → Apertura.
 *
 * - Each system says what its check enables («Ofrecer en SketchUp») and the
 *   controls without a consumer (preselected system, per-type restrictions)
 *   are gone.
 * - The bottom overhang finally has a place for its millimetres. Without
 *   them a design that selects the rebase is refused with
 *   OPENING_OVERHANG_EVIDENCE_PENDING; after saving 20 mm in the screen the
 *   same selection resolves and the front extends 20 mm (720 → 740).
 * - An invalid value (0) never reaches the overlay.
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, putWorkingCopyCurrent, required } from './support/api';

interface DesignOpeningPayload {
  readonly resolution?: {
    readonly state: string;
    readonly reason?: string;
    readonly fronts?: readonly { readonly heightMm: number }[];
  } | null;
  readonly workingVersion: string;
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

async function openOpeningSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.getByTestId('settings-tab-tab-diseno').click();
  await expect(page.getByTestId('settings-section-opening')).toBeVisible({ timeout: 15_000 });
}

test('1525: el rebase inferior se configura en milímetros y deja de quedar bloqueado', async ({ page }) => {
  test.setTimeout(240_000);
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = owner.token;

  // Start from a known state: rebase offered, no millimetres declared.
  const overlay = await client.getActiveStandardLibraryOverlay(token).catch(() => null);
  await client.saveOpeningCapabilities(
    token,
    {
      version: 1,
      grips: {
        handle: { enabled: true, default: true },
        gola: { enabled: true, default: false },
        bottom_overhang: { enabled: true, default: false },
      },
    },
    overlay,
    undefined,
    null,
  );

  const bootstrapped = await client.bootstrapProjectDesign(token, {
    projectName: 'Obra rebase 1525 E2E',
    designName: 'Alacena con rebase',
    newCustomer: { name: 'Cliente rebase 1525 E2E' },
  }, 'gate-1525-bootstrap');
  const projectId = bootstrapped.binding.project.id;
  const designId = bootstrapped.binding.design.id;
  const furniture = await client.createProjectFurnitureInstance(
    token,
    projectId,
    { furniture_definition_id: GATE_MODULE_A_ID },
    'gate-1525-furniture',
  );
  await putWorkingCopyCurrent(client, token, designId, {
    items: [{
      furniture_instance_id: furniture.id,
      furniture_definition_id: GATE_MODULE_A_ID,
      parameters: { widthMm: 600, heightMm: 720, depthMm: 350 },
    }],
  });

  const applyOverhang = async () => {
    const workingCopy = await client.getDesignWorkingCopy(token, designId);
    return client.request<DesignOpeningPayload>('PUT', `/designs/${designId}/opening`, {
      token,
      body: { system: 'bottom_overhang', expectedWorkingVersion: workingCopy.updated_at },
    });
  };

  // Without millimetres the selection is refused with the honest reason.
  const refused = await applyOverhang().then(
    () => null,
    (err: unknown) => err as { status?: number; body?: unknown; message?: string },
  );
  expect(refused, 'without millimetres the rebase must be refused').not.toBeNull();
  // The design opening endpoint answers a bare {code, message, details}
  // (INVALID_OPENING_CONFIGURATION / OPENING_OVERHANG_EVIDENCE_PENDING); the
  // typed client does not parse that shape, so the status is the proof here.
  expect(refused?.status).toBe(422);

  await loginToA(page);
  await openOpeningSettings(page);

  // Each check says what it enables; the dead controls are gone.
  await expect(page.getByTestId('opening-system-bottom_overhang')).toContainText('Ofrecer en SketchUp');
  await expect(page.getByTestId('opening-by-furniture-type')).toHaveCount(0);
  await expect(page.getByText('Sistema preseleccionado')).toHaveCount(0);
  await expect(page.getByTestId('opening-overhang-hint')).toContainText('queda bloqueado en SketchUp');

  // An invalid value never reaches the overlay.
  await page.getByTestId('opening-overhang-mm').fill('0');
  await page.getByTestId('opening-capabilities-save').click();
  await expect(page.getByTestId('opening-capabilities-error')).toContainText('entero mayor que 0');

  // 20 mm saved in the screen survives a reload.
  await page.getByTestId('opening-overhang-mm').fill('20');
  await page.getByTestId('opening-capabilities-save').click();
  await expect(page.getByTestId('opening-capabilities-error')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('settings-tab-tab-diseno').click();
  await expect(page.getByTestId('opening-overhang-mm')).toHaveValue('20', { timeout: 15_000 });

  // The overlay carries exactly the rule, and the selection now resolves.
  const saved = await client.getActiveStandardLibraryOverlay(token);
  expect((saved?.overrides as Record<string, unknown>)['opening.bottom-overhang']).toEqual({ version: 1, overhangMm: 20 });
  const applied = await applyOverhang();
  expect(applied.resolution?.state).toBe('resolved');
  expect(applied.resolution?.fronts?.[0]?.heightMm).toBe(740);

  // Leave the shared org as other specs expect it: no overhang rule.
  await client.saveOpeningCapabilities(
    token,
    { version: 1, grips: { handle: { enabled: true, default: true }, gola: { enabled: true, default: false } } },
    saved,
    undefined,
    null,
  );
});
