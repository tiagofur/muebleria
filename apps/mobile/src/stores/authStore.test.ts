import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore, type UserSession } from './authStore';
import { generatedApiClient, apiClient } from '../services/apiClient';
import {
  primaryRoleOf,
  roleCanExportProduction,
  roleCanDeleteProject,
} from '@granete/domain';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() }))
  }
}));

// Mock mobileAuthRuntime
vi.mock('../services/mobileAuthRuntime', () => {
  let _token: string | null = null;
  return {
    REFRESH_KEY: 'granete_mobile_refresh',
    applyCredential: vi.fn(),
    clearCredential: vi.fn(),
    refreshSession: vi.fn(async () => {
      // Simulate successful refresh by default in some tests, but allow override
      if (_token === 'fail') throw new Error('Refresh failed');
    }),
    storeRefreshSecret: vi.fn(async () => {}),
    purgeSecureRefresh: vi.fn(async () => {}),
    getAccessToken: vi.fn(() => _token),
    getCredential: vi.fn(() => null),
    __setMockToken: (t: string | null) => { _token = t; }
  };
});

// Mock expo-secure-store
vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// Mock expo-local-authentication
vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: vi.fn(async () => true),
  isEnrolledAsync: vi.fn(async () => true),
  authenticateAsync: vi.fn(async () => ({ success: true })),
}));

vi.mock('../services/apiClient', () => ({
  generatedApiClient: vi.fn(),
  apiClient: {
    post: vi.fn(),
  }
}));

vi.mock('../services/secureStoreMigration', () => ({
  ensureSecureStoreMigrated: vi.fn(async () => undefined),
}));

