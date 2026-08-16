import * as SecureStore from 'expo-secure-store';
import { DomainError } from '@muebles/domain';

const TOKEN_KEY = 'muebles_auth_token';

export interface ApiClientConfig {
  baseUrl: string;
}

// Configurable base URL: Android emulator uses 10.0.2.2, iOS simulator uses localhost or physical device IP
let currentBaseUrl = 'http://localhost:8080';

export function setApiBaseUrl(url: string) {
  currentBaseUrl = url.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  return currentBaseUrl;
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, headers: customHeaders, ...restOptions } = options;

  let url = `${currentBaseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        searchParams.append(key, String(val));
      }
    });
    const qs = searchParams.toString();
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(customHeaders as Record<string, string>),
  };

  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Non-native environments or SecureStore unavailable
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...restOptions,
      headers,
    });
  } catch (err: any) {
    throw new DomainError(
      `Error de red al conectar con el servidor: ${err?.message || 'Sin conexión'}`,
      { url, originalError: err }
    );
  }

  if (!response.ok) {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: response.statusText };
    }

    const message =
      errorData?.message ||
      errorData?.error ||
      `Error en solicitud (${response.status}: ${response.statusText})`;

    throw new DomainError(message, {
      status: response.status,
      statusText: response.statusText,
      url,
      data: errorData,
    });
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(endpoint: string, body?: any, options?: RequestOptions) =>
    request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),
};
