import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

        // 1. Fetch all accounts with their owners and shops (IDs only)
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
                    shop_orders (count),
                    shop_products (count)
                )
            `);

        if (accountError) throw accountError;

        // 2. Fetch aggregated metrics for the last 30 days
        const now = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0); // Midnight

        const end = new Date();
        end.setHours(23, 59, 59, 999); // End of today

        // Use ISO strings for timestamp comparison (Supabase/Postgres timestamp type)
        const startIso = start.toISOString();
        const endIso = end.toISOString();

        // Get all shop IDs
        const allShops = accounts.flatMap((a: any) => a.tiktok_shops || []);
        const shopIds = allShops.map((s: any) => s.id);

        if (shopIds.length > 0) {
            // Fetch Orders (Last 30 Days)
            const { data: recentOrders, error: ordersError } = await supabase
                .from('shop_orders')
                .select('shop_id, total_amount, create_time')
                .in('shop_id', shopIds)
                .gte('create_time', startIso)
                .lte('create_time', endIso)
                .range(0, 49999); // Override default 1000 limit

            if (ordersError) console.error('Error fetching recent orders:', ordersError);

            // Fetch Settlements (Last 30 Days)
            const { data: recentSettlements, error: settlementsError } = await supabase
                .from('shop_settlements')
                .select('shop_id, net_amount, total_amount, settlement_time')
                .in('shop_id', shopIds)
                .gte('settlement_time', startIso)
                .lte('settlement_time', endIso);

            if (settlementsError) console.error('Error fetching recent settlements:', settlementsError);

            // Map data back to shops
            allShops.forEach((shop: any) => {
                shop.recent_orders = recentOrders?.filter((o: any) => o.shop_id === shop.id) || [];
                shop.recent_settlements = recentSettlements?.filter((s: any) => s.shop_id === shop.id) || [];
            });
        }

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
                const productsCount = shop.shop_products?.[0]?.count || 0;
                // Use total count from DB for "Total Orders" column
                const totalOrdersCount = shop.shop_orders?.[0]?.count || 0;

                // Use fetched recent data
                const recentOrders = shop.recent_orders || [];
                const recentSettlements = shop.recent_settlements || [];

                // 1. Calculate Sales Revenue (from Orders) - This is our Total Revenue (GMV)
                const shopRevenue = recentOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0);

                // 2. Calculate Net Payout (from Settlements)
                const netPayout = recentSettlements.reduce((sum: number, s: any) => sum + (Number(s.net_amount) || 0), 0);

                // 3. Calculate Unsettled Revenue (Estimated)
                // If we have orders but no settlements yet, estimate unsettled revenue
                // Logic: (Total Order Revenue - Settlement Revenue) * 0.85 (estimating 15% platform fees/shipping)
                const settlementRevenue = recentSettlements.reduce((sum: number, s: any) => sum + (Number(s.total_amount) || 0), 0);
                const unsettledRevenue = Math.max(0, (shopRevenue - settlementRevenue) * 0.85);

                // 4. Estimates (Matching ProfitLossView logic)
                const productCosts = shopRevenue * 0.3; // 30% COGS
                const operationalCosts = shopRevenue * 0.1; // 10% Ops

                const netProfit = (netPayout + unsettledRevenue) - productCosts - operationalCosts;

                totalOrders += totalOrdersCount;
                totalProducts += productsCount;
                totalRevenue += shopRevenue;
                totalNet += netProfit;

                return {
                    id: shop.id,
                    shop_id: shop.shop_id,
                    shop_name: shop.shop_name,
                    region: shop.region,
                    ordersCount: recentOrders.length,
                    productsCount,
                    revenue: shopRevenue,
                    net: netProfit,
                    created_at: shop.created_at
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

        res.json({
            success: true,
            data: processedAccounts
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

        // 2. Calculate P&L metrics (Matching ProfitLossView logic and TikTok API fields)
        const totalRevenue = orders?.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0) || 0;

        const platformFees = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.fee_amount)) || 0), 0);
        const shippingFees = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.shipping_cost_amount)) || 0), 0);
        const affiliateCommissions = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.affiliate_commission)) || 0), 0);
        const refunds = settlements.reduce((sum, s) => sum + (Math.abs(Number(s.settlement_data?.refund_amount)) || 0), 0);
        const adjustments = settlements.reduce((sum, s) => sum + (Number(s.settlement_data?.adjustment_amount) || 0), 0);

        const netPayout = settlements.reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0);
        const settlementRevenue = settlements.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);

        // 3. Calculate Unsettled Revenue (Estimated)
        const unsettledRevenue = Math.max(0, (totalRevenue - settlementRevenue) * 0.85);

        // 4. Estimates
        const productCosts = totalRevenue * 0.3;
        const operationalCosts = totalRevenue * 0.1;
        const netProfit = (netPayout + unsettledRevenue) - productCosts - operationalCosts;

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
                settlementCount: settlements.length
            }
        });
    } catch (error: any) {
        console.error('[Admin API] P&L error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
