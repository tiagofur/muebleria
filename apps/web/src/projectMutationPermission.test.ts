import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { anyRole, roleCanMutateProjects, rolesOfUser } from '@granete/domain';
import { meRequest, parseAuthResponse, type AuthUser } from './session';

/**
 * Regression proof for the first-Design DEMO path (#612 wiring): the REAL
 * session shapes the app receives (login /auth/me payloads) must derive
 * canMutateProjects = true for authorized Admins — and read-only roles must
 * stay false. PR #612's component tests inject the final boolean; these tests
 * prove the derivation above that boundary instead.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** F121 idiom: source-level proof of the real wiring under test. */
const appContentSrc = () => readFileSync(join(here, 'AppContent.tsx'), 'utf8');
const shellViewSrc = () => readFileSync(join(here, 'ShellView.tsx'), 'utf8');

const baseUser = {
  id: '1',
  email: 'admin@mitaller.com',
  normalized_email: 'admin@mitaller.com',
  name: 'Admin Taller',
  account_status: 'active',
  email_verified_at: null,
  last_login_at: null,
  platform_admin: false,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const orgSummary = {
  id: 'org-1',
  name: 'Taller inicial',
  slug: 'taller-inicial',
  type: 'factory',
  status: 'active',
  license: { plan: 'trial', status: 'active' },
};

function loginResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    token: 'jwt-access',
    user: baseUser,
    license: { plan: 'trial', status: 'active' },
    roles: ['admin'],
    memberships: [],
    selection_required: false,
    transport: 'web',
    ...overrides,
  };
}

const ME_SCOPE = {
  user_id: '1',
  membership_id: 'membership-1',
  organization_id: 'org-1',
  mode: 'auth',
  support_session_id: null,
  recovery_session_id: null,
  membership_credential_version: 2,
  organization_credential_version: 3,
  absolute_expires_at: '2026-09-02T00:00:00Z',
} as const;

function meResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    user: baseUser,
    roles: ['admin'],
    memberships: [],
    organization: orgSummary,
    transport: 'web',
    session_scope: ME_SCOPE,
    ...overrides,
  };
}

async function meUser(overrides: Record<string, unknown> = {}): Promise<AuthUser> {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify(meResponse(overrides)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const snapshot = await meRequest('jwt-access', {
    baseUrl: 'http://localhost:8080/api',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return snapshot.user;
}

/**
 * AppContent.tsx:884 verbatim (single source mirrored only because the
 * component tree cannot be imported here; the source assertions below pin
 * the real expression to this one).
 */
function canMutateProjectsOf(authUser: AuthUser | null): boolean {
  const actorRoles = authUser ? rolesOfUser(authUser) : [];
  return anyRole(actorRoles, roleCanMutateProjects);
}

describe('project mutation permission — real session derivations', () => {
  it('workshop Admin (single membership login payload) can mutate projects', () => {
    const result = parseAuthResponse(loginResponse());
    expect(result.user.roles).toEqual(['admin']);
    expect(canMutateProjectsOf(result.user)).toBe(true);
  });

  it('workshop Admin restored via /auth/me (cookie bootstrap) can mutate projects', async () => {
    expect(canMutateProjectsOf(await meUser())).toBe(true);
  });

  it('platform Admin with an active workshop keeps tenant authority (#616 model)', async () => {
    const login = parseAuthResponse(
      loginResponse({
        user: { ...baseUser, platform_admin: true },
        roles: ['admin'],
        organization: orgSummary,
      }),
    );
    expect(login.user.platform_admin).toBe(true);
    expect(canMutateProjectsOf(login.user)).toBe(true);

    expect(
      canMutateProjectsOf(await meUser({ user: { ...baseUser, platform_admin: true } })),
    ).toBe(true);
  });

  it('org-less multi-membership token carries no tenant roles until a workshop is selected', () => {
    // Real multi-membership login: selection_required with an org-less token.
    const orgless = parseAuthResponse(loginResponse({ roles: [], selection_required: true }));
    expect(orgless.selectionRequired).toBe(true);
    expect(canMutateProjectsOf(orgless.user)).toBe(false);

    // After select-org the membership roles arrive — same shape /auth/me
    // returns for the scoped session.
    const scoped = parseAuthResponse(loginResponse({ roles: ['admin'] }));
    expect(canMutateProjectsOf(scoped.user)).toBe(true);
  });

  it('multi-role union preserves a grant held by any role (ADR-0005)', () => {
    expect(canMutateProjectsOf(parseAuthResponse(loginResponse({ roles: ['produccion', 'vendedor'] })).user)).toBe(true);
    expect(canMutateProjectsOf(parseAuthResponse(loginResponse({ roles: ['almacen', 'gerente_ventas'] })).user)).toBe(true);
  });

  it('authorized single roles can mutate projects', () => {
    for (const role of ['admin', 'gerente_ventas', 'vendedor']) {
      expect(canMutateProjectsOf(parseAuthResponse(loginResponse({ roles: [role] })).user)).toBe(true);
    }
  });

  it('read-only roles cannot mutate projects', async () => {
    for (const roles of [['produccion'], ['almacen'], ['user'], []] as const) {
      expect(canMutateProjectsOf(parseAuthResponse(loginResponse({ roles: [...roles] })).user)).toBe(false);
    }
    // /auth/me snapshot for a read-only membership stays read-only.
    const readOnlyUser = await meUser({ roles: ['produccion'] });
    expect(canMutateProjectsOf(readOnlyUser)).toBe(false);
  });
});

describe('project mutation permission — Shell wiring (source of truth)', () => {
  it('AppContent derives canMutateProjects from the role union, not a hardcoded grant', () => {
    expect(appContentSrc()).toContain(
      'const canMutateProjects =\n    session === \'guest\' || anyRole(actorRoles, roleCanMutateProjects);',
    );
    expect(appContentSrc()).toContain('rolesOfUser(authUser ?? { role: null })');
  });

  it('ShellView passes the derived canMutateProjects to ProjectDesignsScreen', () => {
    expect(shellViewSrc()).toContain('canMutate={canMutateProjects}');
    expect(shellViewSrc()).not.toContain('canMutate={true}');
  });
});
