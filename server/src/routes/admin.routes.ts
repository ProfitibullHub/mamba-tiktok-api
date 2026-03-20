import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import { TikTokShopApiService, TikTokShopError } from '../services/tiktok-shop-api.service.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const tiktokShopApi = new TikTokShopApiService();


// Apply admin middleware to all routes
router.use(adminMiddleware);

// GET /api/admin/stats - Total users and stores
router.get('/stats', async (req, res) => {
    try {
        console.log('[Admin API] Fetching stats...');
        const { count: userCount, error: userError } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        const { count: storeCount, error: storeError } = await supabase
            .from('tiktok_shops')
            .select('*', { count: 'exact', head: true });

        console.log('[Admin API] Stats result:', { userCount, storeCount, userError, storeError });

        if (userError || storeError) throw userError || storeError;

        res.json({
            success: true,
            data: {
                totalUsers: userCount || 0,
                totalStores: storeCount || 0
            }
        });
    } catch (error: any) {
        console.error('[Admin API] Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/users - List users with roles and connected stores
router.get('/users', async (req, res) => {
    try {
        console.log('[Admin API] Fetching users...');
        const { data: users, error: userError } = await supabase
            .from('profiles')
            .select(`
                *,
                user_accounts (
                    account_id,
                    accounts (
                        id,
                        name,
                        tiktok_shops (
                            id,
                            shop_name
                        )
                    )
                )
            `)
            .order('created_at', { ascending: false });

        console.log('[Admin API] Users result count:', users?.length, 'Error:', userError);

        if (userError) throw userError;

        res.json({
            success: true,
            data: users
        });
    } catch (error: any) {
        console.error('[Admin API] Users error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/admin/users/:id/role - Update user role
router.patch('/users/:id/role', async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    if (!['admin', 'client', 'moderator', 'accountant'].includes(role)) {
        return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    try {
        const { data, error } = await supabase
            .from('profiles')
            .update({ role, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            data
        });
    } catch (error: any) {
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
        const start = new Date();
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        const startIso = start.toISOString();
        const endIso = end.toISOString();

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
                // Recent orders (last 30 days) — also gives us order count per shop
                supabase
                    .from('shop_orders')
                    .select('shop_id, total_amount, create_time')
                    .in('shop_id', shopIds)
                    .not('paid_time', 'is', null)
                    .gte('create_time', startIso)
                    .lte('create_time', endIso)
                    .then(({ data, error }) => {
                        if (error) console.error('Error fetching recent orders:', error);
                        recentOrders = data || [];
                    }),
                // Recent settlements (last 30 days)
                supabase
                    .from('shop_settlements')
                    .select('shop_id, net_amount, total_amount, settlement_time')
                    .in('shop_id', shopIds)
                    .gte('settlement_time', startIso)
                    .lte('settlement_time', endIso)
                    .then(({ data, error }) => {
                        if (error) console.error('Error fetching recent settlements:', error);
                        recentSettlements = data || [];
                    })
            );
        }

        await Promise.all(dataPromises);

        // Map data back to shops
        allShops.forEach((shop: any) => {
            shop.recent_orders = recentOrders.filter((o: any) => o.shop_id === shop.id);
            shop.recent_settlements = recentSettlements.filter((s: any) => s.shop_id === shop.id);
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

                // 1. Calculate Sales Revenue (from Orders) - This is our Total Revenue (GMV)
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
            data: accountsWithShops
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

        // 1. Fetch Orders for the same period to get Total Revenue (GMV)
        let ordersQuery = supabase
            .from('shop_orders')
            .select('total_amount')
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

        // 3. Calculate P&L metrics (Matching ProfitLossView logic and TikTok API fields)
        const totalRevenue = orders?.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0) || 0;

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
