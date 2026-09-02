/**
 * Security screen (#460 SEC-7): MFA enrollment, one-time recovery codes and
 * the step-up gated management actions.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecurityScreen } from './SecurityScreen';

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
  jsonResponse({ code, message: 'denied', fieldErrors: {}, requestId: '', retryable: false, details: {} }, status);

const provisioningUri =
  'otpauth://totp/Granete:ana@taller.mx?algorithm=SHA1&digits=6&issuer=Granete&period=30&secret=JBSWY3DPEHPK3PXP';

describe('SecurityScreen (#460 SEC-7)', () => {
  it('walks enrollment: begin → QR → verify → recovery codes shown exactly once', async () => {
    const user = userEvent.setup();
    const recoveryCodes = Array.from({ length: 10 }, (_, i) => `AAAAA-${String.fromCharCode(66 + i)}BBBB`);
    let factorId = '';
    const fetchMock = stubFetch((url) => {
      if (url.endsWith('/auth/mfa/factors') && factorId === '') return jsonResponse({ factors: [] });
      if (url.endsWith('/auth/mfa/totp:begin')) {
        factorId = 'f-1';
        return jsonResponse({ factor_id: 'f-1', provisioning_uri: provisioningUri, expires_at: '2026-09-02T12:15:00Z' }, 201);
      }
      if (url.endsWith('/auth/mfa/totp/f-1:verify')) {
        return jsonResponse({ factor_id: 'f-1', status: 'enabled', recovery_codes: recoveryCodes });
      }
      if (url.endsWith('/auth/mfa/factors')) {
        return jsonResponse({
          factors: [{ id: 'f-1', factor_type: 'totp', status: 'enabled', label: 'App de autenticación', created_at: '2026-09-02T12:00:00Z', enabled_at: '2026-09-02T12:01:00Z', last_used_at: null, pending_expires_at: null }],
        });
      }
      return jsonResponse({}, 500);
    });

    render(<SecurityScreen baseUrl="http://test" token="token-1" />);

    expect(await screen.findByTestId('mfa-empty')).toBeTruthy();
    await user.click(screen.getByTestId('mfa-begin'));

    // The one-time provisioning URI renders as a QR in memory (no storage).
    expect(await screen.findByTestId('mfa-qr')).toBeTruthy();
    expect(screen.queryByTestId('mfa-qr')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByText(provisioningUri)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Ya lo escaneé/i }));
    await user.type(screen.getByTestId('mfa-verify-input'), '123456');
    await user.click(screen.getByRole('button', { name: /Verificar y activar/i }));

    const codesPanel = await screen.findByTestId('recovery-codes-panel');
    expect(codesPanel).toBeTruthy();
    expect(screen.getAllByTestId('recovery-code')).toHaveLength(10);
    expect(screen.getByRole('button', { name: /Ya los guardé/i })).toBeTruthy();

    // Nothing persisted: the QR/codes live in component state exclusively.
    const storageKeys = (storage: Storage | null | undefined): string[] => {
      try {
        return storage ? Object.keys(storage) : [];
      } catch {
        return [];
      }
    };
    const storedSecrets = storageKeys(window.localStorage)
      .concat(storageKeys(window.sessionStorage))
      .filter((k) => k.toLowerCase().includes('secret') || k.toLowerCase().includes('otpauth') || k.toLowerCase().includes('recovery'));
    expect(storedSecrets).toEqual([]);

    await user.click(screen.getByRole('button', { name: /Ya los guardé/i }));
    expect(screen.queryByTestId('recovery-codes-panel')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(':verify'))).toHaveLength(1);
  });

  it('keeps a wrong code pending with the typed MFA_INVALID copy', async () => {
    const user = userEvent.setup();
    stubFetch((url) => {
      if (url.endsWith('/auth/mfa/totp:begin')) {
        return jsonResponse({ factor_id: 'f-1', provisioning_uri: provisioningUri, expires_at: '2026-09-02T12:15:00Z' }, 201);
      }
      if (url.endsWith('/auth/mfa/totp/f-1:verify')) return apiError('MFA_INVALID');
      if (url.endsWith('/auth/mfa/factors')) return jsonResponse({ factors: [] });
      return jsonResponse({}, 500);
    });
    render(<SecurityScreen baseUrl="http://test" token="token-1" />);
    await user.click(await screen.findByTestId('mfa-begin'));
    await user.click(await screen.findByRole('button', { name: /Ya lo escaneé/i }));
    await user.type(screen.getByTestId('mfa-verify-input'), '000000');
    await user.click(screen.getByRole('button', { name: /Verificar y activar/i }));
    expect(await screen.findByTestId('mfa-verify-error')).toBeTruthy();
    expect(screen.getByText(/Código inválido/i)).toBeTruthy();
  });

  it('regenerates recovery codes through a security_admin step-up with the same Idempotency-Key', async () => {
    const user = userEvent.setup();
    const enabledFactor = { id: 'f-1', factor_type: 'totp', status: 'enabled', label: '', created_at: '2026-09-02T12:00:00Z', enabled_at: '2026-09-02T12:01:00Z', last_used_at: null, pending_expires_at: null };
    const freshCodes = Array.from({ length: 10 }, (_, i) => `CCCCC-${i}DDDDD`);
    const regenerateKeys: (string | null)[] = [];
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith('/auth/mfa/factors')) return jsonResponse({ factors: [enabledFactor] });
      if (url.endsWith('/auth/mfa/recovery-codes:regenerate')) {
        regenerateKeys.push(new Headers(init?.headers).get('Idempotency-Key'));
        if (regenerateKeys.length === 1) return apiError('STEP_UP_REQUIRED');
        return jsonResponse({ recovery_codes: freshCodes });
      }
      if (url.endsWith('/auth/mfa/step-up')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.scope).toBe('security_admin');
        return jsonResponse({ scope: 'security_admin', method: 'totp', expires_at: '2026-09-02T12:10:00Z' });
      }
      return jsonResponse({}, 500);
    });

    render(<SecurityScreen baseUrl="http://test" token="token-1" />);
    await user.click(await screen.findByTestId('mfa-regenerate'));

    expect(await screen.findByTestId('step-up-modal')).toBeTruthy();
    await user.type(screen.getByLabelText(/Código de autenticación/i), '123456');
    await user.click(screen.getByRole('button', { name: /^Verificar$/i }));

    expect(await screen.findByTestId('recovery-codes-panel')).toBeTruthy();
    expect(screen.getAllByTestId('recovery-code')).toHaveLength(10);
    // The retry reused the original key: the challenge never consumed it.
    expect(regenerateKeys).toHaveLength(2);
    expect(regenerateKeys[0]).toBe(regenerateKeys[1]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith(':regenerate'))).toHaveLength(2);
  });

  it('lists configured factors with honest last-use metadata', async () => {
    stubFetch((url) => {
      if (url.endsWith('/auth/mfa/factors')) {
        return jsonResponse({
          factors: [
            { id: 'f-1', factor_type: 'totp', status: 'enabled', label: 'Teléfono personal', created_at: '2026-09-01T10:00:00Z', enabled_at: '2026-09-01T10:01:00Z', last_used_at: '2026-09-01T15:00:00Z', pending_expires_at: null },
            { id: 'f-2', factor_type: 'totp', status: 'pending', label: '', created_at: '2026-09-02T09:00:00Z', enabled_at: null, last_used_at: null, pending_expires_at: '2026-09-02T09:15:00Z' },
          ],
        });
      }
      return jsonResponse({}, 500);
    });
    render(<SecurityScreen baseUrl="http://test" token="token-1" />);
    const rows = await screen.findAllByTestId('mfa-factor-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText(/Teléfono personal/i)).toBeTruthy();
    expect(screen.getByText(/Configuración en curso/i)).toBeTruthy();
  });
  it('allows adding a second authenticator with step-up enrollment', async () => {
    const user = userEvent.setup();
    const enabledFactor = { id: 'f-1', factor_type: 'totp', status: 'enabled', label: 'Phone', created_at: '2026-09-02T12:00:00Z', enabled_at: '2026-09-02T12:01:00Z', last_used_at: null, pending_expires_at: null };
    let beginCalled = 0;
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith('/auth/mfa/factors')) {
        return jsonResponse({ factors: [enabledFactor] });
      }
      if (url.endsWith('/auth/mfa/totp:begin')) {
        beginCalled++;
        if (beginCalled === 1) return apiError('STEP_UP_REQUIRED');
        return jsonResponse({ factor_id: 'f-2', provisioning_uri: provisioningUri, expires_at: '2026-09-02T12:15:00Z' }, 201);
      }
      if (url.endsWith('/auth/mfa/step-up')) {
        return jsonResponse({ scope: 'security_admin', method: 'totp', expires_at: '2026-09-02T12:10:00Z' });
      }
      if (url.endsWith('/auth/mfa/totp/f-2:verify')) {
        return jsonResponse({ factor_id: 'f-2', status: 'enabled', recovery_codes: [] });
      }
      return jsonResponse({}, 500);
    });

    render(<SecurityScreen baseUrl="http://test" token="token-1" />);
    // The button says "Agregar app de autenticación"
    const btn = await screen.findByRole('button', { name: /Agregar app de autenticación/i });
    await user.click(btn);

    // Step-up modal appears
    expect(await screen.findByTestId('step-up-modal')).toBeTruthy();
    await user.type(screen.getByLabelText(/Código de autenticación/i), '123456');
    await user.click(screen.getByRole('button', { name: /^Verificar$/i }));

    // QR appears
    expect(await screen.findByTestId('mfa-qr')).toBeTruthy();
    
    // Verify
    await user.click(screen.getByRole('button', { name: /Ya lo escaneé/i }));
    await user.type(screen.getByTestId('mfa-verify-input'), '654321');
    await user.click(screen.getByRole('button', { name: /Verificar y activar/i }));
    
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/mfa/totp:begin'))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/mfa/step-up'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/mfa/totp/f-2:verify'))).toHaveLength(1);
  });

  it('retries the same pending factor if step-up expires between begin and verify', async () => {
    const user = userEvent.setup();
    let verifyCalled = 0;
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith('/auth/mfa/factors')) {
        return jsonResponse({ factors: [] }); // No factors initially
      }
      if (url.endsWith('/auth/mfa/totp:begin')) {
        return jsonResponse({ factor_id: 'f-pending', provisioning_uri: provisioningUri, expires_at: '2026-09-02T12:15:00Z' }, 201);
      }
      if (url.endsWith('/auth/mfa/step-up')) {
        return jsonResponse({ scope: 'security_admin', method: 'totp', expires_at: '2026-09-02T12:10:00Z' });
      }
      if (url.endsWith('/auth/mfa/totp/f-pending:verify')) {
        verifyCalled++;
        if (verifyCalled === 1) return apiError('STEP_UP_REQUIRED');
        return jsonResponse({ factor_id: 'f-pending', status: 'enabled', recovery_codes: [] });
      }
      return jsonResponse({}, 500);
    });

    render(<SecurityScreen baseUrl="http://test" token="token-1" />);
    const btn = await screen.findByRole('button', { name: /Configurar app de autenticación/i });
    await user.click(btn);

    // QR appears
    expect(await screen.findByTestId('mfa-qr')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Ya lo escaneé/i }));
    
    // First verify attempt triggers step-up
    await user.type(screen.getByTestId('mfa-verify-input'), '123456');
    await user.click(screen.getByRole('button', { name: /Verificar y activar/i }));

    // Step-up modal appears
    expect(await screen.findByTestId('step-up-modal')).toBeTruthy();
    await user.type(screen.getByLabelText(/Código de autenticación/i), '999999');
    await user.click(screen.getByRole('button', { name: /^Verificar$/i }));

    // Verification succeeds without requesting a new factor
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/mfa/totp:begin'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/mfa/totp/f-pending:verify'))).toHaveLength(2);
  });
});
