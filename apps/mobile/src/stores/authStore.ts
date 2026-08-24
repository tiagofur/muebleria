import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { type UserRole, DomainError } from '@muebles/domain';
import { apiClient } from '../services/apiClient';

const TOKEN_KEY = 'muebles_auth_token';
const USER_KEY = 'muebles_auth_user';

export interface UserSession {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
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
          role: UserRole;
        };
      }>('/api/auth/login', { email, password });

      const user: UserSession = {
        userId: response.user.id,
        name: response.user.name,
        email: response.user.email,
        role: response.user.role,
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
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const userJson = await SecureStore.getItemAsync(USER_KEY);

      if (token && userJson) {
        const user = JSON.parse(userJson) as UserSession;
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
        const user = JSON.parse(userJson) as UserSession;
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
