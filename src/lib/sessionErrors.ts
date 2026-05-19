import { supabase } from './supabase';
import { queryClient } from '../queryClient';
import { useShopStore } from '../store/useShopStore';

/** PostgREST errors from validate_active_auth_session (migration 20260515220000). */
export function isRevokedSessionPostgrestError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { code?: string; message?: string };
    if (e.code !== 'P0001') return false;
    const msg = (e.message ?? '').toLowerCase();
    return (
        msg.includes('session is invalid') ||
        msg.includes('logged out') ||
        msg.includes('missing session_id')
    );
}

let clearingStaleSession = false;

/** Drop cached JWT when the server deleted auth.sessions (global signOut or revoked session). */
export async function clearStaleAuthSession(): Promise<void> {
    if (clearingStaleSession) return;
    clearingStaleSession = true;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await supabase.auth.signOut({ scope: 'local' });
        queryClient.clear();
        useShopStore.getState().clearData();
    } catch (e) {
        console.warn('[auth] clearStaleAuthSession', e);
    } finally {
        clearingStaleSession = false;
    }
}
