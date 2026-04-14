import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export type MembershipRow = {
    id: string;
    tenant_id: string;
    role_id: string;
    status: string;
    tenants: {
        id: string;
        name: string;
        type: string;
        parent_tenant_id: string | null;
        status: string;
    } | null;
    roles: {
        id: string;
        name: string;
        scope: string;
        type: string;
    } | null;
};

export type ManageableTenant = {
    id: string;
    name: string;
    type: 'agency' | 'seller';
};

/** Highest-priority RBAC role for UI badges (sidebar, profile). */
export type PrimaryRoleBadgeVariant =
    | 'super'
    | 'agency'
    | 'account_mgr'
    | 'account_coord'
    | 'seller_admin'
    | 'seller_user'
    | 'custom'
    | 'tenant_role';

export type PrimaryRoleBadge = {
    label: string;
    variant: PrimaryRoleBadgeVariant;
};

/** Pick one label to show when the user has several tenant roles. */
export function computePrimaryRoleBadge(memberships: MembershipRow[]): PrimaryRoleBadge | null {
    const active = memberships.filter((m) => m.status === 'active' && m.roles?.name);
    if (active.some((m) => m.tenants?.type === 'platform' && m.roles?.name === 'Super Admin')) {
        return { label: 'SUPER ADMIN', variant: 'super' };
    }
    if (active.some((m) => m.tenants?.type === 'agency' && m.roles?.name === 'Agency Admin')) {
        return { label: 'AGENCY ADMIN', variant: 'agency' };
    }
    if (active.some((m) => m.roles?.name === 'Account Manager')) {
        return { label: 'ACCOUNT MANAGER', variant: 'account_mgr' };
    }
    if (active.some((m) => m.roles?.name === 'Account Coordinator')) {
        return { label: 'ACCOUNT COORDINATOR', variant: 'account_coord' };
    }
    if (active.some((m) => m.tenants?.type === 'seller' && m.roles?.name === 'Seller Admin')) {
        return { label: 'SELLER ADMIN', variant: 'seller_admin' };
    }
    if (active.some((m) => m.roles?.name === 'Seller User')) {
        return { label: 'SELLER USER', variant: 'seller_user' };
    }

    // Custom roles and any other tenant-assigned role not matched above (show real role name, not profiles.role).
    const tenantOrder = (t: string | undefined) =>
        t === 'seller' ? 0 : t === 'agency' ? 1 : t === 'platform' ? 2 : 3;
    const sorted = [...active].sort((a, b) => {
        const d = tenantOrder(a.tenants?.type) - tenantOrder(b.tenants?.type);
        if (d !== 0) return d;
        return (a.tenants?.name ?? '').localeCompare(b.tenants?.name ?? '');
    });
    const preferCustom = sorted.find((m) => m.roles?.type === 'custom');
    const pick = preferCustom ?? sorted[0];
    if (pick?.roles?.name) {
        const raw = pick.roles.name.trim();
        const upper = raw.toUpperCase();
        const label = upper.length <= 26 ? upper : `${upper.slice(0, 23)}…`;
        return {
            label,
            variant: pick.roles.type === 'custom' ? 'custom' : 'tenant_role',
        };
    }

    return null;
}

/** Tailwind classes for role pills (sidebar, profile). */
export function primaryRoleBadgeClassName(variant: PrimaryRoleBadgeVariant): string {
    switch (variant) {
        case 'super':
            return 'bg-pink-500/20 text-pink-400 border-pink-500/30';
        case 'agency':
            return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
        case 'account_mgr':
        case 'account_coord':
            return 'bg-violet-500/15 text-violet-200 border-violet-500/25';
        case 'seller_admin':
            return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
        case 'seller_user':
            return 'bg-slate-500/20 text-slate-300 border-slate-500/25';
        case 'custom':
            return 'bg-cyan-500/15 text-cyan-200 border-cyan-500/35';
        case 'tenant_role':
            return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30';
        default:
            return 'bg-slate-500/20 text-slate-300 border-slate-500/25';
    }
}

