import { test, expect, type Page } from '@playwright/test';

/**
 * #444 — Proyectar: deterministic WebGL visual regression gate.
 *
 * Exercises the **real WebGL editor canvas** (R3F/three FurnitureScene3D)
 * via Playwright. Each scenario captures the canvas region of the page and
 * compares it against a committed baseline.
 *
 * Determinism measures:
 *  - "proyectar-webgl" Playwright project: Chromium + SwiftShader (CPU GL)
 *    so local macOS and CI Linux rasterize identical canvas pixels; baselines
 *    are platform-agnostic (single set, no -darwin/-linux suffix)
 *  - fixed viewport 1280×800, deviceScaleFactor 1
 *  - reducedMotion to kill CSS transitions/animations
 *  - deterministic camera pose via "fit room" button (instant, no tween)
 *  - canonical seed fixture ("Demo plantilla" draft project, guest mode)
 *  - DOM chrome over the viewport (toolbars, chips, labels) is hidden with
 *    test-injected CSS before capture, so baselines contain WebGL pixels only
 *  - networkidle + bounded render settle before every capture
 *
 * Known external input: lighting mode "present" (product default) loads the
 * drei `warehouse` HDR from the pmndrs assets CDN; baselines bake those bytes,
 * and a CDN change shows up as an intentional diff to review.
 *
 * Baselines: committed in `tests/visual/proyectar-webgl.spec.ts-snapshots/`.
 *
 * Update after intentional visual change (requires visual review of the diff):
 *   pnpm exec playwright test --config=playwright.config.ts \
 *     tests/visual/proyectar-webgl.spec.ts --update-snapshots
 *
 * Run the gate:
 *   pnpm exec playwright test --config=playwright.config.ts \
 *     tests/visual/proyectar-webgl.spec.ts
 */

// ── Determinism config ──────────────────────────────────────────────────────

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});

// Drag MIME types the studio canvas recognizes (paintMaterial.ts).
const LIBRARY_MIME = 'application/x-muebles-library';
const BOARD_PAINT_MIME = 'application/x-muebles-board-paint';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Enter the app as guest (local seed workspace) before first navigation. */
async function enterAsGuest(page: Page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('granete_session', 'guest');
    } catch {
      /* sessionStorage unavailable */
    }
  });
}

/** Wait for the Proyectar studio canvas to be ready (R3F mounted + WebGL). */
async function waitForStudioCanvas(page: Page) {
  await page.waitForSelector('.app-sidebar', { timeout: 30_000 });
  await page.waitForSelector(
    '[data-testid="spatial-studio-scene"] canvas',
    { timeout: 45_000 },
  );
}

/**
 * Settle the canvas: wait for async asset loading (environment HDR, textures)
 * and render loop convergence before screenshot capture.
 */
async function settleCanvas(page: Page) {
  // Allow the dev server and async resources to reach networkidle.
  await page.waitForLoadState('networkidle');
  // Wait for three animation frames to flush pending renders.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames++;
          if (frames >= 3) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  // Allow WebGL material/texture uploads and environment map to finalize.
  await page.waitForTimeout(800);
}

/** Open the "Demo plantilla" draft project and launch the Proyectar studio. */
async function openStudio(page: Page) {
  await enterAsGuest(page);
  await page.goto('/quotes');
  const draftCard = page
    .locator('.project-card', { hasText: 'Demo plantilla' })
    .first();
  // The guest workspace seeds and loads async — wait for the seed card
  // instead of racing it, and skip only if it is genuinely absent.
  const hasSeed = await draftCard
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!hasSeed, 'seed sin proyecto draft');
  await draftCard.click();
  await page.waitForSelector('.workspace-chrome, .project-detail', {
    timeout: 20_000,
  });
  await page.waitForSelector('[data-testid="project-chrome-projectar"]', {
    timeout: 20_000,
  });
  await page.click('[data-testid="project-chrome-projectar"]');
  await waitForStudioCanvas(page);
}

