import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { isValidUserRole, type UserRole, DomainError } from '@granete/domain';
import { apiClient } from '../services/apiClient';
import { ensureSecureStoreMigrated } from '../services/secureStoreMigration';

const TOKEN_KEY = 'granete_auth_token';
const USER_KEY = 'granete_auth_user';

export interface UserSession {
  userId: string;
  name: string;
  email: string;
  /**
   * Canonical membership roles from LoginResponse.roles (union semantics).
   * The login response no longer carries a single user.role (dropped with
   * users.role in migration 000090) — display pick is primaryRoleOf().
   */
  roles: UserRole[];
}

/**
 * Only canonical roles from contracts/roles.json survive; anything the
 * backend would reject is dropped instead of displayed. Legacy persisted
 * sessions (pre multi-role) stored a single `role` — migrate it.
 */
function sanitizeSessionRoles(parsed: {
  roles?: unknown;
  role?: unknown;
}): UserRole[] {
  const raw: readonly unknown[] = Array.isArray(parsed.roles)
    ? parsed.roles
    : typeof parsed.role === 'string'
      ? [parsed.role]
      : [];
  return raw.filter(
    (r): r is UserRole => typeof r === 'string' && isValidUserRole(r),
  );
}

export interface AuthState {
  token: string | null;
  user: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isBiometricSupported: boolean;
  isBiometricEnrolled: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
  checkBiometrics: () => Promise<void>;
  loginWithBiometrics: () => Promise<boolean>;
  setSessionDirect: (token: string, user: UserSession) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  isBiometricSupported: false,
  isBiometricEnrolled: false,

  checkBiometrics: async () => {
    try {
      const isHardwareAvailable = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      set({
        isBiometricSupported: isHardwareAvailable,
        isBiometricEnrolled: isEnrolled,
      });
    } catch {
      set({ isBiometricSupported: false, isBiometricEnrolled: false });
    }
  },

  setSessionDirect: async (token: string, user: UserSession) => {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    } catch {
      // SecureStore may fail in tests or web, state still updates
    }
    set({
      token,
      user,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  login: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const response = await apiClient.post<{
        token: string;
        user: {
          id: string;
          name: string;
          email: string;
        };
        roles?: string[];
      }>('/api/auth/login', { email, password });

      const user: UserSession = {
        userId: response.user.id,
        name: response.user.name,
        email: response.user.email,
        roles: sanitizeSessionRoles({ roles: response.roles }),
      };

      await get().setSessionDirect(response.token, user);
    } catch (err: any) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_KEY);
    } catch {
      // ignore
    }
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  loadSession: async () => {
    set({ isLoading: true });
    try {
      await get().checkBiometrics();
      await ensureSecureStoreMigrated();
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const userJson = await SecureStore.getItemAsync(USER_KEY);

      if (token && userJson) {
        const parsed = JSON.parse(userJson) as Partial<UserSession> & {
          role?: unknown;
        };
        const user: UserSession = {
          userId: parsed.userId ?? '',
          name: parsed.name ?? '',
          email: parsed.email ?? '',
          roles: sanitizeSessionRoles(parsed),
        };
        set({
          token,
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    } catch {
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  loginWithBiometrics: async () => {
    try {
      await ensureSecureStoreMigrated();
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const userJson = await SecureStore.getItemAsync(USER_KEY);

      if (!token || !userJson) {
        return false;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear Granete Taller',
        cancelLabel: 'Usar contraseña',
        disableDeviceFallback: false,
      });

      if (result.success) {
        const parsed = JSON.parse(userJson) as Partial<UserSession> & {
          role?: unknown;
        };
        const user: UserSession = {
          userId: parsed.userId ?? '',
          name: parsed.name ?? '',
          email: parsed.email ?? '',
          roles: sanitizeSessionRoles(parsed),
        };
        set({
          token,
          user,
          isAuthenticated: true,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));
