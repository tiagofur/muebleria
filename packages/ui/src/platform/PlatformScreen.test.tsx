// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlatformScreen } from './PlatformScreen';

const organization = {
  id: 'org-1',
  name: 'Taller Norte',
  slug: 'taller-norte',
  type: 'factory',
  license_plan: 'pro',
  license_expires_at: null,
  status: 'active',
  member_count: 2,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
  version: 1,
};

describe('PlatformScreen audit UX', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exposes an audit endpoint failure and retries it explicitly', async () => {
    let auditAttempts = 0;
    let auditShouldFail = true;
    const jsonOk = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
        if (url.endsWith('/audit')) {
          auditAttempts += 1;
          if (auditShouldFail) throw new TypeError('network unavailable');
          return jsonOk([]);
        }
        return jsonOk([]);
      }),
    );
    const user = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    await user.click(await screen.findByRole('tab', { name: /Auditoría de Seguridad/ }));

    expect(await screen.findByText('No se pudo cargar la auditoría')).toBeTruthy();
    expect(screen.queryByText('No hay eventos de auditoría registrados para esta organización.')).toBeNull();

    auditShouldFail = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(auditAttempts).toBeGreaterThan(1));
    expect(await screen.findByText('No hay eventos de auditoría registrados para esta organización.')).toBeTruthy();
  });

  it('keeps global account authority in Platform and requires an audited reason', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const platformUser = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ana@example.com',
      name: 'Ana',
      platform_admin: false,
      account_status: 'active',
      created_at: '2026-08-29T00:00:00Z',
      memberships: [{ organization_id: 'org-1', organization_name: 'Taller Norte', organization_slug: 'taller-norte', roles: ['vendedor'], status: 'suspended', version: 2 }],
    };
    const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
      if (url.endsWith('/platform/users')) return jsonOk([platformUser]);
      if (url.includes(':set-account-status')) return jsonOk({ user_id: platformUser.id, account_status: 'disabled', updated_at: '2026-08-29T01:00:00Z' });
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    await actor.click(await screen.findByRole('tab', { name: /Usuarios Globales/ }));
    expect(await screen.findByText('Cuenta activa')).toBeTruthy();
    expect(screen.getByText(/suspended/)).toBeTruthy();
    await actor.click(screen.getByRole('button', { name: 'Deshabilitar cuenta' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar cambio' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await actor.type(screen.getByLabelText('Motivo *'), 'Cuenta comprometida');
    await actor.click(confirm);

    await waitFor(() => expect(requests.some(({ url }) => url.endsWith(`/platform/users/${platformUser.id}:set-account-status`))).toBe(true));
    const mutation = requests.find(({ url }) => url.includes(':set-account-status'))!;
    expect(new Headers(mutation.init?.headers).get('Idempotency-Key')).toBeTruthy();
    expect(mutation.init?.body).toBe(JSON.stringify({ account_status: 'disabled', reason: 'Cuenta comprometida' }));
  });

  it('provisions through the canonical command and confirms only authoritative readiness', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const bootstrapUser = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'owner@example.com',
      name: 'Ana Owner',
      platform_admin: false,
      account_status: 'active',
      created_at: '2026-08-30T00:00:00Z',
      memberships: [],
    };
    const provisioned = {
      ...organization,
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Taller Atómico',
      slug: 'taller-atomico',
      member_count: 1,
      version: 2,
    };
    const jsonOk = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/platform/organizations')) return jsonOk([organization]);
      if (url.endsWith('/platform/users')) return jsonOk([bootstrapUser]);
      if (url.endsWith('/organizations') && init?.method === 'POST') {
        return jsonOk({
          organization: provisioned,
          readiness: {
            organization_id: provisioned.id,
            organization_version: 2,
            ready: true,
            checks: [],
            checked_at: '2026-08-30T00:00:00Z',
          },
        }, 201);
      }
      return jsonOk([]);
    }));
    const actor = userEvent.setup();
    render(<PlatformScreen baseUrl="http://api.test" token="t" />);

    await actor.click(await screen.findByRole('button', { name: /Nueva Organización/ }));
    await actor.type(screen.getByLabelText(/Nombre del Taller/), 'Taller Atómico');
    await actor.clear(screen.getByLabelText(/Slug identificador/));
    await actor.type(screen.getByLabelText(/Slug identificador/), 'taller-atomico');
    await actor.selectOptions(await screen.findByLabelText(/Administrador inicial/), bootstrapUser.id);
    await actor.click(screen.getByRole('button', { name: /^Crear Organización$/ }));

    expect(await screen.findByText('✓ Organización activa y lista para operar')).toBeTruthy();
    const request = requests.find(({ url, init }) => url.endsWith('/organizations') && init?.method === 'POST');
    expect(request).toBeTruthy();
    expect(JSON.parse(String(request?.init?.body))).toEqual(expect.objectContaining({
      name: 'Taller Atómico',
      slug: 'taller-atomico',
      bootstrap_admin_user_id: bootstrapUser.id,
    }));
    expect(new Headers(request?.init?.headers).get('Idempotency-Key')).toMatch(/^web:/);
  });
});
