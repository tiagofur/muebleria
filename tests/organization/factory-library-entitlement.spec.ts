import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient, type PlatformOrganization } from '@granete/storage';
import { required } from './support/api';

async function login(page: Page, email: string, organizationName: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  const chooserHeading = page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' });
  const topbarOrg = page.locator('.app-topbar__organization-text strong');

  // Wait for either the organization chooser or topbar to appear
  await Promise.race([
    chooserHeading.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined),
    topbarOrg.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined),
  ]);

  if (await chooserHeading.isVisible()) {
    await page.getByRole('button', { name: new RegExp(organizationName) }).click();
  }
  await expect(topbarOrg).toHaveText(organizationName, { timeout: 10000 });
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  try {
    await tour.waitFor({ state: 'visible', timeout: 1500 });
    await tour.getByRole('button', { name: 'Omitir' }).click();
  } catch {
    // Tour did not appear
  }
}

test.describe.serial('Factory Library Entitlement E2E (#1382)', () => {
  const standardSlug = 'standard-library-e2e';
  const standardName = 'Standard Library E2E Workshop';
  const customSlug = 'custom-library-e2e';
  const customName = 'Custom Library E2E Workshop';

  let client: GraneteApiClient;
  let adminToken: string;
  let standardOrg: PlatformOrganization;
  let customOrg: PlatformOrganization;

  test.beforeAll(async () => {
    client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const adminLogin = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    adminToken = adminLogin.token;

    // #460: dedicated bootstrap admin for BOTH organizations of this spec. The
    // Gate A owner must keep a single membership (no organization chooser) so
    // the webauth fail-closed spec can hold it; bootstrapping these orgs with
    // the owner itself made it multi-membership and broke that invariant.
    const entitlementAdminEmail = required('ORGANIZATION_GATE_ENTITLEMENT_ADMIN_EMAIL');
    const entitlementAdmin = (await client.listPlatformUsers(adminToken))
      .find(({ email }) => email === entitlementAdminEmail);
    if (!entitlementAdmin) throw new Error('entitlement admin is missing from the gate seeding');
    if (entitlementAdmin.memberships.length !== 0) {
      throw new Error('entitlement admin must be dedicated: it starts with no memberships');
    }

    // Provision a standard organization
    const standardResult = await client.provisionOrganization(adminToken, {
      name: standardName,
      slug: standardSlug,
      type: 'factory',
      license_plan: 'trial',
      library_type: 'standard',
      bootstrap_admin_user_id: entitlementAdmin.id,
    });
    standardOrg = standardResult.organization;
    expect(standardOrg.library_type).toBe('standard');

    // Provision a custom organization
    const customResult = await client.provisionOrganization(adminToken, {
      name: customName,
      slug: customSlug,
      type: 'factory',
      license_plan: 'trial',
      library_type: 'custom',
      bootstrap_admin_user_id: entitlementAdmin.id,
    });
    customOrg = customResult.organization;
    expect(customOrg.library_type).toBe('custom');
  });

  test('server guard: standard workshop cannot create modules (403 Forbidden)', async () => {
    const workshopLogin = await client.login({
      email: required('ORGANIZATION_GATE_ENTITLEMENT_ADMIN_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: standardSlug,
    });

    let forbiddenError: any = null;
    try {
      await client.createCatalogModule(workshopLogin.token, {
        code: 'BLOCKED-MOD',
        name: 'Blocked Module',
        width_mm: 600,
        height_mm: 720,
        depth_mm: 560,
      } as any);
    } catch (err) {
      forbiddenError = err;
    }

    expect(forbiddenError).not.toBeNull();
    expect(forbiddenError.status).toBe(403);
  });

  test('server guard: custom workshop can create modules (201 Created)', async () => {
    const workshopLogin = await client.login({
      email: required('ORGANIZATION_GATE_ENTITLEMENT_ADMIN_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: customSlug,
    });

    const created = await client.createCatalogModule(workshopLogin.token, {
      code: 'ALLOWED-MOD',
      name: 'Allowed Module',
      width_mm: 600,
      height_mm: 720,
      depth_mm: 560,
    } as any);

    expect(created).toBeDefined();
    expect(created.code).toBe('ALLOWED-MOD');
  });

  test('web: standard workshop hides geometry authoring links and bounces /modules to home', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, required('ORGANIZATION_GATE_ENTITLEMENT_ADMIN_EMAIL'), standardName);

      // Nav assertions: geometry links must NOT exist, local shop links MUST exist
      const nav = page.locator('nav');
      await expect(nav.getByRole('link', { name: 'Muebles', exact: true })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Estructuras', exact: true })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Componentes', exact: true })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Agregados', exact: true })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Acabados', exact: true })).toHaveCount(0);

      await expect(nav.getByRole('link', { name: 'Materiales', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Cantos', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Herrajes', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Ajustes', exact: true })).toBeVisible();

      // Deep link bounce: visiting /modules bounces to home with standard library notice
      await page.goto('/modules');
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByText('Tu taller usa la biblioteca estándar de Granete. Esta sección requiere el módulo de personalización de biblioteca.'),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('web: custom workshop displays geometry links and allows accessing /modules', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, required('ORGANIZATION_GATE_ENTITLEMENT_ADMIN_EMAIL'), customName);

      // Nav assertions: geometry links must now be visible
      const nav = page.locator('nav');
      await expect(nav.getByRole('link', { name: 'Muebles', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Estructuras', exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Componentes', exact: true })).toBeVisible();

      // Visiting /modules directly succeeds without bouncing
      await page.goto('/modules');
      await expect(page).toHaveURL(/\/modules$/);
      await expect(page.getByRole('button', { name: /Nuevo mueble/i })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
