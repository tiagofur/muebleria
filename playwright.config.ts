import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression baseline for the UI Judgment Day (F052).
 * Single browser (chromium), desktop viewport, guest mode (no backend).
 * Baselines are committed; diffs live in test-results/ (gitignored).
 *
 * Run:      pnpm visual
 * Update:   pnpm visual -- --update-snapshots
 */
export default defineConfig({
  testDir: './tests/visual',
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
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm --filter @muebles/web dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
