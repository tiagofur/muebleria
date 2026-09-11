import { expect, test } from '@playwright/test';
import { createSeedWorkspace } from '@granete/storage';
import {
  agregadoToApi,
  categoryToApi,
  componentToApi,
  customerToApi,
  edgeToApi,
  hardwareToApi,
  materialToApi,
  moduleToApi,
  optionGroupToApi,
  projectToApi,
  structureToApi,
} from '../../packages/storage/src/apiMappers';
import {
  installOrganizationApi,
  seedBrowserSession,
} from '../fixtures/organizationSwitch';

test.describe('Cut Program Preview & Step-by-Step UI (#650 PR 3)', () => {
  test('navega a Ingeniería, genera plan 2D y verifica navegación paso a paso con región activa y bandas', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await seedBrowserSession(page);
    await installOrganizationApi(page);

    const seed = createSeedWorkspace();

    await page.route('**/api/projects', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(seed.projects.map(projectToApi)),
      });
    });

    await page.route('**/api/catalog/materials', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(seed.catalog.materials.map(materialToApi)),
      });
    });

    await page.route('**/api/catalog/edges', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(seed.catalog.edges.map(edgeToApi)),
      });
    });

    await page.route('**/api/catalog/hardware', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(seed.catalog.hardware.map(hardwareToApi)),
      });
    });

    await page.route('**/api/catalog/categories', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify((seed.catalog.categories ?? []).map(categoryToApi)),
      });
    });

    await page.route('**/api/catalog/modules', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(seed.catalog.modules.map(moduleToApi)),
      });
    });

    await page.route('**/api/customers', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(seed.catalog.customers.map(customerToApi)),
      });
    });

    await page.route('**/api/catalog/option-groups', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify((seed.catalog.optionGroups ?? []).map(optionGroupToApi)),
      });
    });

    await page.route('**/api/catalog/structures', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify((seed.catalog.structures ?? []).map(structureToApi)),
      });
    });

    await page.route('**/api/catalog/components', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify((seed.catalog.components ?? []).map(componentToApi)),
      });
    });

    await page.route('**/api/catalog/agregados', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify((seed.catalog.agregados ?? []).map(agregadoToApi)),
      });
    });

    // 1. Abrir Ingeniería
    await page.goto('/engineering');
    await page.waitForSelector('.app-sidebar', { timeout: 30_000 });

    // 2. Abrir el proyecto de seed en ingeniería
    const projectCard = page.locator('[data-testid^="eng-project-"], .eng-project-card').first();
    await expect(projectCard).toBeVisible({ timeout: 20_000 });
    await projectCard.click();

    // 3. Esperar a que cargue el workspace de ingeniería
    await page.waitForSelector('[data-testid="eng-tab-optimizacion"]', {
      timeout: 20_000,
    });

    // 4. Cambiar al tab de Optimización
    await page.click('[data-testid="eng-tab-optimizacion"]');
    await page.waitForSelector('[data-testid="prod-opt-workspace"]', {
      timeout: 20_000,
    });

    // 5. Generar el plan de corte 2D
    const btnGenerate = page.locator('button', { hasText: 'Generar Plan de Corte 2D' });
    await expect(btnGenerate).toBeVisible();
    await btnGenerate.click();

    // 6. Verificar que el diagrama de corte se renderiza
    const boardView = page.locator('[data-testid="production-board-view"]');
    await expect(boardView).toBeVisible({ timeout: 20_000 });
    await expect(boardView).toContainText('Guillotina 2D');

    // 7. Marcador del 1er corte primario visible en vista general
    await expect(boardView).toContainText('1er corte');

    // 8. Barra de navegación paso a paso
    const stepNav = page.locator('[data-testid="production-board-step-nav"]');
    await expect(stepNav).toBeVisible();

    // 9. Avanzar a la pasada 1 con el botón Siguiente
    const btnNext = page.locator('[data-testid="step-nav-next"]');
    await expect(btnNext).toBeVisible();
    await btnNext.click();

    // 10. Resumen de paso visible con número de pasada y medida relativa
    const stepSummary = page.locator('[data-testid="step-info-summary"]');
    await expect(stepSummary).toBeVisible();
    await expect(stepSummary).toContainText('Pasada #1');
    await expect(stepSummary).toContainText('Medida:');
    await expect(stepSummary).toContainText('Región:');

    // 11. Verificar que en el SVG se renderiza la región activa y línea de corte
    await expect(page.locator('[data-testid="step-active-region"]')).toBeVisible();
    await expect(page.locator('[data-testid="step-cut-line"]')).toBeAttached();
    await expect(page.locator('[data-testid="step-kerf-band"]')).toBeVisible();

    // 12. Barra lateral de secuencia sincronizada: el primer paso tiene aria-current="step"
    const sidebar = page.locator('[data-testid="prod-opt-cut-sequence-sidebar"]');
    await expect(sidebar).toBeVisible();
    const activeStepItem = sidebar.locator('li[aria-current="step"]');
    await expect(activeStepItem).toHaveCount(1);

    // 13. Clic en el siguiente paso desde la barra lateral
    const secondStepItem = sidebar.locator('li').nth(1);
    await secondStepItem.click();
    await expect(stepSummary).toContainText('Pasada #2');

    // 14. Volver a vista general con el botón "Vista general"
    const btnGeneral = page.locator('[data-testid="step-nav-general"]');
    await btnGeneral.click();
    await expect(stepSummary).toHaveCount(0);
    await expect(page.locator('[data-testid="step-active-region"]')).toHaveCount(0);
  });
});