/** Click the "fit room" camera button and wait for the camera to settle. */
async function fitCamera(page: Page) {
  // Click via evaluate: viewport chrome may be hidden by the test CSS and
  // hidden elements never receive real pointer events.
  await page
    .locator('[data-testid="spatial-studio-cam-fit-room"]')
    .evaluate((el) => (el as HTMLElement).click());
  // Camera position is set instantly (no tween); one frame is enough.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => r())),
  );
  await page.waitForTimeout(200);
}

/**
 * Hide every DOM element overlaying the studio viewport (toolbars, chips,
 * measurement labels) except the WebGL canvas, so captures contain canvas
 * pixels only. `visibility: hidden` keeps layout intact (the canvas bbox does
 * not move) and the CSS is injected by the test — no product seam, no masks.
 *
 * Must run AFTER the last toolbar/sidebar interaction (hidden elements don't
 * receive pointer events); synthetic drag events dispatched via `evaluate`
 * are unaffected.
 */
async function hideSceneChrome(page: Page) {
  await page.addStyleTag({
    content: `
      [data-testid="spatial-studio-viewport"] :not(canvas) { visibility: hidden !important; }
      [data-testid="spatial-studio-viewport"] canvas { visibility: visible !important; }
    `,
  });
}

/** Capture only the canvas element (excludes DOM chrome). */
const canvas = (page: Page) =>
  page.locator('[data-testid="spatial-studio-scene"] canvas');

/**
 * Raw canvas-region capture (page clip). Callers compare the returned
 * buffer against a baseline so both positive and negated assertions share
 * one capture path.
 */
async function captureCanvasFrame(page: Page) {
  const box = await canvas(page).boundingBox();
  expect(box, 'studio canvas must be visible').not.toBeNull();
  return page.screenshot({
    clip: { x: box!.x, y: box!.y, width: box!.width, height: box!.height },
  });
}

/** Capture the canvas region and require it to match its baseline. */
async function captureCanvasScene(page: Page, name: string) {
  const shot = await captureCanvasFrame(page);
  await expect(shot).toMatchSnapshot(name, { maxDiffPixelRatio: 0.002 });
}

/**
 * Insert the first library card and wait for its auto-selection to confirm.
 * Pass `state: 'attached'` when viewport chrome is hidden (the selection
 * indicators mount inside the viewport and are invisible to Playwright's
 * default visibility-aware waits).
 */
async function insertFirstLibraryCard(
  page: Page,
  state: 'visible' | 'attached' = 'visible',
) {
  const firstCard = page
    .locator('[data-testid^="module-library-card-"]')
    .first();
  await firstCard.waitFor({ timeout: 20_000 });
  await firstCard.click();
  await page.waitForSelector('[data-testid="spatial-studio-selection-bar"]', {
    state,
    timeout: 20_000,
  });
  await page.waitForSelector('[data-testid="spatial-studio-dims"]', {
    state,
    timeout: 10_000,
  });
}

// ── Scenario 1 — Empty room ─────────────────────────────────────────────────

