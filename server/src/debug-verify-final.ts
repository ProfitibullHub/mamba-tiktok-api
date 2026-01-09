
import { supabase } from './config/supabase';
import { tiktokShopApi } from './services/tiktok-shop-api.service';

async function verifyFinal() {
    try {
        console.log('Fetching a shop to test...');
        const { data: shop, error } = await supabase
            .from('tiktok_shops')
            .select('*')
            .limit(1)
            .single();

        if (error || !shop) {
            console.error('No shop found to test with.', error);
            return;
        }

        console.log(`Testing with shop: ${shop.shop_name} (${shop.shop_id})`);

        // Refresh token
        const tokenData = await tiktokShopApi.refreshAccessToken(shop.refresh_token);
        const accessToken = tokenData.access_token;
        const shopCipher = shop.shop_cipher;

        // 1. Test Orders: Should now send page_size in Query AND Body
        console.log('\n--- Testing Orders Sync (page_size in Query+Body) ---');
        const now = Math.floor(Date.now() / 1000);
        const oneYearAgo = now - (365 * 24 * 60 * 60);

        try {
            const orderParams = {
                page_size: '50', // String
                page_number: 1,
                create_time_from: oneYearAgo,
                create_time_to: now
            };

            const ordersResponse = await tiktokShopApi.searchOrders(accessToken, shopCipher, orderParams);
            const orders = ordersResponse.orders || ordersResponse.order_list || [];
            console.log(`Success! Found ${orders.length} orders.`);
            if (ordersResponse.next_page_token) {
                console.log('Next page token present:', ordersResponse.next_page_token);
            }
        } catch (e: any) {
            console.error('Orders Sync Failed:', e.message);
            if (e.response) console.error(JSON.stringify(e.response.data, null, 2));
        }

        // 2. Test Performance: Try StartDateGe (PascalCase) again?
        // Wait, the previous error was "StartDateGe is a required field" when I sent it in Query.
        // Maybe it needs to be in Body? But it's a GET request.
        // Let's try sending it as snake_case in Query again, maybe I missed something.
        // Or maybe it needs to be POST?
        // Let's try POST for Performance just in case.
        console.log('\n--- Testing Performance Sync (POST?) ---');
        try {
            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

            const perfParams = {
                start_date_ge: yesterday,
                end_date_lt: today
            };

            // Try POST
            const perfResponse = await tiktokShopApi.makeApiRequest(
                '/analytics/202405/shop/performance',
                accessToken,
                shopCipher,
                perfParams,
                'POST'
            );
            console.log('Success (POST)! Performance data retrieved.');
        } catch (e: any) {
            console.log('POST Attempt Failed:', e.message);
        }

    } catch (error: any) {
        console.error('Test Setup Failed:', error.message);
    }
}

verifyFinal();
