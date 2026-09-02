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

function stubFetch(responses: Responder[]) {
  let call = 0;
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const respond = responses[Math.min(call, responses.length - 1)];
    if (!respond) throw new Error('no responder registered');
    call += 1;
    return respond(String(url), init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DevicesScreen (#460 SEC-6)', () => {
  it('approves through the canonical endpoint with an Idempotency-Key and reloads the directory', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch([
      () => jsonResponse({ devices: [] }),
      (_url, init) => {
        if (String(_url).endsWith('/auth/devices/approve')) {
          const key = new Headers(init?.headers).get('Idempotency-Key');
          expect(key).toMatch(/^web:/);
          return jsonResponse({ status: 'approved' });
        }
        return jsonResponse({}, 500);
      },
      () => jsonResponse({ devices: [device] }),
    ]);

    render(<DevicesScreen baseUrl="http://test" token="token-1" />);

    await user.type(await screen.findByLabelText(/Código de vinculación/i), 'k7m2qp');
    await user.click(screen.getByRole('button', { name: /Aprobar/i }));

    expect(await screen.findByText(/¡Dispositivo aprobado!/i)).toBeTruthy();
    expect(await screen.findByText('Mac del taller')).toBeTruthy();

    const approveCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/devices/approve'));
    expect(approveCall).toBeTruthy();
    expect(new Headers(approveCall?.[1]?.headers).get('Authorization')).toBe('Bearer token-1');
  });

  it('explains an already-used or expired code instead of a generic error', async () => {
    const user = userEvent.setup();
    stubFetch([
      () => jsonResponse({ devices: [] }),
      () => jsonResponse({ code: 'CONFLICT', message: 'conflict', fieldErrors: {}, requestId: '', retryable: false, details: {} }, 409),
    ]);

    render(<DevicesScreen baseUrl="http://test" token="token-1" />);
    await user.type(await screen.findByLabelText(/Código de vinculación/i), 'K7M2QP');
    await user.click(screen.getByRole('button', { name: /Aprobar/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/ya fue usado o expiró/i)).toBeTruthy();
  });

  it('revokes an active device and keeps revoked ones visible without a second action', async () => {
    const user = userEvent.setup();
    const revokedDevice = { ...device, revoked_at: '2026-09-01T15:00:00Z' };
    stubFetch([
      () => jsonResponse({ devices: [device] }),
      (_url, init) => {
        expect(String(_url).endsWith('/auth/devices/revoke')).toBe(true);
        expect(new Headers(init?.headers).get('Idempotency-Key')).toMatch(/^web:/);
        return jsonResponse({ revoked: true });
      },
      () => jsonResponse({ devices: [revokedDevice] }),
    ]);

    render(<DevicesScreen baseUrl="http://test" token="token-1" />);

    await user.click(await screen.findByRole('button', { name: /Revocar/i }));
    expect(await screen.findByText(/revocado/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Revocar/i })).toBeNull();
  });

  it('surfaces a load failure instead of presenting an empty directory', async () => {
    stubFetch([() => jsonResponse({}, 500)]);
    render(<DevicesScreen baseUrl="http://test" token="token-1" />);
    expect(await screen.findByText(/No se pudo cargar los dispositivos/i)).toBeTruthy();
  });
});
