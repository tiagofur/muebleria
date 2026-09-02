import { APIWorkspaceRepository, GraneteApiClient } from '@granete/storage';

export const GATE_MODULE_A_ID = 'a1111111-1111-4111-8111-111111111111';
export const GATE_MODULE_B_ID = 'b2222222-2222-4222-8222-222222222222';
export const LIFECYCLE_SUBJECT_EMAIL = 'browser-gate-lifecycle@example.com';

// #460 SEC-3: canonical server media names — the gate writes these files into
// each organization's media partition, so the browser exercises the real
// signed-grant media flow (never a session JWT in the URL).
export const GATE_MEDIA_A_URL = '/api/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
export const GATE_MEDIA_B_URL = '/api/media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png';

export interface LifecycleSubject {
  readonly email: string;
  readonly organizationAId: string;
  readonly organizationBId: string;
  readonly membershipAId: string;
  readonly membershipBId: string;
  readonly membershipBVersion: number;
  readonly bOwnerToken: string;
}

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the organization browser gate`);
  return value;
}

async function login(email: string, organizationSlug: string) {
  return new GraneteApiClient(required('ORGANIZATION_API_BASE')).login({
    email, password: required('ORGANIZATION_GATE_PASSWORD'), transport: 'web', org: organizationSlug,
  });
}

async function seedDistinctModule(token: string, id: string, tenant: 'A' | 'B'): Promise<void> {
  // #460 SEC-4B: el repository recibe el access por dependencia de memoria;
  // el mock de localStorage ya no existe (never storage).
  const repository = new APIWorkspaceRepository(required('ORGANIZATION_API_BASE'), {
    getAccessToken: () => token,
  });
  const catalog = await repository.getCatalog();
  const template = catalog.modules[0];
  await repository.saveCatalog({ ...catalog, modules: [{
    ...template, id, code: `GATE-${tenant}`, name: `Mueble real ${tenant}`, hardwareLines: template?.hardwareLines ?? [],
    imageUrl: tenant === 'A' ? GATE_MEDIA_A_URL : GATE_MEDIA_B_URL,
  }] });
}

export async function prepareAuthoritativeOrganizations(): Promise<void> {
  const email = required('ORGANIZATION_GATE_EMAIL');
  const aOwner = await login(required('ORGANIZATION_GATE_A_OWNER_EMAIL'), required('ORGANIZATION_GATE_ORG_A_SLUG'));
  const bOwner = await login(required('ORGANIZATION_GATE_B_OWNER_EMAIL'), required('ORGANIZATION_GATE_ORG_B_SLUG'));
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  if (!aOwner.organization || !bOwner.organization) throw new Error('gate owner organization is missing');
  for (const [token, organizationId] of [[aOwner.token, aOwner.organization.id], [aOwner.token, bOwner.organization.id]]) {
    const current = await client.getOrganizationEntitlements(token, organizationId);
    await client.updateOrganizationEntitlements(token, organizationId, current.version, {
      max_active_members: 3,
      max_sales_partners: current.max_sales_partners,
      manufacturing_enabled: current.manufacturing_enabled,
      sales_network_enabled: current.sales_network_enabled,
      sketchup_seats: current.sketchup_seats,
      advanced_audit_enabled: current.advanced_audit_enabled,
    });
  }
  const invitationA = await client.createInvitation(aOwner.token, { email, roles: ['admin'] }, 'browser-gate-a-invite');
  const a = await client.acceptInvitation({
    token: invitationA.invitation_token, password: required('ORGANIZATION_GATE_PASSWORD'), name: 'Browser Gate Subject',
  }, 'browser-gate-a-accept');
  const invitationB = await client.createInvitation(bOwner.token, { email, roles: ['vendedor'] }, 'browser-gate-b-invite');
  const b = await client.acceptInvitation({
    token: invitationB.invitation_token, password: required('ORGANIZATION_GATE_PASSWORD'),
  }, 'browser-gate-b-accept');
  const [snapshotA, snapshotB] = await Promise.all([client.getSession(a.token), client.getSession(b.token)]);
  const membershipSlugs = snapshotA.memberships.map(({ organization }) => organization.slug).sort();
  if (
    !a.organization || !b.organization
    || snapshotA.user.id !== snapshotB.user.id
    || !snapshotA.roles.includes('admin')
    || snapshotB.roles.length !== 1 || snapshotB.roles[0] !== 'vendedor'
    || snapshotA.session_scope.organization_id !== a.organization.id
    || snapshotB.session_scope.organization_id !== b.organization.id
    || membershipSlugs.join(',') !== 'browser-gate-a,browser-gate-b'
  ) throw new Error('real gate subject is not authoritative A admin / B vendedor');
  await seedDistinctModule(aOwner.token, GATE_MODULE_A_ID, 'A');
  await seedDistinctModule(bOwner.token, GATE_MODULE_B_ID, 'B');
}

export async function assertAuthoritativeSession(): Promise<void> {
  const a = await login(required('ORGANIZATION_GATE_EMAIL'), required('ORGANIZATION_GATE_ORG_A_SLUG'));
  const snapshot = await new GraneteApiClient(required('ORGANIZATION_API_BASE')).getSession(a.token);
  if (!a.organization || snapshot.session_scope.organization_id !== a.organization.id) {
    throw new Error('authoritative /auth/me snapshot does not match organization A');
  }
}

export async function prepareLifecycleSubject(): Promise<LifecycleSubject> {
  const password = required('ORGANIZATION_GATE_PASSWORD');
  const client = new GraneteApiClient(required('ORGANIZATION_API_BASE'));
  const aOwner = await login(required('ORGANIZATION_GATE_A_OWNER_EMAIL'), required('ORGANIZATION_GATE_ORG_A_SLUG'));
  const bOwner = await login(required('ORGANIZATION_GATE_B_OWNER_EMAIL'), required('ORGANIZATION_GATE_ORG_B_SLUG'));
  const invitationA = await client.createInvitation(aOwner.token, {
    email: LIFECYCLE_SUBJECT_EMAIL, roles: ['admin'],
  }, 'browser-gate-lifecycle-a-invite');
  await client.acceptInvitation({
    token: invitationA.invitation_token, password, name: 'Browser Gate Lifecycle',
  }, 'browser-gate-lifecycle-a-accept');
  const invitationB = await client.createInvitation(bOwner.token, {
    email: LIFECYCLE_SUBJECT_EMAIL, roles: ['vendedor'],
  }, 'browser-gate-lifecycle-b-invite');
  await client.acceptInvitation({
    token: invitationB.invitation_token, password,
  }, 'browser-gate-lifecycle-b-accept');

  const [a, b, teamA, teamB] = await Promise.all([
    login(LIFECYCLE_SUBJECT_EMAIL, required('ORGANIZATION_GATE_ORG_A_SLUG')),
    login(LIFECYCLE_SUBJECT_EMAIL, required('ORGANIZATION_GATE_ORG_B_SLUG')),
    client.listMemberships(aOwner.token),
    client.listMemberships(bOwner.token),
  ]);
  const memberA = teamA.items.find(({ email }) => email === LIFECYCLE_SUBJECT_EMAIL);
  const memberB = teamB.items.find(({ email }) => email === LIFECYCLE_SUBJECT_EMAIL);
  if (
    !a.organization || !b.organization || !memberA || !memberB
    || memberA.membership_status !== 'active' || memberA.roles.join(',') !== 'admin'
    || memberB.membership_status !== 'active' || memberB.roles.join(',') !== 'vendedor'
    || a.memberships.map(({ organization }) => organization.slug).sort().join(',') !== 'browser-gate-a,browser-gate-b'
  ) throw new Error('lifecycle subject is not authoritative A admin / B vendedor');
  return {
    email: LIFECYCLE_SUBJECT_EMAIL,
    organizationAId: a.organization.id,
    organizationBId: b.organization.id,
    membershipAId: memberA.membership_id,
    membershipBId: memberB.membership_id,
    membershipBVersion: memberB.version,
    bOwnerToken: bOwner.token,
  };
}
