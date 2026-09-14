import { expect, test, type Page } from '@playwright/test';
import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';
import { GATE_MODULE_A_ID, required } from './support/api';

const STRUCTURE_ID = '71800000-0000-4000-8000-000000000001';
const HARDWARE_ID = '71800000-0000-4000-8000-000000000002';
const PROJECT_NAME = 'Obra SketchUp-first Q1 E2E';
const CUSTOMER_NAME = 'Cliente SketchUp-first Q1 E2E';

async function loginToOrganization(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(required('ORGANIZATION_GATE_A_OWNER_EMAIL'));
  await page.getByRole('textbox', { name: 'Contraseña', exact: true }).fill(required('ORGANIZATION_GATE_PASSWORD'));
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await expect(page.locator('.app-topbar__organization-text strong')).toHaveText('Browser Gate A');
  const welcomeTour = page.getByRole('dialog', { name: /Tour de Bienvenida/ });
  if (await welcomeTour.isVisible()) await welcomeTour.getByRole('button', { name: 'Omitir' }).click();
}

test('718: canonical SketchUp-first bootstrap and Q1 appear through the normal React reader', async ({ page }) => {
  const apiBase = required('ORGANIZATION_API_BASE');
  const client = new GraneteApiClient(apiBase);
  const owner = await client.login({
    email: required('ORGANIZATION_GATE_A_OWNER_EMAIL'),
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_A_SLUG'),
  });
  const token = owner.token;
  const repository = new APIWorkspaceRepository(apiBase, { getAccessToken: () => token });

  const catalog = await repository.getCatalog();
  const template = catalog.modules.find((module) => module.id === GATE_MODULE_A_ID) ?? catalog.modules[0]!;
  const depthMm = template.externalDims?.depth || 590;
  await repository.saveCatalog({
    ...catalog,
    structures: [...(catalog.structures ?? []), {
      id: STRUCTURE_ID,
      code: 'Q1-STRUCT',
      name: 'Cuerpo Q1',
      externalDims: { width: 600, height: 720, depth: depthMm },
      components: [],
      active: true,
    }],
    hardware: [...catalog.hardware, {
      id: HARDWARE_ID,
      code: 'Q1-HW',
      name: 'Herraje Q1',
      unit: 'piece',
      costPerUnit: 20,
      active: true,
    }],
    modules: [{
      ...template,
      id: GATE_MODULE_A_ID,
      structureId: STRUCTURE_ID,
      components: [],
      hardwareLines: [{ id: 'q1-hardware-line', hardwareId: HARDWARE_ID, quantity: 1, optionRole: '' }],
      externalDims: { width: 600, height: 720, depth: depthMm },
    }],
  });

  const bootstrapped = await client.bootstrapProjectDesign(token, {
    projectName: PROJECT_NAME,
    designName: 'Diseño inicial SketchUp',
    newCustomer: { name: CUSTOMER_NAME },
  }, 'gate-718-bootstrap');
  const projectId = bootstrapped.binding.project.id;
  const designId = bootstrapped.binding.design.id;

  const furniture = await client.createProjectFurnitureInstance(
    token,
    projectId,
    { furniture_definition_id: GATE_MODULE_A_ID },
    'gate-718-furniture',
  );
  await client.updateDesignWorkingCopy(token, designId, {
    items: [{
      furniture_instance_id: furniture.id,
      furniture_definition_id: GATE_MODULE_A_ID,
      parameters: { widthMm: 600, heightMm: 720, depthMm },
      material_choices: {},
    }],
  });

  const projection = await client.getDesignCommercialProjection(token, projectId, designId);
  expect(projection.status).toBe('current');
  expect(projection.amounts?.saleTotal).toBeGreaterThan(0);
  const quote = await client.createInitialDesignQuoteRevision(token, projectId, designId, {
    workingVersion: projection.workingVersion,
    workingFingerprint: projection.workingFingerprint,
  }, 'gate-718-create-initial-quote');
  expect(quote.revisionNumber).toBe(1);

  await loginToOrganization(page);
  await page.goto('/quotes');
  const card = page.getByTestId(`project-card-${projectId}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(PROJECT_NAME);
  await expect(card).toContainText(CUSTOMER_NAME);
  await expect(card.getByTestId('commercial-status-badge')).toContainText('Q1');
  await expect(card.getByTestId('commercial-status-badge')).toContainText('Borrador');
  await expect(card.locator('.project-card__price-value')).not.toHaveText('—');

  const revisions = await client.listProjectQuoteRevisions(token, projectId);
  expect(revisions).toHaveLength(1);
  expect(revisions[0]?.id).toBe(quote.id);
  expect(revisions[0]?.commercialSnapshot?.designSource?.designId).toBe(designId);
  expect(revisions[0]?.commercialSnapshot?.units).toHaveLength(1);
});
