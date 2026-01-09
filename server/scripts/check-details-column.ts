import { supabase } from '../src/config/supabase.js';

async function addColumn() {
    // First, try to add the column directly
    const { error } = await supabase
        .from('shop_products')
        .select('details')
        .limit(1);

    if (error && error.code === '42703') {
        console.log('Column does not exist. Please run this SQL in Supabase SQL Editor:');
        console.log('');
        console.log('ALTER TABLE shop_products ADD COLUMN details JSONB;');
        console.log('');
    } else if (error) {
        console.error('Error:', error);
    } else {
        console.log('✓ Column already exists');
    }
}

addColumn();
