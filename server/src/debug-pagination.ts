
import { supabase } from './config/supabase';
import { tiktokShopApi } from './services/tiktok-shop-api.service';

async function verifyPagination() {
    try {
        console.log('Fetching a shop to test...');
        const { data: shop, error } = await supabase
            .from('tiktok_shops')
            .select('*')
            .eq('shop_name', 'SANDBOX_US7580451829431961357')
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

        // Test Orders Pagination
        console.log('\n--- Testing Orders Pagination ---');
        const now = Math.floor(Date.now() / 1000);
        const oneYearAgo = now - (365 * 24 * 60 * 60);

        let nextPageToken = '';
        let page = 1;
        const maxPages = 2; // Test first 2 pages

        while (page <= maxPages) {
            console.log(`Fetching page ${page}...`);
            const params: any = {
                page_size: '50',
                create_time_from: oneYearAgo,
                create_time_to: now
            };

            if (nextPageToken) {
                params.page_token = nextPageToken;
            } else {
                params.page_number = page;
            }

            try {
                const response = await tiktokShopApi.searchOrders(accessToken, shopCipher, params);
                const orders = response.orders || response.order_list || [];
                console.log(`Page ${page}: Found ${orders.length} orders.`);

                if (orders.length > 0) {
                    console.log(`First Order ID: ${orders[0].id}`);
                }

                nextPageToken = response.next_page_token;
                if (!nextPageToken) {
                    console.log('No more pages.');
                    break;
                }
                console.log('Next Token:', nextPageToken);
                page++;
            } catch (e: any) {
                console.error(`Page ${page} Failed:`, e.message);
                if (e.response) console.error(JSON.stringify(e.response.data, null, 2));
                break;
            }
        }

    } catch (error: any) {
        console.error('Test Setup Failed:', error.message);
    }
}

verifyPagination();