type TenantContextValue = {
    memberships: MembershipRow[];
    loading: boolean;
    refetch: () => void;
    agencyMemberships: MembershipRow[];
    isAgencyAdminOn: (agencyTenantId: string) => boolean;
    isAccountManagerOn: (agencyTenantId: string) => boolean;
    isSellerAdminOn: (sellerTenantId: string) => boolean;
    isPlatformSuperAdmin: boolean;
    /** Sidebar / profile: derived from active tenant memberships (not profiles.role). */
    primaryRoleBadge: PrimaryRoleBadge | null;
    /** Agency Admin (any) or Seller Admin (any) — for Team & roles UI. */
    manageableAdminTenants: ManageableTenant[];
    hasAgencyAccess: boolean;
    /** True when user is a system Account Manager assigned to this seller tenant (AM scope). */
    isAccountManagerAssignedToSeller: (sellerTenantId: string | null | undefined) => boolean;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();

    const { data: memberships = [], isLoading, refetch } = useQuery({
        queryKey: ['tenant-memberships', user?.id],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenant_memberships')
                .select(
                    `id, tenant_id, role_id, status, tenants ( id, name, type, parent_tenant_id, status ), roles ( id, name, scope, type )`
                )
                .eq('user_id', user!.id)
                .eq('status', 'active');
            if (error) throw error;
            return (data || []) as unknown as MembershipRow[];
        },
        enabled: !!user?.id,
    });

    // Agency Admin IDs (for fetching linked seller tenants)
    const agencyAdminTenantIds = useMemo(
        () =>
            memberships
                .filter((m) => m.tenants?.type === 'agency' && m.roles?.name === 'Agency Admin')
                .map((m) => m.tenant_id),
        [memberships],
    );

    // AM membership IDs (for fetching assigned seller tenants)
    const amMembershipIds = useMemo(
        () =>
            memberships
                .filter((m) => m.tenants?.type === 'agency' && m.roles?.name === 'Account Manager')
                .map((m) => m.id),
        [memberships],
    );

    // Fetch seller tenants linked to agencies where the user is Agency Admin
    const { data: linkedSellerTenants = [] } = useQuery({
        queryKey: ['agency-linked-sellers-for-mgmt', agencyAdminTenantIds],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenants')
                .select('id, name, type')
                .in('parent_tenant_id', agencyAdminTenantIds)
                .eq('type', 'seller')
                .eq('status', 'active')
                .order('name');
            if (error) throw error;
            return (data || []) as { id: string; name: string; type: string }[];
        },
        enabled: agencyAdminTenantIds.length > 0,
    });

    // Fetch seller tenants assigned to AM memberships via user_seller_assignments
    const { data: amAssignedSellerTenants = [] } = useQuery({
        queryKey: ['am-assigned-sellers-for-mgmt', amMembershipIds],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('user_seller_assignments')
                .select('seller_tenant_id, tenants!seller_tenant_id ( id, name, type, status )')
                .in('tenant_membership_id', amMembershipIds);
            if (error) throw error;
            return (data || [])
                .map((row: any) => row.tenants)
                .filter((t: any) => t && t.status === 'active') as { id: string; name: string; type: string }[];
        },
        enabled: amMembershipIds.length > 0,
    });

    const value = useMemo(() => {
        const agencyMemberships = memberships.filter((m) => m.tenants?.type === 'agency');
        const isAgencyAdminOn = (agencyTenantId: string) =>
            memberships.some(
                (m) =>
                    m.tenant_id === agencyTenantId &&
                    m.tenants?.type === 'agency' &&
                    m.roles?.name === 'Agency Admin'
            );
        const isAccountManagerOn = (agencyTenantId: string) =>
            memberships.some(
                (m) =>
                    m.tenant_id === agencyTenantId &&
                    m.tenants?.type === 'agency' &&
                    m.roles?.name === 'Account Manager'
            );
        const isSellerAdminOn = (sellerTenantId: string) =>
            memberships.some(
                (m) =>
                    m.tenant_id === sellerTenantId &&
                    m.tenants?.type === 'seller' &&
                    m.roles?.name === 'Seller Admin'
            );
        const isPlatformSuperAdmin = memberships.some(
            (m) => m.tenants?.type === 'platform' && m.roles?.name === 'Super Admin'
        );
        const primaryRoleBadge = computePrimaryRoleBadge(memberships);
        const manageableAdminTenants: ManageableTenant[] = [];
        const seen = new Set<string>();
        for (const m of memberships) {
            const t = m.tenants;
            if (!t || seen.has(m.tenant_id)) continue;
            if (t.type === 'agency' && m.roles?.name === 'Agency Admin') {
                seen.add(m.tenant_id);
                manageableAdminTenants.push({ id: m.tenant_id, name: t.name, type: 'agency' });
            }
            if (t.type === 'seller' && m.roles?.name === 'Seller Admin') {
                seen.add(m.tenant_id);
                manageableAdminTenants.push({ id: m.tenant_id, name: t.name, type: 'seller' });
            }
        }
        // Include linked seller tenants that the Agency Admin can manage
        for (const seller of linkedSellerTenants) {
            if (!seen.has(seller.id)) {
                seen.add(seller.id);
                manageableAdminTenants.push({ id: seller.id, name: seller.name, type: 'seller' });
            }
        }
        // Include sellers assigned to AM memberships
        for (const seller of amAssignedSellerTenants) {
            if (!seen.has(seller.id)) {
                seen.add(seller.id);
                manageableAdminTenants.push({ id: seller.id, name: seller.name, type: 'seller' });
            }
        }
        const assignedSellerIds = new Set(amAssignedSellerTenants.map((s) => s.id));
        const isAccountManagerAssignedToSeller = (sellerTenantId: string | null | undefined) =>
            Boolean(sellerTenantId && assignedSellerIds.has(sellerTenantId));

        return {
            memberships,
            loading: isLoading,
            refetch,
            agencyMemberships,
            isAgencyAdminOn,
            isAccountManagerOn,
            isSellerAdminOn,
            isPlatformSuperAdmin,
            primaryRoleBadge,
            manageableAdminTenants,
            hasAgencyAccess: agencyMemberships.length > 0,
            isAccountManagerAssignedToSeller,
        };
    }, [memberships, isLoading, refetch, linkedSellerTenants, amAssignedSellerTenants]);

    return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext() {
    const ctx = useContext(TenantContext);
    if (!ctx) {
        throw new Error('useTenantContext must be used within TenantProvider');
    }
    return ctx;
}
