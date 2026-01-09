
import { supabase } from '../src/config/supabase.js';
import { tiktokShopApi } from '../src/services/tiktok-shop-api.service.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Mock the syncProducts function call by calling the sync endpoint
async function triggerSync() {
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

        // Call the sync endpoint locally
        const url = `http://localhost:3001/api/tiktok-shop/sync/${shop.account_id}`;
        console.log(`Calling sync endpoint: ${url}`);

        const response = await axios.post(url, {
            shopId: shop.shop_id,
            syncType: 'products'
        });

        console.log('Sync triggered successfully:', response.data);

    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

triggerSync();
