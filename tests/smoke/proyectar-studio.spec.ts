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

  /**
   * F143 (#310): multi-selección + comandos de productividad en el studio real.
   * Multi-select Ctrl+click por la lista "De la obra", barra contextual con N,
   * Duplicar (quantity+1 + copia colocada) y limpieza con Escape. Los caminos
   * de dominio se cubren en unit; acá se prueba el wiring E2E con WebGL real.
   */
  test('multi-selección Ctrl+click, barra de acciones y duplicar (F143)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await enterAsGuest(page);
    await page.goto('/quotes');
    await page.waitForSelector('.app-sidebar', { timeout: 30_000 });

    const draftCard = page
      .locator('.project-card', { hasText: 'Demo plantilla' })
      .first();
    test.skip((await draftCard.count()) === 0, 'seed sin proyecto draft');
    await draftCard.click();
    await page.waitForSelector('.workspace-chrome, .project-detail', {
      timeout: 20_000,
    });
    await page.click('[data-testid="project-chrome-projectar"]');
    await page.waitForSelector('[data-testid="spatial-studio-scene"] canvas', {
      timeout: 45_000,
    });

    // Insertar dos módulos desde la biblioteca (muro activo del seed).
    const firstCard = page
      .locator('[data-testid^="module-library-card-"]')
      .first();
    const itemsTab = page.locator('[data-testid="spatial-studio-modules-tab-items"]');
    for (let i = 0; i < 2; i++) {
      await firstCard.click();
      // esperar a que la lista de ítems registre el insert antes del siguiente
      await page.waitForTimeout(400);
    }
    await itemsTab.click();
    await page.waitForSelector('[data-testid="spatial-studio-filter-all"]', {
      timeout: 10_000,
    });

    // Los inserts seleccionan el último mueble → la barra está visible.
    await page.waitForSelector('[data-testid="spatial-studio-selection-bar"]', {
      timeout: 10_000,
    });

    // Multi-select: los dos últimos colocados con Cmd/Ctrl+click.
    // (En macOS Chromium, Ctrl+click abre el menú contextual: usamos Meta,
    // que el studio trata igual que Ctrl vía ctrlOrMeta.)
    const placedRows = page.locator('[data-testid^="spatial-studio-placed-"]');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="spatial-studio-placed-"]')
          .length >= 2,
      { timeout: 20_000 },
    );
    const rowCount = await placedRows.count();
    await placedRows.nth(rowCount - 2).click();
    await placedRows.nth(rowCount - 1).click({ modifiers: ['Meta'] });
    await expect(
      page.locator('[data-testid="spatial-studio-selection-count"]'),
    ).toHaveText('2 seleccionados', { timeout: 10_000 });

    // Inspector contextual de selección múltiple.
    await page.waitForSelector('[data-testid="spatial-studio-multi-panel"]', {
      timeout: 10_000,
    });

    // Alinear (compactar la corrida del muro): aplica o rechaza enseñando,
    // pero el comando corre E2E sin romper el studio.
    await page.click('[data-testid="spatial-studio-cmd-compact"]');
    await expect(
      page.locator('[data-testid="spatial-studio-selection-bar"]'),
    ).toHaveCount(1, { timeout: 10_000 });

    await page.screenshot({
      path: 'test-results/proyectar-multiselect.png',
      fullPage: false,
    });

    // Duplicar la selección de 2: quantity+1 por ítem y 2 copias nuevas
    // colocadas (y seleccionadas) — el plano crece de rowCount a rowCount+2.
    await page.click('[data-testid="spatial-studio-cmd-duplicate"]');
    await expect
      .poll(async () => await placedRows.count(), { timeout: 20_000 })
      .toBe(rowCount + 2);
    await expect(
      page.locator('[data-testid="spatial-studio-selection-count"]'),
    ).toHaveText('2 seleccionados', { timeout: 10_000 });

    // Escape limpia la selección (la barra desaparece) sin cerrar el studio.
    await page.keyboard.press('Escape');
    await expect(
      page.locator('[data-testid="spatial-studio-selection-bar"]'),
    ).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="spatial-studio-scene"] canvas'),
    ).toHaveCount(1);
  });
});
