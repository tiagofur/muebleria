import { defineConfig, devices } from '@playwright/test';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the organization browser gate`);
  return value;
}

const webPort = required('ORGANIZATION_WEB_PORT');
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/organization',
  outputDir: process.env.ORGANIZATION_TEST_OUTPUT ?? './test-results/organization',
  globalSetup: './tests/organization/support/globalSetup.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @granete/web dev --host 127.0.0.1 --port ${webPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
