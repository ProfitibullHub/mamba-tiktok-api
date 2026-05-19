import { supabase } from '../config/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate Supabase access token for Express routes: signature/exp via auth.getUser,
 * then ensure session_id still exists in auth.sessions (revoked on global signOut).
 */
export async function resolveUserIdFromBearerToken(token: string): Promise<string | null> {
    let lastError: { message?: string } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabase.auth.getUser(token);
        if (data?.user?.id) {
            const sessionId = sessionIdFromAccessToken(token);
            if (sessionId) {
                const active = await isAuthSessionActive(sessionId);
                if (!active) return null;
            }
            return data.user.id;
        }
        lastError = error;
        if (error && !error.message?.includes('fetch failed')) break;
        if (attempt === 0) console.log('[jwt-session] Retrying getUser after transient error...');
    }
    if (lastError?.message) {
        console.warn('[jwt-session] getUser failed:', lastError.message);
    }
    return null;
}

/** Decode JWT payload without verifying signature (caller must validate via auth.getUser first). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const part = token.split('.')[1];
        if (!part) return null;
        const json = Buffer.from(part, 'base64url').toString('utf8');
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export function sessionIdFromAccessToken(token: string): string | null {
    const payload = decodeJwtPayload(token);
    const sid = payload?.session_id;
    return typeof sid === 'string' && UUID_RE.test(sid) ? sid : null;
}

/** False when session row was removed (global signOut) even if JWT has not expired. */
export async function isAuthSessionActive(sessionId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('auth_session_is_active', {
        p_session_id: sessionId,
    });
    if (error) {
        console.warn('[jwt-session] auth_session_is_active', error.message);
        return false;
    }
    return data === true;
}
