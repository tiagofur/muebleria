import type { QueryClient } from '@tanstack/react-query';

let activeQueryClient: QueryClient | null = null;
let resetTenantMemory: (() => void) | null = null;
const commitCleanups = new Set<() => void>();

export function registerTenantQueryClient(queryClient: QueryClient): () => void {
  activeQueryClient = queryClient;
  return () => {
    if (activeQueryClient === queryClient) activeQueryClient = null;
  };
}

export function registerTenantMemoryReset(reset: () => void): void {
  resetTenantMemory = reset;
}

export function registerTenantCommitCleanup(cleanup: () => void): () => void {
  commitCleanups.add(cleanup);
  return () => commitCleanups.delete(cleanup);
}

export const tenantTransition = {
  async prepare(): Promise<void> {
    await activeQueryClient?.cancelQueries();
  },
  commit(): void {
    activeQueryClient?.clear();
    resetTenantMemory?.();
    for (const cleanup of commitCleanups) cleanup();
  },
};
