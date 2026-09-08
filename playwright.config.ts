import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests: visual regression baseline (F052) + smokes reales
 * (tests/smoke — p.ej. WebGL del estudio Proyectar, F141).
 * Single browser (chromium), desktop viewport, guest mode (no backend).
 * Baselines are committed; diffs live in test-results/ (gitignored).
 *
 * Run:      pnpm visual
 * Update:   pnpm visual -- --update-snapshots
 *
 * VISUAL_PORT lets a second worktree host its own dev server when the
 * default 5173 is already serving a different checkout (the reused server
 * would silently test the wrong branch).
 */
const PORT = Number(process.env.VISUAL_PORT ?? 5173);
const BASE = `http://localhost:${PORT}`;
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false, // single dev server, avoid port races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  expect: {
    // Visual refactors shift sub-pixel anti-aliasing; allow a touch of slack
    // so font-rendering noise across runs doesn't drown out real changes.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // #444 owns this spec end to end (software GL + platform-agnostic
      // baselines); the generic hardware-GL project must not double-run it.
      testIgnore: /proyectar-webgl\.spec\.ts/,
    },
    {
      name: 'proyectar-webgl',
      testMatch: /proyectar-webgl\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // Deterministic WebGL rasterizer: swiftshader-webgl pins WebGL to the
        // CPU ANGLE backend (verified: MAX_TEXTURE_SIZE 8192 vs 16384 on GPU),
        // bit-stable for a fixed Chromium build, so local macOS and CI Linux
        // rasterize identical canvas pixels. Never enable these flags for the
        // perf smokes (#312) — they measure real GPU behavior.
        launchOptions: {
          args: ['--use-angle=swiftshader-webgl', '--disable-lcd-text'],
        },
      },
      // One committed baseline set shared by every platform: canvas-only
      // captures rendered by the same pinned SwiftShader build.
      snapshotPathTemplate:
        'tests/visual/proyectar-webgl.spec.ts-snapshots/{arg}{ext}',
    },
  ],
  webServer: {
    command: `pnpm --filter @granete/web exec vite --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
