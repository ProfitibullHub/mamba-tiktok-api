import { QueryClient } from '@tanstack/react-query';
import { clearStaleAuthSession, isRevokedSessionPostgrestError } from './lib/sessionErrors';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            staleTime: 1000 * 60 * 5, // 5 minutes
            retry: (failureCount, error) => {
                if (isRevokedSessionPostgrestError(error)) return false;
                return failureCount < 2;
            },
        },
    },
});

queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const err = event.query.state.error;
    if (event.query.state.status === 'error' && isRevokedSessionPostgrestError(err)) {
        void clearStaleAuthSession();
    }
});
