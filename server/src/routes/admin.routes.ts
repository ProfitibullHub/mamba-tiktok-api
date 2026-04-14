import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import { TikTokShopApiService, TikTokShopError } from '../services/tiktok-shop-api.service.js';
import {
    formatShopDateISO,
    getShopDayEndExclusiveTimestamp,
    getShopDayStartTimestamp,
} from '../utils/dateUtils.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const tiktokShopApi = new TikTokShopApiService();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getActorId(req: express.Request): string | null {
    return (req as any).user?.id ?? null;
}

/** Remove user from tenants; delete orphan seller/agency tenants when user was the only active member. */
async function removeUserFromTenantsWithOrphanCleanup(targetUserId: string): Promise<{ tenantsDeleted: string[] }> {
    const tenantsDeleted: string[] = [];

    const { data: memberships, error: memErr } = await supabase
        .from('tenant_memberships')
        .select('id, tenant_id')
        .eq('user_id', targetUserId)
        .eq('status', 'active');

    if (memErr) throw memErr;
    const tenantIds = [...new Set((memberships || []).map((m: any) => m.tenant_id))];

    for (const tenantId of tenantIds) {
        const { count, error: cErr } = await supabase
            .from('tenant_memberships')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('status', 'active');

        if (cErr) throw cErr;
        const activeCount = count ?? 0;

        if (activeCount > 1) {
            const { error: delMemErr } = await supabase
                .from('tenant_memberships')
                .delete()
                .eq('user_id', targetUserId)
                .eq('tenant_id', tenantId);
            if (delMemErr) throw delMemErr;
            continue;
        }

        if (activeCount !== 1) continue;

        const { data: tenant, error: tErr } = await supabase
            .from('tenants')
            .select('id, type')
            .eq('id', tenantId)
            .single();

        if (tErr || !tenant) continue;

        const tType = (tenant as any).type as string;

        if (tType === 'platform') {
            const { error: delMemErr } = await supabase
                .from('tenant_memberships')
                .delete()
                .eq('user_id', targetUserId)
                .eq('tenant_id', tenantId);
            if (delMemErr) throw delMemErr;
            continue;
        }

        if (tType === 'agency') {
            const { count: childCount, error: chErr } = await supabase
                .from('tenants')
                .select('*', { count: 'exact', head: true })
                .eq('parent_tenant_id', tenantId)
                .eq('type', 'seller');

            if (chErr) throw chErr;
            if ((childCount ?? 0) > 0) {
                const { error: delMemErr } = await supabase
                    .from('tenant_memberships')
                    .delete()
                    .eq('user_id', targetUserId)
                    .eq('tenant_id', tenantId);
                if (delMemErr) throw delMemErr;
                continue;
            }

            const { error: delTenantErr } = await supabase.from('tenants').delete().eq('id', tenantId);
            if (delTenantErr) throw delTenantErr;
            tenantsDeleted.push(tenantId);
            continue;
        }

        if (tType === 'seller') {
            const { error: accDelErr } = await supabase.from('accounts').delete().eq('tenant_id', tenantId);
            if (accDelErr) throw accDelErr;
            const { error: delTenantErr } = await supabase.from('tenants').delete().eq('id', tenantId);
            if (delTenantErr) throw delTenantErr;
            tenantsDeleted.push(tenantId);
        }
    }

    return { tenantsDeleted };
}

// Apply admin middleware to all routes
router.use(adminMiddleware);

