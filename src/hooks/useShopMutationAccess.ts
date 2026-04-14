import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useTenantContext } from '../contexts/TenantContext';
import { supabase } from '../lib/supabase';
import type { Account } from '../lib/supabase';

export type ShopAccessFlags = {
    /** COGS, manual fees, marketing OAuth, danger zone, product TikTok mutations, etc. */
    canMutateShop: boolean;
    /** Pull fresh data from TikTok (shop + ads sync endpoints). Allowed for any role that can open the shop. */
    canSyncShop: boolean;
};

/**
 * Read vs write access for the current shop account (RPC-backed).
 * Seller User: canSyncShop true, canMutateShop false.
 */
export function useShopAccessFlags(account: Pick<Account, 'id'> | null | undefined): ShopAccessFlags {
    const { profile, user } = useAuth();
    const { isPlatformSuperAdmin } = useTenantContext();

    const skipRpc = profile?.role === 'admin' || isPlatformSuperAdmin;

    const { data, isPending, isError } = useQuery({
        queryKey: ['shop-access-flags', user?.id, account?.id],
        queryFn: async () => {
            const [writeRes, accessRes] = await Promise.all([
                supabase.rpc('user_can_write_shop_account', { p_account_id: account!.id }),
                supabase.rpc('user_can_access_account', { p_account_id: account!.id }),
            ]);
            if (writeRes.error) {
                console.warn('[useShopAccessFlags] user_can_write_shop_account failed:', writeRes.error.message);
            }
            if (accessRes.error) {
                console.warn('[useShopAccessFlags] user_can_access_account failed:', accessRes.error.message);
            }
            return {
                canWrite: !writeRes.error && writeRes.data === true,
                canAccess: !accessRes.error && accessRes.data === true,
            };
        },
        enabled: Boolean(user?.id && account?.id && !skipRpc),
        staleTime: 60_000,
    });

    return useMemo(() => {
        if (!account?.id || !user?.id) {
            return { canMutateShop: false, canSyncShop: false };
        }
        if (profile?.role === 'admin' || isPlatformSuperAdmin) {
            return { canMutateShop: true, canSyncShop: true };
        }
        if (isPending || isError || !data) {
            return { canMutateShop: false, canSyncShop: false };
        }
        return {
            canMutateShop: data.canWrite,
            canSyncShop: data.canAccess,
        };
    }, [
        account?.id,
        profile?.role,
        isPlatformSuperAdmin,
        user?.id,
        isPending,
        isError,
        data,
    ]);
}

/** @deprecated Prefer useShopAccessFlags for sync vs mutate distinction. */
export function useShopMutationAccess(account: Pick<Account, 'id'> | null | undefined): boolean {
    return useShopAccessFlags(account).canMutateShop;
}
