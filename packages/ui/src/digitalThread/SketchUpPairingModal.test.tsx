// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SketchUpPairingModal } from './SketchUpPairingModal';

const API = 'http://api.test';
const PROJECT_ID = '11111111-0000-4000-8000-000000000001';
const DESIGN_ID = '22222222-0000-4000-8000-000000000001';
const GRANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CODE = 'ABCD234EFGH5';

type StatusKind = 'pending' | 'exchanged' | 'confirmed' | 'cancelled' | 'expired';

function renderModal(
  options: {
    status?: StatusKind;
    /** Consecutive poll answers in order; falls back to `status` when exhausted. */
    statusSequence?: StatusKind[];
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
      const status = options.statusSequence?.[statusCalls - 1] ?? options.status ?? 'pending';
      return new Response(
        JSON.stringify({
          id: GRANT_ID,
          action: 'open_design',
          status,
          confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
          base_revision_id: null,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          exchanged_at: status === 'exchanged' || status === 'confirmed' ? new Date().toISOString() : null,
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
    await waitFor(() => expect(calls.cancel).toBe(1));

    // Second scenario: grant already exchanged → close must NOT cancel again.
    cleanup();
    const second = renderModal({ status: 'exchanged', onClose: vi.fn() });
    const user2 = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await screen.findByTestId('pairing-exchanged');
    await user2.keyboard('{Escape}');
    await waitFor(() => expect(second.onClose).toHaveBeenCalled());
    expect(second.calls.cancel).toBe(0);
  });

  it('cancels when Escape reaches the listener registered before grant creation completes', async () => {
    let initialKeydownListener: EventListener | null = null;
    const addEventListener = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'keydown' && initialKeydownListener === null) {
        initialKeydownListener = listener as EventListener;
      }
      addEventListener(type, listener, options);
    });

    const { calls, onClose } = renderModal();

    await screen.findByTestId('pairing-code');
    expect(initialKeydownListener).not.toBeNull();

    act(() => {
      initialKeydownListener?.(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await waitFor(() => expect(calls.cancel).toBe(1));
  });
});

describe('SketchUpPairingModal — confirmation wording (#499 Slice 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('confirmed shows the linked wording only after the plugin proved the binding', async () => {
    const { calls, onClose } = renderModal({ status: 'confirmed' });

    expect(await screen.findByTestId('pairing-confirmed')).toHaveTextContent(
      'Diseño vinculado en SketchUp',
    );
    // Not claimed: the sheet never says the model was saved or that a
    // revision was published — publishing lives in the plugin flow.
    expect(screen.queryByText(/modelo guardado/i)).not.toBeInTheDocument();
    // A confirmed grant is terminal: closing must never cancel it.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.cancel).toBe(0);
  });

  it('keeps polling after exchanged so a late plugin confirm still reaches "Diseño vinculado"', async () => {
    // Real sequence: a poll observes the intermediate `exchanged` state
    // before the plugin commits the binding. Exchanged is NOT final — the
    // sheet must keep polling and surface the eventual confirmation instead
    // of freezing on "Código aceptado por SketchUp" (CI race on the #499
    // confirmed-handoff browser gate).
    renderModal({ statusSequence: ['exchanged', 'exchanged', 'confirmed'] });

    expect(await screen.findByTestId('pairing-exchanged')).toHaveTextContent(
      /Código aceptado por SketchUp/,
    );
    // Poll 2 (t=4s) still sees exchanged; poll 3 (t=8s) sees the confirm.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    expect(screen.getByTestId('pairing-exchanged')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    expect(await screen.findByTestId('pairing-confirmed')).toHaveTextContent(
      'Diseño vinculado en SketchUp',
    );
    expect(screen.queryByTestId('pairing-exchanged')).not.toBeInTheDocument();
  });
});