// GET /api/admin/stats - Platform-wide tenant-aware statistics
router.get('/stats', async (req, res) => {
    try {
        const [
            { count: userCount, error: userErr },
            { count: storeCount, error: storeErr },
            { data: tenantRows, error: tenantErr },
            { count: membershipCount, error: memErr },
            { data: roleDistRows, error: roleDistErr },
        ] = await Promise.all([
            supabase.from('profiles').select('*', { count: 'exact', head: true }),
            supabase.from('tiktok_shops').select('*', { count: 'exact', head: true }),
            supabase.from('tenants').select('type').eq('status', 'active'),
            supabase.from('tenant_memberships').select('*', { count: 'exact', head: true }).eq('status', 'active'),
            supabase
                .from('tenant_memberships')
                .select('roles(name)')
                .eq('status', 'active'),
        ]);

        const firstErr = userErr || storeErr || tenantErr || memErr || roleDistErr;
        if (firstErr) throw firstErr;

        const agencies = (tenantRows || []).filter((t: any) => t.type === 'agency').length;
        const sellers = (tenantRows || []).filter((t: any) => t.type === 'seller').length;

        // Build role distribution
        const roleCounts = new Map<string, number>();
        for (const row of (roleDistRows || [])) {
            const name = (row as any).roles?.name;
            if (name) roleCounts.set(name, (roleCounts.get(name) || 0) + 1);
        }
        const roleDistribution = Array.from(roleCounts.entries())
            .map(([role_name, count]) => ({ role_name, count }))
            .sort((a, b) => b.count - a.count);

        const superAdminCount = roleCounts.get('Super Admin') || 0;

        res.json({
            success: true,
            data: {
                totalUsers: userCount || 0,
                totalStores: storeCount || 0,
                agencies,
                sellers,
                totalTenants: agencies + sellers,
                totalMemberships: membershipCount || 0,
                superAdminCount,
                roleDistribution,
            },
        });
    } catch (error: any) {
        console.error('[Admin API] Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/users - List users with tenant memberships and connected shops
router.get('/users', async (req, res) => {
    try {
        const [
            { data: profiles, error: profileErr },
            { data: memberships, error: memErr },
            listResult,
        ] = await Promise.all([
            supabase
                .from('profiles')
                .select(`
                    id, email, full_name, role, created_at,
                    user_accounts (
                        account_id,
                        accounts (
                            id, name,
                            tiktok_shops ( id, shop_name )
                        )
                    )
                `)
                .order('created_at', { ascending: false }),
            supabase
                .from('tenant_memberships')
                .select('user_id, status, roles(name), tenants(name, type)')
                .eq('status', 'active'),
            supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        ]);

        if (profileErr) throw profileErr;
        if (memErr) throw memErr;
        if (listResult.error) throw listResult.error;

        const bannedMap = new Map<string, boolean>();
        for (const u of listResult.data?.users || []) {
            const bu = (u as any).banned_until as string | undefined;
            const banned = bu ? new Date(bu).getTime() > Date.now() : false;
            bannedMap.set(u.id, banned);
        }

        // Index memberships by user_id
        const memByUser = new Map<string, any[]>();
        for (const m of (memberships || [])) {
            const uid = (m as any).user_id;
            if (!memByUser.has(uid)) memByUser.set(uid, []);
            memByUser.get(uid)!.push({
                role_name: (m as any).roles?.name ?? null,
                tenant_name: (m as any).tenants?.name ?? null,
                tenant_type: (m as any).tenants?.type ?? null,
            });
        }

        const users = (profiles || []).map((p: any) => {
            const shops: { id: string; shop_name: string }[] = [];
            for (const ua of (p.user_accounts || [])) {
                for (const shop of (ua.accounts?.tiktok_shops || [])) {
                    shops.push({ id: shop.id, shop_name: shop.shop_name });
                }
            }
            return {
                id: p.id,
                email: p.email,
                full_name: p.full_name,
                created_at: p.created_at,
                memberships: memByUser.get(p.id) || [],
                shops,
                shop_count: shops.length,
                is_banned: bannedMap.get(p.id) ?? false,
            };
        });

        res.json({ success: true, data: users });
    } catch (error: any) {
        console.error('[Admin API] Users error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/admin/users/:id — smart delete (orphan tenants + auth user)
router.delete('/users/:id', async (req, res) => {
    try {
        const targetId = req.params.id;
        const actorId = getActorId(req);
        if (!UUID_RE.test(targetId)) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }
        if (!actorId || targetId === actorId) {
            return res.status(403).json({ success: false, error: 'You cannot delete your own account' });
        }

        const { tenantsDeleted } = await removeUserFromTenantsWithOrphanCleanup(targetId);

        const { error: delAuthErr } = await supabase.auth.admin.deleteUser(targetId);
        if (delAuthErr) {
            console.error('[Admin API] deleteUser', delAuthErr);
            return res.status(400).json({ success: false, error: delAuthErr.message });
        }

        res.json({
            success: true,
            data: { deletedUserId: targetId, tenantsDeleted },
        });
    } catch (error: any) {
        console.error('[Admin API] DELETE user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/users/:id/revoke-memberships
router.post('/users/:id/revoke-memberships', async (req, res) => {
    try {
        const targetId = req.params.id;
        const actorId = getActorId(req);
        if (!UUID_RE.test(targetId)) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }
        if (!actorId || targetId === actorId) {
            return res.status(403).json({ success: false, error: 'You cannot revoke your own memberships' });
        }

        const { tenantsDeleted } = await removeUserFromTenantsWithOrphanCleanup(targetId);

        const { error: wipeErr } = await supabase.from('tenant_memberships').delete().eq('user_id', targetId);
        if (wipeErr) throw wipeErr;

        res.json({
            success: true,
            data: { userId: targetId, tenantsDeleted },
        });
    } catch (error: any) {
        console.error('[Admin API] revoke-memberships error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/users/:id/suspend
router.post('/users/:id/suspend', async (req, res) => {
    try {
        const targetId = req.params.id;
        const actorId = getActorId(req);
        if (!UUID_RE.test(targetId)) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }
        if (!actorId || targetId === actorId) {
            return res.status(403).json({ success: false, error: 'You cannot suspend your own account' });
        }

        const { error } = await supabase.auth.admin.updateUserById(targetId, {
            ban_duration: '876000h',
        } as any);
        if (error) {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.json({ success: true, data: { userId: targetId, suspended: true } });
    } catch (error: any) {
        console.error('[Admin API] suspend user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/users/:id/unsuspend
router.post('/users/:id/unsuspend', async (req, res) => {
    try {
        const targetId = req.params.id;
        if (!UUID_RE.test(targetId)) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }

        const { error } = await supabase.auth.admin.updateUserById(targetId, {
            ban_duration: 'none',
        } as any);
        if (error) {
            return res.status(400).json({ success: false, error: error.message });
        }
        res.json({ success: true, data: { userId: targetId, suspended: false } });
    } catch (error: any) {
        console.error('[Admin API] unsuspend user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/users/:id/reset-password — sends recovery email via GoTrue
router.post('/users/:id/reset-password', async (req, res) => {
    try {
        const targetId = req.params.id;
        if (!UUID_RE.test(targetId)) {
            return res.status(400).json({ success: false, error: 'Invalid user id' });
        }

        const { data: profile, error: pErr } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', targetId)
            .single();

        if (pErr || !profile?.email) {
            return res.status(404).json({ success: false, error: 'User email not found' });
        }

        const email = String(profile.email).trim();
        const redirectTo = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '') + '/reset-password';

        const recoverRes = await fetch(`${supabaseUrl}/auth/v1/recover`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseServiceKey,
                Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ email, redirect_to: redirectTo }),
        });

        if (!recoverRes.ok) {
            const text = await recoverRes.text();
            console.error('[Admin API] recover failed', recoverRes.status, text);
            return res.status(502).json({
                success: false,
                error: 'Failed to send recovery email',
            });
        }

        res.json({ success: true, data: { userId: targetId, emailSent: true } });
    } catch (error: any) {
        console.error('[Admin API] reset-password error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/tenants - All agency & seller tenants with metadata
router.get('/tenants', async (req, res) => {
    try {
        const { data: tenants, error: tErr } = await supabase
            .from('tenants')
            .select('id, name, type, status, parent_tenant_id, created_at')
            .in('type', ['agency', 'seller'])
            .order('created_at', { ascending: false });

        if (tErr) throw tErr;

        const tenantIds = (tenants || []).map((t: any) => t.id);

        const [
            { data: memberships, error: mErr },
            { data: accounts, error: aErr },
        ] = await Promise.all([
            supabase
                .from('tenant_memberships')
                .select('tenant_id, user_id, roles(name), profiles(full_name, email)')
                .in('tenant_id', tenantIds)
                .eq('status', 'active'),
            supabase
                .from('accounts')
                .select('id, tenant_id, tiktok_shops(id)')
                .in('tenant_id', tenantIds),
        ]);

        if (mErr) throw mErr;
        if (aErr) throw aErr;

        const membersByTenant = new Map<string, any[]>();
        for (const m of (memberships || [])) {
            const list = membersByTenant.get(m.tenant_id) || [];
            list.push(m);
            membersByTenant.set(m.tenant_id, list);
        }

        const shopCountByTenant = new Map<string, number>();
        for (const a of (accounts || [])) {
            const count = Array.isArray((a as any).tiktok_shops) ? (a as any).tiktok_shops.length : 0;
            shopCountByTenant.set(a.tenant_id, (shopCountByTenant.get(a.tenant_id) || 0) + count);
        }

        const agencyNameMap = new Map<string, string>();
        for (const t of (tenants || [])) {
            if (t.type === 'agency') agencyNameMap.set(t.id, t.name);
        }

        const childrenByAgency = new Map<string, string[]>();
        for (const t of (tenants || [])) {
            if (t.type === 'seller' && t.parent_tenant_id) {
                const list = childrenByAgency.get(t.parent_tenant_id) || [];
                list.push(t.id);
                childrenByAgency.set(t.parent_tenant_id, list);
            }
        }

        const result = (tenants || []).map((t: any) => {
            const members = membersByTenant.get(t.id) || [];
            const owner = members.find((m: any) => m.roles?.name === 'Seller Admin' || m.roles?.name === 'Agency Admin');

            let shopCount = shopCountByTenant.get(t.id) || 0;
            if (t.type === 'agency') {
                const childIds = childrenByAgency.get(t.id) || [];
                shopCount = childIds.reduce((sum, cid) => sum + (shopCountByTenant.get(cid) || 0), 0);
            }

            return {
                id: t.id,
                name: t.name,
                type: t.type,
                status: t.status,
                created_at: t.created_at,
                parent_tenant_id: t.parent_tenant_id,
                parent_agency_name: t.parent_tenant_id ? (agencyNameMap.get(t.parent_tenant_id) || null) : null,
                member_count: members.length,
                linked_sellers: t.type === 'agency' ? (childrenByAgency.get(t.id) || []).length : undefined,
                shop_count: shopCount,
                owner_name: owner ? ((owner as any).profiles?.full_name || (owner as any).profiles?.email || '—') : '—',
                members: members.map((m: any) => ({
                    user_id: m.user_id,
                    role_name: m.roles?.name || null,
                    full_name: (m as any).profiles?.full_name || null,
                    email: (m as any).profiles?.email || null,
                })),
            };
        });

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Admin API] Tenants error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/admin/tenants/:id — Super Admin: rename / change status (agency or seller only)
router.patch('/tenants/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (!UUID_RE.test(id)) {
            return res.status(400).json({ success: false, error: 'Invalid tenant id' });
        }

        const { name, status } = req.body ?? {};
        const { data: tenant, error: fErr } = await supabase.from('tenants').select('id, type').eq('id', id).maybeSingle();
        if (fErr) throw fErr;
        if (!tenant) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }
        if ((tenant as any).type === 'platform') {
            return res.status(400).json({ success: false, error: 'Cannot modify platform tenant here' });
        }

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (name !== undefined) {
            const n = String(name).trim();
            if (!n) {
                return res.status(400).json({ success: false, error: 'Name cannot be empty' });
            }
            updates.name = n.slice(0, 200);
        }
        if (status !== undefined) {
            const s = String(status).toLowerCase();
            if (!['active', 'inactive', 'suspended'].includes(s)) {
                return res.status(400).json({ success: false, error: 'Invalid status' });
            }
            updates.status = s;
        }
        if (Object.keys(updates).length === 1) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }

        const { data: row, error: uErr } = await supabase.from('tenants').update(updates).eq('id', id).select().single();
        if (uErr) throw uErr;

        res.json({ success: true, data: row });
    } catch (error: any) {
        console.error('[Admin API] PATCH tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/admin/tenants/:id — Super Admin: delete agency (unlink sellers first) or seller (accounts + tenant)
router.delete('/tenants/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (!UUID_RE.test(id)) {
            return res.status(400).json({ success: false, error: 'Invalid tenant id' });
        }

        const { data: tenant, error: fErr } = await supabase.from('tenants').select('id, type').eq('id', id).maybeSingle();
        if (fErr) throw fErr;
        if (!tenant) {
            return res.status(404).json({ success: false, error: 'Tenant not found' });
        }
        const tType = (tenant as any).type as string;
        if (tType === 'platform') {
            return res.status(400).json({ success: false, error: 'Cannot delete platform tenant' });
        }

        if (tType === 'agency') {
            const { error: unlinkErr } = await supabase.from('tenants').update({ parent_tenant_id: null }).eq('parent_tenant_id', id);
            if (unlinkErr) throw unlinkErr;
            const { error: delErr } = await supabase.from('tenants').delete().eq('id', id);
            if (delErr) throw delErr;
            return res.json({ success: true, data: { deletedId: id, type: 'agency', unlinkedSellers: true } });
        }

        if (tType === 'seller') {
            const { error: accErr } = await supabase.from('accounts').delete().eq('tenant_id', id);
            if (accErr) throw accErr;
            const { error: delErr } = await supabase.from('tenants').delete().eq('id', id);
            if (delErr) throw delErr;
            return res.json({ success: true, data: { deletedId: id, type: 'seller' } });
        }

        return res.status(400).json({ success: false, error: 'Unsupported tenant type' });
    } catch (error: any) {
        console.error('[Admin API] DELETE tenant error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/memberships - All active memberships
router.get('/memberships', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('tenant_memberships')
            .select('id, tenant_id, user_id, status, created_at, roles(name), tenants(name, type), profiles(full_name, email)')
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const result = (data || []).map((m: any) => ({
            id: m.id,
            user_id: m.user_id,
            tenant_id: m.tenant_id,
            role_name: m.roles?.name || '—',
            tenant_name: m.tenants?.name || '—',
            tenant_type: m.tenants?.type || '—',
            full_name: m.profiles?.full_name || '—',
            email: m.profiles?.email || '—',
            created_at: m.created_at,
        }));

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('[Admin API] Memberships error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/stores - List stores grouped by account with owner name
router.get('/stores', async (req, res) => {
    try {
        console.log('[Admin API] Fetching stores grouped by account...');

        // 1. Fetch accounts with owners and shops (no nested counts — those are expensive)
        const { data: accounts, error: accountError } = await supabase
            .from('accounts')
            .select(`
                id,
                name,
                tenant_id,
                tenants (
                    id,
                    name,
                    type
                ),
                user_accounts!inner (
                    profiles!inner (
                        id,
                        full_name,
                        email,
                        role
                    )
                ),
                tiktok_shops (
                    id,
                    shop_id,
                    shop_name,
                    region,
                    timezone,
                    refresh_token,
                    refresh_token_expires_at,
                    token_expires_at,
                    created_at
                )
            `);

        if (accountError) throw accountError;

        const now = new Date();
        const nowMs = now.getTime();
        // Wide UTC window so every shop's "today" (any IANA tz) falls inside — then we filter per shop in memory.
        // Still only 2 DB round-trips total (orders + settlements), no TikTok API.
        const wideStartIso = new Date(nowMs - 50 * 60 * 60 * 1000).toISOString();
        const wideEndIso = new Date(nowMs + 26 * 60 * 60 * 1000).toISOString();

        const allShops = accounts.flatMap((a: any) => a.tiktok_shops || []);
        const shopIds = allShops.map((s: any) => s.id);

        // Token validation — run in parallel (fire-and-forget for DB writes, update local objects)
        const tokenRefreshPromises = allShops.map(async (shop: any) => {
            const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : null;
            const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : 0;
            const nowTime = now.getTime();

            // Check if refresh token is expired and mark accordingly
            if (refreshExpiry > 0 && refreshExpiry < nowTime) {
                const tokenExpiresAt = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : null;
                if (!tokenExpiresAt || tokenExpiresAt > nowTime) {
                    const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                    try {
                        await supabase
                            .from('tiktok_shops')
                            .update({ token_expires_at: expiredTime, refresh_token_expires_at: expiredTime, updated_at: new Date().toISOString() })
                            .eq('id', shop.id);
                        shop.token_expires_at = expiredTime;
                        shop.refresh_token_expires_at = expiredTime;
                    } catch (err) {
                        console.error(`[Admin Token] Failed to mark ${shop.shop_name} as expired:`, err);
                    }
                }
                return; // Refresh token expired, skip access token refresh
            }

            // Try to refresh expired access token
            if (accessExpiry && accessExpiry < nowTime && shop.refresh_token) {
                try {
                    const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);
                    const refreshTime = new Date();
                    const newAccessExpiry = new Date(refreshTime.getTime() + tokenData.access_token_expire_in * 1000);
                    const newRefreshExpiry = new Date(refreshTime.getTime() + tokenData.refresh_token_expire_in * 1000);
                    await supabase
                        .from('tiktok_shops')
                        .update({
                            access_token: tokenData.access_token,
                            refresh_token: tokenData.refresh_token,
                            token_expires_at: newAccessExpiry.toISOString(),
                            refresh_token_expires_at: newRefreshExpiry.toISOString(),
                            updated_at: refreshTime.toISOString()
                        })
                        .eq('id', shop.id);
                    shop.token_expires_at = newAccessExpiry.toISOString();
                    shop.refresh_token_expires_at = newRefreshExpiry.toISOString();
                } catch (refreshError: any) {
                    if (refreshError instanceof TikTokShopError && refreshError.code === 105002) {
                        const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                        await supabase.from('tiktok_shops').update({ token_expires_at: expiredTime, updated_at: new Date().toISOString() }).eq('id', shop.id);
                        shop.token_expires_at = expiredTime;
                    } else {
                        console.error(`[Admin Token] Error refreshing ${shop.shop_name}:`, refreshError.message);
                    }
                }
            }
        });

        // 2. Run token refresh, recent orders, and settlements in parallel
        let recentOrders: any[] = [];
        let recentSettlements: any[] = [];

        const dataPromises: PromiseLike<any>[] = [
            Promise.allSettled(tokenRefreshPromises), // Token refresh (don't block on failure)
        ];

        if (shopIds.length > 0) {
            dataPromises.push(
                supabase
                    .from('shop_orders')
                    .select('shop_id, total_amount, paid_time')
                    .in('shop_id', shopIds)
                    .not('paid_time', 'is', null)
                    .gte('paid_time', wideStartIso)
                    .lte('paid_time', wideEndIso)
                    .limit(25000)
                    .then(({ data, error }) => {
                        if (error) console.error('Error fetching recent orders:', error);
                        recentOrders = data || [];
                    }),
                supabase
                    .from('shop_settlements')
                    .select('shop_id, net_amount, total_amount, settlement_time')
                    .in('shop_id', shopIds)
                    .gte('settlement_time', wideStartIso)
                    .lte('settlement_time', wideEndIso)
                    .limit(25000)
                    .then(({ data, error }) => {
                        if (error) console.error('Error fetching recent settlements:', error);
                        recentSettlements = data || [];
                    })
            );
        }

        await Promise.all(dataPromises);

        function paidTimeUnixSec(paid: string | null | undefined): number | null {
            if (!paid) return null;
            const t = new Date(paid).getTime();
            if (Number.isNaN(t)) return null;
            return Math.floor(t / 1000);
        }

        function settlementTimeUnixSec(st: string | null | undefined): number | null {
            if (!st) return null;
            const t = new Date(st).getTime();
            if (Number.isNaN(t)) return null;
            return Math.floor(t / 1000);
        }

        // Map each shop's rows to **today in that shop's timezone** (paid_time / settlement_time).
        allShops.forEach((shop: any) => {
            const tz = (shop.timezone as string)?.trim() || 'America/Los_Angeles';
            const todayStr = formatShopDateISO(nowMs, tz);
            const dayStartSec = getShopDayStartTimestamp(todayStr, tz);
            const dayEndExclusiveSec = getShopDayEndExclusiveTimestamp(todayStr, tz);

            shop.metrics_shop_local_date = todayStr;
            shop.metrics_timezone = tz;

            shop.recent_orders = recentOrders.filter((o: any) => {
                if (o.shop_id !== shop.id) return false;
                const ts = paidTimeUnixSec(o.paid_time);
                return ts !== null && ts >= dayStartSec && ts < dayEndExclusiveSec;
            });
            shop.recent_settlements = recentSettlements.filter((s: any) => {
                if (s.shop_id !== shop.id) return false;
                const ts = settlementTimeUnixSec(s.settlement_time);
                return ts !== null && ts >= dayStartSec && ts < dayEndExclusiveSec;
            });
        });


        // 3. Process and group data
        const processedAccounts = accounts.map((account: any) => {
            const owner = account.user_accounts?.[0]?.profiles;
            const ownerName = owner?.full_name || owner?.email || account.name || 'Unknown';

            const shops = account.tiktok_shops || [];

            let totalOrders = 0;
            let totalProducts = 0;
            let totalRevenue = 0;
            let totalNet = 0;

            const processedShops = shops.map((shop: any) => {
                const recentOrders = shop.recent_orders || [];
                const recentSettlements = shop.recent_settlements || [];

                // 1. Revenue = sum of order total_amount for paid orders today (shop TZ). (Approximate GMV; P&L drill-down is exact.)
                const shopRevenue = recentOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0);

                // 2. Calculate Net Payout (from Settlements)
                const netPayout = recentSettlements.reduce((sum: number, s: any) => sum + (Number(s.net_amount) || 0), 0);

                // 3. Calculate Unsettled Revenue (actual difference, no estimates)
                const settlementRevenue = recentSettlements.reduce((sum: number, s: any) => sum + (Number(s.total_amount) || 0), 0);
                const unsettledRevenue = Math.max(0, shopRevenue - settlementRevenue);

                // Net Profit = Net Payout only (COGS requires going into product details)
                // We don't estimate here - accurate COGS requires looking at individual products
                const netProfit = netPayout;

                totalOrders += recentOrders.length;
                totalProducts += 0; // Products count not needed for admin summary
                totalRevenue += shopRevenue;
                totalNet += netProfit;

                // Calculate token health
                const refreshExpiry = shop.refresh_token_expires_at ? new Date(shop.refresh_token_expires_at).getTime() : null;
                const accessExpiry = shop.token_expires_at ? new Date(shop.token_expires_at).getTime() : null;
                const refreshTokenExpiresIn = refreshExpiry ? Math.max(0, Math.floor((refreshExpiry - now.getTime()) / 1000)) : null;

                let tokenStatus: 'healthy' | 'warning' | 'critical' | 'expired' = 'healthy';
                let tokenMessage: string | null = null;

                if (refreshExpiry) {
                    const daysUntilExpiry = (refreshExpiry - now.getTime()) / (1000 * 60 * 60 * 24);

                    if (refreshExpiry < now.getTime()) {
                        tokenStatus = 'expired';
                        tokenMessage = 'Authorization expired. Please reconnect this shop.';
                    } else if (daysUntilExpiry <= 1) {
                        tokenStatus = 'critical';
                        tokenMessage = 'Expires within 24 hours!';
                    } else if (daysUntilExpiry <= 7) {
                        tokenStatus = 'warning';
                        tokenMessage = `Expires in ${Math.floor(daysUntilExpiry)} days`;
                    }
                } else if (accessExpiry) {
                    // Fallback: No refresh_token_expires_at data (legacy shops)
                    // If access token is expired, the shop is effectively expired
                    if (accessExpiry < now.getTime()) {
                        tokenStatus = 'expired';
                        tokenMessage = 'Authorization expired. Please reconnect this shop.';
                    }
                }


                return {
                    id: shop.id,
                    shop_id: shop.shop_id,
                    shop_name: shop.shop_name,
                    region: shop.region,
                    timezone: shop.timezone,
                    ordersCount: recentOrders.length,
                    productsCount: 0,
                    revenue: shopRevenue,
                    net: netProfit,
                    /** YYYY-MM-DD in shop timezone for which orders/net are counted */
                    metricsShopLocalDate: shop.metrics_shop_local_date,
                    metricsTimezone: shop.metrics_timezone,
                    created_at: shop.created_at,
                    tokenHealth: {
                        status: tokenStatus,
                        message: tokenMessage,
                        expiresAt: shop.refresh_token_expires_at || null,
                        refreshTokenExpiresIn
                    }
                };

            });


            return {
                id: account.id,
                account_name: ownerName,
                owner_id: owner?.id,
                owner_role: owner?.role || 'client',
                owner_full_name: owner?.full_name || ownerName,
                original_name: account.name,
                tenant_name: account.tenants?.name || null,
                tenant_type: account.tenants?.type || null,
                storesCount: shops.length,
                totalOrders,
                totalProducts,
                totalRevenue,
                totalNet,
                stores: processedShops
            };
        });
        // Only return accounts that have at least one connected shop
        const accountsWithShops = processedAccounts.filter((a: any) => a.stores.length > 0);

        res.json({
            success: true,
            data: accountsWithShops,
            metricsWindow: {
                kind: 'shop_local_today',
                description:
                    'Orders and settlements are counted for each shop’s current calendar day in that shop’s timezone (paid_time / settlement_time). Loaded from your database in two queries; no TikTok API.',
            },
        });
    } catch (error: any) {
        console.error('[Admin API] Stores error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/stores/:shopId/pl - Get detailed P&L for a specific shop
router.get('/stores/:shopId/pl', async (req, res) => {
    try {
        const { shopId } = req.params;
        const { startDate, endDate } = req.query;

        console.log(`[Admin API] Fetching P&L for shop ${shopId}...`);

        let query = supabase
            .from('shop_settlements')
            .select('*')
            .eq('shop_id', shopId);

        if (startDate && endDate) {
            query = query
                .gte('settlement_time', startDate)
                .lte('settlement_time', endDate);
        }
        const { data: settlements, error: settlementError } = await query;

        if (settlementError) throw settlementError;

        const orderGmvFromRow = (o: any): number => {
            const pi = o.payment_info;
            if (!pi || typeof pi !== 'object') {
                return Number(o.total_amount) || 0;
            }
            const original = parseFloat(String(pi.original_total_product_price || '0'));
            const shipping = parseFloat(String(pi.shipping_fee || '0'));
            const sellerDiscount = parseFloat(String(pi.seller_discount || '0'));
            const platformDiscount = Math.abs(parseFloat(String(pi.platform_discount || '0')));
            const effSeller = o.is_sample_order ? 0 : Math.abs(sellerDiscount);
            return Number((original + shipping - effSeller - platformDiscount).toFixed(2));
        };

        const isCancelledOrderRow = (o: any): boolean => {
            const st = o.order_status;
            if (st === 'CANCELLED' || st === 'CANCELED' || st === 'REFUNDED') return true;
            if (o.cancel_reason) return true;
            if (o.cancellation_initiator) return true;
            return false;
        };

        // 1. Fetch orders (Seller Center–aligned GMV from payment_info; exclude samples + cancelled)
        let ordersQuery = supabase
            .from('shop_orders')
            .select(
                'total_amount, payment_info, is_sample_order, paid_time, create_time, order_status, cancel_reason, cancellation_initiator'
            )
            .eq('shop_id', shopId);

        if (startDate && endDate) {
            ordersQuery = ordersQuery
                .gte('create_time', startDate)
                .lte('create_time', endDate);
        }

        const { data: orders } = await ordersQuery.range(0, 49999); // Override default 1000 limit

        // 2. Fetch Products with COGS data
        const { data: products } = await supabase
            .from('shop_products')
            .select('product_id, cogs, sales_count, gmv')
            .eq('shop_id', shopId);

        // 3. Calculate P&L metrics (GMV formula aligned with in-app calculateOrderGMV)
        const totalRevenue =
            orders?.reduce((sum: number, o: any) => {
                if (o.is_sample_order === true) return sum;
                if (isCancelledOrderRow(o)) return sum;
                return sum + orderGmvFromRow(o);
            }, 0) || 0;

        const platformFees = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.fee_amount)) || 0), 0);
        const shippingFees = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.shipping_cost_amount)) || 0), 0);
        const affiliateCommissions = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.affiliate_commission)) || 0), 0);
        const refunds = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.refund_amount)) || 0), 0);
        const adjustments = settlements.reduce((sum, s) => sum + (Number(s.settlement_data?.adjustment_amount) || 0), 0);

        const netPayout = settlements.reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0);
        const settlementRevenue = settlements.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);

        // 4. Calculate Unsettled Revenue (only from actual data)
        const unsettledRevenue = Math.max(0, totalRevenue - settlementRevenue);

        // 5. Calculate Product Costs using ONLY real COGS - NO estimates
        let realCogs = 0;
        let productsWithCogs = 0;
        let productsWithSales = 0;

        (products || []).forEach((product: any) => {
            const salesCount = Number(product.sales_count) || 0;

            if (salesCount > 0) {
                productsWithSales++;
                if (product.cogs !== null && product.cogs !== undefined) {
                    realCogs += Number(product.cogs) * salesCount;
                    productsWithCogs++;
                }
            }
        });

        // Only use real COGS - no fallback estimates
        const productCosts = realCogs;
        const operationalCosts = 0; // No estimates

        const netProfit = netPayout - productCosts;

        res.json({
            success: true,
            data: {
                totalRevenue,
                platformFees,
                shippingFees,
                affiliateCommissions,
                refunds,
                adjustments,
                productCosts,
                operationalCosts,
                unsettledRevenue,
                netProfit,
                settlementCount: settlements.length,
                cogsStats: {
                    withCogs: productsWithCogs,
                    total: productsWithSales
                }
            }
        });
    } catch (error: any) {
        console.error('[Admin API] P&L error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/admin/sync-profiles - Backfill missing profiles for auth users
router.post('/sync-profiles', async (req, res) => {
    try {
        console.log('[Admin API] Syncing profiles from auth.users...');

        // 1. List ALL auth users (paginate if needed)
        let allAuthUsers: any[] = [];
        let page = 1;
        const perPage = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data: { users }, error } = await supabase.auth.admin.listUsers({
                page,
                perPage
            });
            if (error) throw error;
            allAuthUsers = [...allAuthUsers, ...users];
            hasMore = users.length === perPage;
            page++;
        }

        console.log(`[Admin API] Found ${allAuthUsers.length} auth users`);

        // 2. Get all existing profile IDs
        const { data: existingProfiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id');

        if (profilesError) throw profilesError;

        const existingIds = new Set((existingProfiles || []).map(p => p.id));

        // 3. Find auth users missing from profiles
        const missingUsers = allAuthUsers.filter(u => !existingIds.has(u.id));
        console.log(`[Admin API] ${missingUsers.length} users missing profiles`);

        if (missingUsers.length === 0) {
            return res.json({
                success: true,
                data: { synced: 0, total: allAuthUsers.length, existing: existingIds.size }
            });
        }

        // 4. Create missing profiles
        const newProfiles = missingUsers.map(u => ({
            id: u.id,
            email: u.email,
            full_name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'User',
            role: 'client',
            updated_at: new Date().toISOString(),
        }));

        const { error: insertError } = await supabase
            .from('profiles')
            .upsert(newProfiles, { onConflict: 'id' });

        if (insertError) throw insertError;

        console.log(`[Admin API] Created ${newProfiles.length} missing profiles`);

        res.json({
            success: true,
            data: {
                synced: newProfiles.length,
                total: allAuthUsers.length,
                existing: existingIds.size,
                created: newProfiles.map(p => ({ id: p.id, email: p.email, full_name: p.full_name }))
            }
        });
    } catch (error: any) {
        console.error('[Admin API] Sync profiles error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
