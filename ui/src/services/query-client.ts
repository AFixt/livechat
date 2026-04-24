import { QueryClient } from '@tanstack/react-query';

/**
 * Build the React Query client with conservative defaults for a realtime
 * app — short stale time and no auto-refetch on focus (socket events drive
 * the UI).
 * @returns A new QueryClient.
 */
export function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
