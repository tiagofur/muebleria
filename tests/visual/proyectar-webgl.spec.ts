import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createSeedWorkspace } from '@granete/storage';

// ── #670-E canonical MERIVOBOX pilot contract (R9/R10/R12) ───────────────────
//
// Scenario 8 asserts against the SAME canonical numbers consumed by the Go
// engine tests, the TS domain tests and the SketchUp TestUp evidence, so the
// WebGL renderer can never drift into a "slightly different MERIVOBOX pilot".
const canonicalPilotPath = join(__dirname, '..', '..', 'contracts', 'fixtures', 'merivobox-pilot-canonical.json');
const canonicalPilot = JSON.parse(readFileSync(canonicalPilotPath, 'utf8')) as {
  configuration: {
    outerWidthMm: number;
    leftPanelThicknessMm: number;
    rightPanelThicknessMm: number;
    derivedLwMm: number;
    assemblyHeightMm: number;
    carcaseDepthMm: number;
    selectedNominalDepthMm: number;
    mutatedOuterWidthMm: number;
    mutatedDerivedLwMm: number;
  };
  materialAuthority: {
    optionRole: string;
    materialId: string;
    materialThicknessMm: number;
    nominalGeometryThicknessMm: number;
  };
  expectedFabricatedMm: {
    w600Nl500: {
      bottom: { widthMm: number; lengthMm: number; thicknessMm: number };
      back: { widthMm: number; lengthMm: number; thicknessMm: number };
    };
    w600Nl450: {
      bottom: { widthMm: number; lengthMm: number; thicknessMm: number };
      back: { widthMm: number; lengthMm: number; thicknessMm: number };
    };
    w800Nl450: {
      bottom: { widthMm: number; lengthMm: number; thicknessMm: number };
      back: { widthMm: number; lengthMm: number; thicknessMm: number };
    };
    w800Nl500: {
      bottom: { widthMm: number; lengthMm: number; thicknessMm: number };
      back: { widthMm: number; lengthMm: number; thicknessMm: number };
    };
    rightMembersDeltaMm: number;
  };
};

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

  // ── Scenario 8 — #670-E: MERIVOBOX Real Pilot WebGL End-to-End ───────────

  test('Point 11: WebGL real — MERIVOBOX real pilot W600/A -> W800/A -> W800/B end-to-end scene graph mutation', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      console.log(`BROWSER [${msg.type()}]:`, msg.text());
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('404')) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (err) => {
      console.log('BROWSER PAGEERROR:', err.message);
      consoleErrors.push(err.message);
    });

    const customWs = createMerivoboxPilotSeedWorkspace();
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

    // 2. Insertar primer módulo del catálogo (pre-configurado con MERIVOBOX)
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

    type SceneBoardInfo = {
      size: [number, number, number];
      description: string;
      materialId?: string;
    };

    type SceneQueryResult = {
      leftMember: SceneMemberInfo | null;
      rightMember: SceneMemberInfo | null;
      bottomComponent: SceneBoardInfo | null;
      backComponent: SceneBoardInfo | null;
    };

    const queryScene = async (): Promise<SceneQueryResult | null> => {
      return page.evaluate<SceneQueryResult | null>(() => {
        const scene = (window as any).__graneteScene;
        if (!scene) return null;

        let leftMember: SceneMemberInfo | null = null;
        let rightMember: SceneMemberInfo | null = null;
        let bottomComponent: SceneBoardInfo | null = null;
        let backComponent: SceneBoardInfo | null = null;

        scene.traverse((obj: any) => {
          if (obj.userData?.memberId === 'side-left') {
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
          if (obj.userData?.memberId === 'side-right') {
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
          if (obj.userData?.description === 'comp-bottom' && obj.userData?.size) {
            bottomComponent = {
              size: obj.userData.size,
              description: obj.userData.description,
              materialId: obj.userData.materialId,
            };
          }
          if (obj.userData?.description === 'comp-back' && obj.userData?.size) {
            backComponent = {
              size: obj.userData.size,
              description: obj.userData.description,
              materialId: obj.userData.materialId,
            };
          }
        });

        return { leftMember, rightMember, bottomComponent, backComponent };
      });
    };

    // Esperar a que los miembros del assembly aparezcan en el canvas WebGL
    await expect
      .poll(async () => {
        const data = await queryScene();
        return Boolean(data?.leftMember && data?.rightMember && data?.bottomComponent && data?.backComponent);
      }, { timeout: 20_000 })
      .toBe(true);

    const initial = (await queryScene())!;
    expect(initial.leftMember).not.toBeNull();
    expect(initial.rightMember).not.toBeNull();
    expect(initial.bottomComponent).not.toBeNull();
    expect(initial.backComponent).not.toBeNull();

    // R10 explicit chain assertions, read back from the live WebGL scene graph:
    // furniture outer W + real carcase panel thicknesses (seed authority:
    // INTERIOR -> mat-arauco-blanco 15mm per side) -> derived cavity LW -> the
    // width the assembly was resolved with -> fabricated boards derived from LW.
    const chainCfg = canonicalPilot.configuration;
    const derivedLW = chainCfg.outerWidthMm - chainCfg.leftPanelThicknessMm - chainCfg.rightPanelThicknessMm;
    expect(derivedLW).toBe(chainCfg.derivedLwMm);
    expect(derivedLW).not.toBe(chainCfg.outerWidthMm);

    // side-right sits at max(LW) and side-left at min(0) of the assembly
    // frame, so their scene-local span IS the width the resolver received.
    const assemblyResolvedWidth = initial.rightMember!.posX - initial.leftMember!.posX;
    expect(assemblyResolvedWidth).toBeCloseTo(derivedLW, 1);

    // The fabricated bottom width is derived from that same resolved LW.
    expect(initial.bottomComponent!.size[0]).toBeCloseTo(derivedLW - 58, 1);

    // R9 assertions: fabricated bottom & back thickness comes from the
    // MERIVOBOX_BOARD MaterialBoard authority, not the renderer. The seed's
    // nominal geometry thickness deliberately differs (15mm), so only the
    // bound material can produce the canonical 16mm. Initial state is
    // W600 / depth 480 -> Variant A (NL 450).
    const canonicalInitial = canonicalPilot.expectedFabricatedMm.w600Nl450;
    expect(initial.bottomComponent!.materialId).toBe(canonicalPilot.materialAuthority.materialId);
    expect(initial.bottomComponent!.size[0]).toBeCloseTo(canonicalInitial.bottom.widthMm, 1);
    expect(initial.bottomComponent!.size[1]).toBeCloseTo(canonicalPilot.materialAuthority.materialThicknessMm, 1);
    expect(initial.bottomComponent!.size[2]).toBeCloseTo(canonicalInitial.bottom.lengthMm, 1);

    expect(initial.backComponent!.materialId).toBe(canonicalPilot.materialAuthority.materialId);
    expect(initial.backComponent!.size[0]).toBeCloseTo(canonicalInitial.back.widthMm, 1);
    expect(initial.backComponent!.size[1]).toBeCloseTo(canonicalPilot.materialAuthority.materialThicknessMm, 1);
    expect(initial.backComponent!.size[2]).toBeCloseTo(canonicalInitial.back.lengthMm, 1);

    // Stage 1: W=600 / Depth=480 (Variant A: NL 450)
    expect(initial.leftMember!.assemblyInstanceId).toBe('inst-merivobox-1');
    expect(initial.rightMember!.assemblyInstanceId).toBe('inst-merivobox-1');
    expect(initial.leftMember!.memberId).toBe('side-left');
    expect(initial.rightMember!.memberId).toBe('side-right');
    expect(initial.leftMember!.hardwareId).toBe('hw-merivobox-450');
    expect(initial.rightMember!.hardwareId).toBe('hw-merivobox-450');
    expect(initial.leftMember!.assetRevisionId).toBe('rev-merivobox-450');
    expect(initial.rightMember!.assetRevisionId).toBe('rev-merivobox-450');
    expect(initial.leftMember!.renderStatus).toBe('exact');
    expect(initial.rightMember!.renderStatus).toBe('exact');

    // Scale [1,1,1] and det +1.0
    expect(initial.leftMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(initial.leftMember!.scale[1]).toBeCloseTo(1.0, 4);
    expect(initial.leftMember!.scale[2]).toBeCloseTo(1.0, 4);
    expect(initial.leftMember!.det).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.scale[1]).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.scale[2]).toBeCloseTo(1.0, 4);
    expect(initial.rightMember!.det).toBeCloseTo(1.0, 4);

    // Stage 2: Mutate W=800 (Depth remains 480 -> Variant A)
    const widthInput = page.locator('label:has-text("Ancho") input');
    await widthInput.waitFor({ timeout: 10_000 });
    await widthInput.fill(`${canonicalPilot.configuration.mutatedOuterWidthMm}`);
    await widthInput.press('Enter');

    const canonicalW800Nl450 = canonicalPilot.expectedFabricatedMm.w800Nl450;
    await expect
      .poll(async () => {
        const data = await queryScene();
        return data?.bottomComponent?.size[0];
      }, { timeout: 20_000 })
      .toBeCloseTo(canonicalW800Nl450.bottom.widthMm, 1);

    await settleCanvas(page);

    const stage2 = (await queryScene())!;
    const deltaRightX = stage2.rightMember!.posX - initial.rightMember!.posX;
    expect(deltaRightX).toBeCloseTo(canonicalPilot.expectedFabricatedMm.rightMembersDeltaMm, 1);
    const deltaLeftX = stage2.leftMember!.posX - initial.leftMember!.posX;
    expect(deltaLeftX).toBeCloseTo(0, 1);

    // R10 chain readback after mutation: outer W800 -> LW770 -> same span logic
    const mutatedLW = chainCfg.mutatedOuterWidthMm - chainCfg.leftPanelThicknessMm - chainCfg.rightPanelThicknessMm;
    expect(mutatedLW).toBe(chainCfg.mutatedDerivedLwMm);
    expect(stage2.rightMember!.posX - stage2.leftMember!.posX).toBeCloseTo(mutatedLW, 1);

    // Rigid members stay unscaled, det = +1.0
    expect(stage2.leftMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(stage2.leftMember!.det).toBeCloseTo(1.0, 4);
    expect(stage2.rightMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(stage2.rightMember!.det).toBeCloseTo(1.0, 4);

    // Bottom: LW 770 - 58 = 712mm, NL 450 length preserved, MaterialBoard thickness
    expect(stage2.bottomComponent!.size[0]).toBeCloseTo(canonicalW800Nl450.bottom.widthMm, 1);
    expect(stage2.bottomComponent!.size[1]).toBeCloseTo(canonicalPilot.materialAuthority.materialThicknessMm, 1);
    expect(stage2.bottomComponent!.size[2]).toBeCloseTo(canonicalW800Nl450.bottom.lengthMm, 1);
    expect(stage2.bottomComponent!.materialId).toBe(canonicalPilot.materialAuthority.materialId);

    // Back: LW 770 - 58 = 712mm, 69mm height, MaterialBoard thickness
    expect(stage2.backComponent!.size[0]).toBeCloseTo(canonicalW800Nl450.back.widthMm, 1);
    expect(stage2.backComponent!.size[1]).toBeCloseTo(canonicalPilot.materialAuthority.materialThicknessMm, 1);
    expect(stage2.backComponent!.size[2]).toBeCloseTo(canonicalW800Nl450.back.lengthMm, 1);
    expect(stage2.backComponent!.materialId).toBe(canonicalPilot.materialAuthority.materialId);

    // Stage 3: Mutate Depth=530 (W=800 -> selects Variant B: NL 500)
    const depthInput = page.locator('label:has-text("Prof.") input');
    await depthInput.waitFor({ timeout: 10_000 });
    await depthInput.fill(`${canonicalPilot.configuration.carcaseDepthMm}`);
    await depthInput.press('Enter');

    await expect
      .poll(async () => {
        const data = await queryScene();
        return data?.leftMember?.hardwareId;
      }, { timeout: 20_000 })
      .toBe('hw-merivobox-500');

    await settleCanvas(page);

    const stage3 = (await queryScene())!;
    expect(stage3.leftMember!.hardwareId).toBe('hw-merivobox-500');
    expect(stage3.rightMember!.hardwareId).toBe('hw-merivobox-500');
    expect(stage3.leftMember!.assetRevisionId).toBe('rev-merivobox-500');
    expect(stage3.rightMember!.assetRevisionId).toBe('rev-merivobox-500');

    // Bottom board length regenerated to 500 - 16 = 484mm; width remains 712mm
    const canonicalW800Nl500 = canonicalPilot.expectedFabricatedMm.w800Nl500;
    expect(stage3.bottomComponent!.size[0]).toBeCloseTo(canonicalW800Nl500.bottom.widthMm, 1);
    expect(stage3.bottomComponent!.size[1]).toBeCloseTo(canonicalPilot.materialAuthority.materialThicknessMm, 1);
    expect(stage3.bottomComponent!.size[2]).toBeCloseTo(canonicalW800Nl500.bottom.lengthMm, 1);
    expect(stage3.bottomComponent!.materialId).toBe(canonicalPilot.materialAuthority.materialId);

    // Back board width remains 712mm, height 69mm
    expect(stage3.backComponent!.size[0]).toBeCloseTo(canonicalW800Nl500.back.widthMm, 1);
    expect(stage3.backComponent!.size[1]).toBeCloseTo(canonicalPilot.materialAuthority.materialThicknessMm, 1);
    expect(stage3.backComponent!.size[2]).toBeCloseTo(canonicalW800Nl500.back.lengthMm, 1);
    expect(stage3.backComponent!.materialId).toBe(canonicalPilot.materialAuthority.materialId);

    // Invariant: Rigid members scale is [1,1,1] and det is +1.0
    expect(stage3.leftMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(stage3.leftMember!.det).toBeCloseTo(1.0, 4);
    expect(stage3.rightMember!.scale[0]).toBeCloseTo(1.0, 4);
    expect(stage3.rightMember!.det).toBeCloseTo(1.0, 4);

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

function createMerivoboxPilotSeedWorkspace() {
  const seed = createSeedWorkspace();
  const mbx450 = {
    id: 'hw-merivobox-450',
    code: 'MBX-450',
    name: 'Blum MERIVOBOX NL 450mm',
    unit: 'pair',
    costPerUnit: 40,
    active: true,
    previewShape: 'slide' as const,
    previewSizeMm: 450,
    previewDiameterMm: 45,
    previewColor: '#7a8288',
    visualAsset: {
      assetId: 'ast-merivobox-450',
      assetRevisionId: 'rev-merivobox-450',
      sha256: 'c'.repeat(64),
    },
  };
  const mbx500 = {
    id: 'hw-merivobox-500',
    code: 'MBX-500',
    name: 'Blum MERIVOBOX NL 500mm',
    unit: 'pair',
    costPerUnit: 42,
    active: true,
    previewShape: 'slide' as const,
    previewSizeMm: 500,
    previewDiameterMm: 45,
    previewColor: '#7a8288',
    visualAsset: {
      assetId: 'ast-merivobox-500',
      assetRevisionId: 'rev-merivobox-500',
      sha256: 'd'.repeat(64),
    },
  };
  const grpMbxBoard = {
    id: 'grp-mbx-board',
    code: 'MERIVOBOX_BOARD',
    name: 'Tablero Cajón MERIVOBOX',
    kind: 'board' as const,
    required: true,
    optionIds: ['mat-merivobox-board-16'],
  };
  const kitMbx = {
    id: 'kit-merivobox-m',
    code: 'KIT-MBX-M',
    name: 'Blum MERIVOBOX Height M Kit',
    unit: 'set',
    costPerUnit: 85,
    active: true,
  };
  const matMbxBoard16 = {
    id: canonicalPilot.materialAuthority.materialId,
    code: 'TAB-MBX-16',
    name: 'Tablero MERIVOBOX 16mm',
    manufacturer: 'Egger / Blum Pilot',
    categoryId: 'cat-mel-blancos',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: canonicalPilot.materialAuthority.materialThicknessMm,
    grainDefault: false,
    active: true,
    costPerUnit: 35,
  };
  const compBottom = {
    id: 'comp-bottom',
    code: 'CMP-BTM',
    name: 'MERIVOBOX Bottom Board',
    active: true,
    placement: 'inferior',
    // Nominal geometry thickness intentionally conflicts with the bound
    // MERIVOBOX_BOARD material (canonical contract): the fabricated thickness
    // authority must be the MaterialBoard (16mm), never this default.
    geometry: {
      kind: 'rectangular_board' as const,
      lengthMm: 500,
      widthMm: 500,
      thicknessMm: canonicalPilot.materialAuthority.nominalGeometryThicknessMm,
    },
    defaultEdges: [
      { side: 'L1' as const, enabled: false },
      { side: 'L2' as const, enabled: false },
      { side: 'W1' as const, enabled: false },
      { side: 'W2' as const, enabled: false },
    ],
    optionRoles: ['MERIVOBOX_BOARD'],
  };
  const compBack = {
    id: 'comp-back',
    code: 'CMP-BCK',
    name: 'MERIVOBOX Back Board',
    active: true,
    placement: 'trasera',
    geometry: {
      kind: 'rectangular_board' as const,
      lengthMm: 500,
      widthMm: 69,
      thicknessMm: canonicalPilot.materialAuthority.nominalGeometryThicknessMm,
    },
    defaultEdges: [
      { side: 'L1' as const, enabled: false },
      { side: 'L2' as const, enabled: false },
      { side: 'W1' as const, enabled: false },
      { side: 'W2' as const, enabled: false },
    ],
    optionRoles: ['MERIVOBOX_BOARD'],
  };
  const merivoboxAgregado = {
    id: 'agr-merivobox-m',
    code: 'MBX-M',
    name: 'Blum MERIVOBOX Height M',
    commercialKitHardwareId: 'kit-merivobox-m',
    variantSets: [
      {
        id: 'depth-variants',
        dimension: 'depth' as const,
        variants: [
          { nominalDimensionMm: 450, hardwareId: 'hw-merivobox-450' },
          { nominalDimensionMm: 500, hardwareId: 'hw-merivobox-500' },
        ],
      },
    ],
    compatibilityRules: [
      {
        variantSetId: 'depth-variants',
        clearanceMm: 3.0, // REAL_VERIFIED: Blum KA-160/24-ES, p. 242
        selectionStrategy: 'max_fitting' as const,
      },
    ],
    rigidMembers: [
      {
        memberId: 'side-left',
        role: 'drawer_side_left',
        source: {
          kind: 'variant' as const,
          variant: { variantSetId: 'depth-variants' },
        },
        placement: {
          x: { ref: 'min' as const, offsetMm: 0 },
          y: { ref: 'min' as const, offsetMm: 0 },
          z: { ref: 'min' as const, offsetMm: 0 },
        },
        bomRole: 'included_in_kit' as const,
      },
      {
        memberId: 'side-right',
        role: 'drawer_side_right',
        source: {
          kind: 'variant' as const,
          variant: { variantSetId: 'depth-variants' },
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
        componentId: 'comp-bottom',
        quantity: 1,
        overrides: {
          widthRule: {
            source: 'assembly_width' as const,
            multiplier: 1.0,
            offsetMm: -58,
          },
          lengthRule: {
            source: 'selected_variant' as const,
            variantSetId: 'depth-variants',
            multiplier: 1.0,
            offsetMm: -16,
          },
          placementRule: {
            x: { ref: 'min' as const, offsetMm: 29 },
            y: { ref: 'min' as const, offsetMm: 16 },
            z: { ref: 'min' as const, offsetMm: 16 },
          },
        },
      },
      {
        componentId: 'comp-back',
        quantity: 1,
        overrides: {
          widthRule: {
            source: 'assembly_width' as const,
            multiplier: 1.0,
            offsetMm: -58,
          },
          lengthRule: {
            source: 'assembly_height' as const,
            multiplier: 0.0,
            offsetMm: 69,
          },
          placementRule: {
            x: { ref: 'min' as const, offsetMm: 29 },
            y: { ref: 'max' as const, offsetMm: -16 },
            z: { ref: 'min' as const, offsetMm: 32 },
          },
        },
      },
    ],
  };

  const baseModule = seed.catalog.modules[0]!;
  // Carcase panels authority from the real seed: the Costado Lateral components
  // bind INTERIOR -> mat-arauco-blanco (15mm effective; the 18mm nominal
  // geometry loses to the bound material). Derived cavity LW = PW - (15 + 15).
  // The assembly instance starts at the interior boundary x = 15.
  const pilotConfig = canonicalPilot.configuration;
  const carcasePanelSumMm = pilotConfig.leftPanelThicknessMm + pilotConfig.rightPanelThicknessMm;
  const merivoboxModule = {
    ...baseModule,
    externalDims: { width: pilotConfig.outerWidthMm, height: 720, depth: 480 },
    agregados: [
      {
        id: 'inst-merivobox-1',
        agregadoId: 'agr-merivobox-m',
        quantity: 1,
        position: { xFormula: `${pilotConfig.leftPanelThicknessMm}`, yFormula: '0', zFormula: '100' },
        dimensions: { widthFormula: `PW - ${carcasePanelSumMm}`, heightFormula: '200', depthFormula: 'PD' },
      },
    ],
  };

  return {
    ...seed,
    projects: seed.projects.map((p) => ({
      ...p,
      projectLevelChoices: {
        ...(p.projectLevelChoices ?? {}),
        [canonicalPilot.materialAuthority.optionRole]: canonicalPilot.materialAuthority.materialId,
      },
      items: p.items.map((item) => ({
        ...item,
        optionChoices: {
          ...(item.optionChoices ?? {}),
          [canonicalPilot.materialAuthority.optionRole]: canonicalPilot.materialAuthority.materialId,
        },
      })),
    })),
    catalog: {
      ...seed.catalog,
      optionGroups: [...seed.catalog.optionGroups, grpMbxBoard],
      materials: [...seed.catalog.materials, matMbxBoard16],
      hardware: [...seed.catalog.hardware, mbx450, mbx500, kitMbx],
      components: [...(seed.catalog.components ?? []), compBottom, compBack],
      agregados: [...(seed.catalog.agregados ?? []), merivoboxAgregado],
      modules: [merivoboxModule, ...seed.catalog.modules.slice(1)],
    },
  };
}

// ── Scenario 9 — #669: exact GLB representation rendered in real WebGL ────

const glbParityCanonical = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/fixtures/glb-parity-canonical.json'), 'utf8'),
) as {
  readonly asset: {
    readonly referencePointsAssetMm: readonly (readonly [number, number, number])[];
  };
  readonly expected: {
    readonly pairwiseDistancesMm: Readonly<Record<string, number>>;
  };
};
const glbParityBytes = readFileSync(
  join(__dirname, '../../contracts/fixtures/glb-parity-bracket.glb'),
);
const glbParitySha = createHash('sha256').update(glbParityBytes).digest('hex');
const GLB_SEAM_REVISION_ID = 'rev-runner-500-glb';

test('Point 12: WebGL real — #669 exact GLB member renders with canonical units, rigidity and identity', async ({
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

  // Static byte seam (data-only, set before app mount): the exact committed
  // parity GLB served for the seeded revision id + digest.
  await page.addInitScript(
    ({ revisionId, sha256, bytesBase64 }) => {
      try {
        (window as unknown as Record<string, unknown>).__graneteTestGlbAssets = {
          [revisionId]: { sha256, bytesBase64 },
        };
      } catch {
        /* seam unavailable */
      }
    },
    {
      revisionId: GLB_SEAM_REVISION_ID,
      sha256: `sha256-${glbParitySha}`,
      bytesBase64: glbParityBytes.toString('base64'),
    },
  );

  // Clone the drawer seed and bind runner-500 (the variant the inserted
  // module resolves) to the canonical MountFrame + GLB co-representation
  // (only this test's workspace is affected).
  const customWs = createDrawerAssemblySeedWorkspace();
  const runner = customWs.catalog.hardware.find((h) => h.id === 'runner-500') as {
    visualAsset?: Record<string, unknown>;
  } & Record<string, unknown>;
  expect(runner).toBeTruthy();
  runner.visualAsset = {
    ...(runner.visualAsset ?? {}),
    mountFrame: {
      originMm: [25, 30, 15],
      basis: { x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] },
    },
    glb: {
      revisionId: GLB_SEAM_REVISION_ID,
      sha256: `sha256-${glbParitySha}`,
      sourceRevisionId: 'rev-runner-500',
      sourceUnits: 'm',
      upAxis: 'y',
    },
  };

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

  await page.goto('/quotes');
  const draftCard = page.locator('.project-card', { hasText: 'Demo plantilla' }).first();
  await draftCard.waitFor({ timeout: 20_000 });
  await draftCard.click();
  await page.waitForSelector('.workspace-chrome, .project-detail', { timeout: 20_000 });
  await page.waitForSelector('[data-testid="project-chrome-projectar"]', { timeout: 20_000 });
  await page.click('[data-testid="project-chrome-projectar"]');
  await waitForStudioCanvas(page);
  await insertFirstLibraryCard(page);
  await fitCamera(page);
  await settleCanvas(page);

  const glbReport = await page.evaluate(
    ({ referencePoints, pairwise }) => {
      const scene = (window as unknown as { __graneteScene?: unknown }).__graneteScene as
        | {
            traverse: (cb: (o: unknown) => void) => void;
          }
        | undefined;
      if (!scene) return { error: 'scene probe unavailable' };

      type Object3D = {
        userData: Record<string, unknown>;
        isMesh?: boolean;
        geometry?: {
          attributes: { position?: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } };
        };
        matrixWorld: { elements: number[]; determinant?(): number };
        updateMatrixWorld: (force?: boolean) => void;
        children: Object3D[];
      };

      scene.traverse(() => undefined);
      let glbGroup: Object3D | undefined;
      const meshes: Object3D[] = [];
      const visit = (object: Object3D) => {
        if (object.userData?.glbStatus === 'ready' && !glbGroup) glbGroup = object;
        if (object.isMesh && object.geometry?.attributes?.position) meshes.push(object);
        for (const child of object.children ?? []) visit(child);
      };
      const root = scene as unknown as Object3D;
      visit(root);
      if (!glbGroup) {
        const statuses: string[] = [];
        const members: string[] = [];
        scene.traverse((o) => {
          const ud = (o as Object3D).userData;
          if (ud?.glbStatus) statuses.push(String(ud.glbStatus));
          if (ud?.memberId) {
            members.push(
              `${String(ud.memberId)}:${String(ud.hardwareId)}:${String(ud.renderStatus)}:glb=${String(ud.glbRevisionId ?? 'none')}`,
            );
          }
        });
        return { error: `no ready glb member (statuses: ${statuses.join(',') || 'none'})`, members };
      }

      const group = glbGroup;
      group.updateMatrixWorld(true);
      // The GLB mesh lives under the group (axis swap + normalized geometry).
      let mesh: Object3D | undefined;
      const findMesh = (object: Object3D) => {
        if (object.isMesh && object.geometry?.attributes?.position && !mesh) mesh = object;
        for (const child of object.children ?? []) findMesh(child);
      };
      findMesh(group);
      if (!mesh) {
        const describe = (object: Object3D, depth: number): string => {
          const type = String((object as unknown as { type?: string }).type ?? '?');
          const meshFlag = object.isMesh ? '(mesh)' : '';
          const childDescriptions = (object.children ?? [])
            .slice(0, 6)
            .map((child) => describe(child, depth + 1))
            .join(',');
          return `${type}${meshFlag}[${childDescriptions}]`;
        };
        let totalMeshes = 0;
        scene.traverse((o) => {
          if ((o as Object3D).isMesh) totalMeshes += 1;
        });
        return {
          error: `glb group carries no mesh: ${describe(group, 0)}`,
          totalMeshes,
          glbDebug: group.userData,
        };
      }

      const position = mesh.geometry!.attributes.position!;
      const nearestVertex = (target: readonly number[]) => {
        let best = [0, 0, 0];
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < position.count; i++) {
          const candidate = [position.getX(i), position.getY(i), position.getZ(i)];
          const distance = Math.hypot(
            candidate[0] - target[0],
            candidate[1] - target[1],
            candidate[2] - target[2],
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
        return { vertex: best, distance: bestDistance };
      };

      // Baked asset-space extents (canonical bracket: 70 x 54 x 18 mm).
      let min = [Infinity, Infinity, Infinity];
      let max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < position.count; i++) {
        const candidate = [position.getX(i), position.getY(i), position.getZ(i)];
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], candidate[axis]);
          max[axis] = Math.max(max[axis], candidate[axis]);
        }
      }

      // World-space reference points through the REAL scene graph matrices.
      const matrix = mesh.matrixWorld.elements;
      const transform = (p: readonly number[]) => [
        matrix[0]! * p[0]! + matrix[4]! * p[1]! + matrix[8]! * p[2]! + matrix[12]!,
        matrix[1]! * p[0]! + matrix[5]! * p[1]! + matrix[9]! * p[2]! + matrix[13]!,
        matrix[2]! * p[0]! + matrix[6]! * p[1]! + matrix[10]! * p[2]! + matrix[14]!,
      ];
      const world = referencePoints.map((assetPoint) => transform(nearestVertex(assetPoint).vertex));
      const distance = (a: readonly number[], b: readonly number[]) =>
        Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

      // Column norms (uniform scale) and determinant of the world matrix.
      const columns = [
        [matrix[0]!, matrix[1]!, matrix[2]!],
        [matrix[4]!, matrix[5]!, matrix[6]!],
        [matrix[8]!, matrix[9]!, matrix[10]!],
      ];
      const norms = columns.map((c) => Math.hypot(c[0]!, c[1]!, c[2]!));
      const det =
        matrix[0]! * (matrix[5]! * matrix[10]! - matrix[6]! * matrix[9]!) -
        matrix[4]! * (matrix[1]! * matrix[10]! - matrix[2]! * matrix[9]!) +
        matrix[8]! * (matrix[1]! * matrix[6]! - matrix[2]! * matrix[5]!);

      return {
        glbRevisionId: group.userData.glbRevisionId,
        glbSourceRevisionId: group.userData.glbSourceRevisionId,
        assemblyInstanceId: (group.userData as Record<string, unknown>).assemblyInstanceId ?? null,
        bakedExtents: [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!],
        worldPairwise: [
          distance(world[0]!, world[1]!),
          distance(world[1]!, world[2]!),
          distance(world[0]!, world[2]!),
        ],
        expectedPairwise: [pairwise.p0p1, pairwise.p1p2, pairwise.p0p2],
        worldScaleNorms: norms,
        worldDeterminant: det,
      };
    },
    {
      referencePoints: glbParityCanonical.asset.referencePointsAssetMm,
      pairwise: glbParityCanonical.expected.pairwiseDistancesMm,
    },
  );

  expect((glbReport as { error?: string }).error, JSON.stringify(glbReport)).toBeUndefined();
  const report = glbReport as {
    glbRevisionId: unknown;
    glbSourceRevisionId: unknown;
    bakedExtents: number[];
    worldPairwise: number[];
    expectedPairwise: number[];
    worldScaleNorms: number[];
    worldDeterminant: number;
  };
  expect(report.glbRevisionId).toBe(GLB_SEAM_REVISION_ID);
  expect(report.glbSourceRevisionId).toBe('rev-runner-500');
  // Canonical bracket extents in asset mm (baked once, single conversion).
  report.bakedExtents.forEach((extent, axis) => {
    expect(Math.abs(extent - [70, 54, 18][axis])).toBeLessThan(0.02);
  });
  // Pairwise distances survive the whole render chain unchanged (mm, rigid).
  report.worldPairwise.forEach((measured, index) => {
    expect(Math.abs(measured - report.expectedPairwise[index])).toBeLessThan(0.05);
  });
  // Uniform unit scale and a single mirror (the workshop→three axis swap).
  report.worldScaleNorms.forEach((norm) => {
    expect(Math.abs(norm - 1)).toBeLessThan(1e-3);
  });
  expect(Math.abs(report.worldDeterminant + 1)).toBeLessThan(1e-3);
  expect(consoleErrors).toEqual([]);
});
