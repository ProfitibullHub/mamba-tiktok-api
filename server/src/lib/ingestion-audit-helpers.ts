import { supabase } from '../config/supabase.js';

const ACCOUNT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Resolve seller/agency tenant for audit_logs.tenant_id from accounts.id */
export async function tenantIdForAccount(accountId: string | null | undefined): Promise<string | null> {
    if (!accountId || !ACCOUNT_UUID_RE.test(accountId)) return null;
    const { data, error } = await supabase.from('accounts').select('tenant_id').eq('id', accountId).maybeSingle();
    if (error) return null;
    return typeof data?.tenant_id === 'string' ? data.tenant_id : null;
}

/** Strip large arrays from shop sync stats for immutable audit_logs.after_state */
export function sanitizeShopSyncStatsForAudit(stats: unknown): Record<string, unknown> | null {
    if (!stats || typeof stats !== 'object') return null;
    const out: Record<string, unknown> = {};
    for (const [phase, raw] of Object.entries(stats as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object') continue;
        const o = raw as Record<string, unknown>;
        const slice: Record<string, unknown> = {};
        if (typeof o.fetched === 'number') slice.fetched = o.fetched;
        if (typeof o.upserted === 'number') slice.upserted = o.upserted;
        if (typeof o.isIncremental === 'boolean') slice.isIncremental = o.isIncremental;
        if (typeof o.stoppedEarly === 'boolean') slice.stoppedEarly = o.stoppedEarly;
        if (typeof o.partial === 'boolean') slice.partial = o.partial;
        if (Object.keys(slice).length) out[phase] = slice;
    }
    return Object.keys(out).length ? out : null;
}

/** Compact shop worker result for audit_logs (no syncedOrders / product arrays). */
export function sanitizeShopSyncResultForAudit(result: unknown): Record<string, unknown> {
    const r = result as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return {};
    const out: Record<string, unknown> = {};
    if (typeof r.message === 'string') out.message = r.message;
    if (typeof r.isFirstSync === 'boolean') out.isFirstSync = r.isFirstSync;
    const stats = sanitizeShopSyncStatsForAudit(r.stats);
    if (stats) out.stats = stats;
    return out;
}

/** Ads full-sync result is already small; pass through known shape only */
export function sanitizeAdsSyncResultForAudit(result: unknown): Record<string, unknown> {
    const r = result as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return {};
    if (r.success === true && r.summary && typeof r.summary === 'object') {
        return { success: true, summary: { ...(r.summary as Record<string, unknown>) } };
    }
    return {};
}
