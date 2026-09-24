import { prepareAuthoritativeOrganizations, required } from './api';
import { assertOrganizationBackendDatabaseIdentity, assertOrganizationTestDatabaseURL } from './databaseIsolation';

export default async function globalSetup(): Promise<void> {
  const isolated = required('ORGANIZATION_TEST_ISOLATED');
  if (isolated !== '1') {
    throw new Error('ORGANIZATION_TEST_ISOLATED=1 is required before running browser organization setup');
  }
  const dbUrl = required('ORGANIZATION_TEST_DATABASE_URL');
  assertOrganizationTestDatabaseURL(dbUrl);
  if (required('GRANETE_TEST_DATABASE') !== '1') {
    throw new Error('GRANETE_TEST_DATABASE=1 is required before organization setup');
  }
  await assertOrganizationBackendDatabaseIdentity();
  console.log('[organization-gate] backend and fixture database identity matched');
  await prepareAuthoritativeOrganizations();
}
