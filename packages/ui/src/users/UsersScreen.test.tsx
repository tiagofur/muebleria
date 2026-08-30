// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { roleLabelEs } from '@granete/domain';
import { UsersScreen } from './UsersScreen';

const here = dirname(fileURLToPath(import.meta.url));

describe('UsersScreen (F194 membership lifecycle)', () => {
  it('uses the generated team client without a list fallback', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');

    expect(src).toContain('api.listMemberships');
    expect(src).not.toContain('/admin/users/');
    expect(src).toContain('api.changeMembershipRoles');
    expect(src).toContain('api.suspendMembership');
    expect(src).toContain('api.reactivateMembership');
    // Los roles ofrecidos los pinea el contrato (ASSIGNABLE_ROLES) y los
    // cubren los tests de comportamiento de abajo; aquí sólo vigilamos que
    // no vuelvan labels legacy hardcodeadas al source.
    expect(src).not.toContain("'disenador'");
    expect(src).not.toContain("'carpintero'");
  });

  it('uses design tokens in users.css (no hardcoded hex)', () => {
    const css = readFileSync(join(here, 'users.css'), 'utf8');
    expect(css).toContain('var(--surface-card)');
    // badge colors now live in common/statusBadge.css (semantic vocabulary)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('renders roles as neutral meta-chip, not semantic badge (§5.2)', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('meta-chip');
    expect(src).not.toContain('users-role-badge');
    // users.css no longer defines the local role badge family
    const css = readFileSync(join(here, 'users.css'), 'utf8');
    expect(css).not.toContain('.users-role-badge');
  });

  it('uses PageLoading for async list load (issue #30)', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('PageLoading');
    expect(src).toContain('users-loading');
    expect(src).not.toMatch(/style=\{\{[^}]*textAlign/);
  });
});

describe('UsersScreen (licencia por organización, ADR-0005)', () => {
  it('no muta licencias por usuario: la licencia vive en la organización', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).not.toContain('/license');
    expect(src).not.toContain('license_plan');
    expect(src).not.toContain('LICENSE_PLANS');
    // El plan/trial/pro se gestiona desde la consola de plataforma (org).
  });
});

describe('UsersScreen (#326 roles por tipo de organización)', () => {
  it('filtra los roles asignables según el tipo de org activa', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('allowedRolesForOrgType');
    expect(src).toContain('assignableRoles');
    expect(src).toContain('orgType');
  });
});

