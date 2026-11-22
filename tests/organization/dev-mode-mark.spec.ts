import { expect, test, type Page } from '@playwright/test';
import { GraneteApiClient } from '@granete/storage';
import { required } from './support/api';

/**
 * #1599 — a project created from SketchUp with the library developer mode ON
 * shows «Modo desarrollador · sólo pruebas» in Cotizaciones and the permanent
 * note in its detail; one created without the mode shows nothing. Real Go +
 * disposable PostgreSQL; the request carries the same header the extension
 * adapter sends (X-Granete-Library-Mode: draft).
 */

async function ownerToken(transport: 'sketchup' | 'web'): Promise<string> {
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport,
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  return owner.token;
}

async function bootstrap(token: string, projectName: string, devMode: boolean): Promise<string> {
  const response = await fetch(`${required('ORGANIZATION_API_BASE')}/projects:bootstrap-design`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `gate-1599-${projectName.replace(/\W+/g, '-')}-${Date.now()}`,
      ...(devMode ? { 'X-Granete-Library-Mode': 'draft' } : {}),
    },
    body: JSON.stringify({ projectName, designName: 'Diseño principal', newCustomer: { name: `Cliente ${projectName}` } }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { binding: { project: { id: string } } };
  return body.binding.project.id;
}

async function loginToA(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test('#1599 proyecto en modo desarrollador: aviso en Cotizaciones y en el detalle', async ({ page }) => {
  test.setTimeout(120_000);
  // The extension session is what SketchUp uses; the same header from a web
  // session is ignored (the fact is "made from SketchUp").
  const sketchup = await ownerToken('sketchup');
  const devProject = await bootstrap(sketchup, 'Obra Dev 1599', true);
  const plainProject = await bootstrap(sketchup, 'Obra Normal 1599', false);
  const webHeaderProject = await bootstrap(await ownerToken('web'), 'Obra Web 1599', true);

  await loginToA(page);
  await page.goto('/quotes');
  const devCard = page.getByTestId(`project-card-${devProject}`);
  await expect(devCard).toBeVisible();
  const badge = devCard.getByTestId('project-card-dev-mode');
  await expect(badge).toHaveText('Modo desarrollador · sólo pruebas');
  await expect(badge.locator('.status-badge')).toHaveAttribute('aria-label', /se recomienda usarlo sólo para pruebas/);
  await expect(page.getByTestId(`project-card-${plainProject}`).getByTestId('project-card-dev-mode')).toHaveCount(0);
  await expect(page.getByTestId(`project-card-${webHeaderProject}`).getByTestId('project-card-dev-mode')).toHaveCount(0);

  await page.goto(`/quotes/${devProject}`);
  await expect(page.getByTestId('project-detail')).toBeVisible();
  await expect(page.getByTestId('project-dev-mode-note')).toContainText('Creado en modo desarrollador: se recomienda sólo para pruebas · desde');

  await page.goto(`/quotes/${plainProject}`);
  await expect(page.getByTestId('project-detail')).toBeVisible();
  await expect(page.getByTestId('project-dev-mode-note')).toHaveCount(0);
});
