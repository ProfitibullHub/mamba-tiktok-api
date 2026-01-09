import { supabase } from '../src/config/supabase.js';

async function checkImages() {
    const { data, error } = await supabase
        .from('shop_products')
        .select('product_id, product_name, images, main_image_url')
        .limit(5);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Products with images:');
        data.forEach(p => {
            console.log(`\n- ${p.product_name} (${p.product_id})`);
            console.log(`  Images array:`, p.images);
            console.log(`  Main image URL:`, p.main_image_url);
        });
    }
}

checkImages();
