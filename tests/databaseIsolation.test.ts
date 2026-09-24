import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

const { prepare, connect, query, end } = vi.hoisted(() => ({
  prepare: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
  query: vi.fn(async () => ({ rows: [] })),
  end: vi.fn(async () => {}),
}));
vi.mock('pg', () => ({ Client: class {
  connect = connect;
  query = query;
  end = end;
} }));
vi.mock('./organization/support/api', () => ({
  prepareAuthoritativeOrganizations: prepare,
  required: (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  },
}));

afterEach(() => {
  prepare.mockClear();
  connect.mockClear();
  query.mockReset();
  end.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const marker = 'a'.repeat(64);
const markerDigest = createHash('sha256').update(marker).digest('hex');

function isolatedSetup(): void {
  vi.stubEnv('ORGANIZATION_TEST_ISOLATED', '1');
  vi.stubEnv('GRANETE_TEST_DATABASE', '1');
  vi.stubEnv('ORGANIZATION_TEST_DATABASE_URL',
    'postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable');
  vi.stubEnv('ORGANIZATION_API_BASE', 'http://127.0.0.1:54322/api');
  vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:54322/api');
  vi.stubEnv('ORGANIZATION_GATE_DB_IDENTITY_SHA256', markerDigest);
  query.mockResolvedValue({ rows: [{ database: 'granete_gate', role: 'postgres', marker }] });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({
      'x-granete-test-database': 'granete_gate',
      'x-granete-test-role': 'granete_app',
      'x-granete-test-identity': markerDigest,
    }),
  })));
}

it.each([
  ['database override', 'dbname=muebles'],
  ['host override', 'host=example.invalid'],
  ['port override', 'port=5445'],
  ['service override', 'service=habitual'],
  ['session marker override', 'options=-c%20granete.browser_gate_identity%3Dforged'],
  ['mixed-case session marker override', 'Options=-c%20granete.browser_gate_identity%3Dforged'],
])('rejects a direct Playwright %s before global setup writes', async (_name, override) => {
  isolatedSetup();
  vi.stubEnv('ORGANIZATION_TEST_DATABASE_URL',
    `postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable&${override}`);
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/unsafe|override|invalid/i);
  expect(prepare).not.toHaveBeenCalled();
});

it('allows a direct Playwright setup on an explicit isolated fixture target', async () => {
  isolatedSetup();
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await globalSetup();
  expect(prepare).toHaveBeenCalledOnce();
  expect(connect).toHaveBeenCalledOnce();
  expect(query).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([
  ['different backend database', { 'x-granete-test-database': 'granete_gate_other' }],
  ['different backend role', { 'x-granete-test-role': 'postgres' }],
  ['different backend instance', { 'x-granete-test-identity': 'b'.repeat(64) }],
])('rejects %s before setup writes', async (_name, override) => {
  isolatedSetup();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({
      'x-granete-test-database': 'granete_gate',
      'x-granete-test-role': 'granete_app',
      'x-granete-test-identity': markerDigest,
      ...override,
    }),
  })));
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/identity|mismatch/i);
  expect(prepare).not.toHaveBeenCalled();
});

it('rejects an ordinary backend without the test identity response', async () => {
  isolatedSetup();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers() })));
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/identity|mismatch/i);
  expect(prepare).not.toHaveBeenCalled();
});

it('rejects fixture marker mismatch before setup writes', async () => {
  isolatedSetup();
  query.mockResolvedValue({ rows: [{ database: 'granete_gate', role: 'postgres', marker: 'b'.repeat(64) }] });
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/identity|mismatch/i);
  expect(prepare).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('redacts a fixture connection failure before setup writes', async () => {
  isolatedSetup();
  connect.mockRejectedValueOnce(new Error('postgres://postgres:synthetic@127.0.0.1:56321/granete_gate'));
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  let error: unknown;
  try { await globalSetup(); } catch (cause) { error = cause; }
  expect(String(error)).toMatch(/identity unavailable/i);
  expect(String(error)).not.toMatch(/synthetic/i);
  expect(prepare).not.toHaveBeenCalled();
});

it('rejects API URL mismatch before setup writes', async () => {
  isolatedSetup();
  vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:54323/api');
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/API|mismatch/i);
  expect(prepare).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it('rejects a fabricated marker without a gate-issued identity', async () => {
  isolatedSetup();
  vi.stubEnv('ORGANIZATION_GATE_DB_IDENTITY_SHA256', '');
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/identity/i);
  expect(prepare).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it('rejects ambient PostgreSQL session options before setup writes', async () => {
  isolatedSetup();
  vi.stubEnv('PGOPTIONS', '-c granete.browser_gate_identity=forged');
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/ambient|option|unsafe/i);
  expect(prepare).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});
