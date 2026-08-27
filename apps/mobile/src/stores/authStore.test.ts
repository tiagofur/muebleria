import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore, type UserSession } from './authStore';
import { apiClient } from '../services/apiClient';
import {
  primaryRoleOf,
  roleCanExportProduction,
  roleCanDeleteProject,
} from '@granete/domain';

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
  apiClient: { post: vi.fn() },
}));

vi.mock('../services/secureStoreMigration', () => ({
  ensureSecureStoreMigrated: vi.fn(async () => undefined),
}));

describe('authStore Mobile', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isBiometricSupported: false,
      isBiometricEnrolled: false,
    });
    vi.clearAllMocks();
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
    vi.mocked(apiClient.post).mockResolvedValue({
      token: 'tok-login',
      user: { id: 'usr-9', name: 'Ana Pérez', email: 'ana@taller.com' },
      roles: ['produccion', 'instalador', 'almacen'],
    });

    await useAuthStore.getState().login('ana@taller.com', 'secreta');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    // 'instalador' no existe como rol (contracts/roles.json rejectedRoles):
    // jamás debe entrar a la sesión.
    expect(state.user?.roles).toEqual(['produccion', 'almacen']);
  });

  it('migra sesión persistida legacy (role único) a roles[]', async () => {
    await SecureStore.setItemAsync('granete_auth_token', 'tok-legacy');
    await SecureStore.setItemAsync(
      'granete_auth_user',
      JSON.stringify({
        userId: 'usr-old',
        name: 'Legacy User',
        email: 'legacy@taller.com',
        role: 'produccion',
      }),
    );

    await useAuthStore.getState().loadSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.roles).toEqual(['produccion']);
  });

  it('sesión persistida con rol rechazado queda sin roles (nunca se muestra)', async () => {
    await SecureStore.setItemAsync('granete_auth_token', 'tok-bad');
    await SecureStore.setItemAsync(
      'granete_auth_user',
      JSON.stringify({
        userId: 'usr-old2',
        name: 'Legacy Bad',
        email: 'bad@taller.com',
        role: 'carpintero',
      }),
    );

    await useAuthStore.getState().loadSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.roles).toEqual([]);
    expect(primaryRoleOf(state.user?.roles)).toBeNull();
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
});
