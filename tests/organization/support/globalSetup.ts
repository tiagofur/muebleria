import { prepareAuthoritativeOrganizations } from './api';

export default async function globalSetup(): Promise<void> {
  await prepareAuthoritativeOrganizations();
}
