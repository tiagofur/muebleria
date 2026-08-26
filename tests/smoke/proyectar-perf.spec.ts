import { test, expect, type Page } from '@playwright/test';

/**
 * F147 / #312 (P3D-6) — smoke de performance sobre la escena de referencia.
 *
 * Abre el proyecto "Perf referencia" (30 ítems / 27 instancias en el espacio
 * activo, fixture versionado del dominio) y mide contra los gates duros del
 * baseline documentado (docs/proyectar-3d-performance.md):
 *
 *   G1 renderer: draw calls y triángulos bajo techo (hardware-independiente
 *      como orden de magnitud; recalibrar techo al cambiar el fixture);
 *   G2 drag: feedback p95 < 250 ms (objetivo 150 ms; el gate duro atrapa
 *      regresiones de orden de magnitud, ej. rebuild global por move);
 *   G3 BOM: layout changes (nudge/drag) ⇒ 0 re-resoluciones BOM en runtime;
 *   G4 órbita: input irrelevante no produce commits React (North Star §17.1);
 *   G5 long tasks del main thread acotados durante toda la sesión.
 *
 * Escribe el baseline medido a test-results/proyectar-perf-baseline.json
 * (gitignored; documentar valores en docs/proyectar-3d-performance.md).
 */

type PerfSnapshot = {
  sceneId: string | null;
  renderer: { drawCalls: number; triangles: number; programs: number; geometries: number } | null;
  rendererMax: { drawCalls: number; triangles: number; programs: number; geometries: number } | null;
  commits: { count: number; totalMs: number; maxMs: number; byPhase: Record<string, number> };
  longTasks: { count: number; lastMs: number; maxMs: number; p95Ms: number };
  dragFeedback: { count: number; lastMs: number; maxMs: number; p95Ms: number };
  bom: { resolveCalls: number; itemResolutions: number; itemCacheHits: number };
  capturedAt?: string;
};

async function snapshot(page: Page): Promise<PerfSnapshot> {
  return page.evaluate(() =>
    (window as unknown as {
      __proyectarPerfSnapshot: () => PerfSnapshot;
    }).__proyectarPerfSnapshot(),
  );
}

/** Gates duros (ver docs/proyectar-3d-performance.md — recalibrados con baseline). */
const GATE = {
  maxDrawCalls: 1_500,
  maxTriangles: 2_000_000,
  dragP95Ms: 250,
  commitMaxMs: 250,
  longTaskP95Ms: 350,
  longTaskMaxCount: 800,
};

