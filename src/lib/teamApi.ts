import { apiFetch } from './apiClient';

export type TeamProfileRow = { id: string; email: string; full_name: string | null };

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
    email: string,
    roleId: string,
    userId?: string
): Promise<{ userId: string; membershipId: string; invited: boolean }> {
    const res = await apiFetch('/api/team/invite-member', {
        method: 'POST',
        body: JSON.stringify({ tenantId, email, roleId, userId }),
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
