import { DomainError } from '@granete/domain';
import { GraneteApiClient } from '@granete/storage';
import { getAccessToken, getCredential, refreshSession } from './mobileAuthRuntime';

export interface ApiClientConfig {
  baseUrl: string;
}

import { getApiBaseUrl, setApiBaseUrl } from './apiConfig';
export { setApiBaseUrl, getApiBaseUrl };

/** Generated Organization API client with shared request/response validation. */
export function generatedApiClient(): GraneteApiClient {
  return new GraneteApiClient(`${getApiBaseUrl()}/api`, globalThis.fetch);
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
  skipAuthRetry?: boolean;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { params, headers: customHeaders, ...restOptions } = options;

  let url = `${getApiBaseUrl()}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

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

  const buildHeaders = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(customHeaders as Record<string, string>),
    };

    const token = getAccessToken();
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const executeFetch = async () => {
    try {
      return await fetch(url, {
        ...restOptions,
        headers: buildHeaders(),
      });
    } catch (err: any) {
      throw new DomainError(
        `Error de red al conectar con el servidor: ${err?.message || 'Sin conexión'}`,
        { url, originalError: err }
      );
    }
  };

  const initialCredential = getCredential();
  let response = await executeFetch();

  if (response.status === 401 && !options.skipAuthRetry) {
    // 401 Unauthorized: Attempt to refresh session (Singleflight)
    try {
      await refreshSession();
      // Only retry if the new session belongs to the same org/user (cross-org check)
      const newCredential = getCredential();
      if (
        initialCredential &&
        newCredential &&
        (initialCredential.sessionId !== newCredential.sessionId ||
         initialCredential.organizationId !== newCredential.organizationId)
      ) {
         throw new DomainError('La sesión o la organización ha cambiado.', { status: 401 });
      }
      
      // Retry once
      response = await executeFetch();
    } catch (refreshErr: any) {
      // If refresh fails (e.g. no token, network error, or invalid token), we bubble up
      // a 401 so the UI can redirect to login.
      throw new DomainError(refreshErr.message || 'Sesión no válida', {
        status: 401,
        originalError: refreshErr,
      });
    }
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
