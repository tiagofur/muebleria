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
  active: true,
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
});
