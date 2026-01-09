
import { supabase } from '../src/config/supabase.js';
import { tiktokShopApi } from '../src/services/tiktok-shop-api.service.js';
import dotenv from 'dotenv';

dotenv.config();

async function triggerPerformanceSync() {
    try {
        console.log('Fetching a shop from database...');
        const { data: shop, error } = await supabase
            .from('tiktok_shops')
            .select('*')
            .limit(1)
            .single();

        if (error || !shop) {
            console.error('No shop found or error:', error);
            return;
        }

        console.log(`Found shop: ${shop.shop_name} (${shop.shop_id})`);
        console.log('Starting manual performance sync...');

        // Format: YYYY-MM-DD
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        const params = {
            start_date_ge: yesterday,
            end_date_lt: today
        };

        console.log(`Calling /analytics/202405/shop/performance for ${yesterday} to ${today}...`);

        const performance = await tiktokShopApi.makeApiRequest(
            '/analytics/202405/shop/performance',
            shop.access_token,
            shop.shop_cipher,
            params,
            'GET'
        );

        console.log('Performance API Response:');
        console.log(JSON.stringify(performance, null, 2));

        console.log('Debug checks:');
        console.log('performance:', !!performance);
        console.log('performance.data:', !!performance?.data);
        console.log('performance.data.performance:', !!performance?.data?.performance);
        console.log('performance.data.performance.intervals:', !!performance?.data?.performance?.intervals);

        if (performance && performance.performance && performance.performance.intervals) {
            const record = performance.performance.intervals[0];
            const rating = record.shop_rating || record.performance_score || null;
            console.log(`Extracted Rating: ${rating}`);
        } else {
            console.log('No performance data returned.');
        }

    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

triggerPerformanceSync();
