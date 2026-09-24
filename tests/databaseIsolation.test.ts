import { afterEach, expect, it, vi } from 'vitest';

const { prepare } = vi.hoisted(() => ({ prepare: vi.fn(async () => {}) }));
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
  vi.unstubAllEnvs();
});

it.each([
  ['database override', 'dbname=muebles'],
  ['host override', 'host=example.invalid'],
  ['port override', 'port=5445'],
  ['service override', 'service=habitual'],
])('rejects a direct Playwright %s before global setup writes', async (_name, override) => {
  vi.stubEnv('ORGANIZATION_TEST_ISOLATED', '1');
  vi.stubEnv('ORGANIZATION_TEST_DATABASE_URL',
    `postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable&${override}`);
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await expect(globalSetup()).rejects.toThrow(/unsafe|override|invalid/i);
  expect(prepare).not.toHaveBeenCalled();
});

it('allows a direct Playwright setup on an explicit isolated fixture target', async () => {
  vi.stubEnv('ORGANIZATION_TEST_ISOLATED', '1');
  vi.stubEnv('ORGANIZATION_TEST_DATABASE_URL',
    'postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?sslmode=disable');
  const { default: globalSetup } = await import('./organization/support/globalSetup');
  await globalSetup();
  expect(prepare).toHaveBeenCalledOnce();
});