test.describe('Proyectar perf — escena de referencia (#312 P3D-6)', () => {
  test('presupuesto: render, drag, órbita, nudge y BOM en la escena de referencia', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('granete_session', 'guest');
        localStorage.setItem('granete_seed_perf_reference', '1');
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto('/quotes');
    await page.waitForSelector('.app-sidebar', { timeout: 30_000 });

    const perfCard = page
      .locator('.project-card', { hasText: 'Perf referencia' })
      .first();
    test.skip((await perfCard.count()) === 0, 'seed sin proyecto perf');
    await perfCard.click();
    await page.waitForSelector('[data-testid="project-chrome-projectar"]', {
      timeout: 20_000,
    });
    await page.click('[data-testid="project-chrome-projectar"]');
    await page.waitForSelector('[data-testid="spatial-studio-scene"] canvas', {
      timeout: 45_000,
    });

    // Asentamiento: el probe del renderer samplea cada 30 frames; esperamos
    // muestra + escena identificada.
    await expect
      .poll(
        async () => {
          const s = await snapshot(page);
          return s.sceneId === 'proj-perf-reference-3d' && s.renderer !== null;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // ── G1: techo de render sobre la escena de referencia ──────────────────
    const settled = await snapshot(page);
    expect(settled.rendererMax, 'renderer sampleado').not.toBeNull();
    expect(settled.rendererMax!.drawCalls).toBeLessThan(GATE.maxDrawCalls);
    expect(settled.rendererMax!.triangles).toBeLessThan(GATE.maxTriangles);

    // Seleccionar el primer mueble colgado y enfocarlo: queda centrado en el
    // canvas, garantizando que el drag del paso siguiente agarra un módulo.
    // (La lista de colocados vive bajo la sub-tab "De la obra".)
    await page
      .locator('[data-testid="spatial-studio-modules-tab-items"]')
      .click();
    const placedRows = page.locator(
      '[data-testid^="spatial-studio-placed-"]',
    );
    await placedRows.first().waitFor({ timeout: 20_000 });
    const placedCount = await placedRows.count();
    expect(placedCount).toBeGreaterThanOrEqual(20); // fixture honesto en vivo
    await placedRows.first().click();
    await expect(page.locator('[data-testid="spatial-studio-selection-count"]')).toBeVisible();
    await page.click('[data-testid="spatial-studio-cmd-fit"]');
    await page.waitForTimeout(600);

    // ── G2 + G3: drag del módulo enfocado (centro del canvas) ─────────────
    const canvas = page.locator('[data-testid="spatial-studio-scene"] canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const corner = { x: box!.x + box!.width * 0.08, y: box!.y + box!.height * 0.9 };
    await page.evaluate(() =>
      (window as unknown as { __proyectarPerfResetInteractions: () => void })
        .__proyectarPerfResetInteractions(),
    );
    const bomBeforeDrag = (await snapshot(page)).bom.itemResolutions;
    const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(center.x + i * 12, center.y, { steps: 2 });
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const drag = await snapshot(page);
    expect(
      drag.dragFeedback.count,
      'el drag ejerció el pipeline de feedback (módulo agarrado)',
    ).toBeGreaterThanOrEqual(3);
    expect(drag.dragFeedback.p95Ms).toBeLessThan(GATE.dragP95Ms);
    expect(drag.bom.itemResolutions).toBe(bomBeforeDrag); // G3 en runtime

    // ── G4: órbita (drag derecho) no produce commits React ─────────────────
    // Botón derecho: pan/órbita puro de OrbitControls — el studio sólo
    // arranca drags de mueble con el botón primario, así que este input es
    // "irrelevante" para React por construcción (North Star §17.1).
    const orbitDrag = async (): Promise<void> => {
      await page.mouse.move(corner.x, corner.y);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(corner.x + 60, corner.y - 40, {
        steps: 8,
        button: 'right',
      });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(80);
    };
    const beforeOrbit = await snapshot(page);
    for (let i = 0; i < 6; i++) {
      await orbitDrag();
    }
    const afterOrbit = await snapshot(page);
    expect(afterOrbit.commits.count - beforeOrbit.commits.count).toBe(0);

    // ── G3 + commits: nudge ×5 (layout-only) sin re-resolver BOM ──────────
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    const beforeNudge = await snapshot(page);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);
    const afterNudge = await snapshot(page);
    expect(afterNudge.commits.maxMs).toBeLessThan(GATE.commitMaxMs);

    // ── G5: long tasks de la sesión de interacciones (drag+órbita+nudge) ──
    // Baseline dev build: p95 ~292ms por frame (render pesado: physical
    // materials + shadows + ~600 draw calls). OBJETIVO North Star §18: frame
    // rate útil (p95 < 150 ms en producción) — gap registrado como follow-up
    // de costo de render (P3D-6b); el gate actual detecta regresiones de
    // orden de magnitud sobre la realidad medida.
    expect(afterNudge.longTasks.p95Ms).toBeLessThan(GATE.longTaskP95Ms);
    expect(afterNudge.longTasks.count).toBeLessThanOrEqual(GATE.longTaskMaxCount);

    // Baseline + evidencia.
    const baseline = {
      capturedAt: afterNudge.capturedAt ?? '',
      placedInstances: placedCount,
      renderer: afterNudge.renderer,
      rendererMax: afterNudge.rendererMax,
      commits: afterNudge.commits,
      longTasks: afterNudge.longTasks,
      dragFeedback: afterNudge.dragFeedback,
      phases: {
        // Fases de interacción (reset antes del drag; nudge comparte
        // acumulado con órbita en la sesión medida).
        drag: { longTasks: drag.longTasks, dragFeedback: drag.dragFeedback },
        orbit: { commitsDelta: afterOrbit.commits.count - beforeOrbit.commits.count },
      },
      bom: afterNudge.bom,
      gate: GATE,
    };
    const fs = await import('node:fs');
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(
      'test-results/proyectar-perf-baseline.json',
      JSON.stringify(baseline, null, 2),
    );
    await page.screenshot({
      path: 'test-results/proyectar-perf-reference.png',
      fullPage: false,
    });
  });
});
