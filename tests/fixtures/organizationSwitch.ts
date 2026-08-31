import type { BrowserContext, Page, Route } from '@playwright/test';
import type { LoginResponse, MeResponse, TeamDirectory } from '@granete/storage';

export const ORG_A = '41111111-1111-4111-8111-111111111111';
export const ORG_B = '42222222-2222-4222-8222-222222222222';
export const TOKEN_A = 'browser-token-a';
export const TOKEN_B = 'browser-token-b';

const USER_ID = '21111111-1111-4111-8111-111111111111';
const NOW = '2026-08-30T12:00:00Z';
const organization = (tenant: 'A' | 'B') => ({
  id: tenant === 'A' ? ORG_A : ORG_B,
  name: `Taller ${tenant}`,
  slug: `taller-${tenant.toLowerCase()}`,
  type: 'factory' as const,
  status: 'active' as const,
  license: { plan: 'pro', status: 'active' },
});
const user = () => ({
  id: USER_ID,
  email: 'owner@example.test',
  normalized_email: 'owner@example.test',
  name: 'Owner',
  account_status: 'active' as const,
  email_verified_at: NOW,
  last_login_at: NOW,
  platform_admin: false,
  created_at: NOW,
  updated_at: NOW,
});
const memberships = (rolesB: readonly string[], includeB = true) => (includeB ? ['A', 'B'] as const : ['A'] as const).map((tenant) => ({
  id: tenant === 'A' ? '51111111-1111-4111-8111-111111111111' : '52222222-2222-4222-8222-222222222222',
  organization_id: tenant === 'A' ? ORG_A : ORG_B,
  user_id: USER_ID,
  status: 'active' as const,
  roles: tenant === 'A' ? ['admin'] : rolesB,
  joined_at: NOW,
  version: 2,
  organization: organization(tenant),
}));

function me(tenant: 'A' | 'B', rolesB: readonly string[], includeB = true): MeResponse {
  const roles = tenant === 'A' ? ['admin'] : rolesB;
  return {
    user: user(), roles, memberships: memberships(rolesB, includeB),
    organization: organization(tenant), transport: 'web',
    session_scope: {
      user_id: USER_ID,
      membership_id: tenant === 'A' ? '51111111-1111-4111-8111-111111111111' : '52222222-2222-4222-8222-222222222222',
      organization_id: tenant === 'A' ? ORG_A : ORG_B,
      mode: 'auth', support_session_id: null, recovery_session_id: null,
      membership_credential_version: 2, organization_credential_version: 3,
      absolute_expires_at: '2026-12-31T00:00:00Z',
    },
  };
}

function selection(rolesB: readonly string[]): LoginResponse {
  return {
    token: TOKEN_B, user: user(), license: { plan: 'pro', status: 'active' },
    roles: rolesB, organization: organization('B'), memberships: memberships(rolesB),
    selection_required: false, transport: 'web',
  };
}

function team(tenant: 'A' | 'B'): TeamDirectory {
  const name = tenant === 'A' ? 'Ana A' : 'Bruno B';
  return {
    items: [{
      membership_id: tenant === 'A' ? '61111111-1111-4111-8111-111111111111' : '62222222-2222-4222-8222-222222222222',
      user_id: tenant === 'A' ? '71111111-1111-4111-8111-111111111111' : '72222222-2222-4222-8222-222222222222',
      email: `${name.toLowerCase().replace(' ', '.')}@example.test`, name,
      account_status: 'active', membership_status: 'active', roles: ['vendedor'],
      joined_at: NOW, version: 2, last_activity: NOW, credential_version: 2,
      sessions_revoked_at: null, sectors: [], offboarding_blocking_count: 0,
    }],
    summary: {
      active_members: 1, suspended_members: 0, left_members: 0, max_active_members: 10,
      team_version: 2, entitlements_version: 2,
      capabilities: ['team:view', 'team:manage:all', 'team:revoke_sessions'],
    },
  };
}

