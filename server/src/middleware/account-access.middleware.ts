import type { NextFunction, Request, Response } from 'express';
import { supabase } from '../config/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RequestTenantContext = {
    userId: string;
    tenantId: string;
    tenantType: 'seller' | 'agency';
    assignedSellerIds: string[];
};

export async function userIsPlatformSuperAdmin(userId: string): Promise<boolean> {
    const [{ data: isSa, error: saErr }, { data: profile, error: profileErr }] = await Promise.all([
        supabase.rpc('user_is_platform_super_admin', { p_user_id: userId }),
        supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
    ]);
    if (saErr || profileErr) return false;
    return isSa === true || profile?.role === 'admin';
}

export async function resolveRequestUserId(req: Request): Promise<string | null> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;

    let lastError: { message?: string } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabase.auth.getUser(token);
        if (data?.user?.id) return data.user.id;
        lastError = error;
        if (error && !error.message?.includes('fetch failed')) break;
        if (attempt === 0) console.log('[resolveRequestUserId] Retrying getUser after transient error...');
    }
    if (lastError?.message) {
        console.warn('[resolveRequestUserId] getUser failed:', lastError.message);
    }
    return null;
}

function uniqueIds(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))];
}

export async function resolveRequestTenantContext(req: Request): Promise<RequestTenantContext | null> {
    const userId = await resolveRequestUserId(req);
    if (!userId) return null;

    const { data, error } = await supabase.rpc('get_request_tenant_context', {
        p_user_id: userId,
    });

    if (error) {
        console.error('[account-access] get_request_tenant_context', error.message);
        return null;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.tenant_id || (row.tenant_type !== 'seller' && row.tenant_type !== 'agency')) {
        return null;
    }

    return {
        userId,
        tenantId: row.tenant_id,
        tenantType: row.tenant_type,
        assignedSellerIds: uniqueIds(row.assigned_seller_ids),
    };
}

function accountAccessUsesWriteCheck(method: string): boolean {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

/**
 * POST /api/tiktok-shop/sync/:accountId and POST /api/tiktok-ads/sync/:accountId pull data from TikTok into our DB.
 * Seller User is allowed to sync (read-level visibility) but not other writes — use the read access path for these routes only.
 */
function isShopOrAdsSyncPostRequest(req: Pick<Request, 'method' | 'baseUrl' | 'path'>): boolean {
    if (req.method.toUpperCase() !== 'POST') return false;
    const path = `${req.baseUrl || ''}${req.path || ''}`;
    const m = path.match(/\/sync\/([^/?#]+)$/);
    if (!m) return false;
    return UUID_RE.test(m[1]);
}

/**
 * Normalize RPC booleans from PostgREST / supabase-js (usually strict boolean true/false).
 * Be explicit so we never deny access because of an unexpected serialized shape.
 */
function rpcBooleanTrue(data: unknown): boolean {
    if (typeof data === 'boolean') return data;
    if (data === null || data === undefined) return false;
    if (typeof data === 'string') {
        const s = data.trim().toLowerCase();
        return s === 'true' || s === 't' || s === '1' || s === 'yes';
    }
    if (typeof data === 'number') return data === 1;
    return false;
}

/**
 * Shop writes: same visibility as reads, except users whose *direct* membership on this account's
 * seller tenant is role "Seller User". Agency Admin / AM / AC have no row on the seller tenant;
 * Super Admin / legacy admin often have none either — they still pass read RPC, then pass here.
 *
 * Implemented in Node (not a second RPC) so production is not blocked if check_user_account_write_access
 * was never migrated, and to avoid strict `data === true` mismatches on some clients.
 */
async function userCanWriteShopAccount(userId: string, accountId: string): Promise<boolean> {
    const { data: readOk, error: readErr } = await supabase.rpc('check_user_account_write_access', {
        p_account_id: accountId,
        p_user_id: userId,
    });
    if (readErr) {
        console.error('[account-access] check_user_account_write_access', readErr.message);
        return false;
    }
    return rpcBooleanTrue(readOk);
}

export async function userCanAccessAccount(
    userId: string,
    accountId: string,
    method: string = 'GET',
    req?: Pick<Request, 'method' | 'baseUrl' | 'path'>
): Promise<boolean> {
    // Platform super admins can view/manage all accounts irrespective of tenant-local membership.
    if (await userIsPlatformSuperAdmin(userId)) {
        return true;
    }

    const m = method.toUpperCase();
    if (accountAccessUsesWriteCheck(m) && !(req && isShopOrAdsSyncPostRequest(req))) {
        return userCanWriteShopAccount(userId, accountId);
    }
    const { data, error } = await supabase.rpc('check_user_account_access', {
        p_account_id: accountId,
        p_user_id: userId,
    });
    if (error) {
        console.error('[account-access] check_user_account_access', error.message);
        return false;
    }
    return rpcBooleanTrue(data);
}

/** Validates accountId from JSON body or ?accountId= on every request (when present). */
export async function enforceRequestAccountAccess(req: Request, res: Response, next: NextFunction) {
    const ids = new Set<string>();
    const b = req.body?.accountId;
    const q = req.query?.accountId;
    if (typeof b === 'string' && UUID_RE.test(b)) ids.add(b);
    if (typeof q === 'string' && UUID_RE.test(q)) ids.add(q);

    if (ids.size === 0) {
        next();
        return;
    }

    try {
        const ctx = await resolveRequestTenantContext(req);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        for (const accountId of ids) {
            const ok = await userCanAccessAccount(ctx.userId, accountId, req.method, req);
            if (!ok) {
                res.status(403).json({
                    success: false,
                    error: accountAccessUsesWriteCheck(req.method)
                        ? 'Write access denied for this account'
                        : 'Access denied',
                });
                return;
            }
        }
        next();
    } catch (e: any) {
        next(e);
    }
}

/** Express param() handler for :accountId route segments. */
export function verifyAccountIdParam(req: Request, res: Response, next: NextFunction, accountId: string) {
    void (async () => {
        try {
            if (!UUID_RE.test(accountId)) {
                next();
                return;
            }
            const ctx = await resolveRequestTenantContext(req);
            if (!ctx) {
                res.status(401).json({ success: false, error: 'Authorization required' });
                return;
            }
            const ok = await userCanAccessAccount(ctx.userId, accountId, req.method, req);
            if (!ok) {
                res.status(403).json({
                    success: false,
                    error: accountAccessUsesWriteCheck(req.method)
                        ? 'Write access denied for this account'
                        : 'Access denied',
                });
                return;
            }
            next();
        } catch (e) {
            next(e);
        }
    })();
}

/** POST /auth/start, /partner/start — body.accountId */
export async function enforceBodyAccountAccess(req: Request, res: Response, next: NextFunction) {
    try {
        const accountId = req.body?.accountId;
        if (!accountId || typeof accountId !== 'string' || !UUID_RE.test(accountId)) {
            res.status(400).json({ success: false, error: 'Valid accountId is required' });
            return;
        }
        const ctx = await resolveRequestTenantContext(req);
        if (!ctx) {
            res.status(401).json({ success: false, error: 'Authorization required' });
            return;
        }
        const ok = await userCanAccessAccount(ctx.userId, accountId, req.method, req);
        if (!ok) {
            res.status(403).json({
                success: false,
                error: accountAccessUsesWriteCheck(req.method)
                    ? 'Write access denied for this account'
                    : 'Access denied',
            });
            return;
        }
        next();
    } catch (e) {
        next(e);
    }
}

/** POST /auth/finalize — body.accountId */
export const enforceFinalizeAccountAccess = enforceBodyAccountAccess;
