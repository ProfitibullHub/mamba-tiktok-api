import type { QueryClient } from '@tanstack/react-query';

/**
 * Drops cached tenant / shop / account queries so the console refetches after
 * membership or link changes (accept/decline invitation). Global staleTime would
 * otherwise keep pre-invite data until manual refresh.
 */
export function removeStaleAccessQueries(queryClient: QueryClient): void {
    const roots = [
        'tenant-memberships',
        'accounts',
        'all-visible-shops',
        'agency-linked-seller-ids',
        'agency-seller-hierarchy',
        'pending-membership-invites',
        'my-accounts-tenant',
        'agency-linked-sellers-for-mgmt',
        'am-assigned-sellers-for-mgmt',
        'shop-by-slug',
        'shop-account-access',
        'shop-access-flags',
    ] as const;

    for (const root of roots) {
        queryClient.removeQueries({ queryKey: [root] });
    }
}