export async function seedBrowserSession(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(({ token, userId }) => {
    sessionStorage.setItem('granete_session', 'auth');
    localStorage.setItem('muebles_has_seen_onboarding_v1', 'true');
    if (!localStorage.getItem('granete_token')) localStorage.setItem('granete_token', token);
    if (!localStorage.getItem('granete_user')) localStorage.setItem('granete_user', JSON.stringify({
      id: userId, email: 'owner@example.test', name: 'Owner', account_status: 'active', roles: ['admin'],
    }));
  }, { token: TOKEN_A, userId: USER_ID });
}

export type ApiRecorder = {
  readonly requests: Array<{ readonly path: string; readonly authorization: string }>;
  readonly teamAStarted: Promise<void>;
  releaseTeamA(): void;
};

export async function installOrganizationApi(
  page: Page,
  options: {
    readonly rolesB?: readonly string[];
    readonly delayTeamA?: boolean;
    readonly failTeam?: boolean;
    readonly selectFailure?: 'revoked' | 'forbidden' | 'network';
  } = {},
): Promise<ApiRecorder> {
  const rolesB = options.rolesB ?? ['admin'];
  const requests: Array<{ path: string; authorization: string }> = [];
  let releaseTeamA = () => undefined;
  let markTeamAStarted = () => undefined;
  let selectionSnapshotExpected = false;
  let refreshWithoutB = false;
  const teamAStarted = new Promise<void>((resolve) => { markTeamAStarted = resolve; });
  const teamAGate = new Promise<void>((resolve) => { releaseTeamA = resolve; });
  const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('http://localhost:8080/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const authorization = request.headers().authorization ?? '';
    const tenant = authorization === `Bearer ${TOKEN_B}` ? 'B' : 'A';
    requests.push({ path, authorization });
    if (path.endsWith('/auth/me')) {
      if (refreshWithoutB) return fulfill(route, me('A', rolesB, false));
      if (selectionSnapshotExpected) selectionSnapshotExpected = false;
      return fulfill(route, me(tenant, rolesB, !refreshWithoutB));
    }
    if (path.endsWith('/auth/select-org')) {
      if (options.selectFailure === 'network') return route.abort('connectionfailed');
      if (options.selectFailure) {
        refreshWithoutB = options.selectFailure === 'revoked';
        return fulfill(route, {
          code: options.selectFailure === 'revoked' ? 'MEMBERSHIP_NOT_SELECTABLE' : 'FORBIDDEN',
          message: 'selection denied', fieldErrors: {}, requestId: 'browser-select-denied',
          retryable: false, details: {},
        }, 403);
      }
      selectionSnapshotExpected = true;
      return fulfill(route, selection(rolesB));
    }
    if (path.endsWith('/org/memberships')) {
      if (options.failTeam) return fulfill(route, { code: 'INTERNAL_ERROR', message: 'failed', fieldErrors: {}, requestId: 'browser-500', retryable: false, details: {} }, 500);
      if (tenant === 'A' && options.delayTeamA) {
        markTeamAStarted();
        await teamAGate;
      }
      return fulfill(route, team(tenant)).catch(() => undefined);
    }
    if (path.endsWith('/catalog/modules')) return fulfill(route, [{
      id: `module-${tenant.toLowerCase()}`, code: `MOD-${tenant}`, name: `Mueble ${tenant}`,
      image_url: `/api/media/${tenant.toLowerCase()}.webp`, hardware_lines: [],
    }]);
    if (path.includes('/media/')) return route.fulfill({ status: 200, contentType: 'image/webp', body: '' });
    if (path.endsWith('/settings')) return fulfill(route, { workshop_name: `Taller ${tenant}` });
    if (path.endsWith('/project-templates')) return fulfill(route, []);
    return fulfill(route, []);
  });
  return { requests, teamAStarted, releaseTeamA: () => releaseTeamA() };
}

export async function installBroadcastRecorder(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    const messages: unknown[] = [];
    Object.defineProperty(window, '__sessionMessages', { value: messages });
    const NativeChannel = window.BroadcastChannel;
    window.BroadcastChannel = class extends NativeChannel {
      override postMessage(message: unknown): void {
        messages.push(message);
        super.postMessage(message);
      }
    };
  });
}
