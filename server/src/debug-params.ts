
import { supabase } from './config/supabase';
import { tiktokShopApi } from './services/tiktok-shop-api.service';

async function verifyParams() {
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

        // 1. Test Orders: Try page_size in QUERY params for POST
        console.log('\n--- Testing Orders Sync (page_size in Query) ---');
        const now = Math.floor(Date.now() / 1000);
        const oneYearAgo = now - (365 * 24 * 60 * 60);

        try {
            // Manually construct request to force page_size into query
            const body = {
                create_time_from: oneYearAgo,
                create_time_to: now
            };
            const query = {
                page_size: 50,
                page_number: 1
            };

            console.log('Sending POST with Query:', query, 'Body:', body);

            // We use makeApiRequest but we need to trick it or use a lower level call?
            // makeApiRequest puts params into body for POST.
            // Let's use makeApiRequest but pass page_size in a way that it stays in query?
            // The service logic separates them.
            // Let's modify the service temporarily or just use axios directly here to prove it?
            // Better to use the service if we can.

            // Actually, let's try to modify the service in the next step if this hypothesis is strong.
            // For now, let's try to use makeApiRequest with a "hack":
            // If we pass `version` it goes to query.
            // But `page_size` is explicitly moved to body.

            // Let's try passing "PageSize" (Pascal) as a param, which will go to body (failed before).
            // Let's try passing "page_size" (snake) which goes to body (failed before).

            // Let's try to use the `tiktokShopApi` but manually construct the URL with query params
            // This is hard without modifying the service.

            // OK, let's try to modify the service to put page_size in query if it's provided.
            // But first, let's try the Performance fix since that's easier to test.
        } catch (e: any) {
            console.log('Skipping Orders test for now.');
        }

        // 2. Test Performance: Try StartDateGe (PascalCase)
        console.log('\n--- Testing Performance Sync (PascalCase) ---');
        try {
            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

            const perfParams = {
                StartDateGe: yesterday,
                EndDateLt: today
            };

            console.log('Params:', perfParams);

            const perfResponse = await tiktokShopApi.makeApiRequest(
                '/analytics/202405/shop/performance',
                accessToken,
                shopCipher,
                perfParams, // GET params
                'GET'
            );
            console.log('Success! Performance data retrieved.');
            console.log('Data:', JSON.stringify(perfResponse, null, 2));
        } catch (e: any) {
            console.error('Performance Sync Failed:', e.message);
            if (e.response) console.error(e.response.data);
        }

    } catch (error: any) {
        console.error('Test Setup Failed:', error.message);
    }
}

verifyParams();