describe('UsersScreen (roles canónicos, contracts/roles.json)', () => {
  const contract = JSON.parse(
    readFileSync(join(here, '../../../..', 'contracts/roles.json'), 'utf8'),
  ) as { canonicalRoles: string[]; rejectedRoles: string[] };

  const member = {
    membership_id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    name: 'Ana Pérez',
    email: 'ana@taller.com',
    roles: ['vendedor'],
    account_status: 'active',
    membership_status: 'active',
    joined_at: '2026-08-28T00:00:00Z',
    version: 1,
  };

  const teamDirectory = (items: readonly unknown[], capabilities = ['team:invite:sales', 'team:manage:all', 'team:revoke_sessions']) => ({
    items,
    summary: {
      active_members: items.filter((item: any) => item.membership_status === 'active').length,
      suspended_members: items.filter((item: any) => item.membership_status === 'suspended').length,
      left_members: items.filter((item: any) => item.membership_status === 'left').length,
      max_active_members: null,
      team_version: 1,
      entitlements_version: 1,
      capabilities,
    },
  });

  // Behavior (no source grep): la pantalla debe ofrecer exactamente lo que
  // el backend acepta — el contrato canónico filtrado por tipo de org.
  function stubTeamEndpoints() {
    const jsonOk = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/org/memberships')) return jsonOk(teamDirectory([member]));
        return jsonOk([]);
      }),
    );
  }

  async function openInviteModal(user: ReturnType<typeof userEvent.setup>) {
    // Header action comes first in the DOM; the empty-invitations state
    // renders another button with the same name.
    const buttons = await screen.findAllByRole('button', {
      name: /Invitar Miembro/i,
    });
    expect(buttons.length).toBeGreaterThan(0);
    await user.click(buttons[0]!);
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('invitation modal offers exactly the canonical roles minus user (factory)', async () => {
    stubTeamEndpoints();
    const user = userEvent.setup();
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);

    await openInviteModal(user);

    // Invitar crea una membresía con puesto real: 'user' no se ofrece.
    const expected = contract.canonicalRoles.filter((r) => r !== 'user');
    expect(screen.getAllByRole('checkbox')).toHaveLength(expected.length);
    for (const r of expected) {
      expect(screen.getByRole('checkbox', { name: roleLabelEs(r) })).toBeTruthy();
    }
    for (const rejected of contract.rejectedRoles) {
      expect(screen.queryByText(rejected, { exact: false })).toBeNull();
    }
  });

  it('traps keyboard focus in the invitation modal and restores it on Escape', async () => {
    stubTeamEndpoints();
    const actor = userEvent.setup();
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);

    const trigger = (await screen.findAllByRole('button', { name: /Invitar Miembro/i }))[0]!;
    trigger.focus();
    await actor.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Invitar Miembro al Taller' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await actor.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('invitation modal only offers the commercial roles a store may assign', async () => {
    stubTeamEndpoints();
    const user = userEvent.setup();
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="store" />);

    await openInviteModal(user);

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const r of ['admin', 'vendedor', 'gerente_ventas']) {
      expect(screen.getByRole('checkbox', { name: roleLabelEs(r) })).toBeTruthy();
    }
    for (const r of ['gerente_produccion', 'ingeniero', 'produccion', 'almacen']) {
      expect(screen.queryByRole('checkbox', { name: roleLabelEs(r) })).toBeNull();
    }
  });

  it('member role editor offers the full canonical set including user (factory)', async () => {
    stubTeamEndpoints();
    const user = userEvent.setup();
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);

    await user.click(await screen.findByTitle('Modificar roles'));

    expect(screen.getAllByRole('checkbox')).toHaveLength(contract.canonicalRoles.length);
    for (const r of contract.canonicalRoles) {
      expect(screen.getByRole('checkbox', { name: roleLabelEs(r) })).toBeTruthy();
    }
    for (const rejected of contract.rejectedRoles) {
      expect(screen.queryByText(rejected, { exact: false })).toBeNull();
    }
  });

  it('renders friendly labels through the domain roleLabelEs (single source)', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('roleLabelEs');
    expect(src).not.toContain('ROLE_LABELS');
  });

  it('renders account status separately from membership status', async () => {
    const jsonOk = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/org/memberships')) {
          return jsonOk(teamDirectory([{ ...member, account_status: 'disabled' }]));
        }
        return jsonOk([]);
      }),
    );

    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);

    expect(await screen.findByText('Cuenta deshabilitada')).toBeTruthy();
    expect(screen.getByText('Membresía activa')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Estado de cuenta' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Estado de membresía' })).toBeTruthy();
  });

  it('reactivates a suspended membership with the versioned membership command', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const jsonOk = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.includes('/org/memberships/11111111-1111-4111-8111-111111111111:reactivate')) {
          return jsonOk({
            membership_id: '11111111-1111-4111-8111-111111111111',
            user_id: '22222222-2222-4222-8222-222222222222',
            roles: ['vendedor'],
            status: 'active',
            version: 8,
          });
        }
        if (url.endsWith('/org/memberships')) {
          return jsonOk(teamDirectory([{ ...member, membership_status: 'suspended', version: 7 }]));
        }
        return jsonOk([]);
      }),
    );
    const user = userEvent.setup();
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);

    await user.click(await screen.findByRole('button', { name: /Membresías suspendidas/ }));
    await user.click(await screen.findByRole('button', { name: 'Reactivar membresía' }));

    await waitFor(() => {
      expect(requests.some(({ url }) => url.includes('/org/memberships/11111111-1111-4111-8111-111111111111:reactivate'))).toBe(true);
    });
    const mutation = requests.find(({ url }) => url.includes('/org/memberships/11111111-1111-4111-8111-111111111111:reactivate'))!;
    expect(mutation.url).not.toContain('/admin/users/');
    expect(mutation.init?.method).toBe('POST');
    expect(new Headers(mutation.init?.headers).get('If-Match')).toBe('"v7"');
    expect(mutation.init?.body).toBeUndefined();
  });

  it('resends an expired invitation with version and idempotency, exposing only the rotated link', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const invitation = {
      id: '33333333-3333-4333-8333-333333333333',
      organization_id: '44444444-4444-4444-8444-444444444444',
      email: 'new@example.com',
      status: 'expired',
      roles: ['vendedor'],
      expires_at: '2026-08-28T00:00:00Z',
      created_at: '2026-08-20T00:00:00Z',
      invited_by: null,
      accepted_at: null,
      accepted_by: null,
      revoked_at: null,
      revoked_by: null,
      revoked_reason: null,
      version: 4,
    } as const;
    const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/org/memberships')) return jsonOk(teamDirectory([]));
      if (url.endsWith('/org/invitations')) return jsonOk([invitation]);
      if (url.endsWith(`/${invitation.id}:resend`)) return jsonOk({
        invitation: { ...invitation, status: 'pending', version: 5, expires_at: '2026-09-12T00:00:00Z' },
        invitation_token: 'rotated-secret',
        accept_url: '/accept-invitation?token=rotated-secret',
      });
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);

    await actor.click(await screen.findByRole('button', { name: /Invitaciones \(1\)/ }));
    expect(await screen.findByText('Vencida')).toBeTruthy();
    await actor.click(screen.getByRole('button', { name: 'Reenviar' }));

    expect(await screen.findByText(/rotated-secret/)).toBeTruthy();
    const mutation = requests.find(({ url }) => url.endsWith(`/${invitation.id}:resend`))!;
    expect(new Headers(mutation.init?.headers).get('If-Match')).toBe('"v4"');
    expect(new Headers(mutation.init?.headers).get('Idempotency-Key')).toBeTruthy();
  });

  it('requires a reason before revoking an open invitation', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const invitation = {
      id: '55555555-5555-4555-8555-555555555555', organization_id: '44444444-4444-4444-8444-444444444444',
      email: 'pending@example.com', status: 'pending', roles: ['vendedor'], expires_at: '2026-09-12T00:00:00Z', created_at: '2026-08-29T00:00:00Z',
      invited_by: null, accepted_at: null, accepted_by: null, revoked_at: null, revoked_by: null, revoked_reason: null, version: 2,
    } as const;
    const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); requests.push({ url, init });
      if (url.endsWith('/org/memberships')) return jsonOk(teamDirectory([]));
      if (url.endsWith('/org/invitations')) return jsonOk([invitation]);
      if (url.endsWith(`/${invitation.id}:revoke`)) return jsonOk({ invitation: { ...invitation, status: 'revoked', revoked_at: '2026-08-29T01:00:00Z', revoked_reason: 'Duplicada', version: 3 } });
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);
    await actor.click(await screen.findByRole('button', { name: /Invitaciones \(1\)/ }));
    await actor.click(await screen.findByRole('button', { name: 'Revocar' }));
    const confirm = screen.getByRole('button', { name: 'Revocar invitación' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await actor.type(screen.getByLabelText('Motivo *'), 'Duplicada');
    await actor.click(confirm);
    await waitFor(() => expect(requests.some(({ url }) => url.endsWith(`/${invitation.id}:revoke`))).toBe(true));
    const mutation = requests.find(({ url }) => url.endsWith(`/${invitation.id}:revoke`))!;
    expect(new Headers(mutation.init?.headers).get('If-Match')).toBe('"v2"');
    expect(new Headers(mutation.init?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(mutation.init?.body).toBe(JSON.stringify({ reason: 'Duplicada' }));
  });
});

