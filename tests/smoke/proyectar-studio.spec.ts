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
      sessionStorage.setItem('granete_session', 'guest');
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

    // F142: dock de materiales con sub-tabs Ambiente|Tableros.
    await page.click('[data-testid="spatial-studio-tab-materials"]');
    await page.click('[data-testid="spatial-studio-materials-tab-boards"]');
    await page.waitForSelector('[data-testid="board-material-palette"]', {
      timeout: 10_000,
    });
    await page.waitForSelector('[data-testid^="board-palette-card-"]', {
      timeout: 10_000,
    });
    await page.screenshot({
      path: 'test-results/proyectar-boards-dock.png',
      fullPage: false,
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

/**
 * F144 (#310 E4): precisión + a medida + undo por intención en el studio real.
 * Nudge por teclado (con coalescing), dimensión a medida por ítem, Enfocar
 * selección y undo que restaura plano E ítem. Domain paths en unit; acá el
 * wiring E2E con WebGL real + screenshot review.
 */
test.describe('Proyectar studio (WebGL smoke F144)', () => {
  test('nudge por flechas, a medida, enfocar y undo por intención (F144)', async ({
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

    // Insertar un módulo (queda seleccionado con el inspector de mueble).
    const firstCard = page
      .locator('[data-testid^="module-library-card-"]')
      .first();
    await firstCard.click();
    await page.waitForSelector('[data-testid="spatial-studio-dims"]', {
      timeout: 10_000,
    });
    await page.waitForSelector('[data-testid="spatial-studio-selection-bar"]', {
      timeout: 10_000,
    });

    // Leer el offset actual desde el tab Posición (base del nudge).
    await page.click('[data-testid="spatial-studio-inspector-tab-position"]');
    const offsetInput = page.locator('[data-testid="spatial-studio-offset"]');
    await offsetInput.waitFor({ timeout: 10_000 });
    const before = Number(await offsetInput.inputValue());

    // Nudge ×3 con flechas (foco fuera de inputs): paso default 10 mm.
    // La ráfaga completa es UNA intención de undo.
    // Soltar el foco del tab (el roving tabindex de los tabs usa ←/→).
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(120);
    }
    await expect
      .poll(async () => Number(await offsetInput.inputValue()), {
        timeout: 10_000,
      })
      .toBe(before + 30);

    // Undo único restaura el offset original (coalescing de ráfaga).
    await page.click('[data-testid="spatial-studio-undo"]');
    await expect
      .poll(async () => Number(await offsetInput.inputValue()), {
        timeout: 10_000,
      })
      .toBe(before);

    // A medida (F144): ancho 800 mm commitea en blur como intención de ítem.
    await page.click('[data-testid="spatial-studio-inspector-tab-props"]');
    const widthInput = page.locator('[data-testid="spatial-studio-dim-widthMm"]');
    await widthInput.waitFor({ timeout: 10_000 });
    await widthInput.fill('800');
    await widthInput.blur();
    await expect
      .poll(async () => await widthInput.inputValue(), { timeout: 10_000 })
      .toBe('800');

    // Enfocar selección: acción de cámara sin errores en el canvas.
    await page.click('[data-testid="spatial-studio-cmd-fit"]');
    await page.waitForTimeout(400);

    await page.screenshot({
      path: 'test-results/proyectar-precision.png',
      fullPage: false,
    });

    // Undo restaura la medida (ítem snapshot) y el canvas sigue vivo.
    await page.click('[data-testid="spatial-studio-undo"]');
    await expect
      .poll(async () => await widthInput.inputValue(), { timeout: 10_000 })
      .not.toBe('800');
    await expect(
      page.locator('[data-testid="spatial-studio-scene"] canvas'),
    ).toHaveCount(1);
  });
});

/**
 * F145 (#311): environment authoring + multi-ambiente en el studio real.
 * Abrir muro → hueco de ventana con defaults; crear ambiente nuevo → agregar
 * muro sólo ahí; volver a Cocina sin mezcla de geometrías; toolbar Ajustar /
 * Ocultar muros. Caminos de dominio cubiertos en unit; acá el wiring WebGL.
 */
test.describe('Proyectar studio (WebGL smoke F145)', () => {
  test('authoring de muros/huecos + switch de ambientes sin mezcla (F145)', async ({
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

    // Ambiente activo inequívoco (Cocina default del seed) con muros L.
    const spaceName = page.locator('[data-testid="spatial-studio-space-name"]');
    await expect(spaceName).toHaveValue('Cocina');
    const wallButtons = page.locator('.spatial-studio__wall-btn');
    const cocinaWalls = await wallButtons.count();
    expect(cocinaWalls).toBeGreaterThan(0);

    // Authoring: abrir el primer muro y agregar una ventana (defaults).
    await wallButtons.first().click();
    await page.waitForSelector('[data-testid="spatial-studio-add-opening-window"]', {
      timeout: 10_000,
    });
    await page.click('[data-testid="spatial-studio-add-opening-window"]');
    await page.waitForSelector('[data-testid="spatial-studio-opening"]', {
      timeout: 10_000,
    });
    // La tarjeta del muro ahora informa el hueco.
    await expect(wallButtons.first()).toContainText('hueco');

    // Toolbar: Ajustar (fit room) y Ocultar muros (toggle presionado).
    await page.click('[data-testid="spatial-studio-cam-fit-room"]');
    const hideToggle = page.locator('[data-testid="spatial-studio-toggle-hide-walls"]');
    await hideToggle.click();
    await expect(hideToggle).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);

    // Multi-ambiente: crear Baño, agregar muro sólo ahí y volver sin mezcla.
    await page.click('[data-testid="spatial-studio-add-space"]');
    await expect(spaceName).toHaveValue(/Espacio 2/, { timeout: 10_000 });
    await page.waitForSelector('[data-testid="spatial-studio-add-wall"]', {
      timeout: 10_000,
    });
    await page.click('[data-testid="spatial-studio-add-wall"]');
    await expect
      .poll(async () => await wallButtons.count(), { timeout: 10_000 })
      .toBe(1);

    await page.screenshot({
      path: 'test-results/proyectar-multispace.png',
      fullPage: false,
    });

    // Volver a Cocina: los muros del ambiente original están intactos.
    const spacesTabs = page.locator(
      '[data-testid^="spatial-studio-space-tab-"]',
    );
    await spacesTabs.first().click();
    await expect(spaceName).toHaveValue('Cocina');
    await expect
      .poll(async () => await wallButtons.count(), { timeout: 10_000 })
      .toBe(cocinaWalls);
  });
});
