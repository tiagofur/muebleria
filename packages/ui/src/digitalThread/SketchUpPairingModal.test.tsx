// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SketchUpPairingModal } from './SketchUpPairingModal';

const API = 'http://api.test';
const PROJECT_ID = '11111111-0000-4000-8000-000000000001';
const DESIGN_ID = '22222222-0000-4000-8000-000000000001';
const GRANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CODE = 'ABCD234EFGH5';

type StatusKind = 'pending' | 'exchanged' | 'cancelled' | 'expired';

function renderModal(
  options: {
    status?: StatusKind;
    statusFailTimes?: number;
    onStatus?: () => void;
    onClose?: () => void;
    baseRevisionId?: string | null;
  } = {},
) {
  let statusCalls = 0;
  const calls = { create: 0, cancel: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.replace(API, '');

    if (method === 'POST' && /\/pairing-grants$/.test(path)) {
      calls.create += 1;
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({
          id: GRANT_ID,
          action: 'open_design',
          status: 'pending',
          base_revision_id: body.base_revision_id ?? null,
          code: CODE,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (method === 'GET' && path.endsWith(`/pairing-grants/${GRANT_ID}`)) {
      statusCalls += 1;
      options.onStatus?.();
      if (options.statusFailTimes && statusCalls <= options.statusFailTimes) {
        return new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'boom' }), {
          status: 500,
        });
      }
      return new Response(
        JSON.stringify({
          id: GRANT_ID,
          action: 'open_design',
          status: options.status ?? 'pending',
          base_revision_id: null,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          exchanged_at: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (method === 'POST' && path.endsWith(`/pairing-grants/${GRANT_ID}:cancel`)) {
      calls.cancel += 1;
      return new Response(
        JSON.stringify({
          id: GRANT_ID,
          action: 'open_design',
          status: 'cancelled',
          base_revision_id: null,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          exchanged_at: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `${method} ${path}` }), {
      status: 404,
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  const onClose = options.onClose ?? vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SketchUpPairingModal
        baseUrl={API}
        token="test-jwt-token"
        projectId={PROJECT_ID}
        designId={DESIGN_ID}
        baseRevisionId={options.baseRevisionId ?? null}
        baseRevisionLabel={options.baseRevisionId ? 'R1' : null}
        projectName="Obra Demo"
        designName="Cocina Principal"
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { fetchMock, calls, onClose };
}

describe('SketchUpPairingModal (#499 Slice 2 — Web pairing sheet)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates the grant and shows pending with code + copy + countdown', async () => {
    const { calls } = renderModal();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    expect(await screen.findByTestId('pairing-code')).toHaveTextContent('ABCD 234E FGH5');
    expect(screen.getByTestId('pairing-pending')).toHaveTextContent(
      /Esperando conexión con SketchUp/,
    );
    expect(calls.create).toBe(1);

    await user.click(screen.getByTestId('pairing-copy-btn'));
    await waitFor(() => expect(screen.getByText('¡Copiado!')).toBeInTheDocument());
  });

  it('exchanged reports code accepted — never a false "opened successfully"', async () => {
    renderModal({ status: 'exchanged' });

    expect(await screen.findByTestId('pairing-exchanged')).toHaveTextContent(
      /Código aceptado por SketchUp/,
    );
    expect(screen.queryByText(/abierto correctamente/i)).not.toBeInTheDocument();
  });

  it('expired surfaces the expiry and offers a NEW code (no revive)', async () => {
    const { calls } = renderModal({ status: 'expired' });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    expect(await screen.findByTestId('pairing-expired')).toHaveTextContent(/expiró/i);

    await user.click(screen.getByTestId('pairing-regenerate-btn'));
    await waitFor(() => expect(calls.create).toBe(2));
    // A terminal grant is never cancelled on regenerate.
    expect(calls.cancel).toBe(0);
  });

  it('a transient polling error keeps the grant pending (never derives expired)', async () => {
    renderModal({ statusFailTimes: 1 });

    expect(await screen.findByTestId('pairing-poll-error')).toBeInTheDocument();
    // The last KNOWN state stays pending; only the server may derive expiry.
    await waitFor(() => {
      expect(screen.getByTestId('pairing-pending')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pairing-expired')).not.toBeInTheDocument();
  });

  it('regenerate cancels the pending grant before minting the new one', async () => {
    const { calls } = renderModal();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await screen.findByTestId('pairing-code');
    await user.click(screen.getByTestId('pairing-regenerate-btn'));

    await waitFor(() => expect(calls.create).toBe(2));
    expect(calls.cancel).toBe(1);
  });

  it('closing while pending cancels the outstanding grant; closing after exchanged does not', async () => {
    const { calls, onClose } = renderModal();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await screen.findByTestId('pairing-code');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.cancel).toBe(1);

    // Second scenario: grant already exchanged → close must NOT cancel again.
    cleanup();
    const second = renderModal({ status: 'exchanged', onClose: vi.fn() });
    const user2 = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await screen.findByTestId('pairing-exchanged');
    await user2.keyboard('{Escape}');
    await waitFor(() => expect(second.onClose).toHaveBeenCalled());
    expect(second.calls.cancel).toBe(0);
  });
});
