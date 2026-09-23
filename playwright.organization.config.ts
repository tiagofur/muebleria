import { defineConfig, devices } from '@playwright/test';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the organization browser gate`);
  return value;
}

// Fail-closed guard (#823): ensure browser organization gate runs strictly against
// an isolated test database, never against persistent dev or production databases.
const isolatedFlag = required('ORGANIZATION_TEST_ISOLATED');
if (isolatedFlag !== '1') {
  throw new Error('ORGANIZATION_TEST_ISOLATED=1 is required by the organization browser gate');
}
const testDBUrl = required('ORGANIZATION_TEST_DATABASE_URL');
try {
  const parsed = new URL(testDBUrl);
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const allowedTestDBs = ['granete_gate', 'granete_test', 'muebles_multiorg_test', 'muebles_pilot_readiness'];
  const allowedPrefixes = ['granete_gate_', 'granete_test_', 'muebles_multiorg_test_', 'muebles_pilot_'];
  const isAllowed = allowedTestDBs.includes(dbName) || allowedPrefixes.some(p => dbName.startsWith(p));

  if (!dbName || dbName === 'muebles' || dbName === 'postgres' || dbName.includes('prod') || parsed.hostname.includes('prod') || !isAllowed) {
    throw new Error(`Unsafe test database URL rejected by fail-closed guard (host=${parsed.host} db=${dbName})`);
  }
} catch (err: any) {
  const safeMessage = err?.message && !err.message.includes('://') ? err.message : 'database validation failed';
  throw new Error(`Invalid or unsafe ORGANIZATION_TEST_DATABASE_URL: ${safeMessage}`);
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
