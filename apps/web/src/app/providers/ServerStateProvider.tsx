import { useEffect, useState, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createGraneteQueryClient } from '../../shared/query/queryClient';
import { registerTenantQueryClient } from '../../shared/query/tenantTransition';

export function ServerStateProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(createGraneteQueryClient);
  useEffect(() => registerTenantQueryClient(queryClient), [queryClient]);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
