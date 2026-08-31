import { assertAuthoritativeSession } from './api';

export default async function globalSetup(): Promise<void> {
  await assertAuthoritativeSession();
}
