import { prepareAuthoritativeOrganizations, required } from './api';

export default async function globalSetup(): Promise<void> {
  const isolated = required('ORGANIZATION_TEST_ISOLATED');
  if (isolated !== '1') {
    throw new Error('ORGANIZATION_TEST_ISOLATED=1 is required before running browser organization setup');
  }
  const dbUrl = required('ORGANIZATION_TEST_DATABASE_URL');
  const parsed = new URL(dbUrl);
  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  if (!dbName || dbName === 'muebles' || dbName.includes('prod') || parsed.hostname.includes('prod')) {
    throw new Error(`Fail-closed guard rejected unsafe test database in globalSetup: ${dbUrl}`);
  }
  await prepareAuthoritativeOrganizations();
}
