import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { fetchMyEffectivePermissionsOnTenant, effectiveAllowsRoleManagementSurface } from '../hooks/useMyEffectivePermissions';
import { useAuth } from './AuthContext';
/** @see ../lib/tenantModel.ts — `parent_tenant_id` = agency→seller link, not permission inheritance */

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
    membership_roles?: Array<{
        revoked_at: string | null;
        roles: {
            id: string;
            name: string;
            scope: string;
            type: string;
        } | null;
    }>;
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

function membershipActiveRoleNames(m: MembershipRow): string[] {
    const names = new Set<string>();
    if (m.roles?.name) names.add(m.roles.name);
    for (const mr of m.membership_roles || []) {
        if (!mr?.revoked_at && mr.roles?.name) names.add(mr.roles.name);
    }
    return Array.from(names);
}

/** Pick one label to show when the user has several tenant roles. */
export function computePrimaryRoleBadge(memberships: MembershipRow[]): PrimaryRoleBadge | null {
    const active = memberships.filter((m) => m.status === 'active');
    const hasRole = (name: string, tenantType?: string) =>
        active.some((m) => (!tenantType || m.tenants?.type === tenantType) && membershipActiveRoleNames(m).includes(name));

    if (hasRole('Super Admin', 'platform')) {
        return { label: 'SUPER ADMIN', variant: 'super' };
    }
    if (hasRole('Agency Admin', 'agency')) {
        return { label: 'AGENCY ADMIN', variant: 'agency' };
    }
    const hasAM = hasRole('Account Manager');
    const hasAC = hasRole('Account Coordinator');
    if (hasAM && hasAC) {
        return { label: 'AC & AM', variant: 'account_mgr' };
    }
    if (hasAM) return { label: 'ACCOUNT MANAGER', variant: 'account_mgr' };
    if (hasAC) return { label: 'ACCOUNT COORDINATOR', variant: 'account_coord' };
    if (hasRole('Seller Admin', 'seller')) {
        return { label: 'SELLER ADMIN', variant: 'seller_admin' };
    }
    if (hasRole('Seller User')) {
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
            return 'bg-mamba-green/20 text-mamba-neon border-mamba-green/30';
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
    /** `profiles.tenant_id` for the signed-in user (JWT product context). */
    profileTenantId: string | null;
    /** Type of the canonical tenant row (`tenants.type`), when resolved. Used for agency-branded console without waiting on memberships. */
    profileTenantType: string | null;
    /** Status of canonical tenant row (`active` | `inactive` | `suspended`). */
    profileTenantStatus: string | null;
    /** Seller tenant's managing agency (`tenants.parent_tenant_id`); null if standalone seller. */
    profileTenantParentId: string | null;
    /** True when JWT tenant is an agency or a seller linked to an agency — seller-facing branding API applies. */
    sellerFacingBrandingEligible: boolean;
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
    /** True when the current tenant context is inactive/suspended. */
    isTenantAccessLocked: boolean;
    tenantAccessLockReason: 'inactive' | 'suspended' | null;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
    const { user, profile, loading: authLoading } = useAuth();

    const profileTenantId = profile?.tenant_id ?? null;

    const { data: tenantMeta, isLoading: loadingTenantMeta } = useQuery({
        queryKey: ['tenant-meta', profileTenantId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenants')
                .select('type, status, parent_tenant_id')
                .eq('id', profileTenantId!)
                .maybeSingle();
            if (error) throw error;
            return data;
        },
        enabled: Boolean(profileTenantId),
    });

    const profileTenantType = (tenantMeta?.type as string | undefined) ?? null;
    const profileTenantStatus = (tenantMeta?.status as string | undefined) ?? null;
    const profileTenantParentId = (tenantMeta?.parent_tenant_id as string | null | undefined) ?? null;
    const loadingProfileTenant = authLoading || (Boolean(profileTenantId) && loadingTenantMeta);

    const sellerFacingBrandingEligible = useMemo(() => {
        if (!profileTenantId || !profileTenantType) return false;
        if (profileTenantType === 'agency') return true;
        if (profileTenantType === 'seller') return profileTenantParentId != null;
        return false;
    }, [profileTenantId, profileTenantType, profileTenantParentId]);

    const { data: memberships = [], isLoading: loadingMemberships, refetch } = useQuery({
        queryKey: ['tenant-memberships', user?.id, profileTenantId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('tenant_memberships')
                .select(
                    `id, tenant_id, role_id, status, tenants ( id, name, type, parent_tenant_id, status ), roles ( id, name, scope, type ), membership_roles ( revoked_at, roles ( id, name, scope, type ) )`
                )
                .eq('user_id', user!.id)
                .eq('status', 'active');
            if (error) throw error;

            const tid = profileTenantId;
            const rows = ((data || []) as unknown as MembershipRow[]).filter((m) => {
                const type = m.tenants?.type;
                if (type === 'platform') return true;
                return !!tid && m.tenant_id === tid;
            });

            return rows;
        },
        // Wait for profile tenant — otherwise profileTenantId is undefined, filter strips seller/agency rows,
        // primaryRoleBadge is wrong briefly (Sidebar falls back to profiles.role "CLIENT").
        enabled: Boolean(user?.id && !loadingProfileTenant),
    });

    const isLoading = loadingProfileTenant || loadingMemberships;

    const agencyAdminTenantIds = useMemo(
        () =>
            memberships
                .filter((m) => m.tenants?.type === 'agency' && m.roles?.name === 'Agency Admin')
                .map((m) => m.tenant_id),
        [memberships],
    );

    const agencyMembershipIds = useMemo(
        () => memberships.filter((m) => m.tenants?.type === 'agency').map((m) => m.tenant_id),
        [memberships]
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

    // Fetch seller tenants assigned to the current agency user via user_seller_assignments.
    const { data: amAssignedSellerTenants = [] } = useQuery({
        queryKey: ['agency-user-assigned-sellers-for-mgmt', user?.id, agencyMembershipIds],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('user_seller_assignments')
                .select('seller_tenant_id, agency_tenant_id, tenants!seller_tenant_id ( id, name, type, status )')
                .eq('user_id', user!.id)
                .in('agency_tenant_id', agencyMembershipIds);
            if (error) throw error;
            return (data || [])
                .map((row: any) => ({
                    seller_tenant_id: row.seller_tenant_id as string,
                    agency_tenant_id: row.agency_tenant_id as string,
                    tenant: row.tenants as { id: string; name: string; type: string; status: string } | null,
                }))
                .filter((row: any) => row.tenant && row.tenant.status === 'active') as {
                    seller_tenant_id: string;
                    agency_tenant_id: string;
                    tenant: { id: string; name: string; type: string; status: string };
                }[];
        },
        enabled: !!user?.id && agencyMembershipIds.length > 0,
    });

    const membershipTenantIds = useMemo(() => {
        const ids = new Set<string>();
        for (const m of memberships) {
            if (m.status !== 'active') continue;
            if (m.tenants?.type === 'platform') continue;
            ids.add(m.tenant_id);
        }
        return Array.from(ids);
    }, [memberships]);

    const effectivePermQueries = useQueries({
        queries: membershipTenantIds.map((tid) => ({
            queryKey: ['my-effective-permissions', user?.id, tid],
            queryFn: () => fetchMyEffectivePermissionsOnTenant(tid),
            enabled: Boolean(user?.id && tid && !isLoading),
            staleTime: 60_000,
        })),
    });

    const value = useMemo(() => {
        const agencyMemberships = memberships.filter((m) => m.tenants?.type === 'agency');
        const isAgencyAdminOn = (agencyTenantId: string) =>
            memberships.some(
                (m) =>
                    m.tenant_id === agencyTenantId &&
                    m.tenants?.type === 'agency' &&
                    membershipActiveRoleNames(m).includes('Agency Admin')
            );
        const isAccountManagerOn = (agencyTenantId: string) =>
            memberships.some(
                (m) =>
                    m.tenant_id === agencyTenantId &&
                    m.tenants?.type === 'agency' &&
                    membershipActiveRoleNames(m).includes('Account Manager')
            );
        const isSellerAdminOn = (sellerTenantId: string) =>
            memberships.some(
                (m) =>
                    m.tenant_id === sellerTenantId &&
                    m.tenants?.type === 'seller' &&
                    membershipActiveRoleNames(m).includes('Seller Admin')
            );
        const isPlatformSuperAdmin = memberships.some(
            (m) => m.tenants?.type === 'platform' && membershipActiveRoleNames(m).includes('Super Admin')
        );
        const primaryRoleBadge = computePrimaryRoleBadge(memberships);
        const manageableAdminTenants: ManageableTenant[] = [];
        const seen = new Set<string>();
        for (const m of memberships) {
            const t = m.tenants;
            if (!t || seen.has(m.tenant_id)) continue;
            if (t.type === 'agency' && membershipActiveRoleNames(m).includes('Agency Admin')) {
                seen.add(m.tenant_id);
                manageableAdminTenants.push({ id: m.tenant_id, name: t.name, type: 'agency' });
            }
            if (t.type === 'seller' && membershipActiveRoleNames(m).includes('Seller Admin')) {
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
        for (const row of amAssignedSellerTenants) {
            const seller = row.tenant;
            if (!seen.has(seller.id)) {
                seen.add(seller.id);
                manageableAdminTenants.push({ id: seller.id, name: seller.name, type: 'seller' });
            }
        }
        for (let i = 0; i < membershipTenantIds.length; i++) {
            const tid = membershipTenantIds[i];
            const perms = effectivePermQueries[i]?.data;
            if (!perms || !effectiveAllowsRoleManagementSurface(perms)) continue;
            if (seen.has(tid)) continue;
            const m = memberships.find((x) => x.tenant_id === tid && x.status === 'active');
            const t = m?.tenants;
            if (!t || t.type === 'platform') continue;
            if (t.type !== 'agency' && t.type !== 'seller') continue;
            seen.add(tid);
            manageableAdminTenants.push({ id: tid, name: t.name, type: t.type });
        }
        // Strictly AM-only: assignment alone is not enough (AC assignments must not enable AM-only actions).
        const assignedSellerIds = new Set(
            amAssignedSellerTenants
                .filter((row) => isAccountManagerOn(row.agency_tenant_id))
                .map((row) => row.seller_tenant_id)
        );
        const isAccountManagerAssignedToSeller = (sellerTenantId: string | null | undefined) =>
            Boolean(sellerTenantId && assignedSellerIds.has(sellerTenantId));
        const lockSourceStatus =
            profileTenantStatus ||
            memberships.find((m) => m.tenant_id === profileTenantId)?.tenants?.status ||
            null;
        const isTenantAccessLocked = lockSourceStatus === 'inactive' || lockSourceStatus === 'suspended';
        const tenantAccessLockReason =
            lockSourceStatus === 'inactive' || lockSourceStatus === 'suspended'
                ? (lockSourceStatus as 'inactive' | 'suspended')
                : null;

        return {
            profileTenantId: profileTenantId ?? null,
            profileTenantType: profileTenantType ?? null,
            profileTenantStatus,
            profileTenantParentId,
            sellerFacingBrandingEligible,
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
            isTenantAccessLocked,
            tenantAccessLockReason,
        };
    }, [
        profileTenantId,
        profileTenantType,
        profileTenantStatus,
        profileTenantParentId,
        sellerFacingBrandingEligible,
        memberships,
        isLoading,
        refetch,
        linkedSellerTenants,
        amAssignedSellerTenants,
        membershipTenantIds,
        effectivePermQueries,
    ]);

    return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext() {
    const ctx = useContext(TenantContext);
    if (!ctx) {
        throw new Error('useTenantContext must be used within TenantProvider');
    }
    return ctx;
}
