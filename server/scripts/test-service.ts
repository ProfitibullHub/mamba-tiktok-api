
import { supabase } from '../src/config/supabase.js';
import { tiktokShopApi } from '../src/services/tiktok-shop-api.service.js';
import dotenv from 'dotenv';

dotenv.config();

async function testServiceMethod() {
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

        console.log('Calling tiktokShopApi.getShopInfo()...');
        const shopInfo = await tiktokShopApi.getShopInfo(shop.access_token, shop.shop_cipher);

        console.log('SUCCESS:');
        console.log(JSON.stringify(shopInfo, null, 2));

    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

testServiceMethod();
