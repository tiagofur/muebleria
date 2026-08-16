import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore, type UserSession } from './authStore';
import { roleCanExportProduction, roleCanDeleteProject } from '@muebles/domain';

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
      role: 'produccion',
    };

    await useAuthStore.getState().setSessionDirect('mock-jwt-token', mockUser);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('mock-jwt-token');
    expect(state.user).toEqual(mockUser);
  });

  it('valida permisos del usuario autenticado con @muebles/domain', async () => {
    const mockUser: UserSession = {
      userId: 'usr-prod',
      name: 'Carlos Planta',
      email: 'carlos@taller.com',
      role: 'produccion',
    };

    await useAuthStore.getState().setSessionDirect('mock-jwt-token', mockUser);
    const state = useAuthStore.getState();

    // Rol produccion can export production but cannot delete projects
    expect(roleCanExportProduction(state.user!.role)).toBe(true);
    expect(roleCanDeleteProject(state.user!.role)).toBe(false);
  });

  it('cierra la sesión y limpia el estado', async () => {
    const mockUser: UserSession = {
      userId: 'usr-123',
      name: 'Juan Carpintero',
      email: 'juan@taller.com',
      role: 'produccion',
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
