import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

async function login(page: Page, email: string, organizationSlug: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  const chooser = page.getByRole('heading', { name: '¿En qué taller vas a trabajar?' });
  if (await chooser.isVisible()) {
    await page.getByRole('button', { name: new RegExp(organizationSlug === required('ORGANIZATION_GATE_ORG_A_SLUG') ? 'Browser Gate A' : 'Browser Gate B') }).click();
  }
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText(
    organizationSlug === required('ORGANIZATION_GATE_ORG_A_SLUG') ? 'Browser Gate A' : 'Browser Gate B',
  );
  const tour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await tour.isVisible()) await tour.getByRole('button', { name: 'Omitir' }).click();
}

test.describe.serial('Gate A #462 browser gaps', () => {
  test('shows a suspended membership only in its authoritative organization', async ({ browser }) => {
    const api = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
    const ownerA = await api.login({
      email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
      password: required('ORGANIZATION_GATE_PASSWORD'),
      transport: 'web',
      org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
    });
    const email = 'browser-gate-suspended-only-a@example.test';
    const invitation = await api.createInvitation(ownerA.token, { email, roles: ['vendedor'] }, 'gate-a-browser-suspended-invite');
    const accepted = await api.acceptInvitation({
      token: invitation.invitation_token,
      password: required('ORGANIZATION_GATE_PASSWORD'),
      name: 'Gate A Suspended Member',
    }, 'gate-a-browser-suspended-accept');
    await api.suspendMembership(
      ownerA.token,
      accepted.memberships[0]!.id,
      accepted.memberships[0]!.version,
      { reason: 'Gate A browser tenant placement proof' },
      'gate-a-browser-suspended-command',
    );

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await login(pageA, required('ORGANIZATION_GATE_A_OWNER_EMAIL'), required('ORGANIZATION_GATE_ORG_A_SLUG'));
    await pageA.goto('/users');
    await pageA.getByRole('button', { name: /Membresías suspendidas \(1\)/ }).click();
    await expect(pageA.getByText(email)).toBeVisible();
    await expect(pageA.getByText('Membresía suspendida')).toBeVisible();
    await contextA.close();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await login(pageB, required('ORGANIZATION_GATE_B_OWNER_EMAIL'), required('ORGANIZATION_GATE_ORG_B_SLUG'));
    await pageB.goto('/users');
    await expect(pageB.getByText(email)).toHaveCount(0);
    await contextB.close();
  });

  test('renders authoritative provisioning and never reports success before commit', async ({ page }) => {
    await login(page, required('ORGANIZATION_GATE_A_OWNER_EMAIL'), required('ORGANIZATION_GATE_ORG_A_SLUG'));
    await page.goto('/platform');
    await expect(page.getByRole('heading', { name: 'Consola de Plataforma' })).toBeVisible();
    await page.getByRole('button', { name: 'Nueva Organización' }).click();
    await page.getByLabel('Nombre del Taller / Negocio *').fill('Gate A Browser Provisioned');
    await page.getByLabel('Slug identificador único *').fill('gate-a-browser-provisioned');
    await page.getByLabel('Administrador inicial *').selectOption({ index: 1 });

    let releaseRequest!: () => void;
    let observeRequest!: () => void;
    const requestObserved = new Promise<void>((resolve) => { observeRequest = resolve; });
    const requestReleased = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await page.route('**/api/organizations', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      observeRequest();
      await requestReleased;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Crear Organización' }).click();
    await requestObserved;
    await expect(page.getByRole('button', { name: 'Creando...' })).toBeDisabled();
    await expect(page.getByRole('status')).toHaveCount(0);

    releaseRequest();
    await expect(page.getByRole('status')).toHaveText('✓ Organización activa y lista para operar');
    const card = page.getByRole('article').filter({ hasText: 'Gate A Browser Provisioned' });
    await expect(card).toContainText('/gate-a-browser-provisioned');
    await expect(card).toContainText('Estado: Activa');
    await expect(card.getByRole('button', { name: 'Entrar a Taller' })).toBeEnabled();
  });
});
