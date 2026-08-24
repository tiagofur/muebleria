import { test, expect, type Page } from '@playwright/test';

/**
 * F148 / #314 (P3D-8) — smoke del script canónico del benchmark de usabilidad.
 *
 * Recorre las 11 tareas del script de #314 contra el seed demo con la UI real
 * (mismas vías que un usuario; las marcas de tarea son del facilitador, acá
 * vía window.__proyectarUsability y el panel). El objetivo es doble:
 *
 *   1. REGRESIÓN PERMANENTE: si una feature rompe un paso del script
 *      canónico (biblioteca → colocar → duplicar/alinear → dimensión →
 *      cajonera → materiales → ambientes → presentar → precio/BOM), este
 *      smoke falla;
 *   2. valida el kit de medición: eventos auto capturados en las costuras,
 *      sesión proxy persistida y exportable.
 *
 * Data truth: la sesión se inicia con source "proxy" — los tiempos de esta
 * corrida NO son evidencia de usuario (docs/proyectar-3d-usability-benchmark.md).
 * Escribe test-results/proyectar-usability-proxy.json (gitignored).
 */

type UsabilityEvent = {
  t: number;
  type: string;
  source: 'auto' | 'facilitator';
  taskId: string | null;
  detail?: Record<string, string | number | boolean | null>;
};

type UsabilitySessionJson = {
  version: number;
  tasksVersion: number;
  participant: string;
  source: 'real' | 'proxy';
  startedAt: number;
  endedAt: number | null;
  events: UsabilityEvent[];
  tasks: Record<
    string,
    {
      startedAt?: number;
      completedAt?: number;
      abandonedAt?: number;
      helpCount: number;
      errorCount: number;
    }
  >;
};

type UsabilityWindow = {
  __proyectarUsability: {
    begin: (participant: string, source: 'real' | 'proxy') => unknown;
    startTask: (taskId: string) => boolean;
    completeTask: (taskId: string) => boolean;
    end: () => unknown;
    snapshot: () => UsabilitySessionJson | null;
    exportJson: () => string | null;
  };
};

async function markStart(page: Page, taskId: string): Promise<void> {
  await page.evaluate((id) => {
    (window as unknown as UsabilityWindow).__proyectarUsability.startTask(id);
  }, taskId);
}

async function markComplete(page: Page, taskId: string): Promise<void> {
  await page.evaluate((id) => {
    (window as unknown as UsabilityWindow).__proyectarUsability.completeTask(id);
  }, taskId);
}

async function session(page: Page): Promise<UsabilitySessionJson> {
  const s = await page.evaluate(
    () => (window as unknown as UsabilityWindow).__proyectarUsability.snapshot(),
  );
  expect(s, 'sesión de benchmark activa').not.toBeNull();
  return s!;
}

/** Sub-tab "De la obra": las filas colocadas sólo renderizan ahí. */
async function countPlacedRows(page: Page): Promise<number> {
  await page.click('[data-testid="spatial-studio-modules-tab-items"]');
  const rows = page.locator('[data-testid^="spatial-studio-placed-"]');
  await rows.first().waitFor({ timeout: 10_000 });
  return rows.count();
}

async function openLibrary(page: Page): Promise<void> {
  await page.click('[data-testid="spatial-studio-modules-tab-library"]');
  await page.waitForSelector('[data-testid="module-library"]', {
    timeout: 10_000,
  });
}

/**
 * Drag HTML5 sintético (Playwright no maneja DnD nativo): dispara el
 * dragstart real del origen (el handler de la app escribe el payload en el
 * DataTransfer) y dragover+drop con clientX/clientY sobre el punto destino,
 * que el studio resuelve por raycast (módulo para tableros, superficie para
 * ambientales).
 */
