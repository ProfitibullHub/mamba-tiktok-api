import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export type PendingMembershipInvite = {
    membershipId: string;
    tenantName: string | null;
    token: string;
    acceptPath: string;
};

type MembershipRow = {
    id: string;
    tenants: { name: string } | null;
    membership_invitations:
        | { token: string; expires_at: string; accepted_at: string | null }
        | { token: string; expires_at: string; accepted_at: string | null }[]
        | null;
};

function normalizeInvites(rows: MembershipRow[] | null): PendingMembershipInvite[] {
    const out: PendingMembershipInvite[] = [];
    const now = Date.now();
    for (const m of rows || []) {
        const raw = m.membership_invitations;
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        for (const inv of list) {
            if (inv.accepted_at) continue;
            if (!inv.token || new Date(inv.expires_at).getTime() <= now) continue;
            out.push({
                membershipId: m.id,
                tenantName: m.tenants?.name ?? null,
                token: inv.token,
                acceptPath: `/accept-invitation?token=${inv.token}`,
            });
        }
    }
    return out;
}

/**
 * Real pending team membership invites for the current user (invited + valid token).
 * Accept/decline updates DB so this list becomes empty without local dismiss.
 */
export function usePendingMembershipInvites(enabled: boolean) {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['pending-membership-invites', user?.id],
        enabled: enabled && !!user?.id,
        queryFn: async (): Promise<PendingMembershipInvite[]> => {
            const { data, error } = await supabase
                .from('tenant_memberships')
                .select(
                    `
                    id,
                    tenants (name),
                    membership_invitations (token, expires_at, accepted_at)
                `
                )
                .eq('user_id', user!.id)
                .eq('status', 'invited');

            if (error) throw error;
            return normalizeInvites((data || []) as MembershipRow[]);
        },
        staleTime: 0,
        refetchOnWindowFocus: true,
    });
}
