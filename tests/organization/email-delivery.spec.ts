import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';
import { linkTo, mailboxFor, waitForMessage } from './support/mailpit';

// #1646 — outbound email through the durable outbox against a real SMTP sink
// (mailpit). The gate configures SMTP, so: an invitation emails its accept
// link; the public forgot-password screen emails a one-time reset link that
// works exactly once; an unknown email gets the same screen and NO mail.

const STORE_SLUG = 'tienda-email-1646';
const MEMBER_EMAIL = 'browser-gate-email-member@example.com';
const UNKNOWN_EMAIL = 'browser-gate-email-nobody@example.com';
const NEW_PASSWORD = 'Email-1646-nueva';

test.describe.serial('Email delivery (#1646) through the outbox', () => {
  let resetLink: string;

  test.beforeAll(async () => {
    const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const owner = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const provisioned = await client.provisionOrganization(owner.token, {
      name: 'Tienda Email 1646', slug: STORE_SLUG, type: 'store', license_plan: 'none',
    });
    if (!provisioned.readiness.ready) throw new Error('the dedicated email store did not provision');
    const ownerInStore = await client.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web', org: STORE_SLUG,
    });

    // The invitation response says the email was queued, and the invitee
    // receives a Spanish email whose absolute link accepts the invitation.
    const invitation = await client.createInvitation(
      ownerInStore.token, { email: MEMBER_EMAIL, roles: ['admin'] }, 'browser-gate-email-invite',
    );
    expect(invitation.email_delivery).toBe('queued');
    const invite = await waitForMessage(MEMBER_EMAIL, /^Invitación a Tienda Email 1646 en Granete$/);
    const acceptLink = linkTo(invite.Text, '/accept-invitation');
    expect(new URL(acceptLink).origin).toBe(`http://127.0.0.1:${required('ORGANIZATION_WEB_PORT')}`);
    const emailedToken = new URL(acceptLink).searchParams.get('token');
    expect(emailedToken).toBe(invitation.invitation_token);
    await client.acceptInvitation({
      token: emailedToken!, password: required('ORGANIZATION_GATE_PASSWORD'), name: 'Email Member',
    }, 'browser-gate-email-accept');
  });

  test.afterAll(async () => {
    // Same reason as password-reset.spec: drop the shared owner's extra
    // membership so later specs don't land on the organization picker.
    const pool = new Pool({ connectionString: required('ORGANIZATION_TEST_DATABASE_URL') });
    try {
      const params = [required('ORGANIZATION_GATE_A_OWNER_EMAIL'), STORE_SLUG];
      for (const sql of [
        `DELETE FROM auth_refresh_credentials c USING auth_sessions s, users u, organizations o
          WHERE c.session_id = s.id AND s.user_id = u.id AND s.active_organization_id = o.id AND u.email = $1 AND o.slug = $2`,
        `DELETE FROM auth_refresh_families f USING auth_sessions s, users u, organizations o
          WHERE f.session_id = s.id AND s.user_id = u.id AND s.active_organization_id = o.id AND u.email = $1 AND o.slug = $2`,
        `DELETE FROM auth_sessions USING users u, organizations o
          WHERE auth_sessions.user_id = u.id AND auth_sessions.active_organization_id = o.id AND u.email = $1 AND o.slug = $2`,
        `DELETE FROM memberships USING users u, organizations o
          WHERE memberships.user_id = u.id AND memberships.organization_id = o.id AND u.email = $1 AND o.slug = $2`,
      ]) {
        await pool.query(sql, params);
      }
    } finally {
      await pool.end();
    }
  });

  test('forgot password emails a one-time link that sets the new password', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await page.getByLabel('Email *').fill(MEMBER_EMAIL);
    await page.getByRole('button', { name: 'Pedir enlace' }).click();
    await expect(page.getByText(/en unos minutos te llega un correo/)).toBeVisible();

    const message = await waitForMessage(MEMBER_EMAIL, /^Restablecer tu contraseña de Granete$/);
    expect(message.Text).toContain('sirve una sola vez');
    resetLink = linkTo(message.Text, '/reset-password');

    await page.goto(resetLink);
    await page.getByRole('textbox', { name: 'Nueva contraseña *' }).fill(NEW_PASSWORD);
    await page.getByRole('textbox', { name: 'Confirmar contraseña *' }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
    await expect(page.getByText('Tu contraseña se actualizó')).toBeVisible();

    const api = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const session = await api.login({ email: MEMBER_EMAIL, password: NEW_PASSWORD, transport: 'web', org: STORE_SLUG });
    expect(session.token).toBeTruthy();
  });

  test('the emailed link works only once', async ({ page }) => {
    await page.goto(resetLink);
    await page.getByRole('textbox', { name: 'Nueva contraseña *' }).fill(NEW_PASSWORD);
    await page.getByRole('textbox', { name: 'Confirmar contraseña *' }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
    await expect(page.getByText('El enlace de restablecimiento no es válido o ya fue utilizado')).toBeVisible();
  });

  test('an unknown email sees the same screen and receives nothing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
    await page.getByLabel('Email *').fill(UNKNOWN_EMAIL);
    await page.getByRole('button', { name: 'Pedir enlace' }).click();
    await expect(page.getByText(/en unos minutos te llega un correo/)).toBeVisible();
    // The worker polls every second in the gate: give it several cycles.
    await page.waitForTimeout(5_000);
    expect(await mailboxFor(UNKNOWN_EMAIL)).toHaveLength(0);
    // And the known member got exactly one reset email in total.
    const resets = (await mailboxFor(MEMBER_EMAIL)).filter((m) => /^Restablecer/.test(m.Subject));
    expect(resets).toHaveLength(1);
  });
});
