import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetWebAuthRuntimeForTests,
  absoluteSessionExpiresAtMs,
  accessExpiresInMs,
  applySupportCredential,
  applyWebCredential,
  clearCredential,
  credentialGeneration,
  getAccessToken,
  getCredential,
  isSameCredentialScope,
} from './webAuthRuntime';

const IN_15M = new Date(Date.now() + 15 * 60_000).toISOString();
const IN_18H = new Date(Date.now() + 18 * 3_600_000).toISOString();

function applyWeb(token = 'access-1', organizationId: string | null = 'org-1') {
  return applyWebCredential({
    accessToken: token,
    accessExpiresAt: IN_15M,
    absoluteSessionExpiresAt: IN_18H,
    sessionId: 'sess-1',
    userId: 'user-1',
    organizationId,
  });
}

afterEach(() => {
  __resetWebAuthRuntimeForTests();
});

describe('webAuthRuntime — autoridad de credential en memoria (SEC-4B)', () => {
  it('anonymous por defecto: sin token, sin snapshot', () => {
    expect(getCredential()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('applyWebCredential guarda el access SÓLO en memoria con generación monotónica', () => {
    const first = applyWeb('access-1');
    expect(first.generation).toBeGreaterThan(0);
    expect(getAccessToken()).toBe('access-1');
    expect(getCredential()).toMatchObject({
      kind: 'web',
      sessionId: 'sess-1',
      organizationId: 'org-1',
    });

    const second = applyWeb('access-2');
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(getAccessToken()).toBe('access-2');
  });

  it('support y web nunca se confunden: un slot, kinds distintos', () => {
    applyWeb('web-access');
    const support = applySupportCredential({
      accessToken: 'support-access',
      accessExpiresAt: IN_15M,
      sessionId: 'support-session-1',
      organizationId: 'org-support',
    });
    expect(getCredential()).toMatchObject({ kind: 'support' });
    expect(support.generation).toBeGreaterThan(0);
    expect(getAccessToken()).toBe('support-access');
  });

  it('clearCredential bump-ea la generación: una response tardía no revive la sesión', () => {
    const snapshot = applyWeb('access-1');
    expect(isSameCredentialScope(snapshot)).toBe(true);
    clearCredential();
    expect(getCredential()).toBeNull();
    expect(isSameCredentialScope(snapshot)).toBe(false);
    // Un credential nuevo NUNCA puede coincidir con la generación muerta.
    const reborn = applyWeb('access-2');
    expect(reborn.generation).toBeGreaterThan(snapshot.generation);
    expect(isSameCredentialScope(snapshot)).toBe(false);
  });

  it('expiry helpers leen la metadata del server, no el JWT', () => {
    applyWeb();
    expect(accessExpiresInMs()).toBeGreaterThan(14 * 60_000);
    expect(accessExpiresInMs()).toBeLessThan(16 * 60_000);
    expect(absoluteSessionExpiresAtMs()).toBeGreaterThan(17 * 3_600_000);
    // Support no tiene deadline absoluto de sesión web.
    applySupportCredential({
      accessToken: 's',
      accessExpiresAt: IN_15M,
      sessionId: 's1',
      organizationId: 'o',
    });
    expect(absoluteSessionExpiresAtMs()).toBeNull();
  });

  it('credentialGeneration avanza en cada cambio (late-response guards)', () => {
    const g0 = credentialGeneration();
    applyWeb('a');
    const g1 = credentialGeneration();
    applyWeb('b');
    const g2 = credentialGeneration();
    clearCredential();
    const g3 = credentialGeneration();
    expect(g1).toBeGreaterThan(g0);
    expect(g2).toBeGreaterThan(g1);
    expect(g3).toBeGreaterThan(g2);
  });
});
