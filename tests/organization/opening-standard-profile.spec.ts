/**
 * #1329 browser proof: the workshop marks its STANDARD opening profile per
 * section in Configuración → Diseño e Ingeniería → Apertura, and the mark
 * persists in the org overlay (the plugin's picker consumes it read-only).
 *
 * Two verified gola L of different makers are curated — physically both are
 * valid; which one the workshop buys is a business decision. Marking one as
 * the standard and saving must survive a reload (org-persisted through the
 * governed overlay path), and the other stays a plain non-standard option.
 */
import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

const RUN = Date.now().toString(36);

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

test('1329: el estándar del taller por sección se marca en Configuración y persiste en la org', async ({ page }: { page: Page }) => {
  test.setTimeout(180_000);
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = owner.token;

  // Two verified gola L profiles of DIFFERENT makers: the picker's hard case.
  const idScilm = `profile.gola-l-scilm-${RUN}`;
  const idMarcaB = `profile.gola-l-marca-b-${RUN}`;
  const seedProfile = (id: string, code: string, name: string, manufacturer: string) =>
    client.request<unknown>('POST', '/catalog/opening-profiles', {
      token,
      body: {
        id,
        code,
        name,
        manufacturer,
        grip_type: 'gola',
        cross_section_shape: 'L',
        compatible_placements: ['top'],
        front_reduction_mm: 38,
        grip_clearance_mm: 2,
        profile_height_mm: 56.5,
        profile_depth_mm: 27.2,
        geometry_origin: `Ficha E2E #1329 (${manufacturer})`,
        datasheet_status: 'verified',
        body_modifiers: [],
        bom_members: {},
        active: true,
      },
    });
  await seedProfile(idScilm, `GOLA-L-SCILM-${RUN}`, 'Gola L SCILM 8006', 'SCILM');
  await seedProfile(idMarcaB, `GOLA-L-MARCA-B-${RUN}`, 'Gola L Marca B', 'Marca B');

  // Curation through the same governed overlay path the section saves to
  // (the curation list itself is read-only in the UI today).
  const overlay = await client.getActiveStandardLibraryOverlay(token).catch(() => null);
  await client.saveOpeningCapabilities(
    token,
    {
      version: 1,
      grips: {
        handle: { enabled: true, default: true },
        gola: { enabled: true, default: false, profiles: [idScilm, idMarcaB] },
      },
    },
    overlay,
  );

  await loginToA(page);
  await page.goto('/settings');
  await page.getByTestId('settings-tab-tab-diseno').click();
  const section = page.getByTestId('settings-section-opening');
  await expect(section).toBeVisible({ timeout: 15_000 });

  // #1329: the curated list names each profile with its maker — two gola L
  // of different manufacturers are distinguishable BEFORE selecting.
  const list = page.getByTestId('opening-gola-profiles');
  await expect(list).toContainText('SCILM', { timeout: 15_000 });
  await expect(list).toContainText('Marca B');

  // Marca el estándar de la sección L y guarda.
  await page.getByTestId(`opening-standard-L-${idScilm}`).check();
  await page.getByTestId('opening-capabilities-save').click();

  // Persistencia en la org: el reload relee el overlay activo y el estándar
  // sigue marcado (el plugin lo consumirá de la misma fuente).
  await page.reload();
  await page.getByTestId('settings-tab-tab-diseno').click();
  await expect(page.getByTestId('settings-section-opening')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`opening-standard-L-${idScilm}`)).toBeChecked({ timeout: 15_000 });
  await expect(page.getByTestId(`opening-standard-L-${idMarcaB}`)).not.toBeChecked();
});
