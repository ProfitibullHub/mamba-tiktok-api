
import { supabase } from '../src/config/supabase.js';
import { tiktokShopApi } from '../src/services/tiktok-shop-api.service.js';
import dotenv from 'dotenv';

dotenv.config();

async function testShopInfo() {
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

        const endpoints = [
            '/shop/202309/shops',
            '/seller/202309/shops', // We know this works but returns limited data
            '/shop/202309/shop_info',
            '/seller/202309/profile',
            '/authorization/202309/shop_info'
        ];

        for (const endpoint of endpoints) {
            console.log(`Testing endpoint: ${endpoint} (excludeShopCipher=true)`);
            try {
                const response = await (tiktokShopApi as any).makeApiRequest(
                    endpoint,
                    shop.access_token,
                    shop.shop_cipher,
                    {},
                    'GET',
                    true // excludeShopCipher
                );
                console.log(`SUCCESS: ${endpoint}`);
                console.log(JSON.stringify(response, null, 2));
            } catch (e: any) {
                console.log(`FAILED: ${endpoint} - ${e.message}`);
                if (e.response) console.log(JSON.stringify(e.response.data, null, 2));
            }
        }

    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

testShopInfo();
