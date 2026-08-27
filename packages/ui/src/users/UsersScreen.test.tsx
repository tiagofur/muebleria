// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { roleLabelEs } from '@granete/domain';
import { UsersScreen } from './UsersScreen';

const here = dirname(fileURLToPath(import.meta.url));

describe('UsersScreen (F026 admin approval)', () => {
  it('calls admin users endpoints for list/approve/role/reject', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('/admin/users');
    expect(src).toContain('/approve');
    expect(src).toContain('/role');
    expect(src).toContain("method: 'PUT'");
    expect(src).toContain("method: 'DELETE'");
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
    id: 'u1',
    user_id: 'u1',
    name: 'Ana Pérez',
    email: 'ana@taller.com',
    roles: ['vendedor'],
    active: true,
  };

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
        if (url.includes('/org/team')) return jsonOk([member]);
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
});
