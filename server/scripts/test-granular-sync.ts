
import { supabase } from '../src/config/supabase.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testGranularSync() {
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
        const url = `http://localhost:3001/api/tiktok-shop/sync/${shop.account_id}`;

        // Test 1: Sync Orders
        console.log('\n--- Testing Sync Orders ---');
        const ordersRes = await axios.post(url, {
            shopId: shop.shop_id,
            syncType: 'orders'
        });
        console.log('Orders Sync Result:', ordersRes.data);

        // Test 2: Sync Products
        console.log('\n--- Testing Sync Products ---');
        const productsRes = await axios.post(url, {
            shopId: shop.shop_id,
            syncType: 'products'
        });
        console.log('Products Sync Result:', productsRes.data);

        // Test 3: Sync Finance
        console.log('\n--- Testing Sync Finance ---');
        const financeRes = await axios.post(url, {
            shopId: shop.shop_id,
            syncType: 'finance'
        });
        console.log('Finance Sync Result:', financeRes.data);

        // Test 4: Sync All
        console.log('\n--- Testing Sync All ---');
        const allRes = await axios.post(url, {
            shopId: shop.shop_id,
            syncType: 'all'
        });
        console.log('All Sync Result:', allRes.data);

    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testGranularSync();
