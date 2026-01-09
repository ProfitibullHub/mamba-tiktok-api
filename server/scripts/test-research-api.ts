
import { supabase } from '../src/config/supabase.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testResearchApi() {
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

        const url = 'https://open.tiktokapis.com/v2/research/tts/shop/';
        const params = {
            fields: 'shop_rating,shop_name,shop_review_count'
        };

        console.log(`Testing Research API: ${url}`);

        try {
            const response = await axios.post(url, {
                query: {
                    and: [
                        {
                            operation: "EQ",
                            field_name: "shop_id",
                            field_values: [shop.shop_id]
                        }
                    ]
                }
            }, {
                params,
                headers: {
                    'Authorization': `Bearer ${shop.access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('SUCCESS:');
            console.log(JSON.stringify(response.data, null, 2));
        } catch (e: any) {
            console.log(`FAILED: ${e.message}`);
            if (e.response) {
                console.log('Status:', e.response.status);
                console.log('Data:', JSON.stringify(e.response.data, null, 2));
            }
        }

    } catch (error: any) {
        console.error('Error:', error.message);
    }
}

testResearchApi();
