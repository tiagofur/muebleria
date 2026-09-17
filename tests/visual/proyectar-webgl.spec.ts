import { test, expect, type Page } from '@playwright/test';
import { createSeedWorkspace } from '@granete/storage';

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
  contextOptions: {
    reducedMotion: 'reduce',
  },
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
      // #729: the #444 visual gate exercises the preserved direct path;
      // demo builds keep every Proyectar entry hidden.
      sessionStorage.setItem('granete_proyectar_visible', '1');
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

  // ── Scenario 7 — #670-C Point 10: Real WebGL Assembly Resolution ─────────

  test('Point 10: WebGL real — FixtureDrawerSystem W=600 -> W=800 live scene graph mutation', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('404')) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
    });

    const customWs = createDrawerAssemblySeedWorkspace();
    await page.addInitScript((wsJson) => {
      try {
        sessionStorage.setItem('granete_session', 'guest');
        sessionStorage.setItem('granete_proyectar_visible', '1');
        localStorage.setItem('granete_guest_workspace', wsJson);
        localStorage.setItem('muebles_workspace_v1', wsJson);
      } catch {
        /* storage unavailable */
      }
    }, JSON.stringify(customWs));

    // 1. Abrir Proyectar
    await page.goto('/quotes');
    const draftCard = page
      .locator('.project-card', { hasText: 'Demo plantilla' })
      .first();
    await draftCard.waitFor({ timeout: 20_000 });
    await draftCard.click();
    await page.waitForSelector('.workspace-chrome, .project-detail', {
      timeout: 20_000,
    });
    await page.waitForSelector('[data-testid="project-chrome-projectar"]', {
      timeout: 20_000,
    });
    await page.click('[data-testid="project-chrome-projectar"]');
    await waitForStudioCanvas(page);

    // 2. Insertar primer módulo del catálogo (pre-configurado con DrawerSystem)
    await insertFirstLibraryCard(page);
    await fitCamera(page);
    await settleCanvas(page);

    type SceneMemberInfo = {
      assemblyInstanceId: string;
      posX: number;
      posY: number;
      posZ: number;
      scale: [number, number, number];
      det: number;
      worldMatrix: number[];
      memberId: string;
      hardwareId: string;
      assetRevisionId: string;
      renderStatus: string;
    };

    type SceneBottomInfo = {
      size: [number, number, number];
      description: string;
    };

    type SceneQueryResult = {
      leftMember: SceneMemberInfo | null;
      rightMember: SceneMemberInfo | null;
      bottomComponent: SceneBottomInfo | null;
      allUserData: any[];
      count: number;
    };

    // 3. Helper de consulta programática del grafo Three.js
    const queryScene = async (): Promise<SceneQueryResult | null> => {
      return page.evaluate<SceneQueryResult | null>(() => {
        const scene = (window as any).__graneteScene;
        if (!scene) return null;

        let leftMember: SceneMemberInfo | null = null;
        let rightMember: SceneMemberInfo | null = null;
        let bottomComponent: SceneBottomInfo | null = null;

        scene.traverse((obj: any) => {
          if (obj.userData?.memberId === 'runner-left') {
            obj.updateMatrix();
            obj.updateWorldMatrix(true, true);
            leftMember = {
              assemblyInstanceId: obj.userData.assemblyInstanceId ?? '',
              posX: obj.position.x,
              posY: obj.position.y,
              posZ: obj.position.z,
              scale: [obj.scale.x, obj.scale.y, obj.scale.z],
              det: obj.matrix.determinant(),
              worldMatrix: Array.from(obj.matrixWorld.elements as number[]),
              memberId: obj.userData.memberId,
              hardwareId: obj.userData.hardwareId,
              assetRevisionId: obj.userData.assetRevisionId ?? '',
              renderStatus: obj.userData.renderStatus ?? '',
            };
          }
          if (obj.userData?.memberId === 'runner-right') {
            obj.updateMatrix();
            obj.updateWorldMatrix(true, true);
            rightMember = {
              assemblyInstanceId: obj.userData.assemblyInstanceId ?? '',
              posX: obj.position.x,
              posY: obj.position.y,
              posZ: obj.position.z,
              scale: [obj.scale.x, obj.scale.y, obj.scale.z],
              det: obj.matrix.determinant(),
              worldMatrix: Array.from(obj.matrixWorld.elements as number[]),
              memberId: obj.userData.memberId,
              hardwareId: obj.userData.hardwareId,
              assetRevisionId: obj.userData.assetRevisionId ?? '',
              renderStatus: obj.userData.renderStatus ?? '',
            };
          }
          if (obj.userData?.description === 'comp-bottom-panel' && obj.userData?.size) {
            bottomComponent = {
              size: obj.userData.size,
              description: obj.userData.description,
            };
          }
        });

        const allUserData: any[] = [];
        scene.traverse((obj: any) => {
          if (obj.userData && Object.keys(obj.userData).length > 0) {
            allUserData.push({ type: obj.type, userData: obj.userData });
          }
        });

        return { leftMember, rightMember, bottomComponent, allUserData, count: scene.children.length };
      });
    };

    // Esperar a que los miembros del assembly aparezcan en el canvas WebGL
    await expect
      .poll(async () => {
        const data = await queryScene();
        return Boolean(data?.leftMember && data?.rightMember && data?.bottomComponent);
      }, { timeout: 20_000 })
      .toBe(true);

    const initial = (await queryScene())!;
    expect(initial.leftMember).not.toBeNull();
    expect(initial.rightMember).not.toBeNull();
    expect(initial.bottomComponent).not.toBeNull();

    // Verificaciones W=600 inicial:
    // assemblyInstanceId estable
    expect(initial.leftMember!.assemblyInstanceId).toBe('inst-drawer-1');
    expect(initial.rightMember!.assemblyInstanceId).toBe('inst-drawer-1');

    // runners visibles con hardwareId 'runner-500' y visual pins exactos
    expect(initial.leftMember!.memberId).toBe('runner-left');
    expect(initial.rightMember!.memberId).toBe('runner-right');
    expect(initial.leftMember!.hardwareId).toBe('runner-500');
    expect(initial.rightMember!.hardwareId).toBe('runner-500');
    expect(initial.leftMember!.assetRevisionId).toBe('rev-runner-500');
    expect(initial.rightMember!.assetRevisionId).toBe('rev-runner-500');
    expect(initial.leftMember!.renderStatus).toBe('exact');
    expect(initial.rightMember!.renderStatus).toBe('exact');

    // world matrix programmatically captured
    expect(initial.leftMember!.worldMatrix).toHaveLength(16);
    expect(initial.rightMember!.worldMatrix).toHaveLength(16);

    // scale [1,1,1] y det +1
    expect(initial.leftMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(initial.leftMember!.scale[1]).toBeCloseTo(1.0, 4);
    expect(initial.leftMember!.scale[2]).toBeCloseTo(1.0, 4);
    expect(initial.leftMember!.det).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.scale[1]).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.scale[2]).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.det).toBeCloseTo(1.0, 4);
    // bottom ancho = 600 - 35 = 565 mm
    expect(initial.bottomComponent!.size[0]).toBeCloseTo(565, 1);
    expect(initial.bottomComponent!.size[1]).toBeCloseTo(15, 1); // thickness 15mm autoritativo

    // 4. Actualizar W=800 mediante el input de Ancho
    const widthInput = page.locator('label:has-text("Ancho") input');
    await widthInput.waitFor({ timeout: 10_000 });
    await widthInput.fill('800');
    await widthInput.press('Enter');

    // 5. Esperar escena estable con ancho actualizado
    await expect
      .poll(async () => {
        const data = await queryScene();
        return data?.bottomComponent?.size[0];
      }, { timeout: 20_000 })
      .toBeCloseTo(765, 1);

    await settleCanvas(page);

    // 6. Volver a capturar estado en W=800
    const updated = (await queryScene())!;

    // Aserciones obligatorias:
    // right member delta = +200 mm
    const deltaRightX = updated.rightMember!.posX - initial.rightMember!.posX;
    expect(deltaRightX).toBeCloseTo(200, 1);

    // left member translation delta = 0
    const deltaLeftX = updated.leftMember!.posX - initial.leftMember!.posX;
    expect(deltaLeftX).toBeCloseTo(0, 1);

    // rigid members: scale = [1,1,1], det = +1
    expect(updated.leftMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(updated.leftMember!.scale[1]).toBeCloseTo(1.0, 4);
    expect(updated.leftMember!.scale[2]).toBeCloseTo(1.0, 4);
    expect(updated.leftMember!.det).toBeCloseTo(1.0, 4);
    expect(updated.rightMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(updated.rightMember!.scale[1]).toBeCloseTo(1.0, 4);
    expect(updated.rightMember!.scale[2]).toBeCloseTo(1.0, 4);
    expect(updated.rightMember!.det).toBeCloseTo(1.0, 4);

    // bottom: 565 → 765
    expect(updated.bottomComponent!.size[0]).toBeCloseTo(765, 1);
    expect(updated.bottomComponent!.size[1]).toBeCloseTo(15, 1); // espesor preservado

    // member & assembly IDs estables
    expect(updated.leftMember!.assemblyInstanceId).toBe('inst-drawer-1');
    expect(updated.rightMember!.assemblyInstanceId).toBe('inst-drawer-1');
    expect(updated.leftMember!.memberId).toBe('runner-left');
    expect(updated.rightMember!.memberId).toBe('runner-right');

    // assetRevision / hardware IDs / renderStatus estables
    expect(updated.leftMember!.hardwareId).toBe(initial.leftMember!.hardwareId);
    expect(updated.rightMember!.hardwareId).toBe(initial.rightMember!.hardwareId);
    expect(updated.leftMember!.assetRevisionId).toBe('rev-runner-500');
    expect(updated.rightMember!.assetRevisionId).toBe('rev-runner-500');
    expect(updated.leftMember!.renderStatus).toBe('exact');
    expect(updated.rightMember!.renderStatus).toBe('exact');
    expect(updated.leftMember!.worldMatrix).toHaveLength(16);
    expect(updated.rightMember!.worldMatrix).toHaveLength(16);

    // console: sin errores inesperados
    expect(consoleErrors).toEqual([]);
  });
});

