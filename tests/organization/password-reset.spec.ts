import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { TotpProvider, secretFromProvisioningUri } from './support/totp';
import { required } from './support/api';

// #1178 — the admin-issued password reset flow in a real browser: an org
// admin issues a one-time link from Usuarios (with the organization_admin
// step-up), the member opens it, sets a new password, and signs in with it.
// The lifecycle/rotation/expiry semantics are proven against real PostgreSQL
// in backend-go storage tests; this spec proves the full product path.

const ADMIN_EMAIL = 'browser-gate-reset-admin@example.com';
const TARGET_EMAIL = 'browser-gate-reset-target@example.com';
const NEW_PASSWORD = 'Reset-1178-nueva';

async function loginThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await tour.isVisible().catch(() => false)) await tour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Password reset (#1178) admin-issued browser E2E', () => {
  let resetAdmin: { email: string; totp: TotpProvider; organizationName: string };
  let targetMembershipId: string;
  let consumedResetUrl: string;

  test.beforeAll(async () => {
    const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });

    // The workshop under test is a dedicated connected store provisioned by
    // the factory owner: it starts with the plan default of 5 active seats
    // (issue #1172) and its own team, away from the shared gate org fixtures.
    const provisioned = await client.provisionOrganization(owner.token, {
      name: 'Tienda Reset 1178',
      slug: 'tienda-reset-1178',
      type: 'store',
      license_plan: 'none',
    });
    if (!provisioned.readiness.ready || provisioned.organization.status !== 'active') {
      throw new Error('the dedicated reset store did not provision to readiness');
    }
    const storeSlug = provisioned.organization.slug;

    const ownerInStore = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: storeSlug,
    });

    // Fresh admin + target accounts inside the dedicated store: the acting
    // admin owns its own MFA factor (no shared-gate-secret dependency).
    const adminInvitation = await client.createInvitation(
      ownerInStore.token, { email: ADMIN_EMAIL, roles: ['admin'] }, 'browser-gate-reset-admin-invite',
    );
    await client.acceptInvitation({
      token: adminInvitation.invitation_token,
      password: required('ORGANIZATION_GATE_PASSWORD'),
      name: 'Reset Admin',
    }, 'browser-gate-reset-admin-accept');

    // 'admin' role for the target too: the workspace shell needs the
    // member's role to load business data; a bare 'user' gets 403 on the
    // first workspace read, which is correct RBAC but not this spec's subject.
    const targetInvitation = await client.createInvitation(
      ownerInStore.token, { email: TARGET_EMAIL, roles: ['admin'] }, 'browser-gate-reset-target-invite',
    );
    await client.acceptInvitation({
      token: targetInvitation.invitation_token,
      password: required('ORGANIZATION_GATE_PASSWORD'),
      name: 'Reset Target',
    }, 'browser-gate-reset-target-accept');

    const admin = await client.login({
      email: ADMIN_EMAIL, password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web', org: storeSlug,
    });
    const begun = await client.beginMFAEnrollment(admin.token, {});
    const totp = new TotpProvider(secretFromProvisioningUri(begun.provisioning_uri));
    await client.verifyMFAEnrollment(admin.token, begun.factor_id, { code: totp.next() });

    const team = await client.listMemberships(admin.token);
    const target = team.items.find(({ email }) => email === TARGET_EMAIL);
    if (!target || target.membership_status !== 'active') throw new Error('password reset target is not an active member');
    targetMembershipId = target.membership_id;
    resetAdmin = { email: ADMIN_EMAIL, totp, organizationName: provisioned.organization.name };
  });

  test('admin issues the one-time link from Usuarios and the member completes it', async ({ page, browser }) => {
    await loginThroughUi(page, resetAdmin.email, required('ORGANIZATION_GATE_PASSWORD'));
    await expect(page.locator('.app-topbar__organization-text strong')).toHaveText(resetAdmin.organizationName);
    await page.getByRole('link', { name: 'Usuarios' }).click();

    await page.getByRole('button', { name: 'Restablecer contraseña de Reset Target' }).click();

    // organization_admin step-up on the sensitive command (#460 SEC-7).
    await expect(page.getByTestId('step-up-modal')).toBeVisible();
    await page.getByLabel(/Código de autenticación/).fill(resetAdmin.totp.next());
    await page.getByRole('button', { name: /Verificar/ }).click();

    const linkInput = page.getByRole('textbox', { name: 'Enlace de restablecimiento' });
    await expect(linkInput).toBeVisible();
    const resetUrl = await linkInput.inputValue();
    consumedResetUrl = resetUrl;
    await page.getByRole('dialog', { name: 'Enlace de restablecimiento' }).getByRole('button', { name: 'Cerrar' }).last().click();

    // The member opens the link from their own browser: a fresh context keeps
    // the admin's cookie session (and its authority) out of the reset flow.
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await memberPage.goto(resetUrl);
    await memberPage.getByRole('textbox', { name: 'Nueva contraseña *' }).fill(NEW_PASSWORD);
    await memberPage.getByRole('textbox', { name: 'Confirmar contraseña *' }).fill(NEW_PASSWORD);
    await memberPage.getByRole('button', { name: 'Actualizar contraseña' }).click();
    await expect(memberPage.getByText('Tu contraseña se actualizó')).toBeVisible();

    // Old password is dead, new password signs in to the workshop.
    const api = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    let oldPasswordRejected = false;
    try {
      await api.login({
        email: TARGET_EMAIL, password: required('ORGANIZATION_GATE_PASSWORD'),
        transport: 'web', org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
      });
    } catch {
      oldPasswordRejected = true;
    }
    expect(oldPasswordRejected).toBe(true);

    await loginThroughUi(memberPage, TARGET_EMAIL, NEW_PASSWORD);
    const memberTour = memberPage.getByRole('dialog', { name: /Tour de Bienvenida/ });
    if (await memberTour.isVisible().catch(() => false)) await memberTour.getByRole('button', { name: 'Omitir' }).click();
    await expect(memberPage.locator('.app-topbar__organization-text strong')).toHaveText(resetAdmin.organizationName, { timeout: 20_000 });
  });

  test('reopening the consumed link is rejected with the typed message', async ({ browser }) => {
    const replay = await browser.newPage();
    await replay.goto(consumedResetUrl);
    await replay.getByRole('textbox', { name: 'Nueva contraseña *' }).fill(NEW_PASSWORD);
    await replay.getByRole('textbox', { name: 'Confirmar contraseña *' }).fill(NEW_PASSWORD);
    await replay.getByRole('button', { name: 'Actualizar contraseña' }).click();
    await expect(replay.getByText('El enlace de restablecimiento no es válido o ya fue utilizado')).toBeVisible();
    await replay.close();
  });
});
