import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { DomainError } from '@granete/domain';
import {
  applyCredential,
  clearCredential,
  getCredential,
  getAccessToken,
  credentialGeneration,
  isSameCredentialScope,
  accessExpiresInMs,
  absoluteSessionExpiresAtMs,
  refreshSession,
  storeRefreshSecret,
  purgeSecureRefresh,
  __resetMobileAuthRuntimeForTests,
  REFRESH_KEY
} from './mobileAuthRuntime';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('./apiClient', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:8080'),
}));

const MOCK_DATE_NOW = 1700000000000;

describe('mobileAuthRuntime', () => {
  let secureStoreMemory: Record<string, string> = {};

  beforeEach(() => {
    __resetMobileAuthRuntimeForTests();
    secureStoreMemory = {};
    
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MOCK_DATE_NOW));
    
    // Reset fetch mock before each test
    global.fetch = vi.fn() as any;

    (SecureStore.getItemAsync as any).mockImplementation(async (k: string) => secureStoreMemory[k] ?? null);
    (SecureStore.setItemAsync as any).mockImplementation(async (k: string, v: string) => {
      secureStoreMemory[k] = String(v);
    });
    (SecureStore.deleteItemAsync as any).mockImplementation(async (k: string) => {
      delete secureStoreMemory[k];
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic Memory Operations', () => {
    it('starts with empty state', () => {
      expect(getCredential()).toBeNull();
      expect(getAccessToken()).toBeNull();
      expect(accessExpiresInMs(MOCK_DATE_NOW)).toBeNull();
      expect(absoluteSessionExpiresAtMs()).toBeNull();
    });

    it('stores token in memory only', () => {
      const input = {
        accessToken: 'token123',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'session-xyz',
        userId: 'user-1',
        organizationId: 'org-1',
      };
      
      const snap = applyCredential(input);
      expect(snap.generation).toBeGreaterThan(0);
      expect(getAccessToken()).toBe('token123');
      expect(secureStoreMemory[REFRESH_KEY]).toBeUndefined();
    });

    it('clears token from memory correctly', () => {
      applyCredential({
        accessToken: 'token123',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'session-xyz',
        userId: 'user-1',
        organizationId: 'org-1',
      });
      
      const oldGen = credentialGeneration();
      clearCredential();
      
      expect(getAccessToken()).toBeNull();
      expect(getCredential()).toBeNull();
      expect(credentialGeneration()).toBeGreaterThan(oldGen);
    });

    it('returns correct expiration info', () => {
      applyCredential({
        accessToken: 'token123',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'session-xyz',
        userId: 'user-1',
        organizationId: 'org-1',
      });

      expect(accessExpiresInMs(MOCK_DATE_NOW)).toBe(15 * 60 * 1000);
      expect(absoluteSessionExpiresAtMs()).toBe(MOCK_DATE_NOW + 18 * 3600 * 1000);
    });
    
    it('isSameCredentialScope prevents race conditions', () => {
      const snap1 = applyCredential({
        accessToken: 'token1',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'session-1',
        userId: 'user-1',
        organizationId: 'org-1',
      });
      
      expect(isSameCredentialScope(snap1)).toBe(true);
      
      clearCredential();
      expect(isSameCredentialScope(snap1)).toBe(false);
      
      applyCredential({
        accessToken: 'token2',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'session-2',
        userId: 'user-2',
        organizationId: 'org-2',
      });
      
      expect(isSameCredentialScope(snap1)).toBe(false);
    });
  });

  describe('SecureStore Operations', () => {
    it('storeRefreshSecret writes to SecureStore', async () => {
      await storeRefreshSecret('R1');
      expect(secureStoreMemory[REFRESH_KEY]).toBe('R1');
    });

    it('purgeSecureRefresh removes from SecureStore', async () => {
      secureStoreMemory[REFRESH_KEY] = 'R1';
      await purgeSecureRefresh();
      expect(secureStoreMemory[REFRESH_KEY]).toBeUndefined();
    });
    
    it('storeRefreshSecret throws DomainError if SecureStore fails', async () => {
      (SecureStore.setItemAsync as any).mockRejectedValueOnce(new Error('Device unavailable'));
      await expect(storeRefreshSecret('R1')).rejects.toThrow(DomainError);
    });
  });

  describe('refreshSession Rotation Proofs', () => {
    it('Proof: fails closed when no refresh token is present', async () => {
      await expect(refreshSession()).rejects.toThrow('No hay sesión disponible para renovar.');
    });

    it('Proof: fails closed when SecureStore read fails', async () => {
      (SecureStore.getItemAsync as any).mockRejectedValueOnce(new Error('Hardware Error'));
      await expect(refreshSession()).rejects.toThrow('Almacenamiento seguro no disponible.');
      expect(getCredential()).toBeNull();
    });

    it('Proof: fails closed on 18h absolute expiry', async () => {
      secureStoreMemory[REFRESH_KEY] = 'R1';
      
      // We are past absolute session expiry
      applyCredential({
        accessToken: 'expired-token',
        accessExpiresAt: new Date(MOCK_DATE_NOW - 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW - 1000).toISOString(),
        sessionId: 'sess',
        userId: 'usr',
        organizationId: null,
      });

      await expect(refreshSession()).rejects.toThrow('La sesión ha alcanzado su tiempo máximo (18h).');
      expect(getCredential()).toBeNull(); // memory cleared
      expect(secureStoreMemory[REFRESH_KEY]).toBeUndefined(); // storage purged
      expect(fetch).not.toHaveBeenCalled(); // no network call made
    });

    it('Proof: network failure preserves R1 and memory', async () => {
      secureStoreMemory[REFRESH_KEY] = 'R1';
      applyCredential({
        accessToken: 'A1',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'sess',
        userId: 'usr',
        organizationId: null,
      });

      (global.fetch as any).mockRejectedValueOnce(new Error('Network offline'));

      await expect(refreshSession()).rejects.toThrow(DomainError);
      
      // Memory should NOT be cleared yet (it's up to the caller to check accessExpiresInMs)
      expect(getAccessToken()).toBe('A1');
      // R1 should NOT be purged
      expect(secureStoreMemory[REFRESH_KEY]).toBe('R1');
    });

    it('Proof: 401/403/400 terminal failure purges R1 and memory', async () => {
      secureStoreMemory[REFRESH_KEY] = 'R1';
      applyCredential({
        accessToken: 'A1',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'sess',
        userId: 'usr',
        organizationId: null,
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(refreshSession()).rejects.toThrow(DomainError);
      
      expect(getAccessToken()).toBeNull();
      expect(secureStoreMemory[REFRESH_KEY]).toBeUndefined();
    });

    it('Proof: successful rotation writes R2 and applies A2', async () => {
      secureStoreMemory[REFRESH_KEY] = 'R1';
      applyCredential({
        accessToken: 'A1',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'sess-123',
        userId: 'usr-1',
        organizationId: 'org-99',
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'A2',
          refresh_token: 'R2',
          access_expires_at: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
          absolute_session_expires_at: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
          session_id: 'sess-123'
        }),
      });

      await refreshSession();

      expect(secureStoreMemory[REFRESH_KEY]).toBe('R2');
      expect(getAccessToken()).toBe('A2');
      // User and org must carry over if present
      expect(getCredential()?.userId).toBe('usr-1');
      expect(getCredential()?.organizationId).toBe('org-99');
      
      // Request should use R1
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/auth/refresh',
        expect.objectContaining({
          body: JSON.stringify({ refresh_token: 'R1' })
        })
      );
    });

    it('Proof: fail closed if R2 write fails', async () => {
      secureStoreMemory[REFRESH_KEY] = 'R1';
      applyCredential({
        accessToken: 'A1',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'sess-123',
        userId: 'usr-1',
        organizationId: 'org-99',
      });

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'A2',
          refresh_token: 'R2',
          access_expires_at: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
          absolute_session_expires_at: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
          session_id: 'sess-123'
        }),
      });

      // Break SecureStore for R2 write
      (SecureStore.setItemAsync as any).mockRejectedValueOnce(new Error('Quota exceeded'));

      await expect(refreshSession()).rejects.toThrow('Fallo de almacenamiento seguro al actualizar la sesión.');

      // Server rotated to R2, but we lost it. We must NOT publish A2 or keep A1/R1.
      expect(getAccessToken()).toBeNull();
      // Purge attempted on R1
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH_KEY);
    });
    
    it('Proof: singleflight concurrent calls result in exactly one network request', async () => {
      secureStoreMemory[REFRESH_KEY] = 'R1';
      applyCredential({
        accessToken: 'A1',
        accessExpiresAt: new Date(MOCK_DATE_NOW + 1000).toISOString(),
        absoluteSessionExpiresAt: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
        sessionId: 'sess-123',
        userId: 'usr-1',
        organizationId: 'org-99',
      });

      let resolveFetch: any;
      const pendingFetch = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      (global.fetch as any).mockImplementation(() => pendingFetch);

      // Fire 3 concurrent refresh requests
      const p1 = refreshSession();
      const p2 = refreshSession();
      const p3 = refreshSession();

      // Resolve the single shared network request
      resolveFetch({
        ok: true,
        json: async () => ({
          token: 'A2',
          refresh_token: 'R2',
          access_expires_at: new Date(MOCK_DATE_NOW + 15 * 60 * 1000).toISOString(),
          absolute_session_expires_at: new Date(MOCK_DATE_NOW + 18 * 3600 * 1000).toISOString(),
          session_id: 'sess-123'
        }),
      });

      await Promise.all([p1, p2, p3]);

      // Assert only ONE fetch occurred
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // And state is correct
      expect(secureStoreMemory[REFRESH_KEY]).toBe('R2');
      expect(getAccessToken()).toBe('A2');
    });
  });
});
