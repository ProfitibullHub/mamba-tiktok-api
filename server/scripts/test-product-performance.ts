
import { supabase } from '../src/config/supabase.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testProductPerformance() {
    try {
        console.log('Fetching a shop from database...');
        const { data: shop, error } = await supabase
            .from('tiktok_shops')
            .select('*')
            .eq('shop_name', 'WS Nutrition') // Target the specific shop
            .limit(1)
            .single();

        if (error || !shop) {
            console.error('No shop found or error:', error);
            return;
        }

        console.log(`Found shop: ${shop.shop_name} (${shop.shop_id})`);
        const url = `http://localhost:3001/api/tiktok-shop/sync/${shop.account_id}`;

        // Test Sync Products
        console.log('\n--- Testing Sync Products (with Performance & Details) ---');
        const productsRes = await axios.post(url, {
            shopId: shop.shop_id,
            syncType: 'products'
        });
        console.log('Products Sync Result:', productsRes.data);

        // Verify Database Updates
        console.log('\n--- Verifying Database Updates ---');
        const { data: products, error: prodError } = await supabase
            .from('shop_products')
            .select('product_id, product_name, gmv, orders_count, click_through_rate, images')
            .eq('shop_id', shop.id);

        if (prodError) {
            console.error('Error fetching products:', prodError);
        } else {
            console.log(`Found ${products.length} products in DB:`);
            products.forEach(p => {
                console.log(`- ${p.product_name} (${p.product_id}): GMV=${p.gmv}, Orders=${p.orders_count}, CTR=${p.click_through_rate}, Images=${p.images?.length || 0}`);
            });
        }

    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testProductPerformance();
