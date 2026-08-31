import { GraneteApiClient } from '@granete/storage';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the organization browser gate`);
  return value;
}

export async function assertAuthoritativeSession(): Promise<void> {
  const email = required('ORGANIZATION_GATE_EMAIL');
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  const login = await client.login({
    email,
    password: required('ORGANIZATION_GATE_PASSWORD'),
    transport: 'web',
    org: required('ORGANIZATION_GATE_ORG_SLUG'),
  });
  const snapshot = await client.getSession(login.token);
  if (
    !login.organization
    || !snapshot.organization
    || !snapshot.session_scope.organization_id
    || !snapshot.session_scope.membership_id
    || snapshot.user.email !== email
    || snapshot.session_scope.user_id !== login.user.id
    || snapshot.session_scope.organization_id !== login.organization.id
    || snapshot.organization.id !== login.organization.id
  ) {
    throw new Error('authoritative /auth/me snapshot does not match the login session');
  }
}
