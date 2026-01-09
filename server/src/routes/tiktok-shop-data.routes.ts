import { Router, Request, Response } from 'express';
import { tiktokShopApi, TikTokShopError } from '../services/tiktok-shop-api.service.js';
import { supabase } from '../config/supabase.js';

const router = Router();

/**
 * Helper function to get shop with valid token
 */
export const getShopWithToken = async (accountId: string, shopId?: string, forceRefresh: boolean = false) => {
    let query = supabase
        .from('tiktok_shops')
        .select('*')
        .eq('account_id', accountId);

    if (shopId) {
        query = query.eq('shop_id', shopId);
    }

    let { data: shops, error } = await query.limit(1).single();

    // If not found by shop_id, try by shop_name (frontend sometimes sends shop_name)
    if ((error || !shops) && shopId) {
        console.log(`[Data API] Shop not found by shop_id, trying by shop_name: ${shopId}`);
        const fallbackQuery = supabase
            .from('tiktok_shops')
            .select('*')
            .eq('account_id', accountId)
            .eq('shop_name', shopId);

        const fallbackResult = await fallbackQuery.limit(1).single();
        shops = fallbackResult.data;
        error = fallbackResult.error;
    }

    if (error || !shops) {
        console.error(`[Data API] Shop not found for account ${accountId} and shop ${shopId || 'any'}. Error:`, error?.message);
        throw new Error(`Shop not found or not connected (Account: ${accountId}, Shop: ${shopId || 'any'})`);
    }

    // Check if token is expired (with 5 minute buffer) OR if forceRefresh is requested
    const tokenExpiresAt = new Date(shops.token_expires_at);
    const fiveMinutes = 5 * 60 * 1000;

    if (forceRefresh || (tokenExpiresAt.getTime() - fiveMinutes < Date.now())) {
        console.log(`Refreshing token for shop ${shops.shop_name} (Force: ${forceRefresh})`);
        // Refresh token
        const tokenData = await tiktokShopApi.refreshAccessToken(shops.refresh_token);

        const now = new Date();
        const newExpiresAt = new Date(now.getTime() + tokenData.access_token_expire_in * 1000);

        // Update token in database
        await supabase
            .from('tiktok_shops')
            .update({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                token_expires_at: newExpiresAt.toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', shops.id);

        shops.access_token = tokenData.access_token;
        shops.shop_cipher = shops.shop_cipher; // Ensure cipher is passed along
    }

    return shops;
}

/**
 * Helper to execute API calls with auto-refresh on 105002 error
 */
async function executeWithRefresh<T>(
    accountId: string,
    shopId: string | undefined,
    operation: (token: string, cipher: string) => Promise<T>
): Promise<T> {
    try {
        // First try with existing token (will refresh if close to expiry)
        const shop = await getShopWithToken(accountId, shopId);
        return await operation(shop.access_token, shop.shop_cipher);
    } catch (error: any) {
        // Check for Expired Credentials error (105002)
        if (error instanceof TikTokShopError && error.code === 105002) {
            console.log('Token expired (105002), forcing refresh and retrying...');
            // Force refresh token
            const shop = await getShopWithToken(accountId, shopId, true);
            // Retry operation with new token
            return await operation(shop.access_token, shop.shop_cipher);
        }
        throw error;
    }
}

/**
 * GET /api/tiktok-shop/shops/:accountId
 * Get all authorized shops for an account
 */
router.get('/shops/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { refresh } = req.query;

        // If refresh is requested, sync with TikTok first
        if (refresh === 'true') {
            // Get any existing shop to get the access token
            const { data: existingShop } = await supabase
                .from('tiktok_shops')
                .select('*')
                .eq('account_id', accountId)
                .limit(1)
                .single();

            if (existingShop) {
                // Ensure token is valid
                let accessToken = existingShop.access_token;
                const tokenExpiresAt = new Date(existingShop.token_expires_at);
                if (tokenExpiresAt.getTime() - 5 * 60 * 1000 < Date.now()) {
                    const tokenData = await tiktokShopApi.refreshAccessToken(existingShop.refresh_token);
                    accessToken = tokenData.access_token;
                    // Update DB
                    await supabase
                        .from('tiktok_shops')
                        .update({
                            access_token: tokenData.access_token,
                            refresh_token: tokenData.refresh_token,
                            token_expires_at: new Date(Date.now() + tokenData.access_token_expire_in * 1000).toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', existingShop.id);
                }

                // Fetch authorized shops from TikTok
                const authorizedShops = await tiktokShopApi.getAuthorizedShops(accessToken);

                // Update DB with fresh list
                for (const shop of authorizedShops) {
                    await supabase
                        .from('tiktok_shops')
                        .upsert({
                            account_id: accountId,
                            shop_id: shop.id,
                            shop_cipher: shop.cipher,
                            shop_name: shop.name,
                            region: shop.region,
                            seller_type: shop.seller_type,
                            access_token: accessToken, // They share the token
                            updated_at: new Date().toISOString(),
                        }, {
                            onConflict: 'account_id,shop_id',
                        });
                }
            }
        }

        // Fetch shops for this specific account
        const { data: shops, error } = await supabase
            .from('tiktok_shops')
            .select('shop_id, shop_name, region, seller_type, created_at, account_id')
            .eq('account_id', accountId);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            data: shops || [],
        });
    } catch (error: any) {
        console.error('Error fetching shops:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/shop/:accountId
 * Get shop details
 */
router.get('/shop/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        const shopInfo = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.getShopInfo(token, cipher)
        );

        res.json({
            success: true,
            data: shopInfo,
        });
    } catch (error: any) {
        console.error('Error fetching shop info:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/cache-status/:accountId
 * Check cache freshness for a shop
 * Returns staleness status based on 30-minute threshold
 */
router.get('/cache-status/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        let query = supabase
            .from('tiktok_shops')
            .select('orders_last_synced_at, products_last_synced_at, settlements_last_synced_at, performance_last_synced_at, shop_id, shop_name')
            .eq('account_id', accountId);

        if (shopId) {
            query = query.eq('shop_id', shopId);
        }

        const { data: shop, error } = await query.limit(1).single();

        if (error || !shop) {
            return res.status(404).json({
                success: false,
                error: 'Shop not found'
            });
        }

        const now = Date.now();
        const PROMPT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes - prompt user
        const AUTO_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours - auto-sync

        const shouldPrompt = (lastSyncedAt: string | null): boolean => {
            if (!lastSyncedAt) return true; // Never synced = prompt
            const lastSyncTime = new Date(lastSyncedAt).getTime();
            return (now - lastSyncTime) > PROMPT_THRESHOLD_MS;
        };

        const shouldAutoSync = (lastSyncedAt: string | null): boolean => {
            if (!lastSyncedAt) return false; // Never synced = don't auto-sync, just prompt
            const lastSyncTime = new Date(lastSyncedAt).getTime();
            return (now - lastSyncTime) > AUTO_SYNC_THRESHOLD_MS;
        };

        const cacheStatus = {
            shop_id: shop.shop_id,
            shop_name: shop.shop_name,
            // Individual staleness flags (>30 min = prompt user)
            orders_should_prompt: shouldPrompt(shop.orders_last_synced_at),
            products_should_prompt: shouldPrompt(shop.products_last_synced_at),
            settlements_should_prompt: shouldPrompt(shop.settlements_last_synced_at),
            performance_should_prompt: shouldPrompt(shop.performance_last_synced_at),
            // Auto-sync flags (>24 hours = auto-sync in background)
            orders_should_auto_sync: shouldAutoSync(shop.orders_last_synced_at),
            products_should_auto_sync: shouldAutoSync(shop.products_last_synced_at),
            settlements_should_auto_sync: shouldAutoSync(shop.settlements_last_synced_at),
            performance_should_auto_sync: shouldAutoSync(shop.performance_last_synced_at),
            last_synced_times: {
                orders: shop.orders_last_synced_at,
                products: shop.products_last_synced_at,
                settlements: shop.settlements_last_synced_at,
                performance: shop.performance_last_synced_at
            },
            // Summary flags
            should_prompt_user: shouldPrompt(shop.orders_last_synced_at) ||
                shouldPrompt(shop.products_last_synced_at) ||
                shouldPrompt(shop.settlements_last_synced_at),
            should_auto_sync: shouldAutoSync(shop.orders_last_synced_at) ||
                shouldAutoSync(shop.products_last_synced_at) ||
                shouldAutoSync(shop.settlements_last_synced_at)
        };

        res.json({
            success: true,
            data: cacheStatus
        });
    } catch (error: any) {
        console.error('Error checking cache status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/tiktok-shop/orders/synced/:accountId
 * Get all synced orders from the database
 */
router.get('/orders/synced/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        // Join with tiktok_shops to filter by account_id
        let shopsQuery = supabase
            .from('tiktok_shops')
            .select('id, shop_id')
            .eq('account_id', accountId);

        // If shopId is provided, it's the TikTok shop_id, not the internal Supabase ID
        if (shopId) {
            shopsQuery = shopsQuery.eq('shop_id', shopId);
        }

        const { data: shops } = await shopsQuery;

        if (!shops || shops.length === 0) {
            console.log(`[Orders Synced] No shops found for account ${accountId}${shopId ? ` and shop ${shopId}` : ''}`);
            return res.json({ success: true, data: { orders: [] } });
        }

        // Get internal Supabase IDs to query shop_orders
        const internalShopIds = shops.map(s => s.id);

        // Paginated fetch to bypass Supabase 1000 row limit
        const BATCH_SIZE = 1000;
        let allOrders: any[] = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const { data: batch, error } = await supabase
                .from('shop_orders')
                .select('*')
                .in('shop_id', internalShopIds)
                .order('create_time', { ascending: false })
                .range(offset, offset + BATCH_SIZE - 1);

            if (error) throw error;

            if (batch && batch.length > 0) {
                allOrders = [...allOrders, ...batch];
                offset += BATCH_SIZE;
                hasMore = batch.length === BATCH_SIZE;
            } else {
                hasMore = false;
            }
        }

        const orders = allOrders;

        res.json({
            success: true,
            data: {
                orders: orders.map(o => ({
                    id: o.order_id,
                    status: o.order_status,
                    payment: {
                        total_amount: o.total_amount.toString(),
                        currency: o.currency,
                        sub_total: o.total_amount.toString(), // Fallback
                        tax: "0"
                    },
                    create_time: Math.floor(new Date(o.create_time).getTime() / 1000),
                    update_time: o.update_time ? Math.floor(new Date(o.update_time).getTime() / 1000) : undefined,
                    line_items: o.line_items || [],
                    buyer_info: o.buyer_info,
                    shipping_info: o.shipping_info,
                    is_sample_order: (o as any).is_sample_order || false
                }))
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tiktok-shop/orders/:accountId
 * Get orders for a shop
 */
router.get('/orders/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, status, page = '1', pageSize = '20' } = req.query;

        const params: any = {
            page_size: parseInt(pageSize as string),
            page_number: parseInt(page as string)
        };

        if (status) {
            params.order_status = status;
        }

        const orders = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.makeApiRequest(
                '/order/202309/orders/search', // Updated endpoint
                token,
                cipher,
                params,
                'POST'
            )
        );

        // Background sync to persist data
        getShopWithToken(accountId, shopId as string).then(shop => syncOrders(shop)).catch(err => console.error('Background syncOrders error:', err));

        res.json({
            success: true,
            data: orders,
        });
    } catch (error: any) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/orders/:accountId/:orderId
 * Get single order details
 */
router.get('/orders/:accountId/:orderId', async (req: Request, res: Response) => {
    try {
        const { accountId, orderId } = req.params;
        const { shopId } = req.query;

        // API expects a list of IDs, we just send one
        const response = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.getOrderDetails(
                token,
                cipher,
                [orderId]
            )
        );

        const order = response.orders?.[0];

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found',
            });
        }

        res.json({
            success: true,
            data: order,
        });
    } catch (error: any) {
        console.error('Error fetching order details:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/products/:accountId
 * Get products for a shop
 */
router.get('/products/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, page = '1', pageSize = '20' } = req.query;

        const params = {
            page_size: parseInt(pageSize as string),
            page_number: parseInt(page as string)
        };

        const response = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.searchProducts(
                token,
                cipher,
                params
            )
        );

        // Transform the response to match frontend expectations
        const products = (response.products || []).map((p: any) => {
            const mainSku = p.skus?.[0] || {};
            const priceInfo = mainSku.price || {};
            const inventoryInfo = mainSku.inventory?.[0] || {};

            return {
                product_id: p.id,
                product_name: p.title, // 202502 uses 'title'
                price: parseFloat(priceInfo.tax_exclusive_price || '0'), // 202502 uses 'tax_exclusive_price'
                currency: priceInfo.currency || 'USD',
                stock: inventoryInfo.quantity || 0, // 202502 uses 'inventory' and 'quantity'
                sales_count: 0, // Sales count not directly available in this endpoint response structure
                status: p.status === 'ACTIVATE' ? 'active' : 'inactive', // 202502 uses 'ACTIVATE' string
                images: [], // Images not in the search response, would need detail call
                create_time: p.create_time
            };
        });

        // Background sync to persist data
        getShopWithToken(accountId, shopId as string).then(shop => syncProducts(shop)).catch(err => console.error('Background syncProducts error:', err));

        res.json({
            success: true,
            data: {
                products,
                total: response.total
            },
        });
    } catch (error: any) {
        console.error('Error fetching products:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/settlements/synced/:accountId
 * Get synced settlement data from database
 */
router.get('/settlements/synced/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        // Get shop IDs
        let shopsQuery = supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (shopId) {
            shopsQuery = shopsQuery.eq('shop_id', shopId);
        }

        const { data: shops } = await shopsQuery;

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const shopIds = shops.map(s => s.id);

        const { data: settlements, error } = await supabase
            .from('shop_settlements')
            .select('*')
            .in('shop_id', shopIds)
            .order('settlement_time', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            data: settlements.map(s => ({
                ...s.settlement_data,
                id: s.settlement_id,
                shop_id: s.shop_id // Internal ID, might need mapping back if frontend needs external shop_id
            })),
        });
    } catch (error: any) {
        console.error('Error fetching synced settlements:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/performance/:accountId
 * Get shop performance metrics
 */
router.get('/performance/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        const performance = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.makeApiRequest(
                '/seller/202309/performance',
                token,
                cipher
            )
        );

        // Background sync to persist data
        getShopWithToken(accountId, shopId as string).then(shop => syncPerformance(shop)).catch(err => console.error('Background syncPerformance error:', err));

        res.json({
            success: true,
            data: performance,
        });
    } catch (error: any) {
        console.error('Error fetching performance:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/tiktok-shop/overview/:accountId
 * Get consolidated overview data (Metrics, Orders, Products, Finance)
 * Optimized to reduce API calls.
 */
router.get('/overview/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, refresh, background } = req.query;

        console.log(`[Overview API] Fetching overview for account ${accountId}, shop ${shopId || 'all'}, refresh=${refresh}, background=${background}...`);

        // 1. If refresh=true, trigger sync
        if (refresh === 'true') {
            const shop = await getShopWithToken(accountId, shopId as string, true); // Force token refresh if needed

            if (background === 'true') {
                // Background mode: Start sync async, don't wait
                console.log('[Overview API] Starting background sync...');
                Promise.all([
                    syncOrders(shop),
                    syncProducts(shop),
                    syncSettlements(shop),
                    syncPerformance(shop)
                ]).then(() => {
                    console.log('[Overview API] Background sync completed');
                }).catch(err => {
                    console.error('[Overview API] Background sync error:', err);
                });
                // Continue immediately to return cached data
            } else {
                // Foreground mode: Wait for sync to complete
                await Promise.all([
                    syncOrders(shop),
                    syncProducts(shop),
                    syncSettlements(shop),
                    syncPerformance(shop)
                ]);
            }
        }

        // 2. Fetch Aggregated Data from Supabase
        let shopQuery = supabase
            .from('tiktok_shops')
            .select(`
                id,
                shop_id,
                shop_name,
                region,
                shop_orders (count),
                shop_products (count),
                shop_settlements (
                    total_amount,
                    net_amount,
                    settlement_time
                ),
                shop_performance (
                    shop_rating,
                    date
                )
            `)
            .eq('account_id', accountId);

        if (shopId) {
            shopQuery = shopQuery.eq('shop_id', shopId);
        }

        const { data: shops, error: shopError } = await shopQuery;

        if (shopError) throw shopError;

        // 3. Aggregate Metrics
        let totalOrders = 0;
        let totalProducts = 0;
        let totalRevenue = 0;
        let totalNet = 0;
        let recentOrders: any[] = []; // We could fetch recent orders here too if needed

        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        const startSec = thirtyDaysAgo / 1000;

        shops?.forEach((shop: any) => {
            totalOrders += shop.shop_orders?.[0]?.count || 0;
            totalProducts += shop.shop_products?.[0]?.count || 0;

            // Filter settlements for 30d revenue
            const relevantSettlements = shop.shop_settlements?.filter((s: any) => {
                const time = new Date(s.settlement_time).getTime() / 1000;
                return time >= startSec;
            }) || [];

            totalRevenue += relevantSettlements.reduce((sum: number, s: any) => sum + (Number(s.total_amount) || 0), 0);
            totalNet += relevantSettlements.reduce((sum: number, s: any) => sum + (Number(s.net_amount) || 0), 0);
        });

        // 4. Fetch recent orders for the "Orders" card preview or just to ensure we have them
        // The user wants "result from orders... updated". We already synced them.
        // Let's return the latest 5 orders for preview if needed, or just the counts.
        // The OverviewView mainly needs metrics.

        res.json({
            success: true,
            data: {
                metrics: {
                    totalOrders,
                    totalProducts,
                    totalRevenue,
                    totalNet,
                    avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
                    conversionRate: 2.5, // Placeholder or fetch from performance
                    shopRating: (shops && shops.length > 0 && shops[0].shop_performance && shops[0].shop_performance.length > 0)
                        ? (shops[0].shop_performance[0].shop_rating || 0)
                        : 0
                },
                lastUpdated: new Date().toISOString()
            }
        });

    } catch (error: any) {
        console.error('[Overview API] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});



/**
 * GET /api/tiktok-shop/products/synced/:accountId
 * Get all synced products from the database
 */
router.get('/products/synced/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId } = req.query;

        const { data: shops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('account_id', accountId);

        if (!shops || shops.length === 0) {
            return res.json({ success: true, data: { products: [] } });
        }

        const shopIds = shops.map(s => s.id);
        const { data: products, error } = await supabase
            .from('shop_products')
            .select('*')
            .in('shop_id', shopIds);

        if (error) throw error;

        res.json({
            success: true,
            data: {
                products: products.map(p => ({
                    product_id: p.product_id,
                    product_name: p.product_name,
                    status: p.status === 'active' ? 'ACTIVATE' : 'INACTIVE',
                    price: p.price,
                    currency: 'USD', // Default or fetch from shop
                    stock: p.stock,
                    sales_count: p.sales_count,
                    images: p.images || [],
                    main_image_url: p.main_image_url || (p.images && p.images[0]) || '',
                    gmv: p.gmv || 0,
                    orders_count: p.orders_count || 0,
                    click_through_rate: p.click_through_rate || 0,
                    details: p.details || null
                }))
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tiktok-shop/sync/:accountId
 * Trigger data synchronization
 * Supports incremental sync - only fetches new data if shop has been synced before
 */
router.post('/sync/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, syncType = 'all' } = req.body;

        const shop = await getShopWithToken(accountId, shopId);

        // Detect if this is a first-time sync by checking if shop has any orders
        const { count: existingOrdersCount } = await supabase
            .from('shop_orders')
            .select('*', { count: 'exact', head: true })
            .eq('shop_id', shop.id);

        const isFirstSync = (existingOrdersCount || 0) === 0;

        if (isFirstSync) {
            console.log(`[Sync] First-time sync detected for ${shop.shop_name} - will fetch all data`);
        } else {
            console.log(`[Sync] Incremental sync for ${shop.shop_name} - will fetch only new data`);
        }

        // Fetch and store data based on syncType
        const syncResults: { orders?: any; products?: any; settlements?: any; performance?: any } = {};

        if (syncType === 'all' || syncType === 'orders') {
            syncResults.orders = await syncOrders(shop, isFirstSync);
        }

        if (syncType === 'all' || syncType === 'products') {
            syncResults.products = await syncProducts(shop, isFirstSync);
        }

        if (syncType === 'all' || syncType === 'settlements' || syncType === 'finance') {
            syncResults.settlements = await syncSettlements(shop, isFirstSync);
        }

        if (syncType === 'all') {
            syncResults.performance = await syncPerformance(shop);
        }

        res.json({
            success: true,
            message: isFirstSync ? 'Initial sync completed' : 'Incremental sync completed',
            isFirstSync,
            stats: syncResults
        });
    } catch (error: any) {
        console.error('Error syncing data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Cron job endpoint for Vercel
router.get('/sync/cron', async (req: Request, res: Response) => {
    // Verify Vercel Cron signature (optional but recommended)
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // For now, allow open access or check a simple secret
        // return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('Starting scheduled sync...');

        // Get all active shops
        const { data: shops, error } = await supabase
            .from('tiktok_shops')
            .select('*');

        if (error) throw error;

        if (!shops || shops.length === 0) {
            return res.json({ message: 'No shops to sync' });
        }

        console.log(`Found ${shops.length} shops to sync`);

        // Sync each shop
        const results = await Promise.allSettled(shops.map(async (shop) => {
            try {
                // Refresh token if needed
                const tokenExpiresAt = new Date(shop.token_expires_at);
                if (tokenExpiresAt < new Date()) {
                    const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);

                    // Update shop with new token
                    await supabase
                        .from('tiktok_shops')
                        .update({
                            access_token: tokenData.access_token,
                            refresh_token: tokenData.refresh_token,
                            token_expires_at: new Date(Date.now() + tokenData.access_token_expire_in * 1000).toISOString(),
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', shop.id);

                    shop.access_token = tokenData.access_token;
                }

                // Run syncs
                await Promise.all([
                    syncOrders(shop),
                    syncProducts(shop),
                    syncSettlements(shop)
                ]);

                return { shop_id: shop.shop_id, status: 'success' };
            } catch (err: any) {
                console.error(`Failed to sync shop ${shop.shop_name}:`, err);
                return { shop_id: shop.shop_id, status: 'failed', error: err.message };
            }
        }));

        res.json({
            success: true,
            results
        });
    } catch (error: any) {
        console.error('Cron sync failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper functions for syncing data
// Supports incremental sync - only fetches new/updated orders if not first sync
async function syncOrders(shop: any, isFirstSync: boolean = true): Promise<{ fetched: number; upserted: number; isIncremental: boolean }> {
    const syncMode = isFirstSync ? 'FULL' : 'INCREMENTAL';
    console.log(`[${syncMode}] Syncing orders for shop ${shop.shop_name}...`);

    try {
        const now = Math.floor(Date.now() / 1000);
        let startTime: number;

        if (isFirstSync) {
            // First sync: get last 365 days (1 year) to capture full historical data
            startTime = now - (365 * 24 * 60 * 60);
            console.log(`[${syncMode}] Fetching orders from last 365 days (1 year)...`);
        } else {
            // Incremental: get latest CREATE_TIME from DB and fetch only NEWER orders
            // This is key - we use create_time not update_time to avoid re-fetching all orders
            const { data: latestOrder } = await supabase
                .from('shop_orders')
                .select('create_time')
                .eq('shop_id', shop.id)
                .order('create_time', { ascending: false })
                .limit(1)
                .single();

            if (latestOrder?.create_time) {
                // Use timestamp + 1 second to EXCLUDE the order we already have
                // API uses create_time_ge (>=), so without +1 it returns the same order again
                startTime = Math.floor(new Date(latestOrder.create_time).getTime() / 1000) + 1;
                console.log(`[${syncMode}] Fetching orders CREATED after ${latestOrder.create_time}...`);
            } else {
                // Fallback to 7 days if no data found
                startTime = now - (7 * 24 * 60 * 60);
                console.log(`[${syncMode}] No existing orders found, falling back to 7 days`);
            }
        }

        let allOrders: any[] = [];
        let nextPageToken = '';
        let hasMore = true;
        let page = 1;

        // For incremental sync, load existing order IDs to implement Smart Stop Early
        let existingOrderIds = new Set<string>();
        if (!isFirstSync) {
            const { data: existingOrders } = await supabase
                .from('shop_orders')
                .select('order_id')
                .eq('shop_id', shop.id);
            if (existingOrders) {
                existingOrderIds = new Set(existingOrders.map(o => o.order_id));
            }
            console.log(`[${syncMode}] Loaded ${existingOrderIds.size} existing order IDs for Smart Stop`);
        }

        while (hasMore) {
            console.log(`Fetching orders page ${page}... (Token: ${nextPageToken ? 'Yes' : 'No'})`);
            const params: any = {
                page_size: '100', // Maximum allowed by API
                create_time_from: startTime,
                create_time_to: now,
                // Sort by create_time DESC to get NEWEST pages first
                sort_field: 'create_time',
                sort_order: 'DESC'
            };

            if (nextPageToken) {
                params.page_token = nextPageToken;
            } else {
                params.page_number = page;
            }

            const response = await tiktokShopApi.searchOrders(
                shop.access_token,
                shop.shop_cipher,
                params
            );

            const orders = response.orders || response.order_list || [];
            console.log(`Page ${page} returned ${orders.length} orders. Next Token: ${response.next_page_token ? 'Yes' : 'No'}`);

            if (orders.length === 0) {
                console.log('No orders returned in this page, stopping.');
                hasMore = false;
                break;
            }

            if (isFirstSync) {
                // First sync: add ALL orders (no deduplication needed)
                allOrders = [...allOrders, ...orders];
                console.log(`[FULL] Added all ${orders.length} orders from page ${page}`);
            } else {
                // INCREMENTAL SYNC with Smart Stop Early:
                // 1. Process ALL orders in the page
                // 2. Add only orders with IDs NOT in our database
                // 3. If ALL orders were new → continue to next page
                // 4. If ANY order already existed → STOP (we've caught up)

                let newInPage = 0;
                let existingInPage = 0;

                for (const order of orders) {
                    const orderId = order.id || order.order_id;
                    if (existingOrderIds.has(orderId)) {
                        existingInPage++;
                    } else {
                        allOrders.push(order);
                        newInPage++;
                    }
                }

                console.log(`[${syncMode}] Page ${page}: ${newInPage} new orders, ${existingInPage} already in DB`);

                // Smart Stop: If ANY order in this page already existed, we've caught up
                if (existingInPage > 0) {
                    console.log(`[${syncMode}] Found ${existingInPage} existing orders - we've caught up! Stopping.`);
                    hasMore = false;
                    break;
                }

                // If ALL orders were new, there might be more new orders in the next page
                console.log(`[${syncMode}] All ${newInPage} orders were new - checking next page...`);
            }

            // If no new token or same token, stop
            if (!response.next_page_token || response.next_page_token === nextPageToken) {
                console.log('No new next_page_token returned, stopping sync.');
                hasMore = false;
            } else {
                nextPageToken = response.next_page_token;
                hasMore = true;
            }

            page++;

            // Safety limit on pages (500 pages x 100 = 50,000 orders max)
            if (page > 500) {
                console.log('Hit safety limit of 500 pages (50,000+ orders), stopping.');
                break;
            }
        }

        console.log(`Found total ${allOrders.length} orders for shop ${shop.shop_name}`);

        if (allOrders.length === 0) {
            return { fetched: 0, upserted: 0, isIncremental: !isFirstSync };
        }

        // Deduplicate orders by ID
        const uniqueOrdersMap = new Map();
        allOrders.forEach(order => {
            uniqueOrdersMap.set(order.id, order);
        });
        const uniqueOrders = Array.from(uniqueOrdersMap.values());
        console.log(`Deduplicated to ${uniqueOrders.length} unique orders`);

        // Find all records for this shop_id to update them all
        const { data: allShops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('shop_id', shop.shop_id);

        const shopIds = allShops?.map(s => s.id) || [shop.id];

        // Batch upsert orders for all associated shop records
        // Process in smaller chunks (20) to avoid EPIPE/payload limits
        const chunkSize = 20;
        for (let i = 0; i < uniqueOrders.length; i += chunkSize) {
            const chunk = uniqueOrders.slice(i, i + chunkSize);

            for (const sId of shopIds) {
                const upsertData = chunk.map((order: any) => ({
                    shop_id: sId,
                    order_id: order.id,
                    order_status: order.status,
                    total_amount: order.payment_info?.total_amount || order.payment?.total_amount || 0,
                    currency: order.payment_info?.currency || order.payment?.currency || 'USD',
                    create_time: new Date(Number(order.create_time) * 1000).toISOString(),
                    update_time: new Date(Number(order.update_time) * 1000).toISOString(),
                    line_items: order.line_items,
                    payment_info: order.payment || order.payment_info,
                    // Note: revenue_breakdown removed - column may not exist in all schemas
                    buyer_info: order.buyer_info || {
                        buyer_email: order.buyer_email,
                        buyer_nickname: order.buyer_nickname,
                        buyer_avatar: order.buyer_avatar,
                        buyer_message: order.buyer_message
                    },
                    shipping_info: order.shipping_info || {
                        ...order.recipient_address,
                        tracking_number: order.tracking_number,
                        shipping_provider: order.shipping_provider,
                        shipping_provider_id: order.shipping_provider_id,
                        delivery_option_name: order.delivery_option_name
                    },
                    updated_at: new Date().toISOString()
                }));

                const { error } = await supabase
                    .from('shop_orders')
                    .upsert(upsertData, {
                        onConflict: 'shop_id,order_id'
                    });

                if (error) {
                    console.error(`Error upserting orders chunk (${chunk.length} orders):`, error);
                    throw new Error(`Failed to upsert orders chunk: ${error.message}`);
                }
            }
        }

        // Update sync timestamp
        await supabase
            .from('tiktok_shops')
            .update({
                orders_last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('shop_id', shop.shop_id);

        console.log(`✅ Orders sync completed for ${shop.shop_name} (${uniqueOrders.length} orders)`);

        return { fetched: allOrders.length, upserted: uniqueOrders.length, isIncremental: !isFirstSync };

    } catch (error) {
        console.error(`Error in syncOrders for ${shop.shop_name}:`, error);
        throw error;
    }
}

// Products are always fully refreshed since they can be updated anytime
// But we accept isFirstSync for consistency with the API
async function syncProducts(shop: any, isFirstSync: boolean = true): Promise<{ fetched: number; upserted: number; isIncremental: boolean }> {
    // Products are always fully refreshed since they can be updated anytime
    // We accept isFirstSync for consistency but we always fetch all to update stock/price
    const syncMode = isFirstSync ? 'FULL' : 'REFRESH';
    console.log(`[${syncMode}] Syncing products for shop ${shop.shop_name}...`);
    try {
        let allProducts: any[] = [];
        let page = 1;
        let hasMore = true;
        let nextPageToken = '';

        while (hasMore) {
            console.log(`Fetching products page ${page}...`);
            const params: any = {
                page_size: '100', // Maximize batch size
                status: 'ACTIVATE', // Active products
                sort_field: 'create_time',
                sort_order: 'DESC' // Newest first
            };

            if (nextPageToken) {
                params.page_token = nextPageToken;
            } else {
                params.page_number = page;
            }

            const response = await tiktokShopApi.searchProducts(
                shop.access_token,
                shop.shop_cipher,
                params
            );

            const products = response.products || response.product_list || [];
            console.log(`Page ${page} returned ${products.length} products`);

            if (products.length > 0) {
                allProducts = [...allProducts, ...products];
            }

            // Check if we need to fetch more
            // API might return next_page_token or we check count vs total
            if (response.next_page_token && response.next_page_token !== nextPageToken) {
                nextPageToken = response.next_page_token;
                page++;
            } else if (response.data?.next_page_token && response.data?.next_page_token !== nextPageToken) {
                // Sometimes response structure varies
                nextPageToken = response.data.next_page_token;
                page++;
            } else if (products.length === 100) {
                // Fallback: if we got full page, try next page by number if token not used
                page++;
            } else {
                hasMore = false;
            }

            // Safety break
            if (page > 50) break;
        }

        console.log(`Found total ${allProducts.length} products for shop ${shop.shop_name}`);

        if (allProducts.length === 0) {
            return { fetched: 0, upserted: 0, isIncremental: false };
        }

        // Find all records for this shop_id to update them all
        const { data: allShops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('shop_id', shop.shop_id);

        const shopIds = allShops?.map(s => s.id) || [shop.id];

        // Batch upsert products for all associated shop records
        for (const product of allProducts) {
            // ... processing logic (unchanged inner loop logic below) ...
            // Fetch detailed product info
            let productImages = product.images || [];
            let fullDetails: any = {};
            try {
                const detailResponse = await tiktokShopApi.makeApiRequest(
                    `/product/202309/products/${product.id}`,
                    shop.access_token,
                    shop.shop_cipher,
                    {},
                    'GET'
                );

                if (detailResponse) {
                    fullDetails = detailResponse;
                    if (detailResponse.main_images) {
                        productImages = detailResponse.main_images.map((img: any) => img.urls[0]);
                    }
                }
            } catch (detailError) {
                console.warn(`Failed to fetch details for product ${product.id}, using basic info.`);
            }

            for (const sId of shopIds) {
                const upsertData = {
                    shop_id: sId,
                    product_id: product.id,
                    product_name: product.title,
                    sku_list: product.skus,
                    status: product.status === 'ACTIVATE' ? 'active' : 'inactive',
                    price: product.skus?.[0]?.price?.tax_exclusive_price || 0,
                    stock: product.skus?.[0]?.inventory?.[0]?.quantity || 0,
                    sales_count: product.sales_regions?.[0]?.sales_count || 0,
                    images: productImages, // Use detailed images
                    main_image_url: productImages[0] || product.main_image, // Ensure main image is set
                    details: fullDetails, // Store full details
                    updated_at: new Date().toISOString()
                };

                const { error } = await supabase
                    .from('shop_products')
                    .upsert(upsertData, {
                        onConflict: 'shop_id,product_id'
                    });

                if (error) {
                    console.error(`Error syncing product ${product.id} for shop record ${sId}:`, error);
                }
            }
        }

        // Fetch Product Performance (Analytics)
        try {
            console.log(`Fetching product performance for shop ${shop.shop_name}...`);
            const today = new Date().toISOString().split('T')[0];
            const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

            const perfParams = {
                start_date_ge: thirtyDaysAgo,
                end_date_lt: today,
                page_size: 20,
                page_number: 1
            };

            const perfResponse = await tiktokShopApi.makeApiRequest(
                '/analytics/202405/shop_products/performance',
                shop.access_token,
                shop.shop_cipher,
                perfParams,
                'GET',
                false, // include shop_cipher
                {
                    transformResponse: [(data: any) => {
                        // Regex to quote large numbers in "id" fields to prevent precision loss
                        // Matches "id": 1234567890123456789 -> "id": "1234567890123456789"
                        if (typeof data === 'string') {
                            try {
                                // Replace "id": 123... with "id": "123..."
                                // We target 15+ digit numbers to be safe
                                const fixedData = data.replace(/"id":\s*(\d{15,})/g, '"id": "$1"');
                                return JSON.parse(fixedData);
                            } catch (e) {
                                console.error('[SyncProducts] Error parsing performance JSON:', e);
                                return JSON.parse(data); // Fallback to default
                            }
                        }
                        return data;
                    }]
                }
            );

            console.log(`[SyncProducts] Performance Response for ${shop.shop_name}:`, JSON.stringify(perfResponse, null, 2));

            if (perfResponse && perfResponse.products && Array.isArray(perfResponse.products)) {
                const perfProducts = perfResponse.products;
                console.log(`[SyncProducts] Found ${perfProducts.length} performance records`);

                for (const sId of shopIds) {
                    for (const perf of perfProducts) {
                        // Update product with performance metrics
                        // Note: perf.id is a string/number, need to match with product_id
                        const perfId = String(perf.id);
                        console.log(`[SyncProducts] Updating performance for product ${perfId} (GMV: ${perf.gmv?.amount}, Orders: ${perf.orders})`);

                        const { error: updateError, count } = await supabase
                            .from('shop_products')
                            .update({
                                click_through_rate: parseFloat(perf.click_through_rate || '0'),
                                gmv: parseFloat(perf.gmv?.amount || '0'),
                                orders_count: parseInt(perf.orders || '0', 10),
                                sales_count: parseInt(perf.units_sold || '0', 10), // Update sales_count/units_sold as well
                                updated_at: new Date().toISOString()
                            })
                            .eq('shop_id', sId)
                            .eq('product_id', perfId)
                            .select(); // Select to check if any row was updated

                        if (updateError) {
                            console.error(`[SyncProducts] Failed to update performance for product ${perfId}:`, updateError);
                        } else if (count === 0) {
                            console.warn(`[SyncProducts] No product found in DB matching performance ID ${perfId} for shop ${sId}`);
                        } else {
                            console.log(`[SyncProducts] Successfully updated performance for product ${perfId}`);
                        }
                    }
                }
            }

        } catch (perfError: any) {
            console.error(`[SyncProducts] Failed to fetch product performance: ${perfError.message}`);
        }

        // Update sync timestamp
        await supabase
            .from('tiktok_shops')
            .update({
                products_last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('shop_id', shop.shop_id);

        console.log(`✅ Products sync completed for ${shop.shop_name} (${allProducts.length} products)`);

        return { fetched: allProducts.length, upserted: allProducts.length, isIncremental: false };

    } catch (error) {
        console.error(`Error in syncProducts for ${shop.shop_name}:`, error);
        throw error;
    }
}

async function syncSettlements(shop: any, isFirstSync: boolean = true): Promise<{ fetched: number; upserted: number; isIncremental: boolean }> {
    const syncMode = isFirstSync ? 'FULL' : 'INCREMENTAL';
    console.log(`[${syncMode}] Syncing settlements for shop ${shop.shop_name}...`);
    try {
        const now = Math.floor(Date.now() / 1000);
        let startTime: number;


        if (isFirstSync) {
            // First sync: get last 30 days
            startTime = now - (30 * 24 * 60 * 60);
            console.log(`[${syncMode}] Fetching settlements from last 30 days...`);
        } else {
            // Incremental: get latest settlement_time from DB
            const { data: latestSettlement } = await supabase
                .from('shop_settlements')
                .select('settlement_time')
                .eq('shop_id', shop.id)
                .order('settlement_time', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latestSettlement && latestSettlement.settlement_time) {
                // Fetch from last settlement time minus 1 day buffer
                startTime = latestSettlement.settlement_time - (24 * 60 * 60);
                console.log(`[${syncMode}] Fetching settlements after ${new Date(startTime * 1000).toISOString()} (with buffer)`);
            } else {
                // Fallback if no data found
                startTime = now - (365 * 24 * 60 * 60);
                console.log(`[${syncMode}] No prior settlements found, fetching last 1 year`);
            }
        }

        let allSettlements: any[] = [];
        let page = 1;
        let hasMore = true;
        let nextPageToken = '';

        // For incremental sync, load existing settlement IDs for Smart Stop
        let existingSettlementIds = new Set<string>();
        if (!isFirstSync) {
            const { data: existingSettlements } = await supabase
                .from('shop_settlements')
                .select('settlement_id')
                .eq('shop_id', shop.id);
            if (existingSettlements) {
                existingSettlementIds = new Set(existingSettlements.map(s => s.settlement_id));
            }
            console.log(`[${syncMode}] Loaded ${existingSettlementIds.size} existing settlement IDs for Smart Stop`);
        }

        while (hasMore) {
            const params: any = {
                start_time: startTime,
                end_time: now,
                page_size: '100', // Max page size
                sort_field: 'statement_time',
                sort_order: 'DESC' // Newest first
            };

            if (nextPageToken) {
                params.page_token = nextPageToken;
            } else {
                params.page_number = page;
            }

            const response = await tiktokShopApi.getStatements(
                shop.access_token,
                shop.shop_cipher,
                params
            );

            const settlements = response.statements || response.statement_list || [];
            console.log(`Page ${page} returned ${settlements.length} settlements`);

            if (settlements.length === 0) {
                if (response.next_page_token && response.next_page_token !== nextPageToken) {
                    nextPageToken = response.next_page_token;
                    page++;
                    continue;
                }
                hasMore = false;
                break;
            }

            if (isFirstSync) {
                // First sync: add ALL settlements
                allSettlements = [...allSettlements, ...settlements];
                console.log(`[FULL] Added all ${settlements.length} settlements from page ${page}`);
            } else {
                // INCREMENTAL SYNC with Smart Stop Early:
                let newInPage = 0;
                let existingInPage = 0;

                for (const stmt of settlements) {
                    const stmtId = stmt.id || stmt.settlement_id;
                    if (existingSettlementIds.has(stmtId)) {
                        existingInPage++;
                    } else {
                        allSettlements.push(stmt);
                        newInPage++;
                    }
                }

                console.log(`[${syncMode}] Page ${page}: ${newInPage} new settlements, ${existingInPage} already in DB`);

                // Smart Stop: If ANY settlement already existed, we've caught up
                if (existingInPage > 0) {
                    console.log(`[${syncMode}] Found ${existingInPage} existing settlements - we've caught up! Stopping.`);
                    hasMore = false;
                    break;
                }

                console.log(`[${syncMode}] All ${newInPage} settlements were new - checking next page...`);
            }

            if (!response.next_page_token || response.next_page_token === nextPageToken) {
                hasMore = false;
            } else {
                nextPageToken = response.next_page_token;
                page++;
            }

            // Safety cap
            if (page > 50) break;
        }

        const settlements = allSettlements;
        console.log(`Found total ${settlements.length} settlements for shop ${shop.shop_name}`);

        if (settlements.length === 0) {
            return { fetched: 0, upserted: 0, isIncremental: !isFirstSync };
        }

        // Find all records for this shop_id to update them all
        const { data: allShops } = await supabase
            .from('tiktok_shops')
            .select('id')
            .eq('shop_id', shop.shop_id);

        const shopIds = allShops?.map(s => s.id) || [shop.id];

        // Batch upsert settlements for all associated shop records
        for (const sId of shopIds) {
            const upsertData = settlements.map((settlement: any) => ({
                shop_id: sId,
                settlement_id: settlement.id,
                order_id: settlement.order_id,
                settlement_time: new Date(Number(settlement.statement_time) * 1000).toISOString(),
                total_amount: parseFloat(settlement.revenue_amount || '0'),
                net_amount: parseFloat(settlement.settlement_amount || '0'),
                fee_amount: parseFloat(settlement.fee_amount || '0'),
                adjustment_amount: parseFloat(settlement.adjustment_amount || '0'),
                shipping_fee: parseFloat(settlement.shipping_cost_amount || '0'),
                net_sales_amount: parseFloat(settlement.net_sales_amount || '0'),
                currency: settlement.currency || 'USD',
                settlement_data: settlement,
                updated_at: new Date().toISOString()
            }));

            const { error } = await supabase
                .from('shop_settlements')
                .upsert(upsertData, {
                    onConflict: 'shop_id,settlement_id'
                });

            if (error) {
                console.error(`Error batch syncing settlements for shop record ${sId}:`, error);
            }
        }

        // Update sync timestamp
        await supabase
            .from('tiktok_shops')
            .update({
                settlements_last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('shop_id', shop.shop_id);

        console.log(`✅ Settlements sync completed for ${shop.shop_name} (${settlements.length} settlements)`);

        return { fetched: settlements.length, upserted: settlements.length, isIncremental: !isFirstSync };

    } catch (error) {
        console.error(`Error in syncSettlements for ${shop.shop_name}:`, error);
        throw error;
    }
}

async function syncPerformance(shop: any) {
    console.log(`Syncing performance for shop ${shop.shop_name}...`);
    try {
        // Format: YYYY-MM-DD
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        const params = {
            start_date_ge: yesterday,
            end_date_lt: today
        };

        // 1. Fetch Performance Data
        const performance = await tiktokShopApi.makeApiRequest(
            '/analytics/202405/shop/performance',
            shop.access_token,
            shop.shop_cipher,
            params,
            'GET'
        );



        if (!performance || !performance.performance || !performance.performance.intervals) {
            console.log('[SyncPerformance] No performance intervals found in response');
            return;
        }

        const data = performance.performance.intervals;
        console.log(`[SyncPerformance] Found ${data.length} performance intervals`);

        console.log('[SyncPerformance] Response data sample:', JSON.stringify(data[0] || {}, null, 2));

        for (const record of data) {
            const { error } = await supabase
                .from('shop_performance')
                .upsert({
                    shop_id: shop.id,
                    date: record.date || new Date().toISOString().split('T')[0],
                    total_orders: record.total_orders || 0,
                    total_revenue: record.total_revenue || 0,
                    total_items_sold: record.total_items_sold || 0,
                    avg_order_value: record.avg_order_value || 0,
                    conversion_rate: record.conversion_rate || 0,
                    shop_rating: record.shop_rating || record.performance_score || null,
                    review_count: record.review_count || record.shop_review_count || 0,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'shop_id,date'
                });

            if (error) {
                console.error(`Error syncing performance for ${shop.shop_name}:`, error);
            }
        }

        // Update sync timestamp
        await supabase
            .from('tiktok_shops')
            .update({
                performance_last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('shop_id', shop.shop_id);

        console.log(`✅ Performance sync completed for ${shop.shop_name}`);

    } catch (error) {
        console.error(`Error in syncPerformance for ${shop.shop_name}:`, error);
        throw error;
    }
}

export default router;
