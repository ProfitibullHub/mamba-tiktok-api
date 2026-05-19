import { supabase, type Profile } from './supabase';
import { queryClient } from '../queryClient';

export const profileQueryKey = (userId: string) => ['profile', userId] as const;

/**
 * Legacy account-type flag on `profiles` (NOT tenant RBAC).
 *
 * - `client` — default for seller/agency users; real permissions come from `tenant_memberships` + `roles`.
 * - `admin` — legacy Mamba platform operator; prefer platform Super Admin membership in new code.
 * - `moderator` / `accountant` — reserved legacy values; rarely used.
 *
 * UI badges (Seller Admin, Agency Admin, etc.) use `computePrimaryRoleBadge` from memberships.
 */
export type ProfileLegacyRole = Profile['role'];

/** Load profile row; create minimal profile if missing (no seller tenant until onboarding). */
export async function fetchOrCreateProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) throw error;
    if (data) return data as Profile;

    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser || authUser.id !== userId) return null;

    const email = (authUser.email ?? '').trim();
    if (!email) {
        console.error('[profile] Cannot create profile: auth user has no email');
        return null;
    }

    const fullName =
        authUser.user_metadata?.full_name?.trim() ||
        email.split('@')[0] ||
        'User';
    const row = {
        id: authUser.id,
        email,
        full_name: fullName,
        role: 'client' as const,
        tenant_id: null as string | null,
        updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .insert(row)
        .select('*')
        .maybeSingle();

    if (insertError?.code === '23505') {
        const { data: existing, error: readErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();
        if (readErr) throw readErr;
        return (existing as Profile) ?? null;
    }
    if (insertError) throw insertError;

    if (inserted) {
        await queryClient.invalidateQueries({ queryKey: ['tenant-meta'] });
        await queryClient.invalidateQueries({ queryKey: ['tenant-memberships', userId] });
        await queryClient.invalidateQueries({ queryKey: ['accounts', userId] });
    }
    return (inserted as Profile) ?? null;
}
