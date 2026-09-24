import { prepareAuthoritativeOrganizations, required } from './api';
import { assertOrganizationTestDatabaseURL } from './databaseIsolation';

export default async function globalSetup(): Promise<void> {
  const isolated = required('ORGANIZATION_TEST_ISOLATED');
  if (isolated !== '1') {
    throw new Error('ORGANIZATION_TEST_ISOLATED=1 is required before running browser organization setup');
  }
  const dbUrl = required('ORGANIZATION_TEST_DATABASE_URL');
  assertOrganizationTestDatabaseURL(dbUrl);
  await prepareAuthoritativeOrganizations();
}