async function html5DragTo(
  page: Page,
  sourceTestIdPrefix: string,
  sourceText: string,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ([prefix, text, px, py]) => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`),
      );
      const src = nodes.find((n) =>
        (n.textContent ?? '').toLowerCase().includes(String(text).toLowerCase()),
      );
      if (!src) {
        throw new Error(`drag source not found: ${prefix} ~ "${text}"`);
      }
      const target = document.elementFromPoint(Number(px), Number(py));
      if (!target) {
        throw new Error(`no element at drop point (${px}, ${py})`);
      }
      const dt = new DataTransfer();
      src.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: Number(px),
          clientY: Number(py),
          dataTransfer: dt,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: Number(px),
          clientY: Number(py),
          dataTransfer: dt,
        }),
      );
    },
    [sourceTestIdPrefix, sourceText, x, y],
  );
}

/** Eventos de un tipo atribuidos a una tarea. */
function taskEvents(
  s: UsabilitySessionJson,
  taskId: string,
  type: string,
): UsabilityEvent[] {
  return s.events.filter((e) => e.taskId === taskId && e.type === type);
}

const TASK_IDS = [
  'open-project',
  'find-module',
  'place-module',
  'duplicate-align',
  'edit-dimension',
  'add-aggregate',
  'apply-front-material',
  'apply-floor-material',
  'switch-space',
  'present',
  'verify-price-bom',
] as const;

const REQUIRED_EVENTS: Record<(typeof TASK_IDS)[number], readonly string[]> = {
  'open-project': ['click'],
  'find-module': ['library_search'],
  'place-module': ['insert', 'move_commit'],
  'duplicate-align': ['command', 'click'],
  'edit-dimension': ['dimension_edit'],
  'add-aggregate': ['library_search', 'insert'],
  'apply-front-material': ['material_boards_apply'],
  'apply-floor-material': ['material_ambient_apply'],
  'switch-space': ['space_switch'],
  present: ['present_open', 'present_close'],
  'verify-price-bom': ['bom_detail', 'click'],
};

test.describe('Proyectar usability benchmark — script canónico (#314 P3D-8)', () => {
  test('las 11 tareas del script se completan con la UI real y la sesión proxy queda capturada', async ({
    page,
  }) => {
    test.setTimeout(480_000);
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('muebles_session', 'guest');
        localStorage.setItem('muebles_usability_benchmark', '1');
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto('/quotes');
    await page.waitForSelector('.app-sidebar', { timeout: 30_000 });

    // El panel del facilitador está montado por el flag; la sesión arranca
    // ANTES de que el participante toque nada (source proxy: estos tiempos
    // no son evidencia de usuario).
    await page.waitForSelector('[data-testid="usability-panel"]', {
      timeout: 10_000,
    });
    await page.evaluate(() => {
      (window as unknown as UsabilityWindow).__proyectarUsability.begin(
        'proxy-agent',
        'proxy',
      );
    });

    // ── Tarea 1: abrir Cocina (proyecto demo → studio, ambiente Cocina) ────
    await markStart(page, 'open-project');
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
    await expect(
      page.locator('[data-testid="spatial-studio-space-name"]'),
    ).toHaveValue('Cocina');
    // T1 se completa DESDE EL PANEL del facilitador (wiring E2E del panel).
    await page.waitForSelector('[data-testid="usability-task-complete"]', {
      timeout: 10_000,
    });
    await page.click('[data-testid="usability-task-complete"]');
    // El panel no debe tapar la biblioteca durante el resto del script.
    await page
      .locator('[data-testid="usability-panel"]')
      .getByLabel('Ocultar panel del benchmark')
      .click();
    await page.waitForSelector('[data-testid="usability-toggle"]');

    // ── Tarea 2: encontrar "bajo 600" en la biblioteca ─────────────────────
    await markStart(page, 'find-module');
    const searchBox = page.getByRole('searchbox', {
      name: 'Buscar muebles en la biblioteca',
    });
    await searchBox.fill('bajo 600');
    const bajoCard = page
      .locator('[data-testid^="module-library-card-"]')
      .filter({ hasText: /bajo 600/i })
      .first();
    await expect(bajoCard).toBeVisible({ timeout: 10_000 });
    await markComplete(page, 'find-module');

    // ── Tarea 3: colocarlo en el muro (insert por click + drag de muro) ────
    await markStart(page, 'place-module');
    const placedRows = page.locator('[data-testid^="spatial-studio-placed-"]');
    await openLibrary(page);
    await bajoCard.click();
    await page.waitForSelector('[data-testid="spatial-studio-selection-bar"]', {
      timeout: 10_000,
    });
    await page.click('[data-testid="spatial-studio-cmd-fit"]');
    await page.waitForTimeout(500);
    // Reubicar por drag de muro (pipeline real de move → move_commit).
    const canvas = page.locator('[data-testid="spatial-studio-scene"] canvas');
    const box = (await canvas.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(center.x + i * 10, center.y, { steps: 2 });
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    // El proyecto demo arranca sin colocados: el insert crea la primera fila.
    const rowsAfterPlace = await countPlacedRows(page);
    expect(rowsAfterPlace).toBeGreaterThanOrEqual(1);
    await markComplete(page, 'place-module');

    // ── Tarea 4: duplicar y alinear la corrida (3 unidades) ────────────────
    await markStart(page, 'duplicate-align');
    // El insert selecciona el mueble: dos duplicados → corrida de 3.
    await page.click('[data-testid="spatial-studio-cmd-duplicate"]');
    await expect
      .poll(async () => placedRows.count(), { timeout: 20_000 })
      .toBe(rowsAfterPlace + 1);
    await page.click('[data-testid="spatial-studio-cmd-duplicate"]');
    await expect
      .poll(async () => placedRows.count(), { timeout: 20_000 })
      .toBe(rowsAfterPlace + 2);
    // Seleccionar todas las colocadas (la corrida nueva) y alinear en muro.
    const runTotal = await placedRows.count();
    await placedRows.nth(0).click();
    for (let i = 1; i < runTotal; i++) {
      await placedRows.nth(i).click({ modifiers: ['Meta'] });
    }
    await expect(
      page.locator('[data-testid="spatial-studio-selection-count"]'),
    ).toHaveText(`${runTotal} seleccionados`, { timeout: 10_000 });
    await page.click('[data-testid="spatial-studio-cmd-compact"]');
    await page.waitForTimeout(400);
    // Selección única para volver al inspector de mueble (la multi muestra
    // el panel de grupo, sin tabs de posición/props).
    await placedRows.nth(0).click();
    await page.waitForSelector('[data-testid="spatial-studio-dims"]', {
      timeout: 10_000,
    });
    await markComplete(page, 'duplicate-align');

    // ── Tarea 5: editar dimensión (a medida, F144) ─────────────────────────
    await markStart(page, 'edit-dimension');
    await page.click('[data-testid="spatial-studio-inspector-tab-props"]');
    const widthInput = page.locator('[data-testid="spatial-studio-dim-widthMm"]');
    await widthInput.waitFor({ timeout: 10_000 });
    await widthInput.fill('800');
    await widthInput.blur();
    await expect
      .poll(async () => widthInput.inputValue(), { timeout: 10_000 })
      .toBe('800');
    await markComplete(page, 'edit-dimension');

    // ── Recarga in-browser a mitad de sesión (#338 desbloqueado) ───────────
    // El loop de #338 (guest + selección + reload → ~55 remontajes/s, clicks
    // que nunca aterrizaban) lo cerró el contrato de selección del PR #342;
    // esta recarga es la regresión in-browser de esa familia. La sesión proxy
    // persiste en localStorage (unit: simulateUsabilityReloadForTests).
    await page.reload();
    await page.waitForSelector('.app-sidebar', { timeout: 30_000 });
    // El deep-link /quotes/:id sobrevive el reload: el detalle abre directo.
    await page.waitForSelector('[data-testid="project-chrome-projectar"]', {
      timeout: 20_000,
    });
    // La sesión de benchmark sobrevivió: las tareas completadas siguen ahí.
    const reloadedSession = await session(page);
    expect(reloadedSession.tasks['edit-dimension']?.completedAt).toBeTruthy();
    // El click post-reload aterriza (canary original de #338): reabrir el
    // studio y comprobar que la corrida colocada sobrevivió.
    await page.click('[data-testid="project-chrome-projectar"]');
    await page.waitForSelector('[data-testid="spatial-studio-scene"] canvas', {
      timeout: 45_000,
    });
    expect(await countPlacedRows(page)).toBe(runTotal);
    // El panel del facilitador vuelve expandido tras el reload: ocultarlo
    // para que no tape la biblioteca durante las tareas que siguen.
    await page
      .locator('[data-testid="usability-panel"]')
      .getByLabel('Ocultar panel del benchmark')
      .click();
    await page.waitForSelector('[data-testid="usability-toggle"]');

    // ── Tarea 6: añadir cajonera ───────────────────────────────────────────
    await markStart(page, 'add-aggregate');
    const rowsBeforeCajonera = await countPlacedRows(page);
    await openLibrary(page);
    await searchBox.fill('cajonera');
    const cajoneraCard = page
      .locator('[data-testid^="module-library-card-"]')
      .filter({ hasText: /cajonera/i })
      .first();
    await expect(cajoneraCard).toBeVisible({ timeout: 10_000 });
    await cajoneraCard.click();
    await countPlacedRows(page);
    await expect
      .poll(async () => placedRows.count(), { timeout: 20_000 })
      .toBe(rowsBeforeCajonera + 1);
    await markComplete(page, 'add-aggregate');

    // ── Tarea 7: aplicar material de tablero a los frentes (F142) ──────────
    await markStart(page, 'apply-front-material');
    await page.click('[data-testid="spatial-studio-tab-materials"]');
    await page.click('[data-testid="spatial-studio-materials-tab-boards"]');
    await page.waitForSelector('[data-testid^="board-palette-card-"]', {
      timeout: 10_000,
    });
    await page
      .locator('[data-testid="board-palette-scope"]')
      .selectOption('fronts');
    // Enfocar la selección para garantizar módulo bajo el centro del canvas.
    await page.click('[data-testid="spatial-studio-cmd-fit"]');
    await page.waitForTimeout(500);
    const boxB = (await canvas.boundingBox())!;
    await html5DragTo(
      page,
      'board-palette-card-',
      'MADERADO FRENTE',
      boxB.x + boxB.width / 2,
      boxB.y + boxB.height / 2,
    );
    await expect
      .poll(
        async () =>
          taskEvents(
            await session(page),
            'apply-front-material',
            'material_boards_apply',
          ).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(1);
    await markComplete(page, 'apply-front-material');

    // ── Tarea 8: cambiar el material del piso (F067 ambiental) ─────────────
    await markStart(page, 'apply-floor-material');
    await page.click('[data-testid="spatial-studio-materials-tab-ambient"]');
    await page.waitForSelector(
      '[data-testid^="spatial-studio-material-palette-chip-"]',
      { timeout: 10_000 },
    );
    // Encuadrar la habitación y probar puntos de la mitad inferior hasta que
    // el raycast resuelve el piso (los materiales ambientales sólo aplican
    // sobre su superficie: un drop sobre muro se ignora en silencio).
    await page.click('[data-testid="spatial-studio-cam-fit-room"]');
    await page.waitForTimeout(500);
    const boxF = (await canvas.boundingBox())!;
    const floorDrops: Array<[number, number]> = [
      [0.5, 0.8],
      [0.35, 0.85],
      [0.65, 0.82],
      [0.5, 0.68],
      [0.28, 0.72],
      [0.72, 0.75],
    ];
    let floorApplied = false;
    for (const [fx, fy] of floorDrops) {
      await html5DragTo(
        page,
        'spatial-studio-material-palette-chip-',
        'porcelanato',
        boxF.x + boxF.width * fx,
        boxF.y + boxF.height * fy,
      );
      const applied = await page.evaluate(() => {
        const s = (window as unknown as UsabilityWindow).__proyectarUsability.snapshot();
        return (
          s?.events.some(
            (e) =>
              e.taskId === 'apply-floor-material' &&
              e.type === 'material_ambient_apply' &&
              e.detail?.surface === 'floor',
          ) ?? false
        );
      });
      if (applied) {
        floorApplied = true;
        break;
      }
    }
    expect(floorApplied, 'el drop resolvió el piso y aplicó el material').toBe(
      true,
    );
    await markComplete(page, 'apply-floor-material');

    // ── Tarea 9: cambiar de ambiente y volver (F145) ───────────────────────
    await markStart(page, 'switch-space');
    const spaceName = page.locator('[data-testid="spatial-studio-space-name"]');
    await page.click('[data-testid="spatial-studio-add-space"]');
    await expect(spaceName).toHaveValue(/Espacio 2/, { timeout: 10_000 });
    await page
      .locator('[data-testid^="spatial-studio-space-tab-"]')
      .first()
      .click();
    await expect(spaceName).toHaveValue('Cocina', { timeout: 10_000 });
    await markComplete(page, 'switch-space');

    // ── Tarea 10: presentar (#260) ─────────────────────────────────────────
    await markStart(page, 'present');
    await page.click('[data-testid="spatial-studio-close"]');
    await page.waitForSelector('.workspace-chrome, .project-detail', {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'Presentar al cliente' })
      .click();
    await page.waitForSelector('[data-testid="project-presentation-mode"]', {
      timeout: 20_000,
    });
    await expect(
      page.locator('[data-testid="project-presentation-total"]'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.locator('[data-testid="project-presentation-mode"]'),
    ).toHaveCount(0, { timeout: 10_000 });
    await markComplete(page, 'present');

    // ── Tarea 11: verificar precio y BOM ───────────────────────────────────
    await markStart(page, 'verify-price-bom');
    await page.click('[data-testid="project-chrome-projectar"]');
    await page.waitForSelector('[data-testid="spatial-studio-scene"] canvas', {
      timeout: 45_000,
    });
    await expect(
      page.locator('[data-testid="spatial-studio-quote-total"]'),
    ).toBeVisible();
    // La pestaña lateral izquierda persiste entre aperturas del studio:
    // volver a "Muebles" antes de la lista de la obra.
    await page.click('[data-testid="spatial-studio-tab-modules"]');
    await page
      .locator('[data-testid="spatial-studio-modules-tab-items"]')
      .click();
    await placedRows.first().click();
    await page.waitForSelector('[data-testid="spatial-studio-dims"]', {
      timeout: 10_000,
    });
    await page.click('[data-testid="spatial-studio-detail-toggle"]');
    await page.waitForSelector(
      '[data-testid="spatial-studio-detail-hint"], [data-testid="spatial-studio-detail-card"]',
      { timeout: 10_000 },
    );
    await markComplete(page, 'verify-price-bom');

    // ── Gates: script completable + kit capturando ─────────────────────────
    await page.evaluate(() => {
      (window as unknown as UsabilityWindow).__proyectarUsability.end();
    });
    const final = await session(page);
    expect(final.source).toBe('proxy');
    expect(final.endedAt).not.toBeNull();
    expect(final.tasksVersion).toBe(1);

    for (const taskId of TASK_IDS) {
      const state = final.tasks[taskId];
      expect(
        state?.completedAt,
        `tarea ${taskId} completada por el facilitador`,
      ).toBeDefined();
      expect(state!.completedAt! - state!.startedAt!).toBeGreaterThan(0);
    }
    for (const [taskId, types] of Object.entries(REQUIRED_EVENTS)) {
      for (const type of types) {
        expect(
          taskEvents(final, taskId, type).length,
          `evento ${type} capturado en ${taskId}`,
        ).toBeGreaterThan(0);
      }
    }
    expect(
      final.events.filter((e) => e.type === 'click').length,
    ).toBeGreaterThan(0);

    const boardApply = taskEvents(
      final,
      'apply-front-material',
      'material_boards_apply',
    )[0]!.detail;
    expect(boardApply?.scope).toBe('fronts');

    // Evidencia: JSON proxy + screenshot (test-results/ es gitignored).
    const fs = await import('node:fs');
    const json = await page.evaluate(
      () =>
        (window as unknown as UsabilityWindow).__proyectarUsability.exportJson(),
    );
    expect(json).not.toBeNull();
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/proyectar-usability-proxy.json', json!);
    await page.screenshot({
      path: 'test-results/proyectar-usability-script.png',
      fullPage: false,
    });
  });
});
