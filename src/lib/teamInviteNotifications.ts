import type { UserNotification } from '../store/useConsoleNotificationStore';

/** Dismiss is keyed by invitation token (stable while invite is valid). */
export const DISMISSED_TEAM_INVITE_BANNER_TOKENS_KEY = 'mamba:dismissed-team-invite-banner-tokens';

/** @deprecated legacy id-based dismiss; merged in load below */
const DISMISSED_TEAM_INVITE_BANNER_IDS_KEY = 'mamba:dismissed-team-invite-banner-ids';

/** Membership (and similar) invites that use the accept-invitation flow. */
export function isStickyInvitationNotification(n: Pick<UserNotification, 'action_url'>): boolean {
    const url = n.action_url?.trim() ?? '';
    return url.includes('accept-invitation') && url.includes('token=');
}

export function extractInvitationTokenFromActionUrl(actionUrl: string | null | undefined): string | null {
    if (!actionUrl?.trim()) return null;
    const u = actionUrl.trim();
    try {
        const parsed = u.startsWith('http')
            ? new URL(u)
            : new URL(u.startsWith('/') ? `http://x${u}` : `http://x/${u}`);
        const t = parsed.searchParams.get('token');
        if (t && /^[0-9a-f-]{36}$/i.test(t)) return t;
    } catch {
        /* fall through */
    }
    const m = u.match(/(?:^|[?&])token=([0-9a-f-]{36})/i);
    return m ? m[1] : null;
}

export function loadDismissedInvitationBannerTokens(): Set<string> {
    const out = new Set<string>();
    try {
        const raw = localStorage.getItem(DISMISSED_TEAM_INVITE_BANNER_TOKENS_KEY);
        if (raw) {
            const arr = JSON.parse(raw) as unknown;
            if (Array.isArray(arr)) {
                for (const t of arr) {
                    if (typeof t === 'string' && t.length > 0) out.add(t);
                }
            }
        }
    } catch {
        /* ignore */
    }
    return out;
}

export function saveDismissedInvitationBannerTokens(tokens: Set<string>): void {
    try {
        localStorage.setItem(DISMISSED_TEAM_INVITE_BANNER_TOKENS_KEY, JSON.stringify([...tokens]));
    } catch {
        /* ignore quota / private mode */
    }
}

/** One-time migration: map legacy dismissed notification ids to tokens when possible. */
export function mergeLegacyDismissedBannerIdsIntoTokens(
    tokens: Set<string>,
    notifications: Pick<UserNotification, 'id' | 'action_url'>[]
): Set<string> {
    try {
        const raw = localStorage.getItem(DISMISSED_TEAM_INVITE_BANNER_IDS_KEY);
        if (!raw) return tokens;
        const ids = JSON.parse(raw) as unknown;
        if (!Array.isArray(ids)) return tokens;
        const idSet = new Set(ids.filter((x): x is string => typeof x === 'string'));
        if (idSet.size === 0) return tokens;
        if (notifications.length === 0) return tokens;

        const matching = notifications.filter((n) => idSet.has(n.id));
        if (matching.length === 0) {
            localStorage.removeItem(DISMISSED_TEAM_INVITE_BANNER_IDS_KEY);
            return tokens;
        }

        const next = new Set(tokens);
        for (const n of matching) {
            const tok = extractInvitationTokenFromActionUrl(n.action_url ?? null);
            if (tok) next.add(tok);
        }
        localStorage.removeItem(DISMISSED_TEAM_INVITE_BANNER_IDS_KEY);
        saveDismissedInvitationBannerTokens(next);
        return next;
    } catch {
        return tokens;
    }
}
