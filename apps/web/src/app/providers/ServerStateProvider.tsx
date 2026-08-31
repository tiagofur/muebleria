import { useState, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createGraneteQueryClient } from '../../shared/query/queryClient';

export function ServerStateProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(createGraneteQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
