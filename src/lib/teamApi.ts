import { apiFetch } from './apiClient';

export type TeamProfileRow = { id: string; email: string; full_name: string | null };
export type AgencySellerAssignmentRow = {
    seller_tenant_id: string;
    user_id: string;
    full_name: string | null;
    email: string | null;
    role_name: string | null;
};
export type SellerSearchRow = {
    id: string;
    name: string;
    status: string | null;
    parent_tenant_id: string | null;
    already_linked: boolean;
    linkable: boolean;
    not_linkable_reason: string | null;
};
export type PendingSellerLinkRow = {
    seller_tenant_id: string;
    seller_name: string;
    seller_status: string | null;
    parent_tenant_id: string | null;
    link_status: 'pending';
    token: string;
    expires_at: string;
};

export type MemberRoleAssignmentRow = {
    role_id: string;
    role_name: string | null;
};

export type TenantMemberRolesRow = {
    user_id: string;
    role_names: string[];
};

export async function searchTeamProfiles(tenantId: string, q: string): Promise<TeamProfileRow[]> {
    const params = new URLSearchParams({ tenantId, q });
    const res = await apiFetch(`/api/team/profile-search?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Search failed (${res.status})`);
    }
    return json.data ?? [];
}

export async function inviteTeamMember(
    tenantId: string,
    email: string | undefined,
    roleId: string,
    userId?: string
): Promise<{ userId: string; membershipId: string; invited: boolean }> {
    const res = await apiFetch('/api/team/invite-member', {
        method: 'POST',
        body: JSON.stringify({ tenantId, email: email ?? '', roleId, userId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Invite failed (${res.status})`);
    }
    const d = json.data ?? {};
    return {
        userId: d.userId,
        membershipId: d.membershipId,
        invited: d.invited === true,
    };
}

export async function unlinkAgencySeller(agencyTenantId: string, sellerTenantId: string): Promise<void> {
    const res = await apiFetch('/api/team/unlink-seller', {
        method: 'POST',
        body: JSON.stringify({ agencyTenantId, sellerTenantId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Unlink failed (${res.status})`);
    }
}

export async function getAgencySellerAssignments(agencyTenantId: string): Promise<AgencySellerAssignmentRow[]> {
    const params = new URLSearchParams({ agencyTenantId });
    const res = await apiFetch(`/api/team/agency-seller-assignments?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Load assignments failed (${res.status})`);
    }
    return (json.data || []) as AgencySellerAssignmentRow[];
}

export async function unassignSellerAccess(
    agencyTenantId: string,
    sellerTenantId: string,
    staffUserId: string
): Promise<void> {
    const res = await apiFetch('/api/team/unassign-seller-access', {
        method: 'POST',
        body: JSON.stringify({ agencyTenantId, sellerTenantId, staffUserId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Unassign failed (${res.status})`);
    }
}

export async function searchSellerTenants(agencyTenantId: string, q: string): Promise<SellerSearchRow[]> {
    const params = new URLSearchParams({ agencyTenantId, q });
    const res = await apiFetch(`/api/team/seller-search?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Seller search failed (${res.status})`);
    }
    return (json.data || []) as SellerSearchRow[];
}

export async function linkSellerToAgency(
    agencyTenantId: string,
    sellerTenantId: string
): Promise<{ token: string; notifiedSellerAdmins: number; alreadyLinked: boolean }> {
    const res = await apiFetch('/api/team/link-seller', {
        method: 'POST',
        body: JSON.stringify({ agencyTenantId, sellerTenantId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Link seller failed (${res.status})`);
    }
    const d = json.data ?? {};
    return {
        token: String(d.token || ''),
        notifiedSellerAdmins: Number(d.notifiedSellerAdmins || 0),
        alreadyLinked: d.alreadyLinked === true,
    };
}

export async function getPendingSellerLinks(agencyTenantId: string): Promise<PendingSellerLinkRow[]> {
    const params = new URLSearchParams({ agencyTenantId });
    const res = await apiFetch(`/api/team/pending-seller-links?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Load pending seller links failed (${res.status})`);
    }
    return (json.data || []) as PendingSellerLinkRow[];
}

export async function getMemberRoleAssignments(
    tenantId: string,
    userId: string
): Promise<MemberRoleAssignmentRow[]> {
    const params = new URLSearchParams({ tenantId, userId });
    const res = await apiFetch(`/api/team/member-roles?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Load member roles failed (${res.status})`);
    }
    return (json.data || []) as MemberRoleAssignmentRow[];
}

export async function syncMemberRoleAssignments(
    tenantId: string,
    userId: string,
    roleIds: string[]
): Promise<void> {
    const res = await apiFetch('/api/team/member-roles/sync', {
        method: 'POST',
        body: JSON.stringify({ tenantId, userId, roleIds }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Update member roles failed (${res.status})`);
    }
}

export async function getTenantMemberRoles(tenantId: string): Promise<TenantMemberRolesRow[]> {
    const params = new URLSearchParams({ tenantId });
    const res = await apiFetch(`/api/team/tenant-member-roles?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json.error || `Load tenant member roles failed (${res.status})`);
    }
    return (json.data || []) as TenantMemberRolesRow[];
}
