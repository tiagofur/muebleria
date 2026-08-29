import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'compact', width: 390, height: 844 },
  { name: 'medium', width: 768, height: 900 },
  { name: 'expanded', width: 1280, height: 800 },
] as const;

const members = [
  {
    membership_id: '11111111-1111-4111-8111-111111111111',
    user_id: '21111111-1111-4111-8111-111111111111',
    name: 'Ana Pérez',
    email: 'ana@taller.test',
    roles: ['admin'],
    account_status: 'active',
    membership_status: 'active',
    joined_at: '2026-08-20T12:00:00Z',
    version: 3,
  },
  {
    membership_id: '12222222-2222-4222-8222-222222222222',
    user_id: '22222222-2222-4222-8222-222222222222',
    name: 'Bruno Silva',
    email: 'bruno@taller.test',
    roles: ['vendedor', 'user'],
    account_status: 'disabled',
    membership_status: 'suspended',
    joined_at: '2026-08-21T12:00:00Z',
    version: 4,
  },
  {
    membership_id: '13333333-3333-4333-8333-333333333333',
    user_id: '23333333-3333-4333-8333-333333333333',
    name: 'Carla Díaz',
    email: 'carla@taller.test',
    roles: ['ingeniero'],
    account_status: 'active',
    membership_status: 'left',
    joined_at: '2026-08-22T12:00:00Z',
    version: 2,
  },
];

const invitations = [
  {
    id: '31111111-1111-4111-8111-111111111111',
    organization_id: '41111111-1111-4111-8111-111111111111',
    email: 'invitada@taller.test',
    status: 'opened',
    roles: ['vendedor'],
    expires_at: '2026-09-05T12:00:00Z',
    created_at: '2026-08-29T12:00:00Z',
    invited_by: members[0]!.user_id,
    accepted_at: null,
    accepted_by: null,
    revoked_at: null,
    revoked_by: null,
    revoked_reason: null,
    version: 2,
  },
];

async function assertNoPageOverflow(page: Page) {
  const dimensions = await page.locator('html').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function prepareAdminSession(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('granete_session', 'auth');
    localStorage.setItem('granete_token', 'visual-review-token');
    localStorage.setItem('granete_user', JSON.stringify({
      id: '21111111-1111-4111-8111-111111111111',
      email: 'ana@taller.test',
      name: 'Ana Pérez',
      account_status: 'active',
      roles: ['admin'],
    }));
  });

  await page.route('http://localhost:8080/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path.endsWith('/org/memberships')) body = members;
    if (path.endsWith('/org/invitations')) body = invitations;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('F194 responsive UI gate', () => {
  for (const viewport of viewports) {
    test(`Team is usable without page overflow at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await prepareAdminSession(page);
      await page.goto('/users');
      await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Invitar Miembro/ }).first()).toBeVisible();
      await expect(page.getByText('Cuenta activa').first()).toBeVisible();
      await expect(page.getByText('Membresía activa').first()).toBeVisible();
      await assertNoPageOverflow(page);

      await page.screenshot({
        path: `test-results/f193-ui-gate/team-${viewport.name}-${viewport.width}.png`,
        fullPage: true,
      });
    });

    test(`invitation acceptance is usable without overflow at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/accept-invitation?token=visual-review-token');
      await expect(page.getByRole('heading', { name: 'Unirte al equipo' })).toBeVisible();
      await expect(page.getByLabel('Contraseña *')).toBeVisible();
      await expect(page.getByRole('button', { name: /Aceptar invitación y entrar/ })).toBeVisible();
      await assertNoPageOverflow(page);

      await page.screenshot({
        path: `test-results/f193-ui-gate/accept-${viewport.name}-${viewport.width}.png`,
        fullPage: true,
      });
    });
  }
});
