// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AcceptInvitationScreen } from './AcceptInvitationScreen';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@example.com',
  normalized_email: 'ana@example.com',
  name: 'Ana',
  account_status: 'active',
  email_verified_at: null,
  last_login_at: '2026-08-29T00:00:00Z',
  platform_admin: false,
  created_at: '2026-08-29T00:00:00Z',
  updated_at: '2026-08-29T00:00:00Z',
};

describe('AcceptInvitationScreen lifecycle', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('accepts through the canonical endpoint and returns an org-scoped session', async () => {
    const onAccepted = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      token: 'org-scoped-token',
      user,
      license: { plan: 'pro', status: 'active' },
      roles: ['vendedor'],
      organization: { id: 'org-1', name: 'Taller', slug: 'taller', type: 'factory', license: { plan: 'pro', status: 'active' } },
      memberships: [],
      selection_required: false,
      transport: 'web',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();

    render(<AcceptInvitationScreen token=" invite-token " baseUrl="http://api.test" onAccepted={onAccepted} />);
    await actor.type(screen.getByLabelText('Contraseña *'), 'correct-horse');
    await actor.click(screen.getByRole('button', { name: /Aceptar invitación y entrar/ }));

    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ token: 'org-scoped-token', selection_required: false })));
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/auth/invitations:accept', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'invite-token', password: 'correct-horse' }),
    }));
  });

  it('explains a rotated token instead of exposing a generic API message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'INVITATION_TOKEN_ROTATED',
      message: 'rotated',
      fieldErrors: {},
      requestId: 'req-1',
      retryable: false,
      details: {},
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
    const actor = userEvent.setup();
    render(<AcceptInvitationScreen token="old-token" baseUrl="http://api.test" onAccepted={vi.fn()} />);

    await actor.type(screen.getByLabelText('Contraseña *'), 'correct-horse');
    await actor.click(screen.getByRole('button', { name: /Aceptar invitación y entrar/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('reemplazado por uno más reciente');
    expect(document.activeElement).toBe(alert);
  });

  it('lets an existing identity submit its legacy password without applying new-password rules in the browser', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      token: 'org-scoped-token', user,
      license: { plan: 'none', status: 'none' }, roles: ['user'],
      organization: { id: 'org-1', name: 'Taller', slug: 'taller', type: 'factory', license: { plan: 'none', status: 'none' } },
      memberships: [], selection_required: false, transport: 'web',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();
    render(<AcceptInvitationScreen token="invite-token" baseUrl="http://api.test" onAccepted={vi.fn()} />);

    await actor.type(screen.getByLabelText('Contraseña *'), 'weak');
    await actor.click(screen.getByRole('button', { name: /Aceptar invitación y entrar/ }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it('supports keyboard navigation back to login and exposes the loading state', async () => {
    const onBackToLogin = vi.fn();
    let resolveRequest!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    })));
    const actor = userEvent.setup();
    render(
      <AcceptInvitationScreen
        token="invite-token"
        baseUrl="http://api.test"
        onAccepted={vi.fn()}
        onBackToLogin={onBackToLogin}
      />,
    );

    await actor.type(screen.getByLabelText('Contraseña *'), 'correct-horse');
    const submit = screen.getByRole('button', { name: /Aceptar invitación y entrar/ });
    await actor.click(submit);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    resolveRequest(new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }));
    await screen.findByRole('alert');

    const back = screen.getByRole('button', { name: 'Volver al inicio de sesión' });
    back.focus();
    await actor.keyboard('{Enter}');
    expect(onBackToLogin).toHaveBeenCalledOnce();
  });
});