describe('UsersScreen (#451 safe team boundary)', () => {
  const member = {
    membership_id: '11111111-1111-4111-8111-111111111111', user_id: '22222222-2222-4222-8222-222222222222',
    name: 'Ana Pérez', email: 'ana@taller.com', roles: ['vendedor'], account_status: 'active', membership_status: 'active', joined_at: '2026-08-28T00:00:00Z', version: 1,
  } as const;
  const directory = (capabilities: string[], maxActiveMembers: number | null) => ({
    items: [member], summary: { active_members: 1, suspended_members: 0, left_members: 0, max_active_members: maxActiveMembers, team_version: 4, entitlements_version: 2, capabilities },
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the authoritative seat summary, including an explicit unlimited limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/org/memberships')
      ? new Response(JSON.stringify(directory(['team:view'], null)), { status: 200 })
      : new Response(JSON.stringify([]), { status: 200 })));
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);
    expect((await screen.findByLabelText('Resumen del equipo')).textContent).toContain('1 activos');
    expect(screen.getByLabelText('Resumen del equipo').textContent).toContain('Sin límite de miembros');
  });

  it('does not render mutation controls when the server grants only team:view', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/org/memberships')
      ? new Response(JSON.stringify(directory(['team:view'], 5)), { status: 200 })
      : new Response(JSON.stringify([]), { status: 200 })));
    render(<UsersScreen baseUrl="http://api.test" token="t" orgType="factory" />);
    await screen.findByText('Ana Pérez');
    expect(screen.queryByRole('button', { name: /Invitar miembro/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Modificar roles/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Suspender membresía/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revocar sesiones/i })).toBeNull();
  });
});
