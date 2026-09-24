import { prepareAuthoritativeOrganizations, required } from './api';

export default async function globalSetup(): Promise<void> {
  const isolated = required('ORGANIZATION_TEST_ISOLATED');
  if (isolated !== '1') {
    throw new Error('ORGANIZATION_TEST_ISOLATED=1 is required before running browser organization setup');
  }
  const dbUrl = required('ORGANIZATION_TEST_DATABASE_URL');
  try {
    const parsed = new URL(dbUrl);
    const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
    const allowedTestDBs = ['granete_gate', 'granete_test', 'muebles_multiorg_test', 'muebles_pilot_readiness'];
    const allowedPrefixes = ['granete_gate_', 'granete_test_', 'muebles_multiorg_test_', 'muebles_pilot_'];
    const isAllowed = allowedTestDBs.includes(dbName) || allowedPrefixes.some(p => dbName.startsWith(p));

    if (!dbName || dbName === 'muebles' || dbName === 'postgres' || dbName.includes('prod') || parsed.hostname.includes('prod') || !isAllowed) {
      throw new Error(`Fail-closed guard rejected unsafe test database in globalSetup (host=${parsed.host} db=${dbName})`);
    }
  } catch (err: any) {
    const safeMessage = err?.message && !err.message.includes('://') ? err.message : 'database validation failed';
    throw new Error(`Invalid or unsafe ORGANIZATION_TEST_DATABASE_URL: ${safeMessage}`);
  }
  await prepareAuthoritativeOrganizations();
}
