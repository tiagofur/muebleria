import { test, expect, type Page } from '@playwright/test';

/**
 * F141 (#309): smoke real del estudio Proyectar en browser con WebGL.
 *
 * La suite unitaria (jsdom) no puede montar R3F/three; este smoke valida el
 * camino real: abrir una cotización draft → Proyectar → canvas WebGL renderiza
 * → biblioteca lateral presente → insert por click crea y coloca el ítem.
 * Es la verificación base que las etapas E2+ de la meta #308 amplían.
 */

async function enterAsGuest(page: Page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('muebles_session', 'guest');
    } catch {
      /* sessionStorage unavailable */
    }
  });
}

test.describe('Proyectar studio (WebGL smoke)', () => {
  test('abre el studio, renderiza canvas WebGL y inserta desde la biblioteca', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await enterAsGuest(page);
    await page.goto('/quotes');
    await page.waitForSelector('.app-sidebar', { timeout: 30_000 });

    // Abrir la cotización draft del seed ("Demo plantilla").
    const draftCard = page
      .locator('.project-card', { hasText: 'Demo plantilla' })
      .first();
    test.skip((await draftCard.count()) === 0, 'seed sin proyecto draft');
    await draftCard.click();
    await page.waitForSelector('.workspace-chrome, .project-detail', {
      timeout: 20_000,
    });

    // Abrir Proyectar.
    await page.waitForSelector('[data-testid="project-chrome-projectar"]', {
      timeout: 20_000,
    });
    await page.click('[data-testid="project-chrome-projectar"]');
    await page.waitForSelector('[data-testid="spatial-studio-sidebar"]', {
      timeout: 20_000,
    });

    // Canvas WebGL real (R3F monta <canvas> dentro del scene root del studio).
    await page.waitForSelector(
      '[data-testid="spatial-studio-scene"] canvas',
      { timeout: 45_000 },
    );

    // Biblioteca lateral presente con tarjetas del catálogo.
    await page.waitForSelector('[data-testid="module-library"]', {
      timeout: 20_000,
    });
    const firstCard = page
      .locator('[data-testid^="module-library-card-"]')
      .first();
    expect(await firstCard.count()).toBeGreaterThan(0);

    // Sin selección: el inspector derecho muestra las propiedades del ambiente.
    await page.waitForSelector('[data-testid="spatial-studio-space-name"]', {
      timeout: 10_000,
    });

    // Evidencia de screenshot review (design.md §8); test-results/ es gitignored.
    await page.screenshot({
      path: 'test-results/proyectar-studio-library.png',
      fullPage: false,
    });

    // Insert por click: el ítem se coloca en el muro activo (walls L seed).
    // El contador de ítems de la obra vive en la sub-pestaña "De la obra".
    const itemsTab = page.locator('[data-testid="spatial-studio-modules-tab-items"]');
    const countBefore = await itemsTab.textContent();
    await firstCard.click();
    await expect
      .poll(async () => await itemsTab.textContent(), { timeout: 20_000 })
      .not.toBe(countBefore ?? '');

    // El insert selecciona el mueble: el inspector pasa de ambiente a mueble.
    await page.waitForSelector('[data-testid="spatial-studio-dims"]', {
      timeout: 10_000,
    });

    // La sub-pestaña De la obra muestra la lista de ítems del proyecto.
    await itemsTab.click();
    await page.waitForSelector('[data-testid="spatial-studio-filter-all"]', {
      timeout: 10_000,
    });
  });
});
