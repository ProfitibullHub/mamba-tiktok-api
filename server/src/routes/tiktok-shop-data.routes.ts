import { Router, Request, Response } from 'express';
import { tiktokShopApi, TikTokShopError } from '../services/tiktok-shop-api.service.js';
import { supabase } from '../config/supabase.js';

const router = Router();



export const getShopWithToken = async (accountId: string, shopId?: string, forceRefresh: boolean = false) => {
    let query = supabase
        .from('tiktok_shops')
        .select('*')
        .eq('account_id', accountId);

    if (shopId) {
        query = query.eq('shop_id', shopId);
    }

    const { data: shops, error } = await query.limit(1).single();

    if (error || !shops) {
        throw new Error('Shop not found or not connected');
    }


    const tokenExpiresAt = new Date(shops.token_expires_at);
    const fiveMinutes = 5 * 60 * 1000;

    if (forceRefresh || (tokenExpiresAt.getTime() - fiveMinutes < Date.now())) {
        console.log(`Refreshing token for shop ${shops.shop_name} (Force: ${forceRefresh})`);

        const tokenData = await tiktokShopApi.refreshAccessToken(shops.refresh_token);

        const now = new Date();
        const newExpiresAt = new Date(now.getTime() + tokenData.access_token_expire_in * 1000);


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
        shops.shop_cipher = shops.shop_cipher;
    }

    return shops;
}



async function executeWithRefresh<T>(
    accountId: string,
    shopId: string | undefined,
    operation: (token: string, cipher: string) => Promise<T>
): Promise<T> {
    try {

        const shop = await getShopWithToken(accountId, shopId);
        return await operation(shop.access_token, shop.shop_cipher);
    } catch (error: any) {

        if (error instanceof TikTokShopError && error.code === 105002) {
            console.log('Token expired (105002), forcing refresh and retrying...');

            const shop = await getShopWithToken(accountId, shopId, true);

            return await operation(shop.access_token, shop.shop_cipher);
        }
        throw error;
    }
}



router.get('/shops/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;

        const { refresh } = req.query;


        if (refresh === 'true') {

            const { data: existingShop } = await supabase
                .from('tiktok_shops')
                .select('*')
                .eq('account_id', accountId)
                .limit(1)
                .single();

            if (existingShop) {

                let accessToken = existingShop.access_token;
                const tokenExpiresAt = new Date(existingShop.token_expires_at);
                if (tokenExpiresAt.getTime() - 5 * 60 * 1000 < Date.now()) {
                    const tokenData = await tiktokShopApi.refreshAccessToken(existingShop.refresh_token);
                    accessToken = tokenData.access_token;

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


                const authorizedShops = await tiktokShopApi.getAuthorizedShops(accessToken);


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
                            access_token: accessToken,
                            updated_at: new Date().toISOString(),
                        }, {
                            onConflict: 'account_id,shop_id',
                        });
                }
            }
        }

        const { data: shops, error } = await supabase
            .from('tiktok_shops')
            .select('shop_id, shop_name, region, seller_type, created_at')
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
                '/order/202309/orders/search',
                token,
                cipher,
                params,
                'POST'
            )
        );

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



