import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { taskPermissionEquivalenceMatches } from '../lib/taskPermissionAliases';
import { supabase } from '../lib/supabase';

/** Fetch effective permission actions for the signed-in user on a tenant (membership_roles + primary role). */
export async function fetchMyEffectivePermissionsOnTenant(tenantId: string): Promise<Set<string>> {
    const { data, error } = await supabase.rpc('get_my_effective_permissions_on_tenant', {
        p_tenant_id: tenantId,
    });
    if (error) throw error;
    const out = new Set<string>();
    for (const row of data || []) {
        const a = (row as { action?: string }).action;
        if (typeof a === 'string' && a) out.add(a);
    }
    return out;
}

/** Account-scoped union (seller tenant + parent agency + assignment agencies); required for agency-side custom roles on linked sellers. */
export async function fetchMyEffectivePermissionsForAccount(accountId: string): Promise<Set<string>> {
    const { data, error } = await supabase.rpc('get_my_effective_permissions_for_account', {
        p_account_id: accountId,
    });
    if (error) throw error;
    const out = new Set<string>();
    for (const row of data || []) {
        const a = (row as { action?: string }).action;
        if (typeof a === 'string' && a) out.add(a);
    }
    return out;
}

export function useMyEffectivePermissions(tenantId: string | null | undefined, options?: { enabled?: boolean }) {
    const enabled = (options?.enabled ?? true) && Boolean(tenantId);
    return useQuery({
        queryKey: ['my-effective-permissions', tenantId],
        queryFn: () => fetchMyEffectivePermissionsOnTenant(tenantId!),
        enabled,
        staleTime: 60_000,
    });
}

export function useMyEffectivePermissionsForAccount(accountId: string | null | undefined, options?: { enabled?: boolean }) {
    const enabled = (options?.enabled ?? true) && Boolean(accountId);
    return useQuery({
        queryKey: ['my-effective-permissions-account', accountId],
        queryFn: () => fetchMyEffectivePermissionsForAccount(accountId!),
        enabled,
        staleTime: 60_000,
    });
}

/**
 * Union of tenant-scoped and account-scoped effective permissions for shop surfaces.
 * Agency staff often have custom-role grants only on the account/agency-resolution path.
 */
export function useMergedShopEffectivePermissions(
    tenantId: string | null | undefined,
    accountId: string | null | undefined,
    options?: { enabled?: boolean },
) {
    const enabledRoot = options?.enabled ?? true;
    const tenantEnabled = enabledRoot && Boolean(tenantId);
    const accountEnabled = enabledRoot && Boolean(accountId);

    const tenantQ = useMyEffectivePermissions(tenantId, { enabled: tenantEnabled });
    const accountQ = useMyEffectivePermissionsForAccount(accountId, { enabled: accountEnabled });

    const isLoading = Boolean((tenantId && tenantQ.isLoading) || (accountId && accountQ.isLoading));

    const data = useMemo(() => {
        const out = new Set<string>();
        if (tenantQ.data) for (const a of tenantQ.data) out.add(a);
        if (accountQ.data) for (const a of accountQ.data) out.add(a);
        return out;
    }, [tenantQ.data, accountQ.data]);

    return {
        data,
        isLoading,
        tenantQuery: tenantQ,
        accountQuery: accountQ,
    };
}

/** Synced TikTok Shop operational surfaces (overview, orders, products, etc.). */
export function effectiveHasTiktokShopData(perms: Set<string>): boolean {
    return perms.has('tiktok.shop.data');
}

/** P&L / finance dashboard tab (view_pnl, restricted financials, full financials, or full shop). */
export function effectiveAllowsPnlFinanceTab(perms: Set<string>): boolean {
    return (
        perms.has('tiktok.shop.data') ||
        perms.has('view_pnl') ||
        perms.has('financials.view') ||
        perms.has('financials.restricted')
    );
}

/**
 * Marketing tab and ads-backed reads: full shop, or full financial (ad spend) — not P&L-only / restricted-only.
 */
export function effectiveAllowsMarketingFinanceTab(perms: Set<string>): boolean {
    return perms.has('tiktok.shop.data') || perms.has('financials.view');
}

export type ShopTabAccess = {
    overview: boolean;
    orders: boolean;
    products: boolean;
    profitLoss: boolean;
    marketing: boolean;
    dataAudit: boolean;
    financeDebug: boolean;
};

export function computeShopTabAccess(perms: Set<string>): ShopTabAccess {
    const operational = perms.has('tiktok.shop.data');
    const profitLoss = effectiveAllowsPnlFinanceTab(perms);
    const marketing = effectiveAllowsMarketingFinanceTab(perms);
    return {
        overview: operational,
        orders: operational,
        products: operational,
        profitLoss,
        marketing,
        dataAudit: operational,
        financeDebug: operational,
    };
}

/** Kanban / agency task board (Phase 2 agency-only). */
export function effectiveAllowsTasksBoard(perms: Set<string>): boolean {
    if (perms.has('tasks.manage')) return true;
    return (
        taskPermissionEquivalenceMatches(perms, 'tasks.view') ||
        taskPermissionEquivalenceMatches(perms, 'tasks.create') ||
        taskPermissionEquivalenceMatches(perms, 'tasks.edit')
    );
}

/** @deprecated Prefer effectiveHasTiktokShopData for operational exports; effectiveAllowsPnlFinanceTab for finance-only UX. */
export function effectiveAllowsShopDataOrFinancialView(perms: Set<string>): boolean {
    return effectiveAllowsPnlFinanceTab(perms);
}

/**
 * Dashboard email / digest — requires `dashboard.export_email` (seeded on Account Manager, not Account Coordinator).
 * Content (orders vs P&L) is enforced separately on send via API (`tiktok.shop.data` / `view_pnl`).
 */
export function effectiveAllowsOperationalDashboardEmail(perms: Set<string>): boolean {
    return perms.has('dashboard.export_email');
}

export function firstAccessibleShopTab(access: ShopTabAccess, canConfigureFinancialRestrictions: boolean): string {
    if (access.overview) return 'overview';
    if (access.profitLoss) return 'profit-loss';
    if (access.marketing) return 'marketing';
    if (access.orders) return 'orders';
    if (access.products) return 'products';
    if (canConfigureFinancialRestrictions) return 'financial-restrictions';
    if (access.dataAudit) return 'data-audit';
    if (access.financeDebug) return 'finance-debug';
    return 'profile';
}

export function shopTabIsAllowed(
    tabId: string,
    access: ShopTabAccess,
    canConfigureFinancialRestrictions: boolean
): boolean {
    if (tabId === 'notifications' || tabId === 'profile') return true;
    if (tabId === 'financial-restrictions') return canConfigureFinancialRestrictions;
    const map: Record<string, keyof ShopTabAccess | undefined> = {
        overview: 'overview',
        orders: 'orders',
        products: 'products',
        'profit-loss': 'profitLoss',
        marketing: 'marketing',
        'data-audit': 'dataAudit',
        'finance-debug': 'financeDebug',
    };
    const key = map[tabId];
    return key ? access[key] : false;
}

/** Seller-side team / restrictions management (aligns with extended user_is_seller_admin RPC). */
export function effectiveAllowsSellerTeamManagement(perms: Set<string>): boolean {
    return perms.has('users.manage');
}

/** Tenant role editor / invitations capability (system AA/SA bundle or explicit role-definition perms). */
export function effectiveAllowsRoleManagementSurface(perms: Set<string>): boolean {
    for (const a of ['users.manage', 'manage_roles', 'assign_roles', 'roles.manage']) {
        if (perms.has(a)) return true;
    }
    return false;
}