test.describe('Proyectar visual regression (WebGL)', () => {
  test('empty room — baseline of the canonical seed scene', async ({ page }) => {
    test.setTimeout(120_000);
    await openStudio(page);
    await fitCamera(page);
    await hideSceneChrome(page);
    await settleCanvas(page);
    await captureCanvasScene(page, 'empty-room.png');
  });

  // ── Scenario 2 — Inserted cabinet ─────────────────────────────────────────

  test('inserted cabinet — first library card placed on the active wall', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openStudio(page);

    // Insert the first catalog module via click (creates + auto-selects).
    await insertFirstLibraryCard(page);

    // Fit the camera to the room so the cabinet is visible in the viewport.
    await fitCamera(page);

    // Deselect: Escape clears the selection so we capture the unselected state.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await hideSceneChrome(page);
    await settleCanvas(page);
    await captureCanvasScene(page, 'inserted-cabinet.png');
  });

  // ── Scenario 3 — Selected cabinet ─────────────────────────────────────────

  test('selected cabinet — selection highlight and inspector', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openStudio(page);

    // Insert first card (the insert auto-selects it).
    await insertFirstLibraryCard(page);

    await fitCamera(page);
    await hideSceneChrome(page);
    await settleCanvas(page);
    await captureCanvasScene(page, 'selected-cabinet.png');
  });

  // ── Scenario 4 — Material change ──────────────────────────────────────────

  test('material change — board palette drag applies a new finish', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openStudio(page);

    // Insert first card (auto-selects).
    await insertFirstLibraryCard(page);

    // Fit camera to center the selected cabinet in the viewport so the
    // raycast from the canvas center hits the module.
    await page.click('[data-testid="spatial-studio-cmd-fit"]');
    await page.waitForTimeout(400);

    // Open Materials → Boards sub-tab.
    await page.click('[data-testid="spatial-studio-tab-materials"]');
    await page.click('[data-testid="spatial-studio-materials-tab-boards"]');
    await page.waitForSelector('[data-testid="board-material-palette"]', {
      timeout: 10_000,
    });

    // Grab the first palette card's material ID.
    const boardCard = page
      .locator('[data-testid^="board-palette-card-"]')
      .first();
    await boardCard.waitFor({ timeout: 10_000 });
    const cardTestId = await boardCard.getAttribute('data-testid');
    const materialId = cardTestId!.replace('board-palette-card-', '');

    // Dispatch a synthetic HTML5 drop on the canvas wrap div with the
    // BOARD_PAINT_DRAG_MIME.  The canvas resolves the module under the
    // cursor via raycast; at the center of the viewport the inserted
    // cabinet is the only target.
    const canvasWrap = page.locator(
      '.module-scene-3d__canvas-wrap',
    );
    const box = await canvasWrap.boundingBox();
    expect(box, 'canvas wrap must be visible').not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    await canvasWrap.evaluate(
      (el, { cx, cy, mime, materialId }) => {
        // A real DataTransfer populated via setData() is required: assigning
        // a mock `types` array throws on modern Chromium (getter-only).
        const dt = new DataTransfer();
        dt.setData(mime, JSON.stringify({ materialId }));
        dt.effectAllowed = 'copy';
        dt.dropEffect = 'copy';

        // dragover first (needed for the canvas to accept the drop)
        el.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            clientX: cx,
            clientY: cy,
            dataTransfer: dt,
          }),
        );

        // drop
        el.dispatchEvent(
          new DragEvent('drop', {
            bubbles: true,
            clientX: cx,
            clientY: cy,
            dataTransfer: dt,
          }),
        );
      },
      { cx, cy, mime: BOARD_PAINT_MIME, materialId },
    );

    // Wait for the status message confirming the apply.
    await expect
      .poll(
        async () => {
          const el = page.locator('[data-testid="board-palette-status"]');
          return (await el.count()) > 0 ? await el.textContent() : null;
        },
        { timeout: 10_000 },
      )
      .toMatch(/aplicado/i);

    // Deselect and fit room camera for a clean capture.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await fitCamera(page);
    await hideSceneChrome(page);
    await settleCanvas(page);
    await captureCanvasScene(page, 'material-change.png');
  });

  // ── Scenario 5 — Placement / snap feedback ────────────────────────────────

  test('placement feedback — ghost preview during library drag', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openStudio(page);
    await fitCamera(page);

    // Wait for the library to be ready.
    await page.waitForSelector('[data-testid="module-library"]', {
      timeout: 20_000,
    });

    // Grab a library card for its drag payload.
    const libCard = page
      .locator('[data-testid^="module-library-card-"]')
      .first();
    await libCard.waitFor({ timeout: 20_000 });
    const libTestId = await libCard.getAttribute('data-testid');
    const moduleId = libTestId!.replace('module-library-card-', '');

    // Chrome off before the drag: the ghost must be captured without any DOM
    // overlay, and the synthetic dragover below needs no hit-testing.
    await hideSceneChrome(page);

    // Use the canonical dimensions for a typical cabinet in the Demo plantilla
    // seed fixture.  The scene will render the ghost at these exact dims,
    // making the screenshot deterministic regardless of catalog order.
    const moduleDims = { widthMm: 600, heightMm: 720, depthMm: 580 };

    const canvasWrap = page.locator(
      '.module-scene-3d__canvas-wrap',
    );
    const box = await canvasWrap.boundingBox();
    expect(box, 'canvas wrap must be visible').not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const libraryPayload = JSON.stringify({
      moduleId,
      widthMm: moduleDims.widthMm,
      heightMm: moduleDims.heightMm,
      depthMm: moduleDims.depthMm,
    });

    // Settle the scene BEFORE the drag: the ghost state is transient React
    // state, so the capture must happen promptly after the dragover.
    await settleCanvas(page);

    // Replay the editor's real drag chain with synthetic events carrying a
    // real DataTransfer (a mock `types` array throws on modern Chromium):
    //   1. dragstart on the library card registers the ghost drag state;
    //   2. dragover on the canvas resolves the placement hit under the
    //      cursor, which makes the in-scene ghost preview render.
    await libCard.evaluate(
      (el, { mime, payload }) => {
        const dt = new DataTransfer();
        dt.setData(mime, payload);
        dt.effectAllowed = 'copy';
        el.dispatchEvent(
          new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }),
        );
      },
      { mime: LIBRARY_MIME, payload: libraryPayload },
    );
    await canvasWrap.evaluate(
      (el, { cx, cy, mime, payload }) => {
        const dt = new DataTransfer();
        dt.setData(mime, payload);
        dt.effectAllowed = 'copy';
        dt.dropEffect = 'copy';
        el.dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            clientX: cx,
            clientY: cy,
            dataTransfer: dt,
          }),
        );
      },
      { cx, cy, mime: LIBRARY_MIME, payload: libraryPayload },
    );

    // Give React time to commit the ghost and present the frame.
    await page.waitForTimeout(600);
    await captureCanvasScene(page, 'snap-feedback.png');

    // Clean up: dragleave clears the hover/ghost hit, dragend on the card
    // clears the ghost drag state.
    await canvasWrap.evaluate((el) => {
      el.dispatchEvent(
        new DragEvent('dragleave', {
          bubbles: true,
          dataTransfer: new DataTransfer(),
        }),
      );
    });
    await libCard.evaluate((el) => {
      el.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer: new DataTransfer() }),
      );
    });
  });

  // ── Known-regression proof ────────────────────────────────────────────────
  //
  // #444 requires evidence that the gate catches a real visual regression.
  // Controlled test-only perturbation: the unperturbed scene must match the
  // committed empty-room baseline, and inserting a cabinet (geometry change)
  // must make that same comparison detect the delta. Product code is never
  // modified.

  test('known-regression proof — inserted geometry fails the empty-room baseline', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openStudio(page);
    await fitCamera(page);
    await hideSceneChrome(page);
    await settleCanvas(page);

    // Sanity: the canonical empty scene matches its committed baseline.
    await captureCanvasScene(page, 'empty-room.png');

    // Perturb: insert a cabinet via the sidebar card (the sidebar is outside
    // the CSS-hidden viewport, so the click still works) and wait for the
    // auto-selection with an attached-state wait (the selection indicators
    // mount inside the viewport, hidden by the test CSS). Then require the
    // same baseline comparison to detect the delta. The negated snapshot
    // matcher passes only when pixels differ beyond the threshold — and it
    // never writes baselines, so --update-snapshots cannot corrupt this.
    await insertFirstLibraryCard(page, 'attached');
    await fitCamera(page);
    await settleCanvas(page);
    const perturbed = await captureCanvasFrame(page);
    await expect(perturbed).not.toMatchSnapshot('empty-room.png', {
      maxDiffPixelRatio: 0.002,
    });
  });
});