function createDrawerAssemblySeedWorkspace() {
  const seed = createSeedWorkspace();
  const runner400 = {
    id: 'runner-400',
    code: 'RUN-400',
    name: 'Runner 400mm',
    unit: 'piece',
    costPerUnit: 15,
    active: true,
    previewShape: 'slide' as const,
    previewSizeMm: 400,
    previewDiameterMm: 45,
    previewColor: '#888888',
    visualAsset: {
      assetId: 'ast-runner-400',
      assetRevisionId: 'rev-runner-400',
      sha256: 'd'.repeat(64),
    },
  };
  const runner500 = {
    id: 'runner-500',
    code: 'RUN-500',
    name: 'Runner 500mm',
    unit: 'piece',
    costPerUnit: 18,
    active: true,
    previewShape: 'slide' as const,
    previewSizeMm: 500,
    previewDiameterMm: 45,
    previewColor: '#888888',
    visualAsset: {
      assetId: 'ast-runner-500',
      assetRevisionId: 'rev-runner-500',
      sha256: 'e'.repeat(64),
    },
  };
  const kitBoxRunner = {
    id: 'kit-box-runner',
    code: 'KIT-BOX',
    name: 'Drawer Box Kit',
    unit: 'set',
    costPerUnit: 45,
    active: true,
  };
  const compBottomPanel = {
    id: 'comp-bottom-panel',
    code: 'CMP-BTM',
    name: 'Bottom Panel',
    active: true,
    placement: 'inferior',
    geometry: { kind: 'rectangular_board' as const, lengthMm: 500, widthMm: 500, thicknessMm: 15 },
    defaultEdges: [
      { side: 'L1' as const, enabled: false },
      { side: 'L2' as const, enabled: false },
      { side: 'W1' as const, enabled: false },
      { side: 'W2' as const, enabled: false },
    ],
    optionRoles: ['INTERIOR'],
  };
  const fixtureAgregado = {
    id: 'agr-drawer-system',
    code: 'AGR-SYS',
    name: 'Drawer System Subassembly',
    commercialKitHardwareId: 'kit-box-runner',
    variantSets: [
      {
        id: 'depth-runners',
        dimension: 'depth' as const,
        variants: [
          { nominalDimensionMm: 400, hardwareId: 'runner-400' },
          { nominalDimensionMm: 500, hardwareId: 'runner-500' },
        ],
      },
    ],
    compatibilityRules: [
      {
        variantSetId: 'depth-runners',
        clearanceMm: 20,
        selectionStrategy: 'max_fitting' as const,
      },
    ],
    rigidMembers: [
      {
        memberId: 'runner-left',
        role: 'guide_left',
        source: {
          kind: 'variant' as const,
          variant: { variantSetId: 'depth-runners' },
        },
        placement: {
          x: { ref: 'min' as const, offsetMm: 0 },
          y: { ref: 'min' as const, offsetMm: 0 },
          z: { ref: 'min' as const, offsetMm: 0 },
        },
        bomRole: 'included_in_kit' as const,
      },
      {
        memberId: 'runner-right',
        role: 'guide_right',
        source: {
          kind: 'variant' as const,
          variant: { variantSetId: 'depth-runners' },
        },
        placement: {
          x: { ref: 'max' as const, offsetMm: 0 },
          y: { ref: 'min' as const, offsetMm: 0 },
          z: { ref: 'min' as const, offsetMm: 0 },
        },
        bomRole: 'included_in_kit' as const,
      },
    ],
    components: [
      {
        componentId: 'comp-bottom-panel',
        quantity: 1,
        overrides: {
          widthRule: {
            source: 'assembly_width' as const,
            multiplier: 1.0,
            offsetMm: -35,
          },
          lengthRule: {
            source: 'selected_variant' as const,
            variantSetId: 'depth-runners',
            multiplier: 1.0,
            offsetMm: -10,
          },
          placementRule: {
            x: { ref: 'min' as const, offsetMm: 17.5 },
            y: { ref: 'min' as const, offsetMm: 5 },
            z: { ref: 'min' as const, offsetMm: 15 },
          },
        },
      },
    ],
  };

  const baseModule = seed.catalog.modules[0]!;
  const drawerModule = {
    ...baseModule,
    externalDims: { width: 600, height: 720, depth: 590 },
    agregados: [
      {
        id: 'inst-drawer-1',
        agregadoId: 'agr-drawer-system',
        quantity: 1,
        position: { xFormula: '0', yFormula: '0', zFormula: '100' },
        dimensions: { widthFormula: 'PW', heightFormula: '200', depthFormula: 'PD' },
      },
    ],
  };

  return {
    ...seed,
    catalog: {
      ...seed.catalog,
      hardware: [...seed.catalog.hardware, runner400, runner500, kitBoxRunner],
      components: [...(seed.catalog.components ?? []), compBottomPanel],
      agregados: [...(seed.catalog.agregados ?? []), fixtureAgregado],
      modules: [drawerModule, ...seed.catalog.modules.slice(1)],
    },
  };
}
