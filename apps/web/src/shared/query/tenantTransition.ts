import type { QueryClient } from '@tanstack/react-query';

let activeQueryClient: QueryClient | null = null;
let resetTenantMemory: (() => void) | null = null;

export function registerTenantQueryClient(queryClient: QueryClient): () => void {
  activeQueryClient = queryClient;
  return () => {
    if (activeQueryClient === queryClient) activeQueryClient = null;
  };
}

export function registerTenantMemoryReset(reset: () => void): void {
  resetTenantMemory = reset;
}

export const tenantTransition = {
  async prepare(): Promise<void> {
    await activeQueryClient?.cancelQueries();
  },
  commit(): void {
    activeQueryClient?.clear();
    resetTenantMemory?.();
  },
};
