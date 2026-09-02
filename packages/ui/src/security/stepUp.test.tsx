/**
 * Step-up challenge flow (#460 SEC-7).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraneteApiClient } from '@granete/storage';
import { useStepUp } from './stepUp';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Responder = (url: string, init?: RequestInit) => Response;

function stubFetch(responder: Responder) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> =>
    responder(String(url), init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const apiError = (code: string, status = 403) =>
  jsonResponse({ code, message: 'challenge', fieldErrors: {}, requestId: '', retryable: false, details: {} }, status);

function Harness({
  baseUrl,
  token,
  onResult,
}: {
  baseUrl: string;
  token: string;
  onResult: (result: unknown | null) => void;
}) {
  const stepUp = useStepUp({ baseUrl, token });
  const api = new GraneteApiClient(baseUrl);
  return (
    <div>
      {stepUp.modal}
      <button
        type="button"
        onClick={() => {
          void stepUp
            // A real gated command: the stubbed fetch decides whether the
            // first attempt is challenged.
            .run('device_enrollment', 'aprobar el dispositivo', (key) =>
              api.approveDeviceEnrollment(token, { code: 'K7M2QP' }, key))
            .then(onResult, (err: unknown) => onResult({ thrown: String(err) }));
        }}
      >
        Run sensitive
      </button>
      {stepUp.enrollmentRequired ? <p data-testid="enrollment-required" /> : null}
    </div>
  );
}

describe('useStepUp (#460 SEC-7)', () => {
  it('passes through when the command succeeds without a challenge', async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.endsWith('/auth/devices/approve')) return jsonResponse({ status: 'approved' });
      return jsonResponse({}, 500);
    });
    const results: unknown[] = [];
    render(<Harness baseUrl="http://test" token="token-1" onResult={(r) => results.push(r)} />);
    await user.click(screen.getByRole('button', { name: 'Run sensitive' }));
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ status: 'approved' });
    expect(screen.queryByTestId('step-up-modal')).toBeNull();
  });

  it('challenges, verifies, and retries the exact action under the SAME Idempotency-Key', async () => {
    const user = userEvent.setup();
    let approveCalls = 0;
    let approveKey = '';
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith('/auth/devices/approve')) {
        approveCalls += 1;
        approveKey = new Headers(init?.headers).get('Idempotency-Key') ?? '';
        if (approveCalls === 1) return apiError('STEP_UP_REQUIRED');
        return jsonResponse({ status: 'approved' });
      }
      if (url.endsWith('/auth/mfa/step-up')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.scope).toBe('device_enrollment');
        expect(body.method).toBe('totp');
        return jsonResponse({ scope: 'device_enrollment', method: 'totp', expires_at: '2026-09-02T12:00:00Z' });
      }
      return jsonResponse({}, 500);
    });

    const results: unknown[] = [];
    render(<Harness baseUrl="http://test" token="token-1" onResult={(r) => results.push(r)} />);
    await user.click(screen.getByRole('button', { name: 'Run sensitive' }));

    // The challenge modal is bound to the action; the code field is focused.
    expect(await screen.findByTestId('step-up-modal')).toBeTruthy();
    await user.type(screen.getByLabelText(/Código de autenticación/i), '123456');
    await user.click(screen.getByRole('button', { name: /Verificar/i }));

    await vi.waitFor(() => expect(results.length).toBe(1));
    expect(approveCalls).toBe(2);
    // Same key on both attempts: the challenge never consumed it.
    const keys = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/auth/devices/approve'))
      .map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^web:/);
    // The modal closed after the successful retry (the exit animation keeps
    // the node mounted for ~350ms, so wait for the disappearance).
    await vi.waitFor(() => expect(screen.queryByTestId('step-up-modal')).toBeNull());
  });

  it('cancel resolves null and forgets the typed code', async () => {
    const user = userEvent.setup();
    let approveCalls = 0;
    stubFetch((url) => {
      if (url.endsWith('/auth/devices/approve')) {
        approveCalls += 1;
        return apiError('STEP_UP_REQUIRED');
      }
      return jsonResponse({}, 500);
    });
    const results: unknown[] = [];
    render(<Harness baseUrl="http://test" token="token-1" onResult={(r) => results.push(r)} />);
    await user.click(screen.getByRole('button', { name: 'Run sensitive' }));
    await user.type(await screen.findByLabelText(/Código de autenticación/i), '123456');
    await user.click(screen.getByRole('button', { name: /Cancelar/i }));
    await vi.waitFor(() => expect(results).toEqual([null]));
    expect(approveCalls).toBe(1);
  });

  it('surfaces MFA_INVALID as an in-modal error without closing', async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.endsWith('/auth/devices/approve')) return apiError('STEP_UP_REQUIRED');
      if (url.endsWith('/auth/mfa/step-up')) return apiError('MFA_INVALID');
      return jsonResponse({}, 500);
    });
    render(<Harness baseUrl="http://test" token="token-1" onResult={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Run sensitive' }));
    await user.type(await screen.findByLabelText(/Código de autenticación/i), '000000');
    await user.click(screen.getByRole('button', { name: /Verificar/i }));
    expect(await screen.findByTestId('step-up-error')).toBeTruthy();
    expect(screen.getByText(/Código inválido/i)).toBeTruthy();
    expect(screen.getByTestId('step-up-modal')).toBeTruthy();
  });

  it('maps MFA_REQUIRED to the enrollment hint instead of a challenge loop', async () => {
    const user = userEvent.setup();
    stubFetch(() => apiError('MFA_REQUIRED'));
    const results: unknown[] = [];
    render(<Harness baseUrl="http://test" token="token-1" onResult={(r) => results.push(r)} />);
    await user.click(screen.getByRole('button', { name: 'Run sensitive' }));
    await vi.waitFor(() => expect(results).toEqual([null]));
    expect(await screen.findByTestId('enrollment-required')).toBeTruthy();
    expect(screen.queryByTestId('step-up-modal')).toBeNull();
  });
});
