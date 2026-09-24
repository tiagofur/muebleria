import { createHash } from 'node:crypto';
import { Client } from 'pg';

/** Fail closed on direct organization Playwright fixture connections. */
export function assertOrganizationTestDatabaseURL(rawURL: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawURL);
  } catch {
    throw new Error('Invalid ORGANIZATION_TEST_DATABASE_URL');
  }

  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const allowedNames = ['granete_gate', 'granete_test', 'muebles_multiorg_test', 'muebles_pilot_readiness'];
  const allowedPrefixes = ['granete_gate_', 'granete_test_', 'muebles_multiorg_test_', 'muebles_pilot_'];
  const allowedName = allowedNames.includes(dbName) || allowedPrefixes.some(prefix => dbName.startsWith(prefix));
  const port = Number(parsed.port);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.hostname !== '127.0.0.1'
    || !Number.isInteger(port) || port < 1 || port > 65535 || port === 5445
    || !parsed.username || !parsed.password
    || !allowedName || dbName.includes('prod')) {
    throw new Error('Unsafe ORGANIZATION_TEST_DATABASE_URL target');
  }

  for (const key of parsed.searchParams.keys()) {
    if (['host', 'hostaddr', 'port', 'dbname', 'database', 'service', 'servicefile', 'options'].includes(key.toLowerCase())) {
      throw new Error('ORGANIZATION_TEST_DATABASE_URL cannot override its target');
    }
  }
}

/** Read-only handshake: fixture connection and HTTP backend must see one gate DB. */
export async function assertOrganizationBackendDatabaseIdentity(): Promise<void> {
  const fixtureURL = process.env.ORGANIZATION_TEST_DATABASE_URL ?? '';
  assertOrganizationTestDatabaseURL(fixtureURL);
  if (Object.keys(process.env).some((key) =>
    /^PG(HOST|HOSTADDR|PORT|DATABASE|SERVICE|SERVICEFILE|OPTIONS)$/.test(key))) {
    throw new Error('Unsafe ambient PostgreSQL connection options');
  }
  const expectedIdentity = process.env.ORGANIZATION_GATE_DB_IDENTITY_SHA256 ?? '';
  if (!/^[0-9a-f]{64}$/.test(expectedIdentity)) {
    throw new Error('Disposable browser database identity is required');
  }

  const apiBase = process.env.ORGANIZATION_API_BASE ?? '';
  const frontendAPIBase = process.env.VITE_API_BASE ?? '';
  let api: URL;
  try {
    api = new URL(apiBase);
  } catch {
    throw new Error('Organization API base is invalid');
  }
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1'
    || !api.port || api.pathname !== '/api' || api.search || api.hash
    || api.username || api.password || frontendAPIBase !== apiBase) {
    throw new Error('Organization API base mismatch');
  }

  const fixture = new Client({ connectionString: fixtureURL });
  let connected = false;
  let database = '';
  let marker = '';
  try {
    await fixture.connect();
    connected = true;
    await fixture.query('BEGIN READ ONLY');
    const readback = await fixture.query<{ database: string; role: string; marker: string }>(
      `SELECT current_database() AS database, current_user AS role,
              current_setting('granete.browser_gate_identity', true) AS marker`,
    );
    const row = readback.rows[0];
    if (!row || row.database !== new URL(fixtureURL).pathname.slice(1)
      || row.role !== decodeURIComponent(new URL(fixtureURL).username)
      || !/^[0-9a-f]{64}$/.test(row.marker ?? '')) {
      throw new Error('Disposable fixture database identity mismatch');
    }
    database = row.database;
    marker = row.marker;
  } catch {
    // Driver errors may include the credential-bearing connection string.
    throw new Error('Disposable fixture database identity unavailable');
  } finally {
    if (connected) {
      await fixture.query('ROLLBACK').catch(() => {});
      await fixture.end().catch(() => {});
    }
  }
  const fixtureIdentity = createHash('sha256').update(marker).digest('hex');
  if (fixtureIdentity !== expectedIdentity) {
    throw new Error('Disposable fixture database identity mismatch');
  }

  const response = await fetch(new URL('/api/health', api.origin), {
    headers: { 'X-Granete-Test-Database-Probe': '1' },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok
    || response.headers.get('X-Granete-Test-Database') !== database
    || response.headers.get('X-Granete-Test-Role') !== 'granete_app'
    || response.headers.get('X-Granete-Test-Identity') !== expectedIdentity) {
    throw new Error('Organization API database identity mismatch');
  }
}
