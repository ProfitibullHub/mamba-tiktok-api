import { supabase } from '../src/config/supabase.js';

async function checkPerformance() {
    const { data, error } = await supabase
        .from('shop_products')
        .select('product_id, product_name, gmv, orders_count, click_through_rate, images, details')
        .limit(10);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Products in DB:');
        data.forEach(p => {
            console.log(`- ${p.product_name} (${p.product_id})`);
            console.log(`  GMV: ${p.gmv}, Orders: ${p.orders_count}, CTR: ${p.click_through_rate}`);
            console.log(`  Images: ${p.images?.length || 0}, Details: ${p.details ? 'YES' : 'NO'}`);
        });
    }
}

checkPerformance();