describe('authStore Mobile', () => {
  beforeEach(async () => {
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isBiometricSupported: false,
      isBiometricEnrolled: false,
    });
    vi.clearAllMocks();
    
    const { __setMockToken } = await import('../services/mobileAuthRuntime') as any;
    __setMockToken(null);
  });

  it('inicia con estado no autenticado', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it('guarda la sesión directamente y actualiza el estado', async () => {
    const mockUser: UserSession = {
      userId: 'usr-123',
      name: 'Juan Carpintero',
      email: 'juan@taller.com',
      roles: ['produccion'],
    };

    await useAuthStore.getState().setSessionDirect('mock-jwt-token', mockUser);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('mock-jwt-token');
    expect(state.user).toEqual(mockUser);
  });

  it('login lee LoginResponse.roles y descarta roles no canónicos', async () => {
    const login = vi.fn().mockResolvedValue({
      token: 'tok-login',
      refresh_token: 'R1',
      user: { id: 'usr-9', name: 'Ana Pérez', email: 'ana@taller.com' },
      roles: ['produccion', 'instalador', 'almacen'],
    });
    vi.mocked(generatedApiClient).mockReturnValue({ login } as never);

    await useAuthStore.getState().login('ana@taller.com', 'secreta');

    expect(login).toHaveBeenCalledWith({
      email: 'ana@taller.com', password: 'secreta', transport: 'mobile',
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    // 'instalador' no existe como rol (contracts/roles.json rejectedRoles):
    // jamás debe entrar a la sesión.
    expect(state.user?.roles).toEqual(['produccion', 'almacen']);
  });

  it('loadSession uses refresh flow and loads user from SecureStore if success', async () => {
    const { __setMockToken } = await import('../services/mobileAuthRuntime') as any;
    __setMockToken('tok-new-refreshed');
    
    await SecureStore.setItemAsync(
      'granete_auth_user',
      JSON.stringify({
        userId: 'usr-ok',
        name: 'Refreshed User',
        email: 'refreshed@taller.com',
        role: 'produccion', // migrates legacy single role
      }),
    );

    await useAuthStore.getState().loadSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('tok-new-refreshed');
    expect(state.user?.roles).toEqual(['produccion']); // legacy migrates correctly to array
  });

  it('loadSession clears state on 401/403 but not on network error', async () => {
    const { __setMockToken, refreshSession } = await import('../services/mobileAuthRuntime') as any;
    
    // Case 1: 401 Unauthorized
    refreshSession.mockRejectedValueOnce({ status: 401, message: 'Revoked' });
    await SecureStore.setItemAsync(
      'granete_auth_user',
      JSON.stringify({ userId: 'usr-bad', roles: ['produccion'] }),
    );
    await useAuthStore.getState().loadSession();
    const state1 = useAuthStore.getState();
    expect(state1.isAuthenticated).toBe(false);
    expect(state1.token).toBeNull();
    // Note: granete_auth_user remains in SecureStore but is ignored because token is null

    // Case 2: Network Error (no status or >= 500)
    useAuthStore.setState({ isAuthenticated: false, token: null });
    refreshSession.mockRejectedValueOnce(new Error('Network Offline'));
    await expect(useAuthStore.getState().loadSession()).rejects.toThrow('Network Offline');
    
    // State is preserved locally (even though token in memory is null)
    const state2 = useAuthStore.getState();
    expect(state2.token).toBeNull();
    expect(state2.isAuthenticated).toBe(false); // Can't be authenticated without a memory token
  });

  it('valida permisos del usuario autenticado con @granete/domain', async () => {
    const mockUser: UserSession = {
      userId: 'usr-prod',
      name: 'Carlos Planta',
      email: 'carlos@taller.com',
      roles: ['produccion'],
    };

    await useAuthStore.getState().setSessionDirect('mock-jwt-token', mockUser);
    const state = useAuthStore.getState();

    // Rol produccion can export production but cannot delete projects
    expect(roleCanExportProduction(primaryRoleOf(state.user!.roles))).toBe(true);
    expect(roleCanDeleteProject(primaryRoleOf(state.user!.roles))).toBe(false);
  });

  it('cierra la sesión y limpia el estado', async () => {
    const mockUser: UserSession = {
      userId: 'usr-123',
      name: 'Juan Carpintero',
      email: 'juan@taller.com',
      roles: ['produccion'],
    };

    await useAuthStore.getState().setSessionDirect('mock-jwt-token', mockUser);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it('logout preserves local session on network error but purges on 401', async () => {
    const mockUser: UserSession = {
      userId: 'usr-123',
      name: 'Juan',
      email: 'juan@taller.com',
      roles: ['produccion'],
    };
    await useAuthStore.getState().setSessionDirect('tok', mockUser);
    await SecureStore.setItemAsync('granete_mobile_refresh', 'R1');
    await SecureStore.setItemAsync('granete_auth_user', JSON.stringify(mockUser));

    // Simulate 500 network error
    vi.mocked(apiClient.post).mockRejectedValueOnce({ status: 500 });
    
    await expect(useAuthStore.getState().logout()).rejects.toEqual({ status: 500 });
    
    // Should NOT clear secure store
    expect(await SecureStore.getItemAsync('granete_mobile_refresh')).toBe('R1');
    expect(await SecureStore.getItemAsync('granete_auth_user')).toBeDefined();

    // Simulate 401
    const { purgeSecureRefresh } = await import('../services/mobileAuthRuntime') as any;
    vi.mocked(purgeSecureRefresh).mockClear();
    vi.mocked(apiClient.post).mockRejectedValueOnce({ status: 401 });
    await useAuthStore.getState().logout();
    
    // Should clear secure store (via purgeSecureRefresh and deleteItemAsync)
    expect(purgeSecureRefresh).toHaveBeenCalled();
    expect(await SecureStore.getItemAsync('granete_auth_user')).toBeNull();
  });

  it('selectOrg correctly fetches new session and updates state', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      token: 'tok-org2',
      access_expires_at: '2050-01-01T00:00:00Z',
      absolute_session_expires_at: '2050-01-01T00:00:00Z',
      session_id: 'sess-2',
      user: { id: 'usr-1', name: 'Ana', email: 'ana@taller.com' },
      organization: { id: 'org-2' },
      roles: ['admin'],
    });

    await useAuthStore.getState().selectOrg('org-2');
    
    expect(apiClient.post).toHaveBeenCalledWith('/auth/select-org', { org_id: 'org-2' });
    const state = useAuthStore.getState();
    expect(state.token).toBe('tok-org2');
    expect(state.user?.roles).toEqual(['admin']);
    expect(state.user?.userId).toBe('usr-1');
  });

  it('login with SecureStore failure attempts best-effort logout', async () => {
    const login = vi.fn().mockResolvedValue({
      token: 'tok-login',
      refresh_token: 'R1-fail',
      user: { id: 'usr-9', name: 'Ana Pérez', email: 'ana@taller.com' },
      roles: ['produccion'],
    });
    vi.mocked(generatedApiClient).mockReturnValue({ login } as never);

    const { storeRefreshSecret } = await import('../services/mobileAuthRuntime') as any;
    storeRefreshSecret.mockRejectedValueOnce(new Error('SecureStore broken'));
    vi.mocked(apiClient.post).mockResolvedValueOnce({}); // best effort logout

    await expect(useAuthStore.getState().login('ana@taller.com', 'secreta')).rejects.toThrow('SecureStore broken');
    
    expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', { refresh_token: 'R1-fail' }, { skipAuthRetry: true });
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
  });
});
