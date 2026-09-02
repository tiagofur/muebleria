/**
 * Devices screen (#460 SEC-6).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DevicesScreen } from './DevicesScreen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const device = {
  id: '10000000-0000-0000-0000-000000000001',
  client_type: 'sketchup' as const,
  display_name: 'Mac del taller',
  created_at: '2026-09-01T12:00:00Z',
  last_seen_at: '2026-09-01T14:30:00Z',
  revoked_at: null,
};

type Responder = (url: string, init?: RequestInit) => Response;

function stubFetch(responder: Responder) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> =>
    responder(String(url), init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DevicesScreen (#460 SEC-6)', () => {
  it('approves through the canonical endpoint with an Idempotency-Key and reloads the directory', async () => {
    const user = userEvent.setup();
    let approveCalls = 0;
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith('/auth/devices')) return jsonResponse({ devices: approveCalls === 0 ? [] : [device] });
      if (url.endsWith('/auth/devices/approve')) {
        approveCalls += 1;
        const key = new Headers(init?.headers).get('Idempotency-Key');
        expect(key).toMatch(/^web:/);
        // #460 SEC-7: the first attempt answers the typed step-up challenge.
        if (approveCalls === 1) {
          return jsonResponse({ code: 'STEP_UP_REQUIRED', message: 'Confirmá tu identidad para continuar.', fieldErrors: {}, requestId: '', retryable: false, details: { scope: 'device_enrollment' } }, 403);
        }
        return jsonResponse({ status: 'approved' });
      }
      if (url.endsWith('/auth/mfa/step-up')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.scope).toBe('device_enrollment');
        return jsonResponse({ scope: 'device_enrollment', method: 'totp', expires_at: '2026-09-02T12:10:00Z' });
      }
      return jsonResponse({}, 500);
    });

    render(<DevicesScreen baseUrl="http://test" token="token-1" />);

    await user.type(await screen.findByLabelText(/Código de vinculación/i), 'k7m2qp');
    await user.click(screen.getByRole('button', { name: /Aprobar/i }));

    // The challenge modal is bound to this exact action.
    expect(await screen.findByTestId('step-up-modal')).toBeTruthy();
    await user.type(screen.getByLabelText(/Código de autenticación/i), '123456');
    await user.click(screen.getByRole('button', { name: /Verificar/i }));

    expect(await screen.findByText(/¡Dispositivo aprobado!/i)).toBeTruthy();
    expect(await screen.findByText('Mac del taller')).toBeTruthy();

    const approveCallsList = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/devices/approve'));
    expect(approveCallsList).toHaveLength(2);
    expect(new Headers(approveCallsList[0]?.[1]?.headers).get('Authorization')).toBe('Bearer token-1');
    // The retried command reuses the SAME Idempotency-Key.
    const keys = approveCallsList.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
    expect(keys[0]).toBe(keys[1]);
  });

  it('explains an already-used or expired code instead of a generic error', async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.endsWith('/auth/devices')) return jsonResponse({ devices: [] });
      return jsonResponse({ code: 'CONFLICT', message: 'conflict', fieldErrors: {}, requestId: '', retryable: false, details: {} }, 409);
    });

    render(<DevicesScreen baseUrl="http://test" token="token-1" />);
    await user.type(await screen.findByLabelText(/Código de vinculación/i), 'K7M2QP');
    await user.click(screen.getByRole('button', { name: /Aprobar/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/ya fue usado o expiró/i)).toBeTruthy();
  });

  it('revokes an active device and keeps revoked ones visible without a second action', async () => {
    const user = userEvent.setup();
    const revokedDevice = { ...device, revoked_at: '2026-09-01T15:00:00Z' };
    let revoked = false;
    stubFetch((url, init) => {
      if (url.endsWith('/auth/devices/revoke')) {
        expect(new Headers(init?.headers).get('Idempotency-Key')).toMatch(/^web:/);
        revoked = true;
        return jsonResponse({ revoked: true });
      }
      if (url.endsWith('/auth/devices')) {
        return jsonResponse({ devices: revoked ? [revokedDevice] : [device] });
      }
      return jsonResponse({}, 500);
    });

    render(<DevicesScreen baseUrl="http://test" token="token-1" />);

    await user.click(await screen.findByRole('button', { name: /Revocar/i }));
    expect(await screen.findByText(/revocado/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Revocar/i })).toBeNull();
  });

  it('surfaces a load failure instead of presenting an empty directory', async () => {
    stubFetch(() => jsonResponse({}, 500));
    render(<DevicesScreen baseUrl="http://test" token="token-1" />);
    expect(await screen.findByText(/No se pudo cargar los dispositivos/i)).toBeTruthy();
  });
});
