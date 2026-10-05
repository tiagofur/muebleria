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

const PREVIEW_URL = 'http://api.test/auth/invitations:preview';
const ACCEPT_URL = 'http://api.test/auth/invitations:accept';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function previewOk(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    organization_name: 'Taller López',
    roles: ['admin'],
    email_masked: 'a•••@example.com',
    account_exists: true,
    ...overrides,
  });
}

function acceptOk() {
  return jsonResponse({
    token: 'org-scoped-token',
    user,
    license: { plan: 'pro', status: 'active' },
    roles: ['admin'],
    organization: { id: 'org-1', name: 'Taller', slug: 'taller', type: 'factory', status: 'active', license: { plan: 'pro', status: 'active' } },
    memberships: [],
    selection_required: false,
    transport: 'web',
  });
}

/** Route the component's fetches by path so preview and accept can differ. */
function fetchRouter(routes: Array<[string, (init: RequestInit) => Response | Promise<Response>]>) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    for (const [match, handler] of routes) {
      if (url.includes(match)) return handler(init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe('AcceptInvitationScreen lifecycle', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('verifies the token on mount and shows the workshop context before credentials', async () => {
    const fetchMock = fetchRouter([['/auth/invitations:preview', () => previewOk()]]);
    vi.stubGlobal('fetch', fetchMock);
    render(<AcceptInvitationScreen token=" invite-token " baseUrl="http://api.test" onAccepted={vi.fn()} />);

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Verificando la invitación');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(PREVIEW_URL, expect.objectContaining({ method: 'POST' })));
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({ token: 'invite-token' }));
    expect(screen.getByText(/Fuiste invitado a/)).toBeTruthy();
    expect(screen.getByText('Taller López')).toBeTruthy();
    expect(screen.getByText(/a•••@example\.com/)).toBeTruthy();
    expect(screen.getByLabelText('Tu contraseña *')).toBeTruthy();
  });

  it('accepts through the canonical endpoint and returns an org-scoped session', async () => {
    const onAccepted = vi.fn();
    const fetchMock = fetchRouter([
      ['/auth/invitations:preview', () => previewOk()],
      ['/auth/invitations:accept', () => acceptOk()],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();

    render(<AcceptInvitationScreen token=" invite-token " baseUrl="http://api.test" onAccepted={onAccepted} />);
    await actor.type(await screen.findByLabelText('Tu contraseña *'), 'correct-horse');
    await actor.click(screen.getByRole('button', { name: /Entrar al taller/ }));

    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ token: 'org-scoped-token', selection_required: false })));
    expect(fetchMock).toHaveBeenCalledWith(ACCEPT_URL, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'invite-token', password: 'correct-horse' }),
    }));
  });

  it('shows the expired state before rendering any form and recovers on retry', async () => {
    let expired = true;
    const fetchMock = fetchRouter([['/auth/invitations:preview', () => expired
      ? jsonResponse({ code: 'INVITATION_EXPIRED', message: 'expired', fieldErrors: {}, requestId: 'req-1', retryable: false, details: {} }, 410)
      : previewOk()]]);
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();
    render(<AcceptInvitationScreen token="old-token" baseUrl="http://api.test" onAccepted={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('venció');
    expect(screen.queryByLabelText(/contraseña/i)).toBeNull();

    expired = false;
    await actor.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Tu contraseña *')).toBeTruthy();
  });

  it('explains a rotated token instead of exposing a generic API message', async () => {
    vi.stubGlobal('fetch', fetchRouter([['/auth/invitations:preview', () => jsonResponse({
      code: 'INVITATION_TOKEN_ROTATED',
      message: 'rotated',
      fieldErrors: {},
      requestId: 'req-1',
      retryable: false,
      details: {},
    }, 409)]]));
    render(<AcceptInvitationScreen token="old-token" baseUrl="http://api.test" onAccepted={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('reemplazado por uno más reciente');
  });

  it('offers retry when the preview cannot reach the server', async () => {
    let failing = true;
    const fetchMock = fetchRouter([['/auth/invitations:preview', () => {
      if (failing) throw new TypeError('network down');
      return previewOk();
    }]]);
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();
    render(<AcceptInvitationScreen token="invite-token" baseUrl="http://api.test" onAccepted={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No se pudo verificar la invitación');

    failing = false;
    await actor.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Tu contraseña *')).toBeTruthy();
  });

  it('asks a new identity for name and a new password with concrete requirements', async () => {
    const fetchMock = fetchRouter([['/auth/invitations:preview', () => previewOk({ account_exists: false, roles: ['vendedor'] })]]);
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();

    render(<AcceptInvitationScreen token="invite-token" baseUrl="http://api.test" onAccepted={vi.fn()} />);
    const password = await screen.findByLabelText('Creá tu contraseña *');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Nombre completo')).toBeTruthy();
    expect(screen.getByText(/Mínimo 8 caracteres/)).toBeTruthy();

    await actor.type(password, 'correct-horse');
    await actor.click(screen.getByRole('button', { name: /Aceptar invitación y entrar/ }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ACCEPT_URL, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'invite-token', password: 'correct-horse' }),
    })));
  });

  it('lets an existing identity submit its legacy password without applying new-password rules in the browser', async () => {
    const fetchMock = fetchRouter([
      ['/auth/invitations:preview', () => previewOk()],
      ['/auth/invitations:accept', () => acceptOk()],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();
    render(<AcceptInvitationScreen token="invite-token" baseUrl="http://api.test" onAccepted={vi.fn()} />);

    const password = await screen.findByLabelText('Tu contraseña *');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(screen.queryByLabelText('Nombre completo')).toBeNull();

    await actor.type(password, 'weak');
    await actor.click(screen.getByRole('button', { name: /Entrar al taller/ }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ACCEPT_URL, expect.anything()));
  });

  it('supports keyboard navigation back to login and exposes the loading state', async () => {
    const onBackToLogin = vi.fn();
    let resolveAccept!: (value: Response) => void;
    const fetchMock = fetchRouter([
      ['/auth/invitations:preview', () => previewOk()],
      ['/auth/invitations:accept', () => new Promise<Response>((resolve) => {
        resolveAccept = resolve;
      })],
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const actor = userEvent.setup();
    render(
      <AcceptInvitationScreen
        token="invite-token"
        baseUrl="http://api.test"
        onAccepted={vi.fn()}
        onBackToLogin={onBackToLogin}
      />,
    );

    await actor.type(await screen.findByLabelText('Tu contraseña *'), 'correct-horse');
    const submit = screen.getByRole('button', { name: /Entrar al taller/ });
    await actor.click(submit);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    resolveAccept(new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }));
    await screen.findByRole('alert');

    const back = screen.getByRole('button', { name: 'Volver al inicio de sesión' });
    // En runners lentos el Enter puede dispararse antes de que el focus del
    // botón sobreviva al re-render del estado de error: reintenta la
    // interacción de teclado completa en lugar de relajar la aserción.
    await vi.waitFor(async () => {
      back.focus();
      await actor.keyboard('{Enter}');
      expect(onBackToLogin).toHaveBeenCalledOnce();
    });
  });
});
