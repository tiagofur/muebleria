import { QueryClient } from '@tanstack/react-query';
import { GraneteApiError } from '@granete/storage';

export function shouldRetryServerQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof GraneteApiError) return error.status >= 500 && error.retryable;
  return error instanceof TypeError;
}

export function createGraneteQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryServerQuery,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