router.get('/orders/:accountId/:orderId', async (req: Request, res: Response) => {
    try {
        const { accountId, orderId } = req.params;
        const { shopId } = req.query;


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


        const products = (response.products || []).map((p: any) => {
            const mainSku = p.skus?.[0] || {};
            const priceInfo = mainSku.price || {};
            const inventoryInfo = mainSku.inventory?.[0] || {};

            return {
                product_id: p.id,
                product_name: p.title,
                price: parseFloat(priceInfo.tax_exclusive_price || '0'),
                currency: priceInfo.currency || 'USD',
                stock: inventoryInfo.quantity || 0,
                sales_count: 0,
                status: p.status === 'ACTIVATE' ? 'active' : 'inactive',
                images: [],
                create_time: p.create_time
            };
        });

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



router.get('/settlements/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, startTime, endTime } = req.query;

        const params: any = {
            sort_field: 'settlement_time',
            sort_order: 'DESC'
        };

        if (startTime) params.start_time = parseInt(startTime as string);
        if (endTime) params.end_time = parseInt(endTime as string);

        const settlements = await executeWithRefresh(
            accountId,
            shopId as string,
            (token, cipher) => tiktokShopApi.makeApiRequest(
                '/finance/202309/statements',
                token,
                cipher,
                params
            )
        );

        res.json({
            success: true,
            data: settlements,
        });
    } catch (error: any) {
        console.error('Error fetching settlements:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});



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



router.post('/sync/:accountId', async (req: Request, res: Response) => {
    try {
        const { accountId } = req.params;
        const { shopId, syncType = 'all' } = req.body;

        const shop = await getShopWithToken(accountId, shopId);


        const syncPromises = [];

        if (syncType === 'all' || syncType === 'orders') {
            syncPromises.push(syncOrders(shop));
        }

        if (syncType === 'all' || syncType === 'products') {
            syncPromises.push(syncProducts(shop));
        }

        if (syncType === 'all' || syncType === 'settlements') {
            syncPromises.push(syncSettlements(shop));
        }

        await Promise.all(syncPromises);

        res.json({
            success: true,
            message: 'Data synchronization completed',
        });
    } catch (error: any) {
        console.error('Error syncing data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});


router.get('/sync/cron', async (req: Request, res: Response) => {

    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {


    }

    try {
        console.log('Starting scheduled sync...');


        const { data: shops, error } = await supabase
            .from('tiktok_shops')
            .select('*');

        if (error) throw error;

        if (!shops || shops.length === 0) {
            return res.json({ message: 'No shops to sync' });
        }

        console.log(`Found ${shops.length} shops to sync`);


        const results = await Promise.allSettled(shops.map(async (shop) => {
            try {

                const tokenExpiresAt = new Date(shop.token_expires_at);
                if (tokenExpiresAt < new Date()) {
                    const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);


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


async function syncOrders(shop: any) {
    console.log(`Syncing orders for shop ${shop.shop_name}...`);
    try {

        const now = Math.floor(Date.now() / 1000);
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60);

        const params = {
            page_size: 50,
            page_number: 1,
            create_time_from: thirtyDaysAgo,
            create_time_to: now
        };

        const response = await tiktokShopApi.searchOrders(
            shop.access_token,
            shop.shop_cipher,
            params
        );

        const orders = response.orders || [];
        console.log(`Found ${orders.length} orders for shop ${shop.shop_name}`);

        if (orders.length === 0) return;


        for (const order of orders) {
            const { error } = await supabase
                .from('shop_orders')
                .upsert({
                    shop_id: shop.shop_id,
                    account_id: shop.account_id,
                    order_id: order.order_id,
                    order_status: order.order_status,
                    order_amount: order.payment_info?.total_amount || 0,
                    currency: order.payment_info?.currency || 'USD',
                    payment_method: order.payment_method_name,
                    shipping_provider: order.shipping_provider,
                    tracking_number: order.tracking_number,
                    buyer_uid: order.buyer_uid,
                    created_time: order.create_time,
                    updated_time: order.update_time,
                    line_items: order.line_items,
                    recipient_address: order.recipient_address,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'order_id'
                });

            if (error) {
                console.error(`Error syncing order ${order.order_id}:`, error);
            }
        }
    } catch (error) {
        console.error(`Error in syncOrders for ${shop.shop_name}:`, error);
    }
}

async function syncProducts(shop: any) {
    console.log(`Syncing products for shop ${shop.shop_name}...`);
    try {
        const params = {
            page_size: 50,
            page_number: 1,
            status: 'ACTIVATE'
        };

        const response = await tiktokShopApi.searchProducts(
            shop.access_token,
            shop.shop_cipher,
            params
        );

        const products = response.products || [];
        console.log(`Found ${products.length} products for shop ${shop.shop_name}`);

        if (products.length === 0) return;

        for (const product of products) {
            const { error } = await supabase
                .from('shop_products')
                .upsert({
                    shop_id: shop.shop_id,
                    account_id: shop.account_id,
                    product_id: product.id,
                    name: product.title,
                    sku: product.skus?.[0]?.seller_sku,
                    status: product.status,
                    price: product.skus?.[0]?.price?.tax_exclusive_price,
                    currency: product.skus?.[0]?.price?.currency,
                    stock_quantity: product.skus?.[0]?.inventory?.[0]?.quantity || 0,
                    sales_count: product.sales_regions?.[0]?.sales_count || 0,
                    main_image_url: product.images?.[0]?.url_list?.[0],
                    created_time: product.create_time,
                    updated_time: product.update_time,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'product_id'
                });

            if (error) {
                console.error(`Error syncing product ${product.id}:`, error);
            }
        }
    } catch (error) {
        console.error(`Error in syncProducts for ${shop.shop_name}:`, error);
    }
}

async function syncSettlements(shop: any) {
    console.log(`Syncing settlements for shop ${shop.shop_name}...`);
    try {
        const now = Math.floor(Date.now() / 1000);
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60);

        const params = {
            start_time: thirtyDaysAgo,
            end_time: now,
            page_size: 20,
            sort_field: 'settlement_time',
            sort_order: 'DESC'
        };

        const response = await tiktokShopApi.getStatements(
            shop.access_token,
            shop.shop_cipher,
            params
        );

        const settlements = response.statement_list || [];
        console.log(`Found ${settlements.length} settlements for shop ${shop.shop_name}`);

        if (settlements.length === 0) return;

        for (const settlement of settlements) {
            const { error } = await supabase
                .from('shop_settlements')
                .upsert({
                    shop_id: shop.shop_id,
                    account_id: shop.account_id,
                    settlement_id: settlement.id,
                    settlement_time: settlement.settlement_time,
                    currency: settlement.currency,
                    settlement_amount: settlement.settlement_amount,
                    revenue_amount: settlement.revenue_amount,
                    fee_amount: settlement.fee_amount,
                    adjustment_amount: settlement.adjustment_amount,
                    status: settlement.status,
                    created_at: new Date().toISOString()
                }, {
                    onConflict: 'settlement_id'
                });

            if (error) {
                console.error(`Error syncing settlement ${settlement.id}:`, error);
            }
        }
    } catch (error) {
        console.error(`Error in syncSettlements for ${shop.shop_name}:`, error);
    }
}

export default router;
